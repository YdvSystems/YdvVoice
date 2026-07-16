// U-T5 — boot & récupération (unitaire). Vérifie les pièces séparément :
// porte d'intégrité (les 6 états où une coupure peut laisser la base) · alerte-à-la-restauration
// (AF-1 / G-A / fid4 — les 5 branches) · restauration (archive + -wal emporté) · instance unique
// (primaire / secondaire focalisé / primaire figé + garde M2).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const dur = require("../dist/src/orchestrator/db/durability.js");
const { ErasureStream } = require("../dist/src/orchestrator/audit/index.js");
const { resolvePaths } = require("../dist/src/orchestrator/paths.js");
const { integrityGate, hasAnyLifeWitness } = require("../dist/src/orchestrator/boot/index.js");
const { checkErasureCoverage, restoreLatestSnapshot, findGoodSnapshot, readRestorePending, writeRestorePending, acknowledgeRestorePending, evacuateSidecarFiles } = require("../dist/src/orchestrator/boot/restore.js");
const si = require("../dist/src/orchestrator/boot/single-instance.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, ".sophia-home-dev", "t5u");
fs.rmSync(base, { recursive: true, force: true });

const results = [];
const check = (n, c) => results.push([n, !!c]);
let n = 0;
const freshHome = () => {
  const h = path.join(base, `h${++n}`);
  fs.mkdirSync(h, { recursive: true });
  return resolvePaths(h);
};

/** Base socle peuplée (assez de pages pour qu'une corruption au milieu soit réelle). */
function makeDb(paths, rows = 2000) {
  const db = openDatabase(paths.db);
  const ins = db.raw.prepare("INSERT INTO governor_budget_ledger(ts,origin,kind) VALUES(?,?,?)");
  for (let i = 0; i < rows; i++) ins.run(i, "autonome", "remplissage-pour-occuper-des-pages-" + i);
  db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.close();
  return db;
}

/** Écrase des octets au milieu du fichier -> corruption STRUCTURELLE réelle. */
function corrupt(p) {
  fs.rmSync(p + "-wal", { force: true });
  fs.rmSync(p + "-shm", { force: true });
  const size = fs.statSync(p).size;
  const fd = fs.openSync(p, "r+");
  fs.writeSync(fd, Buffer.alloc(8192, 0xa5), 0, 8192, Math.floor(size / 2));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}

// ─── 0. Témoins de vie passée (hasAnyLifeWitness) — le socle du verdict PREMIER_BOOT ──
{
  // Home vierge = aucun témoin -> la cérémonie du premier boot reste possible.
  const p = freshHome();
  check("vie : home vierge -> aucun témoin de vie (premier boot possible)", hasAnyLifeWitness(p) === false);
  // Chaque témoin, un par un, doit suffire à prouver une vie passée (interdit une renaissance vierge).
  fs.writeFileSync(p.born, "{}");
  check("vie : le marqueur de naissance .born (preuve positive) suffit", hasAnyLifeWitness(p) === true);
  fs.rmSync(p.born);
  new ErasureStream(p.erasures).append({ id: 1, ts: 1 });
  check("vie : un effacement passé (erasures non-vide) suffit", hasAnyLifeWitness(p) === true);
  fs.rmSync(p.erasures);
  fs.writeFileSync(p.audit, JSON.stringify({ evt: "boot" }) + "\n");
  check("vie : un journal d'audit d'un boot antérieur suffit", hasAnyLifeWitness(p) === true);
  fs.rmSync(p.audit);
  fs.mkdirSync(path.dirname(p.db), { recursive: true });
  fs.writeFileSync(p.db + ".corrupt-0", "base archivée");
  check("vie : une base archivée .corrupt-N suffit (elle a vécu puis été archivée)", hasAnyLifeWitness(p) === true);
  fs.rmSync(p.db + ".corrupt-0");
  // Un erasures.log VIDE (0 octet, laissé par un banc) n'est PAS un témoin -> premier boot resté possible.
  fs.writeFileSync(p.erasures, "");
  check("vie : un erasures.log VIDE n'est pas un témoin (premier boot resté possible)", hasAnyLifeWitness(p) === false);
  fs.rmSync(p.erasures);
  // Durcissement 5e tour : un segment d'audit ROTÉ (.1) reste un témoin, même si le segment courant a
  // disparu (le filet audit ne doit pas s'évaporer juste après une rotation).
  fs.writeFileSync(p.audit + ".1", JSON.stringify({ evt: "boot" }) + "\n");
  check("vie : un audit roté (.1) sans segment courant reste un témoin", hasAnyLifeWitness(p) === true);
  fs.rmSync(p.audit + ".1");
  check("vie : home redevenu vierge -> aucun témoin (contrôle final)", hasAnyLifeWitness(p) === false);
}

// ─── 1. Porte d'intégrité ────────────────────────────────────────────────────
{
  const p = freshHome();
  check("porte : base absente + aucun snapshot -> PREMIER_BOOT (la cérémonie)", integrityGate(p).kind === "PREMIER_BOOT");
}
{
  const p = freshHome();
  makeDb(p);
  check("porte : base saine -> SAINE", integrityGate(p).kind === "SAINE");
}
{
  const p = freshHome();
  makeDb(p);
  const db = openDatabase(p.db);
  dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  corrupt(p.db);
  const v = integrityGate(p);
  check("porte : base corrompue -> STRUCTUREL (restauration auto)", v.kind === "STRUCTUREL");
}
{
  // Le cas mesuré au banc : un fichier de 0 octet est une base VALIDE et vide (quick_check dit « ok »).
  // Avec des snapshots à côté, c'est une PERTE, pas une naissance : Sophia ne doit jamais renaître vierge.
  const p = freshHome();
  makeDb(p);
  const db = openDatabase(p.db);
  dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  fs.rmSync(p.db + "-wal", { force: true });
  fs.rmSync(p.db + "-shm", { force: true });
  fs.writeFileSync(p.db, ""); // tronqué à zéro (disque plein / création interrompue)
  const v = integrityGate(p);
  check("porte : base VIDE + snapshots -> STRUCTUREL (jamais renaître vierge par accident)", v.kind === "STRUCTUREL");
}
{
  const p = freshHome();
  fs.mkdirSync(path.dirname(p.db), { recursive: true });
  fs.writeFileSync(p.db, ""); // base vide SANS snapshot = premier boot légitime
  check("porte : base VIDE sans snapshot -> PREMIER_BOOT (légitime)", integrityGate(p).kind === "PREMIER_BOOT");
}
{
  const p = freshHome();
  fs.mkdirSync(path.dirname(p.db), { recursive: true });
  fs.writeFileSync(p.db, Buffer.alloc(4096, 0x42)); // pas une base SQLite du tout
  const v = integrityGate(p);
  check("porte : fichier non-SQLite -> STRUCTUREL", v.kind === "STRUCTUREL");
}

// ─── 2. Alerte-à-la-restauration : les 5 branches (AF-1 / G-A / fid4) ────────
{
  const p = freshHome();
  makeDb(p, 10);
  const db = openDatabase(p.db);
  const es = new ErasureStream(p.erasures);
  es.append({ id: 5, ts: 1000 });               // un effacement connu AVANT le snapshot
  const snap = dur.createSnapshot(db.raw, p.snapshots, 3, es.last());
  db.close();

  // (a) témoin à jour, rien après -> le SEUL silence légitime
  check("alerte : témoin à jour, aucun effacement postérieur -> silence légitime",
    checkErasureCoverage(snap, p.erasures).length === 0);

  // (b) AF-1 : un effacement POSTÉRIEUR au snapshot -> son contenu est peut-être revenu
  es.append({ id: 6, ts: 2000 });
  const af1 = checkErasureCoverage(snap, p.erasures);
  check("alerte AF-1 : effacement postérieur -> « peut-être revenu »",
    af1.some((a) => a.code === "EFFACEMENT_PEUT_ETRE_REVENU"));
  check("alerte AF-1 : le message est DIT à Yohann, pas un code nu",
    af1[0].message.includes("oublier"));

  // (c) fid4 : .meta.json absent -> « repère absent », jamais un pass silencieux
  fs.rmSync(`${snap}.meta.json`);
  check("alerte fid4 : repère de crue absent -> ALERTE",
    checkErasureCoverage(snap, p.erasures).some((a) => a.code === "CRUE_ABSENTE"));

  // (d) fid4 : .meta.json illisible (crash en plein write) -> même traitement
  fs.writeFileSync(`${snap}.meta.json`, "{ceci n'est pas du json");
  check("alerte fid4 : repère illisible -> ALERTE",
    checkErasureCoverage(snap, p.erasures).some((a) => a.code === "CRUE_ABSENTE"));
}
{
  // (e) G-A : le fail-open débusqué au croisé ciblé — témoin ABSENT (restore-catastrophe où le
  //     réplica hors-machine n'a pas été remis au chemin local) ne doit PAS se lire « rien à signaler ».
  const p = freshHome();
  makeDb(p, 10);
  const db = openDatabase(p.db);
  const es = new ErasureStream(p.erasures);
  es.append({ id: 9, ts: 1000 });
  const snap = dur.createSnapshot(db.raw, p.snapshots, 3, es.last());
  db.close();
  fs.rmSync(p.erasures); // le témoin n'a pas été restauré
  const a = checkErasureCoverage(snap, p.erasures);
  check("alerte G-A : témoin ABSENT -> ALERTE (pas un pass silencieux)", a.some((x) => x.code === "TEMOIN_ABSENT"));
}
{
  // (f) G-A : témoin EN RETARD sur le repère de crue -> son silence ne vaut rien
  const p = freshHome();
  makeDb(p, 10);
  const db = openDatabase(p.db);
  const es = new ErasureStream(p.erasures);
  es.append({ id: 40, ts: 1000 });
  const snap = dur.createSnapshot(db.raw, p.snapshots, 3, es.last()); // repère = 40
  db.close();
  fs.writeFileSync(p.erasures, JSON.stringify({ id: 3, ts: 1 }) + "\n"); // réplica ancien : max=3 < 40
  check("alerte G-A : témoin en retard sur le repère -> ALERTE",
    checkErasureCoverage(snap, p.erasures).some((a) => a.code === "TEMOIN_EN_RETARD"));

  // (g) témoin TROUÉ : le repère existe mais son enregistrement manque
  fs.writeFileSync(p.erasures, JSON.stringify({ id: 41, ts: 9 }) + "\n"); // max=41 >= 40 mais pas de 40
  check("alerte G-A : témoin troué (repère manquant) -> ALERTE",
    checkErasureCoverage(snap, p.erasures).some((a) => a.code === "TEMOIN_EN_RETARD"));
}
{
  // (h) m10 : témoin corrompu EN INTERNE -> ALERTE (readAll jette, T4)
  const p = freshHome();
  makeDb(p, 10);
  const db = openDatabase(p.db);
  const snap = dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  fs.writeFileSync(p.erasures, "pas du json\n" + JSON.stringify({ id: 1, ts: 1 }) + "\n");
  check("alerte m10 : témoin corrompu en interne -> ALERTE",
    checkErasureCoverage(snap, p.erasures).some((a) => a.code === "TEMOIN_CORROMPU"));
}
{
  // (i) crue:null LISIBLE (aucun effacement n'avait jamais eu lieu) != meta absent.
  const p = freshHome();
  makeDb(p, 10);
  const db = openDatabase(p.db);
  const snap = dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  // Témoin ABSENT : indistinguable de « réplica non restauré » -> ALERTE (fail-safe assumé), même
  // quand la crue dit « aucun effacement n'avait eu lieu ». On préfère une phrase inquiète pour rien
  // à un souvenir effacé qui revient en silence.
  check("alerte : crue:null + témoin ABSENT -> ALERTE quand même (fail-safe, indistinguable d'un témoin perdu)",
    checkErasureCoverage(snap, p.erasures).some((a) => a.code === "TEMOIN_ABSENT"));
  // Témoin PRÉSENT ET VIDE : là, il PROUVE qu'il est en place et n'a rien à dire -> silence légitime.
  fs.writeFileSync(p.erasures, "");
  check("alerte : crue:null + témoin présent et vide -> silence légitime", checkErasureCoverage(snap, p.erasures).length === 0);
  new ErasureStream(p.erasures).append({ id: 1, ts: 5 }); // tout est postérieur par construction
  check("alerte : crue:null + témoin non vide -> tout est postérieur -> ALERTE",
    checkErasureCoverage(snap, p.erasures).some((a) => a.code === "EFFACEMENT_PEUT_ETRE_REVENU"));
}

// ─── 3. Restauration : archive la base douteuse, emporte les -wal/-shm ───────
{
  const p = freshHome();
  makeDb(p, 500);
  const db = openDatabase(p.db);
  const before = db.raw.prepare("SELECT count(*) c FROM governor_budget_ledger").get().c;
  dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  fs.writeFileSync(p.db + "-wal", Buffer.alloc(4096, 0xff)); // -wal résiduel de l'ancienne base
  corrupt(p.db); // (supprime -wal/-shm puis écrase) -> on le recrée juste après pour le test
  fs.writeFileSync(p.db + "-wal", Buffer.alloc(4096, 0xff));

  const r = restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending);
  check("restauration : effectuée", r.restored === true);
  check("restauration : base douteuse ARCHIVÉE, jamais détruite", r.archivedTo && fs.existsSync(r.archivedTo));
  check("restauration : le -wal de l'ancienne base n'est PAS laissé à côté de la base restaurée",
    !fs.existsSync(p.db + "-wal"));
  const rdb = openDatabase(p.db);
  const after = rdb.raw.prepare("SELECT count(*) c FROM governor_budget_ledger").get().c;
  rdb.close();
  check("restauration : la base restaurée est saine et porte les données", after === before);
  check("restauration : verdict SAINE après restauration", integrityGate(p).kind === "SAINE");
}
{
  const p = freshHome();
  makeDb(p, 10);
  corrupt(p.db);
  const r = restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending);
  check("restauration : aucun snapshot -> échec honnête (pas de faux succès)", r.restored === false);
}
{
  // Le plan dit « le dernier BON snapshot », pas « le dernier ». Si le plus récent est illisible
  // (secteur mort), remonter le temps vaut infiniment mieux que renoncer à toute la mémoire.
  const p = freshHome();
  makeDb(p, 300);
  const db = openDatabase(p.db);
  const vieux = dur.createSnapshot(db.raw, p.snapshots, 5, null); // bon
  db.raw.prepare("INSERT INTO governor_budget_ledger(ts,origin,kind) VALUES(?,?,?)").run(1, "autonome", "apres");
  const recent = dur.createSnapshot(db.raw, p.snapshots, 5, null); // sera corrompu
  db.close();
  corrupt(recent); // le PLUS RÉCENT est illisible

  const g = findGoodSnapshot(p.snapshots);
  check("restauration : le dernier BON snapshot est trouvé en écartant les illisibles",
    g.good === vieux && g.skipped === 1);
  corrupt(p.db);
  const r = restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending);
  check("restauration : un snapshot récent illisible n'empêche pas de récupérer un plus ancien", r.restored === true);
  check("restauration : les snapshots écartés sont COMPTÉS (on a perdu plus que le minimum -> à dire)", r.skipped === 1);
  check("restauration : la base restaurée est saine", integrityGate(p).kind === "SAINE");
}
{
  // Tous les snapshots illisibles -> échec honnête, pas un faux succès sur une base pourrie.
  const p = freshHome();
  makeDb(p, 300);
  const db = openDatabase(p.db);
  const s1 = dur.createSnapshot(db.raw, p.snapshots, 5, null);
  db.close();
  corrupt(s1);
  const r = restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending);
  check("restauration : tous les snapshots illisibles -> échec honnête", r.restored === false && r.skipped === 1);
}

