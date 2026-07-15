// U-T3 — la supervision. Vérifie : respawn après kill ; figé-mais-vivant détecté (battement) puis
// respawn ; garde anti-recyclage de PID (un PID vivant d'un AUTRE exe n'est pas tué) ; disjoncteur
// (K crashs -> DÉGRADÉ_SANS_VOIX). Spawn de vrais sidecars, puis les arrête. Node pur.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { Supervisor, orphanShouldBeKilled } = require("../dist/src/orchestrator/supervisor/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");

const results = [];
const check = (n, c) => results.push([n, !!c]);
const base = { python: PY, script: "sidecar/server.py", cwd: root };

async function until(cond, timeoutMs, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(stepMs); }
  return false;
}

// --- 1. RESPAWN sur kill ---
{
  let readyCount = 0, lastPid = 0, lastPort = 0;
  const sup = new Supervisor({
    ...base, pidfile: path.join(root, ".sophia-home-dev", "t3-a.pid"), heartbeatIntervalMs: 500,
    onReady: (port, pid) => { readyCount++; lastPid = pid; lastPort = port; },
  });
  await sup.start();
  const firstReady = await until(() => readyCount >= 1, 12000);
  const pid1 = lastPid;
  try { process.kill(pid1, "SIGKILL"); } catch { /* */ }         // crash externe
  const respawned = await until(() => readyCount >= 2 && lastPid !== pid1, 15000);
  let healthy = false;
  try { const r = await fetch(`http://127.0.0.1:${lastPort}/health`); healthy = r.ok; } catch { /* */ }
  await sup.stop();
  check("respawn : 1er sidecar prêt", firstReady);
  check("respawn : après kill, nouveau sidecar prêt (PID différent)", respawned);
  check("respawn : le nouveau /health répond", healthy);
}

// --- 2. FIGÉ-MAIS-VIVANT détecté -> respawn ---
{
  let readyCount = 0, lastPid = 0;
  const sup = new Supervisor({
    ...base, pidfile: path.join(root, ".sophia-home-dev", "t3-b.pid"), extraEnv: { SIDECAR_TEST_HOOKS: "1" },
    heartbeatIntervalMs: 300, heartbeatTimeoutMs: 500, missedHeartbeats: 3,
    onReady: (_port, pid) => { readyCount++; lastPid = pid; },
  });
  await sup.start();
  await until(() => readyCount >= 1, 12000);
  const pid1 = lastPid, port1 = sup.port;
  try { await fetch(`http://127.0.0.1:${port1}/debug/freeze`); } catch { /* */ } // fige CE sidecar
  const recovered = await until(() => readyCount >= 2 && lastPid !== pid1, 15000);
  await sup.stop();
  check("figé : détecté par le battement + respawn (PID différent)", recovered);
}

// --- 3. Garde ANTI-RECYCLAGE de PID (M2 : jeton d'identité + exe) ---
{
  const dead = spawnSync(process.execPath, ["-e", "0"], {}); // process node qui sort aussitot
  const deadPid = dead.pid;                                   // -> PID mort (le "proprietaire")
  const alivePid = process.pid;                               // VIVANT (joue le "sidecar") ; exe reel = node.exe

  // (a) exe DIFFERENT -> pre-filtre, pas tué
  const wrongExe = orphanShouldBeKilled(alivePid, deadPid, "python.exe", "jeton-A", () => "x jeton-A");
  check("anti-recyclage : exe différent -> pas tué", wrongExe === false);

  // (b) M2 : MEME exe mais jeton ABSENT (PID recyclé vers un autre process) -> PAS tué
  const recycled = orphanShouldBeKilled(alivePid, deadPid, "node.exe", "jeton-A", () => "node.exe autre.js 1 jeton-B");
  check("M2 : même exe, jeton absent (PID recyclé) -> pas tué", recycled === false);

  // (c) M2 : jeton inconnu (vieux pidfile sans jeton) -> on s'abstient
  const noToken = orphanShouldBeKilled(alivePid, deadPid, "node.exe", "", () => "node.exe server.py 1 jeton-A");
  check("M2 : jeton inconnu (vieux pidfile) -> on s'abstient", noToken === false);

  // (d) orphelin AUTHENTIQUE : proprietaire mort + sidecar vivant + exe ok + jeton présent -> à tuer
  const genuine = orphanShouldBeKilled(alivePid, deadPid, "node.exe", "jeton-A", () => "node.exe server.py 1 jeton-A");
  check("M2 : orphelin authentique (jeton présent) -> à tuer", genuine === true);
}

// --- 4. DISJONCTEUR : sidecar qui crashe -> DÉGRADÉ_SANS_VOIX ---
{
  let degraded = false;
  const sup = new Supervisor({
    ...base, pidfile: path.join(root, ".sophia-home-dev", "t3-c.pid"), extraEnv: { SIDECAR_CRASH: "1", SIDECAR_TEST_HOOKS: "1" },
    circuitBreakerK: 3, backoffBaseMs: 50, backoffCapMs: 200, readinessTimeoutMs: 1500, toctouRetries: 0,
    onDegraded: () => { degraded = true; },
  });
  await sup.start();
  const tripped = await until(() => degraded && sup.currentState === "DEGRADED_SANS_VOIX", 12000);
  await sup.stop();
  check("disjoncteur : K crashs -> DÉGRADÉ_SANS_VOIX", tripped);
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T3 OK : tous les critères passent"); process.exit(0); }
else { console.error(`\nU-T3 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
