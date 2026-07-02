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

> **Retour clôture conv 8** : R1–R9 ont tenu sur tout le doc `01` (01-A→01-I **un par un**, reco + « pourquoi pas », validation avant chaque acquis ; plan mode en **texte libre**, ExitPlanMode au seul moment de l'inscription). **Exception R1 exercée pour la 1ʳᵉ fois, sur demande explicite de Yohann : audit à 2 agents** (technique + fidélité, lecture seule) → **21 findings, 100 % vérifiés aux sources par moi avant présentation, tous intégrés** (« si on peut pallier toutes ces fragilités, tout de suite, il faut le faire »). Leçon : **l'audit croisé trouve ce que le solo rate** (propriété d'état d'écoute, ancre A29 barge-in perdue, injection cahier réduite en douce) — le solo F1–F7 restait nécessaire (réveil rétroactif, AEC loopback). **R7 recadré une fois** : B4 servi d'abord comme simple « à toi de trancher » → Yohann a exigé l'arbitrage complet (options/reco/pourquoi-pas) — **le servir spontanément pour toute décision qui lui revient**. **Challenge inversé réussi** : sur la dictée Cowork, ma contre-proposition (dictée app-agnostique · fichiers = travail de Sophia) jugée par Yohann « mieux que ta première reco et mieux que ce que je proposais ». *(Retour clôture conv 7 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 8 — 2026-07-02)

- **Phase 2 (docs techniques) EN COURS.** Méthode : docs par couche de dépendance dans `docs/technique/`, un fichier/couche, **gabarit 7 rubriques**, pleine profondeur structure / valeurs différées Phase 3. **Ordre** : ✅ `00` socle (conv 7) → ✅ `01` vocal (conv 8) → **`02` mémoire (prochain)** → `03` personnalité → `04` proactif/tablée → `05` ressources/résilience/coût → `99` orchestration.
- **✅ Doc `01-pipeline-vocal.md` GRAVÉ** (conv 8) : chemin audio unique (**AEC loopback système entier** → ring buffer → consommateurs à curseur : wake·VAD·STT·turn·speaker-ID·affect) · **réflexes sidecar / décisions orchestrateur** · fin de tour **acoustique jamais sémantique** · TTS **énonciation streamée par phrases** + replay · **barge-in modulé par le locuteur** (nom = coupure immédiate ; A29 « l'ancre sert aussi le barge-in ») · résidence **politique gouvernée / réflexes armés localement** · prises provider (cloud OFF, zéro clé) · **grille d'adresse naturelle** (A32-étendu : match = énoncé entier ; réveil **rétroactif** ; « s'il te plaît » canonique ; réponses au prénom « Yohann ») · capteur d'affect (verrou speaker-ID, muet dans le doute, OFF) · phrases de secours (jamais de silence total) · resynchronisation respawn. **Audit solo F1–F7 + audit croisé 2 agents (21 findings B/S/M) intégrés.** 13 critères d'acceptation.
- **✅ Doc `00-socle-process.md` gravé** (conv 7) : bi-runtime + canal WS/REST + gouverneur (machine à états, budget « part de Sophia ») + supervision idiome interne éprouvé + boot-réveil + durabilité anti-coupure. *(Détail → history/journal.)*
- **Décisions conv 8 hors doc** : **B4 (Yohann)** — injection curseur = **dictée explicite** (« passe en dictée s'il te plaît », app-agnostique ; mode dev = cas particulier VS Code) — **supersède** l'« injection systématique » du cahier (tracé doc `01` §7) ; fichiers/dossiers = travail de Sophia (canal A1). **Convention de parole** : Sophia répond au **prénom « Yohann »** quand c'est cohérent → à graver au persona (doc `03`).
- **Tensions signalées en attente** : barge-in en mode tablée (convive peut-elle couper ?) → doc `04` · F6 wake-court (« Sophia » 2 syllabes) → preuve Phase 3 + repli nommé.
- **Phase 1 close (conv 6, A5→A38)** + 3 principes transversaux + passe de réalité #1→#5. **Non figé** : arborescence applicative ; onduleur = optionnel/différé.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception : audits à 2 agents sur demande (exercée conv 8 — findings à vérifier soi-même aux sources avant présentation).*
2. **Zéro facilité** — chaque raccourci a un coût réel.
3. **Robustesse + maintenabilité d'abord**, jamais la facilité.
4. **Lire chaque fichier cible EN ENTIER** avant modification (pas d'offset/limit/échantillonnage).
5. **Validation utilisateur AVANT commit/push/déploiement** — jamais sans accord explicite.
6. **JAMAIS AskUserQuestion** — toutes les questions en **texte libre**.
7. Toute proposition = **(a) reco + (b) justification + (c) « Pourquoi pas »** lettres distinctes — **y compris, spontanément, pour toute décision qui revient à Yohann** (recadrage conv 8).
8. **Un par un** — observations/questions/choix un par un (paquets seulement si même sous-arbitrage cohésif).
9. **Prompt de passation** en fin de session (chat + fichier RELAY) — 1re ligne = décision centrale conv suivante.

## Garde-fous hérités actifs
Périmètre strict par conv · production silencieuse (filesystem sans narration) · audit empirique source de vérité pre-inscription · mots simples en tête d'arbitrage · séparation livrable (cahier) / journal (arbitrages).

## Principes transversaux actifs (détail au journal)
**« Avoir le choix »** (A2 généralisé) · **« Pas d'API »** (tout sous Max ; MCP frugal ; API/local en repli, OFF par défaut) · **« Un seul guichet »** (Claude Code = canal · orchestrateur local = colonne · LLM = cerveau · Cowork/Navigateur résiduels) · **« Roue de secours »** (Sophia survit aux changements Anthropic : 3 tiers ; Max→x20→API→local dormant ; *structure pas substrat*) · **« Ne pas multiplier les commandes vocales »** (wake word universel + grille d'intentions minimale, doc `01`).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait ; **gelé** — le journal + les docs techniques supersèdent, supersessions tracées doc `01` §7).
- **Phase 1 — Audit du cahier** (RECOMMANDÉE Standard) : **✅ close** (conv 6, A5→A38), ordre des dépendances.
- **Phase 2 — Docs techniques** : **en cours** — ✅ `00` + ✅ `01` ; prochain `02-memoire.md`.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation.

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur (préférence actée 2026-06-21 ; outrepasse la consigne par défaut de l'outil).

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` → `docs/technique/00-socle-process.md` → **`docs/technique/01-pipeline-vocal.md`** (socle + voix acquis). Puis le relais : `docs/journal/relais/RELAY-conv9.md`.
- **Décision centrale conv 9 : continuer la Phase 2 — écrire `docs/technique/02-memoire.md`** (couche 2 : socle SQLite WAL · recherche hybride FTS5+`sqlite-vec`+RRF (A10) · faits NL+métadonnées (A11) · consolidation micro/deep (A12/A18, gouvernée A21/A33, unités+curseur du socle §4.4) · injection 3 couches bornée (A13)), **+ cadrer pleinement l'extension base de connaissances/RAG** (backlog conv 5 — deux étages : mémoire relationnelle consolidée ≠ connaissances ingérées jamais réécrites). **Même méthode** (gabarit 7 rubriques · un par un · audit avant de figer — 2 agents sur demande · validation avant inscription). Les tables métier mémoire = celles que le socle §3 délègue.
- Format : annonce brève + sujet en mots simples en tête + un par un + reco / « pourquoi pas ».

### Vigilances
- **Dépendance Anthropic = VIGILANCE N°1** (hors contrôle) : FM1 métrage programmatique (suspendu) · FM2 throttling « ordinary usage » · FM3 `--bare`/OAuth headless · FM4 MAJ CLI cassent (health-check) · FM5 arrêt produit. Hedge = **multi-provider** (Max→x20→API→local) + sobriété + roue de secours — **réduit, n'élimine pas**. Usage Yohann **fortement sollicité** par son travail pro → quota serré, résolution via **x20**.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** fichier (géré ainsi conv 2-8).
- **Méthode Phase 2** : gabarit 7 rubriques · **audit AVANT de figer** (solo systématique ; **audit croisé 2 agents sur demande de Yohann** — précédent conv 8 : 21 findings, tous vérifiés aux sources puis intégrés ; le croisé complète le solo, ne le remplace pas) · challenge systématique des recos · pleine profondeur structure, chiffres Phase 3.
- **Doc `02` = zone sensible identité/mémoire** : respecter le gradient de permanence (A15/A18 — write-once noyau/genèse, anti-dérive réécriture-depuis-la-source) ; la mémoire **sert** la couche 3, elle ne la re-décide pas ; écrivain unique = orchestrateur (socle F2) ; RAG = élévation de rôle à cadrer **sans gonfler le périmètre**.
- **R7 spontané** pour toute décision qui revient à Yohann (recadrage conv 8) ; division du travail : personnalité = Yohann · technique = Claude (recommande fermement).
- **« Pas de V2 »** · `--bare` jamais (A1) · **CLI `claude -p` ≠ lib Agent SDK** (à reconfirmer) · repo public (`github.com/YdvSystems`, gitleaks `pre-commit`, secrets `.env`, identité `Yohann Dandeville <contact@ydvsystems.com>`, **pas de Co-Authored-By**).
- **Essai à blanc Phase 3 — priorité n°1 : prototyper le pipeline audio temps-réel.** Choix différés : wake word FR (🔴 preuve n°1 + repli F6) · AEC loopback (horloges/périphériques) · Whisper · TTS local · embedding FR (BGE-M3 tête de liste) · timbre · seuils humeur · modèle secours · speaker-ID · affect (emotion2vec) · stockage/connexion (à fournir).
- **Anti-flagornerie = risque quotidien n°1** : contrepoids = le **caractère**, pas le social. Yohann teste activement. **Anti-paternalisme** : proposer sans prescrire.
- **« Budget = jauge utilisateur fait foi »** : ne pas gérer son temps/quota ; basculer sur SON signal.
- **Acquis — ne pas rouvrir sans décision explicite** : couches 1–6 + mode tablée (A5–A38) · socle `00` · voix `01`. Tension à la mise au détail = **signaler** (§7 du doc concerné), pas trancher seul. **Le journal + les docs techniques supersèdent le cahier** (`VISION.md` gelé — Porcupine/ElevenLabs/spaCy/3h/injection-systématique y figurent encore).
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v8 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 8 (2026-07-02) — **doc `01-pipeline-vocal.md` gravé** (couche 1 : audio/AEC · fin de tour · TTS/barge-in · grille d'adresse naturelle · affect ; audit solo F1–F7 + **premier audit croisé 2 agents**, 21 findings intégrés) ; **B4** dictée explicite (supersession cahier tracée) ; convention de parole « Yohann » → doc `03`. Prochain : doc `02-memoire`.*
