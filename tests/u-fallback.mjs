// u-fallback — le CÂBLAGE ORCHESTRATEUR de la phrase de secours (V13, runtime.sendFallbackCache).
//
// Le cœur du filet (cache, garde d'épisode, lecture) vit dans le SIDECAR — prouvé par test_v13.py (30
// pytest) + e2e:v13 (cœur réel, vrai Piper + vrai STT + vraie déconnexion WS). ICI, le côté Node : la
// descente des phrases (`cmd.tts.cache {phrases}`) — le chemin CANAL DURABLE (ensureVoicePipeline), le
// chemin ÉPHÉMÈRE (le hook boot phase 5, connexion jetable vers un VRAI sidecar socle, socket refermé
// sans fuite), le gate `audioEnabled` (un harnais sans audio n'envoie RIEN — patron V12), la robustesse
// (un échec d'IPC ne fait jamais tomber l'appelant), et l'HONNÊTETÉ des logs (ROB-M3 croisé conv 58 :
// l'ack `ok:false` du sidecar → « NON posées », jamais un « descendues » menteur). Le câblage bout-en-bout
// du VRAI boot audio (hook sidecarPostReady → logs au boot phase 5) = le juge.
//
// Node PUR (fakeApp : installBeforeQuit ne demande que `on`/`exit` — patron e2e-boot-respawn).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { SophiaRuntime } = require(path.join(root, "dist/electron/runtime.js"));
const { FALLBACK_PHRASES } = require(path.join(root, "dist/src/orchestrator/voice/fallback-phrases.js"));
const { resolvePaths } = require(path.join(root, "dist/src/orchestrator/paths.js"));

const results = [];
const check = (n, c) => results.push([n, !!c]);
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8804;

const fakeApp = { on: () => {}, exit: () => {}, quit: () => {} };
const home = path.join(root, ".sophia-home-dev", "u-fallback");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
const paths = resolvePaths(home);

/** SophiaRuntime SANS spawn (factory factice — run() n'est jamais appelé ici ; on exerce sendFallbackCache
 *  directement, `private` TS = accessible en JS). `port` pointe le sidecar socle du chemin éphémère. */
function makeRuntime({ audioEnabled, port = 1 }) {
  const fakeSup = {
    port, pid: null, lastSpawnedPid: null, currentState: "READY",
    start: async () => {}, stop: async () => {}, orphanCleanup: () => {},
  };
  const logs = [];
  const rt = new SophiaRuntime(fakeApp, paths, root, { onLog: (l) => logs.push(l) }, {
    audioEnabled,
    supervisorFactory: () => fakeSup,
  });
  return { rt, logs };
}

// ── A — le contrat des phrases (la structure que le protocole descend) ──
{
  check("A: FALLBACK_PHRASES porte « secours »", FALLBACK_PHRASES.some((p) => p.name === "secours"));
  check("A: chaque phrase a un texte non vide", FALLBACK_PHRASES.every((p) => typeof p.text === "string" && p.text.trim().length > 0));
}

// ── B — canal DURABLE (ensureVoicePipeline) : cmd.tts.cache part avec les phrases ; l'ack est LU (ROB-M3) ──
{
  const { rt, logs } = makeRuntime({ audioEnabled: true });
  const calls = [];
  rt.earsIpc = { request: (type, payload) => { calls.push([type, payload]); return Promise.resolve({ payload: { ok: true, started: true } }); } };
  await rt.sendFallbackCache("test-durable");
  check("B: UN cmd.tts.cache envoyé par le canal durable", calls.length === 1 && calls[0][0] === "cmd.tts.cache");
  check("B: le payload porte les phrases (name+text)", calls[0]?.[1]?.phrases === FALLBACK_PHRASES);
  check("B: ack ok:true → le log dit « descendues »", logs.some((l) => l.includes("phrases de secours descendues")));
  // ROB-M3 : un ack ok:false (filet non monté côté oreilles — micro absent, « vivant sans oreilles ») → le
  // log DIT l'échec avec la note du sidecar, jamais un « descendues » menteur.
  const { rt: rt2, logs: logs2 } = makeRuntime({ audioEnabled: true });
  rt2.earsIpc = { request: () => Promise.resolve({ payload: { ok: false, note: "phrase de secours (V13) non montee" } }) };
  await rt2.sendFallbackCache("test-ok-false");
  check("B: ack ok:false → « NON posées » + la note du sidecar (log honnête)",
    logs2.some((l) => l.includes("phrases de secours NON posées") && l.includes("non montee"))
    && !logs2.some((l) => l.includes("phrases de secours descendues")));
}

