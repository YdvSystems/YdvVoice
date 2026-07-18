// E2E-V4 — le STT streaming + le PORTIER d'eveil dans le VRAI sidecar (cœur reel, source WAV, sans micro).
// Prouve le chemin COMPLET de V4, SANS injection : la source joue « bonjour sophia » (WAV neutre) -> AEC ->
// ring -> VAD (marque) -> SttPlug (VRAI faster-whisper transcrit) -> evt.stt.partial/final -> le PORTIER
// reconnait la phrase et appelle wake.on_wake(mark) -> evt.wake -> bus -> WS. C'est le VRAI declencheur sur V3
// (plus le hook /debug/wake de l'E2E-V3). Skip proprement si l'asset ou faster-whisper est absent.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8797;
const ASSET = path.join(root, "sidecar", "tests", "assets", "bonjour_sophia_16k.wav");

// L'asset (voix neutre, gitignore *.wav) est requis pour ce coeur reel. Absent (clone frais) -> skip propre.
if (!fs.existsSync(ASSET)) {
  console.log(`SKIP  E2E-V4 : asset ${path.relative(root, ASSET)} absent (genere par gen_asset — CF2).`);
  process.exit(0);
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

// test-stt = test-wake + le STT (SttPlug) + portier ; PAS de TEST_HOOKS (aucune injection — le portier reveille seul).
const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root, env: { ...process.env, SIDECAR_AUDIO: "test-stt" }, stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
proc.stderr.on("data", (d) => { stderr += d.toString(); });
const client = new IpcClient();
try {
  // readiness (le serveur repond vite ; le STT se charge EN FOND dans son worker ~7 s)
  let up = false;
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok && (await r.json()).ready) { up = true; break; } } catch { /* pas pret */ }
  }
  check("sidecar PRET", up);

  const d1 = await getDebug();
  check("audio.enabled (chemin AEC + VAD monte)", d1.audio.enabled === true);
  check("audio.stt present (prise STT V4 montee)", d1.audio.stt && typeof d1.audio.stt.groups === "number");
  check("audio.wake present (reveil V3 monte)", d1.audio.wake && typeof d1.audio.wake.armed === "boolean");

  // abonnement : evt.stt.final (le transcript) + evt.wake (le portier reveille SANS injection).
  const finals = [], wakes = [], partials = [];
  await client.connect(PORT);
  client.on("evt.stt.partial", (e) => partials.push(e));
  client.on("evt.stt.final", (e) => finals.push(e));
  client.on("evt.wake", (e) => wakes.push(e));

  // le worker charge large-v3 (~7 s) PUIS la source (qui BOUCLE « bonjour sophia ») produit un tour propre.
  let deadline = Date.now() + 40000;
  while (wakes.length < 1 && Date.now() < deadline) await sleep(200);

  check(`evt.stt.final recu (le VRAI faster-whisper a transcrit, ${finals.length})`, finals.length >= 1);
  if (finals.length) {
    const txt = String(finals[finals.length - 1].payload.text || "").toLowerCase();
    check(`transcript contient « sophia » (« ${finals[finals.length - 1].payload.text} »)`, txt.includes("sophia"));
  }
  check(`evt.wake recu SANS injection — le PORTIER a reveille (${wakes.length})`, wakes.length >= 1);
  if (wakes.length) {
    const p = wakes[0].payload;
    check("evt.wake porte une position (rembobine a la marque du groupe)", typeof p.pos === "number");
    check("evt.wake truncated == 0 (premier mot intact, fenetre 30 s)", p.truncated === 0);
    check("evt.wake porte captured_at (ms)", typeof p.captured_at === "number");
  }

  // /debug : la prise STT a bien transcrit « Bonjour Sophia. » et le reveil est enregistre
  const d2 = await getDebug();
  check("audio.stt.finals >= 1 (au moins un tour finalise)", d2.audio.stt.finals >= 1);
  check(`audio.stt.last_final contient « Sophia » (« ${d2.audio.stt.last_final} »)`,
        String(d2.audio.stt.last_final || "").toLowerCase().includes("sophia"));
  check("audio.stt.engine_errors == 0 (le vrai moteur n'a pas trebuche)", d2.audio.stt.engine_errors === 0);
  check("audio.wake.wakes >= 1 (un reveil enregistre)", d2.audio.wake.wakes >= 1);

  // arret propre : cmd.shutdown -> graceful_release stoppe le STT, le VAD, le reveil PUIS libere la capture
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v4" });
  check("cmd.shutdown -> evt.ack correle", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  const d3 = await getDebug();
  check("audio LIBERE apres cmd.shutdown (enabled false)", d3.audio.enabled === false);

  client.close();
  await sleep(300);
  const d4 = await getDebug();
  check("bus.subscribers == 0 apres deconnexion (desabonnement propre)", d4.bus.subscribers === 0);
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
if (failed.length === 0) console.log("\nE2E-V4 OK : le STT + le portier reveillent Sophia dans le vrai sidecar (source WAV -> faster-whisper -> portier -> evt.wake, SANS injection)");
else console.error(`\nE2E-V4 ECHEC : ${failed.length} critere(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
