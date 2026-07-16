// Smoke Electron minimal (test committé — `npm run smoke`) : exerce le VRAI câblage `SophiaRuntime` (le MÊME que main.ts :
// superviseur + boot + gouverneur + arrêt propre, dont la couture ⑩ getGovernor), SANS Tray ni fenêtre (headless propre).
// Quitte tout seul après SOPHIA_SMOKE_QUIT_MS -> exerce `before-quit` -> `gracefulShutdown` en Electron RÉEL (ce que ni
// npm test ni l'E2E worker-Node n'atteignent). Depuis le croisé conv 37 tour 2, le smoke n'est PLUS une copie du câblage :
// il importe `SophiaRuntime`, si bien qu'une régression de main.ts (ex. getGovernor oublié) serait vue ici. Écrit l'issue
// du boot dans un fichier (observable déterministe). Le déclencheur de quit vit ICI (harnais), jamais dans le runtime.
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { SophiaRuntime } = require("../../dist/electron/runtime.js");
const { resolvePaths } = require("../../dist/src/orchestrator/paths.js");

app.disableHardwareAcceleration();
const root = path.join(__dirname, "..", "..");
const paths = resolvePaths(process.env.SOPHIA_HOME);

// LE VRAI câblage partagé avec main.ts — c'est lui qu'on prouve ici (getGovernor ⑩ compris). `appRoot` = repo root
// (en prod, main.ts passe app.getAppPath()).
const runtime = new SophiaRuntime(app, paths, root, {
  onAlert: (a) => console.log("[alert] " + a.code),
  onLog: (l) => console.log("[rt] " + l),
});

app.on("window-all-closed", () => { /* on reste en vie ; le quit vient du timer smoke */ });

app.whenReady().then(async () => {
  const outcome = await runtime.run();
  const rec = { kind: outcome.kind, phase: outcome.state ? outcome.state.phase : null, wake: outcome.state ? outcome.state.wake : null };
  try { fs.writeFileSync(path.join(paths.home, "smoke-outcome.json"), JSON.stringify(rec)); } catch (e) { console.error(e.message); }
  console.log("[outcome] " + JSON.stringify(rec) + " port=" + runtime.supervisor.port + " pid=" + runtime.supervisor.pid);

  if (outcome.kind !== "PRIMARY") { app.exit(outcome.kind === "BLOCKED" ? 2 : 0); return; }
  const quitMs = Number(process.env.SOPHIA_SMOKE_QUIT_MS) || 2500;
  setTimeout(() => app.quit(), quitMs); // -> before-quit (installé par SophiaRuntime) -> gracefulShutdown -> app.exit
}).catch((e) => { console.error("[boot] échec " + e.message); app.exit(3); });
