// LE JUGE À TA VOIX — outil PERMANENT de mesure de latence (conv 48). Lance : `npm run juge` (ou `npm run juge -- --passes 2`).
//
// À QUOI ÇA SERT : entendre Sophia EN VRAI et chronométrer CHAQUE latence — du « bonjour » à la clôture — pour PROUVER
// qu'on ne régresse jamais (⛔ règle perf conv 44). Yohann parle au micro ; le juge mesure et affiche, à n'importe quel
// moment, sur autant de « temps » (conversations) qu'il veut.
//
// CE QU'IL EXERCE : le VRAI code migré (conv 48) — DEUX `Supervisor` (rôles ears/mouth, audio ON), DEUX `IpcClient`, le
// `ConversationRouter` à 2 canaux, le `WarmBrain` (cerveau chaud, OAuth Max). C'est l'archi 2 process du produit ; le juge
// ne fait qu'OBSERVER l'horloge (des écoutes evt.* en plus, sans commander) + wrapper le cerveau pour lire son TTFT.
//
// SYNCHRO SANS ÉCRAN (Yohann ne voit pas ce terminal) : BIPS. 2 aigus = « PARLE » (tout est chaud). 1 médium = un temps
// enregistré (clôture détectée). 3 graves = FINI (résumé imprimé). Ctrl-C = arrêt propre (résumé quand même).
//
// DÉROULÉ D'UN « TEMPS » : « Bonjour Sophia » → 2-3 échanges → « Merci Sophia, à plus tard » (clôture). Pause. Recommence
// pour le temps 2 (on vérifie que le retour après pause reste CHAUD). `--passes N` = s'arrête tout seul après N clôtures.
//
// Ce qui est mesuré, par tour :
//   · réveil   : evt.wake → 1er son de la salutation (« Bonjour Yohann »).
//   · reponse  : evt.turn.end → 1er son de sa réponse (ce que TU entends) + TTFT cerveau (turn.end → 1er token, lu du WarmBrain).
//   · clôture  : evt.turn.end → 1er son de « Avec grand plaisir ».
// Un masqueur (« Donne-moi une petite minute », si le cerveau tarde > 3 s) est signalé.
//
// OPTIONS : `--endpointing` (score Smart Turn de chaque pause) · `--bargein` (bip + latence à chaque coupe). Le barge-in
// (« coupe-la en parlant par-dessus ») marche PAR DÉFAUT (V6 allumé = comme le produit) ; parler pendant qu'elle répond
// la COUPE → la latence de CE tour-là est du bruit. Pour des chiffres de réveil/TTFT propres, laisse-la finir avant de reprendre.
//
// Repli propre : voix A20 absente → SKIP (comme les E2E). Nettoyage garanti (SIGINT + fin) : router.stop, ipc.close,
// warm.close, terminate des deux sidecars.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const req = (rel) => require(path.join(root, rel));

const { Supervisor } = req("dist/src/orchestrator/supervisor/index.js");
const { IpcClient } = req("dist/src/orchestrator/ipc/index.js");
const { ConversationRouter } = req("dist/src/orchestrator/voice/router.js");
const { WarmBrain } = req("dist/src/orchestrator/resources/warm/index.js");
const { resolvePaths } = req("dist/src/orchestrator/paths.js");
const { matchClosing } = req("dist/src/orchestrator/voice/portier.js");

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const passesTarget = (() => { const i = argv.indexOf("--passes"); return i >= 0 ? parseInt(argv[i + 1], 10) : 0; })(); // 0 = infini (Ctrl-C)
const verbose = argv.includes("--verbose");
// conv 48 (opt-in) : mesure AUSSI l'endpointing (score Smart Turn de CHAQUE candidat de silence) → on voit quel score
// tes PAUSES produisent vs. tes vraies fins. Allume SOPHIA_TURN_DIAG sur les oreilles (evt.turn.eval, off en prod).
const diagEndpoint = argv.includes("--endpointing") || argv.includes("--diag");
// conv 49 (V8) : le barge-in (« coupe-la en parlant par-dessus sa réponse ») marche DÈS `npm run juge` (V6 allumé par
// défaut = comme le produit). `--bargein` n'ajoute que l'OBSERVATION : 1 bip aigu à chaque coupe + latence approx (ta
// parole → coupure). Le vrai juge = ton oreille (elle s'arrête net).
const bargein = argv.includes("--bargein");

