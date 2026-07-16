// U-T6 — l'arrêt propre (le « bonne nuit »). Vérifie, séparément puis en intégration :
//   · writeCleanShutdown : running=0 + last_clean_shutdown_at, durable ;
//   · gracefulShutdown : l'ORDRE (begin -> send -> terminate -> writeClean -> teardown) ; robustesse
//     (sendShutdown absent / qui rejette / qui fige -> on termine quand même, jamais bloqué) ;
//     died:false -> running=0 quand même (le drapeau = l'arrêt de l'ORCHESTRATEUR) ;
//   · FAIL-SAFE : si le drapeau propre ne peut être posé -> running RESTE 1 -> réveil « sale » ;
//   · I-6 (part boot) : boot -> gracefulShutdown -> reboot « propre », SANS fausse alarme ;
//   · Supervisor : beginShutdown (coupe le respawn) ; terminate (SIGTERM->SIGKILL, pidfile retiré si mort,
//     CONSERVÉ si kill impossible) — vrais sidecars.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const { gracefulShutdown, writeCleanShutdown, planBeforeQuit } = require("../dist/src/orchestrator/shutdown/index.js");
const { boot } = require("../dist/src/orchestrator/boot/index.js");
const { Supervisor } = require("../dist/src/orchestrator/supervisor/index.js");
const { resolvePaths } = require("../dist/src/orchestrator/paths.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const base = path.join(root, ".sophia-home-dev", "t6");
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });

const results = [];
const check = (n, c) => results.push([n, !!c]);
let n = 0;
const freshHome = () => { const h = path.join(base, `h${++n}`); fs.mkdirSync(h, { recursive: true }); return resolvePaths(h); };
const aliveP = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function until(cond, timeoutMs, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(stepMs); }
  return false;
}
/** Relit le drapeau runtime en lecture seule (base fermée). */
function readFlag(p) {
  const r = openDatabase(p.db, { readOnly: true });
  const row = r.raw.prepare("SELECT running, last_clean_shutdown_at AS lc FROM runtime_flags WHERE id=1").get();
  r.close();
  return row;
}
const bootHooks = { loadAndVerifyIdentity: () => ({ present: true, anchorOk: true }), sidecarStart: async () => true };

// ─── 1. writeCleanShutdown : le drapeau « propre » est durable ────────────────
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=1, started_at=? WHERE id=1").run(111);
  writeCleanShutdown(db.raw);
  db.close();
  const row = readFlag(p);
  check("writeCleanShutdown : running=0 + last_clean_shutdown_at posé, durable après réouverture",
    row.running === 0 && typeof row.lc === "number" && row.lc > 0);
}

// ─── 2. gracefulShutdown : l'ORDRE exact + writeClean AVANT teardown ──────────
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=1 WHERE id=1").run();
  const calls = [];
  await gracefulShutdown({
    db: db.raw, paths: p,
    beginSidecarShutdown: () => calls.push("begin"),
    sendShutdown: async () => { calls.push("send"); },
    terminateSidecar: async () => { calls.push("terminate"); return { died: true }; },
    teardown: () => { calls.push("teardown"); db.close(); },
  });
  check("ordre : begin -> send -> terminate -> teardown",
    JSON.stringify(calls) === JSON.stringify(["begin", "send", "terminate", "teardown"]));
  check("ordre : running=0 posé AVANT le teardown (drapeau propre entre terminate et close)", readFlag(p).running === 0);
}

// ─── 3. Robustesse : sendShutdown absent / rejette / fige -> on termine quand même ──
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=1 WHERE id=1").run();
  let terminated = false;
  await gracefulShutdown({ db: db.raw, paths: p, terminateSidecar: async () => { terminated = true; return { died: true }; }, teardown: () => db.close() });
  check("sendShutdown ABSENT (pas de voix) -> séquence tient : terminate + running=0", terminated && readFlag(p).running === 0);
}
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=1 WHERE id=1").run();
  let terminated = false;
  await gracefulShutdown({
    db: db.raw, paths: p,
    sendShutdown: async () => { throw new Error("sidecar injoignable"); },
    terminateSidecar: async () => { terminated = true; return { died: true }; },
    teardown: () => db.close(),
  });
  check("sendShutdown REJETTE -> on termine quand même + running=0", terminated && readFlag(p).running === 0);
}
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=1 WHERE id=1").run();
  let terminated = false;
  const t0 = Date.now();
  await gracefulShutdown({
    db: db.raw, paths: p,
    sendShutdown: () => new Promise(() => { /* ne résout JAMAIS (sidecar figé) */ }),
    sidecarAckTimeoutMs: 300,
    terminateSidecar: async () => { terminated = true; return { died: true }; },
    teardown: () => db.close(),
  });
  check("sendShutdown FIGÉ -> borné par le timeout, on termine (jamais bloqué par un sidecar figé)",
    terminated && Date.now() - t0 < 3000 && readFlag(p).running === 0);
}

