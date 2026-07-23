// E2E-V15 — le RESPAWN RESYNC (S10) + la reconnexion mid-session + la conformité (conv 60, I-5).
//
// BLOC A — le RUNTIME (structure pure, patron e2e-boot-respawn ; vrais sidecars, sans audio) :
//   1. boot nominal → pipeline branché + l'ordre S10 du chemin durable AUX LOGS (policy → enroll → cache) ;
//   2. KILL de l'OREILLE en pleine session (la sonde conv 60 : avant le fix, routeur sur port mort À VIE,
//      0 client WS sur le frais, politique jamais re-descendue, voyant vert menteur) → respawn supervisé →
//      DÉTECTION (port périmé) → teardown + REBUILD + resync S10 → le sidecar FRAIS a 1 client WS et la
//      politique re-descendue ;
//   3. KILL de la BOUCHE → même chemin (les deux rôles sont couverts).
//
// BLOC B — CŒUR RÉEL sidecar (patron e2e-v13 ; VRAI faster-whisper + portier + VRAI Piper, SANS injection) :
//   run 1 : la séquence S10 côté sidecar (policy ACK + enroll ACK honnête [anchor vendored, speaker absent
//           dans ce mode — V6 non monté] + tts.cache ACK, cache posé) → le wake VIT (« bonjour sophia ») →
//           KILL DU PROCESS (« le crash ») ;
//   run 2 : le « respawné » (port NEUF) + SOPHIA_STT_ENGINE=cloud-stub → S10 re-exécuté → le FAILOVER en
//           cœur réel (stub cloud échoue au warm → RETOUR AUTOMATIQUE au local réel : load_info
//           {degraded:true, reason:"cloud-failed"}) → LE WAKE DE RETOUR sans injection (I-5) → arrêt propre ;
//   run 3 : mode test-speaker (léger) → cmd.enroll.push → ack speaker:"monte" (l'ancre vendorisée chargée).
// Skip proprement si les assets gitignorés manquent (CF2).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { SophiaRuntime } = require(path.join(root, "dist/electron/runtime.js"));
const { resolvePaths } = require(path.join(root, "dist/src/orchestrator/paths.js"));
const { IpcClient } = require(path.join(root, "dist/src/orchestrator/ipc/index.js"));

const results = [];
const check = (n, c) => { results.push([n, !!c]); console.log(`${c ? "OK   " : "ECHEC"} ${n}`); };
const waitFor = async (pred, ms, step = 200) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await pred()) return true; } catch { /* transitoire */ }
    await sleep(step);
  }
  return false;
};

// ═════════ BLOC A — le runtime : kill mid-session → rebuild + resync S10 ═════════
const ROUTER_LOG = "routeur de conversation + résidence des modèles branchés";
const REBUILD_LOG = "respawn d'un sidecar détecté (port périmé)";

