// Smoke : node:sqlite fonctionne-t-il DANS le process main d'Electron ?
// (Valide le choix de binding : meme code Node + Electron, zero rebuild natif.)
// Headless : aucune fenetre, ouvre la base via le module socle, verifie, quitte.
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");

app.whenReady().then(() => {
  let ok = false;
  let detail = "";
  const p = path.join(__dirname, "..", ".sophia-home-dev", "electron-smoke.sqlite");
  try {
    const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
    const db = openDatabase(p);
    const n = db.raw.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'").get().c;
    const jm = String(db.raw.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase();
    ok = n >= 4 && jm === "wal";
    detail = `tables=${n} journal_mode=${jm}`;
    db.close();
  } catch (e) {
    detail = e.message;
  } finally {
    for (const f of [p, `${p}-wal`, `${p}-shm`]) {
      try { fs.rmSync(f); } catch { /* absent */ }
    }
  }
  console.log(ok ? `ELECTRON node:sqlite OK (${detail})` : `ELECTRON node:sqlite ECHEC : ${detail}`);
  app.exit(ok ? 0 : 1);
});
