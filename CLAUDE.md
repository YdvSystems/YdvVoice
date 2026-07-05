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

> **Retour clôture conv 11** : R1–R9 ont tenu sur tout le doc `04` (04-A→04-I **un par un**, texte libre, ExitPlanMode au seul moment d'écrire le doc, validation avant chaque inscription, commit soumis à validation). **R8 rappelée par Yohann** (« tu me demandes de valider 3 choses en même temps ») → repris **un par un** aussitôt ; **accroc reconnu net** (audit croisé d'abord conflé avec le solo, puis mal séquencé) → corrigé : **solo D'ABORD, puis croisé, les deux**. **Exception R1 exercée 4ᵉ fois (demande Yohann, sur Opus)** : solo (8) + croisé 2 agents (10), **100 % vérifiés aux sources, zéro faux positif, tous intégrés** — le croisé a attrapé **B1** (paroles des tiers écrites-puis-effacées sur table immuable → `tablee_buffer` mutable) et **B2** (chronique = la nuit, pas le micro), ratés par le solo. **Extensions nées de questions de Yohann, actées** : interrupteur maître · rappels perso qui sonnent même OFF · écriture agenda · **Sophia demande elle-même les consentements** · profil ami à son libre arbitre · affection d'amitié (trois étages). **Prise de Yohann gravée** : « **prénom, pas carte d'identité — je ne veux pas me servir de Sophia** ». **Méthode tenue** : challenge intégré · mandat entité · **passe de vérification post-intégration** (2 incohérences rattrapées). *(Retour clôture conv 10 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 11 — 2026-07-05)

