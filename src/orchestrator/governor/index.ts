// Gouverneur unique (socle T7) — traduit technique/00 §2.2 (les signaux du gouverneur) + §4.4 (vie d'une tâche
// de fond) + §5 (priorité interactive absolue · écritures atomiques écriture+curseur) + A33/A21/A23.
//
// UN SEUL chef arbitre TOUT le fond (consolidation 02, proactif/rêverie 04 — leurs CLIENTS n'existent pas encore ;
// ici la mécanique est COMPLÈTE et testée via un harnais de tâche FACTICE). Deux garanties non négociables :
//   · priorité interactive ABSOLUE : Yohann ou Claude Code actif → tout le fond différé (jamais son quota à lui) ;
//   · budget « part de Sophia » BORNÉ : appels autonomes par fenêtre glissante ; l'interactif n'est JAMAIS compté.
// Hygiène de pensée, pas avarice (A21/A22 : la borne évite la rumination, pas la largesse).
//
// Module Node PUR (aucune API Electron, patron shutdown/supervisor) → testable hors Electron (stubs) et prouvé en
// cœur réel (E2E-6). DEUX invariants MESURÉS au banc (bancs/t7, conv 37) dictent la forme :
//   ① l'unité de fond fait son travail ASYNC hors transaction, puis committe écriture-métier + curseur dans UNE
//      transaction COURTE SYNCHRONE (setSynchronous FULL est ignoré DANS une transaction → armé AVANT le BEGIN) ;
//   ② le gouverneur n'`await` JAMAIS une transaction ouverte (sinon ⑩ writeCleanShutdown + N4 VACUUM jetteraient).
// La FILE DÉRIVE des watermarks durables (pas d'état mémoire à resynchroniser — comme l'UI dérive de l'état, O5) :
// un crash mid-run laisse `owed=1` → au boot suivant la tâche est due → reprise AU CURSEUR (jamais à zéro).

