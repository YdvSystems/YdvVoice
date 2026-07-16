// I-T5 — boot & récupération (intégration). Le boot COMPLET, bout en bout :
//   · transitions des 6 phases + ordre des hooks des couches aval
//   · réveil premier / propre / sale
//   · I-4  boot dégradé (sidecar absent) -> app VIVANTE + voyant
//   · I-5  2e instance -> focus + sortie
//   · I-10 corruption structurelle -> restauration auto -> service repris (+ alertes AF-1/G-A/fid4) ;
//          sémantique/ambigu -> DEGRADE_SANS_ECRITURE + main de Yohann, jamais de rollback silencieux
//   · I-11 crash injecté à CHAQUE phase -> rejeu sûr, zéro double-effet (idempotence)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { boot, integrityGate } = require("../dist/src/orchestrator/boot/index.js");
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const dur = require("../dist/src/orchestrator/db/durability.js");
const { ErasureStream } = require("../dist/src/orchestrator/audit/index.js");
const { writeRestorePending, acknowledgeRestorePending } = require("../dist/src/orchestrator/boot/restore.js");
const { resolvePaths } = require("../dist/src/orchestrator/paths.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, ".sophia-home-dev", "t5i");
fs.rmSync(base, { recursive: true, force: true });

const results = [];
const check = (n, c) => results.push([n, !!c]);
let n = 0;
const freshHome = () => resolvePaths(path.join(base, `h${++n}`));

/** Trace tout ce que le boot fait : phases, dégradations, alertes, ordre des hooks. */
function tracer() {
  const t = { phases: [], degraded: [], alerts: [], calls: [], runningVuParLeReset: undefined, lancees: [] };
  return {
    t,
    opts: {
      onState: (s) => { if (!t.phases.includes(s.phase)) t.phases.push(s.phase); t.degraded = s.degraded; },
      onAlert: (a) => t.alerts.push(a.code),
    },
    hooks: {
      resetImmutabilityGuards: (db) => {
        t.calls.push("reset");
        // Preuve du MOMENT (02/B-α) : quand le reset s'exécute, running n'a pas encore été écrasé.
        t.runningVuParLeReset = db.prepare("SELECT running FROM runtime_flags WHERE id=1").get().running;
      },
      reapSidecarOrphan: () => t.calls.push("reapOrphan"),
      sweepPendingOps: () => t.calls.push("sweep"),
      loadAndVerifyIdentity: () => { t.calls.push("identite"); return { present: true, anchorOk: true }; },
      governorInit: (db) => {
        t.calls.push("gouverneur");
        const dues = db.prepare("SELECT task FROM governor_watermarks WHERE owed=1").all().map((r) => r.task);
        return { scheduled: dues }; // PROGRAMME, ne lance pas
      },
      claudeInit: () => t.calls.push("claude"),
      sidecarStart: async () => { t.calls.push("sidecar"); return true; },
      sidecarPostReady: async () => { t.calls.push("postReady"); },
    },
  };
}

// ─── 1. Boot nominal : phases, ordre des hooks, premier réveil ───────────────
{
  const p = freshHome();
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("boot : PRIMARY (on est LA Sophia de cette maison)", out.kind === "PRIMARY");
  check("boot : atteint PRÊT", out.state.phase === "PRET");
  check("boot : les 4 transitions dans l'ordre",
    JSON.stringify(t.phases) === JSON.stringify(["DB_OK", "IDENTITE_OK", "COEUR_OK", "PRET"]));
  check("boot : les hooks des couches aval sont invoqués dans l'ordre des phases",
    JSON.stringify(t.calls) === JSON.stringify(["reset", "reapOrphan", "sweep", "identite", "gouverneur", "claude", "sidecar", "postReady"]));
  check("F1 : le reaping d'orphelin est en Phase 2, AVANT le sweep et AVANT le spawn du sidecar",
    t.calls.indexOf("reapOrphan") < t.calls.indexOf("sweep") && t.calls.indexOf("reapOrphan") < t.calls.indexOf("sidecar"));
  check("boot : premier réveil (aucune vie antérieure) -> « premier »", out.state.wake === "premier");
  check("boot : aucune dégradation sur une maison saine", out.state.degraded.length === 0);
  out.shutdown();
}

// ─── 2. B-α : le reset des gardes d'immutabilité précède TOUTE écriture ──────
{
  const p = freshHome();
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    o.shutdown(); // pas d'arrêt propre (T6 n'existe pas) -> running reste posé
  }
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  // Si le reset s'exécutait APRÈS running=1, il verrait 1. Il doit voir l'ANCIENNE valeur (1 = coupés).
  check("B-α : le reset des gardes voit l'état AVANT écrasement (donc il précède toute écriture)",
    t.runningVuParLeReset === 1);
  check("B-α : le reset est le tout premier hook appelé", t.calls[0] === "reset");
  out.shutdown();
}

