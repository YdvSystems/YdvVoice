// LE JUGE À TA VOIX — outil PERMANENT de mesure (conv 48, consolidé conv 51). Lance : `npm run juge` (2 temps puis stop —
// suffit pour tester ; `-- --passes N` pour en faire plus, `-- --passes 0` pour l'infini/Ctrl-C). UN SEUL juge, complété
// à chaque ajout — plus jamais un flag à retenir ni deux commandes concurrentes.
//
// À QUOI ÇA SERT : entendre Sophia EN VRAI et chronométrer CHAQUE latence — du « bonjour » à la clôture — pour PROUVER
// qu'on ne régresse jamais (⛔ règle perf conv 44) et voir, sur un HISTORIQUE, ce qu'il faut travailler. Yohann parle au
// micro ; le juge mesure TOUT, à chaque run, et sauve la session (aucun flag à retenir).
//
// ARCHITECTURE (conv 51 — « quelque chose de solide, complet à chaque fois, pas à réécrire ») :
//   · scripts/lib/metrics.mjs = le CŒUR de mesure (PUR, testé par tests/u-metrics.mjs) : accumule, calcule les médianes
//     vs. le banc, formate le résumé, produit la ligne d'historique. RÉUTILISABLE plus tard pour mesurer l'APPLI.
//   · CE fichier = le LANCEUR : nettoie les fantômes, démarre les 2 process (le VRAI code migré conv 48), branche les
//     evt.* / le cerveau sur le cœur, imprime, sauve, nettoie. Il ne mesure pas lui-même — il OBSERVE et transmet.
//
// CE QU'IL EXERCE : le VRAI code migré — DEUX `Supervisor` (rôles ears/mouth, audio ON, V6 allumé = fidèle au produit),
// DEUX `IpcClient`, le `ConversationRouter` à 2 canaux, le `WarmBrain` (cerveau chaud, OAuth Max). Le juge OBSERVE
// l'horloge (des écoutes evt.* en plus, sans commander) + wrappe le cerveau pour lire son TTFT.
//
// CE QUI EST MESURÉ (COMPLET, à CHAQUE run — plus de --endpointing/--bargein, tout est allumé) :
//   · réveil   : fin de ta parole (evt.vad.stop) → 1er son de la salutation.
//   · reponse  : evt.turn.end → 1er son de sa réponse (ce que TU entends) + TTFT cerveau (turn.end → 1er token).
//   · clôture  : evt.turn.end → 1er son de « Avec grand plaisir ».
//   · masqueur : joué ? et à quel délai réel après ta fin de tour (cible 3 s) — répond au « ça se manifeste trop tard ».
//   · endpointing : score Smart Turn de chaque pause vs. tes vraies fins (near-cuts).
//   · barge-in : latence de coupe + score V6 déclencheur.
//   · speaker  : reconnaissance V6 (yohann vs inconnu, scores).
//   · hygiène  : nb de process au départ/à la fin → détecte une fuite (le mal de conv 51).
//   · transcript : chaque tour, corrélé à sa latence.
// → tout est SAUVÉ dans `.sophia-home-dev/juge-stats-history.jsonl` (une ligne/session) : tu me le donnes quand tu veux.
//
// SYNCHRO SANS ÉCRAN (Yohann ne voit pas ce terminal) : BIPS. 2 aigus = « PARLE ». 1 médium = un temps enregistré.
// 1 aigu bref = barge-in détecté (elle coupe). 3 graves = FINI (résumé imprimé). Ctrl-C = arrêt propre (résumé quand même).
//
// DÉROULÉ D'UN « TEMPS » : « Bonjour Sophia » → 2-3 échanges → « Merci Sophia, à plus tard » (clôture). Pause. Recommence
// pour le temps 2 (on vérifie que le retour après pause reste CHAUD). Défaut : 2 temps puis stop ; `--passes N` en change
// le nombre (`--passes 0` = infini, Ctrl-C pour finir).
//
// Repli propre : voix A20 absente → SKIP (comme les E2E). Nettoyage garanti (SIGINT/SIGTERM + fin + filet `exit`).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import { StatsCollector } from "./lib/metrics.mjs";

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
const passesTarget = (() => { const i = argv.indexOf("--passes"); return i >= 0 ? parseInt(argv[i + 1], 10) : 2; })(); // défaut 2 temps (suffit pour tester) ; `--passes N` change, `--passes 0` = infini/Ctrl-C
const verbose = argv.includes("--verbose");

