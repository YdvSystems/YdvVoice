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
import * as net from "node:net";
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
const { DuckingPolicy } = req("dist/src/orchestrator/voice/ducking.js");   // V12 — fidèle au produit (le juge duck aussi)
const { WindowsMixer } = req("dist/src/orchestrator/voice/duck-mixer.js");
const { FALLBACK_PHRASES } = req("dist/src/orchestrator/voice/fallback-phrases.js");  // V13 — fidèle au produit (le filet aussi)

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
const CONV = path.join(root, ".sophia-home-dev", "conversations.jsonl");   // archive des échanges (les 2 voix), conv 53

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

// ── CENSUS + NETTOYAGE CONVERGENT (conv 52) — le fix RACINE des fantômes ─────────
// Un juge arrêté BRUTALEMENT (TaskStop / kill non propagé) laisse ses sidecars ORPHELINS (le juge, script node NU,
// n'a pas de Job Object comme l'app Electron). Et un python qui tient CUDA + micro WASAPI voit son TerminateProcess
// DIFFÉRÉ par le driver (~15 s avant de vraiment mourir) → tuer UNE fois puis démarrer ne suffit pas (le vieux
// agonise encore → sidecars=4). Le fix : boucle CONVERGENTE (census → kill → délai) jusqu'à 0 fantôme, budget
// généreux. + refus si l'APP tourne (ne pas tuer ses sidecars en douce). Le token sidecar est DÉRIVÉ du dossier du
// repo (basename) → survit à un renommage. Outillage pur : ne touche ni le produit ni sa conception.
const SELF = process.pid, PARENT = process.ppid;
const REPO_TOKEN = path.basename(root); // ex. « YdvVoice »
const APP_PIPE = (() => { try { return resolvePaths().instancePipe; } catch { return null; } })(); // pipe d'instance unique dev/prod

// 1 appel PowerShell → les PID par CLASSE (snapshot pur, aucune politique ici). Null si PowerShell absent.
async function census() {
  const cmd = [
    `function P($n,$l){@(Get-CimInstance Win32_Process -Filter "Name='$n'" | Where-Object { $_.CommandLine -like $l } | ForEach-Object { $_.ProcessId })}`,
    `$j=@(P 'node.exe' '*scripts?juge.mjs*')`,                          // juges (self inclus — exclu au KILL, pas au comptage ; `?` accepte / ET \ — M-2 conv 56, MIROIR de phantoms.ts)
    `$w=@(P 'claude.exe' '*assistant vocal francophone*')`,             // WarmBrain (signature persona — jamais Claude Code)
    `$s=@(P 'python.exe' '*${REPO_TOKEN}*server.py*')`,                 // sidecars YdvVoice
    `$e=@(P 'electron.exe' '*${REPO_TOKEN}*')`,                        // app Electron DE SOPHIA (token repo → pas un autre app Electron)
    `$n=@(P 'node.exe' '*dev-electron*')`,                              // lanceur dev de l'app
    `Write-Output ("J " + ($j -join ' '))`, `Write-Output ("W " + ($w -join ' '))`,
    `Write-Output ("S " + ($s -join ' '))`, `Write-Output ("E " + ($e -join ' '))`, `Write-Output ("N " + ($n -join ' '))`,
  ].join("; ");
  return await new Promise((resolve) => {
    try {
      let buf = "";
      const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true });
      ps.stdout.on("data", (d) => { buf += d.toString(); });
      ps.on("close", () => {
        const pick = (tag) => {
          const line = buf.split(/\r?\n/).find((l) => l.startsWith(tag + " "));
          return line ? line.slice(2).trim().split(/\s+/).map((x) => parseInt(x, 10)).filter(Number.isFinite) : [];
        };
        resolve({ juge: pick("J"), warm: pick("W"), sidecars: pick("S"), appElectron: pick("E"), appNode: pick("N") });
      });
      ps.on("error", () => resolve(null));
    } catch { resolve(null); }
  });
}

// les PID à TUER (fantômes) : juges SAUF soi/parent · WarmBrain · sidecars. (L'app n'est jamais tuée — on refuse avant.)
const phantomsOf = (c) => [...c.juge.filter((p) => p !== SELF && p !== PARENT), ...c.warm, ...c.sidecars];