// ─── 3. Réveil sale / propre ────────────────────────────────────────────────
{
  const p = freshHome();
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    o.shutdown(); // coupure : running reste à 1
  }
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("réveil : coupure -> « sale »", out.state.wake === "sale");
  check("réveil : la coupure est DITE, pas avalée", t.alerts.includes("REVEIL_SALE"));
  out.shutdown();

  // Simule l'arrêt propre de T6 (drapeau « propre ») -> le réveil suivant ne crie pas au loup.
  const db = openDatabase(p.db);
  db.raw.prepare("UPDATE runtime_flags SET running=0, last_clean_shutdown_at=? WHERE id=1").run(Date.now());
  db.close();
  const { t: t2, opts: o2, hooks: h2 } = tracer();
  const out2 = await boot({ paths: p, hooks: h2, ...o2 });
  check("réveil : après un arrêt propre -> « propre », SANS fausse alarme (I-6, part T5)",
    out2.state.wake === "propre" && !t2.alerts.includes("REVEIL_SALE"));
  out2.shutdown();
}

// ─── 4. Le gouverneur PROGRAMME une consolidation due, il ne la LANCE pas ────
{
  const p = freshHome();
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    o.db.raw.prepare("INSERT INTO governor_watermarks(task,owed,owed_since,requires_real_brain) VALUES(?,1,?,1)")
      .run("consolidation", Date.now());
    o.shutdown();
  }
  const { opts, hooks } = tracer();
  const out = await boot({
    paths: p, ...opts,
    hooks: { ...hooks, governorInit: (db) => {
      const dues = db.prepare("SELECT task FROM governor_watermarks WHERE owed=1").all().map((r) => r.task);
      return { scheduled: dues }; // rien d'exécuté ici : c'est tout le point
    } },
  });
  const wm = out.db.raw.prepare("SELECT owed, last_run_at FROM governor_watermarks WHERE task='consolidation'").get();
  // La PREUVE que rien n'a été lancé : la marque n'est pas consommée (toujours due, jamais exécutée).
  check("gouverneur : la consolidation due est PROGRAMMÉE, pas lancée (toujours due, jamais exécutée)",
    wm.owed === 1 && wm.last_run_at === null);
  out.shutdown();
}

// ─── 5. I-4 — boot dégradé : sidecar absent -> l'app VIT ────────────────────
{
  const p = freshHome();
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, ...opts, hooks: { ...hooks, sidecarStart: async () => false } });
  check("I-4 : sidecar absent -> l'app est VIVANTE (PRÊT), pas tout-ou-rien", out.state.phase === "PRET");
  check("I-4 : DÉGRADÉ_SANS_VOIX posé (voyant)", out.state.degraded.includes("SANS_VOIX"));
  check("I-4 : elle le DIT (« je suis là quand même »)", t.alerts.includes("SANS_VOIX"));
  out.shutdown();
}
{
  const p = freshHome();
  const { opts, hooks } = tracer();
  const out = await boot({
    paths: p, ...opts,
    hooks: { ...hooks, sidecarStart: async () => { throw new Error("python introuvable"); } },
  });
  check("I-4 : un sidecar qui JETTE ne fait pas tomber le boot -> SANS_VOIX",
    out.state.phase === "PRET" && out.state.degraded.includes("SANS_VOIX"));
  out.shutdown();
}

