// tests/e2e/boot-worker.mjs — un VRAI process Sophia pour l'E2E « cœur réel ».
//
// Il fait un boot() COMPLET avec le VRAI superviseur qui spawn le VRAI sidecar Python (pas de bouchon,
// contrairement à I-T5). C'est le câblage réel : boot -> superviseur -> sidecar -> IPC -> disque, sans
// Electron (le systray/voyant est de la vue dérivée, vérifié à part). Il communique son état au harnais
// par stdout (une ligne JSON par événement) et RESTE VIVANT après PRÊT (il « sert ») jusqu'à :
//   · SIGTERM -> arrêt volontaire (shutdown T5 : ferme la base + le sidecar ; NB : T5 ne pose pas
//     running=0 — c'est T6, donc un réveil après SIGTERM est encore « sale », c'est attendu) ;
//   · SIGKILL -> coupure DURE réelle (le harnais laisse alors un sidecar orphelin à récupérer au reboot).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { boot } = require("../../dist/src/orchestrator/boot/index.js");
const { Supervisor } = require("../../dist/src/orchestrator/supervisor/index.js");
const { resolvePaths } = require("../../dist/src/orchestrator/paths.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = process.argv[2];
if (!home) { console.error("usage: boot-worker <home>"); process.exit(3); }
const paths = resolvePaths(home);
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

const supervisor = new Supervisor({
  python: path.join(root, ".venv-sidecar", "Scripts", "python.exe"),
  script: "sidecar/server.py",
  cwd: root,
  pidfile: paths.sidecarPidfile,
  onLog: (l) => console.error("[sup] " + l),
  onReady: (port, pid) => emit({ evt: "sidecar-ready", port, pid }), // refire à CHAQUE respawn
});

const out = await boot({
  paths,
  onState: (s) => emit({ evt: "state", phase: s.phase, degraded: s.degraded, wake: s.wake }),
  onAlert: (a) => emit({ evt: "alert", code: a.code }),
  onLog: (l) => console.error("[boot] " + l),
  hooks: {
    reapSidecarOrphan: () => supervisor.orphanCleanup(),
    sidecarStart: async () => { await supervisor.start(); return supervisor.currentState === "READY"; },
  },
});

if (out.kind !== "PRIMARY") {
  emit({ evt: "outcome", kind: out.kind, reason: out.reason ?? null });
  process.exit(out.kind === "BLOCKED" ? 2 : 0); // SECONDARY = 0, BLOCKED = 2
}

emit({
  evt: "outcome", kind: "PRIMARY",
  phase: out.state.phase, wake: out.state.wake, degraded: out.state.degraded,
  sidecarPort: supervisor.port, sidecarPid: supervisor.pid,
});

// Il SERT. Arrêt volontaire sur SIGTERM (le harnais l'utilise pour un arrêt « gentil » ; SIGKILL = dur).
process.on("SIGTERM", () => {
  try { out.shutdown(); } catch { /* */ }
  void supervisor.stop().finally(() => process.exit(0));
});
setInterval(() => { /* garde le process vivant */ }, 1 << 30);
