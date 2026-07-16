// Instance unique (socle T5, Phase 0) — traduit technique/00 §4.1 Phase 0.
//
// « Sophia possède micro/GPU/gouverneur ; deux instances => conflit + consolidations concurrentes =
// corruption » (technique/00 §5, l'invariant le plus dur du socle). Deux instances ne doivent JAMAIS
// coexister sur une même maison, et une Sophia ne doit JAMAIS refuser de démarrer à tort.
//
// POURQUOI UN NAMED PIPE ET PAS UN LOCKFILE-PID
// Un lockfile portant un PID rejouerait le trou M2 de conv 34 (recyclage de PID) — avec une asymétrie
// PIRE : croire à tort qu'un primaire vit => Sophia ne démarre PLUS JAMAIS (elle meurt en silence) ;
// croire à tort qu'il est mort => DEUX instances => corruption. Les deux erreurs sont graves, donc il
// faut une identification POSITIVE du propriétaire, pas une heuristique.
// Le pipe la donne : c'est l'OS qui arbitre, et il libère le pipe à la mort du process — MÊME sur
// SIGKILL (mesuré au banc conv 35 : EADDRINUSE cross-process tant que le holder vit, listen OK ~300 ms
// après son SIGKILL). Zéro faux positif de recyclage. Et le canal de focus vient gratuitement avec.
//
// Le lockfile ne subsiste que comme AUXILIAIRE : il n'arbitre rien, il sert à identifier le primaire
// FIGÉ (pipe tenu mais muet) pour pouvoir le récupérer.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export type AcquireOutcome =
  | { kind: "PRIMARY"; release: () => void }        // le verrou est à nous : on est Sophia
  | { kind: "SECONDARY_FOCUSED" }                   // un primaire sain existe -> il a pris le focus, on sort
  | { kind: "BLOCKED"; reason: string };            // primaire figé irrécupérable -> sortir + ALERTE (jamais 2 instances)

export interface AcquireOptions {
  pipe: string;
  lockfile: string;
  /** Appelé chez le PRIMAIRE quand une 2e instance demande le focus (Electron: win.show/focus). */
  onFocusRequested?: () => void;
  /** Délai d'attente d'UN ack de focus. */
  focusAckTimeoutMs?: number;
  /** Nombre de demandes de focus avant de conclure « figé ». Voir requestFocusInsistently. */
  focusAttempts?: number;
  /** Après avoir tué un primaire figé : nombre de tentatives de reprise du pipe, et délai entre elles.
   *  L'OS libère le pipe de façon ASYNCHRONE (mesuré ~300 ms, mais c'est une limite, pas une garantie),
   *  d'où un budget borné plutôt qu'un `sleep` fixe unique (R3, croisé conv 35). */
  reclaimAttempts?: number;
  reclaimDelayMs?: number;
  onLog?: (line: string) => void;
  /** Couture de test : lit le nom d'image d'un PID (défaut = tasklist). */
  imageNameOf?: (pid: number) => string | null;
  /** Couture de test : le PID est-il vivant ? (défaut = process.kill(pid, 0)). */
  isAlive?: (pid: number) => boolean;
}

const FOCUS_ACK = "sophia-focus-ack";

export function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // existe mais sans permission = vivant
  }
}

/** Nom d'image (exécutable) d'un PID via tasklist, en minuscules, ou null. (Patron T3.) */
export function defaultImageNameOf(pid: number): string | null {
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    const m = out.match(/^"([^"]+)"/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

interface LockInfo { pid: number; image: string; }

function readLockfile(p: string): LockInfo | null {
  try {
    const parts = fs.readFileSync(p, "utf8").trim().split(/\s+/);
    const pid = parseInt(parts[0], 10);
    const image = (parts[1] ?? "").toLowerCase();
    if (!Number.isFinite(pid) || pid <= 0 || !image) return null;
    return { pid, image };
  } catch {
    return null;
  }
}

/**
 * Le lockfile est AUXILIAIRE : il n'arbitre rien (c'est le pipe qui arbitre). Un échec d'écriture ne
 * doit donc JAMAIS faire échouer l'acquisition — sinon une exception ici laisserait le serveur pipe
 * ouvert derrière elle, et une reprise trouverait le verrou tenu... par nous-mêmes : Sophia refuserait
 * de démarrer à cause de son propre verrou. On perd seulement la possibilité d'être RÉCUPÉRÉ si on
 * fige plus tard — ça se dit, ça ne bloque pas.
 */
