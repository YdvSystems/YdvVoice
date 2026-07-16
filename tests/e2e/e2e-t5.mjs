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
// s'asserte pas). L'E2E grandira à chaque phase (T6 : arrêt propre -> réveil propre ; T8 : claude -p ; ...).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
function launch(home) {
  const child = spawn(process.execPath, [worker, home], { cwd: root });
  const events = [];
  const waiters = [];
  let exited = false;
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
  const waitFor = (pred, timeout = 15000) => new Promise((resolve) => {
    const found = events.find(pred); if (found) return resolve(found);
    const w = { pred, resolve, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); resolve(null); }, timeout) };
    waiters.push(w);
  });
  return { child, waitFor, events, exited: () => exited };
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

fs.rmSync(base, { recursive: true, force: true });
const failed = results.filter(([, ok]) => !ok);
console.log(`\n--- E2E T5 : ${results.length - failed.length}/${results.length} ---`);
if (failed.length === 0) { console.log("E2E T5 OK : tous les scénarios passent (cœur réel)"); process.exit(0); }
else { console.error(`E2E T5 ÉCHEC : ${failed.length} scénario(s)`); process.exit(1); }
