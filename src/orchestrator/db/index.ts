import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { getLoadablePath } from "sqlite-vec";
import { findRepoRoot } from "../paths.js";

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

/** Les 4 tables du socle (schema-00). Leur présence distingue une base VIVANTE d'un fichier vierge. */
const SOCLE_TABLES = ["governor_watermarks", "governor_budget_ledger", "session_state", "runtime_flags"];

/**
 * Le schéma socle est-il présent ? (T5 Phase 1 — porte d'intégrité.)
 *
 * MESURÉ au banc (conv 35) : un fichier de 0 octet est une base SQLite parfaitement VALIDE et vide —
 * `quick_check` répond « ok ». Sans cette sonde, une base tronquée à zéro (disque plein, création
 * interrompue) passerait la porte, recevrait le schéma, et Sophia démarrerait avec une mémoire VIERGE,
 * ses snapshots intacts à côté, sans un mot. T5 croise donc ce verdict avec la présence de snapshots :
 * vierge + aucun snapshot = premier boot légitime ; vierge + snapshots = le fichier de vérité a disparu.
 */
export function isSocleSchemaPresent(db: DatabaseSync): boolean {
  try {
    const placeholders = SOCLE_TABLES.map(() => "?").join(",");
    const row = db
      .prepare(`SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`)
      .get(...SOCLE_TABLES) as { c: number } | undefined;
    return (row?.c ?? 0) === SOCLE_TABLES.length;
  } catch {
    return false; // illisible (fichier non-SQLite...) -> traité comme absent ; l'intégrité tranchera
  }
}

export interface OpenOptions {
  /** Ouverture INSPECTION en lecture seule (m9) : n'écrit RIEN (ni WAL, ni schéma, ni -wal/-shm) —
   *  pour inspecter un snapshot sans le muter (chemin de restauration T5). */
  readOnly?: boolean;
  /**
   * N'ouvre QUE si la base existe déjà — ne la CRÉE JAMAIS. Sur absence : jette.
   *
   * C'est l'invariant « Sophia ne matérialise une base VIERGE que sur un premier boot PROUVÉ » gravé PAR
   * CONSTRUCTION (re-croisé conv 35, 3e tour) : la création est réservée au seul chemin PREMIER_BOOT du
   * boot ; partout ailleurs `mustExist=true`, si bien qu'aucun chemin de récupération ne peut faire
   * renaître Sophia amnésique en recréant un fichier vide. `node:sqlite` n'a PAS de flag natif
   * « open-existing-only » (mesuré au banc : `create:false` est ignoré) -> garde applicative `existsSync`.
   * Le TOCTOU existsSync↔open est négligeable ici (instance unique garantie en Phase 0, boot séquentiel,
   * écrivain unique).
   */
  mustExist?: boolean;
}

// Écrivain unique DANS l'orchestrateur (m9) : au plus UNE poignée d'écriture par fichier à la fois.
// (L'unicité orchestrateur↔sidecar est garantie ailleurs par construction — F2 ; ceci ferme le trou
//  d'un double open d'écriture AU SEIN de l'orchestrateur lui-même.)
const openWritePaths = new Set<string>();

// Variable d'override du chemin de l'extension vec0 (patron SOPHIA_CLAUDE_EXE) — utile au packaging
// Electron (plan 05 : la DLL sera unpackée hors de l'asar), sinon getLoadablePath() la résout dans node_modules.
const VEC0_PATH_OVERRIDE = "SOPHIA_VEC0_PATH";

/**
 * Charge l'extension SQLite `sqlite-vec` (vec0) sur la connexion — REQUISE par la couche mémoire (schema-02) :
 *  (a) les `CREATE VIRTUAL TABLE ... USING vec0` du schéma en dépendent (chargée AVANT schema-02) ;
 *  (b) `PRAGMA integrity_check`/`quick_check` scanne AUSSI les tables vec0 → sans le module, l'intégrité
 *      d'une base porteuse de mémoire échouerait « no such module: vec0 » (d'où le chargement même en readOnly).
 * Prouvé conv 61 : node:sqlite `loadExtension` charge vec0 (v0.1.9), FTS5 est intégré. `allowExtension:true`
 * doit être passé au constructeur pour que ceci soit permis ; on referme `enableLoadExtension` juste après
 * (hygiène : aucun chargement d'extension déclenché par du SQL ensuite).
 */
function loadVecExtension(db: DatabaseSync): void {
  const ext = process.env[VEC0_PATH_OVERRIDE] || getLoadablePath();
  db.enableLoadExtension(true);
  try {
    db.loadExtension(ext);
  } finally {
    db.enableLoadExtension(false);
  }
}