// ─── 4. terminate died:false -> running=0 quand même + audit sidecar_reaped:false ──
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=1 WHERE id=1").run();
  await gracefulShutdown({ db: db.raw, paths: p, terminateSidecar: async () => ({ died: false }), teardown: () => db.close() });
  check("died:false (sidecar résiste) -> running=0 quand même (le drapeau = l'arrêt de l'ORCHESTRATEUR)", readFlag(p).running === 0);
  const audit = fs.readFileSync(p.audit, "utf8");
  check("audit : shutdown.clean avec sidecar_reaped=false (événement, jamais de contenu)",
    /"evt":"shutdown\.clean"/.test(audit) && /"sidecar_reaped":false/.test(audit));
}

// ─── 5. FAIL-SAFE : drapeau propre impossible -> running RESTE 1 -> réveil « sale » ──
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=1 WHERE id=1").run();
  db.close(); // handle fermé -> writeCleanShutdown va jeter
  let threw = false;
  try {
    await gracefulShutdown({ db: db.raw, paths: p, terminateSidecar: async () => ({ died: true }), teardown: () => { /* ne pas re-close */ } });
  } catch { threw = true; }
  check("fail-safe : writeCleanShutdown échoue -> gracefulShutdown NE JETTE PAS (jamais à moitié éteinte)", !threw);
  check("fail-safe : drapeau propre non posé -> running RESTE 1 -> réveil « sale » (jamais un faux « propre »)", readFlag(p).running === 1);
}

// ─── 6. I-6 (part boot) : boot -> gracefulShutdown -> reboot « propre », SANS fausse alarme ──
{
  const p = freshHome();
  const o1 = await boot({ paths: p, hooks: bootHooks });
  check("I-6 : 1er boot PRÊT (running=1 posé)", o1.kind === "PRIMARY" && o1.state.phase === "PRET");
  await gracefulShutdown({ db: o1.db.raw, paths: p, terminateSidecar: async () => ({ died: true }), teardown: () => o1.shutdown() });
  const alerts = [];
  const o2 = await boot({ paths: p, hooks: bootHooks, onAlert: (a) => alerts.push(a.code) });
  check("I-6 : après arrêt propre -> réveil « propre »", o2.state.wake === "propre");
  check("I-6 : AUCUNE fausse alarme REVEIL_SALE (le vrai I-6)", !alerts.includes("REVEIL_SALE"));
  check("I-6 : last_clean_shutdown_at posé", typeof readFlag(p).lc === "number" && readFlag(p).lc > 0);
  o2.shutdown();
}
{
  // Contrôle : un arrêt SANS gracefulShutdown (crash simulé = teardown seul) -> réveil « sale ».
  const p = freshHome();
  const o1 = await boot({ paths: p, hooks: bootHooks });
  o1.shutdown(); // pas de drapeau propre -> running reste 1
  const alerts = [];
  const o2 = await boot({ paths: p, hooks: bootHooks, onAlert: (a) => alerts.push(a.code) });
  check("contrôle : arrêt SANS gracefulShutdown -> réveil « sale » (le fail-safe fait bien la différence)",
    o2.state.wake === "sale" && alerts.includes("REVEIL_SALE"));
  o2.shutdown();
}

// ─── 7. Idempotence : double gracefulShutdown ne casse rien ───────────────────
{
  const p = freshHome();
  const o = await boot({ paths: p, hooks: bootHooks });
  const caps = { db: o.db.raw, paths: p, terminateSidecar: async () => ({ died: true }), teardown: () => o.shutdown() };
  await gracefulShutdown(caps);
  let threw = false;
  try { await gracefulShutdown(caps); } catch { threw = true; } // 2e appel : db close + teardown re-close -> tout gardé
  check("idempotence : double gracefulShutdown ne jette pas", !threw);
  check("idempotence : running reste 0 (toujours « propre »)", readFlag(p).running === 0);
}

// ─── 8. Supervisor.beginShutdown : coupe le respawn (un sidecar tué n'est plus relancé) ──
{
  let readyCount = 0, pid = 0;
  const pidfile = path.join(base, "t6-begin.pid");
  const sup = new Supervisor({ python: PY, script: "sidecar/server.py", cwd: root, pidfile, heartbeatIntervalMs: 400, onReady: (_port, p) => { readyCount++; pid = p; } });
  await sup.start();
  await until(() => readyCount >= 1, 12000);
  sup.beginShutdown(); // à partir d'ici, plus de respawn
  try { process.kill(pid, "SIGKILL"); } catch { /* */ }
  await sleep(2000);
  check("beginShutdown : après coupure du respawn, un sidecar tué n'est PAS relancé", readyCount === 1);
  await sup.terminate(); // nettoyage (child déjà mort)
}

