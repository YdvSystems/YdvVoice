// U-T8 — le canal Claude Code (unitaire). Prouve la MÉCANIQUE via un FAUX-claude déterministe (tests/fake-claude.mjs,
// zéro quota) qui émet du stream-json conforme au contrat MESURÉ (bancs/claude/CONTRAT-MESURE.md). Couvre :
//   · nouveau fil : invoke ouvre une session, persiste claude_session_id, crée le fichier ;
//   · continuité --resume (le fil est rechargé) + à travers un « crash » (nouveau canal, id relu de la base — I-8) ;
//   · fil TACHÉ (secours_tainted, 05) → non reprenable → session fraîche ;
//   · rotation (a) purge immédiate + purgeSessionFile (primitive pour 02 M8) ;
//   · hygiène A1 : ANTHROPIC_API_KEY scrubbé, jamais --bare ;
//   · garde d'existence du fichier (un --resume d'un fichier absent ERREURE → session fraîche) ;
//   · throttle → onThrottle · timeout (kill) · erreur d'invocation (is_error) · claudeInit PUR · invocations concurrentes.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { ClaudeChannel, claudeInit } = require("../dist/src/orchestrator/claude/index.js");
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const { resolvePaths } = require("../dist/src/orchestrator/paths.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeScript = path.join(root, "tests", "fake-claude.mjs");
const base = path.join(root, ".sophia-home-dev", "t8u");
fs.rmSync(base, { recursive: true, force: true });

const results = [];
const check = (n, c) => results.push([n, !!c]);
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
}
let hn = 0;

