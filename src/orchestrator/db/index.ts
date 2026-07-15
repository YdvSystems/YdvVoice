import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

// LE fichier de vérité SQLite du socle (plan 00, T1).
//
// Binding = node:sqlite (SQLite INTÉGRÉ à Node 24). Choix tracé §7 : pas de module natif
// (better-sqlite3) -> aucune recompilation ABI pour Electron, MÊME code en Node et en Electron.
// C'est une API EXPÉRIMENTALE (Stability 1) -> encapsulée ici (prise remplaçable) ; l'avertissement
// "SQLite is an experimental feature" en console est attendu et sans conséquence.
//
// Écrivain unique (F2) : cette poignée vit dans l'ORCHESTRATEUR (Electron main). Le sidecar n'en
// reçoit aucune ; il obtient ses données (empreintes) poussées via cmd.enroll.push (plus tard).

export interface Db {
  raw: DatabaseSync;
  close(): void;
}

/** Remonte depuis `start` jusqu'au dossier contenant package.json (racine du repo). */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`racine du repo introuvable (aucun package.json au-dessus de ${start})`);
}

export interface OpenOptions {
  /** Ouverture INSPECTION en lecture seule (m9) : n'écrit RIEN (ni WAL, ni schéma, ni -wal/-shm) —
   *  pour inspecter un snapshot sans le muter (chemin de restauration T5). */
  readOnly?: boolean;
}

// Écrivain unique DANS l'orchestrateur (m9) : au plus UNE poignée d'écriture par fichier à la fois.
// (L'unicité orchestrateur↔sidecar est garantie ailleurs par construction — F2 ; ceci ferme le trou
//  d'un double open d'écriture AU SEIN de l'orchestrateur lui-même.)
const openWritePaths = new Set<string>();

/**
 * Ouvre le fichier de vérité SQLite en mode WAL et applique le schéma socle s'il est absent.
 * `dbPath` : chemin du .sqlite (dev = SOPHIA_HOME jetable ; prod = G:\Sophia\db, plan 05).
 * `opts.readOnly` : ouverture d'inspection en lecture seule (ne mute rien — m9).
 */
export function openDatabase(dbPath: string, opts: OpenOptions = {}): Db {
  const abs = path.resolve(dbPath);

  if (opts.readOnly) {
    const rodb = new DatabaseSync(abs, { readOnly: true });
    return { raw: rodb, close: () => rodb.close() };
  }

  if (openWritePaths.has(abs)) {
    throw new Error(`openDatabase : une poignée d'écriture est déjà ouverte sur ${abs} (écrivain unique)`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const db = new DatabaseSync(abs);
  try {
    db.exec("PRAGMA journal_mode = WAL;");   // un seul fichier de vérité, mode WAL
    db.exec("PRAGMA foreign_keys = ON;");    // les FK des couches 02/03 deviennent réelles (conv 16)
    db.exec("PRAGMA busy_timeout = 5000;");  // ceinture (F2)
    db.exec("PRAGMA synchronous = NORMAL;"); // m8 : base EXPLICITE (trafic fréquent) ; les écritures
    // d'identité montent à FULL (T5, setSynchronous) — plus de défaut implicite qu'un changement de
    // node:sqlite (expérimental) pourrait affaiblir en silence.

    const root = findRepoRoot(__dirname);
    const schema = fs.readFileSync(path.join(root, "db", "schema-00.sql"), "utf8");
    db.exec(schema);

    // Lignes SINGLETON (état de session / drapeaux runtime) : créées une fois, jamais dupliquées.
    db.exec("INSERT OR IGNORE INTO session_state (id) VALUES (1);");
    db.exec("INSERT OR IGNORE INTO runtime_flags (id) VALUES (1);");
  } catch (e) {
    // #2 : un échec APRÈS l'ouverture (PRAGMA/schéma) ne doit ni fuiter la poignée SQLite ni laisser
    // rouvrir un 2e écrivain -> on ferme avant de propager (abs n'a jamais été ajouté au Set).
    try { db.close(); } catch { /* */ }
    throw e;
  }

  openWritePaths.add(abs);
  // #3 : un close() qui jette ne doit pas empoisonner le Set (sinon le chemin resterait verrouillé
  // en écriture jusqu'au redémarrage — ex. réouverture légitime après restauration).
  return { raw: db, close: () => { try { db.close(); } finally { openWritePaths.delete(abs); } } };
}
