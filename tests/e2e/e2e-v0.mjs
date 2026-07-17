// E2E-V0 — le CHEMIN AUDIO dans le VRAI sidecar (cœur réel, source synthétique, sans micro).
// Prouve le câblage complet : _start_audio -> AudioCapture -> thread de conversion (soxr 48k->16k) -> ring ;
// /debug sonde le flux ; cmd.shutdown -> graceful_release libère l'audio. Déterministe (SIDECAR_AUDIO=test).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8793;

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root, env: { ...process.env, SIDECAR_AUDIO: "test" }, stdio: ["ignore", "pipe", "pipe"],
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

  // le chemin audio est monté dans le VRAI sidecar (source synthétique 48k -> conversion -> ring 16k)
  await sleep(800);
  const d1 = await getDebug();
  check("audio.enabled (chemin monté au boot du vrai sidecar)", d1.audio.enabled === true);
  check("audio.rate = 16000 (conversion vers 16 kHz)", d1.audio.rate === 16000);
  check("le ring s'alimente (captured_samples > 0)", d1.audio.captured_samples > 0);
  check("zéro perte/erreur (dropped_full=src_overflow=convert_errors=0)",
    d1.audio.stats.dropped_full === 0 && d1.audio.stats.src_overflow === 0 && d1.audio.stats.convert_errors === 0);

  // le ring PROGRESSE (flux vivant à travers le resampler streaming soxr)
  await sleep(600);
  const d2 = await getDebug();
  const delta = d2.audio.captured_samples - d1.audio.captured_samples;
  check("le ring PROGRESSE (flux vivant)", delta > 0);
  check("cadence ~16 kHz (delta plausible sur ~0,6 s)", delta > 4000 && delta < 20000);

  // arrêt propre : cmd.shutdown -> graceful_release libère l'audio AVANT l'ack
  await client.connect(PORT);
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v0" });
  check("cmd.shutdown -> evt.ack corrélé", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  const d3 = await getDebug();
  check("audio LIBÉRÉ après cmd.shutdown (enabled false)", d3.audio.enabled === false);

  client.close();
} finally {
  proc.kill();
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nE2E-V0 OK : le chemin audio vit dans le vrai sidecar (cœur réel)"); process.exit(0); }
else { console.error(`\nE2E-V0 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
