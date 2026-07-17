// tests/fake-claude.mjs — FAUX `claude` déterministe (U-T8, zéro quota).
//
// Émet du stream-json CONFORME AU CONTRAT MESURÉ à la source (bancs/claude/CONTRAT-MESURE.md) : événements
// system/init · assistant (blocs text) · rate_limit_event · result. Interprète les mêmes flags que le vrai
// (`--session-id`/`--resume`/`--verbose`/`--append-system-prompt`/`--model`) + le prompt (dernier argument).
//
// « Mémoire » du fil : le fichier <SOPHIA_FAKE_PROJECTS>/fake-proj/<id>.jsonl stocke une valeur ; « RETIENS:X » la
// pose, « RAPPELLE » la relit (prouve la continuité --resume). Reproduit les comportements DURS mesurés :
//   · --verbose OBLIGATOIRE avec stream-json (sinon exit 1) ;
//   · --resume d'un fil INEXISTANT → is_error + « No conversation found » + exit 1 ;
//   · jamais --bare, et signale si ANTHROPIC_API_KEY a fui dans son env (preuve du scrub A1) ;
//   · « THROTTLE » → rate_limit_event status≠allowed ; « HANG » → ne rend jamais de result (test du timeout).

import * as fs from "node:fs";
import * as path from "node:path";

const argv = process.argv.slice(2);
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const has = (f) => argv.includes(f);
const valAfter = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

// A1 : le vrai canal ne passe JAMAIS --bare. Si présent, échec net (le test le prouve par l'absence d'exit 2).
if (has("--bare")) { process.stderr.write("fake-claude: --bare ne devrait jamais être passé (A1)\n"); process.exit(2); }
const apiKeyPresent = !!process.env.ANTHROPIC_API_KEY; // doit être false (scrub A1) — inscrit dans le fil pour assertion
// M1a : les variables de routage provider PAYANT doivent aussi être scrubbées (jamais héritées) — false attendu.
const providerPresent = !!(process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX || process.env.ANTHROPIC_BASE_URL);

// --verbose OBLIGATOIRE avec --output-format stream-json (mesuré).
if (argv.includes("stream-json") && !has("--verbose")) {
  process.stderr.write("Error: When using --print, --output-format=stream-json requires --verbose\n");
  process.exit(1);
}

const resumeId = valAfter("--resume");
const newId = valAfter("--session-id");
const sessionId = resumeId ?? newId ?? "00000000-0000-0000-0000-000000000000";
const useResume = resumeId !== null;
const prompt = argv[argv.length - 1] ?? "";

const projectsDir = process.env.SOPHIA_FAKE_PROJECTS ?? path.join(process.cwd(), ".fake-projects");
const fakeProj = path.join(projectsDir, "fake-proj");
fs.mkdirSync(fakeProj, { recursive: true });
const sessionFile = path.join(fakeProj, `${sessionId}.jsonl`);

// --resume d'un fil dont le fichier n'existe pas → ERREUR (mesuré : « No conversation found »).
if (useResume && !fs.existsSync(sessionFile)) {
  process.stderr.write(`No conversation found with session ID: ${sessionId}\n`);
  emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "", session_id: sessionId });
  process.exit(1);
}

// Mémoire persistée du fil (ce que la « conversation » a retenu).
let mem = "";
if (fs.existsSync(sessionFile)) {
  try { mem = JSON.parse(fs.readFileSync(sessionFile, "utf8")).mem ?? ""; } catch { /* fichier neuf */ }
}

// M1b : « A1VIOLATION » → simule un provider NON-OAuth (apiKeySource ≠ "none"). Le canal doit ABANDONNER avant toute
// génération → on émet l'init « payant » puis on ATTEND le kill (jamais de result, jamais de dépense).
const apiKeySource = prompt.includes("A1VIOLATION") ? "bedrock" : "none";
// F1/F2 re-croisé conv 38 : « ORPHAN » simule un fichier de session créé AVANT tout `init` (seenInit=false côté canal)
// pour prouver que la purge d'un tour tué n'est plus gardée sur seenInit (le vrai claude crée le fichier ~après l'init).
const suppressInit = prompt.includes("ORPHAN") || prompt.includes("DONEWAIT") || prompt.includes("A1RESULT");
if (!suppressInit) emit({ type: "system", subtype: "init", session_id: sessionId, apiKeySource, cwd: process.cwd() });

