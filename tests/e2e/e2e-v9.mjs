// E2E-V9 — les ÉTATS D'ÉCOUTE dans le VRAI sidecar (cœur réel, sans micro) : `cmd.listen.stop`/`start` contrôlent
// l'ARMEMENT du réveil END-TO-END à travers le WS (B1 : l'orchestrateur décide, le sidecar exécute).
//
// Mode test-wake (V3) = AEC + VAD (parole synthétique) + WakeGate ; l'éveil s'injecte par /debug/wake (TEST_HOOKS,
// jamais en prod). On prouve, sur le VRAI WakeGate branché au serveur :
//   1) l'éveil arme (evt.wake reçu, audio.wake.armed === true) — la seule auto-transition sidecar permise (B1) ;
//   2) `cmd.listen.stop` → release → armed === false : « coupe l'écoute des tours à la source » (retour VEILLE) ;
//   3) `cmd.listen.start` → arm_external → armed === true, SANS nouvel evt.wake (confirmation, pas un réveil) ;
//   4) la deadline de garde R-1 est OBSERVABLE (guard_s exposé). Sa LOGIQUE + son câblage dans le worker STT sont
//      prouvés unitairement (test_v9 : le test MORD par temp-revert ; test_stt_worker_calls_check_guard).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8799;

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

// test-wake = AEC + VAD (parole synthétique) + WakeGate ; TEST_HOOKS pour /debug/wake (injection de l'éveil).
const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root,
  env: { ...process.env, SIDECAR_AUDIO: "test-wake", SIDECAR_TEST_HOOKS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
proc.stderr.on("data", (d) => { stderr += d.toString(); });
const client = new IpcClient();
try {
  let up = false;
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok && (await r.json()).ready) { up = true; break; } } catch { /* pas prêt */ }
  }
  check("sidecar PRÊT", up);

  const d0 = await getDebug();
  check("audio.enabled (chemin AEC + VAD + réveil monté)", d0.audio.enabled === true);
  check("audio.wake présent (WakeGate monté)", d0.audio.wake && typeof d0.audio.wake.armed === "boolean");
  check("wake au repos : armed === false (VEILLE)", d0.audio.wake.armed === false);
  check("garde R-1 observable : guard_s exposé", typeof d0.audio.wake.guard_s === "number" && d0.audio.wake.guard_s > 0);
  check("garde R-1 saine au repos : guard_releases === 0", d0.audio.wake.guard_releases === 0);

  const wakes = [];
  const timeouts = [];
  await client.connect(PORT);
  client.on("evt.wake", (e) => { wakes.push(e); });
  client.on("evt.listen.timeout", (e) => { timeouts.push(e); }); // V9 garde R-1 (auto-release sur inactivité)

  // Attendre une VRAIE marque VAD (la parole synthétique déclenche Silero) — la marque de l'éveil.
  let mark = null;
  for (let i = 0; i < 80; i++) {
    const d = await getDebug();
    if (d.audio.vad.last_start_pos != null) { mark = d.audio.vad.last_start_pos; break; }
    await sleep(200);
  }
  check("une marque VAD a été posée (le vrai Silero détecte la parole)", mark != null);

  // 1) ÉVEIL (auto-transition sidecar B1) : /debug/wake?pos=<marque> → arme + emet evt.wake.
  const w = await (await fetch(`http://127.0.0.1:${PORT}/debug/wake?pos=${mark}`)).json();
  check("éveil injecté (le WakeGate a réveillé)", w.ok === true && w.woke === true);
  await sleep(200);
  check("evt.wake reçu par l'orchestrateur (via le bus)", wakes.length >= 1);
  check("après l'éveil : audio.wake.armed === true (ÉCOUTE transitoire)", (await getDebug()).audio.wake.armed === true);

  // 2) cmd.listen.stop (B1) : retour VEILLE — release → « coupe l'écoute des tours à la source ».
  const ackStop = await client.request("cmd.listen.stop", {});
  check("cmd.listen.stop → evt.ack corrélé", ackStop.type === "evt.ack" && ackStop.payload.for === "cmd.listen.stop");
  check("après stop : audio.wake.armed === false (VEILLE — plus de turn.end fabriqué)", (await getDebug()).audio.wake.armed === false);

  // 3) cmd.listen.start (B1) : ÉCOUTE confirmée — arm_external, SANS nouvel evt.wake (ce n'est pas un réveil).
  const wakesBefore = wakes.length;
  const ackStart = await client.request("cmd.listen.start", {});
  check("cmd.listen.start → evt.ack corrélé", ackStart.type === "evt.ack" && ackStart.payload.for === "cmd.listen.start");
  await sleep(200);
  check("après start : audio.wake.armed === true (ÉCOUTE confirmée)", (await getDebug()).audio.wake.armed === true);
  check("start n'émet PAS d'evt.wake (confirmation d'état, pas un réveil)", wakes.length === wakesBefore);

  // 4) La deadline de garde R-1 en CŒUR RÉEL : forcer le timeout → l'emit `evt.listen.timeout` remonte jusqu'au
  //    client (emit → bus → WS → orchestrateur), et le sidecar retombe en VEILLE. (Sophia est armée par le start.)
  const g = await (await fetch(`http://127.0.0.1:${PORT}/debug/guard`)).json();
  check("garde R-1 forcée → released (le sidecar se rendort sur inactivité)", g.ok === true && g.released === true);
  await sleep(250);
  check("evt.listen.timeout reçu par l'orchestrateur (cœur réel : emit → bus → WS)", timeouts.length >= 1 && timeouts[0].payload.reason === "inactivite");
  check("après le timeout : audio.wake.armed === false (retour VEILLE)", (await getDebug()).audio.wake.armed === false);
  check("guard_releases incrémenté (1)", (await getDebug()).audio.wake.guard_releases === 1);

  const dF = await getDebug();
  check("audio.vad.resyncs === 0 (le contrôle d'état ne jitter pas le VAD)", dF.audio.vad.resyncs === 0);
  check("audio.vad.engine_errors === 0 (aucun crash sur tout le cycle)", dF.audio.vad.engine_errors === 0);

  // arrêt propre
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v9" });
  check("cmd.shutdown → evt.ack corrélé", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  check("audio LIBÉRÉ après cmd.shutdown (enabled false)", (await getDebug()).audio.enabled === false);

  client.close();
  await sleep(300);
  check("bus.subscribers == 0 après déconnexion (désabonnement propre)", (await getDebug()).bus.subscribers === 0);
} catch (e) {
  console.error("Exception:", e, "\n--- stderr sidecar ---\n", stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  proc.kill();
  await new Promise((res) => {
    let done = false; let timer = null;
    const d = () => { if (!done) { done = true; if (timer) clearTimeout(timer); res(); } };
    proc.once("exit", d); timer = setTimeout(d, 3000);
  });
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log("\nE2E-V9 OK : cmd.listen.stop/start contrôlent l'armement du réveil (B1), cœur réel — garde R-1 observable");
else console.error(`\nE2E-V9 ÉCHEC : ${failed.length} critère(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
