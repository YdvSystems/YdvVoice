// U-WARM — le cerveau chaud (WarmBrain, V7 morceau B). Prouve la MÉCANIQUE via un FAUX-claude PERSISTANT déterministe
// (tests/fake-claude-persistent.mjs, zéro quota) qui émet le schéma stream-json mesuré (banc 20/b5). Couvre :
//   · tour chaud STREAMÉ (deltas au fil → onDelta ; text accumulé ; ttftMs ; viaCold=false) ;
//   · contexte MULTI-TOURS en mémoire (RETIENS/RAPPELLE) SANS fichier de session (--no-session-persistence) ;
//   · REPLI FROID : mort AVANT tout delta → le froid répond (viaCold=true) + respawn du chaud au tour suivant ;
//   · JAMAIS de double-voix : mort APRÈS ≥1 delta → réponse PARTIELLE (pas de froid) ;
//   · MUET (aucun delta) → firstDeltaTimer → froid ;
//   · hygiène A1 : env SCRUBBÉ (témoin) + provider non-OAuth à l'init → chaud ÉCARTÉ (taint) → dialogue en froid ;
//   · throttle → onThrottle ; échec du chaud ET du froid → phrase de SECOURS (jamais muette) ;
//   · abort (quiesce/arrêt) → réponse partielle VOULUE (pas de froid) ; close() idempotent.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { WarmBrain } = require("../dist/src/orchestrator/resources/warm/index.js");
const { resolvePaths } = require("../dist/src/orchestrator/paths.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeScript = path.join(root, "tests", "fake-claude-persistent.mjs");
const base = path.join(root, ".sophia-home-dev", "warmu");
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });

const results = [];
const check = (n, c) => results.push([n, !!c]);
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 5)); }
  return false;
}
let hn = 0;

