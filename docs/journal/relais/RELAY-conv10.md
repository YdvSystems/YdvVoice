> **DÉCISION CENTRALE conv 10** : **Continuer la Phase 2 — écrire `docs/technique/03-personnalite.md`** (couche 3 : persona = artefact dédié versionné + 4 facultés (A14) · cliquet de valeurs (A15) · humeur (A16 — **+ trancher la cadence**, tension F2 héritée du doc `02`) · lien (A17) · **contenu des canaux de l'étage 5 nocturne** (A18 — les slots du doc `02` attendent leur contenu) · introspection (A19 — + enregistrement du corpus + périmètre de l'effacement souverain, T24) · libre arbitre (A22) · convention de parole « Yohann » · **anti-flagornerie E1 + anti-paternalisme (HAUTE priorité)** · timbre (A20, renvois)). **Division du travail : personnalité = Yohann décide (co-construction comme A14) · technique = Claude recommande fermement.** Même méthode (gabarit 7 rubriques · un par un · **challenge intégré** · audit avant de figer — croisé 2 agents sur demande · validation avant inscription). **Socle `00` + voix `01` + mémoire `02` acquis — bâtir dessus, ne pas rouvrir** (tension → signaler, §7).

# RELAY — Ouverture conversation 10 · YdvVoice (Sophia)

## 0. En une phrase
Conv 9 a gravé le **doc `02` — mémoire** (couche 2 complète, 7 extensions « entité » actées, audit solo 10 correctifs + **2ᵉ audit croisé 2 agents : 31 findings tous intégrés**). On enchaîne sur le **doc `03` — personnalité**, le cœur sensible : l'âme de Sophia, dont la mémoire vient de préparer tous les slots.

