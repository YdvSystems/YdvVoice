// U-T4 — durabilité & récupération. Vérifie : snapshot complet et ouvrable · repère de crue ·
// rotation garder N · un temp résiduel (crash) n'abîme rien · flux d'effacements (append + last) ·
// audit JSONL (append, lecture, dernière ligne tronquée tolérée, rotation) · quick_check · synchronous.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const dur = require("../dist/src/orchestrator/db/durability.js");
const { AuditLog, ErasureStream } = require("../dist/src/orchestrator/audit/index.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = path.join(root, ".sophia-home-dev", "t4");
fs.rmSync(home, { recursive: true, force: true });

const results = [];
const check = (n, c) => results.push([n, !!c]);

// Base avec des données
const dbPath = path.join(home, "db", "sophia.sqlite");
const db = openDatabase(dbPath);
db.raw.prepare("INSERT INTO governor_watermarks(task,last_run_at,owed) VALUES(?,?,?)").run("consolidation", 42, 1);

// synchronous FULL / NORMAL (FULL=2, NORMAL=1)
dur.setSynchronous(db.raw, "FULL");
check("synchronous=FULL appliqué", db.raw.prepare("PRAGMA synchronous").get().synchronous === 2);
dur.setSynchronous(db.raw, "NORMAL");

// quick_check
check("quick_check = ok sur base saine", dur.integrityCheck(db.raw, "quick").ok);

// La porte d'intégrité doit rendre un VERDICT, jamais jeter — T5 en dépend pour choisir sa branche de
// récupération. Trou de la v1 (attrapé au banc conv 35, JAMAIS par ce test qui n'exerçait que le cas
// sain) : sur une corruption RÉELLE le PRAGMA JETTE (« database disk image is malformed ») au lieu de
// retourner des lignes -> l'exception remontait et faisait tomber le boot au lieu de restaurer.
{
  const corruptPath = path.join(home, "db", "corrompue.sqlite");
  const cdb = openDatabase(corruptPath);
  const cins = cdb.raw.prepare("INSERT INTO governor_budget_ledger(ts,origin,kind) VALUES(?,?,?)");
  for (let i = 0; i < 1500; i++) cins.run(i, "autonome", "de-quoi-remplir-plusieurs-pages-" + i);
  cdb.raw.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  cdb.close();
  fs.rmSync(`${corruptPath}-wal`, { force: true });
  fs.rmSync(`${corruptPath}-shm`, { force: true });
  const size = fs.statSync(corruptPath).size;
  const fd = fs.openSync(corruptPath, "r+");
  fs.writeSync(fd, Buffer.alloc(8192, 0xa5), 0, 8192, Math.floor(size / 2)); // pages écrasées
  fs.closeSync(fd);

  const cor = openDatabase(corruptPath, { readOnly: true });
  let verdict = null;
  let aJete = false;
  try { verdict = dur.integrityCheck(cor.raw, "quick"); } catch { aJete = true; }
  cor.close();
  check("intégrité : base corrompue -> verdict { ok:false }, sans JAMAIS jeter", !aJete && verdict && verdict.ok === false);
  check("intégrité : le verdict porte le motif (dicible)", !aJete && /malformed|not a database/.test(verdict.detail));
}

// Flux d'effacements (contenu par la couche 02 plus tard ; ici le mécanisme)
const erasures = new ErasureStream(path.join(home, "erasures.log"));
erasures.append({ id: 7, ts: 1000 });
const crue = erasures.last();

// Snapshot : complet + ouvrable + porte le repère de crue
const snapDir = path.join(home, "snapshots");
const snap1 = dur.createSnapshot(db.raw, snapDir, 2, crue);
const snapDb = openDatabase(snap1, { readOnly: true }); // m9 : inspection en lecture seule (ne mute pas)
const wm = snapDb.raw.prepare("SELECT task,owed FROM governor_watermarks WHERE task='consolidation'").get();
snapDb.close();
check("snapshot complet et ouvrable (données présentes)", wm && wm.task === "consolidation" && wm.owed === 1);
check("m9 : ouverture read-only ne crée pas de -wal (snapshot non muté)", !fs.existsSync(`${snap1}-wal`));
const meta = JSON.parse(fs.readFileSync(`${snap1}.meta.json`, "utf8"));
check("snapshot porte le repère de crue (dernier effacement)", meta.crue && meta.crue.id === 7);

// Rotation garder N (2) : 3 snapshots de plus -> il n'en reste que 2
dur.createSnapshot(db.raw, snapDir, 2, crue);
dur.createSnapshot(db.raw, snapDir, 2, crue);
dur.createSnapshot(db.raw, snapDir, 2, crue);
const remaining = fs.readdirSync(snapDir).filter((f) => f.startsWith("snapshot-") && f.endsWith(".sqlite"));
check("rotation garder N (2 snapshots max)", remaining.length === 2);

// Un temp résiduel (crash simulé) : le dernier snapshot reste ouvrable, et il est nettoyé au suivant
fs.writeFileSync(path.join(snapDir, ".snapshot-crash.tmp"), "corrompu");
const latest = dur.latestSnapshot(snapDir);
const l = openDatabase(latest, { readOnly: true });
const okLatest = l.raw.prepare("SELECT count(*) AS c FROM governor_watermarks").get().c >= 1;
l.close();
check("dernier snapshot ouvrable malgré un temp résiduel", okLatest);
dur.createSnapshot(db.raw, snapDir, 2, crue);
check("temp résiduel nettoyé au snapshot suivant", !fs.existsSync(path.join(snapDir, ".snapshot-crash.tmp")));

// N4 : createSnapshot REFUSE une transaction ouverte (garde explicite, échec clair et précoce)
db.raw.exec("BEGIN");
let txnGuard = false;
try { dur.createSnapshot(db.raw, snapDir, 2, crue); } catch { txnGuard = true; }
db.raw.exec("ROLLBACK");
check("N4 : createSnapshot refuse une transaction ouverte", txnGuard);

db.close();

// Flux d'effacements : non roté, last()
erasures.append({ id: 8, ts: 2000 });
check("flux d'effacements : append + last()", erasures.last().id === 8 && erasures.readAll().length === 2);

// Audit JSONL : append + lecture + dernière ligne tronquée tolérée + rotation par taille
const auditPath = path.join(home, "audit.jsonl");
const audit = new AuditLog(auditPath, 200, 3); // maxBytes petit pour exercer la rotation
audit.append({ evt: "boot", ts: 1 });
audit.append({ evt: "snapshot", n: 2 });
check("audit : append + lecture", audit.read().length === 2);
fs.appendFileSync(auditPath, '{"evt":"tronque"'); // JSON incomplet, sans saut de ligne
check("audit : dernière ligne tronquée tolérée (2 records valides)", audit.read().length === 2);
for (let i = 0; i < 30; i++) audit.append({ evt: "x", i });
check("audit : rotation par taille (.1 créé)", fs.existsSync(`${auditPath}.1`));

// AF-10 : un enregistrement portant du contenu conversationnel est REFUSÉ à l'écriture (garde défensive).
let af10Refused = false;
try { audit.append({ evt: "leak", text: "bonjour Sophia, comment vas-tu ?" }); } catch { af10Refused = true; }
check("AF-10 : contenu conversationnel refusé à l'audit JSONL (garde)", af10Refused);

// m4 : la garde AF-10 attrape aussi un verbatim IMBRIQUÉ (pas seulement au premier niveau).
let af10Nested = false;
try { audit.append({ evt: "turn", payload: { text: "verbatim imbriqué" } }); } catch { af10Nested = true; }
check("AF-10 : verbatim imbriqué refusé (garde récursive, m4)", af10Nested);

// fid1 : rotation par ÂGE (indépendante de la taille) — maxAgeMs=0 -> tout segment non vide roule.
const agedPath = path.join(home, "audit-age.jsonl");
const aged = new AuditLog(agedPath, 10_000_000, 3, 0);
aged.append({ evt: "a" }); // crée le segment
aged.append({ evt: "b" }); // segment non vide + âge>=0 -> rotation
check("audit : rotation par ÂGE (maxAgeMs=0 -> .1 créé, fid1)", fs.existsSync(`${agedPath}.1`));

// fid7 : le flux d'effacements est EXEMPTÉ de rotation (aucun .1 même après beaucoup d'append).
for (let i = 100; i < 140; i++) erasures.append({ id: i, ts: i });
check("flux d'effacements : jamais roté (aucun .1, fid7)", !fs.existsSync(`${path.join(home, "erasures.log")}.1`));

// m10 : une ligne illisible EN MILIEU du témoin -> ALERTE (erreur), pas un sous-rapport silencieux.
const corruptPath = path.join(home, "erasures-corrupt.log");
const es2 = new ErasureStream(corruptPath);
es2.append({ id: 1, ts: 1 });
fs.appendFileSync(corruptPath, "ceci n'est pas du json\n"); // ligne interne corrompue (suivie d'un \n)
es2.append({ id: 2, ts: 2 });                                // -> la corruption devient INTERNE
let witnessAlerted = false;
try { es2.readAll(); } catch { witnessAlerted = true; }
check("m10 : témoin d'effacements corrompu en interne -> ALERTE (pas silencieux)", witnessAlerted);

fs.rmSync(home, { recursive: true, force: true });

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T4 OK : tous les critères passent"); process.exit(0); }
else { console.error(`\nU-T4 ÉCHEC : ${failed.length} critère(s)`); process.exit(1); }