/**
 * Ouvre le fichier de vérité SQLite en mode WAL et applique le schéma socle s'il est absent.
 * `dbPath` : chemin du .sqlite (dev = SOPHIA_HOME jetable ; prod = G:\Sophia\db, plan 05).
 * `opts.readOnly` : ouverture d'inspection en lecture seule (ne mute rien — m9).
 */
export function openDatabase(dbPath: string, opts: OpenOptions = {}): Db {
  const abs = path.resolve(dbPath);

  if (opts.readOnly) {
    const rodb = new DatabaseSync(abs, { readOnly: true, allowExtension: true });
    try {
      loadVecExtension(rodb); // integrity_check d'un snapshot porteur de mémoire scanne les tables vec0 (voir loadVecExtension)
    } catch (e) {
      // Symétrie avec le chemin d'écriture (#2/#3 socle) : un échec APRÈS l'ouverture (DLL vec0 absente) ne
      // doit pas FUITER la poignée SQLite (le handle tiendrait le fichier — gênant pour l'itération de
      // restauration T5 sur plusieurs snapshots). On ferme avant de propager (croisé conv 61).
      try { rodb.close(); } catch { /* */ }
      throw e;
    }
    return { raw: rodb, close: () => rodb.close() };
  }

  if (openWritePaths.has(abs)) {
    throw new Error(`openDatabase : une poignée d'écriture est déjà ouverte sur ${abs} (écrivain unique)`);
  }
  if (opts.mustExist && !fs.existsSync(abs)) {
    // Invariant « jamais de base vierge hors premier boot » (voir OpenOptions.mustExist). L'appelant
    // (T5) ne passe mustExist=false QUE sur le verdict PREMIER_BOOT ; tout autre chemin qui arriverait
    // ici avec une base absente est un bug -> on refuse de créer, l'appelant bascule en BLOCKED.
    throw new Error(`openDatabase : la base ${abs} est absente et mustExist est demandé (jamais de base vierge hors premier boot)`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const db = new DatabaseSync(abs, { allowExtension: true });
  try {
    db.exec("PRAGMA journal_mode = WAL;");   // un seul fichier de vérité, mode WAL
    db.exec("PRAGMA foreign_keys = ON;");    // les FK des couches 02/03 deviennent réelles (conv 16)
    // recursive_triggers = ON (croisé conv 61, MAJEUR) : SANS lui, la suppression IMPLICITE d'un
    // `INSERT OR REPLACE` ne fait PAS tirer les triggers `BEFORE/AFTER DELETE` (défaut SQLite = OFF) → un
    // REPLACE court-circuitait le VERROU d'immutabilité de `conversations`/`chronicle` (falsification
    // silencieuse du vécu, A18) ET corrompait tous les FTS contenu-externe (entrée fantôme non supprimée).
    // ON aligne le runtime sur l'hypothèse du design (« le trigger DELETE tire sur TOUTE suppression »).
    // Sûr : les triggers FTS (`INSERT INTO x(x,…)`) ne re-déclenchent aucun trigger de table de base.
    db.exec("PRAGMA recursive_triggers = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");  // ceinture (F2)
    db.exec("PRAGMA synchronous = NORMAL;"); // m8 : base EXPLICITE (trafic fréquent) ; les écritures
    // d'identité montent à FULL (T5, setSynchronous) — plus de défaut implicite qu'un changement de
    // node:sqlite (expérimental) pourrait affaiblir en silence.

    // vec0 AVANT schema-02 : les CREATE VIRTUAL TABLE ... USING vec0 en dépendent (M0, conv 61).
    loadVecExtension(db);

    const root = findRepoRoot(__dirname);
    db.exec(fs.readFileSync(path.join(root, "db", "schema-00.sql"), "utf8")); // socle (T1)
    db.exec(fs.readFileSync(path.join(root, "db", "schema-02.sql"), "utf8")); // mémoire (M0) — idempotent

    // Lignes SINGLETON (état de session / drapeaux runtime) : créées une fois, jamais dupliquées.
    db.exec("INSERT OR IGNORE INTO session_state (id) VALUES (1);");
    db.exec("INSERT OR IGNORE INTO runtime_flags (id) VALUES (1);");

    // B-α (croisé conv 16) — DÉFENSE EN PROFONDEUR : force le sas d'effacement FERMÉ à chaque boot, avec
    // assertion. Filet si un `open=1` était malgré tout persisté par une implémentation hors-transaction
    // (sans ça, le verrou déverrouillerait TOUT en silence au réveil). erase_gate n'a pas de trigger UPDATE
    // → cette écriture est libre ; le seed de schema-02 garantit la ligne présente.
    db.exec("UPDATE erase_gate SET open = 0;");
    const gate = db.prepare("SELECT open FROM erase_gate WHERE id = 0").get() as { open: number } | undefined;
    if (!gate || gate.open !== 0) {
      throw new Error("openDatabase : impossible de forcer erase_gate.open=0 au boot (intégrité de la mémoire, B-α)");
    }
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
