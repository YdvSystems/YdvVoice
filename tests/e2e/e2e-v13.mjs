// E2E-V13 — la PHRASE DE SECOURS dans le VRAI sidecar (cœur réel, I-4 : « jamais de silence »).
// Prouve le chemin COMPLET de V13 : cmd.tts.cache (VRAI Piper A20 pré-synthétise, moteur transitoire B2) →
// le client WS (l'« orchestrateur ») CRASHE (close ANORMALE — code 4001 ≠ 1000/1005, ROB-M4 : un crash réel
// n'envoie pas de close frame propre) → la source WAV joue « bonjour sophia » → AEC → VAD → VRAI
// faster-whisper → portier → la paire wake↔final (fin du TOUR de réveil, S11) → la phrase de secours JOUE —
// UNE fois par épisode (sortie silencieuse NullOutput, observée par /debug) ; puis, après reconnexion (reset)
// + `cmd.listen.arm` posé (« elle parlait ») + re-crash, le RESET du gate à la déconnexion (FID-M1 : sans lui,
// les oreilles gatées à vie = filet muet) laisse venir le déclencheur TURN.END réel (VRAI Smart Turn) → rejoue
// au NOUVEL épisode. Enfin, une fermeture PROPRE (close() → 1000/1005) NE joue JAMAIS (arrêt volontaire ≠
// panne, ROB-M4). Les DEUX déclencheurs S11 + les 2 fixes du croisé prouvés en cœur réel, SANS injection.
// Skip proprement si l'asset, faster-whisper ou la voix A20 sont absents (CF2, gitignorés).
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
const PORT = 8802;
const ASSET = path.join(root, "sidecar", "tests", "assets", "bonjour_sophia_16k.wav");
const VOICE = path.join(root, "resources", "models", "voice", "fr_FR-a20-e400.onnx");

if (!fs.existsSync(ASSET)) {
  console.log(`SKIP  E2E-V13 : asset ${path.relative(root, ASSET)} absent (genere par gen_asset — CF2).`);
  process.exit(0);
}
if (!fs.existsSync(VOICE)) {
  console.log(`SKIP  E2E-V13 : voix A20 ${path.relative(root, VOICE)} absente (vendorisee, gitignoree — CF2).`);
  process.exit(0);
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();
const waitFor = async (pred, ms, step = 200) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await pred()) return true; } catch { /* transitoire */ }
    await sleep(step);
  }
  return false;
};
// La phrase du test reste NEUTRE (pas le texte produit — il vit dans fallback-phrases.ts, domaine Yohann) ;
// le protocole (name/text) est le même.
const PHRASES = [{ name: "secours", text: "Mon cerveau ne répond pas, je redémarre." }];

const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
  cwd: root, env: { ...process.env, SIDECAR_AUDIO: "test-fallback" }, stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
