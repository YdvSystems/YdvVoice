// Le MIXER WINDOWS du ducking (V12) — le LEVIER réel derrière la DuckingPolicy (ducking.ts).
//
// LEVIER (mesuré conv 57, banc scratchpad — porte de décision 0d PASSÉE) : WASAPI Audio Session API
// (ISimpleAudioVolume par session de RENDU, par app), pilotée par un helper PowerShell PERSISTANT
// (Add-Type C# COM inline). Chiffres du banc : démarrage 305 ms (une fois) · round-trip DUCK réel vu de
// Node 1,4 ms méd / 6 ms max (cible 150 ms — marge ×100) · restore relu IDENTIQUE · RAM helper 64,6 Mo ·
// scan récurrent ~1,2 ms. Un spawn PS PAR duck coûterait ~1-2 s → persistant obligatoire.
//
// ⚠ WINDOWS PERSISTE LE VOLUME PAR APP (prouvé au banc : baissé à 0,15 → process tué → la NOUVELLE session
// du même exe démarre à 0,15). Un crash en plein duck laisserait Spotify baissé POUR TOUJOURS. D'où :
//   · WRITE-AHEAD : `home/duck-restore.json` (famille pidfile — PAS la db : le ducking doit marcher même en
//     SANS_ECRITURE) écrit AVANT de baisser, effacé APRÈS restauration réussie ;
//   · FILET BOOT : un fichier résiduel au démarrage (crash pendant un duck) → restaurer D'ABORD.
//
// ARCHITECTURE (« mécanisme côté orchestrateur » tenu) : le helper est quasi SANS ÉTAT — chaque opération est
// autonome (snap / duck / restore par listes explicites) ; l'état (volumes d'origine, fichier de restauration,
// sessions connues) vit ICI, chez Node. Un helper mort → respawn au prochain besoin, rien de perdu.
//
// EXCLUSIONS : la BOUCHE de Sophia (PID lu à CHAQUE opération — il change au respawn du sidecar), notre propre
// process, + noms optionnels (ex. les bips du juge). Sophia ne se baisse JAMAIS elle-même.
//
// RE-SCAN pendant le duck : une session APPARUE en pleine conversation (l'utilisateur lance une vidéo) est
// duckée au vol (scan ~1,2 ms, période 2 s) — write-ahead d'abord (le fichier s'enrichit AVANT la baisse).
//
// Les opérations sont SÉRIALISÉES (chaîne de promesses) + bornées (deadline par op, patron psRun/F-A) ;
// `duck()`/`restore()` (contrat DuckMixer) sont fire-and-forget (patron `send` du routeur — jamais dans le
// chemin de la voix). JAMAIS fatal : sans PowerShell, Sophia vit — les médias ne baissent juste pas.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DuckMixer } from "./ducking.js";

/** Une session mémorisée pour la restauration : le volume D'ORIGINE avant notre baisse. */
export interface DuckEntry {
  pid: number;
  name: string;
  vol: number;
}

export interface WindowsMixerOptions {
  /** Dossier home de Sophia (paths.home) — y vivent le script helper et duck-restore.json. */
  home: string;
  /** PIDs à ne JAMAIS toucher, lus à CHAQUE opération (la bouche respawne → son PID change). */
  excludePids?: () => number[];
  /** Noms de process (minuscules, sans .exe) à ne jamais toucher (ex. "node" pour les bips du juge). */
  excludeNames?: string[];
  /** HOOK DE TEST UNIQUEMENT (patron TEST_HOOKS sidecar) : si fourni et non vide, ne toucher QUE ces PIDs —
   *  l'e2e cible son process témoin et ne baisse JAMAIS les vraies sessions de la machine. Jamais en prod. */
  onlyPids?: () => number[];
  /** Facteur de duck (0..1) appliqué au volume d'origine. Défaut env SOPHIA_DUCK_FACTOR sinon 0,2. */
  duckFactor?: number;
  /** Remontée en RAMPE douce (ms). Défaut 300. La baisse, elle, est VIVE (un pas). */
  rampMs?: number;
  /** Période du re-scan pendant un duck (nouvelles sessions duckées au vol). Défaut 2000 ms. */
  rescanMs?: number;
  /** Deadline d'une opération helper (patron psRun). Défaut 5000 ms. */
  opTimeoutMs?: number;
  onLog?: (l: string) => void;
}

/** `SOPHIA_DUCK_FACTOR` (0..1), défaut 0,2. N-5 (conv 56) : blanc = non-réglé = défaut (jamais Number(" ")===0
 *  qui mettrait les médias à ZÉRO en silence). */
function envDuckFactor(): number {
  const raw = process.env.SOPHIA_DUCK_FACTOR;
  if (raw == null || raw.trim() === "") return 0.2;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.2;
}

export class WindowsMixer implements DuckMixer {
  private readonly home: string;
  private readonly excludePids: () => number[];
  private readonly excludeNames: string[];
  private readonly onlyPids: (() => number[]) | null;
  private readonly duckFactor: number;
  private readonly rampMs: number;
  private readonly rescanMs: number;
  private readonly opTimeoutMs: number;
  private readonly onLog?: (l: string) => void;

