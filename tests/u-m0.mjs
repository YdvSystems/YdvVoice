// U-M0 — le SCHÉMA de la mémoire (plan 02, M0). Prouve les invariants des 6 pièces sur une base JETABLE :
// épisodique immuable + verrou fail-closed, empreintes XOR, sémantique write-once NULL-safe, artefacts +
// chronique, knowledge, index dérivés (FTS5/vec0) + journaux. Patron des tests DB socle (u-t1/u-t4).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const results = [];
const check = (name, cond) => results.push([name, !!cond]);
/** true si `fn` LÈVE (une contrainte/trigger a refusé). */
const refused = (fn) => { try { fn(); return false; } catch { return true; } };
/** true si `fn` NE lève PAS (l'opération est acceptée). */
const accepted = (fn) => { try { fn(); return true; } catch { return false; } };

const dbPath = path.join(root, ".sophia-home-dev", "u-m0.sqlite");
const clean = () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f); } catch { /* absent */ } }
};
clean();

/** Le patron de triggers 2→3 (générateur) : insert-only + gate fail-closed, appliqué à une table jetable
 *  avec SA table-garde jetable → on peut la mettre dans les états impossibles sur erase_gate (M-3). */
function immutableTriggers(table, gate) {
  return `
    CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
      WHEN NOT EXISTS (SELECT 1 FROM ${gate} WHERE open=1)
      BEGIN SELECT RAISE(ABORT, '${table}: immuable'); END;
    CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
      WHEN NOT EXISTS (SELECT 1 FROM ${gate} WHERE open=1)
      BEGIN SELECT RAISE(ABORT, '${table}: immuable'); END;`;
}

let db = openDatabase(dbPath);
let raw = db.raw;
const run = (sql, ...args) => raw.prepare(sql).run(...args);
const get = (sql, ...args) => raw.prepare(sql).get(...args);
const cols = (table) => raw.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
const tableExists = (name) => !!get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name);
let closed = false;

