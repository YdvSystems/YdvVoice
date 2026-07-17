// tests/e2e/e2e-t5.mjs — E2E « cœur réel » de T5 (boot & récupération).
//
// Lance de VRAIS process Sophia (boot-worker + VRAI sidecar Python), observe par surfaces déterministes
// (stdout JSON, /health du sidecar, état sur disque) et exerce les coupures RÉELLES (SIGKILL de process,
// sidecar tué pour de bon) que I-T5 ne peut que simuler avec des bouchons. Ce qu'il prouve en plus :
//   · le VRAI sidecar spawné par le superviseur répond ;
//   · une coupure dure réelle -> réveil « sale » + l'orphelin est réellement récupéré au reboot ;
//   · le VRAI sidecar respawne après avoir été tué ;
//   · l'instance unique tient entre deux VRAIS process (named pipe OS).
//
// Suite SÉPARÉE (npm run e2e) : dépend du venv Python (.venv-sidecar), donc HORS de `npm test` (portable).
// Frontière : couvre le socle/orchestration ; le pipeline VOCAL reste les bancs + l'oreille (l'audio ne
// s'asserte pas). L'E2E grandit à chaque phase : T5 (boot/récup) + T6 (arrêt propre -> réveil propre) +
// T7 (gouverneur en cœur réel : boucle d'arbitrage + quiesce ⑩ + rattrapage au curseur) +
// T8 (canal Claude : --resume recharge le fil en VRAI claude -p — E2E-7, GATÉ SOPHIA_E2E_CLAUDE=1, coûte du quota Max).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const worker = path.join(root, "tests", "e2e", "boot-worker.mjs");
const base = path.join(root, ".sophia-home-dev", "e2e");
fs.rmSync(base, { recursive: true, force: true });