// ─── 3bis. MAJEUR conv 35 — l'alerte de restauration est DURABLE (survit à une coupure) ──
{
  const p = freshHome();
  makeDb(p, 10);
  const db = openDatabase(p.db);
  const es = new ErasureStream(p.erasures);
  es.append({ id: 3, ts: 1000 });
  const snap = dur.createSnapshot(db.raw, p.snapshots, 3, es.last()); // repère = 3
  db.close();
  es.append({ id: 4, ts: 2000 }); // effacement POSTÉRIEUR au snapshot -> AF-1 doit alerter
  corrupt(p.db);
  const r = restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending);
  check("MAJEUR : le sentinel est écrit AVANT le retour (survivrait à un crash post-commit)",
    fs.existsSync(p.restorePending));
  const pending = readRestorePending(p.restorePending);
  check("MAJEUR : le sentinel porte l'alerte AF-1", pending.some((a) => a.code === "EFFACEMENT_PEUT_ETRE_REVENU"));
  check("MAJEUR : le sentinel = ce que la restauration a renvoyé", r.alerts.length === pending.length);
  // Acquittement (geste d'une couche aval) -> le sentinel disparaît, l'alerte ne re-surface plus.
  acknowledgeRestorePending(p.restorePending);
  check("MAJEUR : après acquittement, plus rien en attente", readRestorePending(p.restorePending).length === 0);
}
{
  // Fusion : deux restaurations non acquittées n'écrasent pas leurs alertes (union par code).
  const p = freshHome();
  writeRestorePending(p.restorePending, [{ code: "TEMOIN_ABSENT", message: "vieux doute" }]);
  writeRestorePending(p.restorePending, [{ code: "EFFACEMENT_PEUT_ETRE_REVENU", message: "nouveau doute" }]);
  const merged = readRestorePending(p.restorePending);
  check("MAJEUR : le sentinel FUSIONNE (ne perd pas une alerte non acquittée)",
    merged.length === 2 && merged.some((a) => a.code === "TEMOIN_ABSENT") && merged.some((a) => a.code === "EFFACEMENT_PEUT_ETRE_REVENU"));
}
{
  // Un sentinel illisible ne se lit jamais comme « rien à signaler » (fail-safe).
  const p = freshHome();
  fs.mkdirSync(p.home, { recursive: true });
  fs.writeFileSync(p.restorePending, "{corrompu");
  check("MAJEUR : sentinel illisible -> alerte (jamais un silence)",
    readRestorePending(p.restorePending).some((a) => a.code === "SENTINEL_ILLISIBLE"));
}
{
  // MINEUR re-croisé conv 35 : un JSON VALIDE mais MAL FORMÉ ne doit pas non plus se lire en silence.
  const p = freshHome();
  fs.mkdirSync(p.home, { recursive: true });
  for (const [nom, contenu] of [["{}", "{}"], ["{alerts:null}", '{"alerts":null}'],
       ["nombre", "123"], ["tableau top-level", "[]"], ["alertes non-objets", '{"alerts":[1,2]}'],
       ["alerte sans message", '{"alerts":[{"code":"X"}]}']]) {
    fs.writeFileSync(p.restorePending, contenu);
    const got = readRestorePending(p.restorePending);
    check(`sentinel-1 : JSON mal formé « ${nom} » -> SENTINEL_ILLISIBLE (jamais un silence)`,
      got.length === 1 && got[0].code === "SENTINEL_ILLISIBLE");
  }
  // Contrôle : une forme VALIDE se lit normalement (pas de faux positif).
  fs.writeFileSync(p.restorePending, JSON.stringify({ alerts: [{ code: "TEMOIN_ABSENT", message: "m" }] }));
  check("sentinel-1 : une forme valide se lit normalement", readRestorePending(p.restorePending)[0].code === "TEMOIN_ABSENT");
}

