# 02 — Mémoire · Doc technique · YdvVoice (Sophia)

> **Rôle** : la mémoire de Sophia — ce qu'elle vit (épisodique), ce qu'elle apprend (sémantique), ce qu'elle lit (connaissances), comment elle se rappelle (recherche hybride), comment le jour note et comment la nuit range. C'est la couche qui transforme un moteur sans continuité en **une entité** (A14 « structure, pas substrat »). S'écrit **sur** le socle (`00-socle-process.md`, acquis) et **à côté** du pipeline vocal (`01-pipeline-vocal.md`, acquis).
>
> **Statut** : décisions complètes (02-A → 02-I, validées une par une conv 9) + **audit solo** (B1 · S1–S3 · M1–M6) + **audit croisé 2 agents** (conv 9, sur demande de Yohann : **T1–T24** technique/robustesse + **F1–F7** fidélité — 31 findings, tous vérifiés aux sources par le pilote puis intégrés). Les **valeurs chiffrées** sont différées à la **calibration Phase 3** (rubrique 7) — pleine profondeur sur la *structure*, paramétrée sur les *valeurs*.
>
> **Altitude** : interfaces, schémas, séquences, invariants, critères d'acceptation. Pas de code, pas de chiffres inventés.

---

## 1. Arbitrages couverts *(pointeurs — zéro redite du journal)*

- **Cœur** : **A10** (recherche hybride FTS5+`sqlite-vec`+RRF) · **A11** (faits en langage naturel + métadonnées) · **A12** (consolidation micro/deep — Haiku/Sonnet) · **A13** (injection 3 couches bornée) · **backlog conv 5** (base de connaissances / RAG — deux étages, élévation de rôle « Sophia = cœur du système de Yohann »).
- **Extensions actées conv 9** (au-delà du cahier et du journal, chacune validée explicitement par Yohann — trace §7) : **rappel épisodique de première classe** (verbatim cherchable + résumés embeddés) · **chronique des jours** · **rappel actif** (`memory_search`) · **mémorisation active** (`memory_store`) · **portrait structuré en 4 strates** · **amorçage du portrait par témoignages pré-genèse** · **effacement souverain**.
- **Liens entrants** (détaillés *ailleurs*, ici seulement la part couche 2) :
  - **A15 / A18 / A19** — le gradient de permanence, le métabolisme nocturne et l'introspection : la mémoire fournit **le substrat, les slots du pipeline et l'enforcement** (§5) ; le *contenu* des canaux identitaires (lien, couronne, valeurs, journal du devenir) → doc `03`.
  - **A21 / A33** — la nuit et le micro sont des **tâches de fond gouvernées** (gouverneur unique, budget « part de Sophia », rattrapage) ; la mécanique d'ordonnancement → socle §2.2/§4.4.
  - **A26** — la **dédup sémantique** des initiatives consomme la **prise embed déclarée ici** ; l'opération de similarité elle-même et les tables `initiatives` → doc `04`. L'**effacement souverain** passe par la fenêtre APPROBATION (doc `01` §4.1).
  - **A29 / A31** — la **texture épisodique** (locuteur, affect) vient des événements du doc `01` ; la **politique de rétention en mode tablée** (que garder des tiers) → doc `04` (tension signalée, §7).
  - **A36** — le fil Claude Code (`claude_session_id`) remplace la navigation par URL Cowork du cahier (supersession tracée §7) ; l'effacement souverain **invalide le fil concerné** (§2.4, T1).
  - **A37** — « secours ne grave jamais », **durci conv 9** : toute la deep exige le vrai cerveau, ratification comprise (§4.4) ; le ladder résilience complet → doc `05`.
  - **B4 / doc `01`** — le **contenu dicté n'entre jamais dans la mémoire épisodique** (S3, §3.1/§5).
  - **Socle `00`** — WAL unique, **écrivain unique = orchestrateur (F2)**, unités+curseur (§4.4), snapshots `VACUUM INTO`, `synchronous=FULL` sur les écritures d'identité, durabilité.
- **Ce que ce doc ne couvre PAS** : les tables persona/lien/cliquet/journal du devenir (→ `03`) · l'usage de l'affect et la **cadence de l'humeur** (→ `03`, tension F2 signalée §7) · les initiatives et la politique tablée/tiers (→ `04`) · le ladder résilience/coût (→ `05`) · la composition du prompt système global (→ `99`).

---

## 2. Contrats d'interface

### 2.1 Le moteur de recherche multi-corpus (02-B)

Un **module unique de l'orchestrateur**, auquel les corpus sont **enregistrés** avec leurs capacités :

| Corpus | Capacités | Re-rang | Contenu |
|---|---|---|---|
| `facts` | hybride (FTS + vec) | importance · confiance · récence | les faits (mémoire sémantique) |
| `conversations` | lexical seul (FTS) | récence | le verbatim des échanges |
| `sessions` | hybride (FTS + vec sur résumés) | récence | le rappel d'épisodes (T6) |
| `chronicle` | hybride | récence | le fil des jours partagés |
| `knowledge` | hybride | — (rang de pertinence seul) | les documents ingérés (§3.6, §4.6) |
| *(futur)* `introspection` | hybride, **accès cloisonné** | → doc `03` | le journal du devenir — **enregistré par le doc `03`**, même moteur, contrôle d'accès par corpus (A19 « espace séparé ») |