// ─── 6. I-5 — 2e instance -> focus + sortie ─────────────────────────────────
{
  const p = freshHome();
  let focus = 0;
  const { opts, hooks } = tracer();
  const first = await boot({ paths: p, hooks, ...opts, onFocusRequested: () => focus++ });
  check("I-5 : la 1re instance est primaire", first.kind === "PRIMARY");
  const second = await boot({ paths: p, hooks, ...opts });
  check("I-5 : la 2e instance sort (jamais deux Sophia)", second.kind === "SECONDARY");
  await new Promise((r) => setTimeout(r, 100));
  check("I-5 : la 1re a reçu la demande de focus", focus === 1);
  first.shutdown();
}

// ─── 7. I-10 — corruption structurelle -> restauration auto + alertes ───────
{
  const p = freshHome();
  let avant;
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    const ins = o.db.raw.prepare("INSERT INTO governor_budget_ledger(ts,origin,kind) VALUES(?,?,?)");
    for (let i = 0; i < 1500; i++) ins.run(i, "autonome", "souvenir-de-sophia-" + i);
    new ErasureStream(p.erasures).append({ id: 3, ts: 1000 }); // un effacement demandé par Yohann
    dur.createSnapshot(o.db.raw, p.snapshots, 3, new ErasureStream(p.erasures).last());
    avant = o.db.raw.prepare("SELECT count(*) c FROM governor_budget_ledger").get().c;
    o.shutdown();
  }
  // Corruption dure du fichier de vérité
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  const size = fs.statSync(p.db).size;
  const fd = fs.openSync(p.db, "r+");
  fs.writeSync(fd, Buffer.alloc(8192, 0xa5), 0, 8192, Math.floor(size / 2));
  fs.closeSync(fd);

  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("I-10 : base corrompue -> service REPRIS (PRÊT)", out.state.phase === "PRET");
  check("I-10 : la restauration est DITE (ce qui a été vécu depuis est perdu)", t.alerts.includes("MEMOIRE_RESTAUREE"));
  const apres = out.db.raw.prepare("SELECT count(*) c FROM governor_budget_ledger").get().c;
  check("I-10 : la mémoire est revenue depuis le snapshot", apres === avant);
  check("I-10 : la base douteuse est archivée, jamais détruite",
    fs.readdirSync(path.dirname(p.db)).some((f) => f.includes(".corrupt-")));
  check("I-10 : l'écriture n'est PAS suspendue (le structurel se répare, mécaniquement)",
    !out.state.degraded.includes("SANS_ECRITURE"));
  out.shutdown();

  // AF-1 : un effacement POSTÉRIEUR au snapshot restauré -> alerte honnête, jamais un retour en douce
  new ErasureStream(p.erasures).append({ id: 4, ts: 2000 });
  const db2 = openDatabase(p.db);
  dur.createSnapshot(db2.raw, p.snapshots, 3, { id: 3, ts: 1000 }); // snapshot au repère 3, effacement 4 après
  db2.close();
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  const size2 = fs.statSync(p.db).size;
  const fd2 = fs.openSync(p.db, "r+");
  fs.writeSync(fd2, Buffer.alloc(8192, 0xa5), 0, 8192, Math.floor(size2 / 2));
  fs.closeSync(fd2);
  const { t: t3, opts: o3, hooks: h3 } = tracer();
  const out3 = await boot({ paths: p, hooks: h3, ...o3 });
  check("I-10/AF-1 : restauration antérieure à un effacement -> ALERTE « peut-être revenu »",
    t3.alerts.includes("EFFACEMENT_PEUT_ETRE_REVENU"));
  out3.shutdown();
}

