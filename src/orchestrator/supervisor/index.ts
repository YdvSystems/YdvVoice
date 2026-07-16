// Superviseur du sidecar (socle T3) — traduit technique/00 §4.3.
//
// Le sidecar ne meurt jamais pour de bon : spawn (port dynamique + retry TOCTOU + windowsHide +
// drain stdio + hygiene d'env PYTHON*), readiness, sante 2 niveaux (crash ET fige-mais-vivant),
// redemarrage backoff + disjoncteur -> DEGRADE_SANS_VOIX, nettoyage d'orphelins avec garde
// anti-recyclage de PID. Respawn DETERMINISTE (on possede + respawn ; pas de re-attach).
//
// Module Node pur (aucune API Electron) -> testable en Node et utilisable depuis l'orchestrateur.

import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

export type SupervisorState = "STOPPED" | "SPAWNING" | "READY" | "RESTARTING" | "DEGRADED_SANS_VOIX";

export interface SupervisorOptions {
  python: string; // chemin de l'interpreteur (venv sidecar)
  script: string; // ex. "sidecar/server.py"
  cwd: string; // racine repo
  pidfile: string;
  extraEnv?: Record<string, string>;
  // reglages a calibrer (§6) — defauts raisonnables
  readinessTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  missedHeartbeats?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  stableWindowMs?: number;
  circuitBreakerK?: number;
  toctouRetries?: number;
  toctouDelayMs?: number;
  sigtermGraceMs?: number; // T6
  sigkillGraceMs?: number; // T6
  onReady?: (port: number, pid: number) => void;
  onDegraded?: () => void;
  onLog?: (line: string) => void;
}

const DEFAULTS = {
  readinessTimeoutMs: 8000,
  heartbeatIntervalMs: 2000,
  heartbeatTimeoutMs: 1500,
  missedHeartbeats: 3,
  backoffBaseMs: 500,
  backoffCapMs: 15000,
  stableWindowMs: 5000,
  circuitBreakerK: 5,
  toctouRetries: 3,
  toctouDelayMs: 200,
  // T6 — arrêt gracieux. Sur Windows SIGTERM=TerminateProcess (mesuré au banc t6) : le sidecar est tué
  // ~instantanément, donc ces délais sont des PLAFONDS (la libération CUDA a déjà eu lieu via cmd.shutdown).
  // Bornés pour tenir dans la fenêtre d'extinction Windows (§6). Valeurs à calibrer (§6).
  sigtermGraceMs: 1500, // attente après SIGTERM avant d'escalader en SIGKILL
  sigkillGraceMs: 1000, // attente après SIGKILL pour confirmer la mort
};

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function scrubbedEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Hygiene d'env : neutraliser les injecteurs PYTHON* (PYTHONPATH/HOME/STARTUP... casseraient le venv).
  // (Cote Electron, l'analogue est ELECTRON_RUN_AS_NODE, scrube dans le lanceur dev — ici on spawn Python.)
  for (const k of Object.keys(env)) {
    if (/^PYTHON/i.test(k)) delete env[k];
  }
  return { ...env, ...(extra ?? {}) };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // existe mais sans permission = vivant
  }
}

/** Nom d'image (executable) d'un PID via tasklist, en minuscules, ou null si introuvable. */
function exeBasenameOf(pid: number): string | null {
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const m = out.match(/^"([^"]+)"/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Lit la ligne de commande d'un PID via CIM (Windows). Injectable pour des tests deterministes. */
export function readCommandLine(pid: number): string | null {
  try {
    const out = execFileSync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    const s = out.trim();
    return s.length ? s : null;
  } catch {
    return null;
  }
}

/**
 * Decision de nettoyage d'orphelin. On ne tue QUE si : le proprietaire est mort ET le PID sidecar
 * est vivant ET son executable correspond ET sa LIGNE DE COMMANDE porte le jeton d'identite attendu.
 * Le jeton (M2) ferme le trou du recyclage de PID : sur une machine de dev pleine de venvs, un
 * `python.exe` dont le PID a ete reattribue a un AUTRE process n'a PAS ce jeton -> jamais tue par
 * erreur. Sans jeton connu (vieux pidfile), on NE tue PAS (fail-safe : plutot une fuite qu'un innocent).
 * `cmdlineReader` est injectable (tests sans dependre d'un vrai process).
 */
