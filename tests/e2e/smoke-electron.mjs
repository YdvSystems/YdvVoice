// SMOKE Electron (test committé — `npm run smoke`) — lance le VRAI câblage `installBeforeQuit` (via
// smoke-main.cjs) + vrai sidecar, quit auto, et vérifie sur DISQUE l'arrêt propre (running=0) + le réveil
// « propre » au reboot. C'est le chemin que ni npm test ni l'E2E (worker Node) n'exercent : app.quit() ->
// before-quit d'Electron RÉEL -> gracefulShutdown. Ferme le trou de couverture ⑥ (croisé conv 36). Nécessite
// Electron + le venv sidecar (comme l'E2E) -> HORS `npm test` (portable). Scrub ELECTRON_RUN_AS_NODE (cf.
// scripts/dev-electron.mjs).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..", "..");
const smokeMain = path.join(dir, "smoke-main.cjs");
const home = path.join(root, ".sophia-home-dev", "smoke-electron");
fs.rmSync(home, { recursive: true, force: true });

const env0 = { ...process.env };
delete env0.ELECTRON_RUN_AS_NODE;

const results = [];
const check = (n, c) => { results.push([n, !!c]); console.log(`${c ? "OK  " : "FAIL"}  ${n}`); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

function runElectron(quitMs) {
  return new Promise((resolve) => {
    const env = { ...env0, SOPHIA_HOME: home, SOPHIA_SMOKE_QUIT_MS: String(quitMs) };
    const child = spawn(electronPath, [smokeMain], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { out += String(d); });
    const hard = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, 40000);
    child.on("exit", (code) => { clearTimeout(hard); resolve({ code, out }); });
  });
}
function readOutcome() { try { return JSON.parse(fs.readFileSync(path.join(home, "smoke-outcome.json"), "utf8")); } catch { return null; } }
function readFlag() {
  try { const db = new DatabaseSync(path.join(home, "db", "sophia.sqlite"), { readOnly: true }); const r = db.prepare("SELECT running, last_clean_shutdown_at AS lc FROM runtime_flags WHERE id=1").get(); db.close(); return r; } catch { return null; }
}
function sidecarPid() { try { return parseInt(fs.readFileSync(path.join(home, "sidecar.pid"), "utf8").trim().split(/\s+/)[0], 10); } catch { return 0; } }
function auditHasSale() { try { return fs.readFileSync(path.join(home, "audit.jsonl"), "utf8").includes("REVEIL_SALE"); } catch { return false; } }

// ── Run 1 : boot réel -> quit auto -> arrêt propre (le VRAI before-quit -> gracefulShutdown) ──
const r1 = await runElectron(2500);
const o1 = readOutcome();
check("smoke run1 : Electron sort proprement (exit 0)", r1.code === 0);
check("smoke run1 : boot réel PRÊT, réveil « premier »", o1 && o1.kind === "PRIMARY" && o1.phase === "PRET" && o1.wake === "premier");
const flag = readFlag();
check("smoke run1 : le VRAI before-quit a posé running=0 (arrêt propre sur disque)", flag && flag.running === 0);
check("smoke run1 : last_clean_shutdown_at horodaté", flag && typeof flag.lc === "number" && flag.lc > 0);
const pid1 = sidecarPid();
check("smoke run1 : aucun orphelin sidecar (pidfile retiré / pid mort)", pid1 === 0 || !alive(pid1));

// ── Run 2 : reboot réel -> réveil « propre », zéro fausse alarme ──
const r2 = await runElectron(2500);
const o2 = readOutcome();
check("smoke run2 : Electron sort proprement (exit 0)", r2.code === 0);
check("smoke run2 : reboot réel PRÊT, réveil « propre » (le vrai I-6 en Electron)", o2 && o2.phase === "PRET" && o2.wake === "propre");
check("smoke run2 : AUCUNE fausse alarme REVEIL_SALE (audit propre)", !auditHasSale());
check("smoke run2 : running=0 de nouveau posé (2e arrêt propre)", (readFlag() || {}).running === 0);

fs.rmSync(home, { recursive: true, force: true });
const failed = results.filter(([, ok]) => !ok);
console.log(`\n--- smoke Electron (T6, câblage réel) : ${results.length - failed.length}/${results.length} ---`);
if (failed.length === 0) console.log("SMOKE OK : le vrai before-quit Electron déroule l'arrêt propre (cœur réel)");
else { console.error("SMOKE ÉCHEC : sortie stdout du dernier run ci-dessous\n" + (r2 && r2.out ? r2.out.slice(-2000) : "")); }
process.exit(failed.length ? 1 : 0);
