// E2E-V11 — la RÉSIDENCE DES MODÈLES dans le VRAI sidecar (cœur réel, sans GPU) : le protocole `cmd.model.policy`
// (enregistré + reflété /debug + device cible) + la remontée `evt.model.loaded/unloaded` (emit → bus → WS) + le
// repli CPU sur refus VRAM. Mode `test-models` = chemin OREILLES minimal avec un STT SCRIPTÉ (pas les ~7 s GPU) ;
// `SOPHIA_MODELS_FAIL_CUDA=1` simule un refus d'allocation CUDA → le repli CPU (load_with_fallback) est exercé.
//
// evt.model.loaded est émis au WARM du worker (t≈0, avant que le client se connecte) → on prouve la RÉSIDENCE via
// /debug (audio.stt.model_loaded + load_info) ; le round-trip emit → bus → WS est prouvé par evt.model.unloaded
// (émis à l'arrêt, client connecté). La LOGIQUE (parse/resolve/fallback + émissions de la prise) = test_v11 (unit).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async (port) => await (await fetch(`http://127.0.0.1:${port}/debug`)).json();

async function boot(port, extraEnv) {
  const proc = spawn(PY, ["sidecar/server.py", String(port)], {
    cwd: root,
    env: { ...process.env, SIDECAR_AUDIO: "test-models", SIDECAR_TEST_HOOKS: "1", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  let up = false;
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok && (await r.json()).ready) { up = true; break; } } catch { /* pas prêt */ }
  }
  return { proc, stderr: () => stderr, up };
}

async function killProc(proc) {
  proc.kill();
  await new Promise((res) => {
    let done = false; let timer = null;
    const d = () => { if (!done) { done = true; if (timer) clearTimeout(timer); res(); } };
    proc.once("exit", d); timer = setTimeout(d, 3000);
  });
}

try {
  // ══════════ Run 1 — nominal (le STT scripté charge sur « cuda ») ══════════
  {
    const PORT = 8798;
    const { proc, stderr, up } = await boot(PORT, {});
    const client = new IpcClient();
    try {
      check("run1 : sidecar PRÊT (mode test-models)", up);

      // La résidence du STT (loaded au warm) est reflétée dans /debug — le worker a chargé + reporté.
      let d = await getDebug(PORT);
      // laisser le worker warmer (scripté ≈ instantané, mais le thread démarre juste après le boot)
      for (let i = 0; i < 40 && !(d.audio.stt && d.audio.stt.model_loaded); i++) { await sleep(50); d = await getDebug(PORT); }
      check("run1 : STT résident (audio.stt.model_loaded === true)", d.audio.stt && d.audio.stt.model_loaded === true);
      check("run1 : load_info remonté device=cuda, non dégradé",
        d.audio.stt.load_info && d.audio.stt.load_info.device === "cuda" && d.audio.stt.load_info.degraded === false);
      check("run1 : vram_mb remonté (résidence GPU)", typeof d.audio.stt.load_info.vram_mb === "number");
      check("run1 : model_policy encore nulle (aucune politique reçue)", d.audio.model_policy === null);

      await client.connect(PORT);
      const unloaded = [];
      client.on("evt.model.unloaded", (e) => unloaded.push(e));

      // cmd.model.policy — groupe CONVERSATION, sans calque : enregistrée + device cible cuda.
      const a1 = await client.request("cmd.model.policy", { group: "conversation", layers: { secours: false, jeu: false } });
      check("run1 : cmd.model.policy → evt.ack corrélé", a1.type === "evt.ack" && a1.payload.for === "cmd.model.policy");
      check("run1 : ack group=conversation, target_stt_device=cuda", a1.payload.group === "conversation" && a1.payload.target_stt_device === "cuda");
      d = await getDebug(PORT);
      check("run1 : /debug reflète la politique (conversation, sans calque)",
        d.audio.model_policy && d.audio.model_policy.group === "conversation" && d.audio.model_policy.layers.jeu === false);

      // cmd.model.policy — groupe VEILLE + calque JEU : device CIBLE = cpu (le GPU va au jeu, intent doc 05).
      const a2 = await client.request("cmd.model.policy", { group: "veille", layers: { secours: false, jeu: true } });
      check("run1 : JEU → target_stt_device=cpu (intent 05)", a2.payload.target_stt_device === "cpu");
      d = await getDebug(PORT);
      check("run1 : /debug reflète (veille +jeu, cible cpu)",
        d.audio.model_policy.group === "veille" && d.audio.model_policy.layers.jeu === true && d.audio.model_policy.target_stt_device === "cpu");

      // Arrêt propre : le STT annonce sa sortie de résidence (evt.model.unloaded) — le round-trip WS.
      const ack = await client.request("cmd.shutdown", { reason: "e2e-v11" });
      check("run1 : cmd.shutdown → evt.ack corrélé", ack.type === "evt.ack" && ack.payload.for === "cmd.shutdown");
      await sleep(300);
      check("run1 : evt.model.unloaded reçu (emit → bus → WS, reason=stop)",
        unloaded.length >= 1 && unloaded[0].payload.model === "stt" && unloaded[0].payload.reason === "stop");
      check("run1 : STT libéré après shutdown (audio.stt vidé)", Object.keys((await getDebug(PORT)).audio.stt).length === 0);
      client.close();
    } catch (e) {
      console.error("Run1 exception:", e, "\n--- stderr ---\n", stderr().slice(-2000));
      process.exitCode = 1;
    } finally {
      await killProc(proc);
    }
  }

  // ══════════ Run 2 — refus CUDA → repli CPU DÉGRADÉ (le durcissement, en cœur réel) ══════════
  {
    const PORT = 8797;
    const { proc, stderr, up } = await boot(PORT, { SOPHIA_MODELS_FAIL_CUDA: "1" });
    try {
      check("run2 : sidecar PRÊT (fail-cuda)", up);
      let d = await getDebug(PORT);
      for (let i = 0; i < 40 && !(d.audio.stt && d.audio.stt.model_loaded); i++) { await sleep(50); d = await getDebug(PORT); }
      check("run2 : STT résident MALGRÉ le refus CUDA (jamais sourde, jamais de crash)", d.audio.stt && d.audio.stt.model_loaded === true);
      check("run2 : repli CPU rapporté (load_info device=cpu, degraded=true)",
        d.audio.stt.load_info && d.audio.stt.load_info.device === "cpu" && d.audio.stt.load_info.degraded === true);
    } catch (e) {
      console.error("Run2 exception:", e, "\n--- stderr ---\n", stderr().slice(-2000));
      process.exitCode = 1;
    } finally {
      await killProc(proc);
    }
  }
} catch (e) {
  console.error("Exception:", e);
  process.exitCode = 1;
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log("\nE2E-V11 OK : cmd.model.policy (enregistrée + device cible) + evt.model.loaded/unloaded (cœur réel) + repli CPU dégradé");
else console.error(`\nE2E-V11 ÉCHEC : ${failed.length} critère(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
