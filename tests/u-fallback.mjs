// u-fallback — le CÂBLAGE ORCHESTRATEUR du resync des oreilles (V13 + V15, runtime.sendEarsResync).
//
// Le cœur du filet (cache, garde d'épisode, lecture) vit dans le SIDECAR — prouvé par test_v13.py (35
// pytest) + e2e:v13 (cœur réel, vrai Piper + vrai STT + vraie déconnexion WS). ICI, le côté Node : la
// séquence S10 étapes 2-3 (V15 conv 60 : `cmd.enroll.push` JALON D'ORDRE puis `cmd.tts.cache {phrases}`,
// ordre STRICT) — le chemin CANAL DURABLE (ensureVoicePipeline), le chemin ÉPHÉMÈRE (le hook boot phase 5,
// connexion jetable vers un VRAI sidecar socle, socket refermé sans fuite), la robustesse (un échec d'IPC
// ne fait jamais tomber l'appelant), et l'HONNÊTETÉ des logs (ROB-M3 croisé conv 58 : l'ack `ok:false` du
// sidecar → « NON posées », jamais un « descendues » menteur). V15 : le resync n'est PLUS gaté
// `audioEnabled` (structure S10, messages WS locaux sans effet machine — les acks d'un sidecar sans audio
// sont honnêtes ; le ducking/phantoms/phrase de retour restent gatés). Le bout-en-bout réel = e2e:v15.
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

