// WarmBrain — le CERVEAU CHAUD de dialogue (V7 morceau B ; traduit `plan/05` R4 + la recette conv 44).
//
// Le socle T8 (`ClaudeChannel`) est REQUEST-SCOPED (un `claude -p` relancé par tour) → coincé à froid ~4,5 s
// (spawn+auth re-payés) = une RÉGRESSION de latence vs le banc (mémoire conv44-perf-cerveau-v7). Le banc tenait
// ~2 s chaud avec UN process claude PERSISTANT (stream-json). `plan/05` R4 grave : « le process conversationnel
// maintenu n'est PLUS un simple repli, il est REQUIS pour ne pas régresser » (règle perf ⛔). WarmBrain est ce
// process — mesuré vivant à la barrière b5 (conv 47) : contrat OK, TTFT chaud ~1,3 s, streaming au fil, OAuth Max.
//
// Trois choses le distinguent du T8 request-scoped (le plan l'exige — « câbler = facile, bâcler = non ») :
//   (a) PERSISTANT : un seul process, N tours en flux (`--input-format stream-json`), contexte en MÉMOIRE.
//   (b) CHAT NU : `--system-prompt` REMPLACE le prompt agent + `--strict-mcp-config` + `--tools ""` → 0 MCP / 0 outil
//       pour le DIALOGUE (l'agent outillé T8 reste pour AGIR sur le bureau = invocation SÉPARÉE, « un seul guichet »).
//       Mesuré conv 44 : coupe le TTFT à froid de moitié. L'effort n'affecte PAS le TTFT (choix = sa PENSÉE, `03`).
//   (c) STREAMING : `--include-partial-messages` → chaque `text_delta` remonte AU FIL (onDelta) ; le sidecar (morceau A)
//       accumule + découpe en phrases (on ne pré-découpe PAS ici — les deltas bruts partent tels quels).
//
// Robustesse (fidèle au banc `WarmBrain.ask_stream`) : flux mort/muet AVANT tout delta → REPLI FROID (une invocation
// nu request-scoped) ; mort APRÈS ≥1 delta → on FINIT avec l'acquis (JAMAIS de double-voix) ; respawn au tour suivant.
// Hygiène A1 (jamais une dépense en douce) : `scrubbedEnv` au spawn = garantie PRIMAIRE (liste PARTAGÉE avec T8) +
// défense POSITIVE `apiKeySource!=="none"` à l'init (kill + taint). `--no-session-persistence` : aucun verbatim disque
// (la durabilité `--resume`/A13 = `02`/R5, pas V7 ; les tours vivent en base `conversations`, `02`).
//
// Module Node PUR (capacités injectées, patron Governor/ClaudeChannel) → testable hors Electron via un faux-claude
// PERSISTANT (tests/fake-claude-persistent.mjs). Câblé dans `SophiaRuntime` après PRÊT ; quiescé à l'arrêt (couture ⑩).

import type { ChildProcess } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuditLog } from "../../audit/index.js";
import { resolveClaudeExe, scrubbedEnv } from "../../claude/index.js";
import type { SpawnClaude } from "../../claude/index.js";
import type { SophiaPaths } from "../../paths.js";

/** Persona PLACEHOLDER — ANCRE DE NOM + CANAL (décision Yohann, conv 47, option a du finding b5).
 *  Finding b5 : sans identité du tout, le modèle répondait « je suis Claude, pas Sophia / je n'ai pas de préférences ».
 *  L'ancre minimale « Tu es Sophia » lui rend son NOM (fidélité — elle EST Sophia, ce n'est pas inventer un caractère)
 *  pour que le juge à ta voix (banc de preuve, JAMAIS sa naissance) ne la fasse pas renier son nom. Le reste encadre le
 *  seul MÉDIUM (oral, temps réel). Son VRAI persona I→VI (valeurs, souvenirs, tempérament) = `plan/03`, fait ENSEMBLE,
 *  jamais bâclé ici ; il remplacera ce placeholder via l'option `sysprompt` (injectée par le routeur, morceau C). */
