// Smoke Electron minimal (test committé — `npm run smoke`) : le VRAI câblage `installBeforeQuit` + boot réel
// + superviseur réel + vrai sidecar Python, SANS Tray ni fenêtre (headless propre). Quitte tout seul après
// SOPHIA_SMOKE_QUIT_MS -> exerce le chemin `before-quit` -> `gracefulShutdown` en Electron RÉEL (ce que ni
// npm test ni l'E2E worker-Node n'atteignent — le trou de couverture ⑥ du croisé conv 36). Écrit l'issue du
// boot dans un fichier (observable déterministe). Le déclencheur de quit vit ICI (harnais), jamais dans main.ts.
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { boot } = require("../../dist/src/orchestrator/boot/index.js");
const { Supervisor } = require("../../dist/src/orchestrator/supervisor/index.js");
const { resolvePaths } = require("../../dist/src/orchestrator/paths.js");
const { installBeforeQuit } = require("../../dist/electron/before-quit.js");

app.disableHardwareAcceleration();
const root = path.join(__dirname, "..", "..");
const paths = resolvePaths(process.env.SOPHIA_HOME);
let session = null;

const supervisor = new Supervisor({
  python: path.join(root, ".venv-sidecar", "Scripts", "python.exe"),
  script: "sidecar/server.py",
  cwd: root,
  pidfile: paths.sidecarPidfile,
  onLog: (l) => console.log("[sup] " + l),
});

// LE VRAI câblage partagé avec main.ts (before-quit.ts) — c'est lui qu'on prouve ici.
installBeforeQuit(app, { getSession: () => session, supervisor, paths });

app.on("window-all-closed", () => { /* on reste en vie ; le quit vient du timer smoke */ });

app.whenReady().then(async () => {
  const outcome = await boot({
    paths,
    onLog: (l) => console.log("[boot] " + l),
    onAlert: (a) => console.log("[alert] " + a.code),
    hooks: {
      reapSidecarOrphan: () => supervisor.orphanCleanup(),
      sidecarStart: async () => { await supervisor.start(); return supervisor.currentState === "READY"; },
    },
  });
  const rec = { kind: outcome.kind, phase: outcome.state ? outcome.state.phase : null, wake: outcome.state ? outcome.state.wake : null };
  try { fs.writeFileSync(path.join(paths.home, "smoke-outcome.json"), JSON.stringify(rec)); } catch (e) { console.error(e.message); }
  console.log("[outcome] " + JSON.stringify(rec) + " port=" + supervisor.port + " pid=" + supervisor.pid);

  if (outcome.kind !== "PRIMARY") { app.exit(outcome.kind === "BLOCKED" ? 2 : 0); return; }
  session = outcome;
  const quitMs = Number(process.env.SOPHIA_SMOKE_QUIT_MS) || 2500;
  setTimeout(() => app.quit(), quitMs); // -> before-quit -> installBeforeQuit -> gracefulShutdown -> app.exit
}).catch((e) => { console.error("[boot] échec " + e.message); app.exit(3); });