async function blocA() {
  const home = path.join(root, ".sophia-home-dev", "e2e-v15");
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const paths = resolvePaths(home);
  const logs = [];
  const log = (l) => logs.push(l);
  const fakeApp = { on: () => {}, exit: () => {}, quit: () => {} };
  const dbg = async (port) => { try { return await (await fetch(`http://127.0.0.1:${port}/debug`)).json(); } catch { return null; } };
  const runtime = new SophiaRuntime(fakeApp, paths, root, { onLog: log }, { audioEnabled: false });
  try {
    const outcome = await runtime.run();
    check("A: boot PRIMARY", outcome.kind === "PRIMARY");
    check("A: pipeline branché au boot", await waitFor(() => logs.some((l) => l.includes(ROUTER_LOG)), 20000, 100));
    // L'ordre S10 du chemin DURABLE (« (pipeline) ») : policy (résidence) AVANT enroll AVANT cache.
    // Le resync est fire-and-forget → ses logs suivent ROUTER_LOG de quelques ms : on les ATTEND d'abord.
    await waitFor(() => logs.some((l) => l.includes("empreintes (enroll S10)") && l.includes("(pipeline)"))
      && logs.some((l) => l.includes("phrases de secours") && l.includes("(pipeline)")), 5000, 50);
    const iPol = logs.findIndex((l) => l.includes("résidence : cmd.model.policy"));
    const iEnr = logs.findIndex((l) => l.includes("empreintes (enroll S10)") && l.includes("(pipeline)"));
    const iCache = logs.findIndex((l) => l.includes("phrases de secours") && l.includes("(pipeline)"));
    check("A: S10 durable — la politique part (résidence, émetteur unique)", iPol >= 0);
    check("A: S10 durable — l'enroll est un jalon HONNÊTE (ancre vendorisée, speaker absent sans audio)",
      iEnr >= 0 && logs[iEnr].includes("vendored"));
    check("A: S10 durable — le cache suit, ack LU honnête (non monté sans audio — jamais un log menteur)", iCache >= 0);
    check("A: S10 durable — l'ORDRE policy → enroll → cache", iPol < iEnr && iEnr < iCache);

    // ── KILL de l'OREILLE en pleine session (la sonde conv 60) ──
    const earsPort0 = runtime.earsSupervisor.port;
    const earsPid0 = runtime.earsSupervisor.pid;
    const routerLogs0 = logs.filter((l) => l.includes(ROUTER_LOG)).length;
    process.kill(earsPid0);
    check("A: (ears) respawn supervisé → READY sur un port NEUF", await waitFor(
      () => runtime.earsSupervisor.currentState === "READY" && runtime.earsSupervisor.port !== earsPort0, 40000, 100));
    check("A: (ears) la DÉTECTION du port périmé a tourné", await waitFor(() => logs.some((l) => l.includes(REBUILD_LOG)), 10000, 100));
    check("A: (ears) le pipeline est REBRANCHÉ (rebuild post-respawn V15)", await waitFor(
      () => logs.filter((l) => l.includes(ROUTER_LOG)).length > routerLogs0
        && logs.some((l) => l.includes("[rebuild post-respawn V15]")), 10000, 100));
    check("A: (ears) le sidecar FRAIS a 1 client WS (le routeur s'est reconnecté — la sonde disait 0)",
      await waitFor(async () => ((await dbg(runtime.earsSupervisor.port))?.ws_connections ?? 0) >= 1, 5000, 100));
    check("A: (ears) la POLITIQUE re-descendue au frais = veille (l'état courant — la sonde disait null)",
      (await dbg(runtime.earsSupervisor.port))?.audio?.model_policy?.group === "veille");
    check("A: (ears) l'enroll du REBUILD est passé (jalon S10)", logs.some((l) => l.includes("empreintes (enroll S10)") && l.includes("(rebuild)")));
    check("A: (ears) voyant : pas de SANS_VOIX résiduel", !outcome.runtime.current().degraded.includes("SANS_VOIX"));

    // ── KILL de la BOUCHE (l'autre rôle — même chemin) ──
    const mouthPort0 = runtime.mouthSupervisor.port;
    const rebuilds0 = logs.filter((l) => l.includes(REBUILD_LOG)).length;
    process.kill(runtime.mouthSupervisor.pid);
    check("A: (mouth) respawn supervisé → READY sur un port NEUF", await waitFor(
      () => runtime.mouthSupervisor.currentState === "READY" && runtime.mouthSupervisor.port !== mouthPort0, 40000, 100));
    check("A: (mouth) rebuild détecté + rebranché", await waitFor(
      () => logs.filter((l) => l.includes(REBUILD_LOG)).length > rebuilds0, 10000, 100));
    check("A: (mouth) le sidecar bouche FRAIS a 1 client WS", await waitFor(
      async () => ((await dbg(runtime.mouthSupervisor.port))?.ws_connections ?? 0) >= 1, 10000, 100));
  } finally {
    try { await runtime.earsSupervisor.stop(); } catch { /* */ }
    try { await runtime.mouthSupervisor.stop(); } catch { /* */ }
  }
}

// ═════════ BLOC A2 — le HANDOFF à travers le runtime (T2, croisé conv 60) : conversation OUVERTE →
// respawn → rebuild AVEC l'état + le retry M-4 qui GARDE le handoff. Superviseurs factices à getters
// (la vraie supervision est prouvée au bloc A) + VRAIS sidecars socle. ═════════
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");