try {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // PIÈCE 1 — épisodique immuable + verrou
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  run("INSERT INTO sessions(id,mode,started_at) VALUES(1,'conversation',100)");
  check("p1 insert conversations OK", accepted(() =>
    run("INSERT INTO conversations(id,session_id,role,content,created_at) VALUES(1,1,'user','bonjour sophia',100)")));
  check("p1 UPDATE conversations refusé (verrou, sas fermé)", refused(() => run("UPDATE conversations SET content='x' WHERE id=1")));
  check("p1 DELETE conversations refusé (verrou, sas fermé)", refused(() => run("DELETE FROM conversations WHERE id=1")));
  // MAJEUR croisé conv 61 : INSERT OR REPLACE ne doit PAS contourner le verrou (recursive_triggers=ON fait
  // tirer le BEFORE DELETE sur la suppression implicite du REPLACE). Sans le PRAGMA, ce test ÉCHOUE (le
  // REPLACE passait → falsification + FTS fantôme).
  check("p1 INSERT OR REPLACE conversations refusé (le verrou tient face au REPLACE — recursive_triggers)", refused(() =>
    run("INSERT OR REPLACE INTO conversations(id,session_id,role,content,created_at) VALUES(1,1,'user','FALSIFIE',999)")));
  check("p1 le tour immuable est INTACT après le REPLACE refusé", get("SELECT content FROM conversations WHERE id=1").content === "bonjour sophia");

  // sas happy-path : open=1 → DELETE → open=0, UNE transaction
  run("INSERT INTO conversations(id,session_id,role,content,created_at) VALUES(2,1,'user','a effacer',100)");
  raw.exec("BEGIN");
  run("UPDATE erase_gate SET open=1");
  run("DELETE FROM conversations WHERE id=2");
  run("UPDATE erase_gate SET open=0");
  raw.exec("COMMIT");
  check("p1 sas open->DELETE->close OK", !get("SELECT id FROM conversations WHERE id=2"));
  check("p1 gate refermée après le sas", get("SELECT open FROM erase_gate WHERE id=0").open === 0);

  // rollback du sas → garde refermée (jamais persistée ouverte) + conversation restaurée
  run("INSERT INTO conversations(id,session_id,role,content,created_at) VALUES(2,1,'user','a effacer',100)");
  raw.exec("BEGIN");
  run("UPDATE erase_gate SET open=1");
  run("DELETE FROM conversations WHERE id=2");
  raw.exec("ROLLBACK");
  check("p1 rollback du sas → garde refermée (open=0)", get("SELECT open FROM erase_gate WHERE id=0").open === 0);
  check("p1 rollback du sas → conversation restaurée", !!get("SELECT id FROM conversations WHERE id=2"));

  // erase_gate : singleton indestructible + CHECK(id=0)
  check("p1 DELETE erase_gate refusé (singleton indestructible)", refused(() => run("DELETE FROM erase_gate WHERE id=0")));
  check("p1 2e ligne erase_gate refusée (CHECK id=0)", refused(() => run("INSERT INTO erase_gate(id,open) VALUES(1,0)")));

  // fail-closed prouvé sur RÉPLIQUE JETABLE (états impossibles sur erase_gate) + test génératif 2→3 (M-3)
  raw.exec("CREATE TABLE _jg(id INTEGER PRIMARY KEY, open INTEGER)"); // sans NOT NULL/CHECK : états dégénérés
  raw.exec("CREATE TABLE _ji(id INTEGER PRIMARY KEY, v TEXT)");
  raw.exec(immutableTriggers("_ji", "_jg"));
  run("INSERT INTO _ji(id,v) VALUES(1,'a')");
  check("p1 fail-closed : garde ABSENTE (0 ligne) → UPDATE refusé", refused(() => run("UPDATE _ji SET v='b' WHERE id=1")));
  run("INSERT INTO _jg(id,open) VALUES(0,NULL)");
  check("p1 fail-closed : open=NULL → DELETE refusé", refused(() => run("DELETE FROM _ji WHERE id=1")));
  run("INSERT INTO _jg(id,open) VALUES(1,0)"); // 2e ligne, aucune open=1
  check("p1 fail-closed : 2e ligne sans open=1 → UPDATE refusé", refused(() => run("UPDATE _ji SET v='b' WHERE id=1")));
  run("UPDATE _jg SET open=1 WHERE id=0");
  check("p1 patron 2→3 : gate ouverte → UPDATE accepté (insert-only levé)", accepted(() => run("UPDATE _ji SET v='b' WHERE id=1")));
  run("UPDATE _jg SET open=0 WHERE id=0");
  check("p1 fail-closed : garde refermée → DELETE refusé", refused(() => run("DELETE FROM _ji WHERE id=1")));
  raw.exec("DROP TABLE _ji; DROP TABLE _jg");

  // sessions mutable (enveloppe) — pas de trigger
  check("p1 sessions mutable (UPDATE summary/last_active OK)", accepted(() =>
    run("UPDATE sessions SET summary='resume', last_active=200 WHERE id=1")));
  // mode=dictee = enveloppe-seule : session valide SANS aucune ligne conversations (S3/T15)
  run("INSERT INTO sessions(id,mode,started_at) VALUES(9,'dictee',100)");
  check("p1 mode=dictee accepté + enveloppe-seule (0 conversations)",
    !!get("SELECT id FROM sessions WHERE id=9 AND mode='dictee'") &&
    get("SELECT count(*) c FROM conversations WHERE session_id=9").c === 0);
  check("p1 mode hors vocab refusé", refused(() => run("INSERT INTO sessions(id,mode) VALUES(8,'blabla')")));

  // turn_signals : purgeable (rétention bornée = PAS insert-only). L'invariant « rétention ≥ borne backlog »
  // (m-4) est un couplage RUNTIME asserté quand les valeurs existent (M5) ; ici, le STRUCTUREL.
  run("INSERT INTO turn_signals(id,conversation_id,reason,captured_at) VALUES(1,1,'endpoint',100)");
  check("p1 turn_signals insert OK", !!get("SELECT id FROM turn_signals WHERE id=1"));
  check("p1 turn_signals purgeable (DELETE OK — rétention, pas insert-only)", accepted(() => run("DELETE FROM turn_signals WHERE id=1")));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // PIÈCE 2 — empreintes (XOR)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  check("p2 ancrage conversation_id OK", accepted(() => run("INSERT INTO imprints(id,conversation_id,noted_by) VALUES(1,1,'micro')")));
  check("p2 ancrage session_id OK (rêverie)", accepted(() => run("INSERT INTO imprints(id,session_id,noted_by) VALUES(2,1,'couche3')")));
  check("p2 XOR : deux ancres → refusé", refused(() => run("INSERT INTO imprints(id,conversation_id,session_id,noted_by) VALUES(3,1,1,'micro')")));
  check("p2 XOR : aucune ancre → refusé", refused(() => run("INSERT INTO imprints(id,noted_by) VALUES(4,'micro')")));
  check("p2 noted_by hors des trois → refusé", refused(() => run("INSERT INTO imprints(id,conversation_id,noted_by) VALUES(5,1,'autre')")));
  check("p2 consumed 0→1 accepté (mutable, non verrouillée)", accepted(() => run("UPDATE imprints SET consumed=1 WHERE id=1")));
  check("p2 DELETE imprint par orchestrateur accepté (support cascade M8)", accepted(() => run("DELETE FROM imprints WHERE id=2")));
  // FK M0 mordante (fidélité croisé conv 61) : foreign_keys=ON n'est pas que documentaire — un ancrage vers
  // une conversation ABSENTE est refusé. Sans le PRAGMA (retour à OFF), ce test ÉCHOUE.
  check("p2 FK M0 : imprint → conversation absente refusé (foreign_keys ON mord)", refused(() => run("INSERT INTO imprints(id,conversation_id,noted_by) VALUES(50,99999,'micro')")));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // PIÈCE 3 — sémantique (write-once NULL-safe)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  run("INSERT INTO facts(id,content,category,status,valid_from,created_at) VALUES(1,'Yohann aime le cafe','preference','PROVISIONAL',NULL,100)");
  check("p3 insert facts OK", !!get("SELECT id FROM facts WHERE id=1"));
  // #2 croisé conv 61 : id scellé — muter le rowid laissait une entrée FTS/vec orpheline. Sans `NEW.id IS NOT
  // OLD.id` dans le trigger, ce test ÉCHOUE.
  check("p3 id scellé : UPDATE facts.id refusé (évite l'orphelin FTS/vec)", refused(() => run("UPDATE facts SET id=999 WHERE id=1")));
  // MAJEUR re-croisé conv 61 : INSERT OR REPLACE ne doit PAS réécrire un fait write-once (facts n'a pas de
  // BEFORE DELETE → recursive_triggers ne le couvre pas ; le garde BEFORE INSERT le fait). Sans le garde, ce
  // test ÉCHOUE (content réécrit + vecteur désynchronisé).
  check("p3 INSERT OR REPLACE facts refusé (write-once REPLACE-proof)", refused(() =>
    run("INSERT OR REPLACE INTO facts(id,content,category,created_at) VALUES(1,'REECRIT PAR REPLACE','monde',100)")));
  check("p3 fait write-once INTACT après REPLACE refusé", get("SELECT content FROM facts WHERE id=1").content === "Yohann aime le cafe");
  check("p3 UPDATE content refusé (write-once T7)", refused(() => run("UPDATE facts SET content='x' WHERE id=1")));
  check("p3 UPDATE category refusé", refused(() => run("UPDATE facts SET category='monde' WHERE id=1")));
  check("p3 UPDATE created_at refusé", refused(() => run("UPDATE facts SET created_at=999 WHERE id=1")));
  check("p3 UPDATE status/valid_to/importance/confidence/support_count accepté", accepted(() =>
    run("UPDATE facts SET status='ACTIVE', valid_to=200, importance=0.5, confidence=0.9, support_count=1 WHERE id=1")));
  // NULL-safe (b-m2) : transition NULL↔valeur sur valid_from DOIT être refusée (le piège de `<>`)
  check("p3 NULL-safe : valid_from NULL→valeur refusé", refused(() => run("UPDATE facts SET valid_from=50 WHERE id=1")));
  run("INSERT INTO facts(id,content,category,valid_from,created_at) VALUES(2,'fait date','monde',50,100)");
  check("p3 NULL-safe : valid_from valeur→NULL refusé", refused(() => run("UPDATE facts SET valid_from=NULL WHERE id=2")));
  check("p3 category hors vocab refusé", refused(() => run("INSERT INTO facts(id,content,category) VALUES(3,'x','xxx')")));
  check("p3 status hors vocab refusé", refused(() => run("INSERT INTO facts(id,content,category,status) VALUES(3,'x','monde','XXX')")));

  run("INSERT INTO fact_sources(id,fact_id,source_kind,source_id,observed_at) VALUES(1,1,'tour',1,100)");
  check("p3 source_kind='reactivation' accepté (#E)", accepted(() => run("INSERT INTO fact_sources(id,fact_id,source_kind,source_id) VALUES(2,1,'reactivation',1)")));
  check("p3 source_kind hors vocab refusé", refused(() => run("INSERT INTO fact_sources(id,fact_id,source_kind) VALUES(3,1,'xxx')")));
  check("p3 index fact_sources(source_kind,source_id) présent (b-m6)",
    raw.prepare("PRAGMA index_list(fact_sources)").all().some((i) => {
      const c = raw.prepare(`PRAGMA index_info(${i.name})`).all().map((x) => x.name);
      return c.includes("source_kind") && c.includes("source_id");
    }));

  check("p3 SUPERSEDES sans basis refusé", refused(() => run("INSERT INTO fact_relations(id,from_fact_id,relation,to_fact_id) VALUES(1,1,'SUPERSEDES',2)")));
  check("p3 CONTRADICTS sans basis accepté (les deux gardés)", accepted(() => run("INSERT INTO fact_relations(id,from_fact_id,relation,to_fact_id) VALUES(2,1,'CONTRADICTS',2)")));
  check("p3 relation hors vocab refusée", refused(() => run("INSERT INTO fact_relations(id,from_fact_id,relation,to_fact_id) VALUES(3,1,'XXX',2)")));
  check("p3 CHECK anti-auto-relation : from_fact_id = to_fact_id refusé (croisé conv 61)", refused(() => run("INSERT INTO fact_relations(id,from_fact_id,relation,to_fact_id) VALUES(4,1,'CONTRADICTS',1)")));
  check("p3 DELETE facts accepté (seul chemin M8 ; facts hors verrou)", accepted(() => {
    run("DELETE FROM fact_relations WHERE from_fact_id=2 OR to_fact_id=2"); // FK enfants d'abord
    run("DELETE FROM facts WHERE id=2");
  }));
  // Convergence conv 61 — l'invariant « never-reuse » : socle de la frontière discipline-écrivain (option (a),
  // actée par Yohann). Le CONTRAT NON NÉGOCIABLE (⛔) qui la complète = M1/M2/M8 DOIVENT tester « zéro vecteur
  // orphelin après effacement » + « écriture en AUTOINCREMENT, jamais d'id explicite » (gravé §7 + mémoire).
  run("INSERT INTO facts(content,category,created_at) VALUES('never-reuse A','monde',1)"); // id auto
  const nrA = get("SELECT id FROM facts WHERE content='never-reuse A'").id;
  run("DELETE FROM facts WHERE id=?", nrA);
  run("INSERT INTO facts(content,category,created_at) VALUES('never-reuse B','monde',1)"); // id auto
  check("p3 AUTOINCREMENT ne réutilise jamais un id supprimé (invariant never-reuse)", get("SELECT id FROM facts WHERE content='never-reuse B'").id > nrA);
  check("p3 CHECK(id>0) : id négatif explicite refusé (protège le garde no_reinsert, note 2)", refused(() => run("INSERT INTO facts(id,content,category) VALUES(-1,'x','monde')")));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // PIÈCE 4 — memory_artifacts + chronicle
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  run("INSERT INTO memory_artifacts(id,name,version,content,created_at) VALUES(1,'user_model',1,'v1',100)");
  check("p4 memory_artifacts insert version OK", !!get("SELECT id FROM memory_artifacts WHERE id=1"));
  check("p4 UPDATE d'une version refusé (immuable)", refused(() => run("UPDATE memory_artifacts SET content='x' WHERE id=1")));
  check("p4 nouvelle version OK (version++)", accepted(() => run("INSERT INTO memory_artifacts(id,name,version,content,created_at) VALUES(2,'user_model',2,'v2',200)")));
  check("p4 UNIQUE(name,version) : 2e (user_model,2) refusé (b-m3)", refused(() => run("INSERT INTO memory_artifacts(id,name,version,content) VALUES(3,'user_model',2,'dup')")));
  check("p4 DELETE d'une vieille version OK (rotation bornée N)", accepted(() => run("DELETE FROM memory_artifacts WHERE id=1")));
  // expurgation d'une version = DELETE + réinsertion expurged_at marquée (AF-6)
  run("DELETE FROM memory_artifacts WHERE id=2");
  run("INSERT INTO memory_artifacts(id,name,version,content,expurged_at) VALUES(4,'user_model',2,'[expurge]',999)");
  check("p4 expurgation version = DELETE + réinsertion expurged_at (AF-6)", get("SELECT expurged_at FROM memory_artifacts WHERE id=4").expurged_at === 999);
  // MAJEUR re-croisé conv 61 : REPLACE-proof aussi par conflit UNIQUE(name,version) avec une id neuve.
  check("p4 INSERT OR REPLACE memory_artifacts refusé (version immuable REPLACE-proof, conflit name/version)", refused(() =>
    run("INSERT OR REPLACE INTO memory_artifacts(name,version,content) VALUES('user_model',2,'FALSIFIE')")));

  run("INSERT INTO chronicle(id,day,content,written_at) VALUES(1,'2026-07-23','le jour vecu',100)");
  check("p4 chronicle insert day OK", !!get("SELECT id FROM chronicle WHERE id=1"));
  check("p4 chronicle 2e entrée même day refusée (UNIQUE, critère 10)", refused(() => run("INSERT INTO chronicle(id,day,content) VALUES(2,'2026-07-23','doublon')")));
  check("p4 chronicle UPDATE refusé hors sas (verrou)", refused(() => run("UPDATE chronicle SET content='x' WHERE id=1")));
  check("p4 chronicle DELETE refusé hors sas (verrou)", refused(() => run("DELETE FROM chronicle WHERE id=1")));
  raw.exec("BEGIN"); run("UPDATE erase_gate SET open=1");
  run("DELETE FROM chronicle WHERE id=1");
  run("INSERT INTO chronicle(id,day,content,expurged_at) VALUES(3,'2026-07-23','[expurge]',999)");
  run("UPDATE erase_gate SET open=0"); raw.exec("COMMIT");
  check("p4 chronicle expurgation (DELETE + réinsertion) DANS le sas", get("SELECT expurged_at FROM chronicle WHERE day='2026-07-23'").expurged_at === 999);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // PIÈCE 5 — knowledge
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  run("INSERT INTO knowledge_docs(id,name,version,status,category,ingested_at) VALUES(1,'doc-a',1,'ACTIVE','temoignage',100)");
  run("INSERT INTO knowledge_chunks(id,doc_id,seq,content) VALUES(1,1,0,'sophia pense par elle meme')");
  check("p5 knowledge insert OK", !!get("SELECT id FROM knowledge_chunks WHERE id=1"));
  check("p5 chunks.content write-once (UPDATE refusé)", refused(() => run("UPDATE knowledge_chunks SET content='x' WHERE id=1")));
  // #2 croisé conv 61 : morceau IMMUABLE en entier — muter seq/id laissait aussi un orphelin FTS.
  check("p5 chunk immuable : UPDATE seq refusé (id/seq scellés, croisé conv 61)", refused(() => run("UPDATE knowledge_chunks SET seq=5 WHERE id=1")));
  check("p5 INSERT OR REPLACE chunk refusé (morceau immuable REPLACE-proof, re-croisé conv 61)", refused(() =>
    run("INSERT OR REPLACE INTO knowledge_chunks(id,doc_id,seq,content) VALUES(1,1,0,'REECRIT')")));
  check("p5 FK M0 : chunk → doc absent refusé (foreign_keys ON mord)", refused(() => run("INSERT INTO knowledge_chunks(id,doc_id,seq,content) VALUES(50,99999,0,'x')")));
  check("p5 status ACTIVE→REPLACED accepté", accepted(() => run("UPDATE knowledge_docs SET status='REPLACED' WHERE id=1")));
  check("p5 status hors vocab refusé", refused(() => run("UPDATE knowledge_docs SET status='XXX' WHERE id=1")));
  run("UPDATE knowledge_docs SET status='ACTIVE' WHERE id=1");
  check("p5 UNIQUE(name) WHERE ACTIVE : 2e doc ACTIVE même name refusé (b-m3)", refused(() => run("INSERT INTO knowledge_docs(id,name,status) VALUES(2,'doc-a','ACTIVE')")));
  check("p5 2e doc même name mais REPLACED accepté (index partiel)", accepted(() => run("INSERT INTO knowledge_docs(id,name,status) VALUES(2,'doc-a','REPLACED')")));
  check("p5 DELETE dur orchestrateur OK", accepted(() => run("DELETE FROM knowledge_docs WHERE id=2")));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // PIÈCE 6 — index dérivés (FTS5/vec0) + journaux
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // FTS insert+delete + recherche (facts hors verrou → delete direct)
  run("INSERT INTO facts(id,content,category,created_at) VALUES(10,'la francite est une pensee libre','monde',100)");
  check("p6 FTS insert → MATCH retrouve", get("SELECT rowid FROM facts_fts WHERE facts_fts MATCH 'francite'")?.rowid === 10);
  run("DELETE FROM facts WHERE id=10");
  check("p6 FTS delete → MATCH ne retrouve plus", !get("SELECT rowid FROM facts_fts WHERE facts_fts MATCH 'francite'"));

  // carve-out sessions_fts : PAS de trigger auto (summary NULL à l'insert) → maintenance explicite de l'écrivain
  check("p6 carve-out sessions_fts : summary NULL → PAS de ligne FTS auto (AF-2)", !get("SELECT rowid FROM sessions_fts WHERE sessions_fts MATCH 'conscience'"));
  run("INSERT INTO sessions_fts(rowid,summary) VALUES(1,'une belle conversation sur la conscience')"); // l'écrivain maintient
  check("p6 carve-out sessions_fts : écriture explicite → MATCH retrouve", get("SELECT rowid FROM sessions_fts WHERE sessions_fts MATCH 'conscience'")?.rowid === 1);

  // vec_* présentes, vec_conversations ABSENTE
  for (const c of ["vec_facts", "vec_sessions", "vec_chronicle", "vec_knowledge"]) check(`p6 ${c} présente`, tableExists(c));
  check("p6 vec_conversations ABSENTE (verbatim = lexical-seul)", !tableExists("vec_conversations"));

  // embed_space_meta : seed actif (4 corpus) + unicités
  check("p6 embed_space_meta : 4 corpus hybrides seedés active=1 (#C)", get("SELECT count(*) c FROM embed_space_meta WHERE active=1").c === 4);
  check("p6 partial UNIQUE active=1 : 2e active même corpus refusé (#2)", refused(() => run("INSERT INTO embed_space_meta(corpus,model,dimension,preproc_revision,active) VALUES('facts','autre',768,'v1',1)")));
  check("p6 UNIQUE(corpus,model,preproc_revision) : triplet dupliqué refusé (#B)", refused(() => run("INSERT INTO embed_space_meta(corpus,model,dimension,preproc_revision,active) VALUES('facts','bge-m3',1024,'v1',0)")));
  check("p6 ombre active=0 acceptée (cible de migration)", accepted(() => run("INSERT INTO embed_space_meta(corpus,model,dimension,preproc_revision,active) VALUES('facts','bge-m3',1024,'v2',0)")));
  check("p6 partial UNIQUE active=0 : 2e ombre même corpus refusée (#A-3)", refused(() => run("INSERT INTO embed_space_meta(corpus,model,dimension,preproc_revision,active) VALUES('facts','autre',768,'v3',0)")));

  // journaux
  check("p6 embed_failures présente (dead-letter persisté)", tableExists("embed_failures"));
  check("p6 pending_ops présente + kind CHECK (kind invalide refusé)", tableExists("pending_ops") && refused(() => run("INSERT INTO pending_ops(kind,target) VALUES('xxx','t')")));
  check("p6 pending_ops : 3 kinds valides acceptés", accepted(() => {
    run("INSERT INTO pending_ops(kind,target) VALUES('purge-session-file','a')");
    run("INSERT INTO pending_ops(kind,target) VALUES('storage-scrub','b')");
    run("INSERT INTO pending_ops(kind,target) VALUES('purge-ephemeral','c')");
  }));
  check("p6 consolidation_runs présente + persona_version (conv 17)", tableExists("consolidation_runs") && cols("consolidation_runs").includes("persona_version"));
  check("p6 consolidation_runs DISTINCTE de governor_watermarks (socle)", tableExists("governor_watermarks") && tableExists("consolidation_runs"));
  // erasures : ZÉRO colonne de contenu + consumed flippe
  check("p6 erasures : zéro colonne de contenu (trace sans contenu, T18)", !cols("erasures").some((c) => /content|summary|text|body/i.test(c)));
  run("INSERT INTO erasures(id,occurred_at,count_total,consumed) VALUES(1,100,3,0)");
  check("p6 erasures consumed flippe 0→1", accepted(() => run("UPDATE erasures SET consumed=1 WHERE id=1")) && get("SELECT consumed FROM erasures WHERE id=1").consumed === 1);

  // reconstructibilité FTS : rebuild depuis la source
  run("INSERT INTO facts(id,content,category,created_at) VALUES(20,'un fait reconstructible','monde',100)");
  raw.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
  check("p6 reconstructibilité FTS (rebuild depuis la source)", get("SELECT rowid FROM facts_fts WHERE facts_fts MATCH 'reconstructible'")?.rowid === 20);

  // ── rollup : toutes les tables de la couche 2 présentes ─────────────────────────────────────────
  const need = ["sessions","conversations","turn_signals","erase_gate","imprints","facts","fact_sources",
    "fact_relations","memory_artifacts","chronicle","knowledge_docs","knowledge_chunks","facts_fts",
    "conversations_fts","sessions_fts","chronicle_fts","knowledge_fts","vec_facts","vec_sessions",
    "vec_chronicle","vec_knowledge","embed_space_meta","embed_failures","pending_ops","consolidation_runs","erasures"];
  check("rollup : toutes les tables M0 présentes", need.every((t) => tableExists(t)));

  // ── B-α (MORDANT) : on laisse le sas OUVERT (open=1), on FERME et ROUVRE → le boot force open=0 ──
  run("UPDATE erase_gate SET open=1");
  db.close(); closed = true;
  const db2 = openDatabase(dbPath);
  check("p1 B-α : boot force erase_gate.open=0 (filet contre un open=1 persisté)",
    db2.raw.prepare("SELECT open FROM erase_gate WHERE id=0").get().open === 0);
  db2.close();
} finally {
  if (!closed) { try { db.close(); } catch { /* */ } }
}

// F2 par construction : aucune référence base dans le code du sidecar (repris de U-T1 — écrivain unique)
const sidecar = fs.readFileSync(path.join(root, "sidecar", "server.py"), "utf8").toLowerCase();
check("F2 : sidecar sans accès base (aucune ref sqlite/db/database)", !/sqlite|\.db\b|database|schema-0/.test(sidecar));

clean();

for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) {
  console.log(`\nU-M0 OK : ${results.length} critères passent`);
  process.exit(0);
} else {
  console.error(`\nU-M0 ÉCHEC : ${failed.length}/${results.length} critère(s)`);
  process.exit(1);
}
