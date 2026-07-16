// U-T7 — le gouverneur unique (unitaire). Prouve la MÉCANIQUE complète via un harnais de tâche FACTICE (les vraies —
// consolidation 02, proactif/rêverie 04 — n'existent pas encore ; « pas de MVP, la mécanique est complète »). Couvre :
//   · commitUnit ATOMIQUE (écriture métier + curseur, même transaction, durable FULL) + refus si transaction ouverte (②) ;
//   · reconstructQueue (boot Phase 4) : PROGRAMME les dues, ne LANCE rien ;
//   · transitions : activité injectée → INTERACTIF (fond différé) · REPOS+dû+budget → FOND_EN_COURS · budget → BRIDE ;
//   · préemption PAR UNITÉ : cède APRÈS l'unité en cours (jamais au milieu) + rattrapage AU CURSEUR (owed, jamais à zéro) ;
//   · budget « part de Sophia » : interactif JAMAIS compté ; autonome décrémenté ; épuisé → BRIDE ;
//   · throttle 429 → bride immédiat (le local non-quota continue) ;
//   · calque SECOURS → tâche requires_real_brain DIFFÉRÉE (le local tourne) ;
//   · quiesce ⑩ : aucune transaction en vol après (writeCleanShutdown passerait) + plus de tick.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const { Governor, reconstructQueue } = require("../dist/src/orchestrator/governor/index.js");
const { resolvePaths } = require("../dist/src/orchestrator/paths.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, ".sophia-home-dev", "t7u");
fs.rmSync(base, { recursive: true, force: true });

const results = [];
const check = (n, c) => results.push([n, !!c]);
let hn = 0;
function fresh() {
  const p = resolvePaths(path.join(base, `h${++hn}`));
  fs.mkdirSync(p.home, { recursive: true });
  const db = openDatabase(p.db);
  db.raw.exec("CREATE TABLE IF NOT EXISTS fake_work(id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, unit INTEGER)");
  return { p, db };
}
const countWork = (db, task) => db.raw.prepare("SELECT count(*) c FROM fake_work WHERE task=?").get(task).c;
const wm = (db, task) => db.raw.prepare("SELECT last_run_at,owed,owed_since,requires_real_brain FROM governor_watermarks WHERE task=?").get(task);
const budget = (db) => db.raw.prepare("SELECT count(*) c FROM governor_budget_ledger WHERE origin='autonome'").get().c;

/** Tâche FACTICE : son curseur MÉTIER DÉRIVE de l'état durable (COUNT(fake_work)) → la reprise se fait au curseur, jamais
 *  depuis zéro. `onUnit(cursor, ctx)` = hook pour piloter les scénarios (flipper l'activité, faire échouer une unité...). */
function makeTask(db, opts) {
  const name = opts.task ?? "fake";
  const total = opts.units ?? 1;
  const quota = opts.consumesQuota !== false;
  return {
    task: name,
    priority: opts.priority ?? 0,
    requiresRealBrain: !!opts.requiresRealBrain,
    consumesQuota: quota,
    isDue: opts.isDue ?? (() => countWork(db, name) < total),
    runUnit: async (ctx) => {
      const cursor = countWork(db, name);                 // curseur MÉTIER = nb d'unités déjà faites (durable)
      if (opts.onUnit) await opts.onUnit(cursor, ctx);
      if (opts.throwAt === cursor) throw new Error("unité factice en échec");
      if (quota) ctx.recordAutonomousCall("fake");
      const done = cursor + 1 >= total;
      ctx.commitUnit((d) => d.prepare("INSERT INTO fake_work(task,unit) VALUES(?,?)").run(name, cursor), done);
      return { done };
    },
  };
}
function makeGov(db, p, task, extra = {}) {
  let CLOCK = 1_000_000;
  const ctl = { active: false, clock: () => CLOCK, advance: (ms) => { CLOCK += ms; } };
  const gov = new Governor({
    db: db.raw, paths: p, tasks: task ? [task] : [],
    activityProbe: () => ({ interactive: ctl.active }),
    now: ctl.clock, budgetCap: extra.budgetCap ?? 100, budgetWindowMs: extra.budgetWindowMs ?? 3_600_000,
    debounceMs: extra.debounceMs ?? 0, onLog: () => {},
  });
  return { gov, ctl };
}

// ─── 1. commitUnit ATOMIQUE : écriture métier + curseur avancent ENSEMBLE, durable, isTransaction=false après ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t1", units: 1 });
  const { gov } = makeGov(db, p, task);
  await gov.tick();
  check("1. l'unité s'est exécutée (écriture métier présente)", countWork(db, "t1") === 1);
  check("1. le curseur a avancé DANS LA MÊME transaction (last_run_at posé, owed=0 car done)", wm(db, "t1")?.owed === 0 && wm(db, "t1")?.last_run_at > 0);
  check("1. aucune transaction en vol après l'unité (⑩ : writeCleanShutdown passerait)", db.raw.isTransaction === false);
  db.close();
  // durable : réouverture -> écriture + curseur présents
  const db2 = openDatabase(p.db);
  check("1. durable après réouverture : écriture métier ET curseur", db2.raw.prepare("SELECT count(*) c FROM fake_work").get().c === 1 && db2.raw.prepare("SELECT owed FROM governor_watermarks WHERE task='t1'").get().owed === 0);
  db2.close();
}

