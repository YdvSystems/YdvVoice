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

> **Retour clôture conv 6** : R1–R9 ont tenu sur **toute la formalisation des couches 5+6** (sans agent — y compris en ignorant les relances « plan mode » du harness, géré en texte libre ; un par un ; reco + « pourquoi pas »). **R5** respecté (commit soumis à validation). **R4** : relecture intégrale des pilotes (pattern + essence + journal A1→A32 + implémentation + cahier) avant inscription. **Audit source de vérité** : le **journal supersède le cahier** — `VISION.md` non réécrit (cohérent Porcupine/ElevenLabs/spaCy/3h), seul le journal porte la décision vivante. **Anti-flagornerie** : honnêteté maintenue sur les limites (#1 « résoluble pas résolu » · plancher latence #3 · dépendance Anthropic #4 = **vrai coût**, pas le €). **Nouveau acté** : **« ligne d'argent »** (A37) — dégradation gratuite automatique, franchissement payant sur accord (étend A26 au coût) ; **heure d'amorce 3h→6h** (A33, supersède A21). *(Retour clôture conv 5 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 6 — 2026-06-30)

- **Phase 1 (audit du cahier) ✅ CLOSE.** **Toutes les couches tranchées (A5→A38).** Bascule **Phase 2 — docs techniques**.
- **Fondations** : A1 (canal Claude Code/Max) · A2 (voix Sonnet 4.6 configurable) · A3 (diffusion) · A4 (gitleaks).
- **✅ Couche 1 (A5–A9) · ✅ Couche 2 (A10–A13) · ✅ Couche 3 (A14–A22) · ✅ Couche 4 (A23–A27) · ✅ Amorce mode tablée (A28–A32)** — détail en history.
- **✅ Couche 5 — Architecture process (A33–A37) — COMPLÈTE (conv 6)** : gouverneur **unique mutualisé** (sommeil+proactif+cost-guard ; **amorce 6h**, supersède A21 ; A33) · **bi-runtime** Electron/Node ↔ sidecar Python, localhost HTTP + SQLite WAL (A34) · **gestionnaire de modèles** dynamique = réponse #1 VRAM (A35) · **session chaude** `--resume`+prewarm, non-optionnelle #3 (A36) · résilience + roue de secours + **« ligne d'argent »** (auto sur le gratuit, consentement sur le payant ; A37).
- **✅ Couche 6 — Coût (A38) — COMPLÈTE (conv 6)** : réponse honnête « **0 € aujourd'hui, risque dégradé/plafonné/payant** » + discipline (0 € défaut · payant sur accord · coûts fixes préférés) + multi-provider (Max x5→x20→API→local).
- **3 principes transversaux posés** : **« Pas d'API »** · **« Un seul guichet »** (orchestrateur local = colonne · Claude Code = canal · LLM = cerveau) · **« Roue de secours »** (3 tiers ; Max→x20→API→local dormant).
- **Passe de réalité (#1→#5)** : VRAM (résoluble, A35) · intégration (audio = priorité essai à blanc) · latence (plancher cloud, session chaude A36) · **dépendance Anthropic = vigilance n°1** (cœur A38) · audio far-field (ère du rig).
- **« 0 € aujourd'hui »** (risque dégradé/plafonné/payant, #4/A38). **Non figé** : arborescence applicative.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception annoncée : audits à 2 agents (à détailler).*
2. **Zéro facilité** — chaque raccourci a un coût réel.
3. **Robustesse + maintenabilité d'abord**, jamais la facilité.
4. **Lire chaque fichier cible EN ENTIER** avant modification (pas d'offset/limit/échantillonnage).
5. **Validation utilisateur AVANT commit/push/déploiement** — jamais sans accord explicite.
6. **JAMAIS AskUserQuestion** — toutes les questions en **texte libre**.
7. Toute proposition = **(a) reco + (b) justification + (c) « Pourquoi pas »** lettres distinctes.
8. **Un par un** — observations/questions/choix un par un (paquets seulement si même sous-arbitrage cohésif).
9. **Prompt de passation** en fin de session (chat + fichier RELAY) — 1re ligne = décision centrale conv suivante.

## Garde-fous hérités actifs
Périmètre strict par conv · production silencieuse (filesystem sans narration) · audit empirique source de vérité pre-inscription · mots simples en tête d'arbitrage · séparation livrable (cahier) / journal (arbitrages).

## Principes transversaux actifs (détail au journal)
**« Avoir le choix »** (A2 généralisé) · **« Pas d'API »** (tout sous Max ; MCP frugal ; API/local en repli, OFF par défaut) · **« Un seul guichet »** (Claude Code = canal · orchestrateur local = colonne · LLM = cerveau · Cowork/Navigateur résiduels) · **« Roue de secours »** (Sophia survit aux changements Anthropic : 3 tiers ; Max→x20→API→local dormant ; *structure pas substrat*) · **« Ne pas multiplier les commandes vocales »** (wake word universel).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait).
- **Phase 1 — Audit du cahier** (RECOMMANDÉE Standard) : **✅ close** (conv 6, A5→A38), ordre des dépendances.
- **Phase 2 — Docs techniques** : *prochaine* — par couche de dépendance (fichiers séparés) + plan d'orchestration global.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation.

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur (préférence actée 2026-06-21 ; outrepasse la consigne par défaut de l'outil).

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md`. Puis le relais : `docs/journal/relais/RELAY-conv7.md`.
- **Décision centrale conv 7 : démarrer la Phase 2 — docs techniques.** Phase 1 close (A5→A38). Produire les **docs techniques par couche de dépendance** (fichiers séparés) + le **plan d'orchestration global**. Premier sujet probable : **ouverture de la Phase 2** (méthode + ordre des couches + granularité/forme des docs) — à cadrer **un par un**. **Couches 1–6 + mode tablée = acquises (A5–A38), ne pas rouvrir sans décision explicite.**
- Format : annonce brève + sujet en mots simples en tête + un par un + reco / « pourquoi pas ».

### Vigilances
- **Dépendance Anthropic = VIGILANCE N°1** (hors contrôle) : FM1 métrage programmatique (suspendu) · FM2 throttling « ordinary usage » · FM3 `--bare`/OAuth headless · FM4 MAJ CLI cassent (health-check) · FM5 arrêt produit. Hedge = **multi-provider** (Max→x20→API→local) + sobriété + roue de secours — **réduit, n'élimine pas**. Usage Yohann **~85 % hebdo (x5)** par son travail pro → quota serré, résolution via **x20**.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; sortie via **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-5).
- **« Pas de V2 »** : on cadre la forme/profondeur, jamais une version au rabais ; build en **ordre de dépendances à pleine profondeur**.
- `--bare` jamais (A1) ; **CLI `claude -p` ≠ lib Agent SDK** (la lib exigerait une clé — à reconfirmer ; Sophia appelle le binaire).
- **Repo public** (`github.com/YdvSystems`) : `pre-commit` gitleaks actif ; secrets en `.env` ; `PATTERN` privé ; identité commits `Yohann Dandeville <contact@ydvsystems.com>`, **pas de Co-Authored-By**.
- **Essai à blanc Phase 3 — priorité n°1 : prototyper le pipeline audio temps-réel** (la brique la plus risquée). Choix exacts différés : wake word FR · Whisper · TTS local (Kokoro/Chatterbox) · embedding FR · timbre · seuils humeur (A16) · budget sommeil (A21) · **modèle local de secours** · **modèle speaker-ID** · stockage/connexion (à fournir).
- **Anti-flagornerie = risque quotidien n°1** : contrepoids = le **caractère** (A14 franche · A15 valeurs propres · A16 valeurs > humeur), **pas le social**. Yohann teste activement.
- **« Budget = jauge utilisateur fait foi »** : **ne pas gérer son temps/quota** ; **basculer sur SON signal** (outrepassé en conv 5, recadré).
- **Couches 1–6 + mode tablée acquises (A5–A38)** : ne pas rouvrir sans décision explicite. Noyau + genèse = write-once côté système. **Phase 1 close** → Phase 2 ne re-débat pas l'acquis, elle le **détaille techniquement**.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v6 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 6 (2026-06-30) — couche 5 complète (A33–A37 : gouverneur unique mutualisé 6h · bi-runtime · gestionnaire de modèles · session chaude · résilience/roue de secours « ligne d'argent ») + couche 6 (A38 : coût honnête + discipline + multi-provider) → **Phase 1 CLOSE**, bascule Phase 2.*