// Repères connus (banc / juge conv 47) pour dire « régression ou pas » d'un coup d'œil.
const REF = { reveilLo: 650, reveilHi: 830, reveilJuge: 759, ttftBanc: 1276, ttftJuge: 1389 };

const MODEL = path.join(root, "resources", "models", "voice", "fr_FR-a20-e400.onnx");
if (!fs.existsSync(MODEL)) {
  console.log(`SKIP  juge : voix A20 ${path.relative(root, MODEL)} absente (vendorisée, CF2 gitignore) — rien à juger.`);
  process.exit(0);
}

// Maison jetable dédiée au juge (audit du WarmBrain, pidfiles) — n'écrase pas la vraie base.
const home = path.join(root, ".sophia-home-dev", "juge");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
const paths = resolvePaths(home);

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, monotone

// ── bips (PowerShell [console]::beep — synchro sans écran) ──────────────────────
function beep(seq) {
  try {
    const cmd = seq.map(([f, d]) => `[console]::beep(${f},${d})`).join(";");
    spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { stdio: "ignore", windowsHide: true });
  } catch { /* le bip n'est jamais vital */ }
}
const BIP_GO = () => beep([[1320, 160], [1568, 200]]);              // 2 aigus = PARLE
const BIP_PASS = () => beep([[988, 150]]);                          // 1 médium = un temps enregistré
const BIP_DONE = () => beep([[440, 200], [392, 200], [330, 260]]); // 3 graves = FINI
const BIP_BARGE = () => beep([[1760, 120]]);                       // 1 aigu bref = barge-in détecté (elle coupe)

// ── superviseurs (rôles, audio ON) — le VRAI câblage migré ──────────────────────
const mkSup = (role) => new Supervisor({
  python: path.join(root, ".venv-sidecar", "Scripts", "python.exe"),
  script: "sidecar/server.py",
  cwd: root,
  pidfile: path.join(home, `sidecar-${role}.pid`),
  extraEnv: (() => {
    const env = { SIDECAR_ROLE: role, SIDECAR_AUDIO: "1" };
    // V6 (speaker-ID → barge-in V8) TOUJOURS allumé sur les oreilles = FIDÈLE AU PRODUIT (runtime.ts pose SOPHIA_SPEAKER=1
    // en prod). Le barge-in marche donc dès `npm run juge`, et le réveil/TTFT mesurés INCLUENT le coût CPU de V6 (le vrai
    // chiffre produit). `--bargein` n'ajoute plus que l'OBSERVATION (bip + latence de coupe).
    if (role === "ears") env.SOPHIA_SPEAKER = "1";
    if (role === "ears" && diagEndpoint) env.SOPHIA_TURN_DIAG = "1";   // --endpointing → diagnostic Smart Turn (evt.turn.eval)
    return env;
  })(),
  onLog: (l) => { if (verbose) console.log(`[${role}] ${l}`); },
});
const earsSup = mkSup("ears");
const mouthSup = mkSup("mouth");

