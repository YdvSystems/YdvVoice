# 02 — Mémoire · Plan d'implémentation · YdvVoice (Sophia)

> **Rôle** : le plan d'exécution de la **mémoire** de Sophia — ce qu'elle vit (épisodique), apprend (sémantique), lit (connaissances), comment elle se rappelle (recherche hybride), comment le jour note et la nuit range. C'est la couche qui transforme un moteur sans continuité en **une entité** (A14 « structure, pas substrat »). Troisième plan de la Phase 3 : **il s'écrit sur le socle** (`docs/plan/00-socle.md`) et **à côté de l'audio** (`docs/plan/01-pipeline-vocal.md`), acquis.
>
> **Source de vérité** : `docs/technique/02-memoire.md` (acquis). Ce plan **traduit, ne rouvre rien** (Garde-fou Phase 3, CLAUDE.md). Tout écart au contact du code → **rubrique 7** + renvoi `02` §7, jamais contourné.
>
> **Statut** : **en construction pièce par pièce (conv 15)** — M0 pièce 1 posée. Micro-choix techniques tranchés par le pilote + tracés (§7) ; seuls un vrai trou de conception ou la vie de Sophia remontent à Yohann. **Valeurs chiffrées différées** à la calibration Phase 3 (rubrique 6). **Solo à fond puis croisé 2 agents** en fin de rédaction (sur Go de Yohann). Critère : **optimal, pas rapide**.
>
> **Discipline Phase 3** : « tests avant de committer » ; base et bancs **jetables** (CF2) — **rien de persona-portant ici** (la couche 2 pose les *slots* de l'identité, `03` en pose le *contenu*).

---

## 1. Objectif & ce que la couche prouve

Bâtir la **mémoire** sur le socle : un **fichier de vérité unique** (WAL, écrivain unique = orchestrateur, hérité `00`), une **recherche hybride multi-corpus**, une **écriture à trois portes un seul stylo**, une **consolidation** micro (le jour) et deep (la nuit), une **injection** bornée, un **effacement souverain** réel, deux étages étanches (vécu / lu) réunis à la lecture.

**Ce qu'elle doit prouver** : le **vécu brut est immuable** (sas seul passage, trace sans contenu) · la **recherche hybride** tient (exact + sens + RRF + filtres dans les jambes + requête datée + jamais bloquante + citabilité) · « **c'est noté** » **vrai à la seconde** · **la nuit ne dépend jamais du micro**, la **deep exige le vrai cerveau en entier** · l'**effacement souverain** efface réellement (cascade + invalidation du fil Claude) · l'**identité est inviolable par la mémoire** (contrat 2→3 ; **embeddings local-only**).

**Ce que ce plan ne couvre PAS** : tables persona/lien/cliquet/journal du devenir + usage affect + cadence humeur → `03` (le plan `02` pose **substrat, patron, slots**) · initiatives + cible `task` + politique tablée/tiers → `04` · ladder résilience/coût + jeton OAuth + sauvegarde hors-machine → `05` · composition finale du prompt → `99` (le plan `02` compose **le bloc mémoire seul**) · socle → `00` (acquis).

---

## 2. Prérequis

- **Le socle** (`plan/00`, T0→T8) : WAL + **écrivain unique F2** · gouverneur (`REPOS`/`BRIDÉ`/calque `SECOURS`) + vie d'une tâche de fond (unités/curseur/préemption/rattrapage) · boot (Phase 3 hook identité, Phase 4 gouverneur, Phase 6 health-check dimanche) · **snapshots `VACUUM INTO`** · canal Claude `claude -p` + `session_state` + `--resume`/rotation.
- **L'audio** (`plan/01`, V0→V15) pour la couture : sidecar qui **héberge les prises** (`embed` s'y ajoute) · `cmd.model.policy` émis par l'orchestrateur · canal WS `cmd.*`/`evt.*` (`evt.*` extensible) · resync au respawn · fenêtre **APPROBATION** (pour M8).
- **Moteurs/libs** : `embed` dans le sidecar (BGE-M3 défaut · alternatives e5/gte) · extension **`sqlite-vec` (vec0)** · **FTS5**. Aucune clé — **embed local-only, sans repli cloud** (A10).
- **`SOPHIA_HOME` jetable** au banc (CF2) ; sécurité repo public (gitleaks + garde contenu).

**Arborescence (indicative)** : `db/schema-02.sql` · `src/orchestrator/memory/{search,write,consolidation/{micro,deep},inject,knowledge,erase,embed-space}/` · `src/orchestrator/mcp/` (proxy stdio sans poignée SQLite) · `sidecar/embed/`.

---

## 3. Tâches séquentielles

> Ordre = dépendances internes (socle + audio acquis). Chaque tâche : **But · Contenu · Fichiers · Dépend de · Fait quand** (adossée à son test). Valeurs (X, N, K) **ouvertes** (rubrique 6). **Construction pièce par pièce** — les pièces marquées *(à construire)* seront posées, montrées et validées une par une.