// ── C — gate audioEnabled : un harnais SANS audio n'envoie RIEN (patron V12) ──
{
  const { rt, logs } = makeRuntime({ audioEnabled: false });
  const calls = [];
  rt.earsIpc = { request: (type) => { calls.push(type); return Promise.resolve({}); } };
  await rt.sendFallbackCache("test-gate");
  check("C: audioEnabled=false → AUCUN envoi", calls.length === 0);
  check("C: aucun log de descente", !logs.some((l) => l.includes("phrases de secours")));
}

// ── D — un échec d'IPC ne fait JAMAIS tomber l'appelant (le boot continue sans filet, dit honnêtement) ──
{
  const { rt, logs } = makeRuntime({ audioEnabled: true });
  rt.earsIpc = { request: () => Promise.reject(new Error("canal ferme (test)")) };
  let threw = false;
  try { await rt.sendFallbackCache("test-echec"); } catch { threw = true; }
  check("D: le rejet IPC ne remonte pas (jamais fatal)", threw === false);
  check("D: l'échec est DIT (« NON descendues »)", logs.some((l) => l.includes("phrases de secours NON descendues")));
}

// ── E — chemin ÉPHÉMÈRE (le hook boot phase 5) : connexion jetable vers un VRAI sidecar socle, ack CORRÉLÉ
//        reçu et LU (le socle, sans audio, acke `ok:false "non montee"` → le log dit « NON posées » — ROB-M3 :
//        le mensonge « descendues » sur ok:false était VERROUILLÉ ici même avant le croisé conv 58), socket
//        refermé SANS fuite (ws_connections retombe à 0). ──
{
  const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
    cwd: root, env: { ...process.env }, stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) { up = true; break; } } catch { /* pas pret */ }
    }
    check("E: sidecar socle PRET", up);
    const { rt, logs } = makeRuntime({ audioEnabled: true, port: PORT });
    check("E: pas de canal durable (earsIpc null → chemin éphémère)", rt.earsIpc === null);
    await rt.sendFallbackCache("test-boot-phase5");
    check("E: l'ack corrélé du VRAI sidecar est reçu ET LU — socle sans filet → « NON posées » honnête",
      logs.some((l) => l.includes("phrases de secours NON posées") && l.includes("non montee")));
    check("E: jamais un « descendues » menteur sur ok:false", !logs.some((l) => l.includes("phrases de secours descendues")));
    const gone = await (async () => {                          // ROB-NIT-6 : waitFor (pas un sleep sec — flake)
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try { if ((await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json()).ws_connections === 0) return true; } catch { /* */ }
        await sleep(100);
      }
      return false;
    })();
    check("E: le socket éphémère est REFERMÉ (ws_connections == 0, pas de fuite)", gone);
  } catch (e) {
    check(`E: exception (${e.message}) — stderr: ${stderr.slice(-300)}`, false);
  } finally {
    proc.kill();
    await new Promise((res) => {
      let done = false; let timer = null;
      const d = () => { if (!done) { done = true; if (timer) clearTimeout(timer); res(); } };
      proc.once("exit", d); timer = setTimeout(d, 3000);
    });
  }
}

// ── F — SOLO-2 : un handshake WS qui PEND ne suspend JAMAIS le boot (le hook phase 5 est awaité). Le
//        serveur accepte le TCP mais ne répond RIEN → sans la borne 5 s, sendFallbackCache pendrait à vie
//        (IpcClient.connect n'a pas de timeout propre) → le boot resterait AVANT PRÊT. Temp-revert : sans
//        le Promise.race, ce test ÉCHOUE (timeout du harnais). ──
{
  const server = net.createServer(() => { /* accepte, ne répond jamais (handshake suspendu) */ });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  try {
    const { rt, logs } = makeRuntime({ audioEnabled: true, port });
    const t0 = Date.now();
    let done = false;
    const call = rt.sendFallbackCache("test-hang").then(() => { done = true; });
    await Promise.race([call, sleep(8000)]);
    const elapsed = Date.now() - t0;
    check(`F: le boot n'est JAMAIS suspendu (retour en ${elapsed} ms ≤ ~5,5 s, borne SOLO-2)`, done && elapsed < 7000);
    check("F: l'abandon est DIT (« NON descendues »)", logs.some((l) => l.includes("phrases de secours NON descendues")));
  } finally {
    server.close();
  }
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log(`\nu-fallback OK (${results.length} vérifs) : la descente des phrases de secours (V13) — durable, éphémère, gate audio, jamais fatale`);
else console.error(`\nu-fallback ECHEC : ${failed.length} critere(s)`);
// process.exitCode (PAS process.exit) : un exit() dur pendant la fermeture des sockets du pool fetch/undici
// crashe libuv sur Windows (assert UV_HANDLE_CLOSING → exit 127) — patron des e2e (le process se draine seul).
process.exitCode = failed.length === 0 ? 0 : 1;