// ── mesures ─────────────────────────────────────────────────────────────────────
let passIdx = 1;                 // temps en cours (1-based)
const passes = [[]];             // passes[p] = liste de tours {type, latMs, ttftMs, filler}
let pending = null;              // {type, t0, sub} en attente d'un 1er son
let lastFinalText = "";          // dernier transcript (pour matchClosing → détecter la clôture)
let lastVadStopT = null;         // fin de la dernière parole (evt.vad.stop) → repère du « silence→son » du réveil
let lastVadStartT = null;        // début de la dernière parole (evt.vad.start) → repère du barge-in (parole→coupure)
const bargeins = [];             // V8 : latences barge-in (ms) ≈ ta parole (vad.start) → coupure (log routeur), approx
const ttftQueue = [];            // TTFT (ms) de chaque ask() cerveau, DANS L'ORDRE (tours sérialisés → appariables 1:1)
let done = false;
let closingId = null;            // id de l'énonciation de clôture (« Avec grand plaisir ») — on attend SA fin avant de clore
let closingTimer = null;         // filet : si son evt.tts.done n'arrive jamais (moteur mort), on clôt après une deadline
// conv 48 (--endpointing) : score Smart Turn de chaque candidat de silence, groupé par tour de conversation.
const endpointTurns = [];        // [{ evals:[{prob,parle,plaf,reason}], endProb }] — un par tour fini
let curEvals = [];               // évaluations du tour EN COURS (vidé à chaque fin de tour)

function record(type, latMs, filler, attente) {
  const rec = { type, latMs: Math.round(latMs), ttftMs: null, filler: !!filler, attenteMs: attente != null ? Math.round(attente) : null };
  passes[passIdx - 1].push(rec);
  const flag = type === "reveil" ? (latMs <= REF.reveilHi ? "✓ fourchette banc" : `⚠ > ${REF.reveilHi}`) : "";
  const att = rec.attenteMs != null ? `  (endpointing ${rec.attenteMs})` : "";
  console.log(`  T${passIdx} · ${type.padEnd(8)} → son ${String(Math.round(latMs)).padStart(5)} ms${att}${filler ? "  (masqueur)" : ""}  ${flag}`);
  return rec;
}

// ── run ──────────────────────────────────────────────────────────────────────────
let earsIpc, mouthIpc, router, brain;

async function ready(port, keyPath) {
  try {
    const d = await (await fetch(`http://127.0.0.1:${port}/debug`, { signal: AbortSignal.timeout(1500) })).json();
    let v = d; for (const k of keyPath) v = v?.[k];
    return v === true;
  } catch { return false; }
}