/** Réponse normale : mémorise (RETIENS:X), répond (RAPPELLE relit la mémoire), persiste le fil + les témoins de scrub. */
function finishNormal() {
  const m = prompt.match(/RETIENS:(\w+)/);
  if (m) mem = m[1];
  const answer = prompt.includes("RAPPELLE") ? (mem || "RIEN") : `echo:${prompt.slice(0, 40)}`;
  fs.writeFileSync(sessionFile, JSON.stringify({ mem, apiKeyPresent, providerPresent }));
  emit({ type: "assistant", message: { content: [{ type: "text", text: answer }] }, session_id: sessionId });
  emit({ type: "result", subtype: "success", is_error: false, result: answer, session_id: sessionId, ttft_ms: 5 });
}

if (apiKeySource !== "none") {
  setInterval(() => {}, 60_000); // M1b : attend le kill du canal (jamais de result, jamais de dépense)
} else if (prompt.includes("ORPHAN")) {
  // F1/F2 : le fichier de verbatim existe DÉJÀ (comme un fil réel), aucun init n'a été émis, puis on ATTEND le kill.
  // Le canal doit PURGER ce fichier à la fin du tour tué (jamais d'orphelin). Sans le fix : le fichier resterait.
  fs.writeFileSync(sessionFile, JSON.stringify({ mem, apiKeyPresent, providerPresent }));
  setInterval(() => {}, 60_000);
} else if (prompt.includes("DONEWAIT")) {
  // ② audit conv 38 : le tour ABOUTIT (init + fichier + result émis en UN SEUL write → tout traité d'un coup côté canal :
  // seenInit + resultEvt posés) PUIS le process reste VIVANT (hang). Un stopChannel au teardown NE DOIT PAS jeter ce fil
  // abouti (persisté + gardé, jamais purgé). Sans le fix ② : killedReason=abort → purge → le 1er tour de conversation perdu.
  fs.writeFileSync(sessionFile, JSON.stringify({ mem, apiKeyPresent, providerPresent }));
  process.stdout.write(
    JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, apiKeySource, cwd: process.cwd() }) + "\n" +
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "donewait-ok" }] }, session_id: sessionId }) + "\n" +
    JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "donewait-ok", session_id: sessionId, ttft_ms: 5 }) + "\n",
  );
  setInterval(() => {}, 60_000);
} else if (prompt.includes("A1RESULT")) {
  // Finding a1 (4e tour audit) : le child émet init(NON-OAuth, apiKeySource="bedrock") + result dans UN SEUL write → le
  // canal pose seenInit + killedReason="a1" + resultEvt d'un coup. Le fil a1 NE DOIT PAS devenir claude_session_id ni
  // garder son verbatim (le fix `killedReason !== "a1"` → purge). Sans le fix : persist → régression A1 (fil taché repris).
  fs.writeFileSync(sessionFile, JSON.stringify({ mem, apiKeyPresent, providerPresent }));
  process.stdout.write(
    JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, apiKeySource: "bedrock", cwd: process.cwd() }) + "\n" +
    JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "a1-leak", session_id: sessionId, ttft_ms: 5 }) + "\n",
  );
  setInterval(() => {}, 60_000); // attend le kill a1 du canal
} else if (useResume && prompt.includes("RESUMEFAIL")) {
  // m4 : le fil a « disparu » après le check → --resume ERREURE (le canal doit reprendre en session fraîche).
  process.stderr.write(`No conversation found with session ID: ${sessionId}\n`);
  emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "", session_id: sessionId });
  process.exit(1);
} else if (prompt.includes("HANG")) {
  setInterval(() => {}, 60_000); // test du timeout : ne rend JAMAIS de result → le canal tue le child
} else if (prompt.includes("ERROR")) {
  // Erreur d'invocation APPLICATIVE (is_error) — le tour s'est terminé mais en erreur (≠ crash). Le vrai claude conserve
  // le fichier de session (le fil existe, reprenable) → on l'écrit aussi (fidélité F5 audit conv 38).
  fs.writeFileSync(sessionFile, JSON.stringify({ mem, apiKeyPresent, providerPresent }));
  emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "", session_id: sessionId, ttft_ms: 3 });
} else {
  if (prompt.includes("THROTTLE")) {
    emit({ type: "rate_limit_event", rate_limit_info: { status: "throttled", rateLimitType: "five_hour", overageStatus: "rejected" } });
  }
  finishNormal();
}
