// E2E-V2 — le VAD dans le VRAI sidecar (cœur réel, source synthétique, sans micro).
// Prouve le chemin NEUF de V2 : _start_audio -> AudioCapture(source parole synthétique) -> ring ->
// prise VadPlug (VRAI Silero) -> EMISSION evt.vad.* -> BUS (thread -> boucle) -> WS -> orchestrateur.
// C'est le 1er evenement POUSSE (non sollicite) du projet : V0/V1 ne faisaient que remplir le ring.
// Déterministe (SIDECAR_AUDIO=test-vad : parole source-filtre alternée silence -> Silero fire 5/5, conv 41).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8795;

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root, env: { ...process.env, SIDECAR_AUDIO: "test-vad" }, stdio: ["ignore", "pipe", "pipe"],
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

  // le chemin V0 + prise VAD est monté au boot du vrai sidecar
  const d1 = await getDebug();
  check("audio.enabled (chemin AEC + VAD monté)", d1.audio.enabled === true);
  check("audio.vad présent (prise VAD active)", d1.audio.vad && typeof d1.audio.vad.in_speech === "boolean");
  check("le ring s'alimente (captured_samples > 0)", d1.audio.captured_samples > 0);

  // abonnement aux evt.vad.* : la prise VAD (thread de fond) publie sur le bus, qui pousse au WS. Les events
  // emis AVANT cette connexion (0 abonne) sont perdus -> la source BOUCLE, on attrape le prochain cycle.
  const starts = [], stops = [];
  await client.connect(PORT);
  client.on("evt.vad.start", (e) => starts.push(e));
  client.on("evt.vad.stop", (e) => stops.push(e));

  // la source parole boucle (~4,6 s : parole 1,5s / silence 1s / parole 1,5s / silence 0,6s) -> au moins un
  // start ET un stop remontent par le bus jusqu'au WS (le VRAI Silero segmente l'audio du vrai sidecar).
  const deadline = Date.now() + 15000;
  while ((starts.length < 1 || stops.length < 1) && Date.now() < deadline) await sleep(150);

  check(`evt.vad.start reçu via le bus (${starts.length})`, starts.length >= 1);
  check(`evt.vad.stop reçu via le bus (${stops.length})`, stops.length >= 1);
  if (starts.length) {
    const p = starts[0].payload;
    check("evt.vad.start porte une position ring (la marque que V3 rembobinera)", typeof p.pos === "number" && p.pos >= 0);
    check("evt.vad.start porte captured_at (ms)", typeof p.captured_at === "number");
    check("evt.vad.start porte la prob (0..1, 1 seul appel modèle)", typeof p.prob === "number" && p.prob >= 0 && p.prob <= 1);
  }
  if (stops.length) {
    const p = stops[0].payload;
    check("evt.vad.stop porte une durée de segment (> 0)", typeof p.duration_ms === "number" && p.duration_ms > 0);
  }

  // /debug : chemin POST-AEC (parité prod : source → AEC → ring → VAD), segments comptés, client abonné
  const d2 = await getDebug();
  check("chemin POST-AEC (aec_frames > 0 = la source passe par le VRAI AEC, fidèle prod)", d2.audio.stats.aec_frames > 0);
  check("audio.vad.segments >= 1 (des segments de parole détectés)", d2.audio.vad.segments >= 1);
  check("bus.subscribers >= 1 (ce client WS est abonné au bus)", d2.bus.subscribers >= 1);

  // arrêt propre : cmd.shutdown -> graceful_release stoppe la prise VAD PUIS libère la capture
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v2" });
  check("cmd.shutdown -> evt.ack corrélé", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  const d3 = await getDebug();
  check("audio LIBÉRÉ après cmd.shutdown (enabled false)", d3.audio.enabled === false);

  // cycle de vie de l'abonnement : à la déconnexion, le ws_handler DÉSABONNE (pas d'abonnement orphelin, drain annulé)
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
if (failed.length === 0) console.log("\nE2E-V2 OK : le VAD vit dans le vrai sidecar (POST-AEC -> ring -> prise -> bus -> WS)");
else console.error(`\nE2E-V2 ÉCHEC : ${failed.length} critère(s)`);
process.exitCode = failed.length === 0 ? 0 : 1;