async function main() {
  console.log("juge : démarrage des 2 process (oreilles + bouche)… (chargement des modèles ~10-15 s)");
  await Promise.all([earsSup.start(), mouthSup.start()]);
  if (earsSup.currentState !== "READY" || mouthSup.currentState !== "READY") {
    throw new Error(`sidecar non prêt (ears=${earsSup.currentState}, mouth=${mouthSup.currentState})`);
  }

  earsIpc = new IpcClient(); await earsIpc.connect(earsSup.port);
  mouthIpc = new IpcClient(); await mouthIpc.connect(mouthSup.port);

  // le VRAI cerveau chaud (OAuth Max), wrappé pour LIRE son TTFT (turn.end → 1er token) sans le déranger. Le prewarm
  // du routeur passe par brain.prewarm (→ brain.ask INTERNE), PAS par ce wrapper → la file ne contient QUE les vrais tours.
  brain = new WarmBrain({ paths, onLog: (l) => { if (verbose) console.log(`[warm] ${l}`); } });
  const timedBrain = {
    prewarm: () => brain.prewarm?.(),
    ask: (text, opts = {}) => brain.ask(text, opts).then((res) => { ttftQueue.push(typeof res.ttftMs === "number" ? res.ttftMs : null); return res; }),
  };

  router = new ConversationRouter({ earsIpc, mouthIpc, brain: timedBrain, onLog: (l) => {
    if (verbose) console.log(`[rt] ${l}`);
    if (bargein && l.includes("barge-in")) {                 // V8 : le routeur a coupé (Yohann par-dessus sa réponse)
      const lat = lastVadStartT != null ? now() - lastVadStartT : null;
      if (lat != null) bargeins.push(Math.round(lat));
      console.log(`  ✂ BARGE-IN — tu l'as coupée${lat != null ? ` (~${Math.round(lat)} ms depuis ta parole)` : ""}`);
      BIP_BARGE();
    }
  } });
  router.start();

  // écoutes de mesure (en PLUS de celles du routeur — evt.* diffusés à tous les abonnés, aucune interférence).
  // Réveil = « silence→son » : depuis la FIN de ta parole (dernier evt.vad.stop, qui déclenche le fast_wake_check STT)
  // jusqu'au 1er son de la salutation → inclut le STT (~700 ms) + routeur + synthèse, comparable au juge (759 ms).
  earsIpc.on("evt.vad.stop", () => { lastVadStopT = now(); });
  earsIpc.on("evt.vad.start", () => { lastVadStartT = now(); });   // V8 : repère « ta parole a commencé » (→ barge-in)
  earsIpc.on("evt.wake", () => { pending = { type: "reveil", t0: lastVadStopT ?? now(), sub: 0 }; });
  earsIpc.on("evt.stt.final", (e) => { if (typeof e.payload?.text === "string") lastFinalText = e.payload.text; });
  if (diagEndpoint) earsIpc.on("evt.turn.eval", (e) => {
    const p = e.payload || {};
    curEvals.push({ prob: p.prob, parle: p.parle, plaf: p.plaf, reason: p.reason });
  });
  earsIpc.on("evt.turn.end", (env) => {
    // attente (endpointing V5) : fin de ta parole (dernier vad.stop) → sa décision que tu as fini. La réponse (→ son) part de là.
    const attente = lastVadStopT != null ? now() - lastVadStopT : null;
    if (diagEndpoint) { endpointTurns.push({ evals: curEvals, endProb: typeof env.payload?.prob === "number" ? env.payload.prob : null }); curEvals = []; }
    pending = { type: matchClosing(lastFinalText) ? "clôture" : "reponse", t0: now(), sub: 0, attente };
  });
  mouthIpc.on("evt.tts.start", (e) => {
    if (!pending) return;                       // son sans trigger (2e phrase d'une même énonciation, ou 2e son) → ignoré
    // 1er son après le trigger = ce que TU entends. Un masqueur (« Donne-moi une petite minute », si le cerveau tarde
    // > 3 s) est une énonciation SÉPARÉE jouée AVANT la vraie réponse → ce 1er son est alors le masqueur ; on le signale.
    const id = Number(e.payload?.id);
    const lat = now() - pending.t0;
    const filler = pending.type === "reponse" && lat >= 2800; // heuristique masqueur (FILLER_AFTER 3 s)
    record(pending.type, lat, filler, pending.attente);
    const wasClosing = pending.type === "clôture";
    pending = null;                             // un seul enregistrement par trigger (les sons suivants sont ignorés)
    if (wasClosing) {
      // NE PAS la couper : on attend qu'elle FINISSE de dire « Avec grand plaisir » (evt.tts.done de CETTE énonciation)
      // avant de clore le temps. Filet 8 s si le done n'arrive jamais (moteur mort).
      if (Number.isFinite(id)) {
        closingId = id;
        closingTimer = setTimeout(() => { if (closingId !== null) { closingId = null; endPass(); } }, 8000);
      } else {
        endPass(); // pas d'id exploitable → repli sur l'ancien comportement
      }
    }
  });
  mouthIpc.on("evt.tts.done", (e) => {
    if (closingId === null) return;
    if (Number(e.payload?.id) === closingId) { if (closingTimer) clearTimeout(closingTimer); closingId = null; endPass(); }
  });

  // attendre que les DEUX soient CHAUDS (oreilles: stt.warm ; bouche: tts.engine_ok) avant de dire « parle ».
  process.stdout.write("juge : préchauffage");
  const t0warm = now();
  while (!done) {
    const [e, m] = await Promise.all([ready(earsSup.port, ["audio", "stt", "warm"]), ready(mouthSup.port, ["audio", "tts", "engine_ok"])]);
    if (e && m) break;
    if (now() - t0warm > 90000) throw new Error("préchauffage > 90 s (modèles non chargés ?)");
    process.stdout.write("."); await new Promise((r) => setTimeout(r, 500));
  }
  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("  🎤  PARLE MAINTENANT (2 bips aigus).");
  console.log("      « Bonjour Sophia » → discute → « Merci Sophia, à plus tard ».");
  console.log(passesTarget > 0
    ? `      Le juge s'arrêtera tout seul après ${passesTarget} temps (clôtures).`
    : "      Fais autant de temps que tu veux ; Ctrl-C pour finir (résumé imprimé).");
  console.log(`      BARGE-IN (V8) : parle PAR-DESSUS sa réponse → elle s'arrête net${bargein ? " (1 bip aigu = coupe détectée)" : ""}.`);
  console.log("════════════════════════════════════════════════════════════\n");
  BIP_GO();
}