function spawnSocle(port, script = "sidecar/server.py", cwd = root) {
  const p = spawn(PY, [script, String(port)], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", () => { /* drain */ }); p.stderr.on("data", () => { /* drain */ });
  return p;
}
const dbgAt = async (port) => { try { return await (await fetch(`http://127.0.0.1:${port}/debug`)).json(); } catch { return null; } };

function makeHarnessRuntime(home, S, mouthPort, logs) {
  // Superviseurs factices : les getters lisent l'état COURANT (comme les vrais — _port/_pid posés à READY).
  const earsSup = { get port() { return S.earsPort; }, get pid() { return S.earsPid; }, lastSpawnedPid: 0,
    currentState: "READY", start: async () => {}, stop: async () => {}, orphanCleanup: () => {} };
  const mouthSup = { port: mouthPort, pid: 777, lastSpawnedPid: 0, currentState: "READY",
    start: async () => {}, stop: async () => {}, orphanCleanup: () => {} };
  fs.rmSync(home, { recursive: true, force: true }); fs.mkdirSync(home, { recursive: true });
  const rt = new SophiaRuntime({ on: () => {}, exit: () => {}, quit: () => {} }, resolvePaths(home), root,
    { onLog: (l) => logs.push(l) }, { audioEnabled: false, supervisorFactory: (r) => (r === "ears" ? earsSup : mouthSup) });
  // session/warm factices : on exerce le PIPELINE (pas le boot — prouvé au bloc A) ; `private` TS = accessible en JS.
  rt.session = { kind: "PRIMARY", runtime: { clearDegradation() {}, markDegraded() {}, current: () => ({ degraded: [] }), alert() {} } };
  rt.warm = { ask: async () => ({ isError: false, aborted: false, text: "" }) };
  return rt;
}

async function blocA2() {
  const P_A = 8894, P_B = 8895, P_MOUTH = 8896, P_C = 8897;
  const earsA = spawnSocle(P_A), earsB = spawnSocle(P_B), mouth = spawnSocle(P_MOUTH);
  let earsC = null;
  try {
    check("A2: sidecars socle A/B/mouth PRÊTS", (await ready(P_A)) && (await ready(P_B)) && (await ready(P_MOUTH)));
    const logs = [];
    const S = { earsPort: P_A, earsPid: 111 };
    const rt = makeHarnessRuntime(path.join(root, ".sophia-home-dev", "e2e-v15-a2"), S, P_MOUTH, logs);
    await rt.ensureVoicePipeline();
    check("A2: build initial câblé sur A (témoins composés)", rt.router != null && rt.earsPortWired === P_A);
    const router1 = rt.router;
    router1.states.wake();          // la conversation est OUVERTE — l'état que le crash doit traverser
    await sleep(150);
    check("A2: conversation OUVERTE (ÉCOUTE)", router1.listenState === "ecoute");
    // ── le respawn (onReady → refreshVoiceReady) : témoins neufs → teardown + rebuild AVEC l'état ──
    S.earsPort = P_B; S.earsPid = 222;
    rt.refreshVoiceReady();
    await sleep(800);
    check("A2: teardown — détection + état à ré-exécuter DIT",
      logs.some((l) => l.includes("respawn d'un sidecar détecté") && l.includes("« ecoute » à ré-exécuter")));
    check("A2: routeur NEUF en ÉCOUTE (Yohann reprend sans redire le nom — écart C-c à travers le RUNTIME)",
      rt.router != null && rt.router !== router1 && rt.router.listenState === "ecoute");
    check("A2: la POLITIQUE re-descendue au frais = CONVERSATION (S10 : la politique COURANTE, pas un reset veille)",
      await waitFor(async () => (await dbgAt(P_B))?.audio?.model_policy?.group === "conversation", 5000, 100));
    check("A2: pendingHandoff CONSOMMÉ au succès", rt.pendingHandoff === null);
    check("A2: phrase de retour GATÉE (audioEnabled=false → silencieuse, structure)",
      !logs.some((l) => l.includes("je dis le raté")));
    // ── le retry M-4 GARDE le handoff : respawn vers un port SANS serveur → échec → retry AVEC l'état ──
    S.earsPort = P_C; S.earsPid = 333;   // personne n'écoute sur C
    rt.refreshVoiceReady();
    await sleep(800);
    check("A2: rebuild ÉCHOUÉ (connect refusé) → dit + retry armé",
      logs.some((l) => l.includes("routeur de conversation NON branché")));
    check("A2: pendingHandoff GARDÉ pour le retry (l'état « ecoute » n'est jamais perdu)",
      rt.pendingHandoff != null && rt.pendingHandoff.listen === "ecoute");
    earsC = spawnSocle(P_C);
    check("A2: sidecar C PRÊT", await ready(P_C));
    check("A2: le retry M-4 a rebâti AVEC l'état (ÉCOUTE ré-exécutée sur C)",
      await waitFor(() => rt.router != null && rt.router.listenState === "ecoute", 9000, 200));
    check("A2: C a 1 client + politique conversation", ((await dbgAt(P_C))?.ws_connections ?? 0) >= 1
      && (await dbgAt(P_C))?.audio?.model_policy?.group === "conversation");
  } finally {
    for (const p of [earsA, earsB, mouth, earsC]) { try { p?.kill(); } catch { /* */ } }
    await sleep(300);
  }
}

// ═════════ BLOC A3 — le respawn PENDANT le build (ROB-M1, croisé conv 60 — reproduit 10/10 AVANT le
// fix) : le connect de la bouche est LENT (fixture handshake 600 ms) et le respawn de l'oreille aboutit
// pendant l'await → les témoins COMPOSÉS (capturés avant les awaits) rendent le re-check de fin de build
// VIVANT : teardown + retry court + rebuild vers le sidecar FRAIS. Sans le fix (témoins relus après les
// connects), le pipeline restait câblé au MORT avec le voyant vert — surdité à vie. ═════════
async function blocA3() {
  const P_A = 8891, P_B = 8892, P_MOUTH = 8893;
  const earsA = spawnSocle(P_A), earsB = spawnSocle(P_B);
  const mouthSlow = spawnSocle(P_MOUTH, "tests/fixtures/slow_ws_server.py", root);
  try {
    check("A3: A/B/bouche-lente PRÊTS", (await ready(P_A)) && (await ready(P_B)) && (await ready(P_MOUTH)));
    const logs = [];
    const S = { earsPort: P_A, earsPid: 111 };
    const rt = makeHarnessRuntime(path.join(root, ".sophia-home-dev", "e2e-v15-a3"), S, P_MOUTH, logs);
    // le build part (connect ears→A instantané, connect bouche ~600 ms) ; à t+250 ms le respawn ABOUTIT
    // (READY → témoins neufs au superviseur ; l'onReady réel serait skippé : buildingPipeline).
    const build = rt.ensureVoicePipeline();
    setTimeout(() => { S.earsPort = P_B; S.earsPid = 222; }, 250);
    await build;
    check("A3: les témoins mémorisés = les valeurs COMPOSÉES (A — jamais une relecture post-await)",
      rt.earsPortWired === P_A && rt.earsPidWired === 111);
    check("A3: le re-check de fin de build a MORDU (respawn pendant le câblage DIT)",
      logs.some((l) => l.includes("respawné PENDANT le câblage")));
    check("A3: le rebuild aboutit sur le sidecar FRAIS (B a 1 client WS)",
      await waitFor(async () => ((await dbgAt(P_B))?.ws_connections ?? 0) >= 1, 8000, 200));
    // le rebuild traverse AUSSI le handshake lent de la bouche (600 ms) → attendre la FIN du build avant
    // de lire les témoins (le check précédent ne prouve que le connect ears).
    check("A3: les témoins suivent (B composé au rebuild) — pipeline frais",
      await waitFor(() => rt.earsPortWired === P_B && rt.pipelineIsStale() === false, 8000, 100));
  } finally {
    for (const p of [earsA, earsB, mouthSlow]) { try { p?.kill(); } catch { /* */ } }
    await sleep(300);
  }
}

// ═════════ BLOC B — cœur réel sidecar : S10 + crash/respawn + failover + wake de retour (I-5) ═════════
const ASSET = path.join(root, "sidecar", "tests", "assets", "bonjour_sophia_16k.wav");
const VOICE = path.join(root, "resources", "models", "voice", "fr_FR-a20-e400.onnx");
const SPK_MODEL = path.join(root, "resources", "models", "speaker", "hyperparams.yaml");
const PHRASES = [{ name: "secours", text: "Mon cerveau ne répond pas, je redémarre." }];

function spawnSidecar(port, extraEnv = {}) {
  const proc = spawn(PY, ["sidecar/server.py", String(port)], {
    cwd: root, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", () => { /* drain */ });
  proc.stdout.on("data", () => { /* drain */ });
  return proc;
}

async function ready(port, tries = 100) {
  for (let i = 0; i < tries; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok && (await r.json()).ready) return true; } catch { /* pas prêt */ }
  }
  return false;
}

async function killAndWait(proc) {
  proc.kill();
  await new Promise((res) => {
    let done = false; let timer = null;
    const d = () => { if (!done) { done = true; if (timer) clearTimeout(timer); res(); } };
    proc.once("exit", d); timer = setTimeout(d, 3000);
  });
}

/** La séquence S10 exécutée par le « runtime » (nous) sur un sidecar frais — acks vérifiés. */
async function s10(client, label, { expectSpeaker }) {
  const pol = await client.request("cmd.model.policy", { group: "veille", layers: { secours: false, jeu: false } });
  check(`B: (${label}) S10-1 policy ACK (groupe enregistré)`, pol.payload.ok === true && pol.payload.group === "veille");
  const enr = await client.request("cmd.enroll.push", {});
  check(`B: (${label}) S10-2 enroll ACK honnête (anchor=vendored, speaker=${expectSpeaker})`,
    enr.payload.ok === true && enr.payload.anchor === "vendored" && enr.payload.speaker === expectSpeaker);
  const cache = await client.request("cmd.tts.cache", { phrases: PHRASES });
  check(`B: (${label}) S10-3 tts.cache ACK (pré-synthèse)`, cache.payload.ok === true);
}

async function blocB() {
  if (!fs.existsSync(ASSET) || !fs.existsSync(VOICE)) {
    console.log("SKIP  bloc B : assets (bonjour_sophia / voix A20) absents — CF2, gitignorés.");
    return;
  }
  const PORT1 = 8815, PORT2 = 8816;
  const getDebug = async (port) => await (await fetch(`http://127.0.0.1:${port}/debug`)).json();

  // ── run 1 : S10 + le wake vit, puis LE CRASH ──
  let proc = spawnSidecar(PORT1, { SIDECAR_AUDIO: "test-fallback" });
  let client = new IpcClient();
  try {
    check("B: (run1) sidecar PRÊT", await ready(PORT1));
    await client.connect(PORT1);
    await s10(client, "run1", { expectSpeaker: "absent" });   // V6 non monté en test-fallback → HONNÊTE
    check("B: (run1) le cache est POSÉ (vrai Piper)", await waitFor(
      async () => (await getDebug(PORT1)).audio.fallback.cached.includes("secours"), 30000));
    check("B: (run1) le WAKE VIT (vrai STT + portier, sans injection)", await waitFor(
      async () => (await getDebug(PORT1)).audio.wake.last_wake != null, 60000));
  } finally {
    await killAndWait(proc);                                   // ← LE CRASH mid-session (SIGKILL, pas de close frame)
  }

  // ── run 2 : le « respawné » (port NEUF) + cloud-stub → failover réel + S10 + WAKE DE RETOUR (I-5) ──
  proc = spawnSidecar(PORT2, { SIDECAR_AUDIO: "test-fallback", SOPHIA_STT_ENGINE: "cloud-stub" });
  client = new IpcClient();
  try {
    check("B: (run2) le sidecar RESPAWNÉ est PRÊT (port neuf)", await ready(PORT2));
    await client.connect(PORT2);
    await s10(client, "run2", { expectSpeaker: "absent" });    // le resync S10 COMPLET sur le frais
    const d = await getDebug(PORT2);
    check("B: (run2) la politique est ENREGISTRÉE au frais", d.audio.model_policy != null && d.audio.model_policy.group === "veille");
    // Le FAILOVER en cœur réel : le stub cloud a échoué au warm → RETOUR AUTOMATIQUE au local (vrai
    // faster-whisper) + la notification honnête (load_info → evt.model.loaded {degraded, reason}).
    check("B: (run2) failover cloud→local : load_info {degraded:true, reason:cloud-failed}", await waitFor(
      async () => {
        const li = (await getDebug(PORT2)).audio.stt.load_info;
        return li != null && li.degraded === true && li.reason === "cloud-failed";
      }, 60000));
    check("B: (run2) le cache re-POSÉ après respawn", await waitFor(
      async () => (await getDebug(PORT2)).audio.fallback.cached.includes("secours"), 30000));
    // LE WAKE DE RETOUR (I-5) : le sidecar frais, resynchronisé, ENTEND — sur le moteur LOCAL du failover.
    check("B: (run2) WAKE DE RETOUR après crash+respawn+resync (I-5, sans injection)", await waitFor(
      async () => (await getDebug(PORT2)).audio.wake.last_wake != null, 60000));
    const ack = await client.request("cmd.shutdown", { reason: "e2e-v15" });
    check("B: (run2) arrêt propre (cmd.shutdown ack)", ack.payload.ok === true);
    client.close();
  } finally {
    await killAndWait(proc);
  }

  // ── run 3 : l'ack enroll « monte » (mode test-speaker, l'ancre vendorisée VRAIMENT chargée) ──
  if (!fs.existsSync(SPK_MODEL)) {
    console.log("SKIP  bloc B run 3 : modèle speaker vendorisé absent (CF2).");
    return;
  }
  proc = spawnSidecar(PORT1, { SIDECAR_AUDIO: "test-speaker" });
  client = new IpcClient();
  try {
    check("B: (run3) sidecar test-speaker PRÊT", await ready(PORT1));
    await client.connect(PORT1);
    // ROB-M2 (croisé conv 60) : le SpeakerPlug charge ECAPA + l'ancre EN FOND (~1-2 s) — pendant cette
    // fenêtre l'ack dit « warming » (l'issue n'est pas connue, jamais un « monte » supposé). On RÉESSAIE
    // jusqu'à « monte » : l'assertion prouve alors le chargement RÉEL (l'ancienne assertion immédiate
    // aurait accepté la fenêtre du warm, ancre corrompue comprise).
    const seen = [];
    const monte = await waitFor(async () => {
      const enr = await client.request("cmd.enroll.push", {});
      seen.push(enr.payload.speaker);
      return enr.payload.ok === true && enr.payload.anchor === "vendored" && enr.payload.speaker === "monte";
    }, 30000, 300);
    check(`B: (run3) enroll ACK atteint « monte » (warm RÉEL prouvé ; états vus : ${[...new Set(seen)].join("→")})`, monte);
    check("B: (run3) jamais un état inventé (warming|monte seuls — pas de warm_failed ni d'absent)",
      seen.every((s) => s === "warming" || s === "monte"));
    client.close();
  } finally {
    await killAndWait(proc);
  }
}

async function run() {
  await blocA();
  await blocA2();
  await blocA3();
  await blocB();
  const fail = results.filter(([, ok]) => !ok).length;
  if (fail) { console.error(`\ne2e-v15 : ${fail} échec(s)`); process.exit(1); }
  console.log(`\nE2E-V15 OK (${results.length} vérifs) : kill mid-session → respawn supervisé → détection port périmé → rebuild + resync S10 ORDONNÉ (policy → enroll honnête → cache) → sidecar frais reconnecté + politique re-descendue ; cœur réel : crash → respawn → S10 → failover cloud→local (notification honnête) → WAKE DE RETOUR sans injection (I-5)`);
  process.exit(0);
}
run().catch((e) => { console.error("ECHEC e2e-v15 :", e); process.exit(1); });