import type { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { setSynchronous } from "../db/durability.js";
import { AuditLog } from "../audit/index.js";
import type { SophiaPaths } from "../paths.js";

/** Les 4 états d'exécution du fond (technique/00 §2.2). Identifiants SANS accent (convention du code socle). */
export type GovernorState = "INTERACTIF" | "REPOS" | "FOND_EN_COURS" | "BRIDE";
/** Calques COMPOSABLES posés par doc 05 (A37), HONORÉS ici, jamais détectés. SECOURS agit (diffère l'identité) ;
 *  JEU est porté pour que 05 le lise (ses effets — GPU/voix — sont définis là-bas). */
export type ModeLayer = "SECOURS" | "JEU";
export type CallOrigin = "autonome" | "interactif";

/** Signal d'activité (technique/00 §2.2 : « active-win / pslist »). Best-effort ; lu par une COUTURE injectable. */
export interface ActivitySignal {
  /** Yohann (input récent) OU Claude Code (process actif) → priorité interactive absolue. */
  interactive: boolean;
}
export type ActivityProbe = () => ActivitySignal;

/** L'état durable d'une tâche de fond (governor_watermarks, schema-00). */
export interface Watermark {
  task: string;
  last_run_at: number | null;
  owed: number;                 // 0/1 — un rattrapage est dû
  owed_since: number | null;    // epoch ms : depuis quand c'est dû (backlog borné multi-jours, §4.4)
  requires_real_brain: number;  // 0/1 — ne tourne jamais en SECOURS
}

/** Le contexte remis à CHAQUE unité : le commit ATOMIQUE + la dépense budget + l'indice de préemption. */
export interface UnitContext {
  /**
   * Commit ATOMIQUE d'une unité — le patron PROUVÉ au banc t7 (transaction courte SYNCHRONE, durable en FULL) :
   *   setSynchronous(FULL) [HORS transaction] → BEGIN IMMEDIATE → businessWrites(db) [SYNCHRONE, jamais d'await]
   *   → avance du curseur du gouverneur (last_run_at + owed, MÊME transaction) → COMMIT → NORMAL.
   * Atomicité §5/§Durabilité-2 : l'écriture métier ET le curseur avancent ENSEMBLE, ou pas du tout (au pire l'unité
   * rejouée). `done=true` → la tâche a fini (owed→0) ; `done=false` → il reste du travail (owed→1, rattrapage dû).
   * JETTE si une transaction est déjà ouverte (invariant ② : jamais d'await transaction en vol).
   */
  commitUnit: (businessWrites: (db: DatabaseSync) => void, done: boolean) => void;
  /** Enregistre un appel AUTONOME (dépense « part de Sophia », fenêtre glissante). L'interactif n'est JAMAIS compté.
   *  CONTRAT (tour 2 conv 37) : le budget est vérifié ENTRE les unités (§4.4 « unités découpées ») → une unité devrait
   *  faire ~1 appel autonome. Une unité qui émet N appels peut dépasser le plafond SOUPLE de N-1 avant que l'unité
   *  suivante soit bridée (le 429 reste le frein DUR). Découpe fine = budget qui mord à la bonne granularité (client 02/04). */
  recordAutonomousCall: (kind?: string) => void;
  /** Indice COOPÉRATIF : le gouverneur préférerait que la tâche finisse vite (Yohann est peut-être revenu, ou l'arrêt
   *  est demandé). La GARANTIE de préemption est côté gouverneur (il cède ENTRE les unités) ; ceci est un bonus. */
  readonly preemptRequested: boolean;
}

/** Une tâche de fond. Au socle : un harnais FACTICE (u-t7/E2E-6). Les vraies (consolidation 02, proactif/rêverie 04)
 *  arrivent après, comme CLIENTS de cette mécanique — « pas de MVP, la mécanique est complète » (plan T7). */
export interface BackgroundTask {
  task: string;                 // = governor_watermarks.task
  priority: number;             // file PRIORISÉE : plus petit = plus prioritaire (technique/00 §2.2 « priorisées »)
  requiresRealBrain: boolean;   // ne tourne jamais en SECOURS (l'identité ne se grave pas diminuée, A18/A37)
  consumesQuota: boolean;       // consomme la « part de Sophia » → suspendu en BRIDE (le local non-quota continue, §2.2)
  /** DUE maintenant ? (échéance : intervalle, heure d'amorce 6h A33... = POLITIQUE en paramètre, définie par le CLIENT.) */
  isDue: (wm: Watermark | null, now: number) => boolean;
  /** Exécute UNE unité. Travail (async, HORS transaction) PUIS ctx.commitUnit(...) (transaction courte synchrone).
   *  Retourne { done }. La préemption est gérée par le gouverneur ENTRE les unités (jamais au milieu d'une). */
  runUnit: (ctx: UnitContext) => Promise<{ done: boolean }>;
}

export interface GovernorOptions {
  db: DatabaseSync;                  // le fichier de vérité (écrivain unique = l'orchestrateur, F2)
  paths: SophiaPaths;                // pour l'audit (AF-10 : événements, jamais de contenu)
  tasks?: BackgroundTask[];          // le registre (VIDE au socle-seul ; factice en test ; vrai en 02/04)
  activityProbe?: ActivityProbe;     // COUTURE injectable ; défaut = l'adaptateur réel thin (realActivityProbe)
  /** COUTURE (croisé conv 37) : les écritures sont-elles suspendues ? (base douteuse — DÉGRADÉ_SANS_ÉCRITURE, T5/03.)
   *  Toute tâche de fond écrit au moins son curseur → en SANS_ECRITURE, le gouverneur ne lance RIEN de NEUF et cède ENTRE
   *  les unités (une unité DÉJÀ EN VOL se termine — « après l'unité en cours », §4.4 ; owed=1 la fera rattraper). Jamais
   *  d'écriture dans une base douteuse (A15). Dynamique (relue à chaque décision : SANS_ECRITURE atteignable au runtime). */
  writesSuspended?: () => boolean;
  budgetWindowMs?: number;           // fenêtre glissante « part de Sophia »
  budgetCap?: number;                // N appels autonomes max / fenêtre (calibration §7 ; défaut prudent)
  debounceMs?: number;               // anti-rebond INTERACTIF→REPOS (A21 : REPOS = « aucune activité APRÈS délai »)
  tickIntervalMs?: number;           // rythme de la boucle de fond (PAS temps-réel)
  throttleCooldownMs?: number;       // durée de bridage après un signal 429 (contre-pression, §2.2)
  taskBackoffBaseMs?: number;        // backoff après un échec d'unité (miroir du disjoncteur superviseur — croisé conv 37)
  taskBackoffCapMs?: number;         // plafond du backoff par tâche
  now?: () => number;                // horloge injectable (tests déterministes de la fenêtre glissante)
  onState?: (s: GovernorState) => void;
  onLog?: (line: string) => void;
  /** V11 — notifié quand un CALQUE change (SECOURS/JEU posé/retiré par doc 05) → la RÉSIDENCE des modèles ré-émet sa
   *  politique (`cmd.model.policy` porte les calques). INERTE au socle (rien ne pose de calque avant 05). Un listener
   *  qui lève ne casse jamais le gouverneur. */
  onMode?: () => void;
}

// Défauts PRUDENTS (calibration réelle = Phase 3/§7 : « tailles de fenêtres · N · signal exact de throttling »).
const DEFAULTS = {
  budgetWindowMs: 60 * 60 * 1000,    // 1 h glissante
  budgetCap: 40,                     // N appels autonomes / h (placeholder — la vraie valeur est mesurée)
  debounceMs: 30_000,                // 30 s de calme avant de considérer Yohann parti (anti-rebond)
  tickIntervalMs: 5_000,             // arbitrage toutes les 5 s (fond, pas temps-réel)
  throttleCooldownMs: 60_000,        // 1 min de bridage après un 429 (la vraie limite bat l'estimation)
  taskBackoffBaseMs: 5_000,          // 1er backoff après un échec d'unité (puis exponentiel)
  taskBackoffCapMs: 5 * 60_000,      // plafond 5 min (une tâche cassée s'espace, ne spinne pas toutes les 5 s)
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Reconstruit la file au BOOT (Phase 4, hook governorInit) : lecture PURE des watermarks → quelles tâches sont DUES
 * (owed=1 d'un run interrompu, OU isDue selon l'échéance). PROGRAMME (retourne leurs noms), ne LANCE jamais (le boot
 * n'est pas fini). La boucle (start, après PRÊT) les exécutera quand REPOS + budget + cerveau réel (technique/00 §4.1
 * Phase 4 : « voit une consolidation due mais ne la lance pas, il la programme »). La file DÉRIVE des marques : rien
 * n'est mis en cache mémoire ici — la reconstruction n'est qu'un rapport de ce que la boucle re-dérivera à chaque tick.
 *
 * VRAIMENT en lecture seule (croisé conv 37) : n'appelle PAS ensureWatermarks. Au boot, la base peut être douteuse
 * (SANS_ECRITURE) — une écriture ici ferait TOMBER le boot (elle remonterait au catch de boot(), → BLOCKED au lieu de
 * vivre dégradé). Un watermark absent se lit `null` → isDue(null) tranche (une tâche jamais vue est due à son échéance).
 * La CRÉATION des lignes (ensureWatermarks) est réservée au RUNTIME (constructeur / start).
 */
export function reconstructQueue(db: DatabaseSync, tasks: BackgroundTask[], now: () => number): { scheduled: string[] } {
  const t = now();
  const scheduled: string[] = [];
  for (const task of tasks) {
    const wm = readWatermark(db, task.task);
    // isDue est du code CLIENT (02/04) : s'il jette (ex. déréférence `wm` null), il ne DOIT PAS faire tomber le boot
    // (governorInit n'est pas gardé en amont) — c'est toute la raison du durcissement lecture-pure. Fail-safe : owed vient
    // de la BASE (fiable) ; si l'appel client échoue, on se rabat sur owed seul (reprise au runtime, tick gardé). Tour 2.
    let due = false;
    try { due = wm?.owed === 1 || task.isDue(wm, t); }
    catch (e) { due = wm?.owed === 1; void e; }
    if (due) scheduled.push(task.task);
  }
  return { scheduled };
}

/** Crée la ligne de watermark (avec `requires_real_brain`, statique) si absente. INSERT OR IGNORE : idempotent, ne touche
 *  jamais un curseur existant. Appelé PARESSEUSEMENT depuis tick (après la garde `writesSuspended`) — jamais au
 *  constructeur/start (base peut-être douteuse, tour 2) ; la ligne existe donc avant que commitUnit l'UPDATE. */
function ensureWatermarks(db: DatabaseSync, tasks: BackgroundTask[]): void {
  const ins = db.prepare("INSERT OR IGNORE INTO governor_watermarks(task, requires_real_brain) VALUES(?, ?)");
  for (const task of tasks) ins.run(task.task, task.requiresRealBrain ? 1 : 0);
}

function readWatermark(db: DatabaseSync, task: string): Watermark | null {
  const row = db.prepare("SELECT task, last_run_at, owed, owed_since, requires_real_brain FROM governor_watermarks WHERE task=?").get(task);
  return (row as Watermark | undefined) ?? null;
}

/** Nombre d'appels AUTONOMES dans la fenêtre glissante (le budget « part de Sophia » consommé). */
function autonomousInWindow(db: DatabaseSync, now: number, windowMs: number): number {
  const row = db.prepare("SELECT count(*) AS c FROM governor_budget_ledger WHERE origin='autonome' AND ts > ?").get(now - windowMs) as { c: number };
  return row.c;
}

export class Governor {
  private readonly db: DatabaseSync;
  private readonly audit: AuditLog;
  private readonly tasks: BackgroundTask[];
  private readonly probe: ActivityProbe;
  private readonly writesSuspended: () => boolean;
  private readonly o: Required<Omit<GovernorOptions, "db" | "paths" | "tasks" | "activityProbe" | "writesSuspended" | "onState" | "onLog" | "onMode">>;
  private readonly onState?: (s: GovernorState) => void;
  private readonly onLog?: (line: string) => void;
  private readonly onMode?: () => void;   // V11 : notifie la résidence des modèles sur un changement de calque

  private state: GovernorState = "REPOS";
  private running = false;            // une unité (ou un run de tâche) est en cours — une seule à la fois
  private quiescing = false;          // ⑩ : arrêt demandé → plus de nouvelle unité ; on attend l'unité en cours
  private preempt = false;            // indice coopératif remis à l'unité en cours
  private lastInteractiveAt = 0;      // dernier instant où l'activité était interactive (anti-rebond)
  private throttledUntil = 0;         // bridage 429 actif jusqu'à cet instant
  private lastPurgeAt = 0;            // dernière purge du registre de budget (au plus 1×/fenêtre — R3, table bornée)
  private ensured = false;           // les lignes de watermark sont-elles créées ? (LAZY, jamais en base douteuse — tour 2 conv 37)
  private readonly taskFailures = new Map<string, { count: number; until: number }>(); // backoff par tâche (échecs consécutifs, croisé conv 37)
  private readonly modes = new Set<ModeLayer>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: GovernorOptions) {
    this.db = opts.db;
    this.audit = new AuditLog(opts.paths.audit);
    // File PRIORISÉE : triée une fois par priorité croissante (plus petit = plus prioritaire).
    this.tasks = [...(opts.tasks ?? [])].sort((a, b) => a.priority - b.priority);
    this.probe = opts.activityProbe ?? realActivityProbe({ onLog: opts.onLog });
    this.writesSuspended = opts.writesSuspended ?? (() => false);
    this.onState = opts.onState;
    this.onLog = opts.onLog;
    this.onMode = opts.onMode;   // V11 : résidence des modèles notifiée sur un changement de calque (inerte au socle)
    this.o = {
      budgetWindowMs: opts.budgetWindowMs ?? DEFAULTS.budgetWindowMs,
      budgetCap: opts.budgetCap ?? DEFAULTS.budgetCap,
      debounceMs: opts.debounceMs ?? DEFAULTS.debounceMs,
      tickIntervalMs: opts.tickIntervalMs ?? DEFAULTS.tickIntervalMs,
      throttleCooldownMs: opts.throttleCooldownMs ?? DEFAULTS.throttleCooldownMs,
      taskBackoffBaseMs: opts.taskBackoffBaseMs ?? DEFAULTS.taskBackoffBaseMs,
      taskBackoffCapMs: opts.taskBackoffCapMs ?? DEFAULTS.taskBackoffCapMs,
      now: opts.now ?? (() => Date.now()),
    };
    // (ensureWatermarks n'est PAS appelé ici : le constructeur peut tourner en base douteuse — SANS_ECRITURE, juste
    //  après un boot dégradé — et écrire sans garde rejouerait le trou de la correction #7. Création LAZY dans tick.)
  }

  get currentState(): GovernorState { return this.state; }
  private now(): number { return this.o.now(); }
  private log(l: string): void { this.onLog?.(l); }

  /** Pose/retire un calque de mode (SECOURS/JEU), posé par 05. HONORÉ ici (SECOURS diffère l'identité ; JEU porté pour 05). */
  setMode(layer: ModeLayer, on: boolean): void {
    const had = this.modes.has(layer);
    if (on) this.modes.add(layer); else this.modes.delete(layer);
    if (had !== on) {
      this.log(`calque ${layer} ${on ? "posé" : "retiré"}`);
      try { this.audit.append({ evt: "governor.mode", layer, on, ts: this.now() }); } catch { /* */ }
      // V11 : la résidence des modèles ré-émet sa politique (le calque entre dans cmd.model.policy). Un listener
      // qui lève ne casse jamais le gouverneur (défense, parité onState/onLog).
      try { this.onMode?.(); } catch { /* */ }
    }
  }
  hasMode(layer: ModeLayer): boolean { return this.modes.has(layer); }

  /** Contre-pression 429 (technique/00 §2.2) : bride IMMÉDIATEMENT tout le fond QUOTA, quel que soit le compteur souple
   *  (« la vraie limite bat l'estimation »). Le local non-quota n'est pas concerné (il ne touche pas l'API). */
  notifyThrottle(): void {
    this.throttledUntil = this.now() + this.o.throttleCooldownMs;
    this.log(`throttle 429 → BRIDE jusqu'à +${this.o.throttleCooldownMs}ms`);
    try { this.audit.append({ evt: "governor.throttle", until: this.throttledUntil, ts: this.now() }); } catch { /* */ }
  }

  /** Enregistre un appel INTERACTIF (tour de Yohann) : loggé pour la mesure, JAMAIS compté dans le budget (§2.2). */
  recordInteractiveCall(kind?: string): void { this.recordCall("interactif", kind); }

  /** Enregistre un appel au registre, et purge les événements bien HORS fenêtre — mais LIÉ à l'écriture (pas à chaque
   *  tick), au plus une fois par fenêtre : la table reste bornée « sur des années » (R3) SANS écriture inutile en boucle.
   *  Marge ×2 pour ne jamais rogner la fenêtre courante ; le COUNT filtré reste juste même si la purge échoue. */
  private recordCall(origin: CallOrigin, kind?: string): void {
    const now = this.now();
    this.db.prepare("INSERT INTO governor_budget_ledger(ts, origin, kind) VALUES(?, ?, ?)").run(now, origin, kind ?? null);
    if (now - this.lastPurgeAt >= this.o.budgetWindowMs) {
      this.lastPurgeAt = now;
      try { this.db.prepare("DELETE FROM governor_budget_ledger WHERE ts < ?").run(now - this.o.budgetWindowMs * 2); }
      catch (e) { this.log(`purge budget: ${(e as Error).message}`); }
    }
  }

  // ── Décisions (l'activité est SONDÉE UNE FOIS par point de décision, puis passée : la sonde réelle est coûteuse
  //    (~qq centaines de ms), et une même décision doit voir UNE valeur cohérente d'activité, pas deux lectures qui
  //    pourraient diverger — solo conv 37) ──
  /** Sonde l'activité + anti-rebond (A21) : interactive MAINTENANT, ou dans les debounceMs qui suivent la dernière
   *  activité (on ne relance pas le fond à la première micro-pause). Met à jour lastInteractiveAt. FAIL-SAFE : une sonde
   *  qui jette → « interactif » (prudent : on ne fait pas tourner le fond dans le doute). */
  private probeInteractive(now: number): boolean {
    let active: boolean;
    try { active = this.probe().interactive; }
    catch (e) { this.log(`sonde d'activité: ${(e as Error).message} → prudent (interactif)`); return true; }
    if (active) { this.lastInteractiveAt = now; return true; }
    return now - this.lastInteractiveAt < this.o.debounceMs; // encore en cooldown → considéré interactif (prudent)
  }
  private budgetExhausted(now: number): boolean { return autonomousInWindow(this.db, now, this.o.budgetWindowMs) >= this.o.budgetCap; }
  private quotaUnavailable(now: number): boolean { return this.budgetExhausted(now) || now < this.throttledUntil; }

  /** L'état de BASE (hors run) : la priorité interactive prime ; sinon quota indisponible = BRIDE ; sinon REPOS. */
  private baseline(now: number, interactive: boolean): GovernorState {
    if (interactive) return "INTERACTIF";
    if (this.quotaUnavailable(now)) return "BRIDE";
    return "REPOS";
  }

  /** La tâche est-elle à FAIRE ? owed=1 (un run interrompu à RATTRAPER au curseur — indépendant de l'échéance) OU
   *  isDue (échéance normale). Le rattrapage (§4.4) repose sur owed : une tâche préemptée dont l'heure n'est pas
   *  revenue doit quand même être reprise jusqu'à ce qu'elle finisse (owed→0). */
  private dueOrOwed(task: BackgroundTask, now: number): boolean {
    const wm = readWatermark(this.db, task.task);
    // isDue est du code CLIENT (02/04) : au RUNTIME comme au boot (reconstructQueue), un isDue qui jette ne doit pas tuer
    // l'arbitrage — sinon le `.some()` de hasCandidate propagerait l'exception à CHAQUE tick, figeant TOUT le fond (une
    // tâche poison arrêterait consolidation/proactif/rêverie en silence). Symétrique du durcissement boot (tour 3 conv 37).
    try { return wm?.owed === 1 || task.isDue(wm, now); }
    catch { return wm?.owed === 1; } // owed vient de la BASE (fiable) ; on se rabat dessus
  }

  /** La tâche T est-elle lançable MAINTENANT ? Priorité interactive absolue · SECOURS diffère requires_real_brain ·
   *  BRIDE/429 coupe le QUOTA (le local non-quota continue) · et il faut qu'elle soit due/à rattraper.
   *  (`interactive` déjà sondé une fois par le point de décision — jamais re-sondé ici.) */
  private canRun(task: BackgroundTask, now: number, interactive: boolean): boolean {
    if (interactive) return false;                                               // priorité interactive absolue (§5)
    if (task.requiresRealBrain && this.modes.has("SECOURS")) return false;        // secours ne grave jamais l'identité (A37)
    if (task.consumesQuota && this.quotaUnavailable(now)) return false;           // BRIDE : le fond quota s'arrête (§2.2)
    if (this.inBackoff(task, now)) return false;                                  // backoff après des échecs (ne pas spinner)
    return this.dueOrOwed(task, now);
  }

  /** La tâche est-elle en cooldown après des échecs consécutifs (backoff #4) ? Exclue aussi de `hasCandidate` pour ne pas
   *  sonder l'activité (coûteuse) inutilement pendant qu'elle attend son cooldown. */
  private inBackoff(task: BackgroundTask, now: number): boolean {
    const cd = this.taskFailures.get(task.task);
    return !!cd && now < cd.until;
  }

  /** La tâche DUE la plus prioritaire et lançable, ou null. La file est la vue dérivée des marques + de l'ordre de priorité. */
  private nextRunnableTask(now: number, interactive: boolean): BackgroundTask | null {
    for (const task of this.tasks) if (this.canRun(task, now, interactive)) return task; // déjà triée par priorité
    return null;
  }

  private setState(s: GovernorState): void {
    if (s === this.state) return;
    this.state = s;
    try { this.audit.append({ evt: "governor.state", state: s, ts: this.now() }); } catch { /* */ }
    try { this.onState?.(s); } catch (e) { this.log(`onState: ${(e as Error).message}`); } // un consommateur ne fait pas tomber le gouverneur
  }

  // ── La boucle ───────────────────────────────────────────────────────────────
  /** Démarre l'arbitrage périodique (après PRÊT, Phase 6). Idempotent. */
  start(): void {
    if (this.timer || this.quiescing) return;
    // (ensureWatermarks est LAZY dans tick — jamais ici : start() peut suivre un boot dégradé SANS_ECRITURE. Tour 2 conv 37.)
    // Un tick qui jette (ex. base fermée en pleine transition) ne doit pas tuer la boucle EN SILENCE : loggé, pas avalé.
    this.timer = setInterval(() => { this.tick().catch((e) => this.log(`tick: ${(e as Error).message}`)); }, this.o.tickIntervalMs);
    // Trace (tour 3 conv 37) : prouve que le câblage runtime a bien DÉMARRÉ l'arbitrage (le smoke la vérifie → un
    // `start()` oublié dans un refactor de SophiaRuntime serait vu). AF-10 : un événement, jamais de contenu.
    try { this.audit.append({ evt: "governor.started", ts: this.now() }); } catch { /* l'audit ne fait jamais tomber le start */ }
    this.log("gouverneur : arbitrage démarré");
  }

  private stopTimer(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /**
   * UN tour d'arbitrage (appelable directement en test — déterministe). Choisit la tâche due la plus prioritaire et
   * l'exécute par unités, en cédant ENTRE les unités. Ré-entrance interdite (une seule tâche à la fois, garde `running`).
   */
  async tick(): Promise<void> {
    if (this.running || this.quiescing) return;
    const now = this.now();
    // Base douteuse (SANS_ECRITURE, T5/03) : toute tâche de fond écrit au moins son curseur → on ne lance RIEN (jamais
    // écrire dans une mémoire douteuse, A15). La couche qui pose SANS_ECRITURE l'a déjà DIT à Yohann ; ici on s'abstient.
    if (this.writesSuspended()) { this.setState("REPOS"); return; }
    // Créer les lignes de watermark PARESSEUSEMENT — 1re fois que l'écriture est permise (jamais en SANS_ECRITURE, garde
    // ci-dessus), et GARDÉ (comme running=1 au boot) : un échec ne fait pas tomber le gouverneur. MAJEUR tour 2 conv 37 :
    // le faire au constructeur/start écrivait dans une base peut-être douteuse, HORS de cette garde.
    if (!this.ensured) {
      try { ensureWatermarks(this.db, this.tasks); this.ensured = true; }
      catch (e) { this.log(`ensureWatermarks: ${(e as Error).message} — base douteuse ? on n'arbitre pas ce tour`); return; }
    }
    // Ne SONDE l'activité (coûteuse en réel) que s'il y a une tâche candidate ET pas en backoff — sinon rien à arbitrer.
    const hasCandidate = this.tasks.some((t) => this.dueOrOwed(t, now) && !this.inBackoff(t, now));
    if (!hasCandidate) { this.setState(this.quotaUnavailable(now) ? "BRIDE" : "REPOS"); return; }
    const interactive = this.probeInteractive(now);           // UNE sonde pour tout ce tour de décision
    const task = this.nextRunnableTask(now, interactive);
    if (!task) { this.setState(this.baseline(now, interactive)); return; }
    await this.runTask(task);
    if (this.quiescing) return; // NIT tour 2 : ne pas re-sonder (execFileSync bloquant) dans la fenêtre d'arrêt
    const after = this.now();
    this.setState(this.baseline(after, this.probeInteractive(after))); // l'activité a pu changer pendant le run
  }

  /**
   * Exécute une tâche par UNITÉS découpées, en cédant ENTRE les unités (jamais au milieu — technique/00 §4.4). Chaque
   * unité : travail async HORS transaction (dans runUnit) → commit atomique écriture+curseur (ctx.commitUnit). Préemption
   * (Yohann revient / budget épuisé / arrêt) → on s'arrête APRÈS l'unité committée ; `owed` reste 1 si pas fini → rattrapage
   * AU CURSEUR (jamais à zéro). Une unité en échec ne committe RIEN de partiel (commitUnit atomique) → même rattrapage.
   */
  private async runTask(task: BackgroundTask): Promise<void> {
    this.running = true;
    this.setState("FOND_EN_COURS");
    try {
      let done = false;
      while (!done) {
        // Céder au MACROTASK avant chaque unité : une runUnit qui se résout sans I/O réelle ne draine que les microtâches
        // → la boucle affamerait le reste de l'event loop (tick, quiesce, battement superviseur, garde-fou d'arrêt) →
        // hang non récupérable pour une tâche toujours due (croisé conv 37). Assurance cheap (~0 ms).
        await new Promise((r) => setImmediate(r));
        const now = this.now();
        if (this.quiescing) break;                          // ⑩ : arrêt demandé → céder après l'unité précédente
        if (this.writesSuspended()) break;                  // base devenue douteuse EN COURS (SANS_ECRITURE runtime, 03) → céder (owed=1)
        const interactive = this.probeInteractive(now);     // UNE sonde par unité (la préemption se juge ENTRE les unités)
        if (!this.canRun(task, now, interactive)) break;    // interactif revenu / budget épuisé / secours / plus dû → céder
        // (interactive est forcément false ici — canRun l'exige — donc l'indice coopératif ne s'allume que pour le
        //  quiesce ; explicite pour ne pas tromper le lecteur, NIT croisé conv 37.)
        this.preempt = this.quiescing;
        const wm = readWatermark(this.db, task.task);
        let result: { done: boolean };
        try {
          result = await task.runUnit(this.makeUnitContext(task, wm)); // TRAVAIL async + commitUnit atomique DEDANS
        } catch (e) {
          this.log(`tâche ${task.task} : unité en échec (${(e as Error).message}) — rien de partiel, rattrapage au curseur`);
          try { this.audit.append({ evt: "governor.unit.error", task: task.task, ts: this.now() }); } catch { /* */ }
          this.noteFailure(task.task, now); // backoff : ne pas re-spinner toutes les tickIntervalMs sur une tâche cassée
          break; // owed reste 1 (pas de commit `done`) → la tâche est reprise plus tard AU CURSEUR
        }
        this.taskFailures.delete(task.task); // une unité RÉUSSIE efface le compteur d'échecs (self-heal, miroir superviseur)
        done = result.done;
      }
    } finally {
      this.running = false;
      this.preempt = false;
    }
  }

  /** Backoff exponentiel plafonné par tâche après un échec d'unité : la tâche entre en cooldown (canRun la saute) pour ne
   *  pas re-spinner toutes les tickIntervalMs. Réinitialisé par une unité réussie. En MÉMOIRE (au reboot on ré-essaie —
   *  sûr : owed=1 la garde due). Miroir du disjoncteur du superviseur (T3), adapté à une tâche de fond non critique. */
  private noteFailure(task: string, now: number): void {
    const f = this.taskFailures.get(task) ?? { count: 0, until: 0 };
    f.count++;
    f.until = now + Math.min(this.o.taskBackoffCapMs, this.o.taskBackoffBaseMs * 2 ** (f.count - 1));
    this.taskFailures.set(task, f);
  }

  private makeUnitContext(task: BackgroundTask, wm: Watermark | null): UnitContext {
    const self = this;
    return {
      get preemptRequested(): boolean { return self.preempt; },
      recordAutonomousCall: (kind?: string): void => self.recordCall("autonome", kind),
      commitUnit: (businessWrites: (db: DatabaseSync) => void, done: boolean): void => {
        self.commitUnit(task.task, wm, businessWrites, done);
      },
    };
  }

  /**
   * Le commit ATOMIQUE d'une unité — patron PROUVÉ au banc t7. FULL armé HORS transaction (le PRAGMA est ignoré DANS
   * une transaction), BEGIN IMMEDIATE, écriture métier + avance du curseur (last_run_at + owed) dans la MÊME transaction,
   * COMMIT, retour NORMAL. Jette si une transaction traîne (invariant ② : jamais d'await transaction ouverte).
   */
  private commitUnit(task: string, wmBefore: Watermark | null, businessWrites: (db: DatabaseSync) => void, done: boolean): void {
    if (this.db.isTransaction) {
      throw new Error("commitUnit : une transaction est déjà ouverte → l'unité ne serait pas atomique (invariant : jamais d'await transaction en vol)");
    }
    const now = this.now();
    const owed = done ? 0 : 1;
    const owedSince = done ? null : (wmBefore?.owed_since ?? now); // owed_since PERSISTE tant que c'est dû (âge du backlog)
    try {
      setSynchronous(this.db, "FULL"); // DANS le try (NIT tour 2) : le finally restaure NORMAL même si ce PRAGMA jette
      this.db.exec("BEGIN IMMEDIATE");
      try {
        businessWrites(this.db); // les écritures MÉTIER de la tâche (incl. son propre curseur métier) — SYNCHRONES
        this.db.prepare(
          "UPDATE governor_watermarks SET last_run_at=?, owed=?, owed_since=? WHERE task=?",
        ).run(now, owed, owedSince, task);
        this.db.exec("COMMIT");
      } catch (e) {
        try { if (this.db.isTransaction) this.db.exec("ROLLBACK"); } catch { /* rien de partiel */ }
        throw e;
      }
    } finally {
      try { setSynchronous(this.db, "NORMAL"); } catch { /* cosmétique ; base peut-être fermée */ }
    }
  }

  /**
   * ⑩ (couture T7↔T6) : QUIESCER avant l'arrêt propre. Coupe la boucle (plus de nouvelle unité) et ATTEND que l'unité
   * en cours finisse — son commit atomique est SYNCHRONE, donc à la fin de l'unité `isTransaction===false` et
   * `writeCleanShutdown` passera. Borné en dernier ressort par le garde-fou global de before-quit (une unité figée sur
   * un appel Claude ne bloque pas l'arrêt indéfiniment). Idempotent.
   */
  async quiesce(graceMs = 5000): Promise<void> {
    // Défaut 5000 aligné sur ce que before-quit passe (NIT tour 3 : un seul défaut) — laisse la marge pour le reste de la
    // séquence d'arrêt (ack sidecar + SIGTERM→SIGKILL ~3-4 s) sous le garde-fou global de before-quit (10 s).
    this.quiescing = true;
    this.stopTimer();
    this.preempt = true; // indice coopératif : l'unité en cours devrait finir vite
    // Deadline en temps RÉEL (Date.now), PAS l'horloge métier injectée `now` : c'est un timeout de SÛRETÉ (le sleep est
    // réel aussi) — un `now` figé (tests) ne bornerait jamais l'attente → boucle infinie (solo conv 37). La vraie borne
    // d'arrêt reste le garde-fou global de before-quit (10 s) ; ceci évite juste d'y arriver quand l'unité finit vite.
    const deadline = Date.now() + graceMs;
    while (this.running && Date.now() < deadline) await sleep(25);
    if (this.running) this.log("quiesce : l'unité en cours n'a pas fini dans le délai — le garde-fou global de l'arrêt tranchera");
    // Le fond est arrêté : l'état ne reste pas figé sur FOND_EN_COURS (NIT tour 3). REPOS = plus aucune tâche en cours ;
    // on ne re-sonde pas l'activité (on s'arrête). Inerte au socle (pas d'onState en prod), mais propre si l'UI l'observe.
    this.setState("REPOS");
    try { this.audit.append({ evt: "governor.quiesce", clean: !this.running, ts: this.now() }); } catch { /* */ }
  }
}

/**
 * Adaptateur d'activité RÉEL, thin, ZÉRO-DÉPENDANCE (vérifié à la source, conv 37) — patron du superviseur (tasklist +
 * powershell). BEST-EFFORT et NON-FATAL : sur erreur, renvoie le défaut (prudent : « interactif » → on ne prend pas le
 * risque de faire tourner le fond dans le doute).
 *
 * ⚠️ FRONTIÈRE 05 (croisé conv 37) : `execFileSync` BLOQUE l'event loop (~90–400 ms, jusqu'au timeout en cas de pépin).
 * Au socle c'est INERTE (la sonde n'est appelée que s'il y a une tâche due, et TASKS est vide). MAIS avant de câbler une
 * VRAIE tâche (02/04), `05` DOIT passer à un CACHE rafraîchi en ASYNC (spawn non bloquant ; la closure lit une valeur
 * mémoïsée) : sinon un blocage prolongé affame le BATTEMENT du superviseur (T3) → faux « figé » → respawn du sidecar
 * (perte CUDA/voix). CALIBRATION 05 : la LISTE des process « interactifs » (⚠️ `code.exe` = VS Code), le SEUIL d'idle,
 * la fréquence de sonde, et ce cache async. Frontière tracée plan/00 §7.
 */
export function realActivityProbe(opts: {
  idleThresholdMs?: number;      // en-deçà = Yohann actif (défaut 60 s)
  interactiveProcesses?: string[]; // noms d'image « Claude Code actif » (défaut : claude/code)
  defaultOnError?: boolean;      // valeur si la sonde échoue (défaut true = prudent)
  onLog?: (l: string) => void;
} = {}): ActivityProbe {
  const idleThresholdMs = opts.idleThresholdMs ?? 60_000;
  const procs = (opts.interactiveProcesses ?? ["claude.exe", "code.exe"]).map((p) => p.toLowerCase());
  const idleScript = [
    'Add-Type @"',
    "using System; using System.Runtime.InteropServices;",
    "public static class Idle {",
    "  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }",
    '  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);',
    "  public static uint Ms(){ LII l=new LII(); l.cbSize=(uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return ((uint)Environment.TickCount)-l.dwTime; }",
    "}",
    '"@',
    "[Idle]::Ms()",
  ].join("\n");
  return (): ActivitySignal => {
    try {
      // « Claude Code actif » : un process interactif connu tourne.
      const tl = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 4000 }).toLowerCase();
      if (procs.some((p) => tl.includes(`"${p}"`))) return { interactive: true };
      // « Yohann actif » : input clavier/souris récent.
      const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", idleScript], { encoding: "utf8", windowsHide: true, timeout: 6000 });
      const idleMs = parseInt(out.trim(), 10);
      return { interactive: Number.isFinite(idleMs) ? idleMs < idleThresholdMs : (opts.defaultOnError ?? true) };
    } catch (e) {
      opts.onLog?.(`sonde d'activité: ${(e as Error).message} → défaut prudent`);
      return { interactive: opts.defaultOnError ?? true };
    }
  };
}