  private helper: ChildProcess | null = null;
  private buf = "";
  private waiters: Array<(line: string | null) => void> = [];
  /** Sérialisation des opérations (jamais deux ops helper en vol — l'ordre duck→restore est garanti). */
  private chain: Promise<void> = Promise.resolve();
  /** L'état du duck côté orchestrateur : les sessions baissées (volumes d'ORIGINE). Null = pas ducké. */
  private duckedEntries: DuckEntry[] | null = null;
  /** M2/M3 (croisé conv 57) : les entrées DUES mais non encore réparées (app fermée, helper indisponible) —
   *  elles VIVENT dans le write-ahead tant qu'elles ne sont pas réconciliées (jamais « restauré » sur parole).
   *  Réparées : au filet boot suivant, au stop, ou ADOPTÉES par un duck ultérieur (session ré-apparue du même
   *  nom → son origine = CELLE DU FICHIER, pas le volume persisté-baissé que Windows ressert). */
  private pending: DuckEntry[] = [];
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private rescanQueued = false;            // m8 : coalescence — jamais deux ops de re-scan empilées
  private helperBackoffUntil = 0;          // m8 : après un échec de spawn/READY, pas de re-spawn avant ça
  private stopped = false;                 // refuse les COMMANDES publiques (duck/restore)
  private helperClosed = false;            // M2 : posé à la FIN de stop() — le restore de stop PEUT respawner le helper

  constructor(opts: WindowsMixerOptions) {
    this.home = opts.home;
    this.excludePids = opts.excludePids ?? (() => []);
    this.excludeNames = (opts.excludeNames ?? []).map((n) => n.toLowerCase());
    this.onlyPids = opts.onlyPids ?? null;
    this.duckFactor = opts.duckFactor ?? envDuckFactor();
    this.rampMs = opts.rampMs ?? 300;
    this.rescanMs = opts.rescanMs ?? 2000;
    this.opTimeoutMs = opts.opTimeoutMs ?? 5000;
    this.onLog = opts.onLog;
  }

  private get restoreFile(): string {
    return path.join(this.home, "duck-restore.json");
  }

  private get helperScript(): string {
    return path.join(this.home, "duck-helper.ps1");
  }

  /** L'état courant — LECTURE SEULE (vue dérivée O5 : /debug, tests). */
  get isDucked(): boolean {
    return this.duckedEntries != null;
  }

  // ── cycle de vie ───────────────────────────────────────────────────────────────

  /** Démarre : écrit le script helper (constante autonome — robuste au packaging), lance le helper, puis
   *  FILET BOOT : un duck-restore.json résiduel (crash pendant un duck) → restaurer d'abord. Jamais fatal. */
  start(): void {
    if (this.stopped) return;
    this.enqueue(async () => {
      try {
        fs.mkdirSync(this.home, { recursive: true });
        fs.writeFileSync(this.helperScript, "\ufeff" + HELPER_PS1, "utf8"); // BOM explicite → PS 5.1 lit l'UTF-8 correctement
      } catch (e) {
        this.log(`mixer : écriture du helper impossible (${(e as Error).message}) — ducking inactif`);
        return;
      }
      await this.ensureHelper();
      // FILET BOOT (write-ahead) : un fichier résiduel = un crash en plein duck → restaurer AVANT tout.
      let leftovers: DuckEntry[] | null = null;
      try {
        if (fs.existsSync(this.restoreFile)) {
          leftovers = (JSON.parse(fs.readFileSync(this.restoreFile, "utf8")) as { entries: DuckEntry[] }).entries;
        }
      } catch (e) {
        this.log(`mixer : duck-restore.json illisible (${(e as Error).message}) — effacé (rien à restaurer de sûr)`);
        try { fs.rmSync(this.restoreFile); } catch { /* */ }
      }
      if (leftovers && leftovers.length) {
        this.log(`mixer : duck résiduel d'un crash détecté (${leftovers.length} session(s)) → restauration`);
        await this.settleRestore(leftovers, "filet boot");
      } else if (leftovers) {
        try { fs.rmSync(this.restoreFile); } catch { /* */ } // n13 : entries:[] résiduel → effacé aussi
      }
    });
  }