// ─── 3ter. R1 conv 35 — un -wal verrouillé fait ABANDONNER, jamais restaurer par-dessus ──
{
  // (a) evacuateSidecarFiles détecte un -wal qui a RÉSISTÉ (déterministe, noms contrôlés) : un -wal
  //     dossier non vide dont la cible de déplacement est elle-même un dossier non vide -> rename EPERM,
  //     rmSync (sans recursive) EISDIR -> il survit. C'est le cas « locker externe » sans vrai verrou OS.
  const p = freshHome();
  const dbwal = p.db + "-wal";
  const archwal = p.db + ".corrupt-9-wal";
  fs.mkdirSync(dbwal, { recursive: true }); fs.writeFileSync(path.join(dbwal, "a"), "x");
  fs.mkdirSync(archwal, { recursive: true }); fs.writeFileSync(path.join(archwal, "b"), "y");
  const survivant = evacuateSidecarFiles(p.db, p.db + ".corrupt-9");
  check("R1 : evacuateSidecarFiles détecte un -wal qui a résisté", survivant === "-wal" && fs.existsSync(dbwal));
  fs.rmSync(dbwal, { recursive: true, force: true });
  fs.rmSync(archwal, { recursive: true, force: true });
}
{
  // (b) restoreLatestSnapshot ABANDONNE si l'évacuation signale un survivant (couture _evacuate) :
  //     il n'installe PAS la base restaurée par-dessus le journal empoisonné.
  const p = freshHome();
  makeDb(p, 300);
  const db = openDatabase(p.db);
  dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  corrupt(p.db);
  const r = restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending, { _evacuate: () => "-wal" });
  check("R1 : -wal résiduel signalé -> restauration ABANDONNÉE (pas de re-corruption)", r.restored === false);
  check("R1 : l'abandon est expliqué (journal résiduel verrouillé)", /journal résiduel/.test(r.detail));
  check("R1 : la base restaurée n'a PAS été installée par-dessus le -wal empoisonné", !fs.existsSync(p.db));
}

