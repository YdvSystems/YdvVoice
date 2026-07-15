// U-T2 — le canal IPC. Vérifie : /health + /debug (REST) ; un cmd.* -> evt.ack corrélé par id
// (aller-retour WS) ; extensibilité (un cmd.* inconnu est acquitté ; un evt.* non sollicité reçu) ;
// bind 127.0.0.1 (localhost) ; invariant audio-hors-canal. Spawn le sidecar aiohttp, puis l'arrête.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const PORT = 8772;
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");

const results = [];
const check = (n, c) => results.push([n, !!c]);

const proc = spawn(PY, ["sidecar/server.py", String(PORT)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
const client = new IpcClient();
try {
  // attendre /health
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.status === 200) { const j = await r.json(); if (j.ok && j.ready) { up = true; break; } }
    } catch { /* pas encore prêt */ }
  }
  check("REST /health répond {ok, ready}", up);

  // /debug (+ localhost + invariant audio)
  let dbgOk = false, localhostOnly = false, noAudio = false;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/debug`);
    if (r.status === 200) {
      const j = await r.json();
      dbgOk = j.ok === true && j.protocol_version >= 1;
      localhostOnly = j.host === "127.0.0.1";
      noAudio = j.audio_on_channel === false;
    }
  } catch { /* ignore */ }
  check("REST /debug répond (sonde sans WS)", dbgOk);
  check("bind 127.0.0.1 (auto-déclaré /debug)", localhostOnly);
  check("invariant : audio ne traverse pas le canal", noAudio);

  // bind localhost par CONSTRUCTION (plus fort que l'auto-déclaration) : le sidecar ne bind QUE
  // 127.0.0.1, jamais 0.0.0.0 ni une interface externe — même patron que U-T1 pour F2.
  const srcSidecar = fs.readFileSync(path.join(root, "sidecar", "server.py"), "utf8");
  const bindsLocalhostOnly = /HOST\s*=\s*"127\.0\.0\.1"/.test(srcSidecar) && !/0\.0\.0\.0/.test(srcSidecar);
  check("bind 127.0.0.1 par construction (aucun 0.0.0.0 dans le sidecar)", bindsLocalhostOnly);
  const usesHostConstant = /run_app\([^)]*host=HOST/.test(srcSidecar); // la constante est RÉELLEMENT utilisée (fid2)
  check("run_app utilise bien host=HOST (constante non décorative, fid2)", usesHostConstant);

  // WS : evt.* non sollicité à la connexion (evt.health)
  let gotHealth = false;
  client.on("evt.health", () => { gotHealth = true; });
  await client.connect(PORT);
  await sleep(250);
  check("evt.* non sollicité reçu (evt.health à la connexion)", gotHealth);

  // cmd.* -> evt.ack corrélé par id
  const ack = await client.request("cmd.shutdown", { reason: "u-t2" });
  check("cmd.* -> evt.ack corrélé par id", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");

  // extensibilité : un cmd.* INCONNU est quand même acquitté (le protocole ne casse pas)
  const ack2 = await client.request("cmd.futuretype", {});
  check("extensibilité : cmd.* nouveau acquitté", ack2.type === "evt.ack" && ack2.payload.for === "cmd.futuretype");

  // m3 : une réponse evt.error corrélée REJETTE la requête (le sidecar renvoie evt.error pour un
  // type non-cmd.*, corrélé par id) — l'appelant ne doit PAS voir un faux succès.
  let rejected = false;
  try { await client.request("pas.un.cmd", {}); } catch { rejected = true; }
  check("m3 : evt.error corrélé -> request() rejette (pas un faux succès)", rejected);

  client.close();
} finally {
  proc.kill();
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T2 OK : tous les critères passent"); process.exit(0); }
else { console.error(`\nU-T2 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