const MODEL = path.join(root, "resources", "models", "voice", "fr_FR-a20-e400.onnx");
if (!fs.existsSync(MODEL)) {
  console.log(`SKIP  juge : voix A20 ${path.relative(root, MODEL)} absente (vendorisée, CF2 gitignore) — rien à juger.`);
  process.exit(0);
}

// Maison jetable dédiée au juge (audit du WarmBrain, pidfiles) — n'écrase pas la vraie base. Le PARENT `.sophia-home-dev`
// n'est PAS effacé → `juge-stats-history.jsonl` survit et s'accumule.
const home = path.join(root, ".sophia-home-dev", "juge");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
const paths = resolvePaths(home);
const HIST = path.join(root, ".sophia-home-dev", "juge-stats-history.jsonl");

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

// ── GARDE ANTI-FANTÔME (conv 51) — le fix RACINE du problème récurrent ──────────
// Un juge arrêté BRUTALEMENT (TaskStop / kill non propagé au node) laisse le node VIVANT → son superviseur RESPAWN
// les sidecars ; et le `claude` du WarmBrain n'est PAS dans le Job Object des sidecars → il devient ORPHELIN et
// S'ACCUMULE (mesuré conv 51 : WarmBrain fantômes → contention GPU/CPU → voix qui bégaie, barge trop lent). À CHAQUE
// démarrage, TABLE RASE, de façon SÛRE :
//   · autres node juge (`scripts/juge.mjs`) — JAMAIS soi ni son parent ;
//   · WarmBrain fantômes — signature `VOICE_SYSPROMPT` (« assistant vocal francophone ») : SPÉCIFIQUE au cerveau de
//     Sophia, JAMAIS Claude Code (moi) ni une autre session claude (dont la ligne de commande ne contient pas ça) ;
//   · sidecars YdvVoice (`server.py`).
async function killPhantoms() {
  const self = process.pid, parent = process.ppid;
  const cmd = [
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*scripts/juge.mjs*' -and $_.ProcessId -ne ${self} -and $_.ProcessId -ne ${parent} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    "Start-Sleep -Milliseconds 300",
    `Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*assistant vocal francophone*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*YdvVoice*server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join("; ");
  await new Promise((resolve) => {
    try {
      const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { stdio: "ignore", windowsHide: true });
      ps.on("close", () => resolve());
      ps.on("error", () => resolve());
    } catch { resolve(); }
  });
}

// ── HYGIÈNE PROCESS (conv 51) — compte juge / WarmBrain / sidecars EN UN appel (contention = le mal de conv 51).
// UN SEUL shot au démarrage + un à la fin (JAMAIS en boucle pendant la mesure → n'ajoute aucun bruit de latence).
async function countProcs() {
  const cmd = [
    `$j=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*scripts/juge.mjs*' }).Count`,
    `$w=@(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*assistant vocal francophone*' }).Count`,
    `$s=@(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*YdvVoice*server.py*' }).Count`,
    `Write-Output "$j $w $s"`,
  ].join("; ");
  return await new Promise((resolve) => {
    try {
      let buf = "";
      const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true });
      ps.stdout.on("data", (d) => { buf += d.toString(); });
      ps.on("close", () => {
        const m = buf.trim().match(/(\d+)\s+(\d+)\s+(\d+)/);
        resolve(m ? { juge: +m[1], warm: +m[2], sidecars: +m[3] } : null);
      });
      ps.on("error", () => resolve(null));
    } catch { resolve(null); }
  });
}