/** SophiaRuntime SANS spawn (factory factice — run() n'est jamais appelé ici ; on exerce sendEarsResync
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

// ── B — canal DURABLE (ensureVoicePipeline) : la séquence S10 (enroll PUIS cache, ordre STRICT) ; acks LUS ──
{
  const { rt, logs } = makeRuntime({ audioEnabled: true });
  const calls = [];
  rt.earsIpc = { request: (type, payload) => {
    calls.push([type, payload]);
    return Promise.resolve({ payload: type === "cmd.enroll.push"
      ? { ok: true, anchor: "vendored", speaker: "monte" }
      : { ok: true, started: true } });
  } };
  await rt.sendEarsResync("test-durable");
  check("B: DEUX envois par le canal durable, l'ORDRE S10 : enroll PUIS tts.cache (V15)",
    calls.length === 2 && calls[0][0] === "cmd.enroll.push" && calls[1][0] === "cmd.tts.cache");
  check("B: le payload du cache porte les phrases (name+text)", calls[1]?.[1]?.phrases === FALLBACK_PHRASES);
  check("B: ack enroll LU → le log dit l'état de l'ancre (vendored/monte)",
    logs.some((l) => l.includes("empreintes (enroll S10)") && l.includes("vendored") && l.includes("monte")));
  check("B: ack cache ok:true → le log dit « descendues »", logs.some((l) => l.includes("phrases de secours descendues")));
  // ROB-M3 : un ack ok:false (filet non monté côté oreilles — micro absent, « vivant sans oreilles ») → le
  // log DIT l'échec avec la note du sidecar, jamais un « descendues » menteur.
  const { rt: rt2, logs: logs2 } = makeRuntime({ audioEnabled: true });
  rt2.earsIpc = { request: (type) => Promise.resolve({ payload: type === "cmd.enroll.push"
    ? { ok: true, anchor: "vendored", speaker: "absent" }
    : { ok: false, note: "phrase de secours (V13) non montee" } }) };
  await rt2.sendEarsResync("test-ok-false");
  check("B: ack cache ok:false → « NON posées » + la note du sidecar (log honnête)",
    logs2.some((l) => l.includes("phrases de secours NON posées") && l.includes("non montee"))
    && !logs2.some((l) => l.includes("phrases de secours descendues")));
}

// ── C — V15 : le resync n'est PLUS gaté audioEnabled (structure S10 — les acks honnêtes suffisent ; le
//        ducking/phantoms/phrase de retour, eux, restent gatés — écart vs le gate V13 conv 58, tracé §7) ──
{
  const { rt } = makeRuntime({ audioEnabled: false });
  const calls = [];
  rt.earsIpc = { request: (type) => { calls.push(type); return Promise.resolve({ payload: { ok: false, note: "non montee" } }); } };
  await rt.sendEarsResync("test-sans-audio");
  check("C: audioEnabled=false → la séquence S10 part QUAND MÊME (structure, acks honnêtes)",
    calls.length === 2 && calls[0] === "cmd.enroll.push" && calls[1] === "cmd.tts.cache");
}

// ── C2 — V15 (solo S1) : pipelineIsStale — le PID est le témoin SÛR du respawn (un port éphémère peut être
//        réattribué à l'identique ; un PID de process neuf, jamais). Port OU pid changé → périmé. ──
{
  const { rt } = makeRuntime({ audioEnabled: false, port: 4242 });
  // câblage simulé : les témoins mémorisés = l'état courant des superviseurs
  rt.earsPortWired = rt.earsSupervisor.port; rt.earsPidWired = rt.earsSupervisor.pid;
  rt.mouthPortWired = rt.mouthSupervisor.port; rt.mouthPidWired = rt.mouthSupervisor.pid;
  check("C2: témoins à jour → pipeline FRAIS", rt.pipelineIsStale() === false);
  rt.earsPidWired = 99999;                        // le PID a changé (respawn), le PORT est retombé identique
  check("C2: pid changé, port identique → PÉRIMÉ (le pid-témoin MORD — S1)", rt.pipelineIsStale() === true);
  rt.earsPidWired = rt.earsSupervisor.pid;
  rt.mouthPortWired = 55555;                      // le port a changé (le témoin d'origine)
  check("C2: port changé → PÉRIMÉ", rt.pipelineIsStale() === true);
}

// ── D — un échec d'IPC ne fait JAMAIS tomber l'appelant (le boot continue sans filet, dit honnêtement) ──
{
  const { rt, logs } = makeRuntime({ audioEnabled: true });
  rt.earsIpc = { request: () => Promise.reject(new Error("canal ferme (test)")) };
  let threw = false;
  try { await rt.sendEarsResync("test-echec"); } catch { threw = true; }
  check("D: le rejet IPC ne remonte pas (jamais fatal)", threw === false);
  check("D: l'échec du cache est DIT (« NON descendues »)", logs.some((l) => l.includes("phrases de secours NON descendues")));
  check("D: l'échec de l'enroll est DIT (« NON confirmées »)", logs.some((l) => l.includes("empreintes (enroll S10) NON confirmées")));
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
    await rt.sendEarsResync("test-boot-phase5");
    check("E: enroll — l'ack ENRICHI du VRAI sidecar est LU (socle sans audio → vendored, speaker absent)",
      logs.some((l) => l.includes("empreintes (enroll S10)") && l.includes("vendored") && l.includes("absent")));
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
//        serveur accepte le TCP mais ne répond RIEN → sans la borne 5 s, sendEarsResync pendrait à vie
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
    const call = rt.sendEarsResync("test-hang").then(() => { done = true; });
    await Promise.race([call, sleep(8000)]);
    const elapsed = Date.now() - t0;
    check(`F: le boot n'est JAMAIS suspendu (retour en ${elapsed} ms ≤ ~5,5 s, borne SOLO-2)`, done && elapsed < 7000);
    check("F: l'abandon est DIT (« resync oreilles NON fait »)", logs.some((l) => l.includes("resync oreilles NON fait")));
  } finally {
    server.close();
  }
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log(`\nu-fallback OK (${results.length} vérifs) : le resync des oreilles (V13+V15, S10 : enroll → cache) — durable, éphémère, acks lus, jamais fatal`);
else console.error(`\nu-fallback ECHEC : ${failed.length} critere(s)`);
// process.exitCode (PAS process.exit) : un exit() dur pendant la fermeture des sockets du pool fetch/undici
// crashe libuv sur Windows (assert UV_HANDLE_CLOSING → exit 127) — patron des e2e (le process se draine seul).
process.exitCode = failed.length === 0 ? 0 : 1;