### M0 — Schéma & immutabilité
- **But** : toutes les tables de la couche 2 dans le WAL unique ; le vécu immuable par construction ; un seul sas de suppression.
- **Dépend de** : socle T1 (WAL + écrivain unique F2).
- **Fichiers** : `db/schema-02.sql`, `src/orchestrator/db/`.
- **Contenu — construit pièce par pièce** :

  **▸ Pièce 1 — l'épisodique immuable + le verrou** *(le sol de l'anti-dérive A18 : « réécrire depuis la source » exige une source intouchable)*
  - **`sessions` — enveloppe MUTABLE** (donc **pas** de trigger insert-only) : `id` (identité **logique stable** de la conversation) · `claude_session_id` (le **fil courant, remplaçable en place** à la rotation/invalidation — `05` §4.1 T3 / `02` §2.4 T1) · `mode` (**CHECK** : conversation/dictée/tablée/rêverie — **discriminant de pipeline** : dictée & rêverie = enveloppe-seule ; tablée = tiers hors `conversations`) · `retention_policy` (→ `04`) · `summary` (**NULL = « à résumer »**, définition par l'état T20) · `started_at` · `last_active`. **Couture socle** : `session_state` (socle) référence la ligne courante, MAJ **même transaction** (T14).
  - **`conversations` — IMMUABLE** (insert-only, sas seul) : `id` · `session_id` · `role` (**CHECK** user/assistant/system) · `speaker` (Yohann/Sophia/… — politique d'écriture `04` : en pratique Yohann/Sophia, les tiers → `tablee_buffer`) · `content` (**texte, jamais l'audio**) · `surface` (**redéfini**, cf. §7) · `created_at`. **Inserts en `synchronous=NORMAL`** (trafic fréquent, comme `facts` T21 — dernier tour perdable sur coupure secteur, assumé).
  - **`turn_signals` — table SÉPARÉE, rétention bornée** (donc **pas** insert-only) : `conversation_id` · `reason` (fin de tour) · barge-in (survenu/position) · affect (valence/énergie/confiance — **nullable, OFF défaut, verrou Yohann** — `01` §2.4) · **valeurs du tag d'humeur** (deltas/drapeau — **colonnes déclarées ici, écrites par `03`** §2.2, AT6) · `captured_at`. **Séparée pour deux raisons** : OFF-safe + rétention (exception nommée à « le système ne supprime jamais », T11/F6).
  - **Le verrou (triggers + sas)** : triggers `BEFORE UPDATE/DELETE` → `RAISE(ABORT)` avec une clause **fail-closed** : `WHEN NOT EXISTS (SELECT 1 FROM erase_gate WHERE open=1)` — protégé **par défaut**, ouvert **seulement** si une ligne `open=1` existe (**correctif B1** : `WHEN (…)=0` était *fail-open* — garde vide/`NULL` → `NULL=0` non-vrai → tout passait, sur `conversations`/`chronicle` **et** `identity_core`) ; **`erase_gate`** *(nom d'implémentation ; `02` §2.4 dit « table-garde »)* = **garde mono-ligne** (`id INTEGER PRIMARY KEY CHECK(id=0)`, `open NOT NULL DEFAULT 0`), **protégée contre DELETE** (trigger — la vider rouvrirait tout). Le **sas** (effacement M8 + soupape du gardien `03`, tracés) fait `open=1` → DELETE → `open=0` **dans une seule transaction, sur la connexion d'écriture de l'orchestrateur**. **Sûr par construction** : l'**atomicité + l'isolation WAL** rendent une garde `open=1` non commitée invisible et la referment au rollback (*jamais persistée ouverte*) ; **F2** (aucun writer sidecar/MCP) **complète** sans porter seul la garantie — précondition : open/DELETE/close **dans une transaction, connexion d'écriture**. **Patron réutilisable** (générateur de triggers sur la même `erase_gate`) pour les 6 tables identitaires de `03` (contrat 2→3). **S'applique à `conversations` + `chronicle` (+ tables `03`) seulement** — pas à `sessions` (mutable), `turn_signals` (rétention), `facts` (write-once *de contenu* = mécanisme distinct, pièce 3).

  **▸ Pièce 2 — empreintes** (`imprints`) *(à construire)*
  **▸ Pièce 3 — sémantique** (`facts` · `fact_sources` · `fact_relations` ; write-once du contenu) *(à construire)*
  **▸ Pièce 4 — artefacts** (`memory_artifacts`, portrait 4 strates) **+ chronique** (`chronicle`, write-once) *(à construire)*
  **▸ Pièce 5 — knowledge** (`knowledge_docs` · `knowledge_chunks`) *(à construire)*
  **▸ Pièce 6 — index dérivés** (`*_fts` **tous corpus** · `vec_*` **corpus hybrides seulement** — pas `conversations`) **+ journaux** (`consolidation_runs`, trace des effacements) *(à construire)*

- **Fait quand (pièce 1)** : insert `conversations` OK ; **UPDATE/DELETE `conversations` refusés** ; **fail-closed prouvé** (garde vide / `open` NULL / 2ᵉ ligne / `erase_gate` vidée → UPDATE/DELETE **toujours refusés** — B1/m-1) ; sas `open=1`→DELETE→`open=0`, et **transaction du sas avortée → garde refermée** ; **test génératif** — le générateur de triggers appliqué à une **table jetable** prouve insert-only + gate (le patron 2→3, pas seulement `conversations` — M-3) ; `sessions` mute (`summary`/`last_active`) sans trigger ; `turn_signals` insert + **purge de rétention** OK ; écriture sidecar **impossible** (F2). *(U-M0-p1.)* — *(def-de-« fait » de M0 complétée au fil des pièces 2→6.)*

### M1 — Prise `embed` *(à construire — ossature validée)*
### M2 — Moteur de recherche multi-corpus *(à construire)*
### M3 — Écriture d'un fait + outils MCP *(à construire)*
### M4 — Consolidation micro *(à construire)*
### M5 — Consolidation deep *(à construire)*
### M6 — Injection du bloc mémoire *(à construire)*
### M7 — Connaissances / RAG *(à construire)*
### M8 — Effacement souverain *(à construire)*
### M9 — Changement de modèle d'embedding *(à construire)*

---

## 4. Tests *(construits pièce par pièce — U-Mx par tâche + I-n transverses pointés vers `02` §6)*

- **U-M0-p1** : insert OK · UPDATE/DELETE `conversations` refusés · sas ouvre/ferme + **rollback referme la garde** · `sessions` mutable · `turn_signals` rétention · écriture sidecar impossible (F2).

---

## 5. Critères d'acceptation *(pointés vers `02` §6 — construits pièce par pièce)*

- **Critère 1 (immutabilité)** → M0 pièce 1 (+ M8 pour le sas complet) / U-M0-p1.

---

## 6. Preuves de calibration Phase 3 *(depuis `02` §7 — construites pièce par pièce ; zéro chiffre inventé)*

- **Rétention `turn_signals` ≥ borne du backlog de consolidation** (audit conv 15, M-2) : `turn_signals` est une source **effaçable** relue par la réécriture nocturne du **lien** (« texture affect du jour », `03` §4.5) ; rétention < borne backlog + rattrapage multi-jours → **perte silencieuse de l'affect**. → poser l'**invariant** `rétention ≥ borne backlog`, ou **assumer** explicitement la perte (`02` §7 les listait séparément).

---

## 7. Journal des écarts (code ↔ `02`)

- **[Écart cahier→archi — `surface`, résolu + tracé — F1]** `02` §3.1 **conserve la colonne** `surface` mais **n'énumère aucune valeur** ; les valeurs viennent du **cahier** (`VISION.md` : `cowork`/`claude-code`/`navigator`/`front`), **mortes** sous « un seul guichet » (A1). **Résolu** : `surface` redéfini = **canal réellement utilisé du tour** (valeurs **candidates, calibration** : ex. `voix` / `dictée` / `ui-texte` toggle-off). Renvoi `02` §7. *(Si le croisé prouve la valeur dérivable de `mode` + toggle → la dropper.)*
- **[Couture socle↔mémoire — TROU à résoudre (audit conv 15, M-1)]** `02` §3.1 T14 veut `session_state` « référence la ligne courante de `sessions` », **sans deux vérités** — mais le socle (`plan/00` T1) définit `session_state` = `claude_session_id` + `updated_at` : **aucune colonne vers `sessions.id`**, et `claude_session_id` finit **dupliqué** (`sessions` **et** `session_state`) ; en plus `05` §4.1/AT2 y pose **encore** une colonne (marque « fil non-reprenable »). **À résoudre (conv 16 / ré-audit du tout)** : `session_state` gagne `current_session_id`→`sessions.id` (déclaré en `schema-02`, pas de FK stricte au temps socle) **et cesse de dupliquer** `claude_session_id` (lu depuis `sessions`) — **retouche du plan `00`** (comme le croisé conv 14). Le fil reste **remplaçable en place** (rotation SECOURS `05` T3 / invalidation `02` T1), continuité par `conversations`.
- **[Couture 02↔04 — `speaker`, note croisé inter-plans]** `02` §3.1 énumère « invité·e consenti·e » dans le domaine de `conversations.speaker` ; `04` §3.5 restreint l'écriture de `conversations` à Yohann/Sophia (tiers → `tablee_buffer`). Domaine large / politique restrictive — cohérent, **à confirmer au croisé**.
- **[Frontière 02→03]** le **patron de triggers insert-only + `erase_gate`** (pièce 1) est réutilisé par les 6 tables identitaires de `03` (contrat de substrat, `02` §5).