function writeLockfile(p: string, log?: (l: string) => void): void {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${process.pid} ${path.basename(process.execPath).toLowerCase()}`);
  } catch (e) {
    log?.(`lockfile non écrit (${(e as Error).message}) : si je fige, je ne serai pas récupérable automatiquement`);
  }
}

/** Tente de tenir le pipe. Résout le serveur, ou null si EADDRINUSE (quelqu'un le tient). */
function tryListen(pipe: string, onConn: (s: net.Socket) => void): Promise<net.Server | null> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer(onConn);
    const onErr = (e: NodeJS.ErrnoException): void => {
      if (e.code === "EADDRINUSE") { resolve(null); return; }
      reject(e);
    };
    srv.once("error", onErr);
    srv.listen(pipe, () => {
      srv.removeListener("error", onErr);
      srv.on("error", () => { /* pipe cassé après coup : ne fait pas tomber l'orchestrateur */ });
      resolve(srv);
    });
  });
}

/**
 * `tryListen` avec quelques tentatives rapides sur EADDRINUSE TRANSITOIRE. Un EADDRINUSE persistant =
 * un vrai détenteur (on rendra null pour passer au focus). Mais un EADDRINUSE FUGACE — pipe en cours de
 * libération par un primaire qui vient de mourir, ou notre propre `release()` dont le `close()` est
 * asynchrone (NIT conv 35) — ne doit pas être pris pour un détenteur : un court retry le distingue.
 */
async function tryListenBriefly(
  pipe: string, onConn: (s: net.Socket) => void, attempts: number, delayMs: number,
): Promise<net.Server | null> {
  for (let i = 0; i < attempts; i++) {
    const srv = await tryListen(pipe, onConn);
    if (srv) return srv;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

/** Une demande de focus. true = ack reçu ; false = muet dans le délai. */
function requestFocusOnce(pipe: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean): void => { if (!done) { done = true; resolve(v); } };
    const c = net.createConnection(pipe);
    const timer = setTimeout(() => { c.destroy(); finish(false); }, timeoutMs);
    c.on("data", (d) => {
      clearTimeout(timer);
      c.end();
      finish(String(d).includes(FOCUS_ACK));
    });
    c.on("error", () => { clearTimeout(timer); finish(false); }); // pipe fantôme / primaire mourant
  });
}

/**
 * Demande le focus PLUSIEURS fois avant de conclure « figé ».
 *
 * Un seul timeout ne suffit pas à distinguer FIGÉ de simplement OCCUPÉ : node:sqlite est SYNCHRONE —
 * pendant qu'un primaire ouvre sa base, rejoue un gros WAL ou passe la porte d'intégrité, son event
 * loop est bloqué et il n'acquitte pas. Si Yohann lance Sophia deux fois de suite (double-clic), la 2e
 * instance conclurait « figé » et TUERAIT une Sophia parfaitement saine en plein boot.
 * Un occupé finit par répondre ; un figé ne répond jamais. On insiste donc, et on ne paie l'attente
 * que dans le cas rare où le primaire est réellement muet.
 */
async function requestFocusInsistently(pipe: string, timeoutMs: number, attempts: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await requestFocusOnce(pipe, timeoutMs)) return true;
    if (i < attempts - 1) await sleep(timeoutMs);
  }
  return false;
}

/**
 * Récupération d'un primaire FIGÉ (technique/00 §4.1 Phase 0 : « récupération d'un primaire figé,
 * sonde process.kill(pid,0) »).
 *
 * FAIL-SAFE, patron M2 de conv 34 : on ne tue QUE sur une identité prouvée — lockfile lisible + PID
 * vivant + nom d'image concordant. Sans identité connue, on S'ABSTIENT (plutôt une gêne qu'un
 * innocent tué). L'asymétrie est assumée : un refus de démarrer se voit et se dit ; un process
 * étranger tué ne se répare pas.
 */
function recoverFrozenPrimary(o: Required<Pick<AcquireOptions, "lockfile">> & AcquireOptions): { killed: boolean; reason: string } {
  const isAlive = o.isAlive ?? defaultIsAlive;
  const imageNameOf = o.imageNameOf ?? defaultImageNameOf;

  const info = readLockfile(o.lockfile);
  if (!info) return { killed: false, reason: "primaire figé mais lockfile absent/illisible -> identité inconnue, on s'abstient" };
  if (info.pid === process.pid) return { killed: false, reason: "le lockfile désigne CE process -> on ne se tue pas" };
  if (!isAlive(info.pid)) return { killed: false, reason: `primaire pid=${info.pid} déjà mort (pipe fantôme ?)` };
  const image = imageNameOf(info.pid);
  if (image === null) return { killed: false, reason: `nom d'image du pid=${info.pid} illisible -> on s'abstient` };
  if (image !== info.image) {
    return { killed: false, reason: `pid=${info.pid} porte « ${image} » ≠ « ${info.image} » attendu -> PID recyclé, on s'abstient (M2)` };
  }
  try {
    process.kill(info.pid, "SIGKILL");
    return { killed: true, reason: `primaire figé pid=${info.pid} (${image}) tué -> récupération` };
  } catch (e) {
    return { killed: false, reason: `kill du pid=${info.pid} impossible : ${(e as Error).message}` };
  }
}

