// E2E-V3 — le RÉVEIL RÉTROACTIF dans le VRAI sidecar (cœur réel, source synthétique, sans micro).
// Prouve le chemin de V3 : parole synthétique -> AEC -> ring -> VAD (pose la marque) -> INJECTION d'éveil
// (/debug/wake, qui simule le portier STT de V4) -> WakeGate rembobine à la marque -> evt.wake -> bus -> WS.
// La preuve FINE « audio intact » vit en pytest cœur réel (l'audio ne traverse PAS le WS) ; ici on prouve le
// chemin vrai-sidecar bout-en-bout : la marque VAD -> le rembobinage -> evt.wake avec la bonne position.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8796;

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

// test-wake = test-vad + le réveil (WakeGate) ; TEST_HOOKS=1 arme /debug/wake (injection de l'éveil, jamais en prod)
const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root, env: { ...process.env, SIDECAR_AUDIO: "test-wake", SIDECAR_TEST_HOOKS: "1" }, stdio: ["ignore", "pipe", "pipe"],
});
const client = new IpcClient();
try {
  // readiness
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok && (await r.json()).ready) { up = true; break; } } catch { /* pas prêt */ }
  }
  check("sidecar PRÊT", up);

  // le chemin V0+V1+V2 + le réveil V3 sont montés au boot du vrai sidecar
  const d1 = await getDebug();
  check("audio.enabled (chemin AEC + VAD monté)", d1.audio.enabled === true);
  check("audio.vad présent (prise VAD active)", d1.audio.vad && typeof d1.audio.vad.in_speech === "boolean");
  check("audio.wake présent (réveil V3 monté)", d1.audio.wake && typeof d1.audio.wake.armed === "boolean");

  // abonnement : evt.vad.* (la marque) + evt.wake (le réveil). Les events émis AVANT la connexion sont perdus
  // (0 abonné) -> la source BOUCLE, on attrape le prochain cycle.
  const starts = [], wakes = [];
  await client.connect(PORT);
  client.on("evt.vad.start", (e) => starts.push(e));
  client.on("evt.wake", (e) => wakes.push(e));

  // la source parole boucle -> le VRAI Silero pose une marque (evt.vad.start) sur l'audio POST-AEC
  let deadline = Date.now() + 15000;
  while (starts.length < 1 && Date.now() < deadline) await sleep(150);
  check(`evt.vad.start reçu (marque VAD posée, ${starts.length})`, starts.length >= 1);
  if (!starts.length) throw new Error("aucune marque VAD -> impossible de tester le réveil");

  // INJECTER l'éveil avec la marque de CE segment (mode NOMINAL : le déclencheur — ici le hook, le STT en V4 —
  // fournit la marque du bon segment, même si un nouveau a démarré depuis).
  const mark = starts[0].payload.pos;
  const wakeResp = await (await fetch(`http://127.0.0.1:${PORT}/debug/wake?pos=${mark}`)).json();
  check("GET /debug/wake accepté + a réveillé", wakeResp.ok === true && wakeResp.woke === true);

  // evt.wake remonte par le bus, rembobiné à la marque fournie, sans troncature
  deadline = Date.now() + 5000;
  while (wakes.length < 1 && Date.now() < deadline) await sleep(150);
  check(`evt.wake reçu via le bus (${wakes.length})`, wakes.length >= 1);
  if (wakes.length) {
    const p = wakes[0].payload;
    check("evt.wake rembobiné À LA MARQUE VAD fournie (premier mot jamais amputé)", p.pos === mark);
    check("evt.wake truncated == 0 (marque dans la fenêtre 30 s)", p.truncated === 0);
    check("evt.wake porte captured_at (ms)", typeof p.captured_at === "number");
  }

  // /debug : l'état du réveil est cohérent (un réveil enregistré, la dernière marque de réveil)
  const d2 = await getDebug();
  check("audio.wake.wakes >= 1 (un réveil enregistré)", d2.audio.wake.wakes >= 1);
  check("audio.wake.last_wake.pos == la marque", !!d2.audio.wake.last_wake && d2.audio.wake.last_wake.pos === mark);
  check("bus.subscribers >= 1 (ce client WS est abonné)", d2.bus.subscribers >= 1);

  // arrêt propre : cmd.shutdown -> graceful_release stoppe le réveil, la prise VAD PUIS libère la capture
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v3" });
  check("cmd.shutdown -> evt.ack corrélé", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  const d3 = await getDebug();
  check("audio LIBÉRÉ après cmd.shutdown (enabled false)", d3.audio.enabled === false);

  // cycle de vie de l'abonnement : à la déconnexion, le ws_handler DÉSABONNE
  client.close();
  await sleep(300);
  const d4 = await getDebug();
  check("bus.subscribers == 0 après déconnexion (désabonnement propre)", d4.bus.subscribers === 0);
} finally {
  proc.kill();
  // Attendre la mort réelle de l'enfant (threads capture + VAD) avant de finir -> pas d'assertion libuv (Windows).
  await new Promise((res) => {
    let done = false; let timer = null;
    const d = () => { if (!done) { done = true; if (timer) clearTimeout(timer); res(); } };
    proc.once("exit", d); timer = setTimeout(d, 3000);
  });
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log("\nE2E-V3 OK : le réveil rétroactif vit dans le vrai sidecar (marque VAD -> rembobinage -> evt.wake -> bus -> WS)");
else console.error(`\nE2E-V3 ÉCHEC : ${failed.length} critère(s)`);
process.exitCode = failed.length === 0 ? 0 : 1;