export function orphanShouldBeKilled(
  sidecarPid: number,
  ownerPid: number,
  expectedExeBasename: string,
  expectedToken: string,
  cmdlineReader: (pid: number) => string | null = readCommandLine,
): boolean {
  if (isAlive(ownerPid)) return false; // le proprietaire vit -> ce n'est pas un orphelin
  if (!isAlive(sidecarPid)) return false; // deja mort -> rien a tuer
  if (exeBasenameOf(sidecarPid) !== expectedExeBasename.toLowerCase()) return false; // pre-filtre cheap
  if (!expectedToken) return false; // identite inconnue -> on s'abstient (jamais tuer un innocent)
  const cmd = cmdlineReader(sidecarPid);
  return cmd !== null && cmd.includes(expectedToken); // identite prouvee par le jeton dans la cmdline
}

interface Config {
  python: string;
  script: string;
  cwd: string;
  pidfile: string;
  extraEnv?: Record<string, string>;
  readinessTimeoutMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  missedHeartbeats: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  stableWindowMs: number;
  circuitBreakerK: number;
  toctouRetries: number;
  toctouDelayMs: number;
  sigtermGraceMs: number;
  sigkillGraceMs: number;
  onReady?: (port: number, pid: number) => void;
  onDegraded?: () => void;
  onLog?: (line: string) => void;
}