  /** Arrêt (stopVoice ⑩) : restore si ducké + QUIT le helper. Attendable (l'arrêt propre T6 borne déjà tout).
   *  M2 (croisé conv 57) : `stopped` ne bloque que les COMMANDES publiques — le restore d'arrêt PEUT encore
   *  respawner un helper mort (`helperClosed` n'est posé qu'à la FIN) ; et le write-ahead n'est effacé que
   *  RÉCONCILIÉ (settleRestore) — un restore raté laisse le fichier pour le filet boot du prochain démarrage. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.stopRescan();
    this.helperBackoffUntil = 0; // RE-croisé (MINEUR backoff) : à l'arrêt, un DERNIER essai gratuit — sinon
                                 // un échec helper < 30 s avant le quit laisse les médias bas des JOURS (filet boot).
    await this.enqueue(async () => {
      const owed = [...(this.duckedEntries ?? []), ...this.pending];
      this.duckedEntries = null;
      if (owed.length) await this.settleRestore(owed, "arrêt");
    });
    this.helperClosed = true;
    const h = this.helper;
    this.helper = null;
    if (h) {
      try { h.stdin?.write(JSON.stringify({ op: "quit" }) + "\n"); } catch { /* */ }
      setTimeout(() => { try { h.kill(); } catch { /* */ } }, 500);
    }
  }

  // ── contrat DuckMixer (fire-and-forget — la policy pilote, le mixer exécute) ──

  duck(): void {
    if (this.stopped) return;
    this.enqueue(async () => {
      if (this.stopped || this.duckedEntries) return; // déjà bas (la policy dé-doublonne ; double défense)
      let snap = await this.opSnap();
      if (snap == null) return; // helper indisponible → loggé, jamais fatal
      snap = this.adoptPending(snap);
      if (!snap.length && !this.pending.length) {
        // rien à baisser (aucun média) — on marque quand même le duck (le re-scan attrapera un média lancé en cours).
        this.duckedEntries = [];
        this.writeRestoreFile([]);
        this.startRescan();
        return;
      }
      // WRITE-AHEAD STRICT : les volumes d'origine (dont la dette pending) sont sur disque AVANT la baisse.
      this.duckedEntries = snap;
      this.writeRestoreFile([...snap, ...this.pending]);
      if (snap.length) {
        await this.opDuck(snap);
        this.log(`mixer : ${snap.length} session(s) baissée(s) ×${this.duckFactor}`);
      }
      this.startRescan();
    });
  }

  restore(): void {
    if (this.stopped) return;
    this.stopRescan();
    this.enqueue(async () => {
      this.stopRescan(); // m4 : un startRescan d'une op duck ENCORE en chaîne au moment de l'appel public
      const entries = this.duckedEntries;
      this.duckedEntries = null;
      const owed = [...(entries ?? []), ...this.pending];
      if (!owed.length) {
        try { fs.rmSync(this.restoreFile); } catch { /* absent */ }
        return;
      }
      await this.settleRestore(owed, "restore");
    });
  }

  /** M3/n12 + RE-croisé (multi-sessions, garde utilisateur) : les sessions d'un snap dont le NOM porte une
   *  DETTE sont ADOPTÉES avec l'origine DU FICHIER — TOUTES les sessions du même exe (le per-app de Windows
   *  est PAR EXE : elles ont toutes reçu le même volume persisté-baissé ; first-wins sur les dettes = l'origine
   *  la plus ancienne) — et SEULEMENT si leur volume actuel ressemble au persisté-baissé (±0,02, NIT-b) :
   *  sinon l'utilisateur a repris la main entre-temps → la dette est SOLDÉE sans toucher son réglage. */
  private adoptPending(snap: DuckEntry[]): DuckEntry[] {
    if (!this.pending.length) return snap;
    const owedByName = new Map<string, DuckEntry>();
    for (const p of this.pending) if (!owedByName.has(p.name)) owedByName.set(p.name, p); // first-wins
    const settled = new Set<string>();
    const out = snap.map((e) => {
      const owed = owedByName.get(e.name);
      if (!owed) return e;
      settled.add(e.name); // une session du nom existe → la dette de ce nom se règle ICI (adoptée ou soldée)
      if (Math.abs(e.vol - owed.vol * this.duckFactor) <= 0.02) {
        this.log(`mixer : session « ${e.name} » ré-apparue → origine reprise du write-ahead (${owed.vol})`);
        return { ...e, vol: owed.vol };
      }
      this.log(`mixer : session « ${e.name} » ré-apparue à un volume RE-RÉGLÉ (${e.vol}) → dette soldée sans toucher`);
      return e;
    });
    if (settled.size) this.pending = this.pending.filter((p) => !settled.has(p.name));
    return out;
  }

  /** M2/M3 — LE règlement honnête d'une dette de restauration : applique ce qui est appariable (pid, sinon
   *  nom), GARDE le reste (`pending` + write-ahead réécrit) — le fichier n'est effacé que RÉCONCILIÉ. Un
   *  helper indisponible → toute la dette survit (filet boot du prochain démarrage). Jamais un succès sur parole. */
  private async settleRestore(owed: DuckEntry[], why: string): Promise<void> {
    const res = await this.opRestore(owed);
    if (res == null) {
      // helper indisponible : la dette ENTIÈRE survit dans le fichier (retentée au prochain boot/duck/stop).
      this.pending = owed;
      this.writeRestoreFile(owed);
      this.log(`mixer : restauration impossible (${why} — helper indisponible) → dette conservée (${owed.length} entrée(s), write-ahead gardé)`);
      return;
    }
    this.pending = res.missing;
    if (res.missing.length) {
      this.writeRestoreFile(res.missing);
      this.log(`mixer : ${res.applied} session(s) restaurée(s) (${why}) · ${res.missing.length} app(s) fermée(s) → dette gardée (réparée à leur retour)`);
    } else {
      try { fs.rmSync(this.restoreFile); } catch { /* absent */ }
      this.log(`mixer : ${res.applied} session(s) restaurée(s) (${why})`);
    }
  }

  // ── re-scan pendant le duck (sessions apparues en pleine conversation) ─────────

  private startRescan(): void {
    this.stopRescan();
    this.rescanTimer = setInterval(() => {
      if (this.rescanQueued) return; // m8 : coalescence — jamais deux ops de re-scan empilées (helper lent)
      this.rescanQueued = true;
      this.enqueue(async () => {
        this.rescanQueued = false;
        if (this.stopped || !this.duckedEntries) {
          this.stopRescan(); // m4 : le duck est fini (restore passé en chaîne) → le timer s'auto-éteint
          return;
        }
        const snap = await this.opSnap();
        if (snap == null) return;
        const known = new Set(this.duckedEntries.map((e) => e.pid));
        let fresh = snap.filter((e) => !known.has(e.pid));
        if (!fresh.length) return;
        fresh = this.adoptPending(fresh); // M3/n12 : sessions ré-apparues d'apps en DETTE → origine du fichier
        // write-ahead d'abord : le fichier s'enrichit AVANT la baisse des nouvelles sessions.
        this.duckedEntries = [...this.duckedEntries, ...fresh];
        this.writeRestoreFile([...this.duckedEntries, ...this.pending]);
        await this.opDuck(fresh);
        this.log(`mixer : ${fresh.length} nouvelle(s) session(s) baissée(s) au vol`);
      });
    }, this.rescanMs);
  }

  private stopRescan(): void {
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = null;
    }
  }

  // ── opérations helper (sérialisées, bornées) ───────────────────────────────────

  /** SNAP : les sessions de rendu candidates (exclusions appliquées), volumes ACTUELS — rien n'est touché. */
  private async opSnap(): Promise<DuckEntry[] | null> {
    const ex = new Set(this.excludePids().filter((p) => Number.isFinite(p) && p > 0));
    ex.add(process.pid); // notre propre process (des sons UI un jour) — jamais baissé
    const only = this.onlyPids ? this.onlyPids().filter((p) => Number.isFinite(p) && p > 0) : [];
    const res = await this.helperJson({ op: "snap", ex: [...ex], exNames: this.excludeNames, only });
    if (res == null) return null;
    if (!res.ok || !Array.isArray(res.entries)) {
      this.log(`mixer snap : ${res.err ?? "réponse inattendue"}`);
      return [];
    }
    return res.entries as DuckEntry[];
  }

  /** DUCK : baisse VIVE à vol×factor, sur la liste EXPLICITE du snap (cohérente avec le write-ahead). */
  private async opDuck(entries: DuckEntry[]): Promise<void> {
    const targets = entries.map((e) => ({ pid: e.pid, vol: Number((e.vol * this.duckFactor).toFixed(4)) }));
    const res = await this.helperJson({ op: "setv", targets });
    if (res != null && !res.ok) this.log(`mixer duck : ${res.err ?? "échec"}`);
  }

  /** RESTORE : repose les volumes d'ORIGINE, en RAMPE douce. Par PID vivant, sinon par NOM (une session du
   *  même exe réapparue — la persistance per-app de Windows lui a resservi le volume baissé). Renvoie le
   *  résultat HONNÊTE (M2/M3) : appliquées + manquantes (app fermée) ; null = helper indisponible. */
  private async opRestore(entries: DuckEntry[]): Promise<{ applied: number; missing: DuckEntry[] } | null> {
    const res = await this.helperJson({ op: "restore", ramp: this.rampMs, entries }, this.opTimeoutMs + this.rampMs);
    if (res == null) return null;
    if (!res.ok) {
      this.log(`mixer restore : ${res.err ?? "échec"}`);
      return null; // une erreur helper = pas de preuve d'application → traiter comme indisponible (dette gardée)
    }
    return {
      applied: typeof res.applied === "number" ? res.applied : 0,
      missing: Array.isArray(res.missing) ? (res.missing as DuckEntry[]) : [],
    };
  }

  // ── plomberie helper (persistant, respawn au besoin, deadline par op) ──────────

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op).catch((e) => this.log(`mixer : ${(e as Error)?.message ?? String(e)}`));
    this.chain = next;
    return next;
  }

  private async ensureHelper(): Promise<boolean> {
    if (this.helper && this.helper.exitCode == null && this.helper.signalCode == null) return true;
    if (this.helperClosed) return false;                 // M2 : seulement APRÈS le restore d'arrêt (stop fin)
    if (Date.now() < this.helperBackoffUntil) return false; // m8 : un spawn/READY raté → pas de tempête de re-spawns
    try {
      const h = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", this.helperScript], {
        windowsHide: true,
      });
      this.helper = h;
      this.buf = "";
      this.waiters = [];
      // SOLO-2 (conv 57) : garde de GÉNÉRATION — une donnée TARDIVE d'un VIEUX helper (tué après un timeout,
      // stdout encore en vol) ne doit jamais polluer le buffer du nouveau (même classe que le battement
      // obsolète #5 du superviseur : re-vérifier l'identité post-await).
      h.stdout?.on("data", (d: Buffer) => { if (this.helper === h) this.onHelperData(String(d)); });
      h.stderr?.on("data", () => { /* drain (borne pipe) — le diagnostic vit dans les réponses OK/ERR */ });
      h.on("exit", () => {
        if (this.helper === h) this.helper = null;
        for (const w of this.waiters.splice(0)) w(null); // les attentes en vol échouent proprement
      });
      h.on("error", () => {
        if (this.helper === h) this.helper = null;
        for (const w of this.waiters.splice(0)) w(null);
      });
      const ready = await this.readLine(20000); // Add-Type compile ~200-400 ms ; 20 s = marge machine chargée
      if (ready !== "READY") {
        this.log(`mixer : helper non prêt (${ready ?? "mort"}) — ducking inactif pour cette op`);
        try { h.kill(); } catch { /* */ }
        if (this.helper === h) this.helper = null;
        this.helperBackoffUntil = Date.now() + 30000; // m8 : pas de re-spawn avant 30 s (PowerShell gelé/AV)
        return false;
      }
      this.helperBackoffUntil = 0;
      return true;
    } catch (e) {
      this.log(`mixer : spawn helper impossible (${(e as Error).message})`);
      this.helper = null;
      this.helperBackoffUntil = Date.now() + 30000; // m8
      return false;
    }
  }

  private onHelperData(d: string): void {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      const w = this.waiters.shift();
      if (w) w(line);
      // ligne orpheline (aucun waiter) : ignorée — le protocole est strictement requête→réponse.
    }
  }

  private readLine(timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        const idx = this.waiters.indexOf(fn);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      const fn = (l: string | null): void => {
        clearTimeout(t);
        resolve(l);
      };
      this.waiters.push(fn);
    });
  }

  /** Une requête JSON → une réponse JSON, bornée. Helper mort → UN respawn puis retente. Null = indisponible
   *  (loggé par l'appelant). Une réponse illisible = null (pas de preuve d'application → dette gardée). */
  private async helperJson(req: Record<string, unknown>, timeoutMs = this.opTimeoutMs): Promise<Record<string, unknown> | null> {
    const line = JSON.stringify(req);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await this.ensureHelper())) return null;
      try {
        this.helper!.stdin!.write(line + "\n");
      } catch {
        // n15 (croisé conv 57) : un stdin cassé sur un helper ENCORE « vivant » (EPIPE) le laisserait « le »
        // helper pour toutes les ops suivantes — on le tue pour que le retry respawne à coup sûr.
        try { this.helper?.kill(); } catch { /* */ }
        this.helper = null;
        continue;
      }
      const resp = await this.readLine(timeoutMs);
      if (resp != null) {
        try {
          return JSON.parse(resp) as Record<string, unknown>;
        } catch {
          this.log(`mixer : réponse helper illisible (${resp.slice(0, 120)})`);
          return null;
        }
      }
      // timeout : helper figé → kill, respawn une fois (patron psRun : jamais suspendu pour toujours).
      this.log("mixer : helper figé (deadline op) → kill + respawn");
      try { this.helper?.kill(); } catch { /* */ }
      this.helper = null;
    }
    return null;
  }

  private writeRestoreFile(entries: DuckEntry[]): void {
    try {
      // n17 (croisé conv 57) : écriture ATOMIQUE (tmp + rename NTFS) — une coupure pendant l'écriture ne
      // laisse jamais un fichier tronqué que le filet boot jetterait (« rien à restaurer de sûr »).
      const tmp = this.restoreFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ ts: Date.now(), entries }));
      fs.renameSync(tmp, this.restoreFile);
    } catch (e) {
      this.log(`mixer : write-ahead impossible (${(e as Error).message}) — je baisse quand même (filet boot inopérant)`);
    }
  }

  private log(l: string): void {
    try {
      this.onLog?.(l);
    } catch {
      /* un logger qui lève ne casse jamais le mixer */
    }
  }
}

