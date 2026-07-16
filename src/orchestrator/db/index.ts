import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
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
  if (opts.mustExist && !fs.existsSync(abs)) {
    // Invariant « jamais de base vierge hors premier boot » (voir OpenOptions.mustExist). L'appelant
    // (T5) ne passe mustExist=false QUE sur le verdict PREMIER_BOOT ; tout autre chemin qui arriverait
    // ici avec une base absente est un bug -> on refuse de créer, l'appelant bascule en BLOCKED.
    throw new Error(`openDatabase : la base ${abs} est absente et mustExist est demandé (jamais de base vierge hors premier boot)`);
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
