// E2E-V6 — le SPEAKER-ID (ECAPA CPU) dans le VRAI sidecar (cœur reel, source WAV, sans micro).
// Prouve le chemin COMPLET de V6, SANS injection : la source rejoue un clip Yohann HELD-OUT (raw_far.wav,
// hors centroide raw_near/raw/raw_soft -> pas de triche circulaire) -> AEC -> ring POST-AEC -> VAD -> la
// prise SpeakerPlug (VRAI ECAPA) -> evt.speaker {locuteur, score} -> bus -> WS. On verifie que le verdict
// est « yohann » avec un score > seuil, et que l'ECAPA CPU NE JITTER PAS les consommateurs audio (gate
// « leger » : vad.resyncs == 0, speaker.overruns == 0). Le SEUIL definitif se cale a la VRAIE voix de Yohann
// (test live) ; ici = le CABLAGE + la reconnaissance de sa voix enregistree.
// Skip proprement si l'asset (raw_far), le modele ECAPA vendorise, ou speechbrain est absent.
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
const PORT = 8799;
const ASSET = path.join(root, "resources", "models", "voice-anchor", "raw_far.wav");   // Yohann held-out
const MODEL = path.join(root, "resources", "models", "speaker", "embedding_model.ckpt");

if (!fs.existsSync(ASSET)) {
  console.log(`SKIP  E2E-V6 : asset ${path.relative(root, ASSET)} absent (ancre de Yohann — CF2, gitignore).`);
  process.exit(0);
}
if (!fs.existsSync(MODEL)) {
  console.log(`SKIP  E2E-V6 : modele ECAPA ${path.relative(root, MODEL)} absent (vendorise, CF2 gitignore).`);
  process.exit(0);
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

// test-speaker = AEC + VAD + speaker-ID (VRAI ECAPA) ; SOPHIA_STT_WAV pointe la source WavLoopSource sur
// raw_far (Yohann held-out). PAS de TEST_HOOKS (le declencheur est interne : le VAD -> la prise).
const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root,
  env: { ...process.env, SIDECAR_AUDIO: "test-speaker", SOPHIA_STT_WAV: ASSET },
  stdio: ["ignore", "pipe", "pipe"],
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
  check("audio.speaker present (V6 monte)", d1.audio.speaker && typeof d1.audio.speaker.segments === "number");

  const speakers = [];
  await client.connect(PORT);
  client.on("evt.speaker", (e) => { speakers.push(e); });

  // le worker charge ECAPA (~1 s) + construit le centroide (~3 s : 3 embeddings de 40 s), PUIS la source joue
  // raw_far en boucle -> le VAD segmente -> la prise score -> evt.speaker. On attend le 1er verdict.
  let deadline = Date.now() + 60000;
  while (speakers.length < 1 && Date.now() < deadline) await sleep(200);

  check(`evt.speaker recu SANS injection (${speakers.length})`, speakers.length >= 1);
  if (speakers.length) {
    const p = speakers[0].payload;
    check("evt.speaker porte locuteur + score + mark + captured_at",
      typeof p.locuteur === "string" && typeof p.score === "number"
      && typeof p.mark === "number" && typeof p.captured_at === "number");
    // la voix ENREGISTREE de Yohann (held-out) est reconnue : locuteur=yohann, score > seuil.
    const d = await getDebug();
    const thr = d.audio.speaker.threshold;
    check(`locuteur === "yohann" (sa voix reconnue, held-out raw_far)`, p.locuteur === "yohann");
    check(`score > seuil (${p.score} > ${thr})`, p.score > thr);
  }

  const d2 = await getDebug();
  check("audio.speaker.segments >= 1 (le VAD a marque de la parole)", d2.audio.speaker.segments >= 1);
  check("audio.speaker.emits >= 1 (au moins un verdict emis)", d2.audio.speaker.emits >= 1);
  check("audio.speaker.engine_errors === 0 (le vrai ECAPA s'integre sans crash)", d2.audio.speaker.engine_errors === 0);
  // Barriere « leger » (gate empirique) : l'ECAPA CPU (~137 ms/eval) NE distance PAS les consommateurs audio
  // -> aucun resync VAD ni overrun speaker (le ring 30 s absorbe le cout ; parite du gate jitter de V5).
  check("audio.vad.resyncs === 0 (ECAPA ne jitter pas le VAD)", d2.audio.vad.resyncs === 0);
  check("audio.speaker.overruns === 0 (ECAPA ne se fait pas distancer)", d2.audio.speaker.overruns === 0);

  // arret propre
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v6" });
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
if (failed.length === 0) console.log("\nE2E-V6 OK : le speaker-ID (ECAPA) reconnait la voix de Yohann dans le vrai sidecar (evt.speaker, sans injection, sans jitter)");
else console.error(`\nE2E-V6 ECHEC : ${failed.length} critere(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