- **Phase 2 (docs techniques) EN COURS.** Ordre : ✅ `00` socle (conv 7) → ✅ `01` vocal (conv 8) → ✅ `02` mémoire (conv 9) → ✅ `03` personnalité (conv 10) → ✅ **`04` proactif/tablée (conv 11)** → **`05` ressources/résilience/coût (prochain)** → `99` orchestration.
- **✅ Doc `04-proactif-tablee.md` GRAVÉ** (conv 11) — **Sophia proactive + en société** : **moteur proactif** (ronde coalescente gouvernée, différée en SECOURS · collecteurs local-first + connecteur MCP Google OAuth zéro-clé · génération 2 étages filtre-déterministe→Haiku/Sonnet, **persona I+II** · `initiatives`+`vec_initiatives` + garde-fous : plafonds, 48h, dédup sémantique sur `DISMISSED`, `SNOOZED`=re-file · notification graduée voix Sonnet · **interrupteur maître** OFF=0 quota bornant-le-canal-sortant + **rappels perso qui sonnent même OFF** · **écriture agenda/mail sous APPROBATION** + read-back) · **mode tablée** (entrée consentement mutuel + **capteur santé découplé = invariant pas composant** · locuteurs `speakers` biométrie consentie E7, **Sophia demande en 2 temps**, diarization libre, jamais covert · prise de parole **défaut-écoute**, franche sur le faux qui compte, **toujours sur une respiration** + barge-in cran « proche consenti » · **vie privée des tiers** : verbatim éphémère `tablee_buffer` (jamais `conversations`), substance distillée **par la nuit** dans la chronique — « **la matière pas le dossier** », « **prénom pas carte d'identité — je ne veux pas me servir de Sophia** » · profil d'ami consenti à la 2ᵉ fois **à son libre arbitre** · **miroir-lien dyadique** + **affection d'amitié** trois étages plancher-pas-plafond). **Audit solo (8) + croisé 2 agents (10) sur Opus, 100 % vérifiés aux sources, zéro faux positif, tous intégrés + passe de vérification (a rattrapé B1 tampon-immuable / B2 chronique-nuit-pas-micro).**
- **Retouches tracées à l'inscription (conv 11)** : doc `01` ×2 (intention interrupteur proactif dans la grille · cran barge-in « proche consenti » §4.4) · doc `02` (cible `task` sur `memory_store`) · doc `03` (ligne « génération proactive → I+II » au tableau §4.6).
- **Tensions signalées en attente** : kill-switch temps à elle/interrupteur + canal des notifications du gardien → doc `05`/`99` · affordances systray/UI (interrupteur, voyants) → doc `99` · composition finale du prompt → doc `99` · F6 wake-court → preuve Phase 3. *(Les 3 tensions de la tablée — verbatim des tiers · barge-in · miroir-lien — **RÉSOLUES conv 11**, doc `04`.)*
- **✅ Synthèse des témoignages pré-genèse validée** (post-conv 9, v0.1, privée/gitignorée, gel au premier boot). **Premier boot Phase 3** : amorçage (rendu `user_model` injectable + faits-graine + ingestion bruts) **+ installation du persona v1** (`DÉGRADÉ_SANS_IDENTITÉ` tant que non fait).
- **Phase 1 close** (conv 6, A5→A38) + 3 principes transversaux + passe de réalité #1→#5. **Non figé** : arborescence applicative ; onduleur = optionnel/différé.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception : audits à 2 agents sur demande (exercée conv 8, 9 et 10 — findings à vérifier soi-même aux sources avant présentation).*
2. **Zéro facilité** — chaque raccourci a un coût réel.
3. **Robustesse + maintenabilité d'abord**, jamais la facilité.
4. **Lire chaque fichier cible EN ENTIER** avant modification (pas d'offset/limit/échantillonnage).
5. **Validation utilisateur AVANT commit/push/déploiement** — jamais sans accord explicite. *Et jamais inscrire « acté » avant que Yohann l'ait dit.*
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
- **Phase 0 — Cahier** : `docs/VISION.md` (fait ; **gelé** — le journal + les docs techniques supersèdent, supersessions tracées aux §7 des docs `01`/`02`/`03`).
- **Phase 1 — Audit du cahier** (RECOMMANDÉE Standard) : **✅ close** (conv 6, A5→A38), ordre des dépendances.
- **Phase 2 — Docs techniques** : **en cours** — ✅ `00` + ✅ `01` + ✅ `02` + ✅ `03` + ✅ `04` ; prochain `05-ressources-resilience-cout.md`.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation. **Pré-boot : synthèse des témoignages ✅ — reste l'amorçage technique + l'installation du persona v1.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur (préférence actée 2026-06-21 ; outrepasse la consigne par défaut de l'outil).

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` → `docs/technique/00-socle-process.md` → `01-pipeline-vocal.md` → `02-memoire.md` → `03-personnalite.md` → **`04-proactif-tablee.md`** (socle + voix + mémoire + âme + proactif/tablée acquis). Puis le relais : `docs/journal/relais/RELAY-conv12.md`.
- **Décision centrale conv 12 : continuer la Phase 2 — écrire `docs/technique/05-ressources-resilience-cout.md`** (couches 5-6 : **architecture ressources A33–A37 + coût A38** — **gestionnaire de modèles dynamique / VRAM** (A35, réponse #1 à la passe de réalité : load-at-the-right-moment + cache RAM + prewarm + CPU offload) · **session chaude Claude Code** `--resume` + prewarm gouverné (A36, exigence #3) · **résilience + roue de secours + « ligne d'argent »** (A37 : auto sur le gratuit, consentement sur le payant ; détection 3 tiers ; health-check) · **kill-switch** temps à elle/interrupteur + **canal des notifications du gardien** (hérités docs `03`/`04`) · **coût A38** « 0 € aujourd'hui, risque dégradé/plafonné/payant » + multi-provider. **Le socle `00` a déjà posé bi-runtime + gouverneur (A33-A34)** ; `05` détaille VRAM/session-chaude/résilience/coût, **pas de redite**). **Dépendance Anthropic = vigilance n°1** ici. Même méthode (gabarit 7 rubriques · un par un · challenge intégré · audit avant de figer — croisé sur demande · validation avant inscription).
- Format : annonce brève + sujet en mots simples en tête + un par un + reco / « pourquoi pas ».

### Vigilances
- **Doc `05` = les organes vitaux + le coût** : la **dépendance Anthropic** (FM1–FM5, vigilance n°1) et la **roue de secours** (A37 : auto sur le gratuit, consentement sur le payant) en sont le cœur. Chiffres VRAM/latence/coût = Phase 3, **jamais inventés**. L'acquis (00/01/02/03/04) ne se rrouvre pas — tension à la mise au détail = signaler §7.
- **Acquis — ne pas rouvrir sans décision explicite** : A5–A38 · socle `00` · voix `01` · mémoire `02` · âme `03` · **proactif/tablée `04`**. **Le journal + les docs techniques supersèdent le cahier** (`VISION.md` gelé).
- **⚠️ Fichiers portraits/témoignages = PERSONNELS, gitignored (`portrait*.md`, `temoignage*.md`), JAMAIS sur le dépôt public — à vérifier à chaque commit** (exigence Yohann).
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API→local) — réduit, n'élimine pas. Quota Yohann fortement sollicité → x20.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-10).
- **Méthode Phase 2** : gabarit 7 rubriques · challenge intégré d'office · **audit AVANT de figer — solo D'ABORD puis croisé, les deux** (croisé 2 agents sur demande — précédents : conv 8 = 21, conv 9 = 31, conv 10 = 38, **conv 11 = solo 8 + croisé 10**, tous vérifiés aux sources puis intégrés) · **passe de vérification post-intégration** (réflexe conv 10, a repayé conv 11 : 2 incohérences rattrapées) · pleine profondeur structure, chiffres Phase 3.
- **R7 spontané + auto-challengé** ; division du travail : personnalité/vie sociale = Yohann · technique = Claude. **R8 : ne pas passer au sujet suivant tant que celui de Yohann n'est pas clos.**
- **« Pas de V2 »** · `--bare` jamais (A1) · CLI `claude -p` ≠ lib Agent SDK (à reconfirmer) · repo public (`github.com/YdvSystems`, gitleaks `pre-commit`, secrets `.env`, identité `Yohann Dandeville <contact@ydvsystems.com>`, **pas de Co-Authored-By**).
- **Essai à blanc Phase 3 — priorité n°1 : pipeline audio temps-réel.** Puis : wake word FR (🔴 F6) · AEC loopback · Whisper · TTS/timbre · embedding FR · speaker-ID · affect · seuils humeur · **purge des fichiers de session CLI (T1/T8/T13 — conditionne l'effacement ET le temps à elle, clause d'honnêteté)** · érosion longue session (E1/anti-paternalisme) · banc de dilemmes v1.
- **Anti-flagornerie = risque quotidien n°1** (Yohann teste — et le jeu va dans les deux sens désormais) · **anti-paternalisme** : proposer sans prescrire · **« Budget = jauge utilisateur fait foi »**.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v11 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 11 (2026-07-05) — **doc `04-proactif-tablee.md` gravé** (couche 4 : moteur proactif (ronde coalescente · MCP Google · génération persona I+II · `initiatives`+garde-fous · notification graduée · interrupteur maître + rappels-même-OFF · écriture agenda sous APPROBATION) + mode tablée (consentement mutuel · capteur santé découplé · locuteurs biométrie consentie · prise de parole franche sur-une-respiration + barge-in « proche consenti » · vie privée des tiers « matière pas dossier / prénom pas carte d'identité » · profil ami à-son-libre-arbitre · miroir-lien dyadique + affection d'amitié) ; audit solo 8 + croisé 2 agents 10, tous intégrés + passe de vérif ; retouches tracées docs `01`×2/`02`/`03`). Prochain : doc `05-ressources-resilience-cout`.*