// ─── 2. reconstructQueue (boot Phase 4) : PROGRAMME les dues, ne LANCE rien ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t2", units: 2 });
  // owed=1 simulé (un run interrompu au boot précédent)
  db.raw.prepare("INSERT INTO governor_watermarks(task,owed,owed_since,requires_real_brain) VALUES('t2',1,123,0)").run();
  const r = reconstructQueue(db.raw, [task], () => 1_000_000);
  check("2. reconstructQueue PROGRAMME la tâche due (owed=1)", r.scheduled.includes("t2"));
  check("2. reconstructQueue ne LANCE rien (aucune écriture métier)", countWork(db, "t2") === 0);
  db.close();
}

// ─── 3. Priorité interactive absolue : activité → INTERACTIF, le fond n'est PAS lancé ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t3", units: 3 });
  const { gov, ctl } = makeGov(db, p, task);
  ctl.active = true;                       // Yohann (ou Claude Code) actif
  await gov.tick();
  check("3. activité → INTERACTIF", gov.currentState === "INTERACTIF");
  check("3. le fond n'est PAS lancé (priorité interactive absolue)", countWork(db, "t3") === 0);
  ctl.active = false;                      // Yohann parti
  await gov.tick();
  check("3. Yohann parti → le fond tourne (REPOS→exécution)", countWork(db, "t3") === 3 && wm(db, "t3")?.owed === 0);
  db.close();
}

// ─── 4. Budget « part de Sophia » : interactif JAMAIS compté ; autonome décrémenté ; épuisé → BRIDE ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t4", units: 10 });
  const { gov } = makeGov(db, p, task, { budgetCap: 3 });
  gov.recordInteractiveCall("tour"); gov.recordInteractiveCall("tour"); gov.recordInteractiveCall("tour"); // 3 tours de Yohann
  check("4. l'interactif n'entame PAS le budget autonome", budget(db) === 0);
  await gov.tick();                        // exécute jusqu'à épuisement du budget (3 appels autonomes)
  check("4. le fond s'arrête au budget épuisé (3 unités, pas 10)", countWork(db, "t4") === 3);
  check("4. chaque unité autonome a été comptée", budget(db) === 3);
  check("4. tâche non finie → owed=1 (rattrapage dû)", wm(db, "t4")?.owed === 1);
  check("4. état BRIDE (budget de la fenêtre épuisé)", gov.currentState === "BRIDE");
  db.close();
}

