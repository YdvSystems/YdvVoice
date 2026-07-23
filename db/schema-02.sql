-- schema-02.sql — la MÉMOIRE de Sophia (plan 02, M0). Source de vérité : docs/technique/02-memoire.md
-- + docs/plan/02-memoire.md (M0, 6 pièces). Toutes les tables de la couche 2, dans le WAL UNIQUE du
-- socle, ÉCRIVAIN UNIQUE = l'orchestrateur (F2 ; le sidecar n'a aucune poignée d'écriture).
--
-- Chargé par openDatabase() APRÈS schema-00.sql, à chaque boot, IDEMPOTENT (CREATE ... IF NOT EXISTS ;
-- INSERT OR IGNORE pour les seeds). Prérequis : l'extension sqlite-vec (vec0) est chargée AVANT ce fichier
-- (les CREATE VIRTUAL TABLE ... USING vec0 en dépendent) — voir db/index.ts. FTS5 est intégré au SQLite
-- de node:sqlite (3.50.4, prouvé conv 61).
--
-- CONVENTION (micro-choix tracé plan/02 §7, conv 61) : les valeurs des vocabulaires fermés (CHECK) sont
-- SANS ACCENT ('dictee'/'reverie'/'temoignage'/'reactivation'/'preference'/'systeme') — cohérent avec les
-- noms d'états du code (states.ts : 'ecoute'/'veille'/'pause'/'dictee') et robuste au tooling ; le sens
-- accentué vit dans les docs.
--
-- M0 = SCHÉMA SEUL. Aucun moteur (M2), aucune prise embed (M1), aucune écriture runtime : juste les
-- tables + triggers + index + FTS/vec + seeds, et les tests qui prouvent les invariants (U-M0-p1→p6).
--
-- IDEMPOTENCE — portée exacte (croisé conv 61) : `CREATE ... IF NOT EXISTS` (re)crée ce qui MANQUE. Il ne
-- MIGRE PAS une table existante (une colonne AJOUTÉE plus tard n'apparaît pas par simple re-exécution —
-- limite SQLite connue) : une évolution de schéma passera par une migration versionnée (patron M9). Et
-- l'immutabilité des tables scellées repose sur `PRAGMA recursive_triggers = ON` (posé par openDatabase) —
-- sans lui, un `INSERT OR REPLACE` court-circuiterait les triggers DELETE (falsification + FTS corrompu).
--
-- WRITE-ONCE `facts`/`knowledge_chunks`/`memory_artifacts` — DEUX PROPRIÉTÉS À CONNAÎTRE (re-croisé conv 61) :
--   (1) Le garde `*_no_reinsert` (BEFORE INSERT) refuse de ré-insérer sur une identité DÉJÀ présente → un
--       `INSERT OR IGNORE` id-fixe (le patron « seed idempotent » d'erase_gate) y **ABORT**, il ne fait PAS
--       un no-op silencieux. Les écrivains M2→M9 de ces tables utilisent `INSERT` simple (jamais `OR IGNORE`).
--   (2) Le write-once du CONTENU est enforcé par le SCHÉMA ; la NON-RÉUTILISATION d'un id et la MAINTENANCE
--       du vecteur à l'effacement sont une DISCIPLINE D'ÉCRIVAIN (même modèle que `conversations` :
--       AUTOINCREMENT ⇒ l'auto-insert ne réutilise jamais ; l'écrivain ne fournit JAMAIS d'id explicite).
--       ⛔ CONTRAT NON NÉGOCIABLE (Yohann, conv 61) : M1/M2/M8 DOIVENT tester « zéro vecteur orphelin après
--       un effacement souverain » ET « l'écrivain insère en AUTOINCREMENT, jamais d'id explicite ». Sans ces
--       tests, la garantie write-once a un trou (réutiliser un id + vecteur périmé = recherche menteuse).

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- PIÈCE 1 — l'ÉPISODIQUE IMMUABLE + LE VERROU (le sol de l'anti-dérive A18 : « réécrire depuis la
--           source » exige une source intouchable).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════

-- Le VERROU d'abord (les triggers d'immutabilité en dépendent). `erase_gate` = garde MONO-LIGNE
-- (id=0). Protégé PAR DÉFAUT (open=0) ; le sas d'effacement (M8) fait open=1 → DELETE → open=0 dans UNE
-- transaction, sur la connexion d'écriture (F2). Sûr par construction (atomicité + isolation WAL : une
-- garde ouverte non commitée est invisible et refermée au rollback).
CREATE TABLE IF NOT EXISTS erase_gate (
  id   INTEGER PRIMARY KEY CHECK (id = 0),                 -- singleton
  open INTEGER NOT NULL DEFAULT 0 CHECK (open IN (0, 1))   -- 1 = sas OUVERT (effacement en cours)
);
-- Seed : la ligne DOIT exister (sinon le sas M8 fait UPDATE sur 0 ligne et n'ouvre jamais — m-1 croisé conv 16).
INSERT OR IGNORE INTO erase_gate (id, open) VALUES (0, 0);
-- Le singleton est INDESTRUCTIBLE : le DELETE de `erase_gate` est refusé (garde le singleton présent pour
-- que le sas puisse le basculer). Sa suppression FERMERAIT le verrou (fail-closed) — jamais l'ouvrir
-- (correctif B-β croisé conv 16 : le motif inverse « la vider rouvrirait tout » était du fail-open).
CREATE TRIGGER IF NOT EXISTS erase_gate_no_delete
BEFORE DELETE ON erase_gate
BEGIN SELECT RAISE(ABORT, 'erase_gate : singleton indestructible (fail-closed)'); END;

-- `sessions` — enveloppe MUTABLE (résumé, horodatages) → PAS de trigger insert-only.
-- Couture socle M-1 (croisé conv 16, §7) : `sessions` ne porte PAS `claude_session_id` (il vit dans
-- session_state, socle, propriétaire) ; c'est session_state.current_session_id → sessions.id qui pointe
-- la ligne courante (colonne DÉJÀ dans schema-00, nullable, sans FK).
CREATE TABLE IF NOT EXISTS sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  mode             TEXT NOT NULL DEFAULT 'conversation'
                     CHECK (mode IN ('conversation', 'dictee', 'tablee', 'reverie')), -- discriminant de pipeline
  retention_policy TEXT,                                    -- politique tablée → doc 04
  summary          TEXT,                                    -- NULL = « à résumer » (défini par l'état, T20)
  started_at       INTEGER,
  last_active      INTEGER
);

-- `conversations` — IMMUABLE (insert-only, sas seul). `id AUTOINCREMENT` : ids JAMAIS réutilisés
-- (requis par « source effacée » de plan/03 P10/R1 — sans lui SQLite recycle l'id d'un tour effacé et
-- une provenance citerait un AUTRE tour réel ; retouche croisé plan/03, conv 17).
CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  speaker    TEXT,                                          -- Yohann/Sophia/… (politique d'écriture → doc 04)
  content    TEXT NOT NULL,                                 -- texte, JAMAIS l'audio
  surface    TEXT,                                          -- canal réel du tour (§7 F1 : ex. voix/dictee/ui-texte)
  created_at INTEGER
);
-- Le VERROU (patron réutilisable 2→3) : UPDATE/DELETE refusés SAUF si le sas est ouvert. Clause
-- fail-CLOSED (correctif B1) : `WHEN NOT EXISTS(... open=1)` — protégé par défaut, ouvert SEULEMENT si une
-- ligne open=1 existe (garde absente / open NULL / vidée → refusé).
CREATE TRIGGER IF NOT EXISTS conversations_no_update
BEFORE UPDATE ON conversations
WHEN NOT EXISTS (SELECT 1 FROM erase_gate WHERE open = 1)
BEGIN SELECT RAISE(ABORT, 'conversations : immuable (sas fermé)'); END;
CREATE TRIGGER IF NOT EXISTS conversations_no_delete
BEFORE DELETE ON conversations
WHEN NOT EXISTS (SELECT 1 FROM erase_gate WHERE open = 1)
BEGIN SELECT RAISE(ABORT, 'conversations : immuable (sas fermé)'); END;

-- `turn_signals` — table SÉPARÉE, rétention bornée (donc PAS insert-only) : OFF-safe (affect nullable)
-- + rétention (exception nommée à « le système ne supprime jamais », T11/F6). Invariant gravé
-- (m-4 croisé conv 16) : rétention ≥ borne du backlog de consolidation (couplage structurel, asserté au test).
-- Les colonnes du tag d'humeur sont DÉCLARÉES ici, ÉCRITES par doc 03 (AT6).
CREATE TABLE IF NOT EXISTS turn_signals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id),
  reason            TEXT,                                   -- fin de tour
  barge_in_occurred INTEGER,                                -- 0/1
  barge_in_pos      INTEGER,                                -- position (échantillons/ms)
  affect_valence    REAL,                                   -- nullable, OFF défaut, verrou Yohann (01 §2.4)
  affect_energy     REAL,
  affect_confidence REAL,
  mood_deltas       TEXT,                                   -- deltas du tag d'humeur (écrit par 03 §2.2)
  mood_value_flag   INTEGER,                                -- drapeau d'agacement de valeur (écrit par 03)
  captured_at       INTEGER
);

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- PIÈCE 2 — les EMPREINTES (le substrat des « empreintes du jour » A18/A19 ; la sémantique du tri → 03).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════