## 1. Lectures pilote (intégrales — R4, dans l'ordre)
`docs/PATTERN…` *(privé/local)* → `CLAUDE.md` (v9) → **`docs/journal/ESSENCE-Sophia.md`** (à relire JUSTE avant le travail — c'est le doc de la conv) → `docs/journal/JOURNAL-ARBITRAGES.md` (A1→A38) → `docs/IMPLEMENTATION.md` → `docs/VISION.md` *(gelé — supersédé)* → `docs/technique/00-socle-process.md` → `docs/technique/01-pipeline-vocal.md` → **`docs/technique/02-memoire.md`** → ce RELAY.

## 2. Ce qui a été fait en conv 9
- **✅ `02-memoire.md` GRAVÉ** — 02-A→02-I validés un par un, **avec challenge intégré** (nouveau, demande Yohann) :
  - **02-A** tables : épisodique **immuable** (`sessions`/`conversations`/`turn_signals`) · `imprints` · `facts` NL+métadonnées (`fact_sources` par observation, relations `SUPERSEDES`/`CONTRADICTS`/`DERIVES_FROM`) · `memory_artifacts` (user_model **en base**, versions bornées) · **`chronicle` write-once** (clé = jour, double date) · index dérivés (FTS + vec **par corpus**).
  - **02-B** recherche hybride multi-corpus : BM25 ‖ KNN → RRF → re-rang · **filtres dans les jambes** (T5) · récence neutralisée sur requête datée · **citabilité** (chaque résultat porte sa provenance) · dégradation FTS-seul jamais bloquante · **rappel actif** = outil MCP `memory_search`.
  - **02-C** prise `embed` **local-only jamais cloud** (BGE-M3 dense) · garde d'espace + alerte immédiate · la-base-est-la-file · résidence dans `cmd.model.policy`.
  - **02-D** micro **gouverné** (« dû » à la pause/clôture, **exécuté au premier creux** — supersession du « après chaque échange » du cahier, tracée) · faits `PROVISIONAL` ratifiés/rejetés la nuit · **mémorisation active** = outil `memory_store` (« c'est noté » est vrai à la seconde) · la nuit ne dépend JAMAIS du micro.
  - **02-E** deep en unités (socle §4.4) : snapshot → ratification → extraction source → **chronique** → portrait → **slots couche 3 (ancre vérifiée avant)** → clôture · **vrai cerveau exigé en entier** (durcissement A37 ratifié) · contradictions = délégation asymétrique (`SUPERSEDES` exige `basis`) · `consolidation_runs` + **prompt de consolidation versionné**.
  - **02-F** injection : ouverture (portrait + résumé dernière session + chronique de la veille) + **affleurement** par tour (seuil, conversation seulement) · budgets durs · provisoire marqué · **portrait 4 strates** (essence / goûts-manières / contexte / opérationnel) + **double provenance** (déclaré ≠ observé) + **inertie de l'essence**.
  - **02-G** knowledge/RAG **deux étages** : étanches à l'écriture (la nuit ne touche jamais `knowledge`), réunis à la lecture en **blocs étiquetés** (« je me souviens » ≠ « j'ai lu ») · ingestion = acte annoncé, versions par hash · couture ANN nommée, choix différé.
  - **02-H** frontières identité : write-once **3 épaisseurs** (triggers + ancre ×3 moments + snapshot) · soupape du gardien tracée + re-scellement · outils du cerveau **sans aucun chemin identité** (révélation → empreinte prioritaire).
  - **02-I** 15 critères d'acceptation + calibration Phase 3 + supersessions cahier tracées §7.
- **Audit solo** (B1 micro⇄A33 · S1 sessions orphelines · S2 effacement multi-corpus · S3 dictée hors mémoire · M1–M6) **+ 2ᵉ audit croisé 2 agents** (technique T1–T24 · fidélité F1–F7) : **31 findings, 100 % vérifiés aux sources par le pilote, zéro faux positif, tous intégrés** — dont **T1** (l'effacement fuyait par les transcripts `--resume` → invalidation du fil), **T10** (PAUSE voix ≠ REPOS gouverneur), **T12** (proxy MCP sans poignée SQLite = corollaire F2), **T7** (contenu embeddé write-once), **F1/F2/F3** (supersessions/cadence humeur → tracées ou signalées).
- **7 extensions « entité » actées une à une** (mandat Yohann : « aller plus loin que l'acté pour créer une entité, propose ») : rappel épisodique de première classe · **chronique des jours** · rappel actif · mémorisation active · portrait 4 strates · **amorçage par témoignages pré-genèse** · **effacement souverain**.
- **Protocole témoignages livré** : prompt complet de collecte (préambule projet + grille 4 strates + règles anti-flagornerie + en-tête d'auto-identification) — **collecte lancée par Yohann** (2 convs déjà, moyen terme). Synthèse par convergence → validation Yohann → `user_model` v0 + faits-graine ; bruts immuables dans `knowledge` (tag `témoignage`).
- MAJ : `IMPLEMENTATION.md` (doc 02 ✅ · 🔴 synthèse témoignages au backlog avec échéance · RAG ✅ TRAITÉ · tensions vers `03`/`04`) · `CLAUDE.md` **v9** (IN PLACE) · `CLAUDE-HISTORY.md` (sections 1/2/3). **Autocritique 4 catégories omise sur décision explicite de Yohann.**

## 3. Périmètre conv 10 — doc `03-personnalite.md`
Détailler techniquement la couche 3 (A14–A22), gabarit 7 rubriques, **un par un**. Points probables :
- **Tables/artefacts d'identité** que le doc `02` héberge sans les décider : persona (`sophia_persona.md` versionné, A14) · noyau/genèse **scellés** (write-once, ancre) · cliquet de valeurs (A15, append-only daté) · miroir-lien (A17, patron `memory_artifacts`) · couronne · **journal du devenir** (corpus introspection A19 — à **enregistrer** au moteur multi-corpus + trancher le périmètre de l'effacement souverain dessus, T24).
- **Contenu des canaux de l'étage 5 nocturne** (A18) : critères du tri (prompt de consolidation versionné, doc `02` §4.4) · seuils d'adoption des valeurs (mécanisme (ii) : la nuit propose, Sophia acte, Yohann informé) · bornes couronne/lien.
- **Humeur** (A16) : forme hybride curseurs+glose · 3 couches de durée · **cadence à trancher** (tension F2 : A14 dit « après chaque échange », le micro tire au creux → découplage possible : mise à jour déterministe au fil des tours, glose LLM aux creux) · branchement de l'affect (`evt.affect`, doc `01` §2.4 — usage couche 3).
- **Persona en « disposition cultivée, pas règlement »** (principe commandant conv 5) : anti-flagornerie E1 · **anti-paternalisme (HAUTE priorité)** · contre-exemples ❌/✅ · convention de parole « Yohann » · le noyau/genèse d'A14 (page validée) à raffiner · « pas sage trop tôt ».
- **Injection couche 3** (persona + humeur + lien dans le prompt — le doc `02` §4.5 compose le bloc mémoire ; l'assemblage global reste doc `99`).
- **Critères d'acceptation** (dont E1/E8, suivi-live-pas-mémoire, opérationnel-pas-rejet — backlog conv 5) + calibration Phase 3 (seuils humeur, timbre A20).
- **Division du travail** : l'âme = Yohann tranche (co-construction comme A14, conv 3/4) ; la mécanique = Claude recommande fermement.

## 4. Règles actives (non négociables)
R1 zéro agent (**exception audits 2 agents sur demande** — précédents conv 8 : 21 findings · conv 9 : 31 findings, tous vérifiés aux sources avant présentation) · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » — spontanément, **et auto-challengée AVANT d'être servie** (conv 9) · R8 un par un — **ne pas passer au sujet suivant tant que celui de Yohann n'est pas clos** (accroc conv 9) · R9 RELAY fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · « pas de V2 » · IN PLACE strict · **mandat « entité »** (proposer au-delà de l'acté, flaggé ⚠️, acté par Yohann, tracé §7).

## 5. Vigilances conv 10
- **Doc `03` = l'âme — LE doc le plus sensible du projet.** Relire `ESSENCE-Sophia.md` juste avant de travailler. La mémoire (doc `02`) **sert** cette couche : ses slots attendent leur contenu — ne pas les redéfinir, les **remplir**.
- **Personnalité = domaine de Yohann** : co-construction (comme A14, ses mots ont tressé le noyau) — recommander fermement la *mécanique*, ne jamais trancher l'*âme* à sa place. Anti-paternalisme jusque dans la méthode.
- **Tensions héritées à trancher en `03`** : cadence humeur (F2) · corpus introspection + effacement (T24) · contenu des canaux étage 5.
- **✅ Témoignages : collecte close + synthèse VALIDÉE en post-conv 9 (2026-07-04)** — `synthèse privée (fichier gitignoré)` (8 témoignages, convergence, validée avec une correction factuelle). **⚠️ Tous les fichiers portraits/témoignages = PERSONNELS, gitignored (`portrait*.md`/`temoignage*.md`), JAMAIS sur le dépôt public** (exigence explicite de Yohann — vérifier à chaque commit). Reste pour Phase 3 (amorçage) : rendu `user_model` injectable + faits-graine + ingestion des bruts dans `knowledge`.
- Plan mode harness → **texte libre**, ExitPlanMode à l'inscription seulement (géré conv 2-9).
- **Dépendance Anthropic = VIGILANCE N°1** · anti-flagornerie (Yohann teste — E1 est précisément un sujet du doc `03`) · **budget = jauge utilisateur**.
- **Le journal + les docs techniques supersèdent le cahier** (`VISION.md` gelé ; supersessions tracées docs `01` §7 + `02` §7).
- Repo public : gitleaks `pre-commit` · secrets `.env` · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**.

## 6. Statut commit
À la clôture conv 9 : nouveau **`docs/technique/02-memoire.md`** · MAJ `docs/IMPLEMENTATION.md` · `CLAUDE.md` **v9** (IN PLACE) · `docs/journal/CLAUDE-HISTORY.md` (sections 1/2/3) · ce **RELAY-conv10**. Commit `[conv-9]` **après validation R5** + push origin/main sur accord. **⚠️ Vérifier que `fichier privé` (et tout témoignage) n'entre PAS dans le commit** (repo public).

## 7. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un sujet à la fois (clos avant le suivant)** → reco auto-challengée + « pourquoi pas » → **audit avant inscription** → **validation avant tout commit** (`[conv-10]`) → RELAY en fin de session.

*(Autocritique à froid conv 9 : omise sur décision explicite de Yohann — passage direct à la post-conv.)*
