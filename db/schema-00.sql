-- schema-00.sql — les 4 tables du SOCLE (plan 00, T1). Source de vérité : technique/00 §3.
-- Les tables métier (faits, persona, lien...) sont déclarées dans schema-02 / schema-03.
-- Invariants : UN SEUL fichier de vérité, mode WAL, ÉCRIVAIN UNIQUE = l'orchestrateur (F2 ;
-- le sidecar n'a AUCUNE poignée d'écriture). Idempotent : CREATE TABLE IF NOT EXISTS.

-- 00-B/00-C — marques du gouverneur : où en est chaque tâche de fond.
CREATE TABLE IF NOT EXISTS governor_watermarks (
  task                TEXT    PRIMARY KEY,                                    -- identifiant de la tâche de fond
  last_run_at         INTEGER,                                               -- epoch ms de la dernière exécution
  owed                INTEGER NOT NULL DEFAULT 0 CHECK (owed IN (0, 1)),      -- un rattrapage est dû
  owed_since          INTEGER,                                               -- epoch ms : depuis quand c'est dû
  requires_real_brain INTEGER NOT NULL DEFAULT 0 CHECK (requires_real_brain IN (0, 1)) -- ne tourne jamais en SECOURS
);

-- 00-B/00-C — registre « part de Sophia » : un événement de dépense par appel AUTONOME
-- (fenêtre glissante). L'usage interactif n'est jamais compté (tag 'interactif' gardé pour la mesure).
CREATE TABLE IF NOT EXISTS governor_budget_ledger (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,                                                   -- epoch ms de l'appel
  origin TEXT    NOT NULL CHECK (origin IN ('autonome', 'interactif')),
  kind   TEXT                                                               -- catégorie (consolidation, proactif, rêverie...)
);

-- 00-E/A36 — état de session (SINGLETON) : le fil Claude chaud, durable pour --resume au crash.
CREATE TABLE IF NOT EXISTS session_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  claude_session_id  TEXT,                                                   -- possédé par le SOCLE (--resume)
  current_session_id INTEGER,                                                -- -> sessions.id (cible schema-02) ; NULLABLE, sans FK ; NULL au temps socle-seul (conv 16)
  secours_tainted    INTEGER NOT NULL DEFAULT 0 CHECK (secours_tainted IN (0, 1)), -- fil non-reprenable, écrit par plan/05 R5 ; 0 au temps socle-seul (conv 20)
  updated_at         INTEGER
);

-- 00-E/F1 — drapeaux runtime (SINGLETON) : détection d'arrêt propre / sale.
CREATE TABLE IF NOT EXISTS runtime_flags (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  running                INTEGER NOT NULL DEFAULT 0 CHECK (running IN (0, 1)), -- posé true au boot, false à l'arrêt propre
  started_at             INTEGER,
  last_clean_shutdown_at INTEGER
);
