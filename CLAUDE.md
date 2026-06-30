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

> **Retour clôture conv 7** : R1–R9 ont tenu sur toute l'ouverture Phase 2 + l'écriture du doc `00` (sans agent — plan mode harness géré en **texte libre**, **ExitPlanMode au seul moment de l'inscription** fichier ; un par un ; reco + « pourquoi pas »). **R5** respecté (doc gravé sur validation ; commit `[conv-7]` soumis à validation). **R4** : relecture intégrale des pilotes avant inscription. **R2/R3 testés DEUX fois par Yohann** (« challenge ta reco, pas de facilité ») → **deux révisions de fond assumées** : (1) IPC **REST+SSE → WebSocket** (mon REST+SSE = facilité déguisée : 2 transports + corrélation) ; (2) **boot mécanique → boot-réveil** (continuité/dignité/durabilité manquantes). **Audit empirique source de vérité** : reproche fondé (« pourquoi tu ne vérifies pas Windows ? ») → vérif **Plume** → a corrigé 00-D (port-claim/kill → pidfile/orphelin). **Audit avant inscription** exigé par Yohann → a trouvé **F1 (vrai bug : drapeau d'arrêt inversé)** + F2/F3/F4. **Anti-paternalisme** appliqué (onduleur **proposé pas prescrit** ; affect vocal = signal doux jamais diagnostic). *(Retour clôture conv 6 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 7 — 2026-06-30)