-- `imprints` — enveloppe MUTABLE, HORS verrou (`consumed` réécrit par la nuit → pas insert-only, pas
-- sous erase_gate). Ancrage XOR (deux FK typées + CHECK) : exactement l'un de conversation_id (un tour
-- vécu) OU session_id (invocation sans tours, ex. rêverie). Cascade d'effacement = EXPLICITE (M8),
-- jamais ON DELETE CASCADE (le compte de la trace sans contenu T18 doit rester lisible).
CREATE TABLE IF NOT EXISTS imprints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id),
  session_id      INTEGER REFERENCES sessions(id),
  nature          TEXT,                                     -- slot (vocabulaire/sens = 03)
  priority        INTEGER,                                  -- slot (l'empreinte « prioritaire » ; tri = 03)
  noted_by        TEXT NOT NULL CHECK (noted_by IN ('micro', 'outil', 'couche3')),
  consumed        INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1)),  -- mis à 1 par la nuit (mutable)
  created_at      INTEGER,
  CHECK ((conversation_id IS NULL) + (session_id IS NULL) = 1)           -- XOR : exactement un ancrage
);

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- PIÈCE 3 — la SÉMANTIQUE (le write-once du CONTENU — mécanisme DISTINCT du verrou de la pièce 1, T7).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS facts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id > 0), -- id>0 : rend structurel le contrat du garde no_reinsert (NEW.id=-1 sentinelle d'un insert auto ne peut jamais fausse-matcher une ligne réelle — re-croisé conv 61, note 2)
  content       TEXT NOT NULL,                              -- langage naturel concis (ce qui est embeddé, A11)
  category      TEXT NOT NULL
                  CHECK (category IN ('personne', 'preference', 'relation', 'projet',
                                      'quotidien', 'monde', 'systeme')),   -- fermé : extension = migration, JAMAIS la nuit
  status        TEXT NOT NULL DEFAULT 'PROVISIONAL'
                  CHECK (status IN ('PROVISIONAL', 'ACTIVE', 'SUPERSEDED', 'REJECTED')),
  confidence    REAL,
  importance    REAL,
  support_count INTEGER NOT NULL DEFAULT 0,                 -- cache de la cardinalité de fact_sources
  valid_from    INTEGER,                                    -- temps DU MONDE
  valid_to      INTEGER,
  created_at    INTEGER                                     -- temps DE LA CROYANCE
);
-- Write-once du CONTENU (T7) — trigger BEFORE UPDATE SÉLECTIF, DISTINCT du verrou pièce 1 : refuse la
-- modif des colonnes d'IDENTITÉ du fait (id/content/category/valid_from/created_at) ; autorise les seules
-- métadonnées mutables (status/valid_to/support_count/importance/confidence). **`id` scellé (croisé conv 61)** :
-- muter le rowid d'un fait laissait une entrée FTS/vec ORPHELINE (le fait déplacé, l'index resté sur l'ancien
-- rowid — les FTS/vec n'ont pas de branche de maintenance sur déplacement d'id). Comparaison NULL-SAFE
-- OBLIGATOIRE (b-m2 croisé conv 16, le piège exact de B1) : `IS NOT`, JAMAIS `<>` (qui rend NULL — non-vrai
-- — sur une transition NULL↔valeur et laisse passer la modif interdite).
CREATE TRIGGER IF NOT EXISTS facts_content_write_once
BEFORE UPDATE ON facts
WHEN NEW.id         IS NOT OLD.id
  OR NEW.content    IS NOT OLD.content
  OR NEW.category   IS NOT OLD.category
  OR NEW.valid_from IS NOT OLD.valid_from
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'facts : identité write-once (T7 ; id/content/category/valid_from/created_at scellés)'); END;
-- REPLACE-proof (re-croisé conv 61) : `INSERT OR REPLACE`/REPLACE fait une suppression IMPLICITE +
-- ré-insertion. facts n'a PAS de BEFORE DELETE (supprimable par M8) → `recursive_triggers` ne le protège
-- pas ; un REPLACE réécrivait le contenu write-once ET laissait le VECTEUR périmé (`vec_facts` sans trigger
-- → recherche sémantique menteuse). Garde : refuser toute ré-insertion sur un `id` DÉJÀ présent (au BEFORE
-- INSERT du REPLACE, l'ancienne ligne est encore là → EXISTS vrai → bloqué ; un INSERT neuf passe ; le
-- DELETE M8 reste permis — seuls le contenu/l'identité sont write-once, pas l'existence).
CREATE TRIGGER IF NOT EXISTS facts_no_reinsert
BEFORE INSERT ON facts
WHEN EXISTS (SELECT 1 FROM facts WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'facts : ré-insertion interdite (write-once — un REPLACE court-circuiterait le contenu + le vecteur)'); END;