function mk(extra = {}) {
  const home = path.join(base, `h${++hn}`);
  const p = resolvePaths(home);
  fs.mkdirSync(p.home, { recursive: true });
  const spawnClaude = (args, opts) => spawn(process.execPath, [fakeScript, ...args], { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
  return new WarmBrain({ paths: p, spawnClaude, cwd: p.home, firstDeltaMs: 500, onLog: () => {}, now: () => 1_000_000, ...extra });
}

// ── 1. Tour chaud STREAMÉ : deltas au fil (onDelta ≥2 sur une réponse longue), text accumulé, viaCold=false, ttftMs posé ──
{
  const brain = mk();
  const deltas = [];
  const r = await brain.ask("dis-moi bonjour et parle-moi un peu de la meteo aujourd hui s il te plait", { onDelta: (c) => deltas.push(c) });
  check("1. chaud : réponse rendue (echo)", typeof r.text === "string" && r.text.startsWith("echo:"));
  check("1. chaud : streaming au fil (≥2 deltas)", deltas.length >= 2);
  check("1. chaud : text = concat des deltas", deltas.join("") === r.text);
  check("1. chaud : viaCold=false, aborted=false", r.viaCold === false && r.aborted === false);
  check("1. chaud : ttftMs renseigné (nombre)", typeof r.ttftMs === "number");
  brain.close();
}

// ── 2. Contexte MULTI-TOURS en mémoire (SANS fichier de session) : RETIENS puis RAPPELLE sur le MÊME process ──
{
  const brain = mk();
  await brain.ask("RETIENS:BANANE42 s'il te plaît");
  const r2 = await brain.ask("RAPPELLE le mot");
  check("2. persistant : le contexte est gardé EN MÉMOIRE d'un tour à l'autre (RAPPELLE)", r2.text === "BANANE42");
  check("2. persistant : le rappel vient du chaud (pas du froid)", r2.viaCold === false);
  brain.close();
}

// ── 3. REPLI FROID : le chaud meurt AVANT tout delta → le froid répond ; puis le chaud RESPAWN au tour suivant ──
{
  const brain = mk();
  const r = await brain.ask("DIEBEFORE raconte-moi une histoire");
  check("3. froid : mort du chaud avant tout delta → REPLI FROID (viaCold=true)", r.viaCold === true);
  check("3. froid : le froid a répondu (echo, jamais muet)", r.isError === false && r.text.startsWith("echo:"));
  const r2 = await brain.ask("et maintenant dis-moi bonjour tranquillement toi"); // le chaud doit respawner
  check("3. respawn : le tour suivant repart sur le CHAUD (viaCold=false)", r2.viaCold === false && r2.text.startsWith("echo:"));
  brain.close();
}

// ── 4. JAMAIS de double-voix : le chaud meurt APRÈS ≥1 delta → réponse PARTIELLE (pas de repli froid) ──
{
  const brain = mk();
  const deltas = [];
  const r = await brain.ask("DIEAFTER commence une phrase", { onDelta: (c) => deltas.push(c) });
  check("4. partiel : mort après ≥1 delta → PAS de froid (viaCold=false)", r.viaCold === false);
  check("4. partiel : l'acquis est rendu (le delta reçu)", deltas.join("") === "Je commence à " && r.text === "Je commence à ");
  brain.close();
}

// ── 5. MUET : le chaud émet l'init mais jamais de delta → firstDeltaTimer → REPLI FROID ──
{
  const brain = mk({ firstDeltaMs: 300 });
  const t0 = Date.now();
  const r = await brain.ask("MUTE reste silencieux");
  check("5. muet : aucun delta → bascule froid dans le délai (viaCold=true)", r.viaCold === true && Date.now() - t0 < 5000);
  check("5. muet : le froid a répondu (echo)", r.isError === false && r.text.startsWith("echo:"));
  brain.close();
}

// ── 6. Hygiène A1 (scrub) : ANTHROPIC_API_KEY + variables provider payant ABSENTES de l'env du child (témoin) ──
{
  const witness = path.join(base, "witness6.json");
  process.env.ANTHROPIC_API_KEY = "sk-ne-doit-JAMAIS-passer";
  process.env.CLAUDE_CODE_USE_BEDROCK = "1";
  process.env.ANTHROPIC_BASE_URL = "http://proxy.metered.example";
  process.env.SOPHIA_FAKE_WARM_WITNESS = witness;
  const brain = mk();
  await brain.ask("bonjour");
  await waitFor(() => fs.existsSync(witness), 3000);
  const saw = JSON.parse(fs.readFileSync(witness, "utf8"));
  check("6. A1 scrub : ANTHROPIC_API_KEY absent de l'env du child chaud", saw.apiKeyPresent === false);
  check("6. A1 scrub : variables de routage provider payant absentes de l'env du child chaud", saw.providerPresent === false);
  brain.close();
  delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_CODE_USE_BEDROCK;
  delete process.env.ANTHROPIC_BASE_URL; delete process.env.SOPHIA_FAKE_WARM_WITNESS;
}

// ── 7. Défense POSITIVE A1 : un provider non-OAuth annoncé à l'init → chaud ÉCARTÉ (taint) → dialogue en froid, jamais
//       une dépense (le froid le refuse aussi → SECOURS). Puis le chaud reste écarté (2e tour toujours en repli). ──
{
  process.env.SOPHIA_FAKE_APIKEYSOURCE = "bedrock"; // le faux annonce une auth non-OAuth au spawn (chaud ET froid)
  const brain = mk();
  const r = await brain.ask("bonjour");
  check("7. A1 : provider non-OAuth → jamais de génération, phrase de SECOURS (isError, viaCold)", r.isError === true && r.viaCold === true);
  check("7. A1 : SECOURS honnête (elle dit qu'elle n'a pas pu, jamais muette)", /pas r[ée]ussi/i.test(r.text));
  const r2 = await brain.ask("et là ?");
  check("7. A1 : le chaud reste ÉCARTÉ au tour suivant (toujours repli, jamais une dépense)", r2.viaCold === true);
  brain.close();
  delete process.env.SOPHIA_FAKE_APIKEYSOURCE;
}

// ── 8. Throttle : rate_limit_event (status≠allowed) → onThrottle (→ détecteur 05 / gouverneur, comme T8) ──
{
  let status = null;
  const brain = mk({ onThrottle: (s) => { status = s; } });
  await brain.ask("THROTTLE puis réponds");
  check("8. throttle : onThrottle appelé avec le status", status === "throttled");
  brain.close();
}

// ── 9. Échec du chaud ET du froid → phrase de SECOURS (jamais un silence) ──
{
  const brain = mk();
  const r = await brain.ask("DIEBEFORE COLDFAIL tout casse");
  check("9. secours : chaud mort + froid en échec → isError=true, viaCold=true", r.isError === true && r.viaCold === true);
  check("9. secours : une phrase est quand même rendue (jamais muette)", typeof r.text === "string" && r.text.length > 0);
  brain.close();
}

// ── 10. Abort (quiesce/arrêt) : un tour muet interrompu par signal → réponse PARTIELLE voulue (aborted), PAS de froid ──
{
  const brain = mk({ firstDeltaMs: 10_000 });
  const ac = new AbortController();
  const pr = brain.ask("MUTE longue attente", { signal: ac.signal });
  await new Promise((r) => setTimeout(r, 120));
  ac.abort();
  const r = await pr;
  check("10. abort : le tour interrompu REND (aborted=true), jamais un hang", r.aborted === true);
  check("10. abort : PAS de repli froid sur un abort volontaire (viaCold=false)", r.viaCold === false);
  brain.close();
}

// ── 11. close() (quiesce ⑩) : idempotent ; après close, ask rend immédiatement (stopped), sans spawn ──
{
  const brain = mk();
  await brain.ask("bonjour"); // établit le chaud
  brain.close();
  brain.close(); // idempotent (ne jette pas)
  const r = await brain.ask("tu es là ?");
  check("11. close : après l'arrêt, ask rend tout de suite (stopped, aborted)", r.aborted === true && r.text === "");
  check("11. close : idempotent (double close sans erreur)", true);
}

// ── 12. prewarm() : allume le chaud d'avance ; le 1er vrai tour est chaud (viaCold=false) ──
{
  const brain = mk();
  await brain.prewarm();
  const r = await brain.ask("bonjour");
  check("12. prewarm : le 1er tour après prewarm est CHAUD (viaCold=false)", r.viaCold === false && r.text.startsWith("echo:"));
  brain.close();
}

// ── 13. F-SOLO-1 (sérialisation) : deux ask CONCURRENTS ne s'entremêlent pas → tous deux se règlent, DANS l'ORDRE (le 2e
//        voit la mémoire posée par le 1er). Sans la sérialisation, le 1er tour serait ORPHELIN (this.turn écrasé) → HANG. ──
{
  const brain = mk();
  const pA = brain.ask("RETIENS:SERIAL1 d'abord s'il te plaît");
  const pB = brain.ask("RAPPELLE ensuite"); // lancé SANS attendre pA
  let timedOut = false;
  const both = await Promise.race([
    Promise.all([pA, pB]),
    new Promise((r) => setTimeout(() => { timedOut = true; r(null); }, 5000)),
  ]);
  check("13. F-SOLO-1 : deux ask concurrents se règlent tous les deux (aucun tour orphelin/hang)", timedOut === false && Array.isArray(both));
  check("13. F-SOLO-1 : sérialisés DANS L'ORDRE (le 2e voit la mémoire posée par le 1er)", Array.isArray(both) && both[1].text === "SERIAL1");
  brain.close();
}

// ── 14. F-SOLO-2 : un result is_error AVEC message ne fait JAMAIS prononcer le message d'erreur (l'acquis vide → froid). ──
{
  const brain = mk();
  const r = await brain.ask("ERRMSG raconte");
  check("14. F-SOLO-2 : le message d'erreur du modèle n'est JAMAIS prononcé (jamais lu à voix haute)", !r.text.includes("SECRETE"));
  check("14. F-SOLO-2 : acquis vide sur is_error → bascule froid, une réponse est rendue", r.viaCold === true && r.text.length > 0);
  brain.close();
}

// ── 15. F-SOLO-3 : close() TUE un repli FROID en vol (process séparé) → résout VITE, jamais un claude orphelin ni un hang
//        de 5 s. Sans le fix, close() ne toucherait pas le froid → on attendrait la fin des 5 s. ──
{
  const brain = mk();
  const t0 = Date.now();
  const p = brain.ask("DIEBEFORE COLDSLOW attends"); // le chaud meurt → repli froid LENT (5 s)
  await new Promise((r) => setTimeout(r, 400));       // laisse le froid démarrer
  brain.close();                                       // doit TUER le froid en vol
  const r = await p;
  check("15. F-SOLO-3 : close() tue le repli froid en vol (résout en <3 s, pas d'attente des 5 s)", Date.now() - t0 < 3000);
  check("15. F-SOLO-3 : une réponse est quand même rendue (jamais un hang)", typeof r.text === "string");
}

// ── 16. MAJEUR-R1 (appartenance) : abort d'un tour (tue le process A) PUIS un nouvel ask (spawn B) → l'exit TARDIF de A
//        ne doit PAS régler le tour de B. Sans la garde `this.proc === child`, l'exit de A force le tour de B au FROID
//        (alors qu'un chaud B était prêt) — événement d'un process périmé qui fuit dans le tour courant. ──
{
  const brain = mk({ firstDeltaMs: 10_000 });
  const ac = new AbortController();
  let n = 0;
  const p1 = brain.ask("LONGSTREAM raconte longuement s'il te plait", { signal: ac.signal, onDelta: () => { n++; } });
  await waitFor(() => n >= 1, 3000); // le tour A streame (encore vivant)
  ac.abort();                         // tue A
  await p1;
  const r2 = await brain.ask("SLOWSTART deuxieme tour tranquille"); // B spawné, IDLE 300 ms → fenêtre où l'exit de A peut fuir
  check("16. MAJEUR-R1 : après abort+ask, le 2e tour reste CHAUD (l'exit du process tué ne le force pas au froid)", r2.viaCold === false);
  check("16. MAJEUR-R1 : le 2e tour rend SA réponse (non tronquée par l'événement périmé)", r2.text === "echo:SLOWSTART deuxieme tour tranquille");
  brain.close();
}

// ── 17. F1 (fidélité VERROUILLÉE) : la recette NU est dans les FLAGS de spawn — un test doit MORDRE si une régression
//        repasse en mode agent (--append-system-prompt) ou retire --tools "" (la raison d'être de V7-B : TTFT/2 à froid). ──
{
  const witness = path.join(base, "witness17.json");
  process.env.SOPHIA_FAKE_WARM_WITNESS = witness;
  const brain = mk();
  await brain.ask("bonjour"); // spawn chaud → le faux écrit son argv dans le témoin
  await waitFor(() => fs.existsSync(witness), 3000);
  const a = " " + JSON.parse(fs.readFileSync(witness, "utf8")).argv.join(" ") + " ";
  check("17. recette : --system-prompt (REMPLACE) et JAMAIS --append-system-prompt (mode agent)", a.includes(" --system-prompt ") && !a.includes("--append-system-prompt"));
  check("17. recette : --strict-mcp-config + --tools \"\" (0 MCP / 0 outil pour le dialogue)", a.includes(" --strict-mcp-config ") && a.includes(" --tools  "));
  check("17. recette : --input-format stream-json (persistant) + --include-partial-messages (streaming)", a.includes(" --input-format stream-json ") && a.includes(" --include-partial-messages "));
  check("17. recette : --no-session-persistence (aucun verbatim disque)", a.includes(" --no-session-persistence "));
  brain.close();
  delete process.env.SOPHIA_FAKE_WARM_WITNESS;
}

// ── 18. F2 (filet voix) : un `result` SANS aucun delta doit QUAND MÊME passer par onDelta → aucun tour jamais muet côté
//        voix (le routeur ne consomme QUE onDelta ; AskResult.text = le record). ──
{
  const brain = mk();
  const deltas = [];
  const r = await brain.ask("NODELTA reponds direct", { onDelta: (c) => deltas.push(c) });
  check("18. F2 : filet (result sans delta) → le texte passe QUAND MÊME par onDelta (jamais muet)", deltas.join("") === "reponse directe sans delta");
  check("18. F2 : chaud (pas de repli), text = le record complet", r.viaCold === false && r.text === "reponse directe sans delta");
  brain.close();
}

// ── 19. F4 (cohérence de contrat) : un repli FROID interrompu (signal) rend aborted=true, PAS une phrase de SECOURS
//        (isError). Impactera V8 (barge-in) : elle doit s'arrêter, pas dire « désolée je n'ai pas réussi ». ──
{
  const brain = mk();
  const ac = new AbortController();
  const p = brain.ask("DIEBEFORE COLDSLOW attends", { signal: ac.signal }); // chaud meurt → froid LENT (5 s)
  await new Promise((r) => setTimeout(r, 400));
  ac.abort();                                                                 // interrompt le froid en vol
  const r = await p;
  check("19. F4 : un repli froid interrompu rend aborted=true (jamais SECOURS/isError)", r.aborted === true && r.isError === false);
  brain.close();
}

// ── 20. F3 (respawn EAGER, VERROUILLÉ) : après un repli froid, le chaud est rallumé DANS `done()` (fidélité banc `_cold`) —
//        pas paresseusement au tour suivant. Observable : `spawns===2` (A qui meurt + B rallumé) AVANT tout ask suivant.
//        MORD : sans le respawn eager (ligne `ensureSpawned()` de `done()`), spawns resterait à 1 ici. ──
{
  const brain = mk();
  const r = await brain.ask("DIEBEFORE raconte une histoire"); // chaud A (spawn 1) meurt → froid → F3 rallume B (spawn 2)
  check("20. F3 : repli froid → chaud rallumé EAGER (spawns===2 AVANT le tour suivant)", brain.spawns === 2 && r.viaCold === true);
  brain.close();
}

// ── 21. F2 côté FROID : un repli froid rendant un `result` SANS aucun delta passe QUAND MÊME par onDelta (filet voix).
//        MORD : sans le filet froid (`if (ttft === null) … onDelta(text2)`), `deltas` resterait vide. ──
{
  const brain = mk();
  const deltas = [];
  const r = await brain.ask("DIEBEFORE COLDNODELTA reponds", { onDelta: (c) => deltas.push(c) });
  check("21. F2 froid : repli froid result-sans-delta → texte poussé via onDelta (jamais muet)", deltas.join("") === "cold direct sans delta");
  check("21. F2 froid : c'est bien le repli froid (viaCold) qui a répondu", r.viaCold === true && r.text === "cold direct sans delta");
  brain.close();
}

fs.rmSync(base, { recursive: true, force: true });
for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-WARM OK : le cerveau chaud (WarmBrain, V7-B) est prouvé"); process.exit(0); }
else { console.error(`\nU-WARM ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