// ─── 3quater. NIT conv 35 — rotation des archives de bases douteuses (borne « des années ») ──
{
  const p = freshHome();
  makeDb(p, 50);
  const db = openDatabase(p.db);
  dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  // 12 corruptions successives -> au plus 10 archives .corrupt-N gardées.
  for (let i = 0; i < 12; i++) {
    corrupt(p.db);
    restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending);
  }
  const archives = fs.readdirSync(path.dirname(p.db)).filter((f) => /\.corrupt-\d+$/.test(f));
  check("NIT : les archives de bases douteuses sont bornées (rotation garder 10)", archives.length <= 10);
}
{
  // NIT re-croisé conv 35 (3e tour) : un `-wal`/`-shm` d'archive ORPHELIN (sans son `.corrupt-N` principal)
  // est purgé à la rotation — sinon il fuit sans borne sur « des années ».
  const p = freshHome();
  makeDb(p, 50);
  const db = openDatabase(p.db);
  dur.createSnapshot(db.raw, p.snapshots, 3, null);
  db.close();
  fs.writeFileSync(p.db + ".corrupt-99-wal", "orphelin"); // un -wal d'archive sans son principal
  corrupt(p.db);
  restoreLatestSnapshot(p.db, p.snapshots, p.erasures, p.restorePending); // -> rotation
  check("NIT : un -wal d'archive orphelin est purgé à la rotation (pas de fuite)",
    !fs.existsSync(p.db + ".corrupt-99-wal"));
}