// ─── 5. Contre-pression 429 : throttle → bride immédiat le QUOTA (le local non-quota continue) ──
{
  const { p, db } = fresh();
  const quotaTask = makeTask(db, { task: "t5q", units: 2, priority: 0, consumesQuota: true });
  const localTask = makeTask(db, { task: "t5l", units: 2, priority: 1, consumesQuota: false });
  const gov = new Governor({ db: db.raw, paths: p, tasks: [quotaTask, localTask], activityProbe: () => ({ interactive: false }), now: () => 1_000_000, debounceMs: 0, onLog: () => {} });
  gov.notifyThrottle();                    // 429
  await gov.tick();
  check("5. throttle 429 → la tâche QUOTA est bridée (non lancée)", countWork(db, "t5q") === 0);
  check("5. le travail LOCAL non-quota continue malgré le 429", countWork(db, "t5l") === 2);
  db.close();
}

// ─── 6. Calque SECOURS : la tâche requires_real_brain est DIFFÉRÉE ; le local tourne ──
{
  const { p, db } = fresh();
  const brainTask = makeTask(db, { task: "t6b", units: 2, requiresRealBrain: true, priority: 0 });
  const localTask = makeTask(db, { task: "t6l", units: 2, requiresRealBrain: false, priority: 1 });
  const gov = new Governor({ db: db.raw, paths: p, tasks: [brainTask, localTask], activityProbe: () => ({ interactive: false }), now: () => 1_000_000, debounceMs: 0, onLog: () => {} });
  gov.setMode("SECOURS", true);
  await gov.tick(); await gov.tick();
  check("6. SECOURS → la tâche requires_real_brain est DIFFÉRÉE (jamais gravée diminuée, A37)", countWork(db, "t6b") === 0);
  check("6. SECOURS → le local non-cerveau tourne quand même", countWork(db, "t6l") === 2);
  gov.setMode("SECOURS", false);
  await gov.tick();
  check("6. SECOURS levé → la tâche cerveau reprend AU CURSEUR", countWork(db, "t6b") === 2);
  // Le calque JEU est PORTÉ et lisible (ses effets — GPU/voix — sont définis en 05 ; le socle l'honore, ne le détecte pas).
  gov.setMode("JEU", true);
  check("6. calque JEU posé et lisible (porté pour 05)", gov.hasMode("JEU") === true);
  gov.setMode("JEU", false);
  check("6. calque JEU retiré", gov.hasMode("JEU") === false);
  db.close();
}

// ─── 7. Préemption PAR UNITÉ : cède APRÈS l'unité en cours + rattrapage AU CURSEUR (jamais à zéro) ──
{
  const { p, db } = fresh();
  // l'activité passe interactive PENDANT l'unité 0 → l'unité 0 finit (committée), l'unité 1 n'est PAS lancée.
  let ctlRef;
  const task = makeTask(db, { task: "t7", units: 3, onUnit: (cursor) => { if (cursor === 0) ctlRef.active = true; } });
  const { gov, ctl } = makeGov(db, p, task);
  ctlRef = ctl;
  await gov.tick();
  check("7. préemption : l'unité EN COURS a fini (committée), pas coupée au milieu", countWork(db, "t7") === 1);
  check("7. préemption : l'unité SUIVANTE n'a pas été lancée (cède APRÈS l'unité)", countWork(db, "t7") === 1);
  check("7. rattrapage dû : owed=1 (jamais à zéro)", wm(db, "t7")?.owed === 1);
  // Yohann repart → reprise AU CURSEUR (unités 1 et 2), l'unité 0 n'est PAS re-exécutée
  ctl.active = false;
  await gov.tick();
  check("7. reprise AU CURSEUR : les unités restantes s'exécutent (total 3, l'unité 0 non re-jouée)", countWork(db, "t7") === 3);
  check("7. tâche finie → owed=0", wm(db, "t7")?.owed === 0);
  db.close();
}

// ─── 8. Une unité en ÉCHEC ne committe RIEN de partiel (atomicité) → rattrapage au curseur ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t8", units: 3, throwAt: 1 }); // l'unité d'index 1 jette
  const { gov } = makeGov(db, p, task);
  await gov.tick();
  check("8. échec de l'unité 1 → l'unité 0 est committée, l'unité 1 ne laisse RIEN (atomique)", countWork(db, "t8") === 1);
  check("8. aucune transaction en vol après un échec (⑩)", db.raw.isTransaction === false);
  check("8. la tâche reste due (owed=1) → rattrapage au curseur", wm(db, "t8")?.owed === 1);
  db.close();
}

