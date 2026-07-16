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
const { gracefulShutdown } = require("../../dist/src/orchestrator/shutdown/index.js");
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
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

// T6 — arrêt GRACIEUX déclenché par un message IPC (child.send({cmd:"shutdown"})). Le harnais s'en sert pour
// prouver, en cœur réel, « arrêt propre -> réveil propre » : c'est le VRAI gracefulShutdown (cmd.shutdown au
// vrai sidecar Python -> terminate -> running=0 -> teardown). On passe par un message IPC et non SIGTERM car
// SIGTERM ne réveille pas ce handler sur Windows (TerminateProcess, mesuré au banc t6).
async function doGracefulShutdown() {
  await gracefulShutdown({
    db: out.db.raw,
    paths,
    beginSidecarShutdown: () => supervisor.beginShutdown(),
    sendShutdown: async () => {
      const c = new IpcClient();
      try {
        await c.connect(supervisor.port);
        const ack = await c.request("cmd.shutdown", {});
        // Preuve « cœur réel » : le VRAI sidecar a acquitté cmd.shutdown (donc graceful_release a tourné).
        emit({ evt: "cmd-shutdown-ack", ok: !!(ack && ack.type === "evt.ack") });
      } finally { c.close(); }
    },
    terminateSidecar: (graceMs) => supervisor.terminate(graceMs),
    teardown: () => out.shutdown(),
    onLog: (l) => console.error("[shutdown] " + l),
  });
}
// Sortie APRÈS vidage du stdout : process.exit() tronque les écritures bufferisées (l'ack cmd-shutdown est
// émis plus tôt, dans sendShutdown) -> on attend le drain avant de sortir, avec un filet de temps. MINEUR
// croisé conv 36 (l'ack est l'unique preuve « cœur réel » que le vrai sidecar a coopéré).
function exitAfterFlush(code) {
  let done = false;
  const go = () => { if (done) return; done = true; process.exit(code); };
  if (process.stdout.writableLength === 0) go();
  else process.stdout.once("drain", go);
  setTimeout(go, 1000);
}
process.on("message", (m) => {
  if (m && m.cmd === "shutdown") void doGracefulShutdown().finally(() => exitAfterFlush(0));
});

// Arrêt ABRUPT sur SIGTERM (E2E-1/3/4 : « stop gentil ». Sur Windows = TerminateProcess -> ce handler ne
// tourne pas ; le job object tue le sidecar avec le worker. Conservé comme courtoisie POSIX / hors Windows).
process.on("SIGTERM", () => {
  try { out.shutdown(); } catch { /* */ }
  void supervisor.stop().finally(() => process.exit(0));
});
setInterval(() => { /* garde le process vivant */ }, 1 << 30);