// ── superviseurs (rôles, audio ON) — le VRAI câblage migré ──────────────────────
const mkSup = (role) => new Supervisor({
  python: path.join(root, ".venv-sidecar", "Scripts", "python.exe"),
  script: "sidecar/server.py",
  cwd: root,
  pidfile: path.join(home, `sidecar-${role}.pid`),
  extraEnv: (() => {
    const env = { SIDECAR_ROLE: role, SIDECAR_AUDIO: "1" };
    // V6 (speaker-ID → barge-in V8) TOUJOURS allumé sur les oreilles = FIDÈLE AU PRODUIT (runtime.ts pose SOPHIA_SPEAKER=1
    // en prod). Le réveil/TTFT mesurés INCLUENT le coût CPU de V6 (le vrai chiffre produit). SOPHIA_TURN_DIAG TOUJOURS
    // allumé aussi (conv 51 : l'endpointing fait partie de « tout mesurer » ; c'est un diagnostic, off en PROD seulement).
    if (role === "ears") { env.SOPHIA_SPEAKER = "1"; env.SOPHIA_TURN_DIAG = "1"; }
    return env;
  })(),
  onLog: (l) => { if (verbose) console.log(`[${role}] ${l}`); },
});
const earsSup = mkSup("ears");
const mouthSup = mkSup("mouth");