/**
 * Acquiert le droit d'être LA Sophia de cette maison.
 * - pipe libre            -> PRIMARY
 * - pipe tenu + ack       -> SECONDARY_FOCUSED (le primaire s'est mis au premier plan ; on sort)
 * - pipe tenu + muet      -> primaire FIGÉ : récupération gardée, UN seul retry
 * - récupération vaine    -> BLOCKED (sortie + alerte) — JAMAIS deux instances
 */
export async function acquireSingleInstance(opts: AcquireOptions): Promise<AcquireOutcome> {
  const log = (l: string): void => opts.onLog?.(l);
  const focusTimeout = opts.focusAckTimeoutMs ?? 2000;
  const focusAttempts = opts.focusAttempts ?? 3; // ~6 s avant de conclure « figé » (cf. requestFocusInsistently)
  const reclaimAttempts = opts.reclaimAttempts ?? 10;
  const reclaimDelayMs = opts.reclaimDelayMs ?? 100; // ~1 s de budget pour laisser l'OS libérer le pipe

  const onConn = (sock: net.Socket): void => {
    // Une 2e instance demande le focus. On acquitte PUIS on lève le focus : l'ack prouve qu'on est
    // vivant ET réactif — c'est lui qui distingue un primaire sain d'un primaire figé.
    try { sock.end(FOCUS_ACK); } catch { /* pair déjà parti */ }
    try { opts.onFocusRequested?.(); } catch (e) { log(`onFocusRequested: ${(e as Error).message}`); }
  };

  const becomePrimary = (srv: net.Server): AcquireOutcome => {
    writeLockfile(opts.lockfile, opts.onLog); // auxiliaire : n'arbitre rien, sert à nous identifier si on fige
    log(`instance unique acquise (${opts.pipe})`);
    return {
      kind: "PRIMARY",
      release: () => {
        try { srv.close(); } catch { /* */ }
        try { fs.rmSync(opts.lockfile); } catch { /* absent */ }
      },
    };
  };

  // 1er essai : quelques tentatives rapides absorbent un EADDRINUSE fugace (pipe en cours de libération),
  // sans jamais confondre avec un vrai détenteur (persistant -> on passe au focus).
  const srv = await tryListenBriefly(opts.pipe, onConn, 3, 50);
  if (srv) return becomePrimary(srv);

  // Le pipe est tenu par un process VIVANT (l'OS l'aurait libéré sinon). Sain ou figé ?
  if (await requestFocusInsistently(opts.pipe, focusTimeout, focusAttempts)) {
    log("un primaire sain a pris le focus -> sortie");
    return { kind: "SECONDARY_FOCUSED" };
  }

  // Muet -> primaire FIGÉ. Récupération gardée (identité prouvée, patron M2), puis reprise du pipe avec
  // un budget borné (l'OS libère de façon asynchrone) plutôt qu'un délai fixe qui pourrait sortir trop tôt.
  const rec = recoverFrozenPrimary(opts);
  log(rec.reason);
  if (!rec.killed) return { kind: "BLOCKED", reason: rec.reason };
  const reclaimed = await tryListenBriefly(opts.pipe, onConn, reclaimAttempts, reclaimDelayMs);
  if (reclaimed) return becomePrimary(reclaimed);

  // Le pipe tient encore malgré la récupération : contexte GPU figé qui résiste au kill (le 🔴 du §6,
  // dont T5 est un des trois points de jonction avec T3/T6). On SORT et on ALERTE : jamais 2 instances.
  return {
    kind: "BLOCKED",
    reason: "une instance figée tient encore le verrou après récupération (process irrécupérable ?) — jamais deux Sophia",
  };
}
