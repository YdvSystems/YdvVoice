// E2E-V8 — le GATE 3 etats du BARGE-IN dans le VRAI sidecar (coeur reel, VRAI ECAPA, source WAV, sans micro).
//
// Prouve que le gate `cmd.listen.arm/mute/resume` (piloté par le routeur) contrôle V6 pour le barge-in, END-TO-END
// à travers le WS :
//   · `arm`   (sa pensée développée) : le VAD TOURNE → V6 continue de scorer → le barge-in est VIVANT (elle peut
//     être coupée) — c'est ce que la coupe exige.
//   · `mute`  (phrase fixe : salutation/clôture) : le VAD est GATÉ → V6 s'éteint (aucun nouveau verdict) → PAS de
//     barge-in (on ne coupe pas sa salutation).
//   · `resume`(écoute normale) : le VAD reprend → V6 réémet.
// Source = raw_far (Yohann held-out, hors centroïde) → AEC → ring POST-AEC → VAD (gaté par le mode) → SpeakerPlug
// (VRAI ECAPA) → evt.speaker. La DÉCISION de coupe est dans le routeur (tests/u-router.mjs V8-*) ; le pytest
// (test_v8) couvre les prédicats + la capture rétroactive ; ICI = le CÂBLAGE serveur du gate + V6, coeur réel.
// Skip proprement si l'asset (raw_far), le modèle ECAPA vendorisé, ou speechbrain est absent.
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
const ASSET = path.join(root, "resources", "models", "voice-anchor", "raw_far.wav");   // Yohann held-out
const MODEL = path.join(root, "resources", "models", "speaker", "embedding_model.ckpt");

if (!fs.existsSync(ASSET)) {
  console.log(`SKIP  E2E-V8 : asset ${path.relative(root, ASSET)} absent (ancre de Yohann — CF2, gitignore).`);
  process.exit(0);
}
if (!fs.existsSync(MODEL)) {
  console.log(`SKIP  E2E-V8 : modele ECAPA ${path.relative(root, MODEL)} absent (vendorise, CF2 gitignore).`);
  process.exit(0);
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();
const emitsNow = async () => (await getDebug()).audio.speaker.emits;
// attend que speaker.emits atteigne `target` (V6 a émis un NOUVEAU verdict) — ou timeout.
async function waitEmits(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await emitsNow() >= target) return true; await sleep(300); }
  return false;
}

// test-barge = AEC + VAD (GATÉ par cmd.listen.*) + speaker-ID (VRAI ECAPA) ; SOPHIA_STT_WAV = raw_far.
const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root,
  env: { ...process.env, SIDECAR_AUDIO: "test-barge", SOPHIA_STT_WAV: ASSET },
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
  check("listen_mode initial === resume (ecoute normale au boot)", d1.audio.listen_mode === "resume");

  const speakers = [];
  await client.connect(PORT);
  client.on("evt.speaker", (e) => { speakers.push(e); });

  // 1) V6 fonctionne (comme e2e-v6) : 1er verdict = la voix de Yohann reconnue.
  const deadline = Date.now() + 60000;
  while (speakers.length < 1 && Date.now() < deadline) await sleep(200);
  check(`evt.speaker recu SANS injection (${speakers.length})`, speakers.length >= 1);
  if (speakers.length) {
    const p = speakers[0].payload;
    const thr = (await getDebug()).audio.speaker.threshold;
    check(`locuteur === "yohann" (sa voix reconnue, held-out raw_far)`, p.locuteur === "yohann");
    check(`score > seuil (${p.score} > ${thr})`, p.score > thr);
  }

  // 2) ARM (sa pensee developpee) : le VAD TOURNE -> V6 reste VIVANT (barge-in possible).
  await client.request("cmd.listen.arm", {});
  const dA = await getDebug();
  check("arm : listen_mode === arm", dA.audio.listen_mode === "arm");
  check("arm : audio.vad.muted === false (le VAD tourne -> nourrit V6)", dA.audio.vad.muted === false);
  const eArm0 = await emitsNow();
  check("arm : V6 continue d'emettre (le barge-in est vivant pendant sa pensee)", await waitEmits(eArm0 + 1, 20000));

  // 3) MUTE (phrase fixe : salutation/cloture) : le VAD est GATE -> V6 s'ETEINT (pas de barge-in).
  await client.request("cmd.listen.mute", {});
  check("mute : listen_mode === mute", (await getDebug()).audio.listen_mode === "mute");   // immediat (global serveur)
  await sleep(500);                          // le flag interne _muted se pose au prochain cycle process() du VAD (~32 ms)
  check("mute : audio.vad.muted === true (le VAD ignore le micro)", (await getDebug()).audio.vad.muted === true);
  await sleep(3500);                         // > CAP speaker 3,0 : laisse tout segment en vol se finaliser
  const eMute0 = await emitsNow();
  await sleep(5000);                         // fenetre : en mute, AUCUN nouveau verdict (VAD gate -> plus de marques)
  const eMute1 = await emitsNow();
  check("mute : V6 s'eteint (aucun nouvel emit -> on ne coupe pas une phrase fixe)", eMute1 === eMute0);

  // 4) RESUME (ecoute normale) : le VAD reprend -> V6 REEMET.
  await client.request("cmd.listen.resume", {});
  check("resume : listen_mode === resume", (await getDebug()).audio.listen_mode === "resume");   // immediat
  await sleep(500);                          // le VAD sort du mute au prochain cycle process() (_resume_from_mute)
  check("resume : audio.vad.muted === false (ecoute retablie)", (await getDebug()).audio.vad.muted === false);
  const eRes0 = await emitsNow();
  check("resume : V6 reemet (le gate a bien rallume l'ecoute)", await waitEmits(eRes0 + 1, 20000));

  const dF = await getDebug();
  check("engine_errors === 0 (le vrai ECAPA s'integre sans crash sur tout le cycle de gate)", dF.audio.speaker.engine_errors === 0);
  check("audio.vad.resyncs === 0 (le gate ne jitter pas le VAD)", dF.audio.vad.resyncs === 0);

  // arret propre
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v8" });
  check("cmd.shutdown -> evt.ack correle", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  const dS = await getDebug();
  check("audio LIBERE apres cmd.shutdown (enabled false)", dS.audio.enabled === false);

  client.close();
  await sleep(300);
  const dU = await getDebug();
  check("bus.subscribers == 0 apres deconnexion (desabonnement propre)", dU.bus.subscribers === 0);
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
if (failed.length === 0) console.log("\nE2E-V8 OK : le gate 3 etats controle V6 (arm = barge-in vivant · mute = eteint · resume = rallume), coeur reel ECAPA");
else console.error(`\nE2E-V8 ECHEC : ${failed.length} critere(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
