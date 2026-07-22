// e2e-boot-respawn — LE TEST QUI PROUVE QUE LE FIX « BOOT SANS VOIX » (conv 55, electron/runtime.ts) MORD.
//
// LE BUG D'ORIGINE : le pipeline de voix (IPC ×2 + résidence + routeur + start) se construisait UNE SEULE FOIS
// dans run(). Si un sidecar était encore RESTARTING à cet instant (un spawn raté au boot → respawn), le pipeline
// était sauté et JAMAIS reconstruit — le respawn ne faisait que rallumer le voyant (refreshVoiceReady = faux
// vert) → `router === null` à vie → Sophia MUETTE (la soirée conv 55).
//
// LE FIX : `ensureVoicePipeline()` idempotente, appelée de run() ET de refreshVoiceReady (onReady de chaque
// superviseur) → le pipeline se construit AU RESPAWN si le boot l'a manqué.
//
// CE TEST (cœur réel, SANS audio — structure pure, rapide) :
//   1. l'OREILLE échoue à son 1er spawn (fixture flaky_server.py + marqueur) → au retour de run(), le routeur
//      n'est PAS branché (SANS_VOIX posé, backoff en cours) — la SITUATION EXACTE du bug ;
//   2. le superviseur respawne l'oreille (le vrai server.py cette fois) → onReady → refreshVoiceReady →
//      ensureVoicePipeline → LE ROUTEUR SE BRANCHE (log « routeur de conversation … branchés ») + SANS_VOIX levé.
// TEMP-REVERT (vérifié à la main) : sans l'appel `ensureVoicePipeline()` dans refreshVoiceReady, l'étape 2
// n'arrive jamais → ce test ÉCHOUE. Il mord.
//
// Node PUR (pas d'Electron : SophiaRuntime n'utilise `App` que pour `app.on`/`app.exit` via installBeforeQuit
// → un faux objet suffit ; le VRAI before-quit Electron est prouvé par le smoke).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { SophiaRuntime } = require(path.join(root, "dist/electron/runtime.js"));
const { Supervisor } = require(path.join(root, "dist/src/orchestrator/supervisor/index.js"));
const { resolvePaths } = require(path.join(root, "dist/src/orchestrator/paths.js"));

const results = [];
const check = (n, c) => { results.push([n, !!c]); console.log(`${c ? "OK   " : "ECHEC"} ${n}`); };

// Maison jetable dédiée (pipe d'instance dérivé du home → aucune collision avec l'app/le juge).
const home = path.join(root, ".sophia-home-dev", "e2e-boot-respawn");
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
const paths = resolvePaths(home);
const marker = path.join(home, "flaky.marker");

const logs = [];
const log = (l) => { logs.push(l); console.log(`  [rt] ${l}`); };
const ROUTER_LOG = "routeur de conversation + résidence des modèles branchés";

// Faux App : installBeforeQuit ne demande que `on` (before-quit) et `exit` — jamais déclenchés ici (l'arrêt
// du test passe par les superviseurs directement ; le VRAI before-quit = smoke Electron).
const fakeApp = { on: () => {}, exit: () => {}, quit: () => {} };

async function run() {
  const runtime = new SophiaRuntime(fakeApp, paths, root, { onLog: log }, {
    audioEnabled: false, // structure pure (pas de micro/GPU/Piper) — le boot du vrai server.py est ~1 s
    // COUTURE (conv 56) : l'OREILLE passe par le script flaky (1er spawn = exit 1) ; backoff ALLONGÉ (4 s) pour
    // GARANTIR que run() se termine PENDANT que l'oreille est encore RESTARTING (le scénario exact du bug —
    // sans ça, un respawn ultra-rapide pourrait battre la fin du boot et masquer le chemin testé).
    supervisorFactory: (role, opts) => role === "ears"
      ? new Supervisor({
          ...opts,
          script: "tests/fixtures/flaky_server.py",
          extraEnv: { ...(opts.extraEnv ?? {}), FLAKY_MARKER: marker },
          backoffBaseMs: 4000,
          readinessTimeoutMs: 15000,
        })
      : new Supervisor(opts),
  });

  try {
    const outcome = await runtime.run();
    check("boot : PRIMARY", outcome.kind === "PRIMARY");
    check("étape 1 : le 1er spawn de l'oreille a échoué (marqueur posé par la fixture)", fs.existsSync(marker));
    check("étape 1 : au retour de run(), l'oreille n'est PAS prête (RESTARTING — la situation du bug)",
      runtime.earsSupervisor.currentState !== "READY");
    check("étape 1 : SANS_VOIX posé (le boot le dit honnêtement)",
      outcome.runtime.current().degraded.includes("SANS_VOIX"));
    check("étape 1 : le routeur n'est PAS branché (aucun faux vert)", !logs.some((l) => l.includes(ROUTER_LOG)));

    // Étape 2 — attendre le respawn (backoff 4 s + boot vrai server ~1 s) → le fix doit brancher le pipeline.
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !logs.some((l) => l.includes(ROUTER_LOG))) await sleep(250);
    check("étape 2 : le routeur SE BRANCHE au respawn (ensureVoicePipeline via refreshVoiceReady — LE FIX)",
      logs.some((l) => l.includes(ROUTER_LOG)));
    check("étape 2 : l'oreille est READY (respawnée sur le vrai server.py)",
      runtime.earsSupervisor.currentState === "READY");
    check("étape 2 : SANS_VOIX levé (la voix est complète, le voyant ne ment pas)",
      !outcome.runtime.current().degraded.includes("SANS_VOIX"));
  } finally {
    // N-6b (croisé conv 56) : les 2 sidecars sont tués MÊME si une vérif lève (sinon la bouche — un VRAI server.py —
    // fuirait en orphelin ; récupérable par le balayage prod, mais un harnais propre ne fuit pas). Le test ne passe
    // pas par before-quit — c'est le smoke Electron qui le prouve.
    try { await runtime.earsSupervisor.stop(); } catch { /* */ }
    try { await runtime.mouthSupervisor.stop(); } catch { /* */ }
  }

  const fail = results.filter(([, ok]) => !ok).length;
  if (fail) { console.error(`\ne2e-boot-respawn : ${fail} échec(s)`); process.exit(1); }
  console.log(`\ne2e-boot-respawn OK (${results.length} vérifs) : le fix « boot sans voix » MORD (pipeline reconstruit au respawn)`);
  process.exit(0); // db/pipe/WS encore ouverts → sortie explicite (harnais de test)
}

run().catch((e) => { console.error("ECHEC e2e-boot-respawn :", e); process.exit(1); });
