// E2E-V7 — la BOUCHE (voix A20 Piper) dans le VRAI sidecar (cœur reel, sans micro, SANS jouer de son).
// Prouve le chemin COMPLET de V7 : l'orchestrateur (IpcClient) pousse cmd.tts.speak/push/end -> la prise
// TtsPlug decoupe en phrases -> le VRAI Piper A20 synthetise (train gen/play) -> sortie SILENCIEUSE (E2E
// headless) -> evt.tts.start (1er son) / evt.tts.done (fin) remontent par le bus -> WS. On verifie le
// CABLAGE + la synthese reelle + le cycle start/done + la purge, SANS jouer de son (le juge a ta VOIX =
// mode prod / SOPHIA_TTS_AUDIBLE=1, live avec Yohann). Skip si la voix A20 vendorisee est absente.
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
const PORT = 8801;
const MODEL = path.join(root, "resources", "models", "voice", "fr_FR-a20-e400.onnx");

if (!fs.existsSync(MODEL)) {
  console.log(`SKIP  E2E-V7 : voix A20 ${path.relative(root, MODEL)} absente (vendorise, CF2 gitignore).`);
  process.exit(0);
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

// test-tts = la BOUCHE SEULE (VRAI Piper A20), sortie SILENCIEUSE (pas de SOPHIA_TTS_AUDIBLE) -> E2E headless.
const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root,
  env: { ...process.env, SIDECAR_AUDIO: "test-tts", PYTHONIOENCODING: "utf-8" },
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
  check("audio.tts present (V7 la bouche montee)", d1.audio.tts && typeof d1.audio.tts.utterances === "number");
  check("evt.tts.start / evt.tts.done dans le vocabulaire", d1.families.evt.includes("evt.tts.start") && d1.families.evt.includes("evt.tts.done"));

  // le worker gen charge Piper (~4 s) -> attendre engine_ok avant de pousser du texte (la bouche est prete).
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if ((await getDebug()).audio.tts.engine_ok === true) { ready = true; break; }
    await sleep(250);
  }
  check("Piper A20 charge (engine_ok)", ready);

  const starts = [], dones = [];
  await client.connect(PORT);
  client.on("evt.tts.start", (e) => starts.push(e.payload));
  client.on("evt.tts.done", (e) => dones.push(e.payload));

  // ── une enonciation : speak(1) -> push (au fil) -> end(1) -> start(1) + 3 phrases synthetisees + done(1) ──
  await client.request("cmd.tts.speak", { id: 1 });
  await client.request("cmd.tts.push", { id: 1, text: "Bonjour Yohann. Voici une premiere phrase, " });
  await client.request("cmd.tts.push", { id: 1, text: "puis une deuxieme, un peu plus longue. Et une troisieme." });
  await client.request("cmd.tts.end", { id: 1 });

  let deadline = Date.now() + 30000;
  while (dones.length < 1 && Date.now() < deadline) await sleep(100);

  check(`evt.tts.start recu (${starts.length})`, starts.some((p) => p.id === 1));
  check(`evt.tts.done recu (${dones.length})`, dones.some((p) => p.id === 1 && p.reason === "completed"));

  const d2 = await getDebug();
  check("audio.tts.starts >= 1", d2.audio.tts.starts >= 1);
  check("audio.tts.dones >= 1", d2.audio.tts.dones >= 1);
  check("audio.tts.sentences >= 3 (decoupe en phrases -> Piper)", d2.audio.tts.sentences >= 3);
  check("audio.tts.synth_errors === 0 (le vrai Piper A20 synthetise sans crash)", d2.audio.tts.synth_errors === 0);
  check("audio.tts.dropped_gen === 0 (le train draine, pas de fuite)", d2.audio.tts.dropped_gen === 0);

  // ── purge : speak(2) + push (sans end) -> cmd.tts.stop -> la purge coupe (au moins acquittee + comptee) ──
  await client.request("cmd.tts.speak", { id: 2 });
  await client.request("cmd.tts.push", { id: 2, text: "Une phrase. Une autre. Encore une. " });
  const ackStop = await client.request("cmd.tts.stop", {});
  check("cmd.tts.stop -> evt.ack correle", ackStop.type === "evt.ack" && ackStop.payload.for === "cmd.tts.stop");
  await sleep(200);
  const d3 = await getDebug();
  check("audio.tts.purges >= 1 (la purge a bien ete appelee)", d3.audio.tts.purges >= 1);

  // ── arret propre ──
  const ack = await client.request("cmd.shutdown", { reason: "e2e-v7" });
  check("cmd.shutdown -> evt.ack correle", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
  const d4 = await getDebug();
  check("audio LIBERE apres cmd.shutdown (tts arrete)", d4.audio.tts && Object.keys(d4.audio.tts).length === 0);

  client.close();
  await sleep(300);
  const d5 = await getDebug();
  check("bus.subscribers == 0 apres deconnexion (desabonnement propre)", d5.bus.subscribers === 0);
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
if (failed.length === 0) console.log("\nE2E-V7 OK : la bouche (Piper A20) parle dans le vrai sidecar (cmd.tts.* -> synthese reelle -> evt.tts.*, cycle + purge, sans jouer de son)");
else console.error(`\nE2E-V7 ECHEC : ${failed.length} critere(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