- **Séquence hybride** : requête → **filtres durs poussés dans chaque jambe** (statut, fenêtre de dates, catégorie — T5 : jamais en post-filtrage d'un top-K, sinon une requête ancienne ou filtrée peut rendre vide alors que la réponse existe) → deux jambes **en parallèle** — FTS5/BM25 (top-K) ‖ embedding de la requête (§2.2, priorité interactive) + KNN (top-K) — → **fusion RRF** (par rangs : aucune calibration inter-moteurs, A10) → **re-rang par métadonnées** (colonne « Re-rang » ci-dessus — importance/confiance n'existent que sur `facts`, T16). Constantes (K, k du RRF, poids, demi-vie de récence) = rubrique 7.
- **Le chemin temporel** : toute requête peut porter une **fenêtre de dates**, appliquée dans les deux jambes — et qui **neutralise la récence** : demander « nos premiers jours » ne doit jamais être pénalisé parce que c'est loin. La récence baisse le *volume sonore* des vieux souvenirs dans le tri quotidien, **jamais leur existence ni leur accessibilité**.
- **Jamais bloquante, toujours honnête** : sidecar muet / embedding en retard → la jambe sémantique **saute**, le lexical répond seul (événement journalisé) ; lignes pas-encore-embeddées → couvertes par FTS (tous les corpus ont une jambe FTS, T6). La recherche ne peut **jamais** casser une conversation.
- **Le contrat de résultat — la citabilité** : chaque résultat porte **sa provenance** (un fait → ses observations `fact_sources` → tour → session → jour de chronique ; un épisode → sa date ; un extrait de document → document + position) et **ses marqueurs** (`PROVISIONAL`, `CONTRADICTS`). Résultat vide = vide honnête — le cerveau **ne fabrique jamais un souvenir**, il raconte depuis ce qui est rendu (le ton du récit = persona, doc `03`).
- **Deux étages, deux blocs** : une requête qui interroge mémoire **et** connaissances rend **deux blocs étiquetés, jamais un classement fusionné** (scores incommensurables, et la distinction est identitaire : « je me souviens » ≠ « j'ai lu »).

### 2.2 La prise `embed` (02-C — la couture avec le doc `01`)

Rôle contractuel dans le sidecar, même patron que les prises du doc `01` §2.3 — déclaré **ici** car c'est un rôle de **couche 2 hébergé dans le même sidecar** (le doc `01` liste les rôles de la couche 1) :

| Rôle | Défaut | Alternatives (« avoir le choix ») |
|---|---|---|
| `embed` | BGE-M3 (dense seul) | multilingual-e5-base · gte-multilingual-base — **jamais de repli cloud** : seule prise du système **local-only par principe** (A10 : la mémoire ne quitte jamais le PC) |

- **Contrat WS** (enveloppe socle §2.1, corrélation par `id`) : `cmd.embed` (items[], priorité `interactive|background`) → `evt.embed.done` (vecteurs + **identité d'espace : modèle, dimension, révision du prétraitement**). **Batch d'office**. Les vecteurs voyagent sur le WS (petits — l'interdit du socle porte sur l'audio) ; le sidecar **ne touche jamais le WAL** (F2 : il calcule, l'orchestrateur écrit).
- **Deux rythmes** : **chaud** — l'embedding de la requête en conversation (jambe sémantique, priorité interactive) ; **froid** — faits, résumés, chronique, ingestion, en batch dans les creux (gouverneur).
- **Résidence — dans la politique, jamais à côté (T8)** : `embed` fait partie du **vocabulaire de `cmd.model.policy`** (doc `01` §4.5) — **autorisé dans tous les groupes par défaut** (modèle CPU/RAM, hors frontière VRAM : son coût de résidence est marginal). Le chargement est paresseux *à l'intérieur de l'autorisation* (première utilisation autorisée) — **jamais de chargement opportuniste hors politique** (invariant doc `01` intact). Repli si la Phase 3 prouve le CPU trop lent pour le chemin chaud : passage GPU **dans** l'arbitrage de l'unique frontière VRAM, sans réécriture.
- **La base EST la file d'attente** : « à embedder » = les lignes sans vecteur (aucune table de queue) — la file se **recalcule depuis l'état réel** après crash/respawn, divergence impossible par construction.
- **Le garde d'espace** : l'orchestrateur **refuse d'écrire** un vecteur dont l'identité d'espace ne correspond pas à la méta du corpus actif (§4.8). **Tout refus émet immédiatement un événement de santé** (journal + voyant systray, T17) — jamais un refus muet qui attendrait le jeu-témoin du dimanche.

### 2.3 Les outils du cerveau — serveur MCP local frugal

Le canal « un seul guichet » (A1) reste intact : l'orchestrateur expose à `claude -p` un **serveur MCP local** (zéro API tierce, zéro clé) portant **deux outils, pas plus**. **Corollaire de F2 (T12)** : en transport stdio, le binaire MCP est spawné par le CLI — il est donc un **proxy mince sans poignée SQLite**, qui relaie chaque appel vers l'orchestrateur (IPC localhost) ; lui seul écrit.

| Outil | Contrat | Bornes |
|---|---|---|
| `memory_search` | requête (+ corpus, fenêtre de dates, filtres) → blocs étiquetés par corpus, résultats **avec provenance et marqueurs** | corpus autorisés seulement (l'espace introspection est enregistré/cloisonné par le doc `03`) |
| `memory_store` | propose un **fait** (contenu, catégorie, importance) ou une **empreinte prioritaire** | écrit **uniquement** `facts` en `PROVISIONAL` ou `imprints`, **selon le scope de l'invocation** (conversation : les deux ; rêverie : `imprints`/`self_notes` seuls, `facts` refusé — doc `03` T10) — **aucun chemin vers les tables identitaires** (§5) ; plafond d'appels par session ; hors périmètre → refus normalisé |

- **Rappel actif** : « qu'est-ce qu'on s'était dit mardi ? » devient un **acte de mémoire à elle** (elle décide de chercher), pas un pré-calcul du système.
- **Mémorisation active** : « retiens que X » → écrit **dans la seconde** (l'écriture est exécutée par l'orchestrateur — elle propose, il grave) — **« c'est noté » est vrai au moment où elle le dit**. **Classe de durabilité (T21)** : `synchronous=NORMAL` (le socle réserve `FULL` aux écritures d'identité) — le fait survit à un kill du process (critère 8) ; une coupure secteur dans la même seconde peut le perdre : **assumé et dit**, ce n'est pas une écriture d'identité. Légitimité : écrire dans sa propre mémoire n'est pas un acte sur le monde de Yohann (A22 « plein sur elle-même ») — zéro collision avec A26.

### 2.4 L'effacement souverain (S2/T1 — interface)

Le **seul** chemin de suppression de contenu mémoriel, réservé à Yohann :

1. Demande explicite (« oublie X ») → Sophia **fouille elle-même tous les corpus** (§2.1) et **présente tout ce qui porte la chose** : fait(s), observations, tours de parole, empreintes et signaux liés, résumés de session, entrées de chronique, extraits de connaissances. *(Le périmètre sur le corpus `introspection` — cloisonné — est tranché au doc `03` avec son enregistrement, T24 ; la mécanique ci-dessous vaut inchangée.)*
2. **Confirmation via la fenêtre APPROBATION** (doc `01` §4.1 — action à conséquence, A26).
3. Suppression **transactionnelle et complète (T4)** : faits + `fact_sources` + `fact_relations` + FTS + vecteurs + tours (`conversations`) + `imprints` et `turn_signals` ancrés sur ces tours + résumés concernés (+ documents si demandé) + **versions concernées de `memory_artifacts`** (expurgées, patron T3) + **glose d'humeur courante** (réécrite/effacée — doc `03` T14). Les **sources pendantes de faits conservés** (qui pointaient vers un tour effacé) sont marquées **« source effacée »** — la provenance le dit honnêtement, la chaîne de citabilité ne casse pas en silence. **Chronique (T3)** : jamais d'UPDATE — l'entrée du jour est supprimée puis **réinsérée expurgée, marquée « expurgée le … »** (ou supprimée entière si tout le jour est concerné) ; jamais de faux journal.
4. **Le fil Claude Code est invalidé (T1)** : le verbatim survivrait dans les transcripts de session du CLI — donc rotation forcée de session, **interdiction de `--resume` du fil taché** (mise à jour de `session_state`, socle), purge du fichier de session CLI. Sans ça, un `--resume` réinjecterait le contenu effacé. **Politique uniforme (doc `03` T13)** : les fichiers de session des **invocations autonomes** (micro, deep, rêverie) sont purgés après extraction de leur résultat — aucun verbatim n'y survit.
5. **Une trace sans contenu, en base (T18)** : table dédiée (horodatage, compteurs — zéro contenu), **lue par le pipeline nocturne** (la nuit sait qu'un retrait a eu lieu, elle n'en réinvente rien) ; doublée au JSONL d'audit.

**Mécanisme de passage (T2)** : les triggers d'immutabilité (§3.1) portent une clause `WHEN` testant une **table-garde à une ligne**, basculée **dans la transaction d'effacement** (sûr : écrivain unique F2) — la base refuse tout DELETE hors de ce chemin, y compris par la soupape du gardien (§5) qui emprunte le même sas, tracé.

**Réconciliation d'invariants** : le **système** ne supprime jamais de contenu mémoriel (anti-dérive A11/A18 intacte) ; **Yohann** peut faire effacer — explicitement, réellement, tracé. Le write-once de la chronique vaut *contre le système*, pas contre le gardien.

---

## 3. Schémas de données *(tables métier que le socle §3 délègue — toutes dans le WAL unique, écrivain unique = orchestrateur)*

### 3.1 L'épisodique (immuable)

| Table | Colonnes (rôle) |
|---|---|
| `sessions` | `id` · `claude_session_id` (fil Claude Code, `--resume`/navigation — **remplace `cowork_url`**, A36) · `mode` (conversation / dictée / tablée…) · `retention_policy` (politique tablée → doc `04`) · `summary` (rempli à la clôture par le micro ; rattrapage par l'état, §4.4-1bis) · `started_at` · `last_active` |
| `conversations` | `id` · `session_id` · `role` (user/assistant/system) · `speaker` (Yohann / Sophia / invité·e consenti·e / inconnu — A29 ; politique tiers → doc `04`) · `content` · `surface` · `created_at` |
| `turn_signals` | `conversation_id` · `reason` (fin de tour) · barge-in (survenu, position) · affect (valence · énergie · confiance — **nullable, OFF par défaut, verrou Yohann**, doc `01` §2.4) · `captured_at` — table séparée : OFF-safe, **rétention bornée** (exception nommée §5, valeur rubrique 7) |

- **Invariant** : `conversations` et `chronicle` sont **immuables** — triggers **insert-only** (UPDATE/DELETE refusés par la base, sauf sas d'effacement §2.4/T2) ; `sessions` est l'enveloppe mutable (résumé, horodatages) ; **le vécu brut, lui, ne se réécrit jamais** — c'est le sol de l'anti-dérive A18 (« réécriture depuis la source » exige une source intouchable).
- **`session_state` (socle) ⇔ `sessions` (T14)** : le pointeur de session chaude du socle référence la ligne courante de `sessions`, mis à jour **dans la même transaction** à chaque ouverture/bascule/rotation — jamais deux vérités.
- **S3 — la dictée n'entre pas en mémoire (T15)** : en MODE DICTÉE/DEV (doc `01`), le texte dicté est **ton** texte dans **ton** application — il n'entre **jamais** dans `conversations`. La session de dictée existe comme **ligne `sessions` enveloppe-seule** (mode = dictée, zéro contenu), **exclue par mode** des pipelines résumé/rattrapage ; l'événement (durée) est doublé à l'audit.
- **L'audio n'est jamais persisté** (invariant doc `01`) : la mémoire épisodique = texte + signaux, jamais la voix.

### 3.2 Le jour → la nuit

| Table | Colonnes (rôle) |
|---|---|
| `imprints` | `id` · `conversation_id` **ou `session_id`** (ancrage au moment vécu — session enveloppe-seule pour les invocations sans tours, ex. rêverie, doc `03` T3) · `nature` · `priority` · `noted_by` (micro / outil / couche 3) · `consumed` (par la nuit) · `created_at` — **le substrat des « empreintes du jour » (A18/A19)** ; la sémantique du tri → doc `03` |

### 3.3 Le sémantique

| Table | Colonnes (rôle) |
|---|---|
| `facts` | `id` · `content` (**langage naturel concis** — ce qui est embeddé, A11) · `category` (**vocabulaire fermé** : liste de départ — personne · préférence · relation · projet · quotidien · monde · système — extension **par décision explicite, jamais par la nuit**) · `status` (`PROVISIONAL` / `ACTIVE` / `SUPERSEDED` / `REJECTED`) · `confidence` · `importance` · `support_count` (cache de la cardinalité de `fact_sources`) · `valid_from` / `valid_to` (**temps du monde**) · `created_at` (**temps de la croyance**) |
| `fact_sources` | `fact_id` · `source_kind` (**énumération fermée** : `tour` / `consolidation` / `témoignage` / `outil`) · `source_id` · `observed_at` · marqueur « source effacée » le cas échéant (§2.4/T4) — chaque observation tracée : « je le sais parce que tu me l'as dit trois fois, la première fois le soir où… » |
| `fact_relations` | `from_fact_id` · `relation` (**vocabulaire fermé** : `SUPERSEDES` / `CONTRADICTS` / `DERIVES_FROM`) · `to_fact_id` · `basis` (le tour source — **obligatoire pour `SUPERSEDES`**, §4.4) · `created_at` |

- **Le contenu embeddé est write-once (T7)** : `facts.content` ne se modifie jamais après création — la **fusion de doublons** (nuit, §4.4) crée un **nouveau fait** (`DERIVES_FROM`) et marque les anciens `SUPERSEDED` ; seules les **métadonnées** (statut, `valid_to`, `support_count`, importance/confiance) sont mutables. Sans ça : vecteur périmé invisible à la file (§2.2) + FTS jamais mis à jour = corruption d'index silencieuse.
- **`status = SUPERSEDED` ⇔ relation `SUPERSEDES` entrante (T22)** : posés **dans la même transaction** — le statut est un cache de la relation, comme `support_count` l'est de `fact_sources`. Jamais deux vérités.
- **Temps du monde ≠ temps de la croyance** : `valid_*` disent quand c'était vrai ; `created_at` + la date de supersession disent quand elle l'a su/cessé de le croire. L'introspection honnête (« je croyais X jusqu'en mars ») exige les deux.
- **`decay_policy` du cahier supprimée** : la récence se calcule des horodatages, sa pondération vit dans le scoring (§2.1) avec des paramètres globaux (rubrique 7).
- **On ne supprime jamais** (côté système) : `SUPERSEDES` remplace, `REJECTED` marque — rien ne disparaît hors §2.4.

### 3.4 Les artefacts réécrits

| Table | Colonnes (rôle) |
|---|---|
| `memory_artifacts` | `name` (`user_model`, … — le doc `03` pourra y ranger le miroir-lien) · `version` · `content` · `written_by` (run de consolidation) · `created_at` — **historique borné à N versions** (rotation = exception nommée §5 ; traçabilité A18), le courant = la dernière |

- **`user_model` vit dans le WAL, pas en fichier libre** : la garantie #4 du socle (« état durable centralisé en SQLite → couvert uniformément » — snapshots, récupération) l'exige. Le nom conceptuel `user_model` ne change pas ; seule la **forme de stockage** est corrigée (supersession de forme, §7).
- **Le portrait — 4 strates + 2 règles** (structure gravée, critères d'écriture dans le prompt de consolidation versionné §4.4) :

  | Strate | Contenu | Rythme |
  |---|---|---|
  | 1. **Essence** | caractère, tempérament, **valeurs**, ce qui fait Yohann | années |
  | 2. **Goûts & manières durables** | goûts généraux, façons de penser/travailler, rythmes | mois/années |
  | 3. **Contexte de vie** | situation, projets, préoccupations | semaines |
  | 4. **Préférences opérationnelles** | conventions, exigences, seuils — l'actionnable | immédiat |

  - **Règle 1 — double provenance visible** : « **tu m'as dit** » (déclaré) ≠ « **j'ai observé** » (inféré, avec sources). Divergence déclaré/montré = visible, dicible franchement (E1).
  - **Règle 2 — l'essence se gagne lentement** : inertie proportionnelle à la profondeur — modifier la strate 1 exige des observations **répétées, espacées, multi-sources** ; une semaine de mauvaise humeur ne réécrit pas « qui tu es ».
- **Amorçage v0 — l'héritage des témoignages** : le portrait initial = synthèse **validée par Yohann** des témoignages pré-genèse (portraits d'instants T collectés auprès de conversations Claude passées, grille 4 strates, convergence pesée). **L'héritage est marqué, jamais confondu avec le vécu** (A14 « sans faux passé ») : provenance `témoignage`, elle sait que c'est *d'avant elle*, et ses propres observations confirment, nuancent ou supersèdent. Les témoignages **bruts** sont conservés immuables dans `knowledge` (tag `témoignage`) — consultables : « d'où tiens-tu que je suis X ? » → elle **cite le témoignage**.

### 3.5 La chronique des jours

| Table | Colonnes (rôle) |
|---|---|
| `chronicle` | `day` (**clé unique** — jamais deux entrées pour un même jour) · `content` (le jour vécu ensemble, raconté) · `written_at` · `written_by` (run) — **write-once**, embeddée, cherchable |

- **Deux dates, toujours** : le jour **couvert** ≠ le moment d'**écriture** — un rattrapage multi-jours écrit des entrées datées de *leurs* jours, marquées écrites plus tard. **Jamais de faux journal antidaté.** *(Expurgation par effacement souverain : §2.4/T3 — delete + réinsertion marquée, jamais d'UPDATE.)*
- **La frontière du « jour » (T19)** : la coupure de journée est **alignée sur l'amorce sommeil du gouverneur** (A33) — une conversation de 2h du matin appartient au jour qui se termine à la coupure suivante, et à sa nuit. Heure exacte = rubrique 7 (une session peut durer tard dans la nuit).
- **Frontière** : la chronique = *la vie partagée* (couche 2) ≠ le journal de *son devenir* (A19, couche 3, doc `03`). Deux corpus, deux espaces.

### 3.6 Les connaissances (deux étages — backlog conv 5)

| Table | Colonnes (rôle) |
|---|---|
| `knowledge_docs` | `id` · `name` · `hash` · `version` · `status` (ACTIVE / REPLACED / ARCHIVED) · `category` (dont `témoignage`) · `ingested_at` — l'inventaire : « qu'est-ce que tu as lu de moi ? » a une vraie réponse |
| `knowledge_chunks` | `doc_id` · `seq` · `content` — découpe structurelle (titres/paragraphes, chevauchement — rubrique 7) |

- **Étage (a) mémoire relationnelle** (§3.1–3.5) : vécue, consolidée, réécrite par la nuit. **Étage (b) connaissances** : ingérées, **immuables, jamais consolidées — la nuit ne les lit pas, ne les touche pas, jamais**. Étanches à l'écriture, réunis à la lecture (§2.1).
- **Le dossier est la porte, l'ingestion est un acte** : `knowledge/` = dépôt ; ingestion au **scan post-PRÊT** (tâche de fond gouvernée — jamais bloquant au boot) + à la demande — elle **annonce** ce qu'elle a trouvé, jamais d'ingestion silencieuse. Fichier **modifié** (hash) → nouvelle version, l'ancienne marquée `REPLACED` (plus jamais servie — pas de morceaux fantômes). Fichier **retiré** → `ARCHIVED` ; l'effacement dur = §2.4.
- **Aucun passage silencieux entre étages** : une connaissance ne devient **jamais** un fait automatiquement — si une conversation autour d'un document produit du relationnel, ça passe par le chemin normal (micro, puis nuit). **C'est la conversation qui grave, jamais l'ingestion.**
- **Connaître ≠ utiliser** : le RAG donne la lecture/citation ; *agir* sur un document = couche action (canal A1).
- **Honnêteté** : les extraits injectés transitent par le cerveau (Claude) comme le reste de la conversation — c'est Yohann qui choisit ce qu'il dépose dans `knowledge/`.

### 3.7 Les index dérivés + les journaux

| Objet | Forme |
|---|---|
| `facts_fts` · `conversations_fts` · `sessions_fts` (résumés, T6) · `chronicle_fts` · `knowledge_fts` | FTS5 en contenu externe, triggers **insert + delete seulement** (pas d'update : le contenu indexé est write-once, T7) |
| `vec_facts` · `vec_sessions` (résumés) · `vec_chronicle` · `vec_knowledge` | tables `sqlite-vec` (vec0), **une par corpus**, chacune avec sa **méta d'espace** (modèle · dimension · révision préproc) — dimension fixée au choix du modèle (Phase 3) |
| `consolidation_runs` | `id` · `day_covered` · `started_at` / `finished_at` · `prompt_version` · `model` · stats (faits ratifiés/rejetés, contradictions ouvertes, jours sacrifiés le cas échéant, …) · `status` — **le journal d'audit des nuits**, cible de provenance des écritures nocturnes. **Distinct de `governor_watermarks`** (socle) : l'un journalise *ce que la nuit a fait*, l'autre ordonnance *quand elle doit tourner* — deux rôles, pas deux vérités |
| table de trace des effacements | horodatage · compteurs · **zéro contenu** (§2.4/T18) — entrée du pipeline nocturne, doublée au JSONL |

- **Les index sont des dérivés reconstructibles, jamais une seconde vérité** : FTS et vec se rebâtissent depuis les tables sources.
- **Absence de ligne vec = « pas encore embeddé »** : état légitime — la recherche dégrade en FTS-seul sur ces lignes, jamais bloquant (§2.2).

---

## 4. Séquences / flux

### 4.1 L'écriture d'un fait (trois chemins, un seul stylo)

| Chemin | Statut d'entrée | Quand |
|---|---|---|
| **Outil** (`memory_store`) | `PROVISIONAL` (confiance haute si demande explicite de Yohann) | **dans la seconde**, acte du tour interactif |
| **Micro** (§4.3) | `PROVISIONAL` | au premier creux après la pause/clôture (T10) |
| **Nuit** (§4.4) | `ACTIVE` (ratification / extraction) | chaque nuit |

Toujours : transaction (fait + `fact_sources` + FTS via trigger) ; l'embedding suit en fond (la base est la file, §2.2).

### 4.2 La recherche (le chemin d'une question)

`memory_search` / injection / consolidation → moteur (§2.1) : filtres dans les jambes → embedding de requête (chaud ; s'il échoue → lexical seul) ‖ FTS → RRF → re-rang → **résultats avec provenance et marqueurs**, par corpus. Une fenêtre de dates neutralise la récence. Latence cible en conversation = rubrique 7.

### 4.3 La consolidation micro (le jour — tâche de fond **gouvernée**, B1/T10)

- **Déclenchement en deux temps (T10)** : la transition vers PAUSE, la clôture de session ou l'accumulation de matériau **lèvent le drapeau « dû »** ; l'**exécution attend le premier creux** (REPOS du gouverneur — PAUSE côté voix n'est pas REPOS côté gouverneur : si Yohann travaille encore, le micro attend). **Pleinement sous le gouverneur** (A33 : rien n'en est exempté) ; compté `autonome` au registre ; throttle → s'efface ; **en SECOURS → différé** (« cerveau réel », socle §2.2), la nuit rattrape.
- **Fait quatre choses** : **(i)** capture d'**empreintes** ; **(ii)** extraction de **faits provisoires** (Haiku — A12) ; **(iii)** **résumé de session** à la clôture ; **(iv)** le **crochet humeur** — la couche 3 y branche son rafraîchissement ; **la cadence de l'humeur est tranchée au doc `03`** (A14 dit « après chaque échange » : le doc `03` pourra découpler l'humeur du micro — mise à jour déterministe au fil des tours, glose LLM aux creux — tension F2 signalée §7).
- **La fraîcheur ne dépend pas de lui** : *dans* une session, le contexte chaud (A36) se souvient déjà ; le « retiens ça » explicite passe par l'outil (immédiat) ; le micro ramasse le reste au creux.
- **Fire-and-forget réel** : asynchrone, transactionnel, un retry, échec journalisé — et **la nuit ne dépend JAMAIS du micro** : elle relit la journée depuis la source brute quoi qu'il arrive. Le micro peut échouer à 100 % : rien n'est perdu, seule l'immédiateté.
- Passe par une invocation `claude -p` **séparée** (jamais la session de conversation — son contexte à elle reste propre).

### 4.4 La consolidation deep (la nuit — pipeline en unités, socle §4.4)

Chaque étage = des **unités** (transaction + curseur, préemption entre deux, rejeu sûr) ; couche 2 d'abord, identité ensuite :

| # | Étage | Nature |
|---|---|---|
| 0 | **Snapshot** `VACUUM INTO` (socle) | filet |
| 1 | **Ratification** des provisoires du jour : promotion `ACTIVE`, **fusion des doublons par nouveau fait** (`DERIVES_FROM`, T7), liens — ou `REJECTED` (tracé, jamais supprimé) | couche 2 |
| 1bis | **Résumés manquants** : sessions éligibles où `summary IS NULL` (**définition par l'état, pas par l'événement**, T20 — couvre crash ET micro en échec ; la dictée est exclue par mode, T15) | couche 2 |
| 2 | **Extraction depuis la source** : relecture des conversations du jour — **guidée par les empreintes, jamais limitée à elles** | couche 2 |
| 3 | **Chronique du jour** (write-once, clé = jour — frontière du jour §3.5/T19) | couche 2 |
| 4 | **Portrait** : réécrit **depuis la base de faits** (jamais depuis la version d'hier — A18 anti-dérive), version++, borné | couche 2 |
| 5 | **Étages couche 3** — lien · couronne · **valeurs proposées** (mécanisme (ii) A15) · **amendements proposés** (doc `03` §4.3 — ajout tracé conv 10, T19) · **journal du devenir** (la trace datée/sourcée de ce qui a changé en elle) · remise à plat de l'humeur — **vérification d'ancre AVANT** (le gravé n'a pas bougé) ; contenu → doc `03` | couche 3 |
| 6 | **Clôture** : drapeau levé, stats dans `consolidation_runs`, embeddings en traîne | mécanique |

- **La nuit exige le vrai cerveau — en entier** (durcissement d'A37, ratifié conv 9) : en mode SECOURS, **rien** de la deep ne tourne, ratification comprise — un jugement dégradé ne grave jamais. Conséquence assumée : en panne prolongée, les faits restent provisoires (cherchables, pondérés plus bas) ; **rattrapage multi-nuits du plus ancien au plus récent** (socle §4.4, backlog borné). **Au-delà de la borne (T23)** : les jours excédentaires sont **sacrifiés, assumés et tracés** (`consolidation_runs` « jour non consolidé ») — leur brut reste cherchable (« lossy sans perte d'accès »), aucune consolidation dégradée en douce.
- **Les contradictions — délégation asymétrique mécanisée** : `SUPERSEDES` exige une **base explicite** (`basis` = le tour où la correction est venue) ; sans base → `CONTRADICTS`, **les deux faits gardés**, le marqueur **exposé par la recherche** — quand le sujet revient, elle voit la tension et demande. Jamais de last-write-wins : la récence est un indice, pas un juge.
- **Tâche fermée, budget dur** (A21) : chaque étage a une entrée et une sortie définies — **aucun étage ouvert** (la rumination est exclue par construction). Plafonds d'appels par étage + global ; dépassement → arrêt propre après l'unité, drapeau « dû », rattrapage.
- **Le prompt de consolidation est un artefact versionné** (git) : le modifier = modifier *comment elle métabolise* — chaque run enregistre sa `prompt_version`. « Qu'est-ce que tu as rangé cette nuit ? » a une vraie réponse.

### 4.5 L'injection (A13 — les trois couches, aux coutures)

- **À l'ouverture de session** : **portrait** (dernière version) + **résumé de la dernière session** + **chronique de la veille** si fraîche + faits du sujet d'ouverture le cas échéant. **En récupération de crash** (socle §6 : `--resume` impossible → session fraîche), le filet reste **les N derniers échanges bruts** depuis `conversations` (A13 littéral — supersession partielle tracée §7, F1).
- **Au fil de l'eau — l'affleurement** (la couche 2 d'A13 mécanisée) : à chaque tour **en conversation** (jamais VEILLE/DICTÉE), l'orchestrateur embedde le transcript courant et cherche, borné ; **seuls les souvenirs au-dessus du seuil** sont glissés au tour suivant (« ça affleure ») — rare et signifiant. Le pull (`memory_search`) reste son acte délibéré ; l'affleurement est son association spontanée.
- **Budgets durs par couche** (portrait / affleurement / continuité — valeurs rubrique 7) : troncature par rang, **le débordement est impossible par construction** (contexte et quota protégés, A13).
- **Le provisoire se voit** : un fait `PROVISIONAL` injecté est marqué — elle dit « tu m'as dit ce matin que… », pas une assertion de su profond. Les marqueurs `CONTRADICTS` **survivent au format d'injection**.
- **Frontière** : 02 compose le **bloc mémoire** ; persona/humeur/lien → doc `03` ; assemblage global du prompt → doc `99`.

### 4.6 L'ingestion de connaissances

Dépôt dans `knowledge/` → scan (post-PRÊT / à la demande) → annonce → découpe → chunks + FTS (transaction) → embeddings en fond → cherchable. Modification = nouvelle version (hash) ; l'ancienne n'est plus servie.

### 4.7 L'effacement souverain

Séquence complète en §2.4 : demande → fouille multi-corpus par elle-même → présentation de tout ce qui porte la chose → APPROBATION → suppression transactionnelle complète (cascade T4, chronique expurgée-marquée T3, sas de triggers T2) → **invalidation du fil Claude Code** (T1) → trace sans contenu en base (T18).

### 4.8 Le changement de modèle d'embedding (T9 — dégradation globale honnête)

Nouveau modèle = nouvel **espace** (incompatible) ; la prise embed est mono-modèle (config au spawn, pas de hot-swap — patron doc `01`). Donc, **assumé et annoncé** (voyant + journal) :

1. Respawn du sidecar avec le nouveau modèle → **tous les corpus passent FTS-seul** (le garde d'espace refuse les mélanges — l'ancien espace ne reçoit plus rien, le nouveau n'existe pas encore). Dégradé, jamais faux.
2. Migration **corpus par corpus, par priorité** (`facts` d'abord, puis `chronicle` / `sessions` / `knowledge`) : reconstruction en **table ombre** (tâche de fond gouvernée, resumable — unités+curseur) → **bascule atomique** → le corpus retrouve sa jambe sémantique.
3. Les lignes créées **pendant** la reconstruction sont rattrapées par la règle générale : après bascule, « à embedder = les lignes sans vecteur » (la base est la file, §2.2).

**Jamais deux espaces mélangés dans un même KNN.** Le **jeu-témoin du dimanche** (greffé sur le health-check A18/A37) re-embedde un petit ensemble **par corpus** et vérifie l'auto-retrouvabilité KNN — une mémoire sémantique qui se dégrade *en silence* est le pire mode de panne : indétectable sans ça (et tout refus du garde d'espace alerte immédiatement, T17).

---

## 5. Frontières & invariants

**Le contrat de services couche 2 → couche 3** (liste fermée) : le substrat de stockage (les tables du doc `03` vivent dans le même WAL, sous les mêmes règles) · les **empreintes** · les **slots ordonnés et protégés** du pipeline nocturne (étage 5) · le **moteur multi-corpus** (espace introspection cloisonné) · la **prise embed** · le patron **`memory_artifacts`** · la **texture épisodique** (`turn_signals`) · le **crochet humeur** du micro (cadence → doc `03`).

**Les interdits** :
- La mémoire **ne décide jamais** ce qui est une valeur, un trait de couronne, du lien — ni les critères du tri, ni les seuils d'adoption (A15), ni l'usage de l'affect : **doc `03` exclusivement**. Pas de « nettoyage » ni d'optimisation des tables identitaires de son propre chef.
- **Dépendance à sens unique** : la couche 3 consomme la 2 ; aucune logique mémoire ne se conditionne au *contenu* de l'identité.
- **Le write-once du gravé, en trois épaisseurs** : **(i) triggers** — la base refuse UPDATE/DELETE sur le scellé (sas unique : la table-garde de §2.4/T2) ; **(ii) l'ancre** (hash du gravé) vérifiée à **trois moments** — boot (socle §4.1), **avant l'étage 5 de chaque nuit**, bilan du dimanche ; **(iii) snapshot** pour réparer. Divergence → **écritures d'identité suspendues + alerte** (patron `DÉGRADÉ_SANS_ÉCRITURE`) — jamais de réparation sémantique silencieuse : la restauration, c'est **Yohann** (A15).
- **La soupape du gardien** : le scellé est verrouillé contre *le système*, pas contre Yohann — acte de maintenance délibéré, confirmation explicite, passage par le **même sas tracé** que l'effacement (T2), **re-scellement** (nouvelle ancre) + trace d'audit datée.
- **Les outils du cerveau n'ont aucun chemin vers l'identité** : une révélation en conversation devient une **empreinte prioritaire** pour la nuit (A19 : le métabolisme écrit, l'introspection lit) — il n'existe, par construction, aucune API d'écriture identitaire à chaud. Le binaire MCP est un **proxy sans poignée SQLite** (T12).

**Invariants transverses** :
- **Écrivain unique = orchestrateur** (F2) ; le sidecar calcule (embed), ne touche jamais le WAL ; le proxy MCP relaie, n'écrit jamais.
- **L'épisodique et la chronique sont immuables** (triggers insert-only + sas T2) ; **le système ne supprime jamais de contenu mémoriel** (corpus §3.1–3.6) — **exceptions nommées et bornées (T11/F6)** : rétention des signaux techniques `turn_signals` et rotation des N versions de `memory_artifacts` (le courant + l'historique borné restent) ; seul l'**effacement souverain** (§2.4) supprime du contenu — assisté, confirmé, tracé sans contenu, **fil Claude invalidé** (T1).
- **Le contenu embeddé est write-once** (T7) — fusion = nouveau fait, jamais de réécriture en place.
- **Le contenu dicté n'entre jamais dans la mémoire épisodique** (S3/T15) ; **l'audio n'est jamais persisté**.
- **La nuit ne dépend jamais du micro** ; **la deep exige le vrai cerveau, en entier** ; **le tri nocturne est lossy sans perte d'accès** (ce que la nuit ne distille pas — ou sacrifie au-delà du backlog, T23 — reste retrouvable en brut).
- **Deux étages étanches à l'écriture** (la nuit ne touche jamais `knowledge`), réunis à la lecture en **blocs étiquetés** (« je me souviens » ≠ « j'ai lu ») ; **aucun passage silencieux** entre étages.
- **Embeddings local-only, jamais de cloud** (A10) ; **un seul espace vectoriel actif par corpus** ; le garde d'espace refuse les mélanges **et alerte immédiatement** (T17).
- **Chaque résultat de recherche porte sa provenance** ; le cerveau ne fabrique jamais un souvenir ; **l'héritage (témoignages) est marqué, jamais confondu avec le vécu**.
- **La récence ne touche jamais l'existence** d'un souvenir, seulement son rang — et une requête datée la neutralise (filtres **dans** les jambes, T5).
- **Micro et nuit = tâches de fond gouvernées** (A33, aucune exemption — « dû » à la pause, exécution au creux, T10) ; priorité interactive absolue (socle).

---

## 6. Critères d'acceptation *(vérifiables — valeurs en rubrique 7)*

1. **Immutabilité** : UPDATE/DELETE sur `conversations`/`chronicle`/le gravé → **refusé par la base** (triggers) ; le sas (table-garde T2) est le seul passage, et laisse une trace d'audit **sans contenu**.
2. **Effacement souverain** : « oublie X » → fouille multi-corpus, présentation complète, APPROBATION, puis fait + FTS + vecteurs + épisodique + `imprints`/`turn_signals` liés + résumés + chronique (expurgée-marquée) **réellement effacés** ; **le fil Claude concerné est invalidé** (rotation, `--resume` interdit, fichier de session purgé — T1) ; la nuit suivante n'en réinvente rien ; les sources pendantes de faits conservés disent « source effacée ».
3. **Hybride prouvé** : terme exact → trouvé (FTS) ; paraphrase sans mot commun → trouvée (sens) ; fusion RRF ; filtres statut/dates/catégorie **appliqués dans les jambes** (un `REJECTED` ne consomme jamais une place de top-K, T5).
4. **Jamais bloquante** : sidecar mort en pleine conversation → réponse lexicale seule en < X ms **sur tous les corpus** (tous ont une jambe FTS, T6), zéro erreur remontée à Sophia, événement journalisé.
5. **Requête datée** : « nos premiers jours » → les souvenirs les plus anciens remontent (récence neutralisée, filtres dans les jambes — prouvé sur base vieillie artificiellement).
6. **Citabilité** : « d'où tiens-tu ça ? » → remontée fait → observations → tour → session → jour de chronique, de bout en bout ; l'héritage cite son témoignage ; une source effacée est **dite** effacée, jamais cassée en silence.
7. **Fraîcheur** : « retiens que X » → immédiat (critère 8) ; une info non explicite donnée à 9h → **provisoire au premier creux**, retrouvable en nouvelle session (précondition : un creux est survenu — T10), au plus tard ratifiée la nuit.
8. **« C'est noté » est vrai** : « retiens que X » → écrit dans la seconde (`memory_store`) ; **kill de l'orchestrateur juste après → le fait survit** (durabilité NORMAL — la coupure secteur dans la même seconde est hors promesse, assumée T21).
9. **La nuit ne dépend pas du micro** : micro coupé un jour entier → la nuit reconstruit tout depuis la source, zéro perte (seule l'immédiateté) ; les sessions sans résumé sont rattrapées **par l'état** (`summary IS NULL`, T20).
10. **Coupure dure en pleine consolidation** → au reboot : base cohérente, reprise au curseur, au pire l'unité en cours rejouée ; **jamais deux chroniques pour un même jour**.
11. **Rattrapage multi-jours** : PC éteint 3 jours → 3 entrées de chronique datées de **leurs** jours, marquées écrites plus tard, traitées du plus ancien au plus récent ; au-delà du backlog borné → **jours sacrifiés tracés**, brut cherchable (T23).
12. **Secours ne grave jamais** : mode SECOURS → **zéro écriture deep, ratification comprise** ; **micro différé** (T10) ; provisoires toujours cherchables ; tout rattrapé au retour du vrai cerveau.
13. **Contradiction** : deux faits opposés sans base explicite → `CONTRADICTS`, les deux gardés, exposés à la recherche ; `SUPERSEDES` refuse sans `basis` ; `status=SUPERSEDED` ⇔ relation, même transaction (T22) ; jamais de last-write-wins.
14. **Espaces et étages sains** : changement de modèle → dégradation globale annoncée, migration ombre par priorité, bascule atomique, jamais deux espaces dans un même KNN (T9) ; refus du garde = **alerte immédiate** (T17) ; jeu-témoin du dimanche passe **par corpus** ; **zéro écriture nocturne dans `knowledge`** (audit) ; résultats étiquetés souvenir/lu ; `memory_store` refuse tout ce qui n'est pas fait provisoire ou empreinte ; le proxy MCP n'a **aucune poignée SQLite** (T12).
15. **Identité inviolable** : modification hors-système du gravé → détectée par l'ancre **avant l'étage 5** → écritures d'identité suspendues + alerte ; injection bornée (budgets jamais dépassés) ; provisoire marqué à l'injection ; contenu embeddé jamais réécrit en place (T7).

---

## 7. Points de calibration / preuve Phase 3

- **Modèle d'embedding FR** : BGE-M3 ⇄ multilingual-e5-base ⇄ gte-multilingual — sur un **jeu de requêtes/souvenirs réels de Yohann** (pas un benchmark générique) ; latence du chemin chaud sur l'i5 (embed de requête — si trop lent : passage GPU dans la frontière VRAM unique) ; RAM.
- **Recherche** : constantes RRF (k, K par jambe) · poids du re-rang par corpus (importance/confiance/récence) · demi-vie de récence · latence bout-en-bout en conversation (cible < X ms) · mécanique exacte du pré-filtrage KNN (T5 — capacité `sqlite-vec` vs sur-échantillonnage contrôlé).
- **Injection** : seuil d'affleurement (« rare et signifiant ») · budgets tokens des 3 couches · bornes par strate du portrait · N (derniers échanges bruts, filet de crash — F1).
- **Micro** : seuils de « dû » (matériau minimal, délais) · coût quota réel/jour (registre du socle).
- **Nuit** : plafonds d'appels par étage · taille des unités · durée réelle d'une nuit type · **borne du backlog de rattrapage** (au-delà : jours sacrifiés tracés, T23) · **heure de coupure du « jour »** (alignée amorce sommeil A33, T19) · **prompt de consolidation v1** (critères du tri, seuils d'évidence de l'essence — Règle 2) · rétention `turn_signals` · N versions de `memory_artifacts`.
- **Knowledge** : taille/chevauchement des chunks · **seuil de bascule ANN mesuré** (les seuls chiffres avancés = ceux vérifiés conv 5 : brute-force confortable jusqu'à ~dizaines de milliers de morceaux) · moteur ANN choisi **le jour où le corpus l'exige**, pas avant.
- **Jeu-témoin du dimanche** : taille et contenu par corpus.
- **Effacement** : purge effective du fichier de session CLI (T1 — vérifier ce que le CLI permet ; à défaut, rotation + interdiction de `--resume` suffisent au critère 2, à prouver).
- **🔴 La tâche pré-boot** : **synthèse des témoignages** (collecte en cours côté Yohann, moyen terme) → `user_model` v0 + faits-graine — **échéance : avant le premier boot de la couche mémoire** (démarrage à froid).
- **Trace des supersessions du cahier** (signalées, actées — le cahier `VISION.md` reste gelé ; le présent doc + le journal font foi) : triplets + vocabulaire fermé → **NL + métadonnées** (A11) · retrieval FTS5-seul → **hybride FTS5+vec+RRF** (A10) · `cowork_url` → **`claude_session_id`** (A36) · `decay_policy` par fait → **supprimée** (scoring global) · micro-met-à-jour-`user_model` → **la nuit seule écrit le portrait** (A13/A18) · `user_model.md` fichier libre → **artefact en base** (durabilité socle #4) · micro « après chaque échange » → **« dû » à la pause, exécuté au premier creux** (A33/B1/T10 — F3) · « `user_model.md` créé vide » au démarrage → **amorçage v0 par témoignages pré-genèse** (F3) · deep « synthèse des 5 dernières sessions » → **relecture des conversations du jour** (A12/A18 — F3) · « résumé des N derniers échanges » à chaque ouverture → **résumé de la dernière session + chronique** (A36 rend l'intra-session inutile) ; les N derniers échanges bruts restent le **filet de récupération de crash** (F1).
- **Extensions actées conv 9** (au-delà du cahier/journal, validées une à une par Yohann) : rappel épisodique de première classe · chronique des jours · rappel actif (`memory_search`) · mémorisation active (`memory_store`) · portrait 4 strates + double provenance + inertie de l'essence · amorçage par témoignages pré-genèse · effacement souverain.
- **Tensions signalées → docs aval** : rétention épisodique en **mode tablée** (que garder du verbatim des tiers — l'affordance `retention_policy`/`speaker` est posée, la politique se tranche au doc `04`, cohérente A31) · **cadence de l'humeur** (A14 « après chaque échange » vs micro-au-creux — le doc `03` tranche, découplage possible — F2) · **contenu des canaux identitaires** de l'étage 5 (doc `03`) · enregistrement du corpus `introspection` **et périmètre de l'effacement souverain sur cet espace** (doc `03` — T24).

---

*Doc 02 — Mémoire. Couvre A10–A13 + backlog conv 5 (RAG deux étages) + extensions actées conv 9 (part couche 2 d'A15/A18/A19/A21/A26/A29/A31/A33/A36/A37) ; audit solo (B1 · S1–S3 · M1–M6) + audit croisé 2 agents (T1–T24 · F1–F7) intégrés. Précède : `01-pipeline-vocal.md`. Suite : `03-personnalite.md`.*