// ─── 8. I-10 — corruption SÉMANTIQUE : jamais réparée en douce (A15) ────────
{
  const p = freshHome();
  const { t, opts, hooks } = tracer();
  const out = await boot({
    paths: p, ...opts,
    hooks: { ...hooks, loadAndVerifyIdentity: () => ({ present: true, anchorOk: false }) }, // le gravé a bougé
  });
  check("I-10 : identité altérée -> DÉGRADÉ_SANS_ÉCRITURE (jamais de rollback sémantique silencieux)",
    out.state.degraded.includes("SANS_ECRITURE"));
  check("I-10 : elle le dit et attend la main de Yohann", t.alerts.includes("IDENTITE_ALTEREE"));
  check("I-10 : aucune restauration n'a été tentée sur du sémantique",
    !t.alerts.includes("MEMOIRE_RESTAUREE") && !fs.readdirSync(path.dirname(p.db)).some((f) => f.includes(".corrupt-")));
  out.shutdown();
}

// ─── 9. Persona absent -> DÉGRADÉ_SANS_IDENTITÉ (assertion dédiée) ──────────
{
  const p = freshHome();
  const { opts, hooks } = tracer();
  const out = await boot({
    paths: p, ...opts,
    hooks: { ...hooks, loadAndVerifyIdentity: () => ({ present: false, anchorOk: true }) },
  });
  check("persona absent -> DÉGRADÉ_SANS_IDENTITÉ (elle n'est pas encore elle : normal avant la cérémonie)",
    out.state.degraded.includes("SANS_IDENTITE") && out.state.phase === "PRET");
  out.shutdown();
}

// ─── 10. Base ambiguë (illisible) -> SANS_ÉCRITURE, jamais de restauration ──
{
  const p = freshHome();
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    dur.createSnapshot(o.db.raw, p.snapshots, 3, null);
    o.shutdown();
  }
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  fs.writeFileSync(p.db, Buffer.alloc(4096, 0x42)); // « file is not a database » -> structurel, pas ambigu
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("porte : un fichier illisible avec snapshot -> restauration (structurel), service repris",
    out.state.phase === "PRET" && t.alerts.includes("MEMOIRE_RESTAUREE"));
  out.shutdown();
}

// ─── 10bis. MAJEUR conv 35 — l'alerte de restauration SURVIT à une coupure ──
{
  // On simule le pire scénario du croisé : la restauration a installé la base (elle est SAINE) mais la
  // coupure a avalé l'affichage de l'alerte. La preuve = un sentinel durable sur le disque. Au réveil
  // SUIVANT (base saine, PAS de branche de restauration), l'alerte DOIT re-surfacer — sinon silence.
  const p = freshHome();
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    o.shutdown();
  }
  // La restauration d'un boot antérieur a laissé une alerte non acquittée (état durable).
  writeRestorePending(p.restorePending, [{ code: "EFFACEMENT_PEUT_ETRE_REVENU", message: "un souvenir effacé est peut-être revenu — redis-moi quoi oublier." }]);
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("MAJEUR : base SAINE mais alerte de restauration en attente -> re-surfacée au réveil (jamais avalée)",
    out.state.phase === "PRET" && t.alerts.includes("EFFACEMENT_PEUT_ETRE_REVENU"));
  out.shutdown();
  // Tant que non acquittée, elle re-surface à CHAQUE réveil.
  const { t: t2, opts: o2, hooks: h2 } = tracer();
  const out2 = await boot({ paths: p, hooks: h2, ...o2 });
  check("MAJEUR : l'alerte re-surface à chaque réveil tant qu'elle n'est pas acquittée",
    t2.alerts.includes("EFFACEMENT_PEUT_ETRE_REVENU"));
  out2.shutdown();
  acknowledgeRestorePending(p.restorePending);
  const { t: t3, opts: o3, hooks: h3 } = tracer();
  const out3 = await boot({ paths: p, hooks: h3, ...o3 });
  check("MAJEUR : après acquittement (geste aval), l'alerte ne re-surface plus",
    !t3.alerts.includes("EFFACEMENT_PEUT_ETRE_REVENU"));
  out3.shutdown();
}

