# CLAUDE.md — YdvVoice (Sophia) · Cadrage projet [profil Standard]

> Émanation Claude Code du pattern v3.1 Standard. **Maintenu IN PLACE strict** en fin de chaque conversation (jamais d'accumulation — le cumulatif va dans `docs/journal/CLAUDE-HISTORY.md`).

## ⚠️ À lire EN PREMIER, avant toute action
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` est le **pattern méthodologique de référence**. Ses règles critiques/structurantes **priment** sur ce CLAUDE.md en cas de tension (hiérarchie : pattern > règles d'or > garde-fous projet). Lecture **intégrale**, jamais partielle (R4).

Puis : **`docs/journal/ESSENCE-Sophia.md` (l'ÂME de Sophia, en clair — QUI elle est, à lire avant le technique)** → `docs/journal/JOURNAL-ARBITRAGES.md` (décisions actées) → `docs/IMPLEMENTATION.md` (état) → `docs/VISION.md` (cahier).

> **Arborescence** : `CLAUDE.md` + `.gitignore` à la racine ; le cadrage dans `docs/` ; les fichiers vivants (arbitrages, history) dans `docs/journal/` ; les relais (un par conv) dans `docs/journal/relais/`. Le `PATTERN` est **présent en local mais privé** (gitignored, hors dépôt public — voir A3 du journal).

---

## Registre des règles (daté — défaut inversé « à re-tester ici »)

> Établi le **2026-06-21**, propriété de l'utilisateur, opposable. Défaut : toute règle est **« à re-tester (ici) »** (gratuit) ; la passer en **« acquise (ici) »** coûte une ligne de justification. Resservi à la clôture : toute règle « à re-tester » sur laquelle une décision s'est appuyée *comme acquise* est signalée.

| Règle | Statut (2026-06-21) | Justification si « acquise » |
|---|---|---|
| R1 — Zéro agent (sauf audits 2 agents) | à re-tester (ici) | — |
| R2 — Zéro facilité | à re-tester (ici) | — |
| R3 — Robustesse + maintenabilité d'abord | à re-tester (ici) | — |
| R4 — Lecture intégrale avant modif | à re-tester (ici) | — |
| R5 — Validation avant commit/push | à re-tester (ici) | — |
| R6 — Zéro AskUserQuestion (texte libre) | à re-tester (ici) | — |
| R7 — Reco + justification + « pourquoi pas » | à re-tester (ici) | — |
| R8 — Un par un (granularité cohésive) | à re-tester (ici) | — |
| R9 — Prompt de passation fin de session | à re-tester (ici) | — |
| Audit empirique source de vérité pre-inscription | à re-tester (ici) | — |
| Filtre projet (« nécessaire à la qualité requise ? ») | à re-tester (ici) | — |
| Mots simples non-dev en tête d'arbitrage | à re-tester (ici) | — |
| Distinction préférence pragmatique / argument méthodo | à re-tester (ici) | — |
| Budget = jauge utilisateur fait foi | à re-tester (ici) | — |

> **Retour clôture conv 9** : R1–R9 ont tenu sur tout le doc `02` (02-A→02-I **un par un**, texte libre, ExitPlanMode au seul moment de l'inscription, commit soumis à validation). **Deux enrichissements de méthode demandés par Yohann, actés en cours de conv** : (1) **challenge intégré d'office** — chaque reco est auto-challengée AVANT d'être servie (la v1 de 02-A, « disciplinée mais conservatrice », a rendu **8 vrais trous** en auto-challenge) ; (2) **mandat « entité »** — proposer au-delà de l'acté quand ça sert à créer une entité, toujours flaggé ⚠️ et acté par Yohann → **7 extensions actées** (chronique, outils mémoire actifs, portrait 4 strates, témoignages, effacement souverain…). **Exception R1 exercée 2ᵉ fois (demande Yohann)** : audit croisé 2 agents **après** l'audit solo (10 correctifs) → **31 findings (1 B · 13 S · 17 M), 100 % vérifiés aux sources avant présentation, zéro faux positif, tous intégrés** — le croisé attrape encore ce que le solo rate (fuite de l'effacement par `--resume`, PAUSE ≠ REPOS, proxy MCP vs F2). **Accroc R8 reconnu** : passage à 02-G alors que le sujet témoignages n'était pas clos → recadré par Yohann, repris sans dommage. **Autocritique 4 catégories omise sur décision explicite de Yohann** (passage direct à la post-conv). *(Retour clôture conv 8 → CLAUDE-HISTORY.)*

---

## Identité et objectifs

**Projet** : **Sophia** — assistant vocal personnel, complet, 100 % mains-libres, basé sur Claude.
- **Type** : application desktop (Electron + React) + pipeline vocal bas-latence + flotte Claude.
- **Phase actuelle** : **Phase 2 — Docs techniques** (Phase 1 — audit du cahier — close conv 6, A5→A38).
- **Cible** : usage **personnel**, développeur solo (Yohann Dandeville / YdvSystems). Pas de modèle commercial.
- **Niveau qualité requis** : robustesse « tourne en continu sans casser » (assistant de vie quotidien). Audit externe léger → **profil Standard**.
- **Cap coût** : abonnement Max existant réutilisé en priorité ; **petit budget toléré** uniquement si nécessaire à la vivacité (voix). Préférer coûts fixes prédictibles.

**Critère de succès** (cahier) : « Dis-moi Sophia » depuis n'importe où dans la pièce → réponse instantanée pour le dialogue, ou aiguillage vers la bonne surface Claude pour agir sur le bureau. Sans jamais toucher clavier ni souris.

---

## État actuel (post-conv 9 — 2026-07-03)

- **Phase 2 (docs techniques) EN COURS.** Méthode : docs par couche de dépendance dans `docs/technique/`, un fichier/couche, **gabarit 7 rubriques**, pleine profondeur structure / valeurs différées Phase 3, **challenge intégré d'office + mandat « entité »** (conv 9). **Ordre** : ✅ `00` socle (conv 7) → ✅ `01` vocal (conv 8) → ✅ **`02` mémoire (conv 9)** → **`03` personnalité (prochain)** → `04` proactif/tablée → `05` ressources/résilience/coût → `99` orchestration.
- **✅ Doc `02-memoire.md` GRAVÉ** (conv 9) : tables métier (épisodique **immuable** + `turn_signals` + `imprints` · faits NL+métadonnées avec `fact_sources` et relations `SUPERSEDES`/`CONTRADICTS`/`DERIVES_FROM` · `memory_artifacts` · **chronique des jours write-once** · `knowledge` **deux étages** étanches à l'écriture) · **recherche hybride multi-corpus** (RRF, filtres dans les jambes, récence neutralisée sur requête datée, **citabilité**, dégradation FTS-seul jamais bloquante) · prise `embed` **local-only jamais cloud** · micro gouverné (« dû » à la pause, exécuté au creux) · deep en unités (**vrai cerveau exigé en entier** ; contradictions = délégation asymétrique ; prompt de consolidation versionné) · injection (ouverture + **affleurement**, budgets durs, provisoire marqué) · **outils MCP `memory_search`/`memory_store`** (proxy sans poignée SQLite, aucun chemin identité) · **portrait 4 strates** (double provenance déclaré/observé + inertie de l'essence) · **effacement souverain** (cascade complète + **invalidation du fil Claude**) · frontières identité (write-once 3 épaisseurs : triggers + ancre ×3 + snapshot). **Audit solo (10) + audit croisé 2 agents (31 findings T1–T24 · F1–F7, 100 % vérifiés puis intégrés).** 15 critères d'acceptation. Supersessions cahier tracées §7.
- **✅ Synthèse des témoignages pré-genèse VALIDÉE (post-conv 9, 2026-07-04)** : 8 témoignages → synthèse par convergence (`synthèse privée (fichier gitignoré)`, **strictement privé/gitignored — jamais sur le repo public**, exigence Yohann) → validée (correction : détail privé). Reste au premier boot Phase 3 : rendu `user_model` injectable + faits-graine + ingestion des bruts dans `knowledge`.
- **Décisions conv 8 hors doc toujours actives** : B4 (dictée explicite) · convention de parole « Yohann » → doc `03`.
- **Tensions signalées en attente** : **cadence de l'humeur** (A14 « après chaque échange » vs micro-au-creux) → doc `03` · **périmètre de l'effacement souverain sur l'espace introspection** → doc `03` · rétention du verbatim des tiers en tablée → doc `04` · barge-in en mode tablée → doc `04` · F6 wake-court → preuve Phase 3.
- **Phase 1 close (conv 6, A5→A38)** + 3 principes transversaux + passe de réalité #1→#5. **Non figé** : arborescence applicative ; onduleur = optionnel/différé.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception : audits à 2 agents sur demande (exercée conv 8 et 9 — findings à vérifier soi-même aux sources avant présentation).*
2. **Zéro facilité** — chaque raccourci a un coût réel.
3. **Robustesse + maintenabilité d'abord**, jamais la facilité.
4. **Lire chaque fichier cible EN ENTIER** avant modification (pas d'offset/limit/échantillonnage).
5. **Validation utilisateur AVANT commit/push/déploiement** — jamais sans accord explicite.
6. **JAMAIS AskUserQuestion** — toutes les questions en **texte libre**.
7. Toute proposition = **(a) reco + (b) justification + (c) « Pourquoi pas »** lettres distinctes — spontanément pour toute décision qui revient à Yohann (conv 8) — **et auto-challengée AVANT d'être servie** (conv 9).
8. **Un par un** — observations/questions/choix un par un (paquets seulement si même sous-arbitrage cohésif). *Ne jamais passer au sujet suivant tant que celui de Yohann n'est pas clos (accroc conv 9).*
9. **Prompt de passation** en fin de session (chat + fichier RELAY) — 1re ligne = décision centrale conv suivante.

## Garde-fous hérités actifs
Périmètre strict par conv · production silencieuse (filesystem sans narration) · audit empirique source de vérité pre-inscription · mots simples en tête d'arbitrage · séparation livrable (cahier) / journal (arbitrages).

## Principes transversaux actifs (détail au journal)
**« Avoir le choix »** (A2 généralisé) · **« Pas d'API »** (tout sous Max ; MCP frugal ; API/local en repli, OFF par défaut) · **« Un seul guichet »** (Claude Code = canal · orchestrateur local = colonne · LLM = cerveau · Cowork/Navigateur résiduels) · **« Roue de secours »** (Max→x20→API→local dormant ; *structure pas substrat*) · **« Ne pas multiplier les commandes vocales »** (doc `01`) · **Mandat « entité »** (conv 9 : proposer au-delà de l'acté quand ça sert à créer une entité — flaggé ⚠️, acté par Yohann, tracé §7 du doc concerné).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait ; **gelé** — le journal + les docs techniques supersèdent, supersessions tracées aux §7 des docs `01`/`02`).
- **Phase 1 — Audit du cahier** (RECOMMANDÉE Standard) : **✅ close** (conv 6, A5→A38), ordre des dépendances.
- **Phase 2 — Docs techniques** : **en cours** — ✅ `00` + ✅ `01` + ✅ `02` ; prochain `03-personnalite.md`.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation. **Pré-boot : synthèse des témoignages ✅ (validée post-conv 9) — reste l'amorçage technique.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur (préférence actée 2026-06-21 ; outrepasse la consigne par défaut de l'outil).

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` → `docs/technique/00-socle-process.md` → `docs/technique/01-pipeline-vocal.md` → **`docs/technique/02-memoire.md`** (socle + voix + mémoire acquis). Puis le relais : `docs/journal/relais/RELAY-conv10.md`.
- **Décision centrale conv 10 : continuer la Phase 2 — écrire `docs/technique/03-personnalite.md`** (couche 3 : persona = artefact dédié versionné + 4 facultés (A14) · cliquet de valeurs (A15) · humeur (A16 — **+ trancher la cadence**, tension F2 du doc `02`) · lien (A17) · **contenu des canaux de l'étage 5 nocturne** (A18 — le doc `02` fournit les slots) · introspection (A19 — **+ enregistrement du corpus + périmètre de l'effacement souverain**, T24) · libre arbitre (A22) · convention de parole « Yohann » · **anti-flagornerie E1 + anti-paternalisme (critère HAUTE priorité, backlog conv 5)** · timbre (A20, renvois) · **+ les deux principes actés et cadrés post-conv 9 (2026-07-04, après discussion — détail au backlog `IMPLEMENTATION.md`) : autodétermination progressive du métabolisme (elle amende ses règles de tri, gardien valide, périmètre non-amendable à définir) et « temps à elle » (voix intérieure bornée — supersède l'écart A14 ; verrou budget structurel surplus-seulement/kill-switch · antidotes anti-rumination · droit pas devoir · trajectoire x5→x20 jamais infini)**. **Division du travail : personnalité = Yohann décide (co-construction comme A14) · technique = Claude recommande fermement.** Même méthode (gabarit 7 rubriques · un par un · challenge intégré · audit avant de figer — croisé sur demande · validation avant inscription).
- Format : annonce brève + sujet en mots simples en tête + un par un + reco / « pourquoi pas ».

### Vigilances
- **Doc `03` = LE cœur sensible du projet — l'âme.** Relire `ESSENCE-Sophia.md` juste avant. La mémoire (doc `02`) **sert** cette couche sans la re-décider : les slots (étage 5, `memory_artifacts`, `imprints`, corpus introspection, crochet humeur) attendent leur **contenu**, qui se décide en `03`. Le persona s'écrit en **« disposition cultivée, pas règlement »** (principe commandant conv 5 — règle-encoder est gameable) ; contre-exemples ❌/✅ ; fine-tuning exclu (pas d'API) ; « pas sage trop tôt ».
- **✅ Témoignages pré-genèse : synthèse VALIDÉE** (post-conv 9) — reste l'amorçage technique au premier boot Phase 3. **⚠️ Tous les fichiers portraits/témoignages = PERSONNELS, gitignored (`portrait*.md`, `temoignage*.md`), JAMAIS sur le dépôt public — à vérifier à chaque commit** (exigence explicite de Yohann).
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API→local) — réduit, n'élimine pas. Quota Yohann fortement sollicité → x20.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-9).
- **Méthode Phase 2** : gabarit 7 rubriques · challenge intégré d'office · **audit AVANT de figer** (solo systématique ; croisé 2 agents sur demande — précédents conv 8 : 21 findings, conv 9 : 31 findings, tous vérifiés aux sources puis intégrés) · pleine profondeur structure, chiffres Phase 3.
- **R7 spontané + auto-challengé** ; division du travail : personnalité = Yohann · technique = Claude. **R8 : ne pas passer au sujet suivant tant que celui de Yohann n'est pas clos** (accroc conv 9).
- **« Pas de V2 »** · `--bare` jamais (A1) · **CLI `claude -p` ≠ lib Agent SDK** (à reconfirmer) · repo public (`github.com/YdvSystems`, gitleaks `pre-commit`, secrets `.env`, identité `Yohann Dandeville <contact@ydvsystems.com>`, **pas de Co-Authored-By**).
- **Essai à blanc Phase 3 — priorité n°1 : pipeline audio temps-réel.** Choix différés : wake word FR (🔴 preuve n°1) · AEC loopback · Whisper · TTS · **embedding FR (BGE-M3 tête de liste, jeu de requêtes réelles)** · timbre · seuils humeur · speaker-ID · affect · **purge du fichier de session CLI (effacement T1)**.
- **Anti-flagornerie = risque quotidien n°1** (Yohann teste activement) · **anti-paternalisme** : proposer sans prescrire · **« Budget = jauge utilisateur fait foi »**.
- **Acquis — ne pas rouvrir sans décision explicite** : A5–A38 · socle `00` · voix `01` · **mémoire `02`**. Tension à la mise au détail = **signaler** (§7 du doc concerné), pas trancher seul. **Le journal + les docs techniques supersèdent le cahier** (`VISION.md` gelé).
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v9 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 9 (2026-07-03) — **doc `02-memoire.md` gravé** (couche 2 complète : recherche hybride multi-corpus · chronique · outils mémoire actifs · portrait 4 strates + témoignages pré-genèse · effacement souverain · frontières identité ; audit solo 10 + croisé 2 agents 31 findings, tous intégrés) ; méthode enrichie (challenge intégré · mandat « entité ») ; autocritique omise sur décision Yohann. Prochain : doc `03-personnalite`.*