// ─── 9. commitUnit REFUSE une transaction déjà ouverte (invariant ② : jamais d'await transaction en vol) ──
{
  const { p, db } = fresh();
  let threw = false;
  const task = {
    task: "t9", priority: 0, requiresRealBrain: false, consumesQuota: true,
    isDue: () => true,
    runUnit: async (ctx) => {
      db.raw.exec("BEGIN"); // une transaction traîne (anti-pattern) — commitUnit doit REFUSER
      try { ctx.commitUnit(() => {}, true); } catch { threw = true; }
      db.raw.exec("ROLLBACK");
      return { done: true };
    },
  };
  const gov = new Governor({ db: db.raw, paths: p, tasks: [task], activityProbe: () => ({ interactive: false }), now: () => 1_000_000, debounceMs: 0, onLog: () => {} });
  await gov.tick();
  check("9. commitUnit REFUSE si une transaction est déjà ouverte (invariant ②)", threw);
  db.close();
}

// ─── 10. quiesce ⑩ : plus de tick + aucune transaction en vol ; anti-rebond (A21) ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t10", units: 2 });
  const { gov } = makeGov(db, p, task);
  await gov.quiesce(2000);
  check("10. quiesce → aucune transaction en vol (writeCleanShutdown passerait)", db.raw.isTransaction === false);
  await gov.tick(); // après quiesce, tick est neutralisé
  check("10. après quiesce, tick ne lance plus rien (arrêt en cours)", countWork(db, "t10") === 0);
  db.close();
}
{
  // Anti-rebond A21 : une micro-pause (activité repassée false mais < debounceMs) ne relance pas le fond tout de suite.
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t10b", units: 2 });
  const gov = new Governor({ db: db.raw, paths: p, tasks: [task], activityProbe: () => ({ interactive: false }), now: () => 1_000_000, debounceMs: 60_000, onLog: () => {} });
  // On simule « Yohann vient d'être actif » via un probe qui a renvoyé true une fois, puis false.
  const gov2 = new Governor({ db: db.raw, paths: p, tasks: [task], activityProbe: (() => { let first = true; return () => { const v = first; first = false; return { interactive: v }; }; })(), now: () => 1_000_000, debounceMs: 60_000, onLog: () => {} });
  await gov2.tick(); // 1er probe=true → INTERACTIF, marque lastInteractiveAt=now
  await gov2.tick(); // 2e probe=false MAIS now-lastInteractiveAt=0 < 60s → encore INTERACTIF (anti-rebond)
  check("10. anti-rebond : juste après une activité, le fond reste différé (REPOS pas immédiat)", countWork(db, "t10b") === 0 && gov2.currentState === "INTERACTIF");
  db.close();
}

// ─── 11. writesSuspended (base douteuse SANS_ECRITURE) : le gouverneur ne lance RIEN (jamais écrire une mémoire douteuse) ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t11", units: 2 });
  let suspended = true;
  const gov = new Governor({ db: db.raw, paths: p, tasks: [task], activityProbe: () => ({ interactive: false }), writesSuspended: () => suspended, now: () => 1_000_000, debounceMs: 0, onLog: () => {} });
  await gov.tick();
  check("11. SANS_ECRITURE (writesSuspended) → aucune tâche de fond lancée (A15)", countWork(db, "t11") === 0);
  suspended = false;
  await gov.tick();
  check("11. écriture rétablie → la tâche reprend au curseur", countWork(db, "t11") === 2);
  db.close();
}