CREATE TABLE IF NOT EXISTS fact_sources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_id      INTEGER NOT NULL REFERENCES facts(id),
  source_kind  TEXT NOT NULL
                 CHECK (source_kind IN ('tour', 'consolidation', 'temoignage', 'outil', 'reactivation')),
  source_id    INTEGER,                                     -- POLYMORPHE (cible selon source_kind) : pas de FK stricte
  observed_at  INTEGER,
  source_erased INTEGER NOT NULL DEFAULT 0 CHECK (source_erased IN (0, 1))  -- « source effacée » (§2.4/T4)
);
-- Index du BALAYAGE INVERSE de M8 (retrouver les sources pendantes vers un tour effacé) : performant ET
-- exhaustif (b-m6-index croisé conv 16).
CREATE INDEX IF NOT EXISTS fact_sources_by_source ON fact_sources (source_kind, source_id);

CREATE TABLE IF NOT EXISTS fact_relations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_fact_id INTEGER NOT NULL REFERENCES facts(id),
  relation     TEXT NOT NULL CHECK (relation IN ('SUPERSEDES', 'CONTRADICTS', 'DERIVES_FROM')),
  to_fact_id   INTEGER NOT NULL REFERENCES facts(id),
  basis        INTEGER REFERENCES conversations(id),        -- le tour de la correction
  created_at   INTEGER,
  CHECK (relation <> 'SUPERSEDES' OR basis IS NOT NULL),    -- SUPERSEDES refuse sans base ; CONTRADICTS la tolère
  CHECK (from_fact_id <> to_fact_id)                        -- pas d'auto-relation (un fait ne se supersède/contredit pas — croisé conv 61)
);

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- PIÈCE 4 — ARTEFACTS + CHRONIQUE.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════