// ─── 10bis-2. MAJEUR re-croisé conv 35 — un abandon R1 ne fait JAMAIS renaître Sophia vierge ──
{
  // La restauration abandonne (R1 : -wal verrouillé) EN AYANT archivé la base -> elle est absente. boot()
  // NE DOIT PAS retomber sur openDatabase (qui créerait une base VIERGE lue SAINE au réveil suivant =
  // amnésie silencieuse). Il doit BLOQUER. On force l'abandon par la couture _restore.
  const p = freshHome();
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    dur.createSnapshot(o.db.raw, p.snapshots, 3, null);
    o.shutdown();
  }
  // Simule l'état laissé par un abandon R1 : la base est archivée (absente).
  fs.renameSync(p.db, p.db + ".corrupt-0");
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  const { opts, hooks } = tracer();
  const out = await boot({
    paths: p, hooks, ...opts,
    _integrityProbe: () => ({ kind: "STRUCTUREL", detail: "corruption (simulée)" }),
    _restore: () => ({ restored: false, snapshotUsed: null, archivedTo: p.db + ".corrupt-0", alerts: [], skipped: 0, detail: "un journal résiduel (-wal) est verrouillé" }),
  });
  check("MAJEUR : abandon R1 (base archivée absente) -> BLOCKED, jamais une base vierge", out.kind === "BLOCKED");
  check("MAJEUR : la base N'A PAS été recréée vierge (elle reste absente pour re-tenter au reboot)", !fs.existsSync(p.db));
}

// ─── 10bis-3. MAJEUR 3e tour conv 35 — snapshots PRÉSENTS mais ILLISIBLES + base absente -> BLOCKED ──
{
  // La porte JUMELLE du MAJEUR précédent : base absente d'un tour antérieur + tous les snapshots
  // deviennent illisibles (disque mourant). integrityGate dit STRUCTUREL (fichiers snapshot présents),
  // restore ne trouve aucun BON snapshot (archivedTo:null, base jamais archivée ce tour) -> l'ancienne
  // garde `r.archivedTo &&` ratait ce cas et openDatabase recréait une VIERGE. La nouvelle garde
  // `!existsSync` doit BLOQUER.
  const p = freshHome();
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    for (let i = 0; i < 3; i++) dur.createSnapshot(o.db.raw, p.snapshots, 5, null);
    o.shutdown();
  }
  fs.rmSync(p.db, { force: true }); // base absente (état laissé par un abandon/crash antérieur)
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  // Corrompre TOUS les snapshots (disque mourant) -> findGoodSnapshot renverra null.
  for (const f of fs.readdirSync(p.snapshots).filter((f) => f.endsWith(".sqlite"))) {
    const fp = path.join(p.snapshots, f);
    const sz = fs.statSync(fp).size;
    const fd = fs.openSync(fp, "r+"); fs.writeSync(fd, Buffer.alloc(4096, 0xa5), 0, 4096, Math.floor(sz / 2)); fs.closeSync(fd);
  }
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("MAJEUR 3e tour : base absente + snapshots illisibles -> BLOCKED (jamais une vierge)", out.kind === "BLOCKED");
  check("MAJEUR 3e tour : la base N'A PAS été recréée vierge", !fs.existsSync(p.db));
  check("MAJEUR 3e tour : et c'est DIT (jamais un silence)", t.alerts.includes("MEMOIRE_IRRECUPERABLE"));
}