// ─── 9. Supervisor.terminate : SIGTERM -> mort, pidfile retiré, pas de respawn ──
{
  let readyCount = 0, pid = 0;
  const pidfile = path.join(base, "t6-term.pid");
  const sup = new Supervisor({ python: PY, script: "sidecar/server.py", cwd: root, pidfile, heartbeatIntervalMs: 400, onReady: (_port, p) => { readyCount++; pid = p; } });
  await sup.start();
  await until(() => readyCount >= 1, 12000);
  check("terminate : sidecar prêt + pidfile écrit", fs.existsSync(pidfile) && aliveP(pid));
  const { died } = await sup.terminate();
  check("terminate : SIGTERM -> sidecar mort (died=true)", died === true && !aliveP(pid));
  check("terminate : pidfile retiré (sidecar mort)", !fs.existsSync(pidfile));
  check("terminate : état STOPPED", sup.currentState === "STOPPED");
  await sleep(1500);
  check("terminate : AUCUN respawn après l'arrêt", readyCount === 1);
}

// ─── 10. Supervisor.terminate : kill impossible -> died=false + pidfile CONSERVÉ (couture _sendKill) ──
{
  let readyCount = 0, pid = 0;
  const pidfile = path.join(base, "t6-keep.pid");
  const sup = new Supervisor({ python: PY, script: "sidecar/server.py", cwd: root, pidfile, sigkillGraceMs: 250, heartbeatIntervalMs: 400, onReady: (_port, p) => { readyCount++; pid = p; } });
  await sup.start();
  await until(() => readyCount >= 1, 12000);
  // Couture de test : le "kill" ne fait rien -> le sidecar survit -> died=false (jonction 🔴 GPU-figé §6).
  const { died } = await sup.terminate(250, () => { /* no-op : kill "impossible" */ });
  check("terminate : kill impossible -> died=false", died === false);
  check("terminate : pidfile CONSERVÉ (le reaper du prochain boot le retrouvera, 🔴 §6)", fs.existsSync(pidfile));
  check("terminate : le sidecar est TOUJOURS VIVANT (on ne l'a pas tué, on a juste renoncé)", aliveP(pid));
  try { process.kill(pid, "SIGKILL"); } catch { /* */ } // nettoyage réel
  try { fs.rmSync(pidfile); } catch { /* */ }
}

// ─── 11. ⑥ garde before-quit en fonction PURE (couvre l'ancien MAJEUR ① — re-croisé conv 36) ──
{
  check("planBeforeQuit : non-PRIMARY -> ne bloque pas, ne lance pas (sortie normale)",
    JSON.stringify(planBeforeQuit(false, false)) === JSON.stringify({ prevent: false, run: false }));
  check("planBeforeQuit : PRIMARY, 1er quit -> bloque ET lance",
    JSON.stringify(planBeforeQuit(true, false)) === JSON.stringify({ prevent: true, run: true }));
  // L'ancien MAJEUR ① : un 2e quit ne doit JAMAIS abandonner l'arrêt en vol -> il BLOQUE, sans relancer.
  check("planBeforeQuit : PRIMARY, séquence en vol -> bloque mais NE relance PAS (ancien MAJEUR ①)",
    JSON.stringify(planBeforeQuit(true, true)) === JSON.stringify({ prevent: true, run: false }));
  const first = planBeforeQuit(true, false), second = planBeforeQuit(true, true);
  check("planBeforeQuit : les 2 tirs -> 1er lance, 2e bloque sans relancer (jamais deux séquences)",
    first.run === true && second.run === false && second.prevent === true);
}

// ─── 12. ⑩ writeCleanShutdown refuse une transaction ouverte (le drapeau = son propre commit durable) ──
{
  const p = freshHome();
  const db = openDatabase(p.db);
  db.raw.exec("BEGIN");
  db.raw.prepare("UPDATE runtime_flags SET running=1 WHERE id=1").run();
  let threw = false;
  try { writeCleanShutdown(db.raw); } catch { threw = true; }
  check("⑩ : writeCleanShutdown REFUSE une transaction ouverte (jamais un drapeau non-atomique)", threw);
  db.raw.exec("ROLLBACK");
  db.close();
  // Contrôle : hors transaction, il passe normalement (pas de faux positif).
  const p2 = freshHome();
  const db2 = openDatabase(p2.db);
  writeCleanShutdown(db2.raw);
  db2.close();
  check("⑩ : hors transaction, writeCleanShutdown pose bien le drapeau (running=0)", readFlag(p2).running === 0);
}

fs.rmSync(base, { recursive: true, force: true });

for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T6 OK : tous les critères passent"); process.exit(0); }
else { console.error(`\nU-T6 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