// ─── le HELPER PowerShell (constante autonome, écrite dans home/ au start — zéro asset, zéro dépendance) ───
// Protocole : UNE ligne JSON par requête → UNE ligne JSON par réponse (M1 croisé conv 57 — l'ancien protocole
// positionnel cassait sur un nom d'exe à ESPACES ; le détail des ops est commenté en tête du script PS).
// Sessions de RENDU, tous devices ACTIFS, états active+inactive (une inactive peut rejouer en pleine
// conversation → baissée d'avance), sessions expirées ignorées. ASCII pur (PS 5.1 + encodages).
const HELPER_PS1 = String.raw`# duck-helper.ps1 - genere par Sophia (duck-mixer.ts) - NE PAS EDITER (reecrit a chaque demarrage).
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace SophiaDuck
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorCom { }

    internal enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out IMMDeviceCollection ppDevices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, uint role, out IMMDevice ppEndpoint);
        int GetDevice(string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection
    {
        int GetCount(out uint pcDevices);
        int Item(uint nDevice, out IMMDevice ppDevice);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(uint stgmAccess, out IntPtr ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out uint pdwState);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionManager2
    {
        int GetAudioSessionControl(ref Guid AudioSessionGuid, uint StreamFlags, out IAudioSessionControl SessionControl);
        int GetSimpleAudioVolume(ref Guid AudioSessionGuid, uint StreamFlags, out ISimpleAudioVolume AudioVolume);
        int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
        int RegisterSessionNotification(IntPtr SessionNotification);
        int UnregisterSessionNotification(IntPtr SessionNotification);
        int RegisterDuckNotification(string sessionID, IntPtr duckNotification);
        int UnregisterDuckNotification(IntPtr duckNotification);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionEnumerator
    {
        int GetCount(out int SessionCount);
        int GetSession(int SessionCount, out IAudioSessionControl Session);
    }

    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl
    {
        int GetState(out int pRetVal);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int SetDisplayName(string Value, ref Guid EventContext);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int SetIconPath(string Value, ref Guid EventContext);
        int GetGroupingParam(out Guid pRetVal);
        int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        int RegisterAudioSessionNotification(IntPtr NewNotifications);
        int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl2
    {
        int GetState(out int pRetVal);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int SetDisplayName(string Value, ref Guid EventContext);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int SetIconPath(string Value, ref Guid EventContext);
        int GetGroupingParam(out Guid pRetVal);
        int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        int RegisterAudioSessionNotification(IntPtr NewNotifications);
        int UnregisterAudioSessionNotification(IntPtr NewNotifications);
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int GetProcessId(out uint pRetVal);
        [PreserveSig] int IsSystemSoundsSession();
        int SetDuckingPreference(bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ISimpleAudioVolume
    {
        int SetMasterVolume(float fLevel, ref Guid EventContext);
        int GetMasterVolume(out float pfLevel);
        int SetMute(bool bMute, ref Guid EventContext);
        int GetMute(out bool pbMute);
    }

    public class SessionInfo
    {
        public int Pid;
        public string Name;
        public float Vol;
    }

    // Toolhelp32 (kernel32) — la table pid -> ppid en ~1 ms, sans WMI (lent) ni dependance.
    // POURQUOI (mesure conv 57, au juge) : le python.exe d un venv Windows est un LAUNCHER qui spawn le VRAI
    // interpreteur en ENFANT -> la session audio de la bouche appartient a l ENFANT, pas au PID supervise.
    // Exclure un PID doit donc exclure tout son ARBRE de descendance.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    internal static class Native
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);
        [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode)]
        public static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);
        [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode)]
        public static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);
    }

    public static class Mixer
    {
        static readonly Guid IID_SessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
        static Guid _ctx = Guid.Empty;

        // Etend un ensemble de PIDs a toute leur DESCENDANCE (point fixe sur la table pid->ppid).
        // Best-effort : un snapshot impossible -> l ensemble reste tel quel (exclusion minimale, jamais fatal).
        // Un ppid recycle pourrait sur-exclure un process etranger -> SANS DANGER (un media non baisse, jamais
        // l inverse : l exclusion est protectrice).
        public static void ExpandDescendants(HashSet<int> pids)
        {
            if (pids.Count == 0) return;
            var pairs = new List<KeyValuePair<int, int>>(); // (pid, ppid)
            IntPtr snap = Native.CreateToolhelp32Snapshot(0x2, 0); // TH32CS_SNAPPROCESS
            if (snap == IntPtr.Zero || snap == (IntPtr)(-1)) return;
            try
            {
                var e = new PROCESSENTRY32W();
                e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32W));
                if (Native.Process32First(snap, ref e))
                {
                    do { pairs.Add(new KeyValuePair<int, int>((int)e.th32ProcessID, (int)e.th32ParentProcessID)); }
                    while (Native.Process32Next(snap, ref e));
                }
            }
            finally { Native.CloseHandle(snap); }
            bool grew = true;
            while (grew)
            {
                grew = false;
                foreach (var kv in pairs)
                {
                    if (pids.Contains(kv.Value) && !pids.Contains(kv.Key)) { pids.Add(kv.Key); grew = true; }
                }
            }
        }

        static void ForEachSession(Action<int, string, ISimpleAudioVolume> fn)
        {
            var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            IMMDeviceCollection coll;
            en.EnumAudioEndpoints(EDataFlow.eRender, 1, out coll); // DEVICE_STATE_ACTIVE
            uint count;
            coll.GetCount(out count);
            for (uint d = 0; d < count; d++)
            {
                IMMDevice dev;
                coll.Item(d, out dev);
                object mgrObj;
                Guid iid = IID_SessionManager2;
                dev.Activate(ref iid, 1, IntPtr.Zero, out mgrObj);
                var mgr = (IAudioSessionManager2)mgrObj;
                IAudioSessionEnumerator senum;
                mgr.GetSessionEnumerator(out senum);
                int n;
                senum.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    IAudioSessionControl sc;
                    senum.GetSession(i, out sc);
                    var sc2 = (IAudioSessionControl2)sc;
                    int state;
                    sc2.GetState(out state);
                    if (state == 2) continue; // expiree
                    uint pid;
                    sc2.GetProcessId(out pid);
                    string name = "[system]";
                    if (sc2.IsSystemSoundsSession() != 0 && pid > 0)
                    {
                        try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); }
                        catch { name = "(mort)"; }
                    }
                    fn((int)pid, name, (ISimpleAudioVolume)sc);
                }
            }
        }

        public static List<SessionInfo> Snap(HashSet<int> excludePids, HashSet<string> excludeNames, HashSet<int> onlyPids)
        {
            // Hook de TEST (onlyPids non vide) : ciblage EXPLICITE — la liste EST le controle total, les
            // exclusions ne s appliquent pas (les temoins d un e2e sont des ENFANTS du node de test : l
            // expansion d arbre les exclurait — comportement PRODUIT voulu, mais qui viderait le ciblage).
            bool targeted = onlyPids.Count > 0;
            if (!targeted) ExpandDescendants(excludePids); // exclure un PID = exclure son ARBRE (venv launcher -> python reel)
            var seen = new HashSet<int>();
            var list = new List<SessionInfo>();
            ForEachSession((pid, name, vol) =>
            {
                if (targeted)
                {
                    if (!onlyPids.Contains(pid)) return;
                }
                else
                {
                    if (excludePids.Contains(pid)) return;
                    if (excludeNames.Contains(name)) return;
                }
                if (!seen.Add(pid)) return; // une session par process (multi-devices : la premiere trouvee)
                float v;
                vol.GetMasterVolume(out v);
                list.Add(new SessionInfo { Pid = pid, Name = name, Vol = v });
            });
            return list;
        }

        public static float GetByPid(int pid)
        {
            float result = -1f;
            ForEachSession((p, name, vol) =>
            {
                if (p == pid && result < 0f) { float v; vol.GetMasterVolume(out v); result = v; }
            });
            return result;
        }

        public static int SetByPid(Dictionary<int, float> targets)
        {
            int applied = 0;
            ForEachSession((pid, name, vol) =>
            {
                float t;
                if (targets.TryGetValue(pid, out t)) { vol.SetMasterVolume(t, ref _ctx); applied++; }
            });
            return applied;
        }

        // RESTORE en rampe : plusieurs pas vers la cible. Par PID ; un PID mort retombe sur le NOM (la
        // persistance per-app de Windows a pu resservir le volume baisse a une session relancee).
        // M2/M3 (croise conv 57) : les entrees NON APPARIEES (app fermee — ni pid ni nom trouves) sont
        // RENVOYEES dans missing -> Node les GARDE dans le write-ahead (jamais « restaure » sur parole).
        public static int Restore(List<SessionInfo> wanted, int rampMs, List<SessionInfo> missing)
        {
            var byPid = new Dictionary<int, float>();
            var byName = new Dictionary<string, float>();
            foreach (var w in wanted) { byPid[w.Pid] = w.Vol; if (!byName.ContainsKey(w.Name)) byName[w.Name] = w.Vol; }
            var found = new List<KeyValuePair<ISimpleAudioVolume, float>>();
            var matchedPids = new HashSet<int>();
            ForEachSession((pid, name, vol) =>
            {
                float t;
                if (byPid.TryGetValue(pid, out t)) { found.Add(new KeyValuePair<ISimpleAudioVolume, float>(vol, t)); matchedPids.Add(pid); }
            });
            // seconde passe : les cibles dont le PID n'existe plus -> par nom (session relancee du meme exe).
            // RE-croise conv 57 (MINEUR multi-sessions) : le volume per-app de Windows est PAR EXE -> TOUTES
            // les sessions d un meme exe ont recu le meme volume persiste-baisse -> on repare TOUTES les
            // sessions du nom (plus jamais « une remontee, l autre a 20 % et dette soldee »).
            var wantedNames = new HashSet<string>();
            foreach (var w in wanted) if (!matchedPids.Contains(w.Pid)) wantedNames.Add(w.Name);
            var matchedNames = new HashSet<string>();
            if (wantedNames.Count > 0)
            {
                ForEachSession((pid, name, vol) =>
                {
                    float t;
                    if (wantedNames.Contains(name) && byName.TryGetValue(name, out t))
                    {
                        found.Add(new KeyValuePair<ISimpleAudioVolume, float>(vol, t));
                        matchedNames.Add(name); // le nom reste dans wantedNames -> chaque session du nom est reparee
                    }
                });
            }
            // les orphelins (ni pid vivant ni session du meme nom) -> missing (le write-ahead les garde)
            foreach (var w in wanted)
            {
                if (!matchedPids.Contains(w.Pid) && !matchedNames.Contains(w.Name)) missing.Add(w);
            }
            int steps = rampMs > 0 ? 5 : 1;
            int pause = steps > 1 ? rampMs / steps : 0;
            var current = new List<float>();
            foreach (var f in found) { float c; f.Key.GetMasterVolume(out c); current.Add(c); }
            for (int s = 1; s <= steps; s++)
            {
                for (int i = 0; i < found.Count; i++)
                {
                    float target = current[i] + (found[i].Value - current[i]) * s / steps;
                    found[i].Key.SetMasterVolume(target, ref _ctx);
                }
                if (s < steps && pause > 0) System.Threading.Thread.Sleep(pause);
            }
            return found.Count;
        }
    }
}
'@

# M1 (croise conv 57) : le protocole est en JSON — une requete = UNE ligne JSON, une reponse = UNE ligne JSON.
# L ancien protocole positionnel (split espaces + CSV + pipes) CASSAIT sur un nom d exe a ESPACES
# (« Star Wars Battlefront II » -> le RESTORE entier levait -> AUCUNE session restauree, media bas a vie).
# JSON transporte tous les caracteres ; ConvertFrom-Json est natif PS 5.1.
# Requetes : {"op":"ping"} · {"op":"getv","pid":N} · {"op":"snap","ex":[...],"exNames":[...],"only":[...]}
#            {"op":"setv","targets":[{"pid":N,"vol":F},...]} · {"op":"restore","ramp":N,"entries":[{pid,name,vol}...]}
#            {"op":"quit"}
# Reponses : {"ok":true,...} | {"ok":false,"err":"..."}. RESTORE renvoie applied + missing (les entrees NON
# appariees — M2/M3 : Node les GARDE dans le write-ahead, jamais effacees sans preuve).

# RE-croise conv 57 (MINEUR encodage, REPRODUIT) : le pipe PS 5.1 <-> Node est en codepage OEM par defaut ->
# les noms d exe non-ASCII (accents) arrivent MANGES des deux cotes -> le restore PAR NOM ne matche jamais ->
# volume bas a vie pour ces apps. UTF-8 force bilateralement (Node ecrit/lit deja utf8).
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)

$out = [Console]::Out
$out.WriteLine("READY")
$out.Flush()
$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Vol-Str([float]$v) { return $v.ToString("0.####", $inv) }
function Esc-Json([string]$s) { return ($s -replace '\\', '' -replace '"', '' -replace '[\x00-\x1f]', '') }

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    try {
        $req = $line | ConvertFrom-Json
        switch ($req.op) {
            "ping" { $out.WriteLine('{"ok":true,"pong":true}') }
            "getv" {
                $v = [SophiaDuck.Mixer]::GetByPid([int]$req.pid)
                $out.WriteLine('{"ok":true,"vol":' + (Vol-Str $v) + '}')
            }
            "snap" {
                $exPids = New-Object "System.Collections.Generic.HashSet[int]"
                foreach ($p in @($req.ex)) { if ($null -ne $p) { [void]$exPids.Add([int]$p) } }
                $exNames = New-Object "System.Collections.Generic.HashSet[string]"
                foreach ($n in @($req.exNames)) { if ($n) { [void]$exNames.Add(([string]$n).ToLowerInvariant()) } }
                $onlyPids = New-Object "System.Collections.Generic.HashSet[int]"
                foreach ($p in @($req.only)) { if ($null -ne $p) { [void]$onlyPids.Add([int]$p) } }
                $list = [SophiaDuck.Mixer]::Snap($exPids, $exNames, $onlyPids)
                $items = @()
                foreach ($e in $list) {
                    $items += ('{"pid":' + $e.Pid + ',"name":"' + (Esc-Json $e.Name) + '","vol":' + (Vol-Str $e.Vol) + '}')
                }
                $out.WriteLine('{"ok":true,"entries":[' + ($items -join ",") + ']}')
            }
            "setv" {
                $targets = New-Object "System.Collections.Generic.Dictionary[int,float]"
                foreach ($t in @($req.targets)) { $targets[[int]$t.pid] = [float]$t.vol }
                $n = [SophiaDuck.Mixer]::SetByPid($targets)
                $out.WriteLine('{"ok":true,"applied":' + $n + '}')
            }
            "restore" {
                $wanted = New-Object "System.Collections.Generic.List[SophiaDuck.SessionInfo]"
                foreach ($t in @($req.entries)) {
                    $si = New-Object SophiaDuck.SessionInfo
                    $si.Pid = [int]$t.pid
                    $si.Name = [string]$t.name
                    $si.Vol = [float]$t.vol
                    $wanted.Add($si)
                }
                $missing = New-Object "System.Collections.Generic.List[SophiaDuck.SessionInfo]"
                $n = [SophiaDuck.Mixer]::Restore($wanted, [int]$req.ramp, $missing)
                $mi = @()
                foreach ($m in $missing) {
                    $mi += ('{"pid":' + $m.Pid + ',"name":"' + (Esc-Json $m.Name) + '","vol":' + (Vol-Str $m.Vol) + '}')
                }
                $out.WriteLine('{"ok":true,"applied":' + $n + ',"missing":[' + ($mi -join ",") + ']}')
            }
            "quit" { $out.WriteLine('{"ok":true,"bye":true}'); $out.Flush(); exit 0 }
            default { $out.WriteLine('{"ok":false,"err":"op inconnue"}') }
        }
    } catch {
        $msg = Esc-Json ($_.Exception.Message -replace "[\r\n]", " ")
        $out.WriteLine('{"ok":false,"err":"' + $msg + '"}')
    }
    $out.Flush()
}
`;