-- `memory_artifacts` (patron réutilisé par 03 pour le miroir-lien) : version IMMUABLE, mais HORS
-- erase_gate (DELETE orchestrateur autorisé pour rotation bornée N + expurgation §2.4). UNIQUE(name,version)
-- (b-m3) ; `expurged_at` (AF-6, marqueur d'expurgation T3).
CREATE TABLE IF NOT EXISTS memory_artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id > 0), -- id>0 : contrat du garde no_reinsert (note 2, re-croisé conv 61)
  name        TEXT NOT NULL,                                -- 'user_model', …
  version     INTEGER NOT NULL,
  content     TEXT,
  written_by  INTEGER,                                      -- run de consolidation
  created_at  INTEGER,
  expurged_at INTEGER,                                      -- « expurgée le … » (patron T3, parité chronicle)
  UNIQUE (name, version)
);
-- Une version est IMMUABLE (réécrire = NOUVELLE version) ; INSERT libre (version++), DELETE autorisé
-- (rotation/expurgation, exception nommée §5/T11). Distinct de chronicle : PAS sous erase_gate (§7).
CREATE TRIGGER IF NOT EXISTS memory_artifacts_version_immutable
BEFORE UPDATE ON memory_artifacts
BEGIN SELECT RAISE(ABORT, 'memory_artifacts : une version est immuable (réécrire = nouvelle version, A18)'); END;
-- REPLACE-proof (re-croisé conv 61) : un `INSERT OR REPLACE` falsifiait une version « immuable », par
-- conflit sur `id` OU sur `UNIQUE(name,version)` (avec une id neuve). Refuser la ré-insertion sur l'une OU
-- l'autre identité. (La rotation DELETE d'une vieille version reste permise — l'existence n'est pas scellée.)
CREATE TRIGGER IF NOT EXISTS memory_artifacts_no_reinsert
BEFORE INSERT ON memory_artifacts
WHEN EXISTS (SELECT 1 FROM memory_artifacts WHERE id = NEW.id)
   OR EXISTS (SELECT 1 FROM memory_artifacts WHERE name = NEW.name AND version = NEW.version)