- **Phase 2 (docs techniques) OUVERTE.** Méthode actée : docs **par couche de dépendance** dans `docs/technique/`, **un fichier/couche**, **gabarit 7 rubriques** (arbitrages · interfaces · données · séquences · invariants · acceptation · calibration Phase 3), **pleine profondeur sur la structure / valeurs différées Phase 3**, + doc d'orchestration `99` en fin. **Ordre** : `00` socle → `01` vocal → `02` mémoire → `03` personnalité → `04` proactif/tablée → `05` ressources/résilience/coût → `99`.
- **✅ Doc `00-socle-process.md` GRAVÉ** (conv 7) : canal **WebSocket + REST** (00-A) · état durable **écrivain unique = orchestrateur** (00-B/F2) · **machine à états** gouverneur + budget « part de Sophia » (00-C) · **supervision sidecar = idiome Plume** (00-D : port libre dynamique + retry TOCTOU + pidfile/anti-recyclage + readiness + escalade SIGTERM/SIGKILL + drain stdio + hygiène env) · **boot-réveil** (00-E : instance unique · porte d'intégrité · charge+vérifie l'identité · continuité `--resume` · durabilité anti-coupure `synchronous=FULL`/snapshot atomique/drapeau d'arrêt) · audit **F1** (bug drapeau d'arrêt) **F3** (arrêt GPU gracieux) **F4** (rotations/multi-jours/frontières) intégré.
- **Phase 1 (audit du cahier) close (conv 6, A5→A38)** : Fondations A1–A4 · ✅ Couches 1–6 + mode tablée · 3 principes transversaux (« pas d'API » · « un seul guichet » · « roue de secours ») · passe de réalité #1→#5. *(Détail = journal + history.)*
- **Backlog enrichi (conv 7)** : **affect vocal** (humeur de Yohann dans la voix → `evt.affect`, couche 1⇄3, **signal doux jamais étiquette**) · **adresse naturelle** (« bonne nuit Sophia » d'un coup, A32-étendu, doc `01`).
- **Empirie conv 7** : **Plume = précédent Windows éprouvé** du process-lifecycle (`ortho/engine.ts` + `orphan-cleanup.ts`) → idiome réutilisé (00-D). Toolchain : **Node 24.13 · Python 3.14**.
- **Non figé** : arborescence applicative ; **onduleur** (durabilité matérielle) = optionnel/différé, zéro dépendance.

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
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` → **`docs/technique/00-socle-process.md`** (socle acquis). Puis le relais : `docs/journal/relais/RELAY-conv8.md`.
- **Décision centrale conv 8 : continuer la Phase 2 — écrire `docs/technique/01-pipeline-vocal.md`** (couche 1 : wake word · VAD · STT · fin de tour · TTS — A5–A9), **même méthode que `00`** (gabarit 7 rubriques · un par un · **audit avant de figer** · validation avant inscription). Y **placer** la **grammaire de l'adresse naturelle** (A32-étendu) + le **branchement de l'affect vocal** (`evt.affect`). **Socle `00` + couches 1–6 + mode tablée acquis (A5–A38) — bâtir dessus, ne pas rouvrir** (sauf vraie tension → signaler, §7).
- Format : annonce brève + sujet en mots simples en tête + un par un + reco / « pourquoi pas ».

### Vigilances
- **Dépendance Anthropic = VIGILANCE N°1** (hors contrôle) : FM1 métrage programmatique (suspendu) · FM2 throttling « ordinary usage » · FM3 `--bare`/OAuth headless · FM4 MAJ CLI cassent (health-check) · FM5 arrêt produit. Hedge = **multi-provider** (Max→x20→API→local) + sobriété + roue de secours — **réduit, n'élimine pas**. Usage Yohann **~85 % hebdo (x5)** par son travail pro → quota serré, résolution via **x20**.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; sortie via **ExitPlanMode au seul moment de l'inscription** fichier (géré ainsi conv 2-7 ; ExitPlanMode utilisé à l'inscription du doc `00`).
- **Méthode Phase 2 (établie conv 7)** : **gabarit 7 rubriques** par doc · **audit AVANT de figer** (a trouvé un vrai bug F1 — Yohann l'exige) · **challenge systématique de mes recos** (deux révisions de fond conv 7 : IPC, boot) · pleine profondeur sur la structure, chiffres différés Phase 3.
- **« Pas de V2 »** : on cadre la forme/profondeur, jamais une version au rabais ; build en **ordre de dépendances à pleine profondeur**.
- `--bare` jamais (A1) ; **CLI `claude -p` ≠ lib Agent SDK** (la lib exigerait une clé — à reconfirmer ; Sophia appelle le binaire).
- **Repo public** (`github.com/YdvSystems`) : `pre-commit` gitleaks actif ; secrets en `.env` ; `PATTERN` privé ; identité commits `Yohann Dandeville <contact@ydvsystems.com>`, **pas de Co-Authored-By**.
- **Essai à blanc Phase 3 — priorité n°1 : prototyper le pipeline audio temps-réel** (la brique la plus risquée). Choix exacts différés : wake word FR · Whisper · TTS local (Kokoro/Chatterbox) · embedding FR · timbre · seuils humeur (A16) · budget sommeil (A21) · **modèle local de secours** · **modèle speaker-ID** · stockage/connexion (à fournir).
- **Anti-flagornerie = risque quotidien n°1** : contrepoids = le **caractère** (A14 franche · A15 valeurs propres · A16 valeurs > humeur), **pas le social**. Yohann teste activement.
- **« Budget = jauge utilisateur fait foi »** : **ne pas gérer son temps/quota** ; **basculer sur SON signal** (outrepassé en conv 5, recadré).
- **Couches 1–6 + mode tablée (A5–A38) + socle `00` (conv 7) acquis** : ne pas rouvrir sans décision explicite. Noyau + genèse = write-once côté système. **Phase 1 close** → Phase 2 ne re-débat pas l'acquis, elle le **détaille techniquement** ; tension trouvée à la mise au détail = **signaler** (§7), pas trancher seul.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v7 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 7 (2026-06-30) — **Phase 2 ouverte** (méthode + ordre des couches + gabarit 7 rubriques) ; **doc `00-socle-process.md` gravé** (bi-runtime + gouverneur + boot/durabilité ; audit F1–F4) ; backlog enrichi (affect vocal · adresse naturelle A32-étendu). Prochain : doc `01-pipeline-vocal`.*
