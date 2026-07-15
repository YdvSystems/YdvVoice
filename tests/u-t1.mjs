// U-T1 — le WAL socle. Vérifie : les 4 tables créées, WAL actif, foreign_keys=ON (violation refusée),
// aller-retour écriture->lecture, colonnes conv16/conv20 (current_session_id nullable, secours_tainted=0),
// et F2 PAR CONSTRUCTION (le sidecar n'a aucune poignée d'écriture : aucune ref SQLite dans son code).
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

const dbPath = path.join(root, ".sophia-home-dev", "u-t1.sqlite");
const clean = () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { fs.rmSync(f); } catch { /* absent */ }
  }
};
clean();

const db = openDatabase(dbPath);
try {
  // 1. les 4 tables socle existent
  const tables = new Set(
    db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
  );
  for (const t of ["governor_watermarks", "governor_budget_ledger", "session_state", "runtime_flags"]) {
    check(`table ${t} créée`, tables.has(t));
  }
  // 2. WAL actif
  const jm = String(db.raw.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase();
  check("journal_mode = wal", jm === "wal");
  // 3. foreign_keys ON
  check("foreign_keys = ON", db.raw.prepare("PRAGMA foreign_keys").get().foreign_keys === 1);
  // 4. aller-retour écriture -> lecture
  db.raw.prepare("INSERT INTO governor_watermarks(task,last_run_at,owed) VALUES(?,?,?)").run("smoke", 111, 0);
  const wm = db.raw.prepare("SELECT task,last_run_at,owed FROM governor_watermarks WHERE task=?").get("smoke");
  check("round-trip écriture->lecture", wm && wm.task === "smoke" && wm.last_run_at === 111);
  // 5. session_state singleton : current_session_id présent et NULL au temps socle-seul (conv 16)
  const ss = db.raw.prepare("SELECT id,current_session_id,secours_tainted FROM session_state WHERE id=1").get();
  check("session_state singleton présent", ss && ss.id === 1);
  check("current_session_id présent et NULL (conv 16)", ss && ss.current_session_id === null);
  // 6. secours_tainted présent, défaut 0 (conv 20)
  check("secours_tainted défaut 0 (conv 20)", ss && ss.secours_tainted === 0);
  // 6bis. runtime_flags singleton présent, running=0 au démarrage (fid8, croisé conv 34)
  const rf = db.raw.prepare("SELECT id,running FROM runtime_flags WHERE id=1").get();
  check("runtime_flags singleton présent, running=0 (fid8)", rf && rf.id === 1 && rf.running === 0);
  // 7. foreign_keys appliqué : une violation est REFUSÉE (via tables scratch — schema-00 n'a pas de FK)
  db.raw.exec("CREATE TABLE _p(id INTEGER PRIMARY KEY); CREATE TABLE _c(id INTEGER PRIMARY KEY, p INTEGER REFERENCES _p(id));");
  let fkRefused = false;
  try { db.raw.prepare("INSERT INTO _c(id,p) VALUES(1,999)").run(); } catch { fkRefused = true; }
  check("violation de FK refusée (foreign_keys ON actif)", fkRefused);
  db.raw.exec("DROP TABLE _c; DROP TABLE _p;");
} finally {
  db.close();
}

// 8. F2 par construction : aucune référence SQLite/base dans le code du sidecar
const sidecar = fs.readFileSync(path.join(root, "sidecar", "server.py"), "utf8").toLowerCase();
check("F2 : sidecar sans accès base (aucune ref sqlite/db/database)", !/sqlite|\.db\b|database|schema-00/.test(sidecar));

clean();

for (const [name, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) {
  console.log("\nU-T1 OK : tous les critères passent");
  process.exit(0);
} else {
  console.error(`\nU-T1 ÉCHEC : ${failed.length} critère(s)`);
  process.exit(1);
}