export class Supervisor {
  private readonly o: Config;
  private child: ChildProcess | null = null;
  private _port = 0;
  private _pid = 0;
  private state: SupervisorState = "STOPPED";
  private failures = 0;
  private missCount = 0;
  private stopping = false;
  private handlingFailure = false;
  private heartbeatBusy = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SupervisorOptions) {
    this.o = {
      python: opts.python,
      script: opts.script,
      cwd: opts.cwd,
      pidfile: opts.pidfile,
      extraEnv: opts.extraEnv,
      readinessTimeoutMs: opts.readinessTimeoutMs ?? DEFAULTS.readinessTimeoutMs,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs,
      heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? DEFAULTS.heartbeatTimeoutMs,
      missedHeartbeats: opts.missedHeartbeats ?? DEFAULTS.missedHeartbeats,
      backoffBaseMs: opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs,
      backoffCapMs: opts.backoffCapMs ?? DEFAULTS.backoffCapMs,
      stableWindowMs: opts.stableWindowMs ?? DEFAULTS.stableWindowMs,
      circuitBreakerK: opts.circuitBreakerK ?? DEFAULTS.circuitBreakerK,
      toctouRetries: opts.toctouRetries ?? DEFAULTS.toctouRetries,
      toctouDelayMs: opts.toctouDelayMs ?? DEFAULTS.toctouDelayMs,
      sigtermGraceMs: opts.sigtermGraceMs ?? DEFAULTS.sigtermGraceMs,
      sigkillGraceMs: opts.sigkillGraceMs ?? DEFAULTS.sigkillGraceMs,
      onReady: opts.onReady,
      onDegraded: opts.onDegraded,
      onLog: opts.onLog,
    };
  }

  get port(): number { return this._port; }
  get pid(): number { return this._pid; }
  get currentState(): SupervisorState { return this.state; }

  private log(line: string): void { this.o.onLog?.(line); }
  private expectedExe(): string { return path.basename(this.o.python).toLowerCase(); }

  /** Nettoyage d'orphelin au boot (respawn deterministe : on ne re-attache pas). */
  orphanCleanup(): void {
    let removePidfile = true;
    try {
      if (!fs.existsSync(this.o.pidfile)) return;
      const parts = fs.readFileSync(this.o.pidfile, "utf8").trim().split(/\s+/);
      const sPid = parseInt(parts[0], 10);
      const oPid = parseInt(parts[1], 10);
      const token = parts[2] ?? ""; // jeton d'identite (M2) ; absent d'un vieux pidfile -> on s'abstient
      if (Number.isFinite(sPid) && Number.isFinite(oPid)) {
        if (orphanShouldBeKilled(sPid, oPid, this.expectedExe(), token)) {
          this.log(`orphelin (sidecar pid=${sPid}, proprietaire mort, jeton verifie) -> kill`);
          try { process.kill(sPid, "SIGKILL"); } catch { /* deja parti */ }
          // Note (re-croisé conv 36) : on ne CONSERVE PAS le pidfile ici sur un kill non confirme -> ce
          // serait inefficace (le pidfile mono-emplacement est reecrase par writePidfile du respawn en
          // Phase 5) ET non teste. Le « ne pas oublier l'orphelin par-dela l'arret » est tenu par
          // terminate() T6 (arret -> aucun spawn ne suit -> conserve effectif) ; un orphelin resistant AU
          // BOOT = le 🔴 §6 documente (job object Windows le tue de toute facon a la mort de l'orchestrateur).
        } else if (!token && isAlive(sPid) && exeBasenameOf(sPid) === this.expectedExe()) {
          // Abstention par ABSENCE DE JETON (pidfile pre-M2) alors qu'un sidecar de la bonne image est
          // VIVANT : on ne peut ni le tuer (trou M2 : ce serait peut-etre un innocent) ni prouver sa mort.
          // On CONSERVE le pidfile -> on ne perd pas la trace d'un orphelin peut-etre reel (re-croise conv
          // 35). Les autres abstentions (proprietaire vivant, sidecar mort, PID recycle exe/cmdline
          // discordants) = l'orphelin est mort -> pidfile obsolete, on le retire. Reachabilite ~nulle ici
          // (le jeton est TOUJOURS ecrit par writePidfile) ; durcissement « tourne des annees ».
          removePidfile = false;
          this.log(`orphelin possible sans jeton (sidecar pid=${sPid}, image concordante) : conserve, ni tue ni oublie`);
        }
      }
    } catch (e) {
      this.log(`orphanCleanup: ${(e as Error).message}`);
    } finally {
      if (removePidfile) { try { fs.rmSync(this.o.pidfile); } catch { /* absent */ } }
    }
  }

  async start(): Promise<void> {
    this.orphanCleanup();
    this.stopping = false;
    await this.spawnCycle();
  }

  private async spawnCycle(): Promise<void> {
    this.state = "SPAWNING";
    for (let attempt = 0; attempt <= this.o.toctouRetries; attempt++) {
      if (this.stopping) return; // #6 : un stop() pendant le sleep TOCTOU coupe court (pas de spawn de plus)
      const port = await getFreePort();
      const token = randomUUID(); // jeton d'identite unique de CETTE generation (garde M2)
      const child = spawn(this.o.python, [this.o.script, String(port), token], {
        cwd: this.o.cwd,
        env: scrubbedEnv(this.o.extraEnv),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let exited = false;
      let exitCode: number | null = null;
      child.stdout?.on("data", (d: Buffer) => this.log(`[sidecar] ${String(d).trim()}`)); // drain
      child.stderr?.on("data", (d: Buffer) => this.log(`[sidecar!] ${String(d).trim()}`)); // drain
      // M1 : un 'error' (python introuvable, EACCES...) SANS listener serait LEVE -> l'orchestrateur
      // tomberait (le superviseur, cense empecher ca, se tuerait). On le traite en sortie anticipee.
      child.on("error", (e: Error) => { this.log(`spawn error: ${e.message}`); exited = true; });
      child.on("exit", (code) => { exited = true; exitCode = code; this.onChildExit(child); });

      // m12 : pidfile ecrit DES LE SPAWN (plus seulement a READY) -> un sidecar orphelin (orchestrateur
      // mort pendant la readiness) reste RETROUVABLE et tuable au prochain boot (garde jeton comprise).
      // F8 : si spawn a echoue (pas de pid), rien a tracer -> le child.on('error') gere la suite.
      if (child.pid) this.writePidfile(child.pid, token);

      const ready = await this.waitReady(port, () => exited);

      // m5 : un stop() survenu PENDANT la readiness ne doit pas laisser un sidecar READY fantome
      // (+ battement actif) apres l'arret. On coupe net, on retire le pidfile ecrit au spawn, on sort.
      if (this.stopping) {
        try { child.kill("SIGKILL"); } catch { /* */ }
        try { fs.rmSync(this.o.pidfile); } catch { /* absent */ }
        return;
      }

      if (ready) {
        this.child = child;
        this._port = port;
        this._pid = child.pid ?? 0;
        this.state = "READY";
        this.missCount = 0;
        this.startHeartbeat();
        this.armStableWindow();
        this.log(`sidecar PRET (pid=${this._pid}, port=${port})`);
        this.o.onReady?.(port, this._pid);
        return;
      }
      if (!exited) { try { child.kill("SIGKILL"); } catch { /* */ } }
      // m11 : retry-TOCTOU UNIQUEMENT sur le code de sortie 3 (bind impossible = port vole entre
      // getFreePort et le bind), JAMAIS sur un vrai crash (sinon rafale de spawns sans delai pour un
      // seul incr. d'echec). Petit delai entre essais.
      if (exited && exitCode === 3 && attempt < this.o.toctouRetries) {
        this.log(`port vole (exit 3) -> retry TOCTOU (tentative ${attempt + 1})`);
        await sleep(this.o.toctouDelayMs);
        continue;
      }
      break;
    }
    this.handleFailure("spawn-echoue");
  }

  private async waitReady(port: number, hasExited: () => boolean): Promise<boolean> {
    const deadline = Date.now() + this.o.readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (hasExited()) return false; // sortie anticipee
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) { const j = (await r.json()) as { ready?: boolean }; if (j.ready) return true; }
      } catch { /* pas encore pret */ }
      await sleep(150);
    }
    return false;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => { void this.doHeartbeat(); }, this.o.heartbeatIntervalMs);
  }

  private async doHeartbeat(): Promise<void> {
    if (this.heartbeatBusy || this.state !== "READY") return;
    this.heartbeatBusy = true;
    try {
      const r = await fetch(`http://127.0.0.1:${this._port}/health`, { signal: AbortSignal.timeout(this.o.heartbeatTimeoutMs) });
      if (r.ok) { this.missCount = 0; return; }
      this.missCount++;
    } catch {
      this.missCount++;
    } finally {
      this.heartbeatBusy = false;
    }
    // #5 : un battement OBSOLETE (fetch d'une generation precedente qui atterrit apres un respawn) ne
    // doit pas declencher handleFailure sur la NOUVELLE generation -> re-verifier l'etat post-await.
    if (this.state !== "READY") return;
    if (this.missCount >= this.o.missedHeartbeats) {
      this.log(`battement manque ${this.missCount}x -> fige-mais-vivant`);
      this.handleFailure("fige");
    }
  }

  private armStableWindow(): void {
    this.clearStableWindow();
    this.stableTimer = setTimeout(() => {
      if (this.failures !== 0) this.log("fenetre de stabilite atteinte -> compteur d'echecs remis a 0");
      this.failures = 0; // le sidecar a tenu -> self-heal des transitoires
    }, this.o.stableWindowMs);
  }

  private onChildExit(child: ChildProcess): void {
    if (this.stopping) return;
    if (child !== this.child) return; // enfant de readiness / abandonne -> la boucle gere
    if (this.state !== "READY") return;
    this.handleFailure("crash");
  }

  private handleFailure(reason: string): void {
    if (this.handlingFailure || this.stopping) return;
    this.handlingFailure = true;
    this.stopHeartbeat();
    this.heartbeatBusy = false; // m6 : un battement fantome en vol ne doit pas geler la generation suivante
    this.clearStableWindow();
    if (this.child) { try { this.child.kill("SIGKILL"); } catch { /* */ } this.child = null; }
    this.failures++;
    this.log(`echec (${reason}), total=${this.failures}`);
    if (this.failures >= this.o.circuitBreakerK) {
      this.state = "DEGRADED_SANS_VOIX";
      this.log("disjoncteur ouvert -> DEGRADE_SANS_VOIX (notif systray, jamais de silence)");
      this.o.onDegraded?.();
      this.handlingFailure = false;
      return;
    }
    this.state = "RESTARTING";
    const backoff = Math.min(this.o.backoffCapMs, this.o.backoffBaseMs * 2 ** (this.failures - 1));
    this.log(`redemarrage dans ${backoff}ms`);
    this.restartTimer = setTimeout(() => {
      this.handlingFailure = false;
      void this.spawnCycle();
    }, backoff);
  }

  private writePidfile(pid: number, token: string): void {
    try {
      fs.mkdirSync(path.dirname(this.o.pidfile), { recursive: true });
      fs.writeFileSync(this.o.pidfile, `${pid} ${process.pid} ${token}`); // <pidSidecar> <pidProprio> <jeton>
    } catch (e) {
      this.log(`writePidfile: ${(e as Error).message}`);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private clearStableWindow(): void {
    if (this.stableTimer) { clearTimeout(this.stableTimer); this.stableTimer = null; }
  }

  /**
   * T6 — entrer en mode ARRÊT : couper le respawn + le battement, SANS tuer le sidecar. Il va d'abord
   * recevoir `cmd.shutdown` (WS) et libérer CUDA en douceur (coopératif) ; on ne le termine qu'ensuite.
   * Idempotent. Après beginShutdown, une mort du sidecar n'est plus prise pour un crash à relancer
   * (`stopping` court-circuite onChildExit/handleFailure).
   */
  beginShutdown(): void {
    this.stopping = true;
    this.stopHeartbeat();
    this.clearStableWindow();
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
  }

  /** Attend l'exit du child jusqu'à `ms` (true = mort dans le délai, false = toujours vivant). */
  private waitExit(child: ChildProcess, ms: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (v: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve(v);
      };
      const onExit = (): void => finish(true);
      child.once("exit", onExit);
      const timer = setTimeout(() => finish(false), ms);
    });
  }

  /**
   * T6 — TERMINER le sidecar : **SIGTERM** puis, s'il vit encore après `graceMs`, **SIGKILL**. Sur Windows
   * les deux sont `TerminateProcess` (mesuré au banc t6) : le sidecar meurt ~instantanément — la libération
   * CUDA gracieuse a déjà eu lieu via `cmd.shutdown` AVANT cet appel. Retourne `died`.
   *
   * Le pidfile est retiré **seulement si le sidecar est bien mort** ; **conservé** s'il a résisté (contexte
   * GPU figé — le 🔴 de §6, jonction T3/T5/T6), pour que le reaper d'orphelins du prochain boot le retrouve
   * (même philosophie que `orphanCleanup` : plutôt une trace de trop qu'un orphelin perdu). `_sendKill` est
   * une couture de test (convention `_` du socle) : par défaut, le vrai `child.kill`.
   */
  async terminate(
    graceMs = this.o.sigtermGraceMs,
    _sendKill: (child: ChildProcess, sig: NodeJS.Signals) => void = (c, s) => c.kill(s),
  ): Promise<{ died: boolean }> {
    // Filet si beginShutdown n'a pas précédé : couper respawn + battement avant de tuer.
    this.stopping = true;
    this.stopHeartbeat();
    this.clearStableWindow();
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }

    const child = this.child;
    let died = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      try { _sendKill(child, "SIGTERM"); } catch (e) { this.log(`SIGTERM: ${(e as Error).message}`); }
      died = await this.waitExit(child, graceMs);
      if (!died) {
        this.log("le sidecar survit à SIGTERM -> escalade SIGKILL");
        try { _sendKill(child, "SIGKILL"); } catch (e) { this.log(`SIGKILL: ${(e as Error).message}`); }
        died = await this.waitExit(child, this.o.sigkillGraceMs);
      }
    }
    this.child = null;

    if (died) {
      try { fs.rmSync(this.o.pidfile); } catch { /* absent */ }
    } else {
      // Kill impossible (contexte GPU figé ?) : on NE retire PAS le pidfile -> le reaper du prochain boot
      // (pidfile + jeton M2) pourra retenter. Le job object Windows tue de toute façon le sidecar quand
      // l'orchestrateur sort (finding conv 35) ; ce filet couvre le résiduel théorique (🔴 §6).
      this.log("le sidecar n'a pas pu être tué -> pidfile CONSERVÉ pour le reaper au prochain boot (🔴 §6)");
    }
    this.state = "STOPPED";
    // Comme stop() : remettre les gardes/compteurs à plat (un start() ultérieur ne reste pas bloqué).
    this.handlingFailure = false;
    this.heartbeatBusy = false;
    this.failures = 0;
    this.missCount = 0;
    return { died };
  }

  /** Arret volontaire ABRUPT (tests U-T3 ; l'arret gracieux complet = T6 via beginShutdown()+terminate()). */
  async stop(): Promise<void> {
    this.stopping = true;
    this.stopHeartbeat();
    this.clearStableWindow();
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.child) { try { this.child.kill("SIGKILL"); } catch { /* */ } this.child = null; }
    try { fs.rmSync(this.o.pidfile); } catch { /* absent */ }
    this.state = "STOPPED";
    // F1 : remettre les gardes/compteurs a plat -> un start() ulterieur sur la MEME instance ne reste
    // pas bloque (un handlingFailure=true residuel court-circuiterait tout respawn/DEGRADE en silence).
    this.handlingFailure = false;
    this.heartbeatBusy = false;
    this.failures = 0;
    this.missCount = 0;
  }
}
