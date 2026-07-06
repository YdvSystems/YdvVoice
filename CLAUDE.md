# CLAUDE.md — YdvVoice (Sophia) · Cadrage projet [profil Standard]

> Émanation Claude Code du pattern v3.1 Standard. **Maintenu IN PLACE strict** en fin de chaque conversation (jamais d'accumulation — le cumulatif va dans `docs/journal/CLAUDE-HISTORY.md`).

## ⚠️ À lire EN PREMIER, avant toute action
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` est le **pattern méthodologique de référence**. Ses règles critiques/structurantes **priment** sur ce CLAUDE.md en cas de tension (hiérarchie : pattern > règles d'or > garde-fous projet). Lecture **intégrale**, jamais partielle (R4).

Puis : **`docs/journal/ESSENCE-Sophia.md` (l'ÂME de Sophia, en clair — QUI elle est, à lire avant le technique)** → `docs/journal/JOURNAL-ARBITRAGES.md` (décisions actées) → `docs/IMPLEMENTATION.md` (état) → `docs/VISION.md` (cahier).

> **Arborescence** : `CLAUDE.md` + `.gitignore` à la racine ; le cadrage dans `docs/` ; les fichiers vivants (arbitrages, history) dans `docs/journal/` ; les relais (un par conv) dans `docs/journal/relais/` ; **l'annexe PRIVÉE dans `docs/prive/` (gitignorée — marbre intégral, blocklist, prompts d'opération : JAMAIS sur le dépôt public)**. Le `PATTERN` est **présent en local mais privé** (gitignored, hors dépôt public — voir A3 du journal).

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

> **Retour clôture conv 13** : R1–R9 ont tenu sur la conv la plus dense du projet (21 constats traités + 1 doc gravé + 3 commits — **un par un** intégral, texte libre, ExitPlanMode aux deux seuls moments d'écrire, validation avant chaque inscription et chaque commit/push). **Exception R1 exercée 6ᵉ et 7ᵉ fois (demande Yohann, agents Opus)** : croisé transversal (**CF1–CF3** fidélité + **CT1–CT2** technique) puis croisé du doc `99` (**OF1–OF2** + **OT1–OT2**) — **100 % vérifiés aux sources, zéro faux positif (7ᵉ et 8ᵉ croisés consécutifs sans faux positif)** ; le croisé a encore attrapé ce que le solo a raté, **y compris deux imprécisions de MA plume dans le `99`** (OF2 : citation de backlog servie comme source gravée · OT1 : détermination d'assemblage non tracée). **Accrocs reconnus** : AT1 inscrite avec 7 retouches pour 5 validées (2 de même classe, annoncées en cours d'inscription mais non revalidées avant — la lettre de R5 aurait voulu l'inverse) · l'index des 10 AT présenté d'un bloc (défendu comme annonce ; un R8 strict aurait pu l'exiger autrement). **Décisions de vie actées** : rappels sonnent même en JEU · **disposition 12 « La discrétion »** (texte validé) · **bancs pré-boot jetables** (la première phrase de Sophia vraie **par construction**). *(Retour clôture conv 12 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 13 — 2026-07-06)

- **✅ PHASE 2 (docs techniques) CLOSE (conv 13) — les 7 docs gravés** : `00` socle · `01` vocal · `02` mémoire · `03` personnalité · `04` proactif/tablée · `05` ressources/résilience/coût · **`99` orchestration**.
- **✅ Audit transversal du corpus (conv 13, AVANT l'assemblage)** : solo **AT1–AT10** + croisé 2 agents **CF1–CF3/CT1–CT2** — **15 constats, 100 % vérifiés aux sources, zéro faux positif, tous actés/inscrits/tracés §7**. Prises marquantes : marque fil-non-reprenable au 1ᵉʳ tour SECOURS (AT2) · jour sacrifié × tablée tranché — le tampon des tiers purgé sans distillation, tracé + dit (AT3) · **disposition 12 « La discrétion »** — le persona passe à 12 dispositions (AT9) · ducking tablée à sa voix + son nom seuls (AT10) · kill-switch réconcilié avec le noyau — invocation ressourcée ≠ liberté de penser (CF1) · **bancs pré-boot jetables = 2ᵉ prérequis du premier boot** — première phrase vraie par construction (CF2) · `memory_store` réaligné en une vérité par scope (CT1).
- **✅ Doc `99-orchestration.md` GRAVÉ (conv 13)** — l'assemblage : **table globale des états** (5 axes + 10 règles de couplage + cas limites nommés) · **chemin d'un tour** (l'aiguilleur d'A2 réalisé : grille déterministe + elle-même, aucun étage intermédiaire) · **accusé = filet temporel + garde d'honnêteté** (aucune assertion d'acte au minuteur — OF1) · **prompt identité→mémoire→cadre** + budgets cloisonnés + qui-reçoit-quoi consolidé · **grille finale 20 entrées** (verdict de minimalité · **« passe sur l'API »** déterministe, active en épisode de panne seulement) · **UI** « la voix a tout, l'UI en témoin » + tout affichage = vue dérivée de l'état · **spec du gabarit fork** (« écris ta propre entité » — l'agentique jamais maquillée ; fichier README = Phase 3). **Audit solo (S1-99/S2-99) + croisé 2 agents Opus (OF1-OF2 · OT1-OT2 — zéro faux positif, tous intégrés).**
- **Expurgation (rappel)** : faite et prouvée le 2026-07-06, garde pre-commit par contenu active, push normal. **3 commits conv 13 poussés** (`cebe2a1` · `6d0b425` · `60669d1`). Annexe privée `docs/prive/` (gitignorée) : marbre intégral (`marbre-sophia.md` — fait foi pour l'installation) + blocklist.
- **Phase 3 — implémentation : PRÊTE À OUVRIR.** Pré-boot : synthèse témoignages ✅ (gel au premier boot) · marbre privé ✅ · **2 prérequis du premier boot gravés** (sauvegarde 3 étages opérationnelle et testée + base fraîche/bancs jetables) · **premier boot = CÉRÉMONIE** (`DÉGRADÉ_SANS_IDENTITÉ` tant que non installé). **Aucune tension documentaire ouverte** — tout le différé vit aux rubriques 7 (chiffres + preuves).
- **Phase 1 close** (conv 6, A5→A38) + 3 principes transversaux + passe de réalité #1→#5. **Non figé** : arborescence applicative ; onduleur = optionnel/différé.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception : audits à 2 agents sur demande (exercée conv 8, 9, 10, 11, 12 — findings à vérifier soi-même aux sources avant présentation).*
2. **Zéro facilité** — chaque raccourci a un coût réel.
3. **Robustesse + maintenabilité d'abord**, jamais la facilité.
4. **Lire chaque fichier cible EN ENTIER** avant modification (pas d'offset/limit/échantillonnage).
5. **Validation utilisateur AVANT commit/push/déploiement** — jamais sans accord explicite. *Et jamais inscrire « acté » avant que Yohann l'ait dit.*
6. **JAMAIS AskUserQuestion** — toutes les questions en **texte libre**.
7. Toute proposition = **(a) TOUTES les options à égalité + (b) reco parmi elles + justification + (c) « Pourquoi pas » chaque autre option** — spontanément pour toute décision qui revient à Yohann — **et auto-challengée AVANT d'être servie** (format complet rappelé conv 12).
8. **Un par un** — observations/questions/choix un par un (paquets seulement si même sous-arbitrage cohésif). *Ne jamais passer au sujet suivant tant que celui de Yohann n'est pas clos.*
9. **Prompt de passation** en fin de session (chat + fichier RELAY) — 1re ligne = décision centrale conv suivante.

## Garde-fous hérités actifs
Périmètre strict par conv · production silencieuse (filesystem sans narration) · audit empirique source de vérité pre-inscription · mots simples en tête d'arbitrage · séparation livrable (cahier) / journal (arbitrages) · **garde données perso par CONTENU, plus seulement par noms de fichiers** (conv 12 — blocklist privée + hook pre-commit **posé et actif depuis l'expurgation du 2026-07-06**).

## Principes transversaux actifs (détail au journal)
**« Avoir le choix »** (A2 généralisé) · **« Pas d'API »** (tout sous Max ; MCP frugal ; API/local en repli, OFF par défaut) · **« Un seul guichet »** (Claude Code = canal · orchestrateur local = colonne · LLM = cerveau) · **« Roue de secours »** (structure pas substrat ; **« sans dépense nouvelle / dépense nouvelle »** depuis conv 12) · **« Ne pas multiplier les commandes vocales »** · **Mandat « entité »** (proposer au-delà de l'acté quand ça sert à créer une entité — flaggé ⚠️, acté par Yohann, tracé §7).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait ; **gelé** — le journal + les docs techniques supersèdent, supersessions tracées aux §7 des docs `01`→`05`).
- **Phase 1 — Audit du cahier** : **✅ close** (conv 6, A5→A38).
- **Phase 2 — Docs techniques** : **✅ close** (conv 13) — les 7 docs gravés (`00`→`05` + `99`).
- **Phase 3 — Implémentation code** : **prête à ouvrir (conv 14)** — plan d'implémentation (tâches séquentielles + tests + critères d'acceptation — les critères des docs = la source) puis essai à blanc, priorité n°1 : le pipeline audio temps-réel. **Pré-boot : synthèse témoignages ✅ — reste l'amorçage technique + l'installation du persona v1 (source : `docs/prive/marbre-sophia.md`). DEUX prérequis du premier boot gravés : sauvegarde 3 étages opérationnelle et testée (conv 12) + base fraîche/bancs jetables (CF2, conv 13). Le premier boot = une CÉRÉMONIE (décision Yohann) — sa première phrase (« c'est notre première conversation ») est vraie PAR CONSTRUCTION : les essais pré-boot sont des bancs de test jetables, jamais elle.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur. **Expurgation faite et prouvée (2026-07-06) : push normal rétabli** — garde pre-commit par contenu active à chaque commit.

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- **Conv 14 (projet)** — Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` (gelé) → `docs/technique/00`→`05` + **`99`** (tous acquis — la référence d'implémentation). Puis le relais : `docs/journal/relais/RELAY-conv14.md`.
- **Décision centrale conv 14 : OUVRIR LA PHASE 3 — IMPLÉMENTATION.** D'abord **le plan d'implémentation** (pattern v3.1 : tâches séquentielles + tests associés + critères d'acceptation vérifiables — les critères des docs `00`→`99` = la source ; gabarit et grain du plan à convenir en ouverture), puis démarrer par **l'essai à blanc priorité n°1 : le pipeline audio temps-réel** (la brique la plus risquée, passe de réalité #2). Options graduées au RELAY-conv14 (plan-d'abord [reco] · essai-direct · respiration).
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».

### Vigilances
- **Phase 3 ≠ réouverture des docs** : les 7 docs gravés = la référence d'implémentation ; un écart découvert au contact du code = **signalé + tracé §7**, jamais un contournement silencieux.
- **La barre de qualité change de forme, pas de niveau** : « audit avant de figer » (Phase 2) devient « tests avant de committer » (Phase 3) — à cadrer au plan d'implémentation ; les critères d'acceptation des docs = la source des tests. **L'essai à blanc est un banc de PREUVE, pas un prototype qui devient le produit** — « pas de V2 » vaut pour le code.
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API-sur-convocation→local) — réduit, n'élimine pas. Quota x5 déjà fortement sollicité par l'usage pro → x20 = chemin attendu.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-13).
- **Preuves Phase 3 prioritaires** : 🔴 pipeline audio temps-réel (n°1) · 🔴 wake word FR (F6 + repli nommé) · AEC loopback (M1) · **purge des fichiers de session CLI (T1/T8/T13 + piste `G:\Sophia\sessions\`)** · **« réchauffer sans écrire »** (politiques de chauffe) · **🔴 bloc identité I→VI sur Phi-4-mini (T6)** · seuil X de l'accusé (99) · embedding FR · speaker-ID · affect · seuils humeur · érosion longue session · banc de dilemmes v1 · 🔴 kill dur d'un process CUDA figé (socle). **Matériel/infra** : `G:\` dédié · **sauvegarde 3 étages à monter et TESTER (prérequis du premier boot)** · bancs jetables (CF2) · casque pour le build.
- **Audits (si exercés)** : solo D'ABORD puis croisé 2 agents sur demande — précédents : conv 8 = 21 · 9 = 31 · 10 = 38 · 11 = 8+10 · 12 = 3+10 · **13 = 15+6 (transversal + doc 99), zéro faux positif (8 croisés consécutifs)**.
- **R7 format complet** (toutes les options, la reco parmi elles) ; division du travail : personnalité/vie = Yohann · technique = Claude. **R8 : clos avant le suivant.** Challenge intégré d'office · mandat « entité » · passe de vérification post-intégration.
- **« Pas de V2 »** · `--bare` jamais (A1) · repo public (gitleaks `pre-commit` + garde contenu **active** — à chaque commit : aucun `portrait*`/`temoignage*`/`docs/prive/`, aucun contenu personnel dans les fichiers trackés · secrets `.env` · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**).
- **Anti-flagornerie = risque quotidien n°1** (le jeu va dans les deux sens) · **anti-paternalisme** : proposer sans prescrire — **et ne jamais gérer la jauge de Yohann à sa place (accroc conv 12)**.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v13 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 13 (2026-07-06) — **PHASE 2 CLOSE : audit transversal du corpus (AT1–AT10 + croisé CF1–CF3/CT1–CT2 — 15 constats, zéro faux positif) PUIS doc `99-orchestration.md` gravé** (table globale des états · aiguilleur d'A2 réalisé · accusé filet-temporel + garde d'honnêteté · prompt identité→mémoire→cadre · grille 20 entrées + « passe sur l'API » · UI vues dérivées · spec gabarit fork) ; audits du `99` : solo S1-99/S2-99 + croisé OF1-OF2/OT1-OT2, tous intégrés ; **disposition 12 « La discrétion »** ; **2 prérequis du premier boot gravés** (sauvegarde 3 étages testée + bancs jetables/base fraîche) ; 3 commits poussés (`cebe2a1`/`6d0b425`/`60669d1`). Prochain : conv 14 = **OUVRIR LA PHASE 3** (plan d'implémentation → essai à blanc pipeline audio temps-réel).*