BEGIN SELECT RAISE(ABORT, 'memory_artifacts : ré-insertion interdite (version immuable — un REPLACE la falsifierait, conflit id ou name/version)'); END;

-- `chronicle` — IMMUABLE (verrou pièce 1) + `day` UNIQUE (jamais deux entrées pour un même jour,
-- critère 10). L'expurgation = DELETE + réinsertion `expurged_at` marquée, DANS LE SAS seulement (T3,
-- jamais d'UPDATE, jamais de faux journal). Deux dates : `day` couvert ≠ `written_at`.
CREATE TABLE IF NOT EXISTS chronicle (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL UNIQUE,                         -- le jour COUVERT (clé unique)
  content     TEXT NOT NULL,                                -- le jour vécu, raconté
  written_at  INTEGER,
  written_by  INTEGER,                                      -- run
  expurged_at INTEGER                                       -- « expurgée le … » (§2.4/T3)
);
CREATE TRIGGER IF NOT EXISTS chronicle_no_update
BEFORE UPDATE ON chronicle
WHEN NOT EXISTS (SELECT 1 FROM erase_gate WHERE open = 1)
BEGIN SELECT RAISE(ABORT, 'chronicle : immuable (sas fermé)'); END;
CREATE TRIGGER IF NOT EXISTS chronicle_no_delete
BEFORE DELETE ON chronicle
WHEN NOT EXISTS (SELECT 1 FROM erase_gate WHERE open = 1)
BEGIN SELECT RAISE(ABORT, 'chronicle : immuable (sas fermé)'); END;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- PIÈCE 5 — KNOWLEDGE (l'étage « lu » — ingéré, immuable, JAMAIS consolidé ; la nuit ne le touche pas).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  hash        TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'REPLACED', 'ARCHIVED')),   -- seul champ de cycle de vie mutable
  category    TEXT,                                         -- TEXT OUVERT (dont 'temoignage') — §7 : on ne referme pas ce que la source laisse ouvert
  ingested_at INTEGER
);
-- « Une seule version servie » (b-m3) : jamais deux docs ACTIVE de même `name`.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_docs_active_name
  ON knowledge_docs (name) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id      INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id > 0), -- id>0 : contrat du garde no_reinsert (note 2, re-croisé conv 61)
  doc_id  INTEGER NOT NULL REFERENCES knowledge_docs(id),
  seq     INTEGER NOT NULL,
  content TEXT NOT NULL                                     -- write-once (fichier modifié = NOUVELLE version de doc)
);
-- Morceau IMMUABLE en entier (croisé conv 61) : id/doc_id/seq/content tous scellés — un `BEFORE UPDATE OF
-- content` laissait muter `id`/`seq` (→ entrée FTS orpheline, comme facts.id). Aucune colonne d'un chunk
-- n'est jamais mutable (un fichier modifié = NOUVELLE version de doc, jamais une réécriture de morceau).
CREATE TRIGGER IF NOT EXISTS knowledge_chunks_write_once
BEFORE UPDATE ON knowledge_chunks
BEGIN SELECT RAISE(ABORT, 'knowledge_chunks : morceau immuable (id/doc_id/seq/content scellés — nouvelle version de doc)'); END;
-- REPLACE-proof (re-croisé conv 61, même classe que facts) : un `INSERT OR REPLACE` réécrivait le morceau
-- write-once + laissait un fantôme/désync FTS. Refuser la ré-insertion sur un `id` déjà présent.
CREATE TRIGGER IF NOT EXISTS knowledge_chunks_no_reinsert
BEFORE INSERT ON knowledge_chunks
WHEN EXISTS (SELECT 1 FROM knowledge_chunks WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'knowledge_chunks : ré-insertion interdite (write-once — un REPLACE court-circuiterait le morceau + le FTS)'); END;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════
-- PIÈCE 6 — INDEX DÉRIVÉS + JOURNAUX (dérivés reconstructibles, jamais une seconde vérité).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════

