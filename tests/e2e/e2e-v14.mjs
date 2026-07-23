// E2E-V14 — le CAPTEUR/VERROU D'AFFECT dans le VRAI sidecar (cœur reel, source WAV, sans micro, sans injection
// de moteur). Deux runs :
//   RUN 1 (la voix de YOHANN — raw_far held-out, decoupee a une vraie frontiere de silence par le helper) :
//     WAV -> AEC -> ring -> VAD (VRAI Silero) -> STT (VRAI faster-whisper) + fin de tour (VRAI Smart Turn)
//     + speaker-ID (VRAI ECAPA -> verdicts « yohann ») + AFFECT (VRAI w2v2-dim ONNX) ; cmd.listen.start arme
//     la conversation -> evt.turn.end -> le verrou S'OUVRE -> evt.affect {valence, energie, confiance} emis
//     -> bus -> WS. + barriere « leger » (jitter : vad.resyncs == 0 — l'affect ne distance pas V0-V13).
//   RUN 2 (contre-preuve MUETTE — la voix A20 de Sophia) : memes moteurs, verdicts « inconnu » (< 0,22)
//     -> verrou FERME -> AUCUN evt.affect malgre les turn.end (lock_denied > 0 au /debug).
// Le payload est STRUCTUREL : cles exactes du gravé, valeurs numeriques seules (jamais d'etiquette).
// Skip proprement si les assets gitignores (ancre / ECAPA / modele affect / a20) sont absents (CF2).
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const require = createRequire(import.meta.url);
const { IpcClient } = require("../../dist/src/orchestrator/ipc/index.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");
const PORT = 8803;
const ANCHOR_FAR = path.join(root, "resources", "models", "voice-anchor", "raw_far.wav");
const ECAPA = path.join(root, "resources", "models", "speaker", "embedding_model.ckpt");
const AFFECT = path.join(root, "resources", "models", "affect", "model.onnx");
const A20_DIR = path.join(root, "sidecar", "tests", "assets", "a20");

for (const [p, why] of [[ANCHOR_FAR, "ancre de Yohann"], [ECAPA, "modele ECAPA"], [AFFECT, "modele affect w2v2-dim"]]) {
  if (!fs.existsSync(p)) {
    console.log(`SKIP  E2E-V14 : ${path.relative(root, p)} absent (${why} — CF2, gitignore).`);
    process.exit(0);
  }
}
const a20s = fs.existsSync(A20_DIR) ? fs.readdirSync(A20_DIR).filter((f) => f.endsWith(".wav")).sort() : [];
if (a20s.length === 0) {
  console.log("SKIP  E2E-V14 : clips A20 absents (sidecar/tests/assets/a20 — CF2, gitignore).");
  process.exit(0);
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const getDebug = async () => await (await fetch(`http://127.0.0.1:${PORT}/debug`)).json();

// ── helper : extraire la fenetre la plus DENSE de sa voix (>= 6 s de parole CONTINUE, sans creux qui
//    hacherait le VAD en segments < 0,75 s — le verdict V6 exige 0,75 s de parole ACCUMULEE par segment,
//    et l'affect exige un tour >= 2 s). La coupe finit a la premiere vraie pause apres la fenetre dense
//    -> Smart Turn confiant -> le tour se FERME dans le silence de boucle (0,5 + 1,6 s).
const yohannWav = path.join(os.tmpdir(), "e2e_v14_yohann_phrase.wav");
const cut = spawnSync(PY, ["-c", `
import sys, wave
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
w = wave.open(src, 'rb'); sr = w.getframerate(); y = np.frombuffer(w.readframes(w.getnframes()), np.int16); w.close()
assert sr == 16000
win = int(0.1 * sr)                                   # RMS par 100 ms
rms = np.array([np.sqrt(np.mean((y[i:i+win].astype(np.float64))**2)) for i in range(0, len(y)-win, win)])
gate = max(float(np.percentile(rms, 30)) * 1.2, 200.0)   # sous ce niveau = creux
W = 60                                                # fenetre de 6 s (60 x 100 ms)
best_i, best_score = 0, -1.0
for i in range(0, len(rms) - W):
    score = float(np.percentile(rms[i:i+W], 10))      # la fenetre dont MEME les creux restent hauts
    if score > best_score:
        best_i, best_score = i, score
start = best_i * win
end_idx = best_i + W
for j in range(best_i + W, min(len(rms) - 3, best_i + W + 20)):   # jusqu'a +2 s : couper a une vraie pause
    if all(r < gate for r in rms[j:j+3]):
        end_idx = j
        break
seg = y[start:end_idx * win]
o = wave.open(dst, 'wb'); o.setnchannels(1); o.setsampwidth(2); o.setframerate(sr)
o.writeframes(seg.tobytes()); o.close()
print(f"fenetre dense {len(seg)/sr:.1f}s (p10 RMS {best_score:.0f})")
`, ANCHOR_FAR, yohannWav], { encoding: "utf-8" });
check(`helper : fenetre dense de Yohann extraite (${(cut.stdout || "").trim()})`,
  cut.status === 0 && fs.existsSync(yohannWav));

/** Un run complet : spawn sidecar test-affect sur `wav`, arme la conversation, collecte evt.affect. */
async function run(wav, { expectAffect }) {
  const proc = spawn(PY, ["sidecar/server.py", String(PORT)], {
    cwd: root,
    env: {
      ...process.env, SIDECAR_AUDIO: "test-affect", SOPHIA_STT_WAV: wav,
      SOPHIA_AFFECT_CONF_MIN: "0",   // le SEUIL est une calibration §6 (prouvee en pytest) ; ici = le PIPELINE
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  const client = new IpcClient();
  const affects = [];
  const turns = [];
  try {
    let up = false;
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok && (await r.json()).ready) { up = true; break; } } catch { /* pas pret */ }
    }
    check("sidecar PRET", up);
    await client.connect(PORT);
    client.on("evt.affect", (e) => { affects.push(e); });
    client.on("evt.turn.end", (e) => { turns.push(e); });
    // armer la CONVERSATION (V9) : les groupes deviennent des tours -> evt.turn.end (le declencheur V14)
    const ack = await client.request("cmd.listen.start", {});
    check("cmd.listen.start acquitte (conversation armee)", ack.type === "evt.ack" && ack.payload.ok === true);

    // attendre : les moteurs chargent (STT ~7-15 s + centroide ECAPA ~4 s + w2v2 ~1 s), puis la source boucle.
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      if (expectAffect && affects.length >= 1) break;
      if (!expectAffect && turns.length >= 2) break;   // contre-preuve : 2 tours finis SANS affect suffisent
      await sleep(300);
    }
    const d = await getDebug();
    return { affects, turns, debug: d, stderr };
  } finally {
    try { client.close(); } catch { /* deja ferme */ }
    proc.kill();
    await new Promise((res) => {
      let done = false; let timer = null;
      const f = () => { if (!done) { done = true; if (timer) clearTimeout(timer); res(); } };
      proc.once("exit", f); timer = setTimeout(f, 3000);
    });
    // attendre la LIBERATION REELLE du port : un run-1 zombie qui repond encore a /health ferait croire au
    // run 2 que « son » sidecar est pret (le spawn 2 sortirait en TOCTOU exit 3) -> cmd.listen.start timeout.
    for (let i = 0; i < 40; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(400) }); await sleep(250); }
      catch { break; }   // plus de reponse = port libre
    }
    await sleep(300);
  }
}

