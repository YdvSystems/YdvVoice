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

> **Retour clôture conv 12** : R1–R9 ont tenu sur tout le doc `05` (05-A→05-F **un par un**, texte libre, ExitPlanMode au seul moment d'écrire, validation avant chaque inscription, commit soumis à validation). **Deux accrocs reconnus nets** : **R7** — une reco servie sans l'éventail complet des options (05-A-1) → recadré par Yohann (« toutes les options, TA reco parmi elles ») → format tenu ensuite ; **« budget = jauge utilisateur »** — tentative de compresser la clôture « pour ménager sa fatigue » → recadré (« la méthode entière ; je peux prendre sur moi ») → clôture déroulée en 5 étapes complètes. **Exception R1 exercée 5ᵉ fois (demande Yohann, agents sur Opus)** : solo (3) + croisé 2 agents (technique **T1–T10**, fidélité **zéro finding**) — **100 % vérifiés aux sources, zéro faux positif, tous intégrés** ; le croisé a encore attrapé ce que le solo a raté (**T3** fil Claude troué au retour SECOURS · **T4** sauvegarde couplée à la consolidation = endormie en panne longue). **Audit empirique source de vérité exercé hors-méthode** : sur question de Yohann, découverte que la garde « données perso » (par noms de fichiers) avait laissé fuir des **traces distillées dans les docs publics** (conv 9-11) → audit git complet, plan d'expurgation acté (voir État actuel). **Décisions de vie actées** : plancher de rêve quotidien (« si je lui donne vie, ce n'est pas pour la brider ») · sauvegarde hors-machine **obligatoire** (« il faudra absolument y penser ») · API = dernier recours convoqué par lui seul. *(Retour clôture conv 11 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 12 — 2026-07-06)