-- FTS5 en CONTENU EXTERNE, triggers INSERT+DELETE seulement (jamais d'UPDATE : le contenu indexé est
-- write-once, T7). Les suppressions légitimes (M8 sur facts/conversations ; expurgation chronicle)
-- déclenchent le trigger DELETE → l'index suit.
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts        USING fts5(content, content='facts',            content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(content, content='conversations',    content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS chronicle_fts    USING fts5(content, content='chronicle',         content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts    USING fts5(content, content='knowledge_chunks',  content_rowid='id');

CREATE TRIGGER IF NOT EXISTS facts_fts_ai AFTER INSERT ON facts
BEGIN INSERT INTO facts_fts(rowid, content) VALUES (new.id, new.content); END;
CREATE TRIGGER IF NOT EXISTS facts_fts_ad AFTER DELETE ON facts
BEGIN INSERT INTO facts_fts(facts_fts, rowid, content) VALUES ('delete', old.id, old.content); END;

CREATE TRIGGER IF NOT EXISTS conversations_fts_ai AFTER INSERT ON conversations
BEGIN INSERT INTO conversations_fts(rowid, content) VALUES (new.id, new.content); END;
CREATE TRIGGER IF NOT EXISTS conversations_fts_ad AFTER DELETE ON conversations
BEGIN INSERT INTO conversations_fts(conversations_fts, rowid, content) VALUES ('delete', old.id, old.content); END;

CREATE TRIGGER IF NOT EXISTS chronicle_fts_ai AFTER INSERT ON chronicle
BEGIN INSERT INTO chronicle_fts(rowid, content) VALUES (new.id, new.content); END;
CREATE TRIGGER IF NOT EXISTS chronicle_fts_ad AFTER DELETE ON chronicle
BEGIN INSERT INTO chronicle_fts(chronicle_fts, rowid, content) VALUES ('delete', old.id, old.content); END;

CREATE TRIGGER IF NOT EXISTS knowledge_fts_ai AFTER INSERT ON knowledge_chunks
BEGIN INSERT INTO knowledge_fts(rowid, content) VALUES (new.id, new.content); END;
CREATE TRIGGER IF NOT EXISTS knowledge_fts_ad AFTER DELETE ON knowledge_chunks
BEGIN INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', old.id, old.content); END;

-- CARVE-OUT `sessions_fts` (AF-2, audit Fable) : sessions.summary est le SEUL contenu indexé/embeddé
-- MUTABLE (écrit par UPDATE à la clôture ; la ligne existe dès l'ouverture, summary NULL — T20). Le patron
-- triggers ne le voit pas (INSERT tire quand summary=NULL → jambe FTS morte ; une réécriture laisse un
-- vecteur périmé). → Maintenance EXPLICITE par l'ÉCRIVAIN (M5/M8) : toute écriture/réécriture/annulation
-- de summary fait, DANS LA MÊME TRANSACTION, delete+insert de sessions_fts ET DELETE de vec_sessions.
-- PAS de trigger automatique ici (délibéré).
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(summary, content='sessions', content_rowid='id');

-- Tables VECTEUR (sqlite-vec vec0), UNE par corpus HYBRIDE. dimension = 1024 (BGE-M3 défaut, §7 : si M1
-- choisit un autre modèle → migration M9). PAS de vec_conversations (le verbatim est lexical-seul/FTS).
-- Peuplées par la prise embed (M1, « la base est la file ») — pas de trigger. Le rowid = l'id de la source.
CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts     USING vec0(embedding float[1024]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_sessions  USING vec0(embedding float[1024]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chronicle USING vec0(embedding float[1024]);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_knowledge USING vec0(embedding float[1024]);

-- `embed_space_meta` — l'identité de l'ESPACE VECTORIEL d'un corpus (support du garde d'espace §2.2 + de
-- la migration M9). Deux lignes coexistent par corpus pendant une migration (active + cible-ombre) →
-- `corpus` ne peut pas être clé seule. UNIQUE(corpus,model,preproc_revision) (#B : migration préproc-seul
-- possible) + partial UNIQUE WHERE active=1 (#2 : ≤1 active/corpus) + partial UNIQUE WHERE active=0
-- (#A-3 : ≤1 cible de migration/corpus).
CREATE TABLE IF NOT EXISTS embed_space_meta (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  corpus           TEXT NOT NULL,                           -- 'facts'/'sessions'/'chronicle'/'knowledge' (+ 'introspection' par 03)
  model            TEXT NOT NULL,
  dimension        INTEGER NOT NULL,
  preproc_revision TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  UNIQUE (corpus, model, preproc_revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS embed_space_active ON embed_space_meta (corpus) WHERE active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS embed_space_shadow ON embed_space_meta (corpus) WHERE active = 0;
-- Seed : une ligne active=1 par corpus hybride pour le modèle configuré (#C, même motif que erase_gate
-- m-1 : sans seed, le garde compare à 0 ligne active → jambe sémantique morte en silence). BGE-M3/1024/v1.
INSERT OR IGNORE INTO embed_space_meta (corpus, model, dimension, preproc_revision, active)
  VALUES ('facts',     'bge-m3', 1024, 'v1', 1),
         ('sessions',  'bge-m3', 1024, 'v1', 1),
         ('chronicle', 'bge-m3', 1024, 'v1', 1),
         ('knowledge', 'bge-m3', 1024, 'v1', 1);

-- `embed_failures` — foyer du marqueur poison-row (#A-3, b-m5). PERSISTÉ (la file « lignes sans vec » se
-- recalcule au respawn → le dead-letter doit survivre, sinon la poison-row re-échoue à l'infini). Ne
-- compte QUE les échecs moteur/contenu, JAMAIS un refus du garde d'espace (#5, transitoire pendant M9).
CREATE TABLE IF NOT EXISTS embed_failures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  corpus        TEXT NOT NULL,
  source_id     INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  dead          INTEGER NOT NULL DEFAULT 0 CHECK (dead IN (0, 1)),
  last_error_at INTEGER,
  UNIQUE (corpus, source_id)
);

-- `pending_ops` — foyer des opérations FS/octets DIFFÉRÉES (croisé Opus conv 18, AF-4 généralisé). PERSISTÉE,
-- multi-lignes, PAR-CIBLE : une op filesystem/octets promise mais HORS transaction a une marque durable qui
-- survit crash+respawn. Balayée par le sweep au boot (plan/00 T5 Phase 2), idempotente.
CREATE TABLE IF NOT EXISTS pending_ops (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('purge-session-file', 'storage-scrub', 'purge-ephemeral')),
  target     TEXT NOT NULL,                                 -- chemin fichier de session · OU jeton scrub · OU session_id éphémère
  due        INTEGER NOT NULL DEFAULT 1 CHECK (due IN (0, 1)),
  created_at INTEGER
);

-- `consolidation_runs` — journal d'audit des nuits (distinct de governor_watermarks du socle : l'un
-- journalise CE QUE la nuit a fait, l'autre QUAND elle doit tourner). Compteurs discrets nommés
-- (queryables) ; `persona_version` (conv 17 : « prompt ET persona » enregistrés par run).
CREATE TABLE IF NOT EXISTS consolidation_runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  day_covered           TEXT,
  started_at            INTEGER,
  finished_at           INTEGER,
  prompt_version        TEXT,
  persona_version       TEXT,
  model                 TEXT,
  status                TEXT CHECK (status IN ('running', 'finished', 'aborted')),
  facts_ratified        INTEGER NOT NULL DEFAULT 0,
  facts_rejected        INTEGER NOT NULL DEFAULT 0,
  contradictions_opened INTEGER NOT NULL DEFAULT 0,
  days_sacrificed       INTEGER NOT NULL DEFAULT 0
);

-- `erasures` — trace SANS CONTENU (§2.4/T18) : horodatage + compteurs (par corpus/total), ZÉRO colonne de
-- contenu. Lue par le pipeline nocturne (`consumed` évite de la reprocesser). Doublée au JSONL/flux dédié.
CREATE TABLE IF NOT EXISTS erasures (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at          INTEGER,
  count_facts          INTEGER NOT NULL DEFAULT 0,
  count_conversations  INTEGER NOT NULL DEFAULT 0,
  count_imprints       INTEGER NOT NULL DEFAULT 0,
  count_sessions       INTEGER NOT NULL DEFAULT 0,
  count_chronicle      INTEGER NOT NULL DEFAULT 0,
  count_knowledge      INTEGER NOT NULL DEFAULT 0,
  count_total          INTEGER NOT NULL DEFAULT 0,
  consumed             INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
);
