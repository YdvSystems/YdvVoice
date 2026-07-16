// Câblage de l'ARRÊT PROPRE côté Electron (socle T6) — extrait de main.ts pour être testable en cœur réel.
//
// C'est la glu entre le signal d'extinction Windows (`before-quit`) et le module d'arrêt Node-pur
// (`gracefulShutdown`). Extrait ici (⑥ re-croisé conv 36) pour qu'un smoke Electron réel l'exerce
// (bancs/t6/smoke-electron) : main.ts n'est couvert par aucun test unitaire, et le garde ré-entrant
// (l'ancien MAJEUR ①) + le garde-fou global (⑨) + la porte de vivacité (⑤) doivent être PROUVÉS en vrai.
//
// La logique de DÉCISION (planBeforeQuit) et la séquence (gracefulShutdown) vivent dans le module Node-pur
// et sont testées à part ; ICI on ne câble que l'Electron-spécifique (preventDefault / app.exit / timer).

import type { App } from "electron";
import { IpcClient } from "../src/orchestrator/ipc/index.js";
import { gracefulShutdown, planBeforeQuit } from "../src/orchestrator/shutdown/index.js";
import type { BootOutcome } from "../src/orchestrator/boot/index.js";
import type { Supervisor } from "../src/orchestrator/supervisor/index.js";
import type { SophiaPaths } from "../src/orchestrator/paths.js";

export interface BeforeQuitDeps {
  /** Lu au moment du quit (session peut n'être PRIMARY qu'après le boot). */
  getSession: () => BootOutcome | null;
  supervisor: Supervisor;
  paths: SophiaPaths;
  /** ⑨ garde-fou global (défaut 10 s ; calibration §6 — fenêtre d'extinction Windows). */
  watchdogMs?: number;
}

/**
 * Installe le handler `before-quit` de l'arrêt propre (T6). Pour un PRIMARY : bloque TOUJOURS la sortie par
 * défaut (jamais un 2e quit qui abandonne l'arrêt en vol — ancien MAJEUR ①), lance UNE séquence gracieuse,
 * arme un garde-fou global (le process meurt toujours, même si un futur graceful_release CUDA se figeait),
 * et ne prévient le sidecar que s'il est prouvé vivant (⑤ : `currentState === "READY"`, pas un port périmé).
 * La seule sortie d'un PRIMARY est l'`app.exit(0)` de la séquence (le garde-fou force-exit(1) sinon).
 */
export function installBeforeQuit(app: App, deps: BeforeQuitDeps): void {
  const watchdogMs = deps.watchdogMs ?? 10000;
  let quitting = false;

  app.on("before-quit", (e) => {
    const s = deps.getSession();
    const plan = planBeforeQuit(s?.kind === "PRIMARY", quitting);
    if (plan.prevent) e.preventDefault();
    if (!plan.run || s?.kind !== "PRIMARY") return; // `s?.kind` re-narrow pour TS (plan.run implique PRIMARY)
    quitting = true;

    const watchdog = setTimeout(() => {
      console.error("arret : garde-fou global -> force-exit");
      app.exit(1); // running reste 1 -> réveil « sale » (honnête), mais le process MEURT toujours
    }, watchdogMs);

    void gracefulShutdown({
      db: s.db.raw,
      paths: deps.paths,
      beginSidecarShutdown: () => deps.supervisor.beginShutdown(),
      sendShutdown: deps.supervisor.currentState === "READY" ? async () => {
        const client = new IpcClient();
        try { await client.connect(deps.supervisor.port); await client.request("cmd.shutdown", {}); }
        finally { client.close(); }
      } : undefined,
      terminateSidecar: (graceMs) => deps.supervisor.terminate(graceMs),
      teardown: () => s.shutdown(),
      onLog: (l) => console.log(l),
    }).finally(() => { clearTimeout(watchdog); app.exit(0); });
  });
}