proc.stderr.on("data", (d) => { stderr += d.toString(); });
let client = new IpcClient();
try {
  // readiness (le serveur répond vite ; STT + Smart Turn se chargent EN FOND ~7 s)
  let up = false;
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok && (await r.json()).ready) { up = true; break; } } catch { /* pas pret */ }
  }
  check("sidecar PRET", up);

  const d1 = await getDebug();
  check("audio.enabled (chemin AEC + VAD monte)", d1.audio.enabled === true);
  check("audio.fallback present (le filet V13 est monte)", d1.audio.fallback && Array.isArray(d1.audio.fallback.cached));
  check("audio.fallback.cached vide au boot (rien avant cmd.tts.cache)", d1.audio.fallback.cached.length === 0);
  check("cmd.tts.cache dans les familles cmd", d1.families.cmd.includes("cmd.tts.cache"));

  // ── ÉPISODE 0 (client connecté) : la pré-synthèse (VRAI Piper, moteur transitoire) ─────────────────────
  await client.connect(PORT);
  const ack1 = await client.request("cmd.tts.cache", { phrases: PHRASES });
  check("cmd.tts.cache -> ack ok + started (pre-synthese lancee)", ack1.payload.ok === true && ack1.payload.started === true);
  const cached = await waitFor(async () => (await getDebug()).audio.fallback.cached.includes("secours"), 30000);
  check("le VRAI Piper a pre-synthetise « secours » (cache RAM pose)", cached);
  const ack2 = await client.request("cmd.tts.cache", { phrases: PHRASES });
  check("cmd.tts.cache re-envoye (double envoi boot) -> idempotent, AUCUN 2e travail",
        ack2.payload.ok === true && ack2.payload.started === false);
  const dCache = await getDebug();
  check("une seule pre-synthese (precaches == 1)", dCache.audio.fallback.precaches === 1);
  check("payload invalide -> ack honnete (jamais un crash du WS)",
        (await client.request("cmd.tts.cache", { phrases: "rien" })).payload.ok === false);

  // tant que le client est LA, un tour ne declenche RIEN (l'orchestrateur traite) — la source boucle deja.
  check("aucune lecture tant que le client est connecte", (await getDebug()).audio.fallback.played_count === 0);

  // ── ÉPISODE 1 : le client CRASHE (close ANORMALE 4001 — ROB-M4 : pas de close frame propre) → réveil →
  //    la phrase joue UNE fois ──
  client.close(4001);
  const gone1 = await waitFor(async () => (await getDebug()).ws_connections === 0, 3000, 100);
  check("ws_connections == 0 (le serveur voit son client parti)", gone1);

  // la source boucle « bonjour sophia » → VRAI STT → portier → paire wake↔final → lecture (une fois).
  const played1 = await waitFor(async () => (await getDebug()).audio.fallback.played_count >= 1, 45000);
  check("la phrase de secours a JOUE (paire wake+final, fin du tour de reveil — S11)", played1);
  const d3 = await getDebug();
  check("played_count == 1 (UNE fois par episode)", d3.audio.fallback.played_count === 1);
  check("last_played == « secours »", d3.audio.fallback.last_played === "secours");
  check("played_this_episode true (episode consomme)", d3.audio.fallback.played_this_episode === true);

  // la source CONTINUE de boucler : Sophia ARMÉE → les cycles suivants = tours de CONVERSATION (turn.end
  // RÉELS, Smart Turn V5). On attend qu'au moins UN turn.end soit passé → le « une fois par épisode » MORD
  // (un déclencheur potentiel est passé SANS re-lecture), pas juste « rien ne s'est passé ».
  const turnSeen = await waitFor(async () => (await getDebug()).audio.stt.turns_ended >= 1, 30000);
  check("des tours de CONVERSATION ont tourne (turn.end reels emis, Smart Turn V5)", turnSeen);
  const d4 = await getDebug();
  check(`pas de re-lecture malgre les turn.end du meme episode (played_count reste 1, turns=${d4.audio.stt.turns_ended})`,
        d4.audio.fallback.played_count === 1);

  // ── ÉPISODE 2 : reconnexion (reset) + `cmd.listen.arm` (« elle parlait ») + re-CRASH → le RESET du gate
  //    à la déconnexion (FID-M1) laisse venir le TURN.END réel → rejoue ──
  client = new IpcClient();
  await client.connect(PORT);
  const d5 = await waitFor(async () => (await getDebug()).audio.fallback.played_this_episode === false, 3000, 100)
    ? await getDebug() : await getDebug();
  check("reconnexion -> episode CLOS (played_this_episode false)", d5.audio.fallback.played_this_episode === false);
  check("client connecte -> pas de lecture pendant qu'il est la", d5.audio.fallback.played_count === 1);
  // FID-M1 (cœur réel) : le routeur avait posé `arm` (elle disait sa pensée) au moment du crash. Sans le
  // reset à la déconnexion, le STT resterait gaté À VIE → plus jamais de turn.end → le filet muet (temp-revert
  // naturel : sans le fix, le rejeu ci-dessous n'arrive jamais → ce bloc ÉCHOUE).
  await client.request("cmd.listen.arm", {});
  check("cmd.listen.arm posé (listen_mode=arm — elle « parlait » au moment du crash)",
        (await getDebug()).audio.listen_mode === "arm");
  client.close(4001);
  const gone2 = await waitFor(async () => (await getDebug()).ws_connections === 0, 3000, 100);
  check("re-crash (close anormale) : client parti", gone2);
  check("FID-M1 : le gate est REMIS à resume au départ du dernier client (jamais sourde à vie)",
        (await getDebug()).audio.listen_mode === "resume");
  // le sidecar est resté ARMÉ (conversation) → le prochain tour émet un turn.end RÉEL → rejoue (nouvel épisode).
  const played2 = await waitFor(async () => (await getDebug()).audio.fallback.played_count >= 2, 30000);
  check("NOUVEL episode -> la phrase rejoue via le declencheur TURN.END reel", played2);
  const d6 = await getDebug();
  check("played_count == 2 (une fois par episode, deux episodes)", d6.audio.fallback.played_count === 2);
  check("play_errors == 0 (la sortie n'a pas trebuche)", d6.audio.fallback.play_errors === 0);
  check("synth_errors == 0 (le vrai Piper n'a pas trebuche)", d6.audio.fallback.synth_errors === 0);
  check("clients_errors == 0 (la sonde clients n'a jamais leve)", d6.audio.fallback.clients_errors === 0);

  // ── ÉPISODE 3 : une fermeture PROPRE (close() → close frame) n'est JAMAIS une panne (ROB-M4) ──────────
  client = new IpcClient();
  await client.connect(PORT);
  await waitFor(async () => (await getDebug()).audio.fallback.played_this_episode === false, 3000, 100);
  const turnsAvant = (await getDebug()).audio.stt.turns_ended;
  client.close(); // fermeture PROPRE (arrêt volontaire — T6, éphémères) : close frame → 1000/1005
  const gone3 = await waitFor(async () => (await getDebug()).ws_connections === 0, 3000, 100);
  check("fermeture PROPRE : client parti", gone3);
  check("ROB-M4 : l'episode est CONSOMME par la fermeture propre (arret volontaire ≠ panne)",
        (await getDebug()).audio.fallback.played_this_episode === true);
  // des tours continuent de tourner (la source boucle) → la phrase ne joue JAMAIS pendant un arrêt voulu.
  const turnAfter = await waitFor(async () => (await getDebug()).audio.stt.turns_ended > turnsAvant, 30000);
  check("un turn.end de plus est passé après la fermeture propre", turnAfter);
  check("ROB-M4 : AUCUNE phrase pendant l'arrêt volontaire (played_count reste 2)",
        (await getDebug()).audio.fallback.played_count === 2);

  // ── arrêt propre : cmd.shutdown → graceful_release démonte le filet AVANT le reste ────────────────────
  client = new IpcClient();
  await client.connect(PORT);
  const ack3 = await client.request("cmd.shutdown", { reason: "e2e-v13" });
  check("cmd.shutdown -> evt.ack correle", ack3.type === "evt.ack" && ack3.payload.for === "cmd.shutdown");
  const d7 = await getDebug();
  check("audio LIBERE apres cmd.shutdown (enabled false)", d7.audio.enabled === false);
  check("fallback DEMONTE apres cmd.shutdown ({} au /debug)", Object.keys(d7.audio.fallback).length === 0);
  check("cmd.tts.cache apres demontage -> ack honnete (non monte)",
        (await client.request("cmd.tts.cache", { phrases: PHRASES })).payload.ok === false);
  client.close();
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
if (failed.length === 0) console.log("\nE2E-V13 OK : jamais de silence — le canal coupé ANORMALEMENT, les oreilles pré-synthétisent (vrai Piper), détectent la panne (close_code) et disent la phrase de secours UNE fois par épisode (paire wake↔final ET turn.end réels, S11) ; gate remis à resume (FID-M1) ; une fermeture PROPRE ne joue jamais (ROB-M4)");
else console.error(`\nE2E-V13 ECHEC : ${failed.length} critere(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
