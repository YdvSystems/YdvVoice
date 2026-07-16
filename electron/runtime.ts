// electron/runtime.ts — le câblage runtime PARTAGÉ entre main.ts (prod) et le smoke (test).
//
// UNE seule source de vérité pour brancher : superviseur (T3) + boot (T5) + gouverneur (T7) + arrêt propre (T6, dont la
// couture ⑩ `getGovernor`). Le smoke exerce ainsi le VRAI câblage, pas une COPIE de main.ts (croisé conv 37 tour 2 : le
// smoke ne doit pas prouver un doublon — sinon une régression de main.ts passerait au vert). L'appelant fournit `appRoot`
// (app.getAppPath() en prod ; repo root en test) et les hooks d'AFFICHAGE (systray en prod ; fichier outcome en test) ;
// TOUTE la logique d'état (superviseur↔dégradations, boot, gouverneur, arrêt) vit ici — main.ts n'est plus que la VUE.

import type { App } from "electron";
import * as path from "node:path";
import { boot as bootCore } from "../src/orchestrator/boot/index.js";
import type { BootOutcome, BootStateSnapshot, BootAlert } from "../src/orchestrator/boot/index.js";
import { Supervisor } from "../src/orchestrator/supervisor/index.js";
import { Governor, reconstructQueue } from "../src/orchestrator/governor/index.js";
import type { BackgroundTask } from "../src/orchestrator/governor/index.js";
import { installBeforeQuit } from "./before-quit.js";
import type { SophiaPaths } from "../src/orchestrator/paths.js";

// Registre des tâches de fond. VIDE au socle : les vraies (consolidation 02, proactif/rêverie 04) s'y brancheront comme
// CLIENTS de la mécanique du gouverneur (« pas de MVP, la mécanique est complète » — plan T7). À vide, le gouverneur est
// inoffensif (rien de dû → aucune sonde d'activité, aucun travail).
const TASKS: BackgroundTask[] = [];

/** Hooks d'AFFICHAGE fournis par l'appelant (l'UI observe, jamais une 2e vérité — plan/99 O5). */
export interface RuntimeDisplay {
  onState?: (s: BootStateSnapshot) => void;
  onAlert?: (a: BootAlert) => void;
  onFocusRequested?: () => void; // une 2e instance demande à voir Sophia
  onLog?: (l: string) => void;
}

export class SophiaRuntime {
  private session: BootOutcome | null = null;
  private governor: Governor | null = null;
  readonly supervisor: Supervisor;

  constructor(app: App, private readonly paths: SophiaPaths, appRoot: string, private readonly display: RuntimeDisplay = {}) {
    this.supervisor = new Supervisor({
      python: path.join(appRoot, ".venv-sidecar", "Scripts", "python.exe"),
      script: "sidecar/server.py",
      cwd: appRoot,
      pidfile: paths.sidecarPidfile,
      onLog: display.onLog,
      onReady: () => {
        // Le sidecar est (re)devenu READY : lever un SANS_VOIX posé (sidecar lent au boot, ou disjoncteur rétabli) via la
        // SEULE source d'état → l'UI se met à jour par onState. Au 1er boot, onReady précède l'affectation de session
        // → rien à lever (pas de trou). R2, croisé conv 35.
        if (this.session?.kind === "PRIMARY") this.session.runtime.clearDegradation("SANS_VOIX");
      },
      onDegraded: () => {
        // Disjoncteur ouvert APRÈS le boot : la voix tombe en cours de route. On le dit à la SEULE source (jamais un état
        // local ici → jamais deux vérités, O5). Pendant le boot, c'est le retour `false` de sidecarStart qui porte la dégradation.
        if (this.session?.kind !== "PRIMARY") return;
        this.session.runtime.markDegraded("SANS_VOIX");
        this.session.runtime.alert({ code: "VOIX_PERDUE", message: "J'ai perdu mes oreilles et ma voix — je suis toujours là, mais tu vas devoir m'écrire." });
      },
    });
    // LE câblage d'arrêt (T6) — un seul endroit : `getGovernor` (couture ⑩) ne peut plus être oublié dans un point d'entrée.
    installBeforeQuit(app, { getSession: () => this.session, getGovernor: () => this.governor, supervisor: this.supervisor, paths });
  }

  getSession(): BootOutcome | null { return this.session; }
  getGovernor(): Governor | null { return this.governor; }

  /** Lance le boot (Node pur) ; si PRIMARY, démarre la boucle d'arbitrage du gouverneur (après PRÊT). Retourne l'outcome. */
  async run(): Promise<BootOutcome> {
    const outcome = await bootCore({
      paths: this.paths,
      onState: this.display.onState,
      onAlert: this.display.onAlert,
      onLog: this.display.onLog,
      onFocusRequested: this.display.onFocusRequested,
      hooks: {
        // Phase 2 — tuer un sidecar orphelin d'un crash précédent AVANT de spawner (F1 ; le Supervisor re-nettoie au start).
        reapSidecarOrphan: () => this.supervisor.orphanCleanup(),
        // Phase 5 — le sidecar (T3). Un échec ne fait pas tomber le boot : elle vit sans voix.
        sidecarStart: async () => { await this.supervisor.start(); return this.supervisor.currentState === "READY"; },
        // Phase 4 — le gouverneur PROGRAMME les tâches dues, n'en LANCE aucune pendant le boot (§4.1 Phase 4). La boucle
        // d'arbitrage démarre après PRÊT (ci-dessous). T7.
        governorInit: (db) => reconstructQueue(db, TASKS, () => Date.now()),
        // Phases 1-3 (02/03) + Phase 4 claudeInit (T8) + Phase 5 enroll/prewarm/tts.cache (01/05) : définis plus tard.
      },
    });
    if (outcome.kind === "PRIMARY") {
      this.session = outcome;
      // T7 — la boucle d'arbitrage démarre APRÈS PRÊT (Phase 6). Le gouverneur partage la connexion d'écriture UNIQUE
      // (outcome.db.raw — pas une 2e ouverture). Au socle, TASKS est vide → à vide. SANS_ECRITURE (base douteuse, aussi
      // atteignable au runtime via l'ancre 03) relu dynamiquement → aucune écriture (A15). Quiescé à l'arrêt (⑩).
      this.governor = new Governor({
        db: outcome.db.raw, paths: this.paths, tasks: TASKS,
        writesSuspended: () => outcome.runtime.current().degraded.includes("SANS_ECRITURE"),
        onLog: this.display.onLog,
      });
      this.governor.start();
    }
    return outcome;
  }
}