function fresh() {
  const home = path.join(base, `h${++hn}`);
  const p = resolvePaths(home);
  fs.mkdirSync(p.home, { recursive: true });
  const db = openDatabase(p.db);
  const projectsDir = path.join(home, "projects");
  process.env.SOPHIA_FAKE_PROJECTS = projectsDir; // le faux-claude y écrit ses fichiers de session
  const spawnClaude = (args, opts) => spawn(process.execPath, [fakeScript, ...args], { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
  const make = (extra = {}) => new ClaudeChannel({ db: db.raw, paths: p, spawnClaude, projectsDir, onLog: () => {}, now: () => 1_000_000, ...extra });
  return { p, db, projectsDir, make };
}
const claudeSessionId = (db) => db.raw.prepare("SELECT claude_session_id FROM session_state WHERE id=1").get().claude_session_id;
const setTainted = (db, v) => db.raw.prepare("UPDATE session_state SET secours_tainted=? WHERE id=1").run(v);

// ── 1. Nouveau fil : invoke ouvre une session fraîche, persiste claude_session_id, crée le fichier ──
{
  const { db, make } = fresh();
  const ch = make();
  const r = await ch.invoke("bonjour");
  check("1. réponse rendue (result)", typeof r.text === "string" && r.text.startsWith("echo:"));
  check("1. isError=false", r.isError === false);
  check("1. session_id est un uuid", /^[0-9a-f-]{36}$/.test(r.sessionId));
  check("1. claude_session_id persisté en base (drapeau technique)", claudeSessionId(db) === r.sessionId);
  check("1. fichier de session créé (reprenable)", ch.isResumable(r.sessionId) === true);
  db.close();
}

// ── 2. Continuité --resume : le fil est rechargé, le mot-code est rappelé, même session_id ──
{
  const { db, make } = fresh();
  const ch = make();
  const r1 = await ch.invoke("RETIENS:BANANE42 s'il te plaît");
  const r2 = await ch.invoke("RAPPELLE le mot", { resume: true });
  check("2. continuité --resume : le mot-code est rappelé", r2.text === "BANANE42");
  check("2. même fil (session_id inchangé sous --resume)", r2.sessionId === r1.sessionId);
  db.close();
}

// ── 3. Crash → --resume recharge le fil (I-8) : un NOUVEAU canal relit l'id durable et reprend ──
{
  const { db, make } = fresh();
  const ch1 = make();
  const r1 = await ch1.invoke("RETIENS:CERISE7 merci");
  const ch2 = make(); // « crash » : nouvelle instance, même base + même projectsDir
  check("3. après crash, le canal relit le fil durable (session_state)", ch2.sessionId === r1.sessionId);
  const r2 = await ch2.invoke("RAPPELLE", { resume: true });
  check("3. --resume recharge le fil à travers un redémarrage (I-8)", r2.text === "CERISE7");
  db.close();
}

// ── 4. Fil TACHÉ (secours_tainted, 05 R5) → non reprenable → session fraîche + filet A13 (02) ──
{
  const { db, make } = fresh();
  const ch = make();
  const r1 = await ch.invoke("RETIENS:FRAISE9");
  setTainted(db, 1);
  check("4. fil taché → isResumable=false (jamais un --resume troué)", ch.isResumable(r1.sessionId) === false);
  const r2 = await ch.invoke("RAPPELLE", { resume: true });
  check("4. fil taché → session FRAÎCHE (nouvel id, aucun rappel)", r2.sessionId !== r1.sessionId && r2.text === "RIEN");
  db.close();
}

// ── 5. Rotation (a) purge immédiate : le fichier du fil précédent part, l'id est remis à null, prochain tour frais ──
{
  const { db, make } = fresh();
  const ch = make();
  const r1 = await ch.invoke("RETIENS:KIWI3");
  const fileBefore = ch.isResumable(r1.sessionId);
  ch.rotate();
  check("5. rotation : le fichier du fil précédent est PURGÉ (reco a)", fileBefore === true && ch.isResumable(r1.sessionId) === false);
  check("5. rotation : claude_session_id remis à null (prochain tour frais)", claudeSessionId(db) === null);
  const r2 = await ch.invoke("RAPPELLE", { resume: true });
  check("5. après rotation : session fraîche, aucun rappel du fil précédent", r2.sessionId !== r1.sessionId && r2.text === "RIEN");
  db.close();
}

// ── 6. purgeSessionFile(id) : primitive SOCLE appelée par 02 M8 (« le fil Claude est invalidé ») ──
{
  const { db, make } = fresh();
  const ch = make();
  const r1 = await ch.invoke("RETIENS:MANGUE1");
  check("6. purgeSessionFile supprime le fichier ciblé", ch.purgeSessionFile(r1.sessionId) === true && ch.isResumable(r1.sessionId) === false);
  check("6. purgeSessionFile d'un id absent → false (rien à purger)", ch.purgeSessionFile("ffffffff-0000-0000-0000-000000000000") === false);
  db.close();
}

// ── 7. Hygiène A1 : ANTHROPIC_API_KEY scrubbé de l'env du child (OAuth Max seulement) ; jamais --bare ──
{
  const { db, make, projectsDir } = fresh();
  process.env.ANTHROPIC_API_KEY = "sk-ne-devrait-JAMAIS-passer";
  const ch = make();
  const r1 = await ch.invoke("RETIENS:POMME5");
  const saw = JSON.parse(fs.readFileSync(path.join(projectsDir, "fake-proj", `${r1.sessionId}.jsonl`), "utf8"));
  check("7. A1 : ANTHROPIC_API_KEY absent de l'env du child (scrub)", saw.apiKeyPresent === false);
  check("7. A1 : invocation réussie sans clé (jamais --bare → pas d'exit 2)", r1.isError === false);
  delete process.env.ANTHROPIC_API_KEY;
  db.close();
}

// ── 8. Garde d'existence : un fichier de session absent → isResumable=false → session fraîche (jamais un --resume qui ERREURE) ──
{
  const { db, make, projectsDir } = fresh();
  const ch = make();
  const r1 = await ch.invoke("RETIENS:RAISIN2");
  fs.rmSync(path.join(projectsDir, "fake-proj", `${r1.sessionId}.jsonl`)); // fichier disparu, base INCHANGÉE
  check("8. fichier absent → isResumable=false (mesuré : --resume d'un fichier absent ERREURE)", ch.isResumable(r1.sessionId) === false);
  const r2 = await ch.invoke("RAPPELLE", { resume: true });
  check("8. fichier absent → session fraîche (jamais un --resume qui échoue)", r2.sessionId !== r1.sessionId && r2.text === "RIEN");
  db.close();
}

// ── 9. Throttle : rate_limit_event → onThrottle (→ governor.notifyThrottle / détecteur 05) ──
{
  const { db, make } = fresh();
  let throttled = null;
  const ch = make({ onThrottle: (info) => { throttled = info.status; } });
  await ch.invoke("THROTTLE maintenant");
  check("9. rate_limit_event → onThrottle appelé avec le status", throttled === "throttled");
  db.close();
}

// ── 10. Timeout : une invocation FIGÉE (HANG) est tuée dans le délai → REJETTE + onError(timeout) ──
{
  const { db, make } = fresh();
  let errKind = null;
  const ch = make({ onError: (e) => { errKind = e.kind; } });
  let rejected = false;
  const t0 = Date.now();
  try { await ch.invoke("HANG longtemps", { timeoutMs: 300 }); } catch { rejected = true; }
  check("10. timeout : une invocation figée REJETTE (jamais un hang)", rejected === true && Date.now() - t0 < 3000);
  check("10. timeout : onError(kind=timeout) remonté", errKind === "timeout");
  db.close();
}

// ── 11. Erreur d'invocation (is_error) : RÉSOUT avec isError=true (tour fini en erreur, ≠ crash) + onError(invocation) ──
{
  const { db, make } = fresh();
  let errKind = null;
  const ch = make({ onError: (e) => { errKind = e.kind; } });
  const r = await ch.invoke("ERROR volontaire");
  check("11. erreur d'invocation : RÉSOUT avec isError=true", r.isError === true);
  check("11. erreur d'invocation : onError(kind=invocation) remonté", errKind === "invocation");
  check("11. erreur applicative : le fil existe et est REPRENABLE (persisté + fichier présent, F5)", claudeSessionId(db) === r.sessionId && ch.isResumable(r.sessionId) === true);
  db.close();
}

// ── 12. claudeInit (hook boot Phase 4) : LECTURE PURE, aucun spawn — sonde la reprenabilité ──
{
  const { db, make, projectsDir } = fresh();
  check("12. claudeInit : aucun fil → {hasThread:false, resumable:false}",
    JSON.stringify(claudeInit(db.raw, projectsDir)) === JSON.stringify({ hasThread: false, resumable: false }));
  const ch = make();
  await ch.invoke("RETIENS:PECHE8");
  const rep = claudeInit(db.raw, projectsDir);
  check("12. claudeInit : fil sain → reprenable", rep.hasThread === true && rep.resumable === true);
  setTainted(db, 1);
  const rep2 = claudeInit(db.raw, projectsDir);
  check("12. claudeInit : fil taché → non reprenable", rep2.hasThread === true && rep2.resumable === false);
  db.close();
}

// ── 13. AF-7 : conversation (durable) ‖ invocation AUTONOME (éphémère) concurrentes → l'autonome n'écrase PAS le fil ──
{
  const { db, make } = fresh();
  const ch = make();
  const conv = await ch.invoke("RETIENS:AVOCAT4"); // fil de conversation DURABLE (défaut)
  check("13. conversation : claude_session_id = le fil de conversation", claudeSessionId(db) === conv.sessionId);
  // EN MÊME TEMPS : la conversation reprend SON fil ‖ une invocation autonome (micro/deep/rêverie) ouvre un fil éphémère
  const [back, auto] = await Promise.all([
    ch.invoke("RAPPELLE", { resume: true }),
    ch.invoke("tâche autonome de fond", { durable: false }),
  ]);
  check("13. concurrence : les deux invocations se terminent", back.isError === false && auto.isError === false);
  check("13. AF-7 : conversation ‖ autonome → fils DISTINCTS", back.sessionId !== auto.sessionId);
  check("13. AF-7 : la conversation garde son fil (rappel intact malgré l'autonome concurrent)", back.text === "AVOCAT4" && back.sessionId === conv.sessionId);
  check("13. AF-7 : l'invocation autonome n'écrase PAS claude_session_id (le fil de conversation survit)", claudeSessionId(db) === conv.sessionId);
  db.close();
}

// ── 14. M1 (croisé conv 38) : A1 « jamais de dépense nouvelle » — scrub des variables provider + détection apiKeySource ──
{
  const { db, make, projectsDir } = fresh();
  // M1a : des variables de routage provider PAYANT dans l'env parent → SCRUBBÉES (jamais héritées par le child)
  process.env.CLAUDE_CODE_USE_BEDROCK = "1";
  process.env.ANTHROPIC_BASE_URL = "http://proxy.metered.example";
  const ch = make();
  const r1 = await ch.invoke("RETIENS:PROVX");
  const saw = JSON.parse(fs.readFileSync(path.join(projectsDir, "fake-proj", `${r1.sessionId}.jsonl`), "utf8"));
  check("14. M1a : les variables de routage provider payant sont SCRUBBÉES de l'env du child", saw.providerPresent === false);
  delete process.env.CLAUDE_CODE_USE_BEDROCK; delete process.env.ANTHROPIC_BASE_URL;
  // M1b : un init qui annonce un provider NON-OAuth (apiKeySource ≠ "none") → tour ABANDONNÉ avant génération
  let errKind = null;
  const ch2 = make({ onError: (e) => { errKind = e.kind; } });
  let rejected = false;
  try { await ch2.invoke("A1VIOLATION"); } catch { rejected = true; }
  check("14. M1b : provider non-OAuth détecté à l'init → tour ABANDONNÉ (reject, jamais de dépense)", rejected === true);
  check("14. M1b : onError(kind=a1) remonté", errKind === "a1");
  check("14. M1b : le fil abandonné n'est PAS devenu courant (claude_session_id inchangé)", claudeSessionId(db) === r1.sessionId);
  db.close();
}

// ── 15. m2 (croisé conv 38) : rotation PENDANT un tour frais durable → le tour ne ressuscite pas le fil (course fermée) ──
{
  const { db, make } = fresh();
  const ch = make();
  let rotatedDuring = false;
  const r = await ch.invoke("RETIENS:PERIME", { onDelta: () => { if (!rotatedDuring) { rotatedDuring = true; ch.rotate(); } } });
  check("15. m2 : la rotation a bien eu lieu PENDANT le tour (au 1er delta)", rotatedDuring === true);
  check("15. m2 : le tour frais dont la génération a changé N'écrase PAS claude_session_id (reste null après rotate)", claudeSessionId(db) === null);
  check("15. m2 : le fichier du fil périmé est purgé (aucun résidu, aucune résurrection)", ch.isResumable(r.sessionId) === false);
  db.close();
}

// ── 16. m4 (croisé conv 38) : un --resume qui erreure (fil disparu APRÈS le check, TOCTOU) → reprise fraîche même-tour ──
{
  const { db, make } = fresh();
  const ch = make();
  const r1 = await ch.invoke("RETIENS:TOCTOU9"); // établit un fil durable
  const r2 = await ch.invoke("RESUMEFAIL RAPPELLE", { resume: true }); // le fil « disparaît » → --resume erreure
  check("16. m4 : un --resume qui erreure est RATTRAPÉ en session fraîche même-tour (le tour ne rend pas d'échec)", r2.isError === false);
  check("16. m4 : la reprise a ouvert un fil FRAIS (nouvel id, pas le fil disparu)", r2.sessionId !== r1.sessionId);
  db.close();
}

// ── 17. m5/N1 (croisé conv 38) : stopChannel TUE une invocation EN VOL, classée « abort » (jamais « crash ») ──
{
  const { db, make } = fresh();
  let errKind = null;
  const ch = make({ onError: (e) => { errKind = e.kind; } });
  let rejected = false;
  const p = ch.invoke("HANG longtemps", { timeoutMs: 60_000 }).catch(() => { rejected = true; });
  await new Promise((r) => setTimeout(r, 250)); // laisser le child démarrer + s'enregistrer dans `active`
  ch.stopChannel();
  await p;
  check("17. m5 : stopChannel TUE une invocation en vol (le child ne fuit pas à l'arrêt)", rejected === true);
  check("17. N1 : un tour tué par stopChannel est classé « abort » (jamais « crash »/no-result → pas de faux signal 05)", errKind === "abort");
  db.close();
}

// ── 18. F1/F2 (re-croisé conv 38) : un tour frais DURABLE dont le FICHIER de verbatim existe déjà (sans init vu) et
//        qui est TUÉ → le fichier est PURGÉ (aucun orphelin) + jamais persisté. NON-VACUE : on attend que le fichier
//        EXISTE avant de tuer — sans le fix (purge gardée sur seenInit / cantonnée à close), le fichier resterait orphelin. ──
{
  const { db, make, projectsDir } = fresh();
  let errKind = null;
  const ch = make({ onError: (e) => { errKind = e.kind; } });
  const fakeProj = path.join(projectsDir, "fake-proj");
  const jsonl = () => (fs.existsSync(fakeProj) ? fs.readdirSync(fakeProj).filter((f) => f.endsWith(".jsonl")) : []);
  let rejected = false;
  const p = ch.invoke("ORPHAN frais durable", { timeoutMs: 60_000 }).catch(() => { rejected = true; });
  const created = await waitFor(() => jsonl().length > 0, 3000); // le faux-claude a créé son fichier AVANT tout init
  check("18. F1 : préparation — le fil frais a bien créé son fichier de verbatim (sans init émis)", created === true);
  ch.stopChannel(); // tue le tour en vol (comme à l'arrêt)
  await p;
  check("18. F1 : le tour tué REJETTE (jamais un hang)", rejected === true);
  check("18. N1 : le tour tué est classé « abort »", errKind === "abort");
  check("18. F1 : claude_session_id JAMAIS persisté (tour tué)", claudeSessionId(db) === null);
  check("18. F1/F2 : le fichier de verbatim du tour tué est PURGÉ (garde seenInit retirée — aucun orphelin)", jsonl().length === 0);
  db.close();
}

// ── 19. ① (audit complet conv 38) : un tour ÉPHÉMÈRE (durable:false) TUÉ → LE CANAL purge son fichier (jumeau du durable ;
//        sur un rejet l'appelant ne reçoit AUCUN sessionId → c'est au canal de nettoyer, F-99-2). NON-VACUE (attend le fichier). ──
{
  const { db, make, projectsDir } = fresh();
  let errKind = null;
  const ch = make({ onError: (e) => { errKind = e.kind; } });
  const fakeProj = path.join(projectsDir, "fake-proj");
  const jsonl = () => (fs.existsSync(fakeProj) ? fs.readdirSync(fakeProj).filter((f) => f.endsWith(".jsonl")) : []);
  let rejected = false;
  const p = ch.invoke("ORPHAN autonome", { durable: false, timeoutMs: 60_000 }).catch(() => { rejected = true; });
  const created = await waitFor(() => jsonl().length > 0, 3000);
  check("19. ① prépa : le tour éphémère a créé son fichier de verbatim", created === true);
  ch.stopChannel();
  await p;
  check("19. ① : le tour éphémère tué REJETTE (classé abort)", rejected === true && errKind === "abort");
  check("19. ① : LE CANAL a purgé le fichier éphémère (aucun orphelin sans recours)", jsonl().length === 0);
  check("19. ① : l'éphémère n'a PAS touché claude_session_id (AF-7)", claudeSessionId(db) === null);
  db.close();
}

// ── 20. ② (audit complet conv 38) : un tour DURABLE ABOUTI (result reçu) puis stoppé au teardown est PRÉSERVÉ (persisté +
//        fichier gardé), jamais JETÉ — même si invoke rejette (abort). Sinon le 1ᵉʳ tour de conversation réussi serait perdu. ──
{
  const { db, make } = fresh();
  let gotText = false;
  const ch = make({ onError: () => {} });
  let rejected = false;
  const p = ch.invoke("DONEWAIT frais durable", { timeoutMs: 60_000, onDelta: () => { gotText = true; } }).catch(() => { rejected = true; });
  await waitFor(() => gotText, 3000); // le tour a ABOUTI (result traité, même write que l'init) mais le process reste vivant
  ch.stopChannel(); // teardown APRÈS la fin du tour
  await p;
  check("20. ② : un tour durable abouti puis stoppé au teardown REJETTE (abort)", rejected === true);
  check("20. ② : le fil abouti est PRÉSERVÉ (persisté, jamais jeté)", claudeSessionId(db) !== null && claudeSessionId(db) === ch.sessionId);
  check("20. ② : le fichier du fil abouti est GARDÉ (reprenable au prochain boot)", ch.isResumable(ch.sessionId) === true);
  db.close();
}

// ── 21. finding a1 (4ᵉ tour audit) : un init NON-OAuth (apiKeySource≠none) + result dans le MÊME flux → le fil a1 est TUÉ
//        (kind=a1) et son fichier PURGÉ, JAMAIS persisté comme claude_session_id (hygiène A1 — fix `killedReason!=="a1"`).
//        NON-VACUE : sans le fix, la persistance durable ignore killedReason → le fil taché serait persisté + repris. ──
{
  const { db, make, projectsDir } = fresh();
  let errKind = null;
  const ch = make({ onError: (e) => { errKind = e.kind; } });
  const fakeProj = path.join(projectsDir, "fake-proj");
  const jsonl = () => (fs.existsSync(fakeProj) ? fs.readdirSync(fakeProj).filter((f) => f.endsWith(".jsonl")) : []);
  // A1RESULT : le faux-claude écrit son fichier PUIS émet init(non-OAuth)+result dans le même flux ; le canal détecte a1
  // à l'init → tue AVANT génération. Le fil a1 ne doit JAMAIS être persisté ni gardé (non-vacue : sans le fix
  // `killedReason !== "a1"`, « persisté » ET « purgé » échouent — le fil taché reste en base ET sur disque).
  let rejected = false;
  await ch.invoke("A1RESULT frais durable", { timeoutMs: 60_000 }).catch(() => { rejected = true; });
  check("21. a1 : le tour NON-OAuth REJETTE (kind=a1, jamais de dépense)", rejected === true && errKind === "a1");
  check("21. a1 : le fil a1 n'est JAMAIS persisté comme claude_session_id (hygiène A1)", claudeSessionId(db) === null);
  check("21. a1 : le fichier du fil a1 (verbatim non-OAuth) est PURGÉ, jamais gardé", jsonl().length === 0);
  db.close();
}

fs.rmSync(base, { recursive: true, force: true });
for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T8 OK : le canal Claude (T8) est prouvé"); process.exit(0); }
else { console.error(`\nU-T8 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
