// E2E-V1 — l'AEC dans le VRAI sidecar (cœur réel, sources synthétiques, sans micro).
// Prouve le câblage complet V1 : _start_audio -> WasapiDuplexSource(near+ref) [ici synthétique] ->
// deux resamplers soxr -> appariement 160-trames -> EchoCanceller(SpeexDSP, preprocess OFF) -> ring
// POST-AEC ; /debug sonde l'ERLE + les stats ; cmd.shutdown -> graceful_release libère l'audio.
// Déterministe (SIDECAR_AUDIO=test-aec : near = écho(far-end) + voix discrète ; ref = far-end).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8794;

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root, env: { ...process.env, SIDECAR_AUDIO: "test-aec" }, stdio: ["ignore", "pipe", "pipe"],
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

  // laisse l'AEC converger (le filtre adaptatif SpeexDSP a besoin de quelques centaines de ms)
  await sleep(1500);
  const d1 = await getDebug();
  check("audio.enabled (chemin AEC monté au boot du vrai sidecar)", d1.audio.enabled === true);
  check("audio.rate = 16000 (ring POST-AEC à 16 kHz)", d1.audio.rate === 16000);
  check("le ring s'alimente (captured_samples > 0)", d1.audio.captured_samples > 0);

  const s1 = d1.audio.stats;
  check("les DEUX sources vivent (aec_frames > 0 ET ref_frames > 0 = loopback livré)",
    s1.aec_frames > 0 && s1.ref_frames > 0);
  check("loopback_ok (référence présente)", s1.loopback_ok === true);
  check("zéro perte/erreur (dropped_near=dropped_ref=convert_errors=0)",
    s1.dropped_near === 0 && s1.dropped_ref === 0 && s1.convert_errors === 0);
  // l'ANNULATION a lieu dans le vrai sidecar : l'écho du far-end est effondré -> ERLE clairement positif.
  check(`AEC annule l'écho dans le vrai sidecar (ERLE ${s1.erle_db} dB > 6)`, s1.erle_db > 6);

  // le ring PROGRESSE (flux vivant à travers deux resamplers + AEC)
  await sleep(600);
  const d2 = await getDebug();
  const delta = d2.audio.captured_samples - d1.audio.captured_samples;
  check("le ring PROGRESSE (flux vivant)", delta > 0);
  check("cadence ~16 kHz (delta plausible sur ~0,6 s)", delta > 4000 && delta < 20000);

  // arrêt propre : cmd.shutdown -> graceful_release libère les DEUX sources AVANT l'ack
  await client.connect(PORT);
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v1" });
  check("cmd.shutdown -> evt.ack corrélé", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  const d3 = await getDebug();
  check("audio LIBÉRÉ après cmd.shutdown (enabled false)", d3.audio.enabled === false);

  client.close();
} finally {
  proc.kill();
  // Attendre que l'enfant meure VRAIMENT (borne 3 s) avant de finir : le sidecar V1 (threads AEC + duplex)
  // met plus de temps a s'arreter que le V0 -> process.exit() court-circuiterait un child_process encore en
  // fermeture -> assertion libuv UV_HANDLE_CLOSING (Windows). On draine proprement + on utilise exitCode.
  await new Promise((res) => {
    let done = false; let timer = null;
    const d = () => { if (!done) { done = true; if (timer) clearTimeout(timer); res(); } };
    proc.once("exit", d); timer = setTimeout(d, 3000);   // timer nettoye si l'enfant sort avant (pas d'attente morte)
  });
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log("\nE2E-V1 OK : l'AEC vit dans le vrai sidecar (near+ref -> annulation -> ring)");
else console.error(`\nE2E-V1 ÉCHEC : ${failed.length} critère(s)`);
process.exitCode = failed.length === 0 ? 0 : 1;