try {
  // ═══ RUN 1 — SA voix : le verrou s'ouvre, l'affect parle ═══
  const r1 = await run(yohannWav, { expectAffect: true });
  check("audio.affect monte (V14 present au /debug)", r1.debug.audio.affect && typeof r1.debug.audio.affect.turns_seen === "number");
  check(`evt.turn.end recus (${r1.turns.length})`, r1.turns.length >= 1);
  check(`evt.affect recu SANS injection de moteur (${r1.affects.length})`, r1.affects.length >= 1);
  if (r1.affects.length) {
    const p = r1.affects[0].payload;
    check("payload = les cles EXACTES du gravé (valence, energie, confiance, mark, captured_at, speech_ms)",
      JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["captured_at", "confiance", "energie", "mark", "speech_ms", "valence"]));
    check("payload NUMERIQUE seul (jamais d'etiquette)", Object.values(p).every((v) => typeof v === "number"));
    check(`valence/energie/confiance dans [0,1] (${p.valence}/${p.energie}/${p.confiance})`,
      p.valence >= 0 && p.valence <= 1 && p.energie >= 0 && p.energie <= 1 && p.confiance >= 0 && p.confiance <= 1);
    const t = r1.turns.find((x) => x.payload.mark === p.mark);
    check("evt.affect ATTACHE a un tour (meme mark qu'un evt.turn.end)", !!t);
  }
  check("affect.emits >= 1 + engine_errors == 0 (le vrai w2v2 s'integre sans crash)",
    r1.debug.audio.affect.emits >= 1 && r1.debug.audio.affect.engine_errors === 0);
  check("speaker.emits >= 1 (les verdicts du verrou ont nourri la decision)", r1.debug.audio.speaker.emits >= 1);
  // barriere « leger » (parite V5/V6) : l'eval affect (~1,4 s en fond, intra_op=2) ne distance PAS l'audio.
  check("audio.vad.resyncs === 0 (l'affect ne jitter pas le VAD)", r1.debug.audio.vad.resyncs === 0);
  check("audio.stt.overruns === 0 (l'affect ne distance pas le STT)", r1.debug.audio.stt.overruns === 0);
  check("affect.warm_failed === false + tick_errors === 0", r1.debug.audio.affect.warm_failed === false && r1.debug.audio.affect.tick_errors === 0);

  // ═══ RUN 2 — la voix A20 de Sophia : verrou FERME, l'affect se TAIT ═══
  const a20wav = path.join(A20_DIR, a20s[0]);
  const r2 = await run(a20wav, { expectAffect: false });
  check(`contre-preuve : evt.turn.end recus (${r2.turns.length} >= 1, la chaine tourne)`, r2.turns.length >= 1);
  check(`contre-preuve : AUCUN evt.affect sur une voix ≠ Yohann (${r2.affects.length})`, r2.affects.length === 0);
  check(`contre-preuve : lock_denied > 0 au /debug (${r2.debug.audio.affect.lock_denied}) — le verrou a REFUSE`,
    r2.debug.audio.affect.lock_denied >= 1);
  check("contre-preuve : emits === 0 (jamais une lecture d'un tiers)", r2.debug.audio.affect.emits === 0);
} catch (e) {
  console.error("Exception:", e);
  process.exitCode = 1;
} finally {
  try { fs.unlinkSync(yohannWav); } catch { /* déjà absent */ }
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log("\nE2E-V14 OK : l'affect lit la voix de Yohann (verrou V6 ouvert) et se TAIT sur toute autre voix — cœur reel, sans injection");
else console.error(`\nE2E-V14 ECHEC : ${failed.length} critere(s)`);
if (process.exitCode !== 1) process.exitCode = failed.length === 0 ? 0 : 1;