// ─── 12. Backoff après échec : une tâche qui jette n'est pas re-spinnée à chaque tick ; le cooldown expire avec le temps ──
{
  const { p, db } = fresh();
  let attempts = 0;
  const task = makeTask(db, { task: "t12", units: 3, throwAt: 0, onUnit: () => { attempts++; } }); // échoue toujours à la 1re unité
  const { gov, ctl } = makeGov(db, p, task, { budgetCap: 1000 });
  await gov.tick(); // 1re tentative → échec → backoff posé
  await gov.tick(); // même instant → cooldown actif → PAS de nouvelle tentative
  check("12. backoff : une tâche qui échoue n'est pas re-spinnée au tick suivant (cooldown, rien de committé)", attempts === 1 && countWork(db, "t12") === 0);
  ctl.advance(10_000); // dépasse le backoff de base (5 s)
  await gov.tick(); // cooldown expiré → re-tentée
  check("12. backoff : le cooldown expire avec le temps (la tâche est re-tentée, pas abandonnée pour toujours)", attempts === 2);
  db.close();
}

// ─── 13. writesSuspended survenu EN COURS d'exécution (SANS_ECRITURE runtime) → cède APRÈS l'unité en cours ──
{
  const { p, db } = fresh();
  let suspended = false;
  const task = makeTask(db, { task: "t13", units: 3, onUnit: (cursor) => { if (cursor === 0) suspended = true; } });
  const gov = new Governor({ db: db.raw, paths: p, tasks: [task], activityProbe: () => ({ interactive: false }), writesSuspended: () => suspended, now: () => 1_000_000, debounceMs: 0, onLog: () => {} });
  await gov.tick();
  check("13. SANS_ECRITURE survenu EN COURS → l'unité en cours finit, la suivante ne part pas (cède, owed=1)",
    countWork(db, "t13") === 1 && wm(db, "t13")?.owed === 1);
  db.close();
}

// ─── 14. quiesce ⑩ borné : une unité qui DÉPASSE la grace → quiesce rend la main sans bloquer, isTransaction=false ──
{
  const { p, db } = fresh();
  const task = makeTask(db, { task: "t14", units: 5, onUnit: async () => { await new Promise((r) => setTimeout(r, 300)); } });
  const { gov } = makeGov(db, p, task);
  const running = gov.tick();                          // lance une unité longue (~300 ms de travail async, HORS transaction)
  await new Promise((r) => setTimeout(r, 40));         // laisser l'unité démarrer
  const t0 = Date.now();
  await gov.quiesce(80);                               // grace 80 ms < 300 ms → rend la main AVANT la fin de l'unité
  check("14. quiesce borné : rend la main dans ~la grace même si l'unité dépasse (jamais l'arrêt bloqué)", Date.now() - t0 < 250);
  check("14. quiesce : aucune transaction en vol (l'unité travaille HORS transaction → writeCleanShutdown passerait)", db.raw.isTransaction === false);
  await running;                                       // l'unité finit ensuite (committée), puis la boucle cède (owed=1)
  check("14. grace dépassée : l'unité en vol s'est committée, la tâche reste due (owed=1 → rattrapage, jamais faux « propre »)",
    countWork(db, "t14") === 1 && wm(db, "t14")?.owed === 1);
  db.close();
}

// ─── 15. isDue CLIENTE qui jette au RUNTIME → le gouverneur ne crashe pas (dueOrOwed fail-safe, symétrique au boot) ──
{
  const { p, db } = fresh();
  const poison = {
    task: "t15", priority: 0, requiresRealBrain: false, consumesQuota: true,
    isDue: () => { throw new Error("isDue cliente boguée"); },
    runUnit: async () => ({ done: true }),
  };
  const gov = new Governor({ db: db.raw, paths: p, tasks: [poison], activityProbe: () => ({ interactive: false }), now: () => 1_000_000, debounceMs: 0, onLog: () => {} });
  let threw = false;
  try { await gov.tick(); } catch { threw = true; }
  check("15. isDue cliente qui jette au runtime → l'arbitrage NE crashe PAS (fail-safe, le fond ne se fige pas en silence)", !threw);
  db.close();
}

fs.rmSync(base, { recursive: true, force: true });
for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T7 OK : la mécanique du gouverneur est prouvée"); process.exit(0); }
else { console.error(`\nU-T7 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