const results = [];
const check = (n, c) => { results.push([n, !!c]); console.log(`${c ? "OK  " : "FAIL"}  ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lance un worker. Retourne { child, waitFor(pred, timeout), events, exited() }. Les events du worker
 *  (JSON par ligne) sont collectés en continu ; waitFor résout sur un event futur OU déjà vu. */
function launch(home, extraArgs = []) {
  // stdio + canal IPC (4e descripteur) : le harnais déclenche l'arrêt gracieux (T6) par child.send (SIGTERM
  // ne réveille pas le handler du worker sur Windows — mesuré au banc t6).
  const child = spawn(process.execPath, [worker, home, ...extraArgs], { cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const events = [];
  const waiters = [];
  let exited = false;
  let closed = false;
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      events.push(o);
      for (const w of waiters.slice()) if (w.pred(o)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(o); }
    }
  });
  child.stderr.on("data", () => { /* drain (logs superviseur/boot) */ });
  child.on("exit", () => { exited = true; });
  child.on("close", () => { closed = true; }); // 'close' = tout le stdio drainé (dont le dernier event)
  const waitFor = (pred, timeout = 15000) => new Promise((resolve) => {
    const found = events.find(pred); if (found) return resolve(found);
    const w = { pred, resolve, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); resolve(null); }, timeout) };
    waiters.push(w);
  });
  // T6 — arrêt GRACIEUX : envoie {cmd:"shutdown"} par le canal IPC et attend l'exit (le worker déroule le
  // vrai gracefulShutdown : cmd.shutdown au sidecar -> terminate -> running=0 -> teardown -> exit 0).
  const gracefulStop = (timeout = 12000) => new Promise((resolve) => {
    if (closed) return resolve();
    // Attendre 'close' (stdio EOF), PAS 'exit' : garantit que la dernière ligne stdout (l'ack cmd-shutdown)
    // a été lue AVANT que le check tourne — sinon course/troncature sur une assertion porteuse (MINEUR conv 36).
    child.once("close", () => resolve());
    try { child.send({ cmd: "shutdown" }); } catch { resolve(); }
    setTimeout(resolve, timeout); // filet
  });
  return { child, waitFor, events, exited: () => exited, gracefulStop };
}

/** Lit le drapeau runtime sur disque (base fermée par le worker) — prouve que « propre » est bien posé. */
function readCleanFlag(home) {
  try {
    const db = new DatabaseSync(path.join(home, "db", "sophia.sqlite"), { readOnly: true });
    const row = db.prepare("SELECT running, last_clean_shutdown_at AS lc FROM runtime_flags WHERE id=1").get();
    db.close();
    return row;
  } catch { return null; }
}

/** Le curseur métier durable de la tâche factice E2E-6 (nb d'unités committées) — pour prouver le rattrapage. */
function countFakeWork(home) {
  try {
    const db = new DatabaseSync(path.join(home, "db", "sophia.sqlite"), { readOnly: true });
    const c = db.prepare("SELECT count(*) c FROM e2e_fake_work").get().c;
    db.close();
    return c;
  } catch { return -1; }
}

async function health(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
function stop(child, sig = "SIGTERM") {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    try { child.kill(sig); } catch { resolve(); }
    setTimeout(resolve, 6000);
  });
}

// ── E2E-1 : la cérémonie — HOME vierge -> PRÊT, réveil « premier », .born écrit, VRAI sidecar vivant ──
{
  const home = path.join(base, "h1");
  const w = launch(home);
  const outcome = await w.waitFor((o) => o.evt === "outcome");
  check("E2E-1 : cérémonie -> PRIMARY / PRÊT", outcome && outcome.kind === "PRIMARY" && outcome.phase === "PRET");
  check("E2E-1 : réveil = « premier »", outcome && outcome.wake === "premier");
  check("E2E-1 : le marqueur de naissance .born est écrit", fs.existsSync(path.join(home, ".born")));
  check("E2E-1 : la base de vérité est créée", fs.existsSync(path.join(home, "db", "sophia.sqlite")));
  check("E2E-1 : le VRAI sidecar Python répond sur /health", outcome && outcome.sidecarPort ? await health(outcome.sidecarPort) : false);
  await stop(w.child); // arrêt volontaire
}

// ── E2E-2 : coupure DURE réelle — le sidecar ne FUIT pas, et le reboot se réveille « sale » proprement ──
{
  const home = path.join(base, "h2");
  const w1 = launch(home);
  const o1 = await w1.waitFor((o) => o.evt === "outcome");
  check("E2E-2 : 1er boot PRÊT", o1 && o1.kind === "PRIMARY" && o1.phase === "PRET");
  const sidecarPid = o1 && o1.sidecarPid;
  // Coupure DURE : SIGKILL du worker, sans rien fermer. MESURÉ à l'E2E (finding conv 35) : sur Windows,
  // un enfant Node NON-détaché (le sidecar) est placé dans le JOB OBJECT implicite de son parent (libuv)
  // -> il est tué AVEC le worker. Donc AUCUN orphelin ne fuit : le report m12 (« reaping immédiat ») est
  // assuré PAR LA PLATEFORME ; le reaping T3 au boot (pidfile+jeton) reste le filet pour les résiduels
  // (ex. un orphelin d'une version antérieure). Un Job Object EXPLICITE serait du code natif, non requis. §7.
  w1.child.kill("SIGKILL");
  await sleep(1200);
  check("E2E-2 : coupure dure -> le sidecar NE FUIT PAS (tué avec le worker par le job Windows, m12 plateforme)",
    sidecarPid ? !alive(sidecarPid) : false);

  const w2 = launch(home); // reboot
  const o2 = await w2.waitFor((o) => o.evt === "outcome");
  check("E2E-2 : le reboot atteint PRÊT", o2 && o2.kind === "PRIMARY" && o2.phase === "PRET");
  check("E2E-2 : le réveil est « sale » (coupure détectée, running resté posé)", o2 && o2.wake === "sale");
  check("E2E-2 : elle le DIT (alerte REVEIL_SALE)", w2.events.some((e) => e.evt === "alert" && e.code === "REVEIL_SALE"));
  check("E2E-2 : le nouveau sidecar répond sur /health", o2 && o2.sidecarPort ? await health(o2.sidecarPort) : false);
  await stop(w2.child);
}

// ── E2E-3 : respawn du VRAI sidecar — on le tue pour de bon, le superviseur le fait revenir ──
{
  const home = path.join(base, "h3");
  const w = launch(home);
  const o = await w.waitFor((o) => o.evt === "outcome");
  check("E2E-3 : boot PRÊT + sidecar vivant", o && o.kind === "PRIMARY" && o.sidecarPort ? await health(o.sidecarPort) : false);
  const firstPort = o.sidecarPort;
  // Tuer le VRAI sidecar (pas le worker) -> le superviseur doit détecter et respawner (nouveau port).
  try { process.kill(o.sidecarPid, "SIGKILL"); } catch { /* */ }
  const ready2 = await w.waitFor((e) => e.evt === "sidecar-ready" && e.port !== firstPort, 20000);
  check("E2E-3 : le sidecar tué a été RESPAWNÉ (nouveau port annoncé)", ready2 !== null);
  check("E2E-3 : le sidecar respawné répond sur /health", ready2 ? await health(ready2.port) : false);
  await stop(w.child);
}

// ── E2E-4 : instance unique entre deux VRAIS process — la 2e sort (named pipe OS) ──
{
  const home = path.join(base, "h4");
  const w1 = launch(home);
  const o1 = await w1.waitFor((o) => o.evt === "outcome");
  check("E2E-4 : la 1re instance est PRIMARY", o1 && o1.kind === "PRIMARY");
  const w2 = launch(home);
  const o2 = await w2.waitFor((o) => o.evt === "outcome");
  check("E2E-4 : la 2e instance SORT (jamais deux Sophia sur une maison)", o2 && o2.kind === "SECONDARY");
  await stop(w1.child);
}

// ── E2E-5 : ARRÊT PROPRE (T6) — arrêt gracieux réel -> réveil « propre », zéro fausse alarme, zéro orphelin ──
// C'est le VRAI I-6 en cœur réel : un vrai sidecar Python honore cmd.shutdown, le drapeau « propre » est posé
// durablement, et le reboot ne crie PAS faussement « on a été coupés ». (À contraster avec E2E-2 : coupure
// dure -> « sale ».) Ce qu'un bouchon ne peut pas prouver : que le vrai sidecar coopère à l'arrêt.
{
  const home = path.join(base, "h5");
  const w1 = launch(home);
  const o1 = await w1.waitFor((o) => o.evt === "outcome");
  check("E2E-5 : 1er boot PRÊT", o1 && o1.kind === "PRIMARY" && o1.phase === "PRET");
  const sidecarPid = o1 && o1.sidecarPid;
  await w1.gracefulStop(); // arrêt gracieux via message IPC (le worker déroule le vrai gracefulShutdown)
  check("E2E-5 : le VRAI sidecar a honoré cmd.shutdown (evt.ack reçu -> graceful_release a tourné, pas juste le filet SIGTERM)",
    w1.events.some((e) => e.evt === "cmd-shutdown-ack" && e.ok));
  check("E2E-5 : le sidecar est arrêté proprement (aucun orphelin)", sidecarPid ? !alive(sidecarPid) : false);
  const flag = readCleanFlag(home);
  check("E2E-5 : running=0 posé (drapeau « propre ») + last_clean_shutdown_at horodaté",
    flag && flag.running === 0 && typeof flag.lc === "number" && flag.lc > 0);

  const w2 = launch(home); // reboot
  const o2 = await w2.waitFor((o) => o.evt === "outcome");
  check("E2E-5 : le reboot atteint PRÊT", o2 && o2.kind === "PRIMARY" && o2.phase === "PRET");
  check("E2E-5 : le réveil est « propre » (arrêt propre détecté — le vrai I-6)", o2 && o2.wake === "propre");
  check("E2E-5 : AUCUNE fausse alarme REVEIL_SALE", !w2.events.some((e) => e.evt === "alert" && e.code === "REVEIL_SALE"));
  check("E2E-5 : le sidecar du reboot répond sur /health", o2 && o2.sidecarPort ? await health(o2.sidecarPort) : false);
  await w2.gracefulStop();
}

// ── E2E-6 : GOUVERNEUR en cœur réel (T7) — le fond tourne, l'arrêt propre QUIESCE (⑩) → réveil « propre » + rattrapage ──
// Ce qu'un bouchon — et un agent qui LIT le code — ne prouvent pas : que dans un VRAI process, une tâche de fond qui
// tourne est quiescée AVANT writeCleanShutdown (aucune transaction en vol → le drapeau propre se pose vraiment), et que
// le rattrapage repart AU CURSEUR durable à travers un vrai cycle arrêt→réveil.
{
  const home = path.join(base, "h6");
  const w1 = launch(home, ["--governor-fake-task"]);
  const o1 = await w1.waitFor((o) => o.evt === "outcome");
  check("E2E-6 : boot PRÊT (gouverneur câblé, tâche de fond factice)", o1 && o1.kind === "PRIMARY" && o1.phase === "PRET");
  const someUnits = await w1.waitFor((e) => e.evt === "governor-unit" && e.unit >= 2, 15000);
  check("E2E-6 : le gouverneur exécute des unités de fond (boucle d'arbitrage RÉELLE)", someUnits !== null);
  // Arrêt gracieux PENDANT que le fond tourne : le quiesce ⑩ finit l'unité en cours AVANT de poser le drapeau propre.
  await w1.gracefulStop();
  const flag = readCleanFlag(home);
  check("E2E-6 : arrêt propre RÉUSSI malgré le fond actif → running=0 posé (quiesce ⑩ : aucune transaction en vol)",
    flag && flag.running === 0 && typeof flag.lc === "number" && flag.lc > 0);
  const workDone = countFakeWork(home);
  check("E2E-6 : curseur métier durable cohérent (arrêt ENTRE deux unités, aucune écriture partielle)", workDone > 0 && workDone < 30);

  const w2 = launch(home, ["--governor-fake-task"]); // reboot
  const o2 = await w2.waitFor((o) => o.evt === "outcome");
  check("E2E-6 : reboot → réveil « propre » (l'arrêt gouverné n'a pas menti)", o2 && o2.wake === "propre");
  check("E2E-6 : AUCUNE fausse alarme REVEIL_SALE", !w2.events.some((e) => e.evt === "alert" && e.code === "REVEIL_SALE"));
  const resume = await w2.waitFor((e) => e.evt === "governor-unit" && e.unit >= workDone, 15000);
  check("E2E-6 : rattrapage AU CURSEUR (la reprise repart du curseur durable, jamais de zéro)", resume !== null);
  await w2.gracefulStop();
}

// ── E2E-7 : CANAL CLAUDE en cœur réel (T8) — VRAI `claude -p`, --resume recharge le fil (I-8, continuité live) ──
// Ce qu'un faux-claude — et un agent qui LIT le code — ne prouvent PAS : que le VRAI `claude` reprend un fil par
// `--resume <id>` à travers un « crash » (nouvelle instance, id relu de session_state), et qu'une rotation ouvre un
// fil SANS souvenir du précédent. GATÉ (SOPHIA_E2E_CLAUDE=1) : dépense un peu de quota Max + exige l'OAuth connecté
// -> `npm run e2e` reste 31/31 (zéro quota) ; la preuve live se lance délibérément. cwd PROPRE (pas le CLAUDE.md dev,
// qui traiterait un « retiens ceci » comme une injection) + fait bénin unique (le rappel ne peut venir que du fil).
if (process.env.SOPHIA_E2E_CLAUDE === "1") {
  const { ClaudeChannel } = await import("../../dist/src/orchestrator/claude/index.js");
  const { openDatabase } = await import("../../dist/src/orchestrator/db/index.js");
  const { resolvePaths } = await import("../../dist/src/orchestrator/paths.js");
  const home = path.join(base, "h7");
  const cleanCwd = path.join(home, "cwd");
  fs.mkdirSync(cleanCwd, { recursive: true });
  const p = resolvePaths(home);
  const db = openDatabase(p.db);
  // Mot-code DISTINCTIF, pas un nombre nu : un modèle frais « devine » parfois un nombre (non-détermination mesurée au
  // banc conv 38 — l'isolation par session est prouvée, mais un secret numérique rend le test flaky), JAMAIS ce token.
  // Le rappel ne peut donc venir QUE du fil repris (--resume). cwd propre : aucun CLAUDE.md ne pré-charge le mot-code.
  const secret = `TOURNESOL${1000 + (Date.now() % 9000)}`;
  const created = [];
  try {
    const ch1 = new ClaudeChannel({ db: db.raw, paths: p, onLog: () => {} });
    const r1 = await ch1.invoke(`Retiens pour la suite: mon mot-code est ${secret}. Reponds juste: entendu.`,
      { model: "haiku", resume: false, cwd: cleanCwd, timeoutMs: 90000 });
    created.push(r1.sessionId);
    check("E2E-7 : le VRAI claude répond (OAuth Max, sans clé)", r1 && r1.isError === false && !!r1.sessionId);

    const ch2 = new ClaudeChannel({ db: db.raw, paths: p, onLog: () => {} }); // « crash » : nouvelle instance
    check("E2E-7 : après crash, le fil durable est relu de session_state", ch2.sessionId === r1.sessionId);
    const r2 = await ch2.invoke("Quel est mon mot-code? Reponds uniquement le mot-code.",
      { model: "haiku", resume: true, cwd: cleanCwd, timeoutMs: 90000 });
    check("E2E-7 : --resume recharge VRAIMENT le fil (continuité live, I-8)", r2 && r2.text.includes(secret));

    ch2.rotate(); // nouvelle conversation : oublie l'id + purge le fichier du fil
    // Contrat STRUCTUREL du socle (déterministe, à côté de la preuve de contenu) : l'ancien fil est oublié (id null) ET
    // purgé (non reprenable → prochain tour FRAIS par construction, jamais un --resume du fil précédent).
    check("E2E-7 : rotation → l'ancien fil est OUBLIÉ (id null) et PURGÉ (non reprenable)",
      ch2.sessionId === null && ch2.isResumable(r1.sessionId) === false);
    const r3 = await ch2.invoke("Quel est mon mot-code? Si tu l'ignores, reponds seulement: inconnu.",
      { model: "haiku", resume: true, cwd: cleanCwd, timeoutMs: 90000 });
    created.push(r3.sessionId);
    check("E2E-7 : rotation → session FRAÎCHE (nouvel id, aucun souvenir du fil précédent)",
      r3 && r3.sessionId !== r1.sessionId && !r3.text.includes(secret));
  } finally {
    // Nettoyage : purge les fils de test réels créés sous ~/.claude/projects (r1 déjà purgé par rotate, idempotent).
    const chClean = new ClaudeChannel({ db: db.raw, paths: p, onLog: () => {} });
    for (const id of created) chClean.purgeSessionFile(id);
    db.close();
  }
} else {
  console.log("SKIP  E2E-7 (canal Claude cœur réel, T8) — set SOPHIA_E2E_CLAUDE=1 pour la preuve live (quota Max)");
}

fs.rmSync(base, { recursive: true, force: true });
const failed = results.filter(([, ok]) => !ok);
console.log(`\n--- E2E socle (T5+T6+T7${process.env.SOPHIA_E2E_CLAUDE === "1" ? "+T8" : ""}) : ${results.length - failed.length}/${results.length} ---`);
if (failed.length === 0) { console.log("E2E socle OK : tous les scénarios passent (cœur réel)"); process.exit(0); }
else { console.error(`E2E socle ÉCHEC : ${failed.length} scénario(s)`); process.exit(1); }