async function killPids(pids) {
  if (!pids || !pids.length) return;
  await new Promise((resolve) => {
    try {
      const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`], { stdio: "ignore", windowsHide: true });
      ps.on("close", () => resolve());
      ps.on("error", () => resolve());
    } catch { resolve(); }
  });
}

// L'app (npm run dev / electron) tourne-t-elle ? recensement (robuste) + confirmation par le pipe d'instance unique.
async function appIsRunning(c) {
  if (c && (c.appElectron.length || c.appNode.length)) return true;
  if (!APP_PIPE) return false;
  return await new Promise((resolve) => {
    try {
      const sock = net.createConnection(APP_PIPE);
      const t = setTimeout(() => { sock.destroy(); resolve(false); }, 400);
      sock.on("connect", () => { clearTimeout(t); sock.destroy(); resolve(true); });   // pipe tenu = app vivante
      sock.on("error", () => { clearTimeout(t); resolve(false); });                    // pipe libre = pas d'app
    } catch { resolve(false); }
  });
}

// TABLE RASE convergente AVANT de démarrer les 2 sidecars du juge. Refuse si l'app tourne ; boucle jusqu'à 0 fantôme.
async function ensureCleanBaseline() {
  const first = await census();
  if (await appIsRunning(first)) {
    console.error("\njuge : l'APPLI (npm run dev / electron) tourne — FERME-LA avant de lancer le juge.\n" +
      "       (le juge et l'app se battent pour le GPU ; le juge tuerait les sidecars de l'app.)");
    process.exit(2);
  }
  const TRIES = 24, DELAY = 750; // ~18 s de budget — couvre la mort différée d'un python CUDA/WASAPI
  for (let i = 0; i < TRIES; i++) {
    const c = await census();
    if (!c) return; // PowerShell indisponible → on ne bloque pas le juge (best-effort, comme avant)
    const ph = phantomsOf(c);
    if (ph.length === 0) return; // propre → on peut démarrer
    if (i === 0) console.log(`juge : ${ph.length} fantôme(s) détecté(s) → nettoyage convergent (mort CUDA différée)…`);
    await killPids(ph);
    await new Promise((r) => setTimeout(r, DELAY));
  }
  const c = await census();
  const surv = c ? phantomsOf(c) : [];
  if (surv.length) {
    console.error(`\njuge : impossible de nettoyer après ${TRIES} passes — ${surv.length} survivant(s) PID ${surv.join(", ")}.\n` +
      "       (process CUDA à mort différée ? attends ~20 s, ou tue-les à la main, puis relance.)");
    process.exit(3);
  }
}

// ── CORRÉLATION AU CODE (conv 58, demande Yohann) — « il y avait de la latence quand on a implémenté ça,
// est-ce que ça a un lien ? » : chaque ligne d'historique porte le COMMIT qui tournait (+ sujet + nb de fichiers
// modifiés non committés = un WIP). Pas pour incriminer — pour pouvoir chercher PLEINEMENT, avec tous les détails.
async function gitInfo() {
  const run = (args) => new Promise((resolve) => {
    try {
      let buf = "";
      const p = spawn("git", args, { cwd: root, windowsHide: true });
      p.stdout.on("data", (d) => { buf += d.toString(); });
      p.on("close", (c) => resolve(c === 0 ? buf.trim() : null));
      p.on("error", () => resolve(null));
    } catch { resolve(null); }
  });
  const commit = await run(["rev-parse", "--short", "HEAD"]);
  const subject = await run(["log", "-1", "--format=%s"]);
  const porcelain = await run(["status", "--porcelain"]);
  return {
    commit,                                                     // le code committé qui tournait
    subject: subject ? subject.slice(0, 90) : null,             // son titre (lisible sans git)
    dirtyFiles: porcelain == null ? null : porcelain.split(/\r?\n/).filter(Boolean).length, // >0 = un WIP tournait PAR-DESSUS
  };
}

// ── HYGIÈNE PROCESS — dérivée du census (nombre par classe). UN shot au démarrage + un à la fin (jamais en boucle
// pendant la mesure de latence). juge inclut soi (=1 attendu) ; sidecars=2 attendu (les 2 rôles du juge).
async function countProcs() {
  const c = await census();
  return c ? { juge: c.juge.length, warm: c.warm.length, sidecars: c.sidecars.length } : null;
}

// ── ÉCHANTILLONNAGE GPU/CPU (conv 52) — la charge réelle pendant les conversations (la contention se VOIT ici,
// au lieu de la déduire du nombre de process). 1 appel PowerShell/échantillon (nvidia-smi util+VRAM + CPU CIM),
// cadence LENTE (2,5 s) → bruit négligeable. GPU absent (pas de NVIDIA) → on garde quand même le CPU.
let gpuTimer = null;
function sampleGpuCpu() {
  const cmd = [
    `$g=(& nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits 2>$null | Select-Object -First 1)`,
    `$c=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average`,
    `Write-Output ("$g | $c")`,
  ].join("; ");
  try {
    let buf = "";
    const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true });
    ps.stdout.on("data", (d) => { buf += d.toString(); });
    ps.on("close", () => {
      const gpuM = buf.match(/(\d+)\s*,\s*(\d+)/);   // "util, vram"
      const cpuM = buf.match(/\|\s*(\d+)/);          // "| cpu"
      const s = {};
      if (gpuM) { s.gpuUtil = +gpuM[1]; s.vramMb = +gpuM[2]; }
      if (cpuM) s.cpu = +cpuM[1];
      if (s.gpuUtil != null || s.cpu != null) stats.recordGpuCpu(s);
    });
    ps.on("error", () => { /* jamais fatal */ });
  } catch { /* */ }
}
function startGpuCpuSampler() { if (!gpuTimer) { gpuTimer = setInterval(sampleGpuCpu, 2500); sampleGpuCpu(); } }
function stopGpuCpuSampler() { if (gpuTimer) { clearInterval(gpuTimer); gpuTimer = null; } }

// ── superviseurs (rôles, audio ON) — le VRAI câblage migré ──────────────────────
const mkSup = (role) => new Supervisor({
  python: path.join(root, ".venv-sidecar", "Scripts", "python.exe"),
  script: "sidecar/server.py",
  cwd: root,
  pidfile: path.join(home, `sidecar-${role}.pid`),
  // conv 52 — LA VRAIE cause de `sidecars=4` : le défaut de readiness est 8 s, mais le boot CUDA des 2 sidecars
  // DÉMARRÉS EN MÊME TEMPS (Promise.all → double charge GPU) prend ~10-15 s → le superviseur croit le boot raté à
  // 8 s → il TUE le sidecar lent (SIGKILL différé ~15 s par le driver CUDA) puis RESPAWNE → l'ancien mourant
  // traîne = 2 sidecars par rôle = 4. Ce n'étaient JAMAIS des fantômes d'un run précédent (preuve : après un
  // redémarrage PC, la 1re session montre déjà 4). 60 s = le boot finit LARGEMENT avant → pas de respawn → 2.
  readinessTimeoutMs: 60000,
  extraEnv: (() => {
    const env = { SIDECAR_ROLE: role, SIDECAR_AUDIO: "1" };
    // V6 (speaker-ID → barge-in V8) TOUJOURS allumé sur les oreilles = FIDÈLE AU PRODUIT (runtime.ts pose SOPHIA_SPEAKER=1
    // en prod). Le réveil/TTFT mesurés INCLUENT le coût CPU de V6 (le vrai chiffre produit). SOPHIA_TURN_DIAG TOUJOURS
    // allumé aussi (conv 51 : l'endpointing fait partie de « tout mesurer » ; c'est un diagnostic, off en PROD seulement).
    if (role === "ears") { env.SOPHIA_SPEAKER = "1"; env.SOPHIA_TURN_DIAG = "1"; }
    return env;
  })(),
  // surface les respawns/PRÊT même sans --verbose (conv 52) → on VOIT si le superviseur a dû respawner au boot. ET on
  // ENREGISTRE la cause dans les stats (fige/spawn-echoue/crash) → « pourquoi sidecars=4 » est dans le fichier, plus
  // besoin que Yohann lise la console (le juge doit avoir TOUTES les infos, pas lui).
  onLog: (l) => {
    if (verbose || /redemarrage|spawn-echoue|fige|PRET|orphelin/i.test(l)) console.log(`[${role}] ${l}`);
    const m = l.match(/(fige|spawn-echoue|crash)/i);
    if (m) stats.recordRespawn({ role, reason: m[1].toLowerCase() });
  },
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
let hmmSkipNext = false;         // V10 (conv 52) : le hmm est une énonciation SÉPARÉE → on ignore SON evt.tts.start pour le relevé du tour
// V14 (conv 59) — COLLECTE DE LA LIGNE DE BASE d'affect (le gravé : « calibré sur la ligne de base de Yohann,
// jamais un barème générique seul »). Le capteur est OFF par défaut ; `SOPHIA_AFFECT=1` avant `npm run juge`
// l'allume (l'env traverse le Supervisor) → chaque tour verrouillé émet {valence, energie, confiance} — collectés
// ICI (hors metrics.mjs, qui reste le cœur LATENCE pur) + résumé + champ `affect` dans l'historique. C'est LUI
// qui juge si ce qu'elle lit de lui sonne juste (les seuils = calibration §6).
const affectSamples = [];
const turnTexts = new Map();     // V14 (n8 croisé conv 59) : mark du tour → SON transcript. L'affect arrive ~1,5-3 s
//                                  après le turn.end — `lastFinalText` peut déjà être le tour SUIVANT → on attribue
//                                  par la mark que le payload evt.affect porte (borné à 32 entrées).
// V14 — MOTS CLAIRS (décision Yohann post-passe 2, option c) : le juge TRADUIT les deux chiffres en mots doux
// RELATIFS à SA ligne de base (l'historique des sessions précédentes ; défauts neutres si < 10 lectures). Les
// MOTS vivent ICI (l'outil de Yohann — palette = SON domaine, reformulable) ; l'ÉVÉNEMENT reste doux et sans
// étiquette (gravé §2.4) ; la VRAIE interprétation (dans la voix de Sophia) = plan/03.
function affectBaseline() {
  try {
    const lines = fs.readFileSync(HIST, "utf-8").split(/\r?\n/).filter(Boolean);
    const vs = [], es = [];
    for (const l of lines) {
      try { for (const a of (JSON.parse(l).affect ?? [])) { vs.push(a.valence); es.push(a.energie); } } catch { /* ligne illisible */ }
    }
    const med = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    if (vs.length >= 10) return { v: med(vs), e: med(es), n: vs.length };
  } catch { /* pas d'historique */ }
  return { v: 0.45, e: 0.45, n: 0 };   // défaut neutre (sa base observée ~0,4-0,5) tant que l'historique est maigre
}
const affectBase = affectBaseline();
function affectWords(v, en) {
  const dv = v - affectBase.v, de = en - affectBase.e;
  // décision Yohann conv 59 : mots ET émojis (« rendre le truc le plus vivant possible ») — palette = SON
  // domaine, reformulable. 1er émoji = la couleur (valence), 2e = l'intensité (énergie).
  let wv = dv > 0.15 ? ["😄", "très chaleureux"] : dv > 0.06 ? ["😊", "chaleureux"]
    : dv < -0.15 ? ["😣", "tendu"] : dv < -0.06 ? ["😕", "plus tendu que d'habitude"] : ["😌", "dans ta base"];
  const we = de > 0.15 ? ["🔥", "vif"] : de > 0.06 ? ["⚡", "animé"]
    : de < -0.15 ? ["💤", "très posé"] : de < -0.06 ? ["🍃", "posé"] : ["〰️", "tranquille"];
  // demande Yohann conv 59 (« quand on prend le bien, il faut prendre le moins bien aussi ») : la COMBINAISON
  // tension × énergie a ses vrais mots — agacé / énervé. Le capteur lisait déjà les deux sens ; ici on les NOMME.
  if (dv < -0.15 && de > 0.15) wv = ["😠", "énervé"];
  else if (dv < -0.06 && de > 0.06) wv = ["😤", "agacé"];
  return `${wv[0]}${we[0]} ${wv[1]} · ${we[1]}`;
}
let done = false;
let closingId = null;            // id de l'énonciation de clôture — on attend SA fin avant de clore
let closingTimer = null;         // filet : si son evt.tts.done n'arrive jamais (moteur mort)

// ── run ──────────────────────────────────────────────────────────────────────────
let earsIpc, mouthIpc, router, brain, ducking, duckMixer;

async function ready(port, keyPath) {
  try {
    const d = await (await fetch(`http://127.0.0.1:${port}/debug`, { signal: AbortSignal.timeout(1500) })).json();
    let v = d; for (const k of keyPath) v = v?.[k];
    return v === true;
  } catch { return false; }
}

async function main() {
  await ensureCleanBaseline();   // conv 52 : refuse si l'app tourne + boucle convergente jusqu'à 0 fantôme (mort CUDA différée)
  console.log("juge : démarrage des 2 process (oreilles + bouche)… (chargement des modèles ~10-15 s)");
  await Promise.all([earsSup.start(), mouthSup.start()]);
  if (earsSup.currentState !== "READY" || mouthSup.currentState !== "READY") {
    throw new Error(`sidecar non prêt (ears=${earsSup.currentState}, mouth=${mouthSup.currentState})`);
  }

  earsIpc = new IpcClient(); await earsIpc.connect(earsSup.port);
  mouthIpc = new IpcClient(); await mouthIpc.connect(mouthSup.port);

  // V13/V15 (conv 58/60) — le PRODUIT resynchronise les oreilles au boot (`sendEarsResync`, runtime.ts :
  // S10 enroll→cache) → le juge descend le FILET V13, la pièce à EFFET VÉCU (si le juge crashe en pleine
  // session, les oreilles le DISENT — comportement réel). Le jalon enroll (no-op, ack d'état) n'affecte
  // aucune mesure → pas rejoué ici (re-croisé conv 60, FID-MIN-1 ; la parité vaut pour ce qui se VIT).
  // Ack LU (ROB-M3 croisé conv 58) : un échec est DIT, jamais fatal — sans filet, le juge mesure quand même.
  try {
    const ack = await earsIpc.request("cmd.tts.cache", { phrases: FALLBACK_PHRASES });
    if (ack?.payload?.ok !== true) console.log(`juge : phrases de secours NON posées (${ack?.payload?.note ?? "ack inattendu"}) — filet V13 absent ce run`);
  } catch (e) { console.log(`juge : cmd.tts.cache en échec — ${e.message} (filet V13 absent ce run)`); }

  // le VRAI cerveau chaud (OAuth Max), wrappé pour LIRE son TTFT (turn.end → 1er token) sans le déranger. Le prewarm
  // passe par brain.prewarm (→ brain.ask INTERNE), PAS par ce wrapper → la file ne contient QUE les vrais tours.
  brain = new WarmBrain({ paths, onLog: (l) => { if (verbose) console.log(`[warm] ${l}`); } });
  const timedBrain = {
    prewarm: () => brain.prewarm?.(),
    ask: (text, opts = {}) => brain.ask(text, opts).then((res) => { ttftQueue.push(typeof res.ttftMs === "number" ? res.ttftMs : null); return res; }),
  };

  router = new ConversationRouter({ earsIpc, mouthIpc, brain: timedBrain,
    // ARCHIVE (conv 53) : chaque tour (TES mots + SES mots) → une ligne dans conversations.jsonl. Passif, jamais fatal.
    onExchange: (e) => { try { fs.appendFileSync(CONV, JSON.stringify(e) + "\n"); } catch { /* jamais fatal */ } },
    // V12 : fan-out d'état vers le ducking (MÊME câblage que la prod, runtime.ts). `ducking` est créé plus bas —
    // la closure le lit à l'appel (la 1re transition arrive au 1er réveil, bien après).
    onVoiceState: (m) => ducking?.onVoiceState(m),
    onLog: (l) => {
    if (verbose) console.log(`[rt] ${l}`);
    // Le routeur ENCODE ses actes dans ses logs (pas d'event dédié — on n'ajoute rien à la prod). On y lit le barge, le
    // masqueur ET la pause/reprise V10 (chaînes stables, routeur V9/V10 verrouillé). Fragile par nature (log-matching) →
    // tracé : si le routeur change ces phrases, mettre à jour ici (un seul endroit).
    if (l.includes("barge-in")) {                            // V8 : le routeur a coupé (Yohann par-dessus sa réponse)
      const lat = lastVadStartT != null ? now() - lastVadStartT : null;
      stats.recordBarge({ latMs: lat, score: lastYohannScore });
      console.log(`  ✂ BARGE-IN — tu l'as coupée${lat != null ? ` (~${Math.round(lat)} ms depuis ta parole)` : ""}${lastYohannScore != null ? `, score V6 ${lastYohannScore.toFixed(2)}` : ""}`);
      BIP_BARGE();
    } else if (l.includes("masqueur joué")) {                // le masqueur vient d'être DÉCLENCHÉ (avant son 1er son)
      if (pending && pending.type === "reponse" && pending.masqueurAt == null) pending.masqueurAt = now();
    } else if (l.startsWith("hmm joué")) {                   // V10 (conv 52) : « hmm » de réflexion (clip ; seuil 1,4 s × proba 0,6 — conv 56)
      stats.recordHmm();
      if (pending && pending.type === "reponse" && pending.hmmAt == null) pending.hmmAt = now();  // conv 55 : l'HEURE du hmm (Yohann veut voir quand il part)
      hmmSkipNext = true;   // le PROCHAIN evt.tts.start est le hmm → on ne l'enregistre PAS comme le son du tour
      console.log("  🤔 hmm — elle comble le petit blanc (réflexion)");
    } else if (l.startsWith("pause :")) {                    // V10 : « attends s'il te plaît » → pensée gardée
      stats.recordPause({ transcript: lastFinalText });
      console.log("  ⏸ PAUSE — elle garde sa pensée (sommeil name-only jusqu'à « tu es là ? »)");
    } else if (l.startsWith("reprise :")) {                  // V10 : « tu es là ? » → reprise de la phrase coupée
      stats.recordResume();
      console.log("  ▶ REPRISE — « Oui, je suis là » + elle reprend au début de la phrase coupée");
    }
  } });
  router.start();

  // V12 — le DUCKING, comme dans le PRODUIT (fidélité : la mesure inclut son coût — quasi nul, duck 1,4 ms).
  // Le mixer vit dans le PARENT `.sophia-home-dev` (PAS le home du juge, effacé à chaque run) → le write-ahead
  // duck-restore.json SURVIT à un juge crashé en plein duck et le FILET BOOT du prochain run restaure.
  // Les BIPS du juge (sessions powershell) sont EXCLUS — la synchro à l'oreille ne baisse jamais.
  duckMixer = new WindowsMixer({
    // m7 (croisé conv 57) : sous-dossier DÉDIÉ au juge — l'app en DEV vit dans `.sophia-home-dev` (paths.ts) :
    // partager le même duck-restore.json/duck-helper.ps1 corromprait le seul mécanisme de récupération
    // (le filet boot de l'app mangerait le write-ahead VIVANT du juge). Le sous-dossier survit aux runs
    // (le home du juge, lui, est effacé à chaque run) → le filet boot du prochain juge marche.
    home: path.join(root, ".sophia-home-dev", "juge-duck"),
    // les DEUX sidecars (bouche = sa voix · oreilles = leur loopback), PIDs relus à chaque op ; le helper
    // étend aux ENFANTS (venv launcher → python réel — le bug « ça baisse Sophia aussi », mesuré conv 57).
    // m5 : + lastSpawnedPid (pendant un respawn, `pid` est l'ancien jusqu'à READY).
    excludePids: () => [earsSup.pid, earsSup.lastSpawnedPid, mouthSup.pid, mouthSup.lastSpawnedPid],
    excludeNames: ["powershell"],        // les bips de synchro (2 aigus = parle...) restent à plein volume
    // conv 60 (décision Yohann, option a) : les lignes du MIXER toujours VISIBLES (plus gatées --verbose) —
    // l'anomalie « Chrome resté à 21 » était inattribuable sans les noms+volumes d'origine (désormais dans
    // chaque ligne baissée(s)/restaurée(s), duck-mixer.ts). La policy, elle, reste résumée par les émojis.
    onLog: (l) => console.log(`  [duck] ${l}`),
  });
  ducking = new DuckingPolicy({
    mixer: duckMixer,
    onLog: (l) => {
      if (l.includes("BAS")) console.log("  🔉 DUCKING — les médias baissent (le temps de la conversation)");
      else if (l.includes("RESTAURÉS")) console.log("  🔊 DUCKING — les médias remontent (conversation finie)");
      if (verbose) console.log(`[duck] ${l}`);
    },
  });
  duckMixer.start();
  earsIpc.on("evt.wake", () => ducking.onWake());
  earsIpc.on("evt.vad.start", () => ducking.onVadStart());
  mouthIpc.on("evt.tts.start", () => ducking.onTtsStart());
  mouthIpc.on("evt.tts.done", () => ducking.onTtsDone());

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
  earsIpc.on("evt.affect", (e) => {                               // V14 : ligne de base (n'arrive que si SOPHIA_AFFECT=1)
    const p = e.payload || {};
    if (typeof p.valence !== "number" || typeof p.energie !== "number") return;
    // n8 : le transcript attribué par la MARK du tour (l'affect arrive après ; lastFinalText peut être le suivant)
    const transcript = turnTexts.get(p.mark) ?? lastFinalText;
    affectSamples.push({ valence: p.valence, energie: p.energie, confiance: p.confiance, transcript });
    console.log(`  💗 elle te lit : ${affectWords(p.valence, p.energie)}  (valence ${p.valence.toFixed(2)} · énergie ${p.energie.toFixed(2)} · confiance ${typeof p.confiance === "number" ? p.confiance.toFixed(2) : "?"}${affectBase.n ? `, base ${affectBase.n} lectures` : ", base par défaut"})`);
  });
  earsIpc.on("evt.turn.eval", (e) => {                            // endpointing (SOPHIA_TURN_DIAG toujours ON)
    const p = e.payload || {};
    // conv 55 : dt = horloge murale depuis TON dernier vad.stop → décompose l'endpointing (détection vs grâce).
    curEvals.push({ prob: p.prob, parle: p.parle, plaf: p.plaf, reason: p.reason, dt: lastVadStopT != null ? now() - lastVadStopT : null });
  });
  earsIpc.on("evt.turn.end", (env) => {
    // attente (endpointing V5) : fin de ta parole (dernier vad.stop) → sa décision que tu as fini. La réponse (→ son) part de là.
    const attente = lastVadStopT != null ? now() - lastVadStopT : null;
    // conv 55 — DÉCOMPOSITION : timeline des evals Smart Turn depuis le vad.stop (détection) ; le gap dernier-eval→fin = la grâce.
    if (attente != null && curEvals.length) {
      const tl = curEvals.map((c) => `@${c.dt}ms(p=${typeof c.prob === "number" ? c.prob.toFixed(2) : "?"},plaf=${c.plaf}s)`).join(" ");
      const last = curEvals[curEvals.length - 1];
      const graceWait = last.dt != null ? attente - last.dt : null;
      console.log(`  ⏱ endpointing ${attente}ms | détection(vad.stop→dernier eval)=${last.dt}ms · grâce(eval→fin)=${graceWait}ms | evals: ${tl}`);
    }
    stats.recordEndpointTurn({ evals: curEvals, endProb: typeof env.payload?.prob === "number" ? env.payload.prob : null });
    curEvals = [];
    // V14 (n8) : mémoriser le transcript de CE tour par sa mark (l'evt.affect du tour arrivera plus tard avec elle)
    if (typeof env.payload?.mark === "number") {
      turnTexts.set(env.payload.mark, lastFinalText);
      if (turnTexts.size > 32) turnTexts.delete(turnTexts.keys().next().value);   // borné (les plus vieux sortent)
    }
    pending = { type: matchClosing(lastFinalText) ? "clôture" : "reponse", t0: now(), attente, transcript: lastFinalText, masqueurAt: null };
    console.log(`  📝 « ${lastFinalText} »`);   // transcript du tour → corréler CE QUE tu dis avec la latence
  });
  mouthIpc.on("evt.tts.start", (e) => {
    if (hmmSkipNext) { hmmSkipNext = false; return; } // V10 : ce start est le HMM (énonciation séparée) → pas le son du tour
    if (!pending) return;                       // son sans trigger (2e phrase d'une même énonciation, ou 2e son) → ignoré
    // 1er son après le trigger = ce que TU entends. Un masqueur joué AVANT (pending.masqueurAt posé via le log routeur)
    // → ce 1er son est le masqueur ; on le signale + on mesure son délai RÉEL depuis ta fin de tour (répond au « trop tard »).
    const id = Number(e.payload?.id);
    const lat = now() - pending.t0;
    const filler = pending.type === "reponse" && pending.masqueurAt != null;
    const fillerDelayMs = filler ? pending.masqueurAt - pending.t0 : null;
    const hmmDelayMs = pending.hmmAt != null ? pending.hmmAt - pending.t0 : null;   // conv 55 : délai du hmm depuis ta fin de tour
    const rec = stats.record({ type: pending.type, sonMs: lat, endpointingMs: pending.attente, filler, fillerDelayMs, hmmDelayMs, transcript: pending.transcript });
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
  startGpuCpuSampler();   // conv 52 : échantillonne GPU/CPU pendant les conversations (charge réelle + preuve que c'est propre)
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
  stopGpuCpuSampler();   // plus d'échantillon pendant le teardown
  stats.finalizeTtft(ttftQueue);
  stats.setHygiene("end", await countProcs());   // fuite de CE run ? (avant le nettoyage)

  console.log("");
  for (const line of stats.summaryLines()) console.log(line);
  // V14 (conv 59) : résumé de la ligne de base d'affect (seulement si le capteur était allumé ET a émis).
  if (affectSamples.length) {
    const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const v = affectSamples.map((s) => s.valence), en = affectSamples.map((s) => s.energie);
    console.log(`  💗 affect (${affectSamples.length} lectures verrouillées) : la session t'a lu « ${affectWords(med(v), med(en))} » — valence méd ${med(v).toFixed(2)} [${Math.min(...v).toFixed(2)}-${Math.max(...v).toFixed(2)}] · énergie méd ${med(en).toFixed(2)} [${Math.min(...en).toFixed(2)}-${Math.max(...en).toFixed(2)}]`);
  }

  // HISTORIQUE PERSISTANT (idée Yohann) : une ligne JSON par session (le parent `.sophia-home-dev` n'est pas effacé →
  // ce fichier SURVIT et s'accumule). Yohann le donne à Claude quand il veut → améliorer sur de VRAIS chiffres.
  try {
    // conv 58 : + `code` (commit/sujet/dirty) — corréler chaque session à la version qui tournait (investigations).
    // conv 59 : + `affect` (les lectures verrouillées de la session — la ligne de base s'accumule au fil des sessions).
    fs.appendFileSync(HIST, JSON.stringify({ ...stats.historyRecord(new Date().toISOString()), code: await gitInfo(),
      ...(affectSamples.length ? { affect: affectSamples } : {}) }) + "\n");
    console.log(`\n  📄 session sauvegardée → ${path.relative(root, HIST)}  (donne-moi ce fichier quand tu veux)`);
  } catch { /* la sauvegarde n'est jamais fatale */ }
  console.log("");
  BIP_DONE();
  await new Promise((r) => setTimeout(r, 900)); // laisser le bip finir
  await cleanup();
  process.exit(0);
}

async function cleanup() {
  stopGpuCpuSampler();
  try { router?.stop(); } catch { /* */ }
  // V12 : restaurer les médias AVANT de tout couper (jamais un Spotify laissé baissé). `await` borné par la
  // chaîne du mixer (~ms + rampe) ; un crash brutal est couvert par le write-ahead → filet boot du prochain run.
  try { ducking?.stop(); } catch { /* */ }
  try { await duckMixer?.stop(); } catch { /* */ }
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
// nettoyage convergent (`ensureCleanBaseline`) du PROCHAIN démarrage le rattrape → jamais d'accumulation. Best-effort.
process.on("exit", () => {
  try { brain?.close(); } catch { /* */ }
  for (const s of [earsSup, mouthSup]) { try { if (s?.pid) process.kill(s.pid, "SIGKILL"); } catch { /* déjà mort */ } }
});

main().catch(async (e) => {
  console.error("juge : échec —", e.message);
  await cleanup();
  process.exit(1);
});