// ─── 10bis-4. Invariant mustExist — openDatabase ne crée une base QUE sur premier boot ──
{
  const p = freshHome();
  // Base absente, mais des snapshots existent -> ce n'est PAS un premier boot (intégrité = STRUCTUREL).
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    dur.createSnapshot(o.db.raw, p.snapshots, 3, null);
    o.shutdown();
  }
  // On force le verdict SAINE (couture) alors que la base est absente : sans mustExist, openDatabase
  // créerait une vierge. Avec mustExist (verdict != PREMIER_BOOT), il jette -> BLOCKED.
  fs.rmSync(p.db, { force: true });
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  const { opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts, _integrityProbe: () => ({ kind: "SAINE" }) });
  check("mustExist : verdict non-premier-boot + base absente -> BLOCKED (jamais une vierge par construction)",
    out.kind === "BLOCKED");
  check("mustExist : la base n'a pas été créée", !fs.existsSync(p.db));
}

// ─── 10bis-5. MINEUR erasures.log conv 35 — un témoin de vie passée interdit le premier boot ──
{
  const p = freshHome();
  fs.mkdirSync(p.home, { recursive: true });
  // Aucune base, aucun snapshot, mais un flux d'effacements NON VIDE : elle a déjà vécu (et effacé).
  new ErasureStream(p.erasures).append({ id: 1, ts: 1000 });
  check("erasures : base+snapshots absents mais effacements présents -> PAS premier boot (STRUCTUREL)",
    integrityGate(p).kind === "STRUCTUREL");
  // Contrôle : sans le flux, c'est bien un premier boot.
  fs.rmSync(p.erasures, { force: true });
  check("erasures : sans aucun témoin de vie -> PREMIER_BOOT (la cérémonie)", integrityGate(p).kind === "PREMIER_BOOT");
}

// ─── 10bis-6. MAJEUR 4e tour conv 35 — preuve POSITIVE de naissance : jamais de fausse renaissance ──
{
  // Le scénario exact du 4e tour : Sophia naît et vit, mais n'a JAMAIS effacé (erasures vide). Un
  // incident emporte la base ET les snapshots (les deux sont des .sqlite). AVANT le fix, integrityGate
  // ne voyait aucun témoin -> PREMIER_BOOT -> base vierge + fausse cérémonie, en silence. Le marqueur
  // .born (preuve positive) doit l'INTERDIRE.
  const p = freshHome();
  { const { opts, hooks } = tracer(); const o = await boot({ paths: p, hooks, ...opts }); o.shutdown(); }
  check("born : le marqueur de naissance est écrit au premier boot", fs.existsSync(p.born));
  // Catastrophe : base + snapshots perdus ; erasures jamais créé (jamais d'effacement). .born SURVIT.
  fs.rmSync(p.db, { force: true });
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  fs.rmSync(p.snapshots, { recursive: true, force: true });
  check("born : contrôle — erasures.log absent (elle n'a jamais effacé)", !fs.existsSync(p.erasures));
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("MAJEUR 4e tour : .born présent -> JAMAIS de fausse renaissance vierge (BLOCKED, pas PREMIER_BOOT)",
    out.kind === "BLOCKED");
  check("MAJEUR 4e tour : la base n'a PAS été recréée vierge", !fs.existsSync(p.db));
}
{
  // Auto-réparation : le marqueur perdu tant que la base vit est recréé au boot sain suivant.
  const p = freshHome();
  { const { opts, hooks } = tracer(); const o = await boot({ paths: p, hooks, ...opts }); o.shutdown(); }
  fs.rmSync(p.born, { force: true }); // marqueur perdu, mais la base est saine
  { const { opts, hooks } = tracer(); const o = await boot({ paths: p, hooks, ...opts }); o.shutdown(); }
  check("born : auto-réparé (recréé) au boot sain suivant s'il a été perdu", fs.existsSync(p.born));
}