export const VOICE_SYSPROMPT =
  "Tu es Sophia, un assistant vocal francophone chaleureux et vif. Tu parles à l'ORAL, dans une conversation en " +
  "TEMPS RÉEL — pas un exposé. COMMENCE par une phrase courte et directe, développe UNE idée à la fois, puis RENDS " +
  "la parole. JAMAIS de listes, de markdown ni d'émojis : ta réponse est lue à voix haute par une synthèse vocale.";

const DEFAULT_MODEL = "claude-sonnet-4-6"; // décision âme conv 33 (« Sonnet 4.6, pas Sonnet 5 ») ; alias `sonnet` = Sonnet 5.
const DEFAULT_FIRST_DELTA_MS = 15_000;     // pas de 1er delta après ça → le chaud est MUET → repli froid. Conv 48 : la MESURE
//   (headless, chaud sain < 4 s, 0 stall/20 ; froid ~6,7 s) tentait de baisser à ~7 s pour raccourcir l'attente à vide sur un
//   stall. REPORTÉ (design-first) : tant que la mémoire durable (`plan/02` : table `conversations` M0 + re-feed sur respawn M6)
//   ne rend pas un RESPAWN SANS PERTE, tuer le chaud plus tôt = plus de respawns = plus d'AMNÉSIES (« plusieurs conversations »,
//   VU au juge conv 48 : 3 wipes de contexte sous API chargée — le vrai problème, pas la latence). On garde donc GÉNÉREUX (moins
//   de respawns, moins d'amnésies ; Yohann : la latence « ne m'a pas dérangé »). RE-CALIBRER APRÈS 02, quand le respawn re-fera
//   le contexte — alors baisser le seuil devient un gain propre, sans coût mémoire. ⛔ règle perf conv 44.
const DEFAULT_HARD_CAP_MS = 120_000;       // cap absolu d'un tour (un tour cloud tient large ; un claude figé ne bloque jamais).
const DEFAULT_COLD_TIMEOUT_MS = 90_000;    // repli froid : un `claude -p` ponctuel.

/** Le résultat d'un tour. `viaCold` = le chaud était mort/muet → le repli froid a répondu. `aborted` = interrompu
 *  (signal : arrêt/quiesce en V7 ; le barge-in FIN = V8) → la réponse est partielle, VOULUE. `isError` = même le repli
 *  a échoué (le routeur dit une phrase de secours). */
export interface AskResult {
  text: string;
  isError: boolean;
  viaCold: boolean;
  aborted: boolean;
  ttftMs: number | null;
}

export interface AskOptions {
  /** Chaque `text_delta` AU FIL = le CONTENU d'un tour RÉUSSI (le routeur les pousse à `cmd.tts.push` ; le sidecar
   *  découpe en phrases). ⚠️ Sur `isError` (SECOURS), RIEN n'est émis via onDelta → le routeur prononce sa PROPRE
   *  phrase de secours (`03`) à partir de `AskResult.isError`/`text`. Donc : onDelta = voix d'un SUCCÈS ; secours = au routeur. */
  onDelta?: (chunk: string) => void;
  /** Annulation (arrêt/quiesce en V7 ; barge-in fin = V8) → kill du tour, réponse partielle rendue. */
  signal?: AbortSignal;
  /** Pas de 1er delta après ça → repli froid. Défaut `firstDeltaMs`. */
  firstDeltaMs?: number;
  /** Cap absolu du tour. Défaut `hardCapMs`. */
  hardCapMs?: number;
}

export interface WarmBrainOptions {
  paths: SophiaPaths;
  /** Persona = `--system-prompt` (chat nu). Défaut = placeholder canal (voir VOICE_SYSPROMPT + finding b5). */
  sysprompt?: string;
  model?: string;
  /** Effort de RAISONNEMENT (`--effort`) — n'affecte PAS le TTFT (conv 44) ; choix de sa PENSÉE (`03`). Défaut = défaut CLI. */
  effort?: string;
  /** cwd NEUTRE du process (pas de CLAUDE.md projet). Défaut = <tmp>/sophia-brain-warm. */
  cwd?: string;
  /** COUTURE : lance claude (persistant OU one-shot selon les args). Défaut = claude.exe réel. Test = faux-claude persistant. */
  spawnClaude?: SpawnClaude;
  firstDeltaMs?: number;
  hardCapMs?: number;
  coldTimeoutMs?: number;
  onLog?: (l: string) => void;
  /** `rate_limit_event` (throttle) → détecteur `05` / gouverneur (comme T8). */
  onThrottle?: (status: string) => void;
  now?: () => number;
}

