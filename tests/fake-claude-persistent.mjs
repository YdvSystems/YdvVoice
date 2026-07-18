// tests/fake-claude-persistent.mjs — FAUX `claude` PERSISTANT déterministe (U-WARM, zéro quota).
//
// Le faux-claude existant (fake-claude.mjs) est REQUEST-SCOPED (un tour puis exit). WarmBrain (V7) parle à un process
// PERSISTANT en stream-json. Ce double gère LES DEUX modes du vrai claude :
//   · PERSISTANT (args contiennent `--input-format`) : lit des messages user sur stdin (une ligne JSON par tour),
//     répond en streamant des `text_delta` AU FIL puis un `result`. Contexte gardé EN MÉMOIRE (aucun fichier de session,
//     `--no-session-persistence`) → prouve que le multi-tours marche sans disque (RETIENS/RAPPELLE).
//   · ONE-SHOT (pas de `--input-format`) : prompt = dernier argument, un tour streamé, exit — le REPLI FROID de WarmBrain.
//
// Émet le schéma MESURÉ (banc 20/b5) : system/init (apiKeySource) · stream_event/content_block_delta/text_delta ·
// rate_limit_event · result. A1 : écrit un témoin (apiKeyPresent/providerPresent) → le test prouve le scrub. Simule les
// cas DURS via mots-clés dans le message : DIEBEFORE (mort avant tout delta → froid) · DIEAFTER (mort après 1 delta →
// partiel, jamais de double-voix) · MUTE (init mais jamais de delta → firstDeltaTimer → froid) · THROTTLE · A1 (via env).

import * as fs from "node:fs";
import * as readline from "node:readline";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --verbose OBLIGATOIRE avec --output-format stream-json (contrat mesuré) — le vrai claude exit 1 sinon.
if (has("stream-json") && !has("--verbose")) {
  process.stderr.write("Error: When using --print, --output-format=stream-json requires --verbose\n");
  process.exit(1);
}
if (has("--bare")) { process.stderr.write("fake-claude-persistent: --bare interdit (A1)\n"); process.exit(2); }

// Témoin du scrub A1 (comme fake-claude.mjs) : ces variables NE DOIVENT PAS avoir fui dans l'env du child.
const apiKeyPresent = !!process.env.ANTHROPIC_API_KEY;
const providerPresent = !!(process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX || process.env.ANTHROPIC_BASE_URL);
const witness = process.env.SOPHIA_FAKE_WARM_WITNESS;
if (witness) { try { fs.writeFileSync(witness, JSON.stringify({ apiKeyPresent, providerPresent, argv })); } catch { /* */ } } // argv → le test VERROUILLE la recette nu (F1)

// La source d'auth ANNONCÉE à l'init (déterminée au SPAWN, comme le vrai claude) : "none" = OAuth Max. Le test la force à
// "bedrock" pour prouver la défense A1 (WarmBrain doit ÉCARTER le chaud avant toute génération).
const apiKeySource = process.env.SOPHIA_FAKE_APIKEYSOURCE || "none";

// Mémoire EN-PROCESS du fil (prouve la continuité multi-tours SANS fichier de session).
let mem = "";

/** Découpe une réponse et l'émet en plusieurs `text_delta` espacés (streaming réaliste : le 1er delta bien avant la fin). */
async function streamAnswer(answer) {
  const parts = answer.match(/.{1,24}(\s|$)/g) || [answer];
  for (const p of parts) { emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: p } } }); await sleep(8); }
}

/** Traite UN tour (le `content` du message user, ou le prompt one-shot). `persistent` : les cas de MORT/MUTE ne valent
 *  QU'en persistant (le chaud meurt) — en one-shot (repli FROID) on répond normalement, pour prouver la bascule (sinon
 *  le mot-clé, présent dans le même prompt, tuerait AUSSI le froid). `COLDFAIL` = fait échouer le froid (→ SECOURS). */
