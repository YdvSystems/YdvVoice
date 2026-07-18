// E2E-V5 — la FIN DE TOUR FINE (Smart Turn) dans le VRAI sidecar (cœur reel, source WAV, sans micro).
// Prouve le chemin COMPLET de V5, SANS injection : la source joue « bonjour sophia » (WAV neutre) -> AEC ->
// ring -> VAD -> STT (VRAI faster-whisper) + portier -> evt.wake (1er tour = eveil, V3/V4). PUIS, Sophia ARMEE
// (conversation), le tour suivant passe par le VRAI Smart Turn (TurnDetector) -> evt.turn.end, emis APRES
// evt.stt.final (ordre grave). On verifie aussi que le vrai Smart Turn s'integre SANS crash (turn_errors==0).
// La QUALITE de decision de Smart Turn (intonation) se juge a la VOIX de Yohann (test live) — ici = le CABLAGE.
// Skip proprement si l'asset, faster-whisper, ou le modele smart-turn vendorise est absent.
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
const PORT = 8798;
const ASSET = path.join(root, "sidecar", "tests", "assets", "bonjour_sophia_16k.wav");
const MODEL = path.join(root, "resources", "models", "smart-turn", "smart-turn-v3.2-cpu.onnx");

if (!fs.existsSync(ASSET)) {
  console.log(`SKIP  E2E-V5 : asset ${path.relative(root, ASSET)} absent (genere par gen_asset — CF2).`);
  process.exit(0);
}
if (!fs.existsSync(MODEL)) {
  console.log(`SKIP  E2E-V5 : modele ${path.relative(root, MODEL)} absent (vendorise, CF2 gitignore).`);
  process.exit(0);
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

// test-turn = test-stt + la fin de tour FINE (SttPlug avec un TurnDetector Smart Turn REEL) ; PAS de TEST_HOOKS.
const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root, env: { ...process.env, SIDECAR_AUDIO: "test-turn" }, stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
proc.stderr.on("data", (d) => { stderr += d.toString(); });
const client = new IpcClient();
try {
  let up = false;
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok && (await r.json()).ready) { up = true; break; } } catch { /* pas pret */ }
  }
  check("sidecar PRET", up);

  const d1 = await getDebug();
  check("audio.enabled (chemin AEC + VAD monte)", d1.audio.enabled === true);
  check("audio.stt.turn_enabled === true (V5 monte)", d1.audio.stt && d1.audio.stt.turn_enabled === true);

  // abonnement : on suit l'ORDRE d'arrivee (stt.final doit preceder turn.end pour un meme tour).
  const seq = [];
  const wakes = [], finals = [], ends = [];
  await client.connect(PORT);
  client.on("evt.wake", (e) => { wakes.push(e); seq.push("wake"); });
  client.on("evt.stt.final", (e) => { finals.push(e); seq.push("final"); });
  client.on("evt.turn.end", (e) => { ends.push(e); seq.push(`turn.end:${e.payload.reason}`); });

  // 1) le worker charge large-v3 (~7 s) + Smart Turn (warm) PUIS la source (« bonjour sophia » en boucle) :
  //    1er passage = eveil (evt.wake) ; une fois ARMEE, le tour suivant = conversation -> evt.turn.end.
  let deadline = Date.now() + 60000;
  while (ends.length < 1 && Date.now() < deadline) await sleep(200);

  check(`evt.wake recu (eveil V3/V4 intact, ${wakes.length})`, wakes.length >= 1);
  check(`evt.turn.end recu SANS injection — la fin de tour FINE (${ends.length})`, ends.length >= 1);
  if (ends.length) {
    const p = ends[0].payload;
    check("evt.turn.end porte mark + captured_at + reason", typeof p.mark === "number" && typeof p.captured_at === "number" && typeof p.reason === "string");
    // ORDRE grave : pour le 1er turn.end, un evt.stt.final l'a precede dans le flux
    const iEnd = seq.findIndex((s) => s.startsWith("turn.end"));
    const iFinalBefore = seq.slice(0, iEnd).lastIndexOf("final");
    check("ordre : evt.stt.final PRECEDE evt.turn.end", iEnd >= 0 && iFinalBefore >= 0);
  }

  // 2) /debug : la prise a finalise des tours de conversation, le VRAI Smart Turn n'a PAS crashe.
  const d2 = await getDebug();
  check("audio.stt.turns_ended >= 1 (un tour de conversation finalise)", d2.audio.stt.turns_ended >= 1);
  check("audio.stt.turn_errors === 0 (le vrai Smart Turn s'integre sans crash)", d2.audio.stt.turn_errors === 0);
  check("audio.stt.engine_errors === 0 (STT intact)", d2.audio.stt.engine_errors === 0);
  // Facilite #2 (jitter V0-V3) fermee EMPIRIQUEMENT : Smart Turn (onnxruntime CPU) tourne sans distancer les
  // consommateurs audio -> aucun overrun STT ni resync VAD (le ring 30 s absorbe un pic de ~40 ms).
  check("audio.stt.overruns === 0 (Smart Turn ne jitter pas le STT)", d2.audio.stt.overruns === 0);
  check("audio.vad.resyncs === 0 (Smart Turn ne jitter pas le VAD)", d2.audio.vad.resyncs === 0);

  // arret propre
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v5" });
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
if (failed.length === 0) console.log("\nE2E-V5 OK : la fin de tour FINE (Smart Turn) emet evt.turn.end apres evt.stt.final dans le vrai sidecar, sans crash");
else console.error(`\nE2E-V5 ECHEC : ${failed.length} critere(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