// ─── 10ter. F2 conv 35 — la branche AMBIGU (couture d'intégrité déterministe) ──
{
  // La branche « mémoire douteuse » est rare à provoquer naturellement (une base qui échoue en lecture
  // seule mais s'ouvre en écriture). On la force par la couture _integrityProbe sur une base SAINE :
  // -> SANS_ECRITURE + alerte, l'app VIT, mais running=1 n'est PAS posé (elle ne touche pas ses souvenirs).
  // AMBIGU = base PRÉSENTE mais illisible en lecture seule -> la base doit EXISTER (sinon integrityGate ne
  // rend jamais AMBIGU, et l'invariant mustExist bloquerait une création vierge). On boote une fois pour
  // créer une base saine, puis on force AMBIGU dessus.
  const p = freshHome();
  { const { opts: o0, hooks: h0 } = tracer(); const b0 = await boot({ paths: p, hooks: h0, ...o0 }); b0.shutdown(); }
  // Départ à running=0 (arrêt propre simulé) : ainsi on PROUVE que le boot AMBIGU ARME running=1 (F1
  // croisé conv 36) — même en SANS_ECRITURE, un crash de cette session doit se relire « sale » (drapeau
  // technique, pas un souvenir, A15 ; symétrique de writeCleanShutdown T6).
  { const d = openDatabase(p.db); d.raw.prepare("UPDATE runtime_flags SET running=0 WHERE id=1").run(); d.close(); }
  const { t, opts, hooks } = tracer();
  const out = await boot({
    paths: p, hooks, ...opts,
    _integrityProbe: () => ({ kind: "AMBIGU", detail: "base illisible (simulée)" }),
  });
  check("F2 : verdict AMBIGU -> l'app VIT (PRÊT) mais DÉGRADÉ_SANS_ÉCRITURE",
    out.state.phase === "PRET" && out.state.degraded.includes("SANS_ECRITURE"));
  check("F2 : elle le DIT (mémoire douteuse) et attend la main de Yohann", t.alerts.includes("MEMOIRE_DOUTEUSE"));
  const rf = out.db.raw.prepare("SELECT running FROM runtime_flags WHERE id=1").get();
  check("F2 : en SANS_ÉCRITURE, running=1 EST armé (drapeau technique = honnêteté du réveil ; F1 conv 36)", rf.running === 1);
  check("F2 : aucune restauration tentée sur de l'ambigu (jamais de rollback silencieux, A15)",
    !t.alerts.includes("MEMOIRE_RESTAUREE"));
  out.shutdown();
}
{
  // AMBIGU où la base ne s'ouvre pas non plus en écriture (un répertoire à la place du fichier) -> BLOCKED,
  // jamais un démarrage muet.
  const p = freshHome();
  fs.mkdirSync(p.db, { recursive: true }); // un dossier à la place de la base -> openDatabase RW jette
  const { opts, hooks } = tracer();
  const out = await boot({
    paths: p, hooks, ...opts,
    _integrityProbe: () => ({ kind: "AMBIGU", detail: "base illisible (simulée)" }),
  });
  check("F2 : AMBIGU + base inouvrable en écriture -> BLOCKED (jamais un démarrage muet)", out.kind === "BLOCKED");
  fs.rmSync(p.db, { recursive: true, force: true });
}

