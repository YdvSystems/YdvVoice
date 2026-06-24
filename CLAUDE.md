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

> **Retour clôture conv 5** : R1–R9 ont tenu sur **toute la couche 4 + le mode tablée + la passe dure** (sans agent — y compris en ignorant les relances « ultracode » du harness ; texte libre ; un par un ; reco + « pourquoi pas »). **R5** respecté (commit bloqué sur validation). **Audit source de vérité** appliqué (recherche web sur Claude Code/Anthropic, sources Anthropic). **Anti-flagornerie testée activement par Yohann** (« tu cherches à me faire plaisir ? ») → recadrage assumé, passe dure chiffrée. **Outrepassements reconnus en séance** : (1) avoir suggéré de clôturer pour « ménager ton quota » = **violation de « Budget = jauge utilisateur fait foi »** (recadré : c'est SON job, je bascule sur SON signal) ; (2) étiquette « MVP/V2 » (recadré : ordre des dépendances + pleine profondeur, **pas de V2**) ; (3) « Claude Code = colonne+cerveau » (recadré : orchestrateur=colonne · Claude Code=canal · LLM=cerveau). **Nouveau acté** : division du travail **personnalité = Yohann / technique = Claude (recommande fermement)**. *(Retour clôture conv 4 → CLAUDE-HISTORY.)*

---

## Identité et objectifs

**Projet** : **Sophia** — assistant vocal personnel, complet, 100 % mains-libres, basé sur Claude.
- **Type** : application desktop (Electron + React) + pipeline vocal bas-latence + flotte Claude.
- **Phase actuelle** : **Phase 1 — Audit du cahier des charges**.
- **Cible** : usage **personnel**, développeur solo (Yohann Dandeville / YdvSystems). Pas de modèle commercial.
- **Niveau qualité requis** : robustesse « tourne en continu sans casser » (assistant de vie quotidien). Audit externe léger → **profil Standard**.
- **Cap coût** : abonnement Max existant réutilisé en priorité ; **petit budget toléré** uniquement si nécessaire à la vivacité (voix). Préférer coûts fixes prédictibles.

**Critère de succès** (cahier) : « Dis-moi Sophia » depuis n'importe où dans la pièce → réponse instantanée pour le dialogue, ou aiguillage vers la bonne surface Claude pour agir sur le bureau. Sans jamais toucher clavier ni souris.

---

## État actuel (post-conv 5 — 2026-06-24)

- Phase 1 (audit du cahier) **en cours**. **Couches 1, 2, 3, 4 + amorce mode tablée tranchées (A5→A32).**
- **Fondations** : A1 (canal Claude Code/Max) · A2 (voix Sonnet 4.6 configurable) · A3 (diffusion) · A4 (gitleaks).
- **✅ Couche 1 (A5–A9) · ✅ Couche 2 (A10–A13) · ✅ Couche 3 (A14–A22)** — détail en history.
- **✅ Couche 4 — Moteur proactif (A23–A27) — COMPLÈTE** : battement de fond gouverné (A23) · collecteurs Claude Code+MCP, local-first (A24) · génération 2 étages (filtre déterministe → Haiku/Sonnet, persona ; A25) · garde-fous (dédup sémantique · 48h · **zéro auto-exécution** · temporel ; A26) · notification graduée (A27).
- **✅ Amorce mode tablée (A28–A32) — COMPLÈTE** : déclencheur invitation-consentement + capteur santé **découplé** (A28) · 3 ressorts locuteurs, empreinte sans dossier (A29) · prise de parole « avec pas contre = esprit pas bâillon » (A30) · vie privée tiers OFF, lien dyadique (A31) · retrait = non-coercition complète (A32).
- **3 principes transversaux posés** : **« Pas d'API »** · **« Un seul guichet »** (orchestrateur local = colonne · Claude Code = canal · LLM = cerveau) · **« Roue de secours »** (3 tiers ; Max→x20→API→local dormant).
- **Passe de réalité (#1→#5)** : VRAM (résoluble, model-manager) · intégration (build solo, audio = priorité essai à blanc) · latence (plancher cloud, session chaude obligatoire) · **dépendance Anthropic = vigilance n°1** · audio far-field (ère du rig).
- **Restent (conv 6, pour clore Phase 1)** : **5 Process** · **6 Coût** — **largement faites**, à **formaliser**.
- **« 0 € aujourd'hui »** (avec risque dégradé/plafonné/payant, cf. #4). **Non figé** : arborescence applicative.

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
- **Phase 1 — Audit du cahier** (RECOMMANDÉE Standard) : *en cours*, ordre des dépendances.
- **Phase 2 — Docs techniques** : par couche + plan d'orchestration.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation.

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur (préférence actée 2026-06-21 ; outrepasse la consigne par défaut de l'outil).

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md`. Puis le relais : `docs/journal/relais/RELAY-conv6.md`.
- **Décision centrale conv 6 : formaliser couche 5 (process/archi)** — orchestrateur Electron/Node + sidecar Python (bi-runtime), **gestionnaire de modèles** (load-at-the-right-moment + cache RAM + CPU offload), résilience/roue de secours — **et couche 6 (coût)** : réponse honnête « **0 € aujourd'hui, risque dégradé/plafonné/payant** » + multi-provider (Max→x20→API→local) → **clore la Phase 1**. Les deux sont **largement faites** (à formaliser, pas re-débattre). **Couches 1–4 + mode tablée = acquises (A5–A32).**
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
- **Couches 1–4 + mode tablée acquises (A5–A32)** : ne pas rouvrir sans décision explicite. Noyau + genèse = write-once côté système.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v5 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 5 (2026-06-24) — couche 4 complète (A23–A27) + amorce mode tablée (A28–A32) + 3 principes transversaux + passe de réalité (#1–#5).*