function endPass() {
  BIP_PASS();
  console.log(`  ── temps ${passIdx} terminé ──\n`);
  if (passesTarget > 0 && passIdx >= passesTarget) { void finalize(); return; }
  passIdx += 1;
  passes.push([]);
}

// ── résumé + nettoyage ─────────────────────────────────────────────────────────
function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }

let finalizing = false;
async function finalize() {
  if (finalizing) return; finalizing = true; done = true;
  // Apparier les TTFT (dans l'ordre) aux tours 'reponse' (dans l'ordre) — tours sérialisés → 1:1.
  const reponsesFlat = passes.flat().filter((t) => t.type === "reponse");
  reponsesFlat.forEach((r, i) => { r.ttftMs = i < ttftQueue.length ? ttftQueue[i] : null; });

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  RÉSUMÉ — le juge à ta voix (latences, ms)                ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  passes.forEach((turns, i) => {
    if (!turns.length) return;
    const reveils = turns.filter((t) => t.type === "reveil").map((t) => t.latMs);
    const reponses = turns.filter((t) => t.type === "reponse");
    const rSon = reponses.map((t) => t.latMs);
    const rTtft = reponses.map((t) => t.ttftMs).filter((x) => typeof x === "number");
    console.log(`\n  TEMPS ${i + 1} (${turns.length} tours) :`);
    for (const t of turns) {
      const att = t.attenteMs != null ? `  endpointing ${String(t.attenteMs).padStart(4)}` : "";
      const ttft = typeof t.ttftMs === "number" ? `  TTFT ${String(t.ttftMs).padStart(5)}` : "";
      console.log(`    ${t.type.padEnd(8)}  → son ${String(t.latMs).padStart(5)} ms${ttft}${att}${t.filler ? "  (masqueur)" : ""}`);
    }
    if (reveils.length) console.log(`    → réveil médian     : ${median(reveils)} ms   (banc ${REF.reveilLo}-${REF.reveilHi} · juge ${REF.reveilJuge})`);
    if (rSon.length) console.log(`    → réponse→son médian: ${median(rSon)} ms`);
    if (rTtft.length) console.log(`    → cerveau TTFT médian: ${median(rTtft)} ms   (banc ${REF.ttftBanc} · juge ${REF.ttftJuge})`);
  });
  // Verdict global (les temps ensemble : le retour après pause reste-t-il chaud ?)
  const all = passes.flat();
  const reveilsAll = all.filter((t) => t.type === "reveil").map((t) => t.latMs);
  const ttftAll = all.filter((t) => t.type === "reponse" && typeof t.ttftMs === "number").map((t) => t.ttftMs);
  console.log("\n  ── VERDICT (vs banc/juge) ──");
  if (reveilsAll.length) {
    const rm = median(reveilsAll);
    console.log(`  réveil médian global : ${rm} ms → ${rm <= REF.reveilHi ? "✓ PAS de régression (≤ fourchette banc)" : "⚠ AU-DESSUS de la fourchette banc"}`);
  }
  if (ttftAll.length) {
    const tm = median(ttftAll);
    console.log(`  cerveau TTFT médian  : ${tm} ms → ${tm <= REF.ttftJuge + 250 ? "✓ dans la plage juge/banc" : "⚠ au-dessus du juge"}`);
  }
  // ── ENDPOINTING (--endpointing) : score Smart Turn de chaque pause vs. tes vraies fins ──
  // Best-effort (croisé conv 48) : la classification est FIABLE en session propre (pas d'overlap, jitter=0). Cas-limites
  // RARES et dans le sens SÛR (jamais de fausse alarme near-cut) : un tour ABANDONNÉ (tu parles par-dessus sa voix → pas
  // d'evt.turn.end) reverse ses evals au tour suivant (étiquette de numéro décalée, compte agrégé juste) ; un OVERRUN
  // mid-tour (que V5 pousse à ~0) peut mettre endProb=null et sous-compter le dernier eval. Au pire on CACHE un near-cut,
  // jamais on n'en invente un — acceptable pour un diagnostic de calibration.
  if (diagEndpoint && endpointTurns.length) {
    const TURN_THR = 0.5; // seuil banc (turn.py TURN_THR)
    console.log("\n  ── ENDPOINTING (Smart Turn, seuil 0,5 ; « laisse-moi parler avec mes pauses ») ──");
    const pauses = []; // score des silences où tu as REPRIS la parole (tous les evals SAUF le dernier = celui qui a finalisé)
    const ends = [];   // score qui a effectivement FINALISÉ le tour
    endpointTurns.forEach((t, i) => {
      const ev = t.evals || [];
      const seq = ev.map((e) => (typeof e.prob === "number" ? e.prob.toFixed(2) : " — ")).join(" ");
      console.log(`    tour ${String(i + 1).padStart(2)} : [${seq}]  → fin ${typeof t.endProb === "number" ? t.endProb.toFixed(2) : "?"}`);
      ev.slice(0, -1).forEach((e) => { if (typeof e.prob === "number") pauses.push(e.prob); });
      if (typeof t.endProb === "number") ends.push(t.endProb);
    });
    const nearCuts = pauses.filter((p) => p > TURN_THR);      // pause qui a scoré « fini » alors que tu continuais = FRÔLÉ la coupe
    const maxPause = pauses.length ? Math.max(...pauses) : null;
    console.log(`    pauses (silences où tu as REPRIS) : n=${pauses.length}  max=${maxPause != null ? maxPause.toFixed(2) : "—"}  near-cuts (>0,5) = ${nearCuts.length}`);
    console.log(`    vraies fins (score finalisant)    : ${ends.length ? ends.map((e) => e.toFixed(2)).join(", ") : "—"}`);
    console.log(`    → ${nearCuts.length === 0
      ? "✓ aucune pause n'a frôlé la coupe — MARGE saine (seuil 0,5 loin des pauses)"
      : `⚠ ${nearCuts.length} pause(s) ont scoré > 0,5 (frôlé la coupe) — la calibration mordrait ici`}`);
    console.log("    (si tu m'as dit « elle m'a coupé », le tour concerné a une pause à score élevé ci-dessus)");
  }
  if (bargein) {
    console.log("\n  ── BARGE-IN (V8, « coupe-la en parlant par-dessus ») ──");
    console.log(bargeins.length
      ? `    ${bargeins.length} coupure(s) ; latence médiane (ta parole → coupure) : ${median(bargeins)} ms (dominée par l'accumulation V6 ~0,75 s)`
      : "    aucune coupure enregistrée — parle PAR-DESSUS sa réponse (pas dans un silence) pour l'armer.");
  }
  console.log("");
  BIP_DONE();
  await new Promise((r) => setTimeout(r, 900)); // laisser le bip finir
  await cleanup();
  process.exit(0);
}

async function cleanup() {
  try { router?.stop(); } catch { /* */ }
  try { earsIpc?.close(); } catch { /* */ }
  try { mouthIpc?.close(); } catch { /* */ }
  try { brain?.close(); } catch { /* */ }
  try { earsSup.beginShutdown(); mouthSup.beginShutdown(); } catch { /* */ }
  try { await Promise.all([earsSup.terminate(1500), mouthSup.terminate(1500)]); } catch { /* */ }
}

process.on("SIGINT", () => { console.log("\n(Ctrl-C) — résumé :"); void finalize(); });

main().catch(async (e) => {
  console.error("juge : échec —", e.message);
  await cleanup();
  process.exit(1);
});