// ── mesures (le LANCEUR observe → transmet au CŒUR) ─────────────────────────────
const stats = new StatsCollector();
let passIdx = 1;                 // temps en cours (1-based) — pour l'affichage
let pending = null;              // {type, t0, attente, transcript, masqueurAt} en attente d'un 1er son
let lastFinalText = "";          // dernier transcript (pour matchClosing → détecter la clôture)
let lastVadStopT = null;         // fin de la dernière parole (evt.vad.stop) → repère « silence→son »
let lastVadStartT = null;        // début de la dernière parole (evt.vad.start) → repère du barge-in (parole→coupure)
let lastYohannScore = null;      // dernier score evt.speaker locuteur=yohann → score qui déclenche le barge
const ttftQueue = [];            // TTFT (ms) de chaque ask() cerveau, DANS L'ORDRE (tours sérialisés → appariables 1:1)
let curEvals = [];               // évaluations Smart Turn du tour EN COURS (vidé à chaque fin de tour)
let done = false;
let closingId = null;            // id de l'énonciation de clôture — on attend SA fin avant de clore
let closingTimer = null;         // filet : si son evt.tts.done n'arrive jamais (moteur mort)

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
  await killPhantoms();   // conv 51 : TABLE RASE des juge/WarmBrain/sidecars fantômes AVANT tout (sinon contention)
  console.log("juge : démarrage des 2 process (oreilles + bouche)… (chargement des modèles ~10-15 s)");
  await Promise.all([earsSup.start(), mouthSup.start()]);
  if (earsSup.currentState !== "READY" || mouthSup.currentState !== "READY") {
    throw new Error(`sidecar non prêt (ears=${earsSup.currentState}, mouth=${mouthSup.currentState})`);
  }

  earsIpc = new IpcClient(); await earsIpc.connect(earsSup.port);
  mouthIpc = new IpcClient(); await mouthIpc.connect(mouthSup.port);

  // le VRAI cerveau chaud (OAuth Max), wrappé pour LIRE son TTFT (turn.end → 1er token) sans le déranger. Le prewarm
  // passe par brain.prewarm (→ brain.ask INTERNE), PAS par ce wrapper → la file ne contient QUE les vrais tours.
  brain = new WarmBrain({ paths, onLog: (l) => { if (verbose) console.log(`[warm] ${l}`); } });
  const timedBrain = {
    prewarm: () => brain.prewarm?.(),
    ask: (text, opts = {}) => brain.ask(text, opts).then((res) => { ttftQueue.push(typeof res.ttftMs === "number" ? res.ttftMs : null); return res; }),
  };

  router = new ConversationRouter({ earsIpc, mouthIpc, brain: timedBrain, onLog: (l) => {
    if (verbose) console.log(`[rt] ${l}`);
    // Le routeur ENCODE ses actes dans ses logs (pas d'event dédié — on n'ajoute rien à la prod). On y lit le barge et
    // le masqueur (chaînes stables, routeur V9 verrouillé). Fragile par nature (log-matching) → tracé : si le routeur
    // change ces phrases, mettre à jour ici (un seul endroit).
    if (l.includes("barge-in")) {                            // V8 : le routeur a coupé (Yohann par-dessus sa réponse)
      const lat = lastVadStartT != null ? now() - lastVadStartT : null;
      stats.recordBarge({ latMs: lat, score: lastYohannScore });
      console.log(`  ✂ BARGE-IN — tu l'as coupée${lat != null ? ` (~${Math.round(lat)} ms depuis ta parole)` : ""}${lastYohannScore != null ? `, score V6 ${lastYohannScore.toFixed(2)}` : ""}`);
      BIP_BARGE();
    } else if (l.includes("masqueur joué")) {                // le masqueur vient d'être DÉCLENCHÉ (avant son 1er son)
      if (pending && pending.type === "reponse" && pending.masqueurAt == null) pending.masqueurAt = now();
    }
  } });
  router.start();

  // écoutes de mesure (en PLUS de celles du routeur — evt.* diffusés à tous les abonnés, aucune interférence).
  earsIpc.on("evt.vad.stop", () => { lastVadStopT = now(); });
  earsIpc.on("evt.vad.start", () => { lastVadStartT = now(); });   // V8 : « ta parole a commencé » (→ barge-in)
  earsIpc.on("evt.wake", () => { pending = { type: "reveil", t0: lastVadStopT ?? now(), masqueurAt: null }; });
  earsIpc.on("evt.stt.final", (e) => { if (typeof e.payload?.text === "string") lastFinalText = e.payload.text; });
  earsIpc.on("evt.speaker", (e) => {                              // V6 : « qui parle ? » — toujours enregistré
    const loc = e.payload?.locuteur, score = typeof e.payload?.score === "number" ? e.payload.score : null;
    stats.recordSpeaker({ locuteur: loc, score });
    if (loc === "yohann" && score != null) lastYohannScore = score;  // → score déclencheur du prochain barge
  });
  earsIpc.on("evt.turn.eval", (e) => {                            // endpointing (SOPHIA_TURN_DIAG toujours ON)
    const p = e.payload || {};
    curEvals.push({ prob: p.prob, parle: p.parle, plaf: p.plaf, reason: p.reason });
  });
  earsIpc.on("evt.turn.end", (env) => {
    // attente (endpointing V5) : fin de ta parole (dernier vad.stop) → sa décision que tu as fini. La réponse (→ son) part de là.
    const attente = lastVadStopT != null ? now() - lastVadStopT : null;
    stats.recordEndpointTurn({ evals: curEvals, endProb: typeof env.payload?.prob === "number" ? env.payload.prob : null });
    curEvals = [];
    pending = { type: matchClosing(lastFinalText) ? "clôture" : "reponse", t0: now(), attente, transcript: lastFinalText, masqueurAt: null };
    console.log(`  📝 « ${lastFinalText} »`);   // transcript du tour → corréler CE QUE tu dis avec la latence
  });
  mouthIpc.on("evt.tts.start", (e) => {
    if (!pending) return;                       // son sans trigger (2e phrase d'une même énonciation, ou 2e son) → ignoré
    // 1er son après le trigger = ce que TU entends. Un masqueur joué AVANT (pending.masqueurAt posé via le log routeur)
    // → ce 1er son est le masqueur ; on le signale + on mesure son délai RÉEL depuis ta fin de tour (répond au « trop tard »).
    const id = Number(e.payload?.id);
    const lat = now() - pending.t0;
    const filler = pending.type === "reponse" && pending.masqueurAt != null;
    const fillerDelayMs = filler ? pending.masqueurAt - pending.t0 : null;
    const rec = stats.record({ type: pending.type, sonMs: lat, endpointingMs: pending.attente, filler, fillerDelayMs, transcript: pending.transcript });
    console.log(stats.formatTurnLine(rec, passIdx));
    const wasClosing = pending.type === "clôture";
    pending = null;                             // un seul enregistrement par trigger (les sons suivants sont ignorés)
    if (wasClosing) {
      // NE PAS la couper : attendre qu'elle FINISSE « Avec grand plaisir » (evt.tts.done de CETTE énonciation). Filet 8 s.
      if (Number.isFinite(id)) {
        closingId = id;
        closingTimer = setTimeout(() => { if (closingId !== null) { closingId = null; endPass(); } }, 8000);
      } else {
        endPass();
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
  stats.setHygiene("start", await countProcs());   // baseline après nettoyage (avant que tu parles → pas de bruit)
  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("  🎤  PARLE MAINTENANT (2 bips aigus).");
  console.log("      « Bonjour Sophia » → discute → « Merci Sophia, à plus tard ».");
  console.log(passesTarget > 0
    ? `      Le juge s'arrêtera tout seul après ${passesTarget} temps (clôtures).`
    : "      Fais autant de temps que tu veux ; Ctrl-C pour finir (résumé imprimé).");
  console.log("      BARGE-IN (V8) : parle PAR-DESSUS sa réponse → elle s'arrête net (1 bip aigu = coupe détectée).");
  console.log("════════════════════════════════════════════════════════════\n");
  BIP_GO();
}

function endPass() {
  BIP_PASS();
  console.log(`  ── temps ${passIdx} terminé ──\n`);
  if (passesTarget > 0 && passIdx >= passesTarget) { void finalize(); return; }
  passIdx += 1;
  stats.startPass();
}

// ── résumé + historique + nettoyage ─────────────────────────────────────────────
let finalizing = false;
async function finalize() {
  if (finalizing) return; finalizing = true; done = true;
  stats.finalizeTtft(ttftQueue);
  stats.setHygiene("end", await countProcs());   // fuite de CE run ? (avant le nettoyage)

  console.log("");
  for (const line of stats.summaryLines()) console.log(line);

  // HISTORIQUE PERSISTANT (idée Yohann) : une ligne JSON par session (le parent `.sophia-home-dev` n'est pas effacé →
  // ce fichier SURVIT et s'accumule). Yohann le donne à Claude quand il veut → améliorer sur de VRAIS chiffres.
  try {
    fs.appendFileSync(HIST, JSON.stringify(stats.historyRecord(new Date().toISOString())) + "\n");
    console.log(`\n  📄 session sauvegardée → ${path.relative(root, HIST)}  (donne-moi ce fichier quand tu veux)`);
  } catch { /* la sauvegarde n'est jamais fatale */ }
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
process.on("SIGTERM", () => { void finalize(); });   // arrêt propre AUSSI sur SIGTERM (pas que Ctrl-C)
// FILET SYNCHRONE au tout dernier instant : sur une sortie où `finalize`/`cleanup` n'ont pas tourné, on tue quand même
// le WarmBrain (claude) + les 2 sidecars par leur PID. N'attrape PAS un SIGKILL brutal (impossible) — mais le
// `killPhantoms` du PROCHAIN démarrage le rattrape → jamais d'accumulation. Best-effort (déjà mort = OK).
process.on("exit", () => {
  try { brain?.close(); } catch { /* */ }
  for (const s of [earsSup, mouthSup]) { try { if (s?.pid) process.kill(s.pid, "SIGKILL"); } catch { /* déjà mort */ } }
});

main().catch(async (e) => {
  console.error("juge : échec —", e.message);
  await cleanup();
  process.exit(1);
});