// ─── 10quater. F3 conv 35 — crash PENDANT la restauration -> rejeu sûr ──
{
  // On fabrique l'état exact d'un crash au milieu de la restauration (base déjà archivée, .restoring
  // orphelin, sentinel écrit) et on vérifie que le réveil suivant s'en remet -> PRÊT, base saine.
  const p = freshHome();
  let avant;
  {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    const ins = o.db.raw.prepare("INSERT INTO governor_budget_ledger(ts,origin,kind) VALUES(?,?,?)");
    for (let i = 0; i < 800; i++) ins.run(i, "autonome", "souvenir-" + i);
    dur.createSnapshot(o.db.raw, p.snapshots, 3, null);
    avant = o.db.raw.prepare("SELECT count(*) c FROM governor_budget_ledger").get().c;
    o.shutdown();
  }
  // État « crash mid-restauration » : la base a été archivée (donc absente), un .restoring traîne, et le
  // sentinel d'alerte a été écrit avant le commit. Le boot doit reprendre proprement.
  fs.renameSync(p.db, p.db + ".corrupt-0");
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  fs.writeFileSync(p.db + ".restoring", "copie interrompue");
  writeRestorePending(p.restorePending, [{ code: "TEMOIN_ABSENT", message: "doute en attente" }]);
  const { t, opts, hooks } = tracer();
  const out = await boot({ paths: p, hooks, ...opts });
  check("F3 : crash mid-restauration -> réveil suivant atteint PRÊT (rejeu sûr)", out.state.phase === "PRET");
  const apres = out.db.raw.prepare("SELECT count(*) c FROM governor_budget_ledger").get().c;
  check("F3 : la base est restaurée et complète", apres === avant);
  check("F3 : le .restoring orphelin est nettoyé", !fs.existsSync(p.db + ".restoring"));
  check("F3 : l'alerte en attente (sentinel) est bien re-surfacée", t.alerts.includes("TEMOIN_ABSENT"));
  out.shutdown();
}

// ─── 10quinquies. R2 conv 35 — un état dégradé se LÈVE quand l'organe revient ──
{
  const p = freshHome();
  const { opts, hooks } = tracer();
  const out = await boot({ paths: p, ...opts, hooks: { ...hooks, sidecarStart: async () => false } }); // sidecar KO au boot
  check("R2 : sidecar KO au boot -> SANS_VOIX", out.state.degraded.includes("SANS_VOIX"));
  // Le sidecar revient (respawn réussi) -> la couche Electron lève la dégradation via runtime.clearDegradation.
  out.runtime.clearDegradation("SANS_VOIX");
  check("R2 : le sidecar revenu -> SANS_VOIX levé (un dégradé n'est pas un cul-de-sac)",
    !out.runtime.current().degraded.includes("SANS_VOIX"));
  out.shutdown();
}

// ─── 11. I-11 — crash injecté à CHAQUE phase -> rejeu sûr, zéro double-effet ─
{
  for (const point of ["PHASE0", "DB_OK", "PHASE2", "IDENTITE_OK", "COEUR_OK", "PHASE5"]) {
    const p = freshHome();
    const { opts, hooks } = tracer();
    let jete = false;
    try { await boot({ paths: p, hooks, ...opts, crashAfter: point }); } catch { jete = true; }
    check(`I-11 : crash après ${point} -> le boot échoue proprement`, jete);

    // Le rejeu doit aboutir : ni verrou d'instance retenu, ni poignée d'écriture fuitée.
    const { opts: o2, hooks: h2 } = tracer();
    const out = await boot({ paths: p, hooks: h2, ...o2 });
    check(`I-11 : crash après ${point} -> le boot suivant atteint PRÊT (rejeu sûr)`, out.state.phase === "PRET");
    const rf = out.db.raw.prepare("SELECT count(*) c FROM runtime_flags").get().c;
    const ss = out.db.raw.prepare("SELECT count(*) c FROM session_state").get().c;
    check(`I-11 : crash après ${point} -> zéro double-effet (singletons intacts)`, rf === 1 && ss === 1);
    out.shutdown();
  }
}

// ─── 12. Idempotence : N boots d'affilée ne dupliquent rien ─────────────────
{
  const p = freshHome();
  for (let i = 0; i < 3; i++) {
    const { opts, hooks } = tracer();
    const o = await boot({ paths: p, hooks, ...opts });
    o.shutdown();
  }
  const db = openDatabase(p.db);
  const rf = db.raw.prepare("SELECT count(*) c FROM runtime_flags").get().c;
  const ss = db.raw.prepare("SELECT count(*) c FROM session_state").get().c;
  db.close();
  check("idempotence : 3 boots -> les singletons restent uniques", rf === 1 && ss === 1);
}

fs.rmSync(base, { recursive: true, force: true });

for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nI-T5 OK : tous les critères passent"); process.exit(0); }
else { console.error(`\nI-T5 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