// ─── 4. Instance unique ──────────────────────────────────────────────────────
{
  const p = freshHome();
  let focusDemande = 0;
  const first = await si.acquireSingleInstance({
    pipe: p.instancePipe, lockfile: p.instanceLock, onFocusRequested: () => focusDemande++,
  });
  check("instance : le premier obtient le verrou (PRIMARY)", first.kind === "PRIMARY");

  const second = await si.acquireSingleInstance({ pipe: p.instancePipe, lockfile: p.instanceLock });
  check("instance : la 2e trouve un primaire SAIN -> focus + sortie", second.kind === "SECONDARY_FOCUSED");
  await new Promise((r) => setTimeout(r, 100));
  check("instance : le primaire a bien reçu la demande de focus", focusDemande === 1);

  first.release();
  const third = await si.acquireSingleInstance({ pipe: p.instancePipe, lockfile: p.instanceLock });
  check("instance : après release, le verrou est reprenable", third.kind === "PRIMARY");
  third.release();
}
{
  // Primaire FIGÉ : le pipe est tenu par un process vivant qui n'acquitte JAMAIS.
  const p = freshHome();
  const holder = path.join(p.home, "holder.mjs");
  fs.writeFileSync(holder, `
import * as net from "node:net";
const s = net.createServer(() => { /* MUET : ne répond jamais -> figé */ });
s.listen(${JSON.stringify(p.instancePipe)}, () => console.log("HOLDING"));
setInterval(() => {}, 1000);
`);
  const child = spawn(process.execPath, [holder], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((r) => child.stdout.once("data", r));

  // (a) lockfile ABSENT -> identité inconnue -> on S'ABSTIENT (fail-safe M2), on ne tue pas au hasard
  const blocked = await si.acquireSingleInstance({
    pipe: p.instancePipe, lockfile: path.join(p.home, "inexistant.lock"), focusAckTimeoutMs: 400,
  });
  check("instance : primaire figé + identité INCONNUE -> BLOCKED (on s'abstient, jamais tuer un innocent)",
    blocked.kind === "BLOCKED");
  check("instance : le blocage est expliqué, pas muet", /identité inconnue/.test(blocked.reason));

  // (b) lockfile désignant un PID RECYCLÉ (nom d'image différent) -> on S'ABSTIENT (garde M2)
  fs.writeFileSync(p.instanceLock, `${child.pid} unautreprogramme.exe`);
  const recycled = await si.acquireSingleInstance({
    pipe: p.instancePipe, lockfile: p.instanceLock, focusAckTimeoutMs: 400,
  });
  check("instance : PID recyclé (nom d'image ≠) -> BLOCKED, jamais de kill (garde M2)", recycled.kind === "BLOCKED");
  check("instance : le PID recyclé est nommé comme tel", /recyclé/.test(recycled.reason));
  check("instance : le process innocent est TOUJOURS VIVANT", si.defaultIsAlive(child.pid));

  // (b-bis) Un primaire simplement OCCUPÉ (node:sqlite est SYNCHRONE : son event loop est bloqué le
  // temps d'ouvrir sa base) ne doit PAS être pris pour un figé et tué. Ici il n'acquitte pas pendant
  // ~250 ms puis répond : avec plusieurs tentatives, il est reconnu SAIN.
  {
    const p2 = freshHome();
    const occupe = path.join(p2.home, "occupe.mjs");
    fs.writeFileSync(occupe, `
import * as net from "node:net";
const debut = Date.now();
const s = net.createServer((sock) => {
  if (Date.now() - debut < 250) return;        // « occupé » : muet au tout début
  sock.end("sophia-focus-ack");
});
s.listen(${JSON.stringify(p2.instancePipe)}, () => console.log("HOLDING"));
setInterval(() => {}, 1000);
`);
    const busy = spawn(process.execPath, [occupe], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((r) => busy.stdout.once("data", r));
    fs.writeFileSync(p2.instanceLock, `${busy.pid} ${path.basename(process.execPath).toLowerCase()}`);
    const r = await si.acquireSingleInstance({
      pipe: p2.instancePipe, lockfile: p2.instanceLock, focusAckTimeoutMs: 150, focusAttempts: 4,
    });
    check("instance : un primaire OCCUPÉ (muet un instant) est reconnu SAIN, pas tué", r.kind === "SECONDARY_FOCUSED");
    check("instance : le primaire occupé est TOUJOURS VIVANT", si.defaultIsAlive(busy.pid));
    busy.kill("SIGKILL");
  }

  // (c) identité PROUVÉE (pid + nom d'image concordants) -> récupération du figé
  fs.writeFileSync(p.instanceLock, `${child.pid} ${path.basename(process.execPath).toLowerCase()}`);
  const recovered = await si.acquireSingleInstance({
    pipe: p.instancePipe, lockfile: p.instanceLock, focusAckTimeoutMs: 400,
  });
  check("instance : primaire figé + identité PROUVÉE -> récupéré, verrou repris", recovered.kind === "PRIMARY");
  check("instance : le primaire figé a bien été tué", !si.defaultIsAlive(child.pid));
  if (recovered.kind === "PRIMARY") recovered.release();
  try { child.kill("SIGKILL"); } catch { /* déjà mort */ }
}
{
  // R3 conv 35 — reprise du pipe par BUDGET borné, pas un sleep fixe : même si l'OS tarde un peu à
  // libérer le pipe après le kill, la reprise réussit (tant que c'est dans le budget). On force un
  // budget large et un délai court pour prouver la boucle de reclaim.
  const p = freshHome();
  const holder = path.join(p.home, "holder-r3.mjs");
  fs.writeFileSync(holder, `
import * as net from "node:net";
const s = net.createServer(() => { /* muet -> figé */ });
s.listen(${JSON.stringify(p.instancePipe)}, () => console.log("HOLDING"));
setInterval(() => {}, 1000);
`);
  const child = spawn(process.execPath, [holder], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((r) => child.stdout.once("data", r));
  fs.writeFileSync(p.instanceLock, `${child.pid} ${path.basename(process.execPath).toLowerCase()}`);
  const r = await si.acquireSingleInstance({
    pipe: p.instancePipe, lockfile: p.instanceLock, focusAckTimeoutMs: 200, focusAttempts: 2,
    reclaimAttempts: 20, reclaimDelayMs: 100, // budget ~2 s : couvre largement la libération OS
  });
  check("R3 : reprise du pipe par budget borné après un kill réussi -> PRIMARY", r.kind === "PRIMARY");
  if (r.kind === "PRIMARY") r.release();
  try { child.kill("SIGKILL"); } catch { /* déjà mort */ }
}

// ─── 5. Le nom du pipe isole les maisons (un banc ne bloque pas la vraie Sophia) ──
{
  const a = resolvePaths(path.join(base, "maison-a"));
  const b = resolvePaths(path.join(base, "maison-b"));
  check("instance : deux SOPHIA_HOME distincts -> deux verrous distincts", a.instancePipe !== b.instancePipe);
  check("instance : le même SOPHIA_HOME -> le même verrou", resolvePaths(a.home).instancePipe === a.instancePipe);
}

fs.rmSync(base, { recursive: true, force: true });

for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T5 OK : tous les critères passent"); process.exit(0); }
else { console.error(`\nU-T5 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