async function handleTurn(content, persistent) {
  const c = String(content || "");
  if (persistent && c.includes("DIEBEFORE")) { process.exit(1); }   // mort AVANT tout delta → WarmBrain bascule froid
  if (persistent && c.includes("MUTE")) { return; }                 // init émis, jamais de delta ni result → firstDeltaTimer → froid
  if (persistent && c.includes("DIEAFTER")) {
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Je commence à " } } });
    await sleep(10); process.exit(1);                               // 1 delta PUIS mort → partiel (jamais de double-voix)
  }
  if (persistent && c.includes("ERRMSG")) {                         // result is_error AVEC un message → ne doit JAMAIS être prononcé (F-SOLO-2)
    emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "ERREUR INTERNE SECRETE", ttft_ms: 3 });
    return;
  }
  if (persistent && c.includes("NODELTA")) {                        // result SANS aucun delta (filet) → doit passer par onDelta quand même (F2)
    emit({ type: "result", subtype: "success", is_error: false, result: "reponse directe sans delta", ttft_ms: 5 });
    return;
  }
  if (!persistent && c.includes("COLDFAIL")) { process.exit(1); }   // le froid échoue AUSSI → WarmBrain rend SECOURS
  if (!persistent && c.includes("COLDSLOW")) { await sleep(5000); } // repli froid LENT → close() doit le TUER (F-SOLO-3) sinon on attend 5 s
  if (!persistent && c.includes("COLDNODELTA")) {                   // repli froid : result SANS aucun delta → doit passer par onDelta (filet F2 côté FROID)
    emit({ type: "result", subtype: "success", is_error: false, result: "cold direct sans delta", ttft_ms: 5 });
    return;
  }
  if (persistent && c.includes("LONGSTREAM")) {                     // stream LENT (~750 ms) : le tour est encore VIVANT quand on l'abort (repro MAJEUR-R1)
    for (let i = 0; i < 30; i++) { emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: `mot${i} ` } } }); await sleep(25); }
    emit({ type: "result", subtype: "success", is_error: false, result: "fin longue", ttft_ms: 5 });
    return;
  }
  if (persistent && c.includes("SLOWSTART")) { await sleep(300); } // le tour reçu reste IDLE 300 ms (fenêtre où l'exit d'un process tué peut fuir, repro MAJEUR-R1)
  if (c.includes("THROTTLE")) emit({ type: "rate_limit_event", rate_limit_info: { status: "throttled", rateLimitType: "five_hour" } });

  const mset = c.match(/RETIENS:(\w+)/);
  if (mset) mem = mset[1];
  const answer = c.includes("RAPPELLE") ? (mem || "RIEN") : `echo:${c.slice(0, 40)}`;
  await streamAnswer(answer);
  emit({ type: "assistant", message: { content: [{ type: "text", text: answer }] } }); // bloc complet (WarmBrain l'ignore)
  emit({ type: "result", subtype: "success", is_error: false, result: answer, ttft_ms: 5 });
}

async function main() {
  // init émis UNE fois au spawn (comme le vrai claude : la source d'auth est fixée au démarrage).
  emit({ type: "system", subtype: "init", apiKeySource, session_id: "fake-warm", cwd: process.cwd() });

  if (has("--input-format")) {
    // PERSISTANT : une ligne JSON = un tour user. Sérialise les tours (le routeur en envoie un à la fois).
    const rl = readline.createInterface({ input: process.stdin });
    let chain = Promise.resolve();
    rl.on("line", (line) => {
      const t = line.trim(); if (!t) return;
      let msg; try { msg = JSON.parse(t); } catch { return; }
      const content = msg?.message?.content ?? "";
      chain = chain.then(() => handleTurn(content, true));
    });
    rl.on("close", () => process.exit(0));
    // reste vivant tant que stdin est ouvert
  } else {
    // ONE-SHOT (repli froid) : prompt = dernier argument.
    await handleTurn(argv[argv.length - 1] ?? "", false);
    process.exit(0);
  }
}

main();