/** Sentinelle interne : le chaud n'a rien produit (mort/muet/A1 avant tout delta) → l'appelant bascule au repli froid. */
class WarmUnavailable extends Error {}

/** État d'un tour EN VOL (un seul à la fois — le routeur attend chaque `ask` avant le suivant). */
interface TurnCtx {
  accum: string;
  onDelta?: (c: string) => void;
  t0: number;
  ttftMs: number | null;
  settled: boolean;
  resolve: (r: AskResult) => void;
  reject: (e: Error) => void;
  firstDeltaTimer: NodeJS.Timeout | null;
  hardCapTimer: NodeJS.Timeout | null;
  hardCapMs: number;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class WarmBrain {
  private readonly audit: AuditLog;
  private readonly sysprompt: string;
  private readonly model: string;
  private readonly effort?: string;
  private readonly cwd: string;
  private readonly spawnClaude: SpawnClaude;
  private readonly firstDeltaMs: number;
  private readonly hardCapMs: number;
  private readonly coldTimeoutMs: number;
  private readonly onLog?: (l: string) => void;
  private readonly onThrottle?: (status: string) => void;
  private readonly nowFn: () => number;

  private proc: ChildProcess | null = null;
  private stdoutBuf = "";
  private turn: TurnCtx | null = null;
  /** A1 : un provider NON-OAuth a été vu à l'init → le chaud est DÉFINITIVEMENT écarté (jamais une dépense en douce). */
  private tainted = false;
  private stopped = false;
  /** Nombre de spawns du process chaud PERSISTANT (pas le froid). Observable en test pour PROUVER F3 (le respawn eager
   *  après un repli froid : sans lui, ce compteur ne monterait qu'au tour SUIVANT — le test 20 MORD sur ça). */
  private _spawns = 0;
  /** Sérialise les tours : UN SEUL `ask` en vol à la fois → jamais deux messages user entremêlés sur le stdin persistant
   *  (double-voix / tour orphelin). Le routeur séquence déjà ; ceci est le FILET de robustesse (F-SOLO-1, conv 47). */
  private chain: Promise<unknown> = Promise.resolve();
  /** Les invocations FROIDES en vol (process SÉPARÉS, hors `this.proc`) → tuées par `close()` : jamais un claude orphelin
   *  à l'arrêt si un repli froid était en cours (F-SOLO-3, conv 47). */
  private readonly coldChildren = new Set<ChildProcess>();

  constructor(opts: WarmBrainOptions) {
    this.audit = new AuditLog(opts.paths.audit);
    this.sysprompt = opts.sysprompt ?? VOICE_SYSPROMPT;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.effort = opts.effort;
    this.cwd = opts.cwd ?? path.join(os.tmpdir(), "sophia-brain-warm");
    this.spawnClaude = opts.spawnClaude ?? defaultSpawnClaude();
    this.firstDeltaMs = opts.firstDeltaMs ?? DEFAULT_FIRST_DELTA_MS;
    this.hardCapMs = opts.hardCapMs ?? DEFAULT_HARD_CAP_MS;
    this.coldTimeoutMs = opts.coldTimeoutMs ?? DEFAULT_COLD_TIMEOUT_MS;
    this.onLog = opts.onLog;
    this.onThrottle = opts.onThrottle;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  private log(l: string): void { this.onLog?.(l); }
  private now(): number { return this.nowFn(); }
  private alive(): boolean { return this.proc !== null && this.proc.exitCode === null && !this.proc.killed; }
  /** Test-observable (B2/F3, re-croisé conv 47) : nombre de spawns du CHAUD persistant (le froid ne compte pas). */
  get spawns(): number { return this._spawns; }

  /** Allume le chaud + (option) paie l'allumage par un tour jetable → le 1ᵉʳ vrai tour est déjà chaud. Idempotent.
   *  L'appelant (SophiaRuntime) l'appelle après PRÊT ; un échec ne fait pas tomber le boot (elle vit, repli froid). */
  async prewarm(): Promise<void> {
    if (this.stopped || this.tainted) return;
    // F5/R2 (croisé conv 47) : passer par ask() (la chaîne F-SOLO-1) → JAMAIS concurrent d'un vrai tour (un prewarm
    // « au retour » gouverné, morceau C, ne doit pas écraser `this.turn` d'un tour en vol). Le repli froid est toléré
    // (F3 rallume le chaud ensuite). Un échec n'est jamais fatal (au pire le 1er vrai tour paie le froid).
    try { await this.ask("Bonjour, es-tu prête ? Réponds juste « Oui. »"); } catch { /* jamais fatal */ }
  }

  /**
   * UN tour de dialogue. Tente le CHAUD ; si le chaud n'a RIEN produit (mort/muet/A1 avant tout delta), bascule au
   * REPLI FROID. Ne REJETTE jamais vers le routeur (il doit toujours pouvoir parler) : au pire `isError:true` + une
   * réponse de secours. SÉRIALISÉ (F-SOLO-1) : un seul tour à la fois — un `ask` concurrent ATTEND le précédent
   * (jamais deux messages entremêlés → jamais de double-voix). Le routeur séquence déjà ; ceci est le filet.
   */
  ask(text: string, opts: AskOptions = {}): Promise<AskResult> {
    const run = (): Promise<AskResult> => this.runAsk(text, opts);
    const p = this.chain.then(run, run); // enchaîne quel que soit le sort du tour précédent
    this.chain = p.then(() => undefined, () => undefined); // la chaîne ne rejette jamais (ne casse pas les tours suivants)
    return p;
  }

  private async runAsk(text: string, opts: AskOptions = {}): Promise<AskResult> {
    if (this.stopped) return { text: "", isError: true, viaCold: false, aborted: true, ttftMs: null };
    // A-NIT-1 (re-croisé conv 47) : signal DÉJÀ aborté à l'entrée → rendre tout de suite, sans spawner (ni chaud ni froid).
    if (opts.signal?.aborted) return { text: "", isError: false, viaCold: false, aborted: true, ttftMs: null };
    if (!this.tainted) {
      try {
        return await this.askWarm(text, opts);
      } catch (e) {
        if (!(e instanceof WarmUnavailable)) {
          // Erreur inattendue du chemin chaud : on ne tombe pas, on tente le froid (robustesse — jamais muette).
          this.log(`WarmBrain : chaud en erreur (${(e as Error).message}) → repli froid`);
        }
      }
    }
    return this.askCold(text, opts);
  }

  // ── Le chaud (process persistant) ───────────────────────────────────────────
  private askWarm(text: string, opts: AskOptions): Promise<AskResult> {
    this.ensureSpawned();
    if (this.tainted || !this.alive() || !this.proc?.stdin?.writable) {
      throw new WarmUnavailable("chaud indisponible");
    }
    const proc = this.proc;
    return new Promise<AskResult>((resolve, reject) => {
      const firstDeltaMs = opts.firstDeltaMs ?? this.firstDeltaMs;
      const ctx: TurnCtx = {
        accum: "", onDelta: opts.onDelta, t0: this.now(), ttftMs: null, settled: false,
        resolve, reject, firstDeltaTimer: null, hardCapTimer: null,
        hardCapMs: opts.hardCapMs ?? this.hardCapMs, signal: opts.signal,
      };
      this.turn = ctx;

      // Pas de 1er delta à temps → le chaud est MUET : on le TUE (figé) et on bascule au froid.
      ctx.firstDeltaTimer = setTimeout(() => {
        if (ctx.settled) return;
        this.log("WarmBrain : chaud muet (aucun delta) → kill + repli froid");
        this.killProc();
        this.settleWarm(ctx, null); // null = rien produit → WarmUnavailable → froid
      }, firstDeltaMs);

      // NIT-R5 (croisé conv 47) : signal DÉJÀ aborté → régler tout de suite, SANS écrire un message gaspillé sur le stdin
      // du persistant (qui aurait pollué son contexte + serait tué juste après).
      if (ctx.signal?.aborted) { queueMicrotask(() => this.abortWarm(ctx)); return; }
      if (ctx.signal) { ctx.onAbort = () => this.abortWarm(ctx); ctx.signal.addEventListener("abort", ctx.onAbort, { once: true }); }

      try {
        proc.stdin!.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
      } catch (e) {
        this.settleWarm(ctx, null); // stdin cassé → froid
        this.log(`WarmBrain : écriture stdin échouée (${(e as Error).message})`);
        return;
      }
    });
  }

  /** Allume le process persistant (nu + streaming) s'il n'est pas vivant. Pose les handlers UNE fois par spawn. */
  private ensureSpawned(): void {
    if (this.stopped || this.tainted || this.alive()) return;
    try { fsMkdir(this.cwd); } catch { /* best-effort */ }
    const args = [
      "-p", "--input-format", "stream-json", "--output-format", "stream-json",
      "--verbose", "--include-partial-messages",
      "--system-prompt", this.sysprompt, "--strict-mcp-config", "--tools", "",
      "--no-session-persistence", "--model", this.model,
    ];
    if (this.effort) args.push("--effort", this.effort);
    let child: ChildProcess;
    try {
      child = this.spawnClaude(args, { cwd: this.cwd, env: scrubbedEnv(process.env) }); // A1 : env SCRUBBÉ (garantie primaire)
    } catch (e) {
      this.log(`WarmBrain : spawn du chaud impossible (${(e as Error).message}) — repli froid`);
      this.proc = null;
      return;
    }
    this.proc = child;
    this.stdoutBuf = "";
    this._spawns++;
    try { this.audit.append({ evt: "warm.spawned", ts: this.now() }); } catch { /* l'audit ne fait jamais tomber */ }

    // APPARTENANCE (MAJEUR-R1, croisé conv 47) : les TROIS handlers se gardent sur `this.proc === child`. Un child PÉRIMÉ
    // (déjà remplacé par un respawn après un kill/abort) ne doit JAMAIS régler le tour courant ni injecter son stdout
    // résiduel dedans — sinon l'`exit` tardif de l'ancien process force le tour du NOUVEAU au froid (ou pire, sa queue
    // stdout entre dans le TTS du tour courant). Le patron T8 (request-scoped, closures locales) y échappe gratuitement ;
    // le process PERSISTANT (état `this.turn`/`this.stdoutBuf` partagé entre les spawns) exige la garde. Reproduit (test 16).
    child.on("error", (e: Error) => {
      if (this.proc !== child) return;
      this.proc = null;
      const ctx = this.turn;
      if (ctx && !ctx.settled) this.settleWarm(ctx, ctx.accum ? ctx.accum : null); // acquis → partiel ; rien → froid
      this.log(`WarmBrain : erreur du process chaud (${e.message})`);
    });
    child.on("exit", () => {
      // Mort du process (EOF) : si un tour est en vol → partiel (acquis) sinon froid ; le prochain tour respawnera.
      if (this.proc !== child) return;
      this.proc = null;
      const ctx = this.turn;
      if (ctx && !ctx.settled) this.settleWarm(ctx, ctx.accum ? ctx.accum : null);
    });
    child.stderr?.on("data", (d: Buffer) => { void d; }); // draine stderr (jamais de blocage de pipe) ; borne implicite (ignoré)
    child.stdout?.on("data", (d: Buffer) => {
      if (this.proc !== child) return; // stdout résiduel d'un process périmé → jamais injecté dans le tour courant
      this.stdoutBuf += d.toString();
      let idx: number;
      while ((idx = this.stdoutBuf.indexOf("\n")) >= 0) {
        const line = this.stdoutBuf.slice(0, idx);
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        this.handleLine(line);
      }
    });
  }

  /** Parse UNE ligne stream-json du chaud (tolérante). Route vers le tour en vol ; l'init (A1) et le throttle sont
   *  traités même hors tour. */
  private handleLine(line: string): void {
    const t = line.trim();
    if (!t) return;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(t) as Record<string, unknown>; }
    catch { return; } // ligne illisible ignorée (jamais fatale)
    const type = ev.type as string | undefined;

    if (type === "system" && ev.subtype === "init") {
      // Défense POSITIVE A1 (complète le scrub) : une source d'auth ≠ "none" = provider payant → on ÉCARTE le chaud
      // AVANT toute génération (kill + taint DÉFINITIF). Un champ absent ne s'auto-coupe pas (fail-open : le scrub porte).
      const aks = ev.apiKeySource;
      if (typeof aks === "string" && aks !== "none") {
        this.tainted = true;
        try { this.audit.append({ evt: "warm.a1", ts: this.now() }); } catch { /* */ }
        this.log(`WarmBrain : provider non-OAuth à l'init (apiKeySource=${aks}) → chaud écarté (A1), dialogue en repli froid`);
        this.killProc();
        const ctx = this.turn;
        if (ctx && !ctx.settled) this.settleWarm(ctx, null); // rien produit → froid (qui refusera aussi, honnêtement)
      }
      return;
    }
    if (type === "rate_limit_event") {
      const info = (ev.rate_limit_info as { status?: string } | undefined) ?? {};
      if (info.status && info.status !== "allowed") { try { this.onThrottle?.(info.status); } catch { /* */ } }
      return;
    }

    const ctx = this.turn;
    if (!ctx || ctx.settled) return; // hors tour (ou tour déjà réglé) : rien d'autre à faire

    if (type === "stream_event") {
      const sub = (ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined) ?? {};
      if (sub.type === "content_block_delta" && sub.delta?.type === "text_delta") {
        const piece = sub.delta.text ?? "";
        if (piece) {
          if (ctx.ttftMs === null) {
            ctx.ttftMs = this.now() - ctx.t0;
            if (ctx.firstDeltaTimer) { clearTimeout(ctx.firstDeltaTimer); ctx.firstDeltaTimer = null; }
            // 1er delta reçu : arme le cap absolu (un tour très long finit par être coupé, jamais infini).
            ctx.hardCapTimer = setTimeout(() => {
              if (ctx.settled) return;
              this.log("WarmBrain : cap de tour atteint → kill + réponse partielle");
              this.killProc();
              this.settleWarm(ctx, ctx.accum || null);
            }, ctx.hardCapMs);
          }
          ctx.accum += piece;
          try { ctx.onDelta?.(piece); } catch (e) { this.log(`WarmBrain onDelta: ${(e as Error).message}`); }
        }
      }
      return;
    }
    if (type === "result") {
      // Fin du tour : si des deltas ont coulé → l'acquis ; sinon repli sur le champ `result` entier (filet drapeau ignoré).
      // F-SOLO-2 : sur `is_error`, NE JAMAIS lire à voix haute le message d'erreur du modèle → l'acquis (deltas) OU rien
      // (rien → froid, qui retentera ; jamais une erreur interne prononcée).
      const isErr = ev.is_error === true;
      const resultText = typeof ev.result === "string" ? ev.result : "";
      const text = ctx.accum || (isErr ? "" : resultText);
      // F2 (croisé conv 47) : `onDelta` porte la VOIX d'un tour RÉUSSI (AskResult.text = le record `02`) ; une phrase de
      // SECOURS (isError) n'y passe PAS — le routeur la prononce lui-même (`03`). Filet « result sans partial » : un tour
      // réussi sans delta streamé → pousser le texte via onDelta → aucun SUCCÈS jamais MUET (jamais re-dit : streaming ⇒ ttftMs≠null).
      if (text && ctx.ttftMs === null) {
        ctx.ttftMs = this.now() - ctx.t0;
        try { ctx.onDelta?.(text); } catch (e) { this.log(`WarmBrain onDelta: ${(e as Error).message}`); }
      }
      this.settleWarm(ctx, text || null, { isError: isErr });
    }
  }

  /** Règle un tour chaud UNE fois. `text=null` → rien produit → WarmUnavailable (bascule froid). Sinon → succès (partiel
   *  ou complet), viaCold=false. Nettoie timers/signal/tour. */
  private settleWarm(ctx: TurnCtx, text: string | null, extra: { isError?: boolean; aborted?: boolean } = {}): void {
    if (ctx.settled) return;
    ctx.settled = true;
    if (ctx.firstDeltaTimer) clearTimeout(ctx.firstDeltaTimer);
    if (ctx.hardCapTimer) clearTimeout(ctx.hardCapTimer);
    if (ctx.signal && ctx.onAbort) ctx.signal.removeEventListener("abort", ctx.onAbort);
    if (this.turn === ctx) this.turn = null;
    if (text === null) { ctx.reject(new WarmUnavailable("chaud sans réponse")); return; }
    ctx.resolve({ text, isError: extra.isError === true, viaCold: false, aborted: extra.aborted === true, ttftMs: ctx.ttftMs });
  }

  /** Signal reçu (arrêt/quiesce en V7) : on stoppe la génération (kill du process figé) et on rend l'ACQUIS (voulu). */
  private abortWarm(ctx: TurnCtx): void {
    if (ctx.settled) return;
    this.killProc();
    this.settleWarm(ctx, ctx.accum, { aborted: true }); // accum "" reste valide (aborted) — pas de froid sur un abort volontaire
  }

  // ── Le repli froid (invocation nu request-scoped) ───────────────────────────
  /** Un `claude -p` NU ponctuel (froid), streamé aussi (mêmes flags nu, sans `--input-format`, prompt en argument).
   *  Ne rejette JAMAIS vers le routeur : au pire une phrase de secours + isError. Puis le prochain `ask` respawnera le chaud. */
  private askCold(text: string, opts: AskOptions): Promise<AskResult> {
    if (this.stopped) return Promise.resolve({ text: "", isError: true, viaCold: true, aborted: true, ttftMs: null }); // NIT-R4 : jamais de spawn après close()
    const args = [
      "-p",
      "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--system-prompt", this.sysprompt, "--strict-mcp-config", "--tools", "",
      "--no-session-persistence", "--model", this.model,
    ];
    if (this.effort) args.push("--effort", this.effort);
    args.push(text); // prompt = dernier argument

    return new Promise<AskResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnClaude(args, { cwd: this.cwd, env: scrubbedEnv(process.env) });
      } catch (e) {
        this.log(`WarmBrain : repli froid impossible (${(e as Error).message})`);
        resolve({ text: SECOURS_TEXT, isError: true, viaCold: true, aborted: false, ttftMs: null });
        return;
      }
      this.coldChildren.add(child); // F-SOLO-3 : suivi → tué par close() si en vol à l'arrêt (jamais un claude orphelin)
      // Mode texte (prompt en argument) : stdin FERMÉ tout de suite → évite l'attente 3 s mesurée au banc T8.
      try { child.stdin?.end(); } catch { /* */ }
      try { this.audit.append({ evt: "warm.cold", ts: this.now() }); } catch { /* */ }
      const t0 = this.now();
      let buf = "", accum = "", ttft: number | null = null, settled = false, a1 = false, resultText = "";
      let isError = false, wasAborted = false;
      const done = (): void => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        if (opts.signal && onAbort) opts.signal.removeEventListener("abort", onAbort);
        this.coldChildren.delete(child);
        // F3 (croisé conv 47) : rallumer le chaud pour le tour SUIVANT (fidélité banc `_cold` finally) — l'allumage
        // chevauche le temps de réflexion, le prochain tour ne repaie pas le boot inline. Jamais si arrêté/taché (A1).
        if (!this.stopped && !this.tainted) this.ensureSpawned();
        // F4 (croisé conv 47) : interrompu (quiesce/arrêt) → réponse partielle VOULUE, jamais SECOURS (cohérence de contrat, mordra en V8).
        if (wasAborted) { resolve({ text: accum, isError: false, viaCold: true, aborted: true, ttftMs: ttft }); return; }
        // F-SOLO-2 : sur is_error, ne pas lire le message d'erreur → l'acquis (deltas) OU secours.
        const text2 = accum || (isError ? "" : resultText);
        if (a1) { resolve({ text: SECOURS_TEXT, isError: true, viaCold: true, aborted: false, ttftMs: null }); return; }
        if (!text2) { resolve({ text: SECOURS_TEXT, isError: true, viaCold: true, aborted: false, ttftMs: ttft }); return; }
        // F2 (croisé conv 47) : filet froid — si rien n'a été streamé, pousser le texte via onDelta (canal unique voix).
        if (ttft === null) { ttft = this.now() - t0; try { opts.onDelta?.(text2); } catch { /* */ } }
        resolve({ text: text2, isError, viaCold: true, aborted: false, ttftMs: ttft });
      };
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } done(); }, this.coldTimeoutMs);
      const onAbort = opts.signal ? (): void => { wasAborted = true; try { child.kill("SIGKILL"); } catch { /* */ } done(); } : undefined;
      if (opts.signal && onAbort) { if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener("abort", onAbort, { once: true }); }

      child.on("error", (e: Error) => { this.log(`WarmBrain froid : ${e.message}`); done(); });
      child.stderr?.on("data", (d: Buffer) => { void d; });
      child.stdout?.on("data", (d: Buffer) => {
        buf += d.toString();
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          const type = ev.type as string | undefined;
          if (type === "system" && ev.subtype === "init") {
            const aks = ev.apiKeySource;
            if (typeof aks === "string" && aks !== "none") { a1 = true; try { child.kill("SIGKILL"); } catch { /* */ } this.tainted = true; done(); }
          } else if (type === "stream_event") {
            const sub = (ev.event as { type?: string; delta?: { type?: string; text?: string } } | undefined) ?? {};
            if (sub.type === "content_block_delta" && sub.delta?.type === "text_delta") {
              const piece = sub.delta.text ?? "";
              if (piece) { if (ttft === null) ttft = this.now() - t0; accum += piece; try { opts.onDelta?.(piece); } catch { /* */ } }
            }
          } else if (type === "result") {
            resultText = typeof ev.result === "string" ? ev.result : "";
            isError = ev.is_error === true;
            done();
          }
        }
      });
      child.on("exit", () => done()); // mort sans result → done (secours si rien)
    });
  }

  private killProc(): void {
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    try { p.stdin?.end(); } catch { /* */ }
    try { p.kill("SIGKILL"); } catch { /* déjà parti */ }
  }

  /** Quiesce ⑩ (couture d'arrêt, symétrique de `stopChannel`) : tue le chaud, règle un tour en vol comme « abort ».
   *  Idempotent. Léger (d'ordinaire rien en vol). */
  close(): void {
    this.stopped = true;
    const ctx = this.turn;
    if (ctx && !ctx.settled) this.settleWarm(ctx, ctx.accum, { aborted: true });
    this.killProc();
    // F-SOLO-3 : tuer aussi un repli FROID en vol (process séparé) — jamais un claude orphelin à l'arrêt.
    for (const c of this.coldChildren) { try { c.kill("SIGKILL"); } catch { /* déjà parti */ } }
    this.coldChildren.clear();
    try { this.audit.append({ evt: "warm.stopped", ts: this.now() }); } catch { /* l'audit ne fait jamais tomber l'arrêt */ }
  }
}

/** Phrase de secours quand MÊME le repli froid échoue (jamais un silence — elle dit qu'elle n'a pas pu). Placeholder
 *  neutre (le contenu final = personnalité `03`). */
const SECOURS_TEXT = "Désolée, je n'ai pas réussi à répondre là, tout de suite.";

function defaultSpawnClaude(): SpawnClaude {
  return (args, opts) => nodeSpawn(resolveClaudeExe(), args, {
    cwd: opts.cwd, env: opts.env, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"], // stdin OUVERT (mode persistant : on écrit les tours) ; stderr drainé
  });
}

function fsMkdir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