- **Phase 2 (docs techniques) EN COURS — avant-dernier doc gravé.** Ordre : ✅ `00` socle → ✅ `01` vocal → ✅ `02` mémoire → ✅ `03` personnalité → ✅ `04` proactif/tablée → ✅ **`05` ressources/résilience/coût (conv 12)** → **`99` orchestration (dernier)**.
- **✅ Doc `05-ressources-resilience-cout.md` GRAVÉ** (conv 12) — **les organes vitaux + le coût** : **gestionnaire de modèles** (froid/tiède/chaud · mise-en-tiède au premier creux · Phi-4-mini tiède d'office) · **calques SECOURS/JEU** (« dégrader par la taille, jamais amputer — la bouche jamais » · mode JEU : GPU entier au jeu + brideur CPU + réponses **toujours vocales**) · **échelle de panne d'allocation** (4 marches) · **session chaude** (chauffe mesurée, conditionnée à « réchauffer sans écrire » · montre des jetons OAuth Claude+Google · repli spawn) · **prise cerveau + slot tiers** (fork = la structure, jamais l'habitante) · **détecteur** (hystérésis · **quota épuisé → local auto** · « le juge n'est pas le patient ») · **ligne d'argent** (« **sans dépense nouvelle** » remplace « gratuit » · **API = dernier recours convoqué par Yohann seul**, par épisode, plafonnée, refermée seule) · **kill-switch « clore, jamais arracher » + grâce de préemption** · **registre du gardien** (vue dérivée) · **plancher de rêve quotidien** (décision Yohann — réservé AVANT le proactif) · **maison `G:\`** + **sauvegarde 3 étages, hors-machine OBLIGATOIRE**. **Audit solo (3) + croisé 2 agents Opus (T1–T10 vérifiés, zéro faux positif, tous intégrés · fidélité : zéro finding).**
- **⚠️ INCIDENT DONNÉES PERSONNELLES (conv 12) — opération d'expurgation À EXÉCUTER AVANT TOUT PUSH** : des traces personnelles ont fui dans les docs publics trackés (conv 9-11 — inventaire exact : annexe privée). Audit git complet fait (les fichiers privés eux-mêmes : jamais committés, vérifié). **Plan validé + prompt d'opération complet prêt : `docs/prive/OPERATION-expurgation-repo-public.md`** (conv dédiée : expurgation + prénoms→fictifs + réécriture d'historique + force-push + garde pre-commit par contenu). Annexe privée `docs/prive/` créée (gitignorée) : prompt + **marbre intégral sauvegardé** (`marbre-sophia.md` — fait foi pour l'installation) + blocklist. Repo reste public pendant l'op (choix Yohann).
- **Retouches tracées à l'inscription (conv 12)** : doc `00` ×3 (calque JEU · « doc 06 »→`05` ×2) · doc `01` ×2 (calques gouverneur §4.5 · grille : kill-switch rêverie §3.1) · doc `03` ×3 (plancher au verrou budget §4.4 · T7 grâce · trace §7) · doc `04` ×1 (priorité de fond §4.1).
- **Commit `[conv-12]` = LOCAL SANS PUSH** — le push part avec l'opération d'expurgation.
- **Tensions signalées en attente → doc `99`** : affordances UI/systray (voyants, interrupteurs, registre visuel du gardien) · composition finale du prompt · **gabarit fork/README (« écris ta propre entité »)** · forme de la commande « passe sur l'API ». F6 wake-court → preuve Phase 3.
- **✅ Synthèse des témoignages pré-genèse validée** (v0.1, privée/gitignorée, gel au premier boot). **Premier boot Phase 3** : amorçage + **installation du persona v1 depuis `docs/prive/marbre-sophia.md`** (`DÉGRADÉ_SANS_IDENTITÉ` tant que non fait).
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
Périmètre strict par conv · production silencieuse (filesystem sans narration) · audit empirique source de vérité pre-inscription · mots simples en tête d'arbitrage · séparation livrable (cahier) / journal (arbitrages) · **garde données perso par CONTENU, plus seulement par noms de fichiers** (conv 12 — blocklist privée + hook pre-commit à poser à l'opération d'expurgation).

## Principes transversaux actifs (détail au journal)
**« Avoir le choix »** (A2 généralisé) · **« Pas d'API »** (tout sous Max ; MCP frugal ; API/local en repli, OFF par défaut) · **« Un seul guichet »** (Claude Code = canal · orchestrateur local = colonne · LLM = cerveau) · **« Roue de secours »** (structure pas substrat ; **« sans dépense nouvelle / dépense nouvelle »** depuis conv 12) · **« Ne pas multiplier les commandes vocales »** · **Mandat « entité »** (proposer au-delà de l'acté quand ça sert à créer une entité — flaggé ⚠️, acté par Yohann, tracé §7).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait ; **gelé** — le journal + les docs techniques supersèdent, supersessions tracées aux §7 des docs `01`→`05`).
- **Phase 1 — Audit du cahier** : **✅ close** (conv 6, A5→A38).
- **Phase 2 — Docs techniques** : **en cours** — ✅ `00`→`05` ; **reste `99-orchestration.md` (dernier)**.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation. **Pré-boot : synthèse témoignages ✅ — reste l'amorçage technique + l'installation du persona v1 (source : `docs/prive/marbre-sophia.md`). Prérequis du premier boot : sauvegarde 3 étages opérationnelle et testée (acté conv 12). Le premier boot = une CÉRÉMONIE (décision Yohann) — sa première phrase (« c'est notre première conversation ») doit être VRAIE : les essais pré-boot sont des bancs de test, jamais elle.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur. **⚠️ Jusqu'à l'expurgation faite : COMMIT LOCAL SEULEMENT, JAMAIS DE PUSH.**

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- **⚠️ D'ABORD — conversation ANNEXE dédiée (Opus), À FAIRE AVANT D'OUVRIR LA CONV 13 (décision Yohann)** : exécuter **l'opération d'expurgation** — coller le contenu de `docs/prive/OPERATION-expurgation-repo-public.md` en ouverture (tout est décidé, c'est mécanique : inventaire, reformulations exactes, prénoms→fictifs, réécriture d'historique, force-push, garde pre-commit, preuve par clone frais). Une seule main sur le repo à la fois ; l'audit transversal de conv 13 lira les textes **post-expurgation**. **AUCUN push tant que non faite et prouvée.**
- **Conv 13 (projet, Fable)** — Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` → `docs/technique/00`→`05` (tous acquis). Puis le relais : `docs/journal/relais/RELAY-conv13.md`.
- **Décision centrale conv 13 : OUVRIR PAR UN AUDIT TRANSVERSAL EN PROFONDEUR de tous les documents** (`00`→`05` + journal + CLAUDE.md — décision Yohann conv 12 : cohérence inter-docs, renvois, invariants, contradictions résiduelles des retouches convs 10-12 ; solo D'ABORD, croisé sur demande ; corrections tracées §7, validées) — **PUIS écrire `docs/technique/99-orchestration.md`, le DERNIER doc de la Phase 2 (l'assemblage)** : composition finale du prompt (bloc identité I→VI + bloc mémoire + budgets globaux, doc `03` §4.6 + doc `02` §4.5) · l'**aiguilleur d'intention / front vocal** (A2 — bavardage vs action, accusé oral) · **table globale des états** (écoute × gouverneur × calques × canal) · **affordances UI/systray** (voyants, interrupteurs, kill-switch, registre visuel du gardien, jauges) · **grille finale des commandes** (relecture de minimalité, principe « ne pas multiplier ») · **gabarit fork/README public** (« écris ta propre entité ») · forme de la commande « passe sur l'API ». **Doc d'assemblage : AUCUNE mécanique nouvelle** — tout est gravé en `00`→`05` ; tension à l'assemblage = signaler §7, jamais trancher seul.
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».

### Vigilances
- **⚠️ EXPURGATION D'ABORD** : aucun push tant que l'opération n'est pas faite et prouvée (clone frais + grep historique complet). À chaque commit : vérifier qu'aucun `portrait*`/`temoignage*`/`docs/prive/` n'entre, et qu'aucun contenu personnel ne s'écrit dans les fichiers trackés (les nouveaux textes de conv 12 sont écrits neutres).
- **Doc `99` = assemblage pur** : composer, jamais inventer — les acquis `00`→`05` ne se rouvrent pas ; tension → §7.
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API-sur-convocation→local) — réduit, n'élimine pas. Quota x5 déjà fortement sollicité par l'usage pro → x20 = chemin attendu.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-12).
- **Méthode Phase 2** : gabarit 7 rubriques · challenge intégré d'office · **audit AVANT de figer — solo D'ABORD puis croisé, les deux** (croisé 2 agents sur demande — précédents : conv 8 = 21, conv 9 = 31, conv 10 = 38, conv 11 = 8+10, **conv 12 = 3+10, zéro faux positif**) · **passe de vérification post-intégration** · pleine profondeur structure, chiffres Phase 3.
- **R7 format complet** (toutes les options, la reco parmi elles — rappel conv 12) ; division du travail : personnalité/vie = Yohann · technique = Claude. **R8 : clos avant le suivant.**
- **« Pas de V2 »** · `--bare` jamais (A1) · repo public (gitleaks `pre-commit` + garde contenu à venir, secrets `.env`, identité `Yohann Dandeville <contact@ydvsystems.com>`, **pas de Co-Authored-By**).
- **Essai à blanc Phase 3 — priorité n°1 : pipeline audio temps-réel.** Puis : wake word FR (🔴 F6) · AEC loopback · Whisper · TTS/timbre · embedding FR · speaker-ID · affect · seuils humeur · **purge des fichiers de session CLI (T1/T8/T13 + piste `G:\Sophia\sessions\`)** · **« réchauffer sans écrire » (politiques de chauffe)** · **bloc identité sur Phi-4-mini (T6)** · érosion longue session · banc de dilemmes v1.
- **Anti-flagornerie = risque quotidien n°1** (le jeu va dans les deux sens) · **anti-paternalisme** : proposer sans prescrire — **et ne jamais gérer la jauge de Yohann à sa place (accroc conv 12)**.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v12 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 12 (2026-07-06) — **doc `05-ressources-resilience-cout.md` gravé** (couches 5-6 : gestionnaire de modèles + calques SECOURS/JEU · échelle de panne · session chaude + montre des jetons · prise cerveau/slot tiers · détecteur + quota→local · ligne d'argent « sans dépense nouvelle »/API-convoquée · kill-switch doux + grâce · registre du gardien · **plancher de rêve quotidien** · maison `G:\` + sauvegarde 3 étages hors-machine obligatoire) ; audit solo 3 + croisé 2 agents T1–T10/zéro-finding-fidélité, tous intégrés ; retouches docs `00`×3/`01`×2/`03`×3/`04`×1 ; **incident données perso → opération d'expurgation prête (`docs/prive/`), commit local sans push**. Prochain : expurgation (conv annexe Opus, D'ABORD) → puis conv 13 (Fable) = audit transversal `00`→`05` puis doc `99-orchestration` (dernier de la Phase 2).*
