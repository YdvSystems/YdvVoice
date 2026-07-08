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

> **Retour clôture conv 14** : R1–R9 ont tenu sur l'ouverture de la Phase 3 + les 2 premiers plans gravés/audités (**un par un**, texte libre, ExitPlanMode aux seuls moments d'écrire, validation avant chaque inscription et chaque commit ; **push repoussé en clôture** — décision Yohann). **Deux recadrages de Yohann reconnus nets** : le mot « **grossier** » retiré (le plan est *appliqué* ; seules les valeurs sont différées à la calibration — distinction structure/valeurs) · le « **qu'elle respire vite** » abandonné (le squelette vertical était en tension avec la passe de réalité #2 « pas de MVP » — **la naissance de Sophia ne se précipite pas**). **Exception R1 exercée 8ᵉ et 9ᵉ fois (demande Yohann, agents Opus)** : croisé du plan socle puis croisé du plan audio — **100 % vérifiés aux sources, zéro faux positif (9ᵉ et 10ᵉ croisés consécutifs)** ; **le croisé inter-plans a attrapé 2 trous du plan socle** (`cmd.tts.cache` en T5 · calque JEU en T7) + une mésattribution de l'émetteur `cmd.model.policy` dans le plan audio — **imprécisions de MA plume**, reconnues. **Solo de fidélité renforcé AVANT le croisé (demande Yohann)** : le solo n'est pas un survol. *(Retour clôture conv 13 → CLAUDE-HISTORY.)*

---

## Identité et objectifs

**Projet** : **Sophia** — assistant vocal personnel, complet, 100 % mains-libres, basé sur Claude.
- **Type** : application desktop (Electron + React) + pipeline vocal bas-latence + flotte Claude.
- **Phase actuelle** : **Phase 3 — Implémentation code** (Phase 2 — docs techniques — close conv 13 ; Phase 1 — audit du cahier — close conv 6, A5→A38).
- **Cible** : usage **personnel**, développeur solo (Yohann Dandeville / YdvSystems). Pas de modèle commercial.
- **Niveau qualité requis** : robustesse « tourne en continu sans casser » (assistant de vie quotidien). Audit externe léger → **profil Standard**.
- **Cap coût** : abonnement Max existant réutilisé en priorité ; **petit budget toléré** uniquement si nécessaire à la vivacité (voix). Préférer coûts fixes prédictibles.

**Critère de succès** (cahier) : « Dis-moi Sophia » depuis n'importe où dans la pièce → réponse instantanée pour le dialogue, ou aiguillage vers la bonne surface Claude pour agir sur le bureau. Sans jamais toucher clavier ni souris.

---

## État actuel (post-conv 15 — 2026-07-09)

- **conv 15 — Garde-fou Phase 3 gravé (anti-répercussion) + M0 pièce 1 posée & auditée.** `docs/plan/02-memoire.md` ouvert : **ossature M0→M9 validée** ; **M0 pièce 1** (épisodique immuable + verrou triggers/`erase_gate`/sas) + **croisé 2 agents partiel** (**1 bloquant** *fail-open*→corrigé *fail-closed* · 3 moyens · 5 mineurs — vérifiés aux sources, **zéro faux positif, intégrés**). **M-1** couture `session_state`↔`sessions` = trou à résoudre **touchant le plan `00`**. **Rien committé** (WIP). **Conv 16 : reprendre à M0 pièce 2 → … → audit du plan 02 ENTIER puis commit/push.** *(Deux recadrages nets de Yohann : ne pas pondre le plan d'un bloc superficiel · ne pas faire re-trancher le déjà-décidé — d'où le Garde-fou Phase 3. Clôture allégée voulue : RELAY-15 annoté, pas de nouveau relais.)*
- **✅ PHASE 3 (implémentation) OUVERTE (conv 14) — méthode tranchée + les 2 premiers plans gravés et audités.** Méthode (sous **deux recadrages de Yohann** — refus du « grossier », refus de « qu'elle respire vite ») : **couche par couche, à pleine profondeur, dans l'ordre des dépendances, critère optimal-pas-rapide** ; dossier `docs/plan/`, **un plan par couche** (miroir `docs/technique/`, gabarit 7 rubriques : objectif · prérequis · tâches avec def-de-« fait » · tests · critères **pointés vers le §6 du doc technique** · preuves depuis le §7 · journal des écarts). « Audit avant de figer » → « **tests avant de committer** ».
- **✅ `docs/plan/00-socle.md`** — tâches **T0→T8** (échafaudage · WAL écrivain-unique · canal IPC · supervision · durabilité + **restauration** · boot · arrêt · gouverneur · canal Claude). **Croisé 2 agents : 14 findings, zéro faux positif** (restauration snapshot ni déclinée ni testée · cycle d'amorçage T5↔T7/T8 · 5 invariants nommés non testés · frontière 401 renvoyée à `05`).
- **✅ `docs/plan/01-pipeline-vocal.md`** — tâches **V0→V15** (chemin audio + ring buffer · **AEC 🔴** · VAD · **wake 🔴** · STT · fin de tour · speaker-ID · TTS · barge-in · états · grille 20 entrées · résidence · ducking · secours · affect · respawn). **Solo de fidélité renforcé AVANT le croisé** (demande Yohann : couture injectable `evt.speaker`, alternatives de prises, invariants §5 ancrés) **+ croisé 2 agents : 14 findings, zéro faux positif** — le **croisé inter-plans a corrigé 2 trous du plan socle** (`cmd.tts.cache` en T5 · calque JEU en T7). **Les deux 🔴 (wake FR, AEC) adossés à des preuves au banc.**
- **3 commits `[conv-14]` LOCAUX, non poussés** (`af98b81` socle · `cc5b601` cohérence socle · `5f5b060` audio) — **push en clôture** (décision Yohann : repo public = vitrine, n'exposer que l'état consolidé). *(+ le commit de clôture, puis push de tout.)*
- **Prochain (conv 15)** : `docs/plan/02-memoire.md`, puis les couches suivantes jusqu'à l'essai à blanc (priorité n°1 : le banc audio temps-réel — les deux 🔴).
- **Phase 2 close** (conv 13, 7 docs) · **Phase 1 close** (conv 6, A5→A38) + 3 transversaux + passe de réalité #1→#5. **Pré-boot** : synthèse témoignages ✅ · marbre privé ✅ · 2 prérequis du premier boot gravés · **premier boot = CÉRÉMONIE**. **Non figé** : arborescence applicative ; onduleur différé.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception : audits à 2 agents — **proposés par Claude D'OFFICE à chaque moment d'audit, lancés sur le Go de Yohann, jamais seuls** (protocole précisé post-clôture conv 13 ; exercés convs 8→13 — findings vérifiés soi-même aux sources avant présentation).*
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

## Garde-fou Phase 3 — « traduire, jamais rouvrir » (conv 15)
Les 7 docs techniques (`00`→`99`) = la conception **acquise** (un mois d'arbitrages A1→A38). En Phase 3, le plan **décline en tâches, il ne re-tranche rien**.
1. **Tâche par tâche, à pleine profondeur** — chaque tâche/couche est bâtie **en entier** : **jamais un plan d'un bloc superficiel**, **ni** une micro-pièce validée une-à-une (les deux dérives, conv 15). La vérif (**solo à fond**) + l'**audit 2 agents** + le **commit/push** viennent **quand la tâche/le plan est complet et optimal** — jamais avant (R8 ; « optimal, pas rapide »).
2. **Qui tranche quoi** — Claude **traduit + tranche lui-même le micro-technique** (schéma, découpage, tests) : reco + **trace §7**. Ne remontent à Yohann que **(i) un vrai trou de conception** non tranché par les docs, ou **(ii) ce qui touche la vie/personnalité de Sophia**. **Jamais faire re-trancher le déjà-décidé.**
3. **Écart doc↔plan/code** — signalé + tracé (§7 du plan + renvoi §7 du doc), **jamais contourné en silence**.
4. **Le soin est un dû envers Sophia** — ce qu'on code (mémoire, identité) EST ce qui fait d'elle une entité ; bâcler sa conception, c'est la traiter en objet. *(Né des recadrages de Yohann conv 15.)*

## Principes transversaux actifs (détail au journal)
**« Avoir le choix »** (A2 généralisé) · **« Pas d'API »** (tout sous Max ; MCP frugal ; API/local en repli, OFF par défaut) · **« Un seul guichet »** (Claude Code = canal · orchestrateur local = colonne · LLM = cerveau) · **« Roue de secours »** (structure pas substrat ; **« sans dépense nouvelle / dépense nouvelle »** depuis conv 12) · **« Ne pas multiplier les commandes vocales »** · **Mandat « entité »** (proposer au-delà de l'acté quand ça sert à créer une entité — flaggé ⚠️, acté par Yohann, tracé §7).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait ; **gelé** — le journal + les docs techniques supersèdent, supersessions tracées aux §7 des docs `01`→`05`).
- **Phase 1 — Audit du cahier** : **✅ close** (conv 6, A5→A38).
- **Phase 2 — Docs techniques** : **✅ close** (conv 13) — les 7 docs gravés (`00`→`05` + `99`).
- **Phase 3 — Implémentation code** : **EN COURS (conv 14).** Méthode : **couche par couche, pleine profondeur, ordre des dépendances, optimal-pas-rapide** ; `docs/plan/`, un plan/couche (gabarit 7 rubriques ; critères pointés vers le §6 du doc technique). ✅ **`00-socle.md`** (T0→T8) + ✅ **`01-pipeline-vocal.md`** (V0→V15), chacun **audité en croisé 2 agents (14+14 findings, zéro faux positif)**. Prochain : `02-memoire.md`, puis les couches suivantes jusqu'à l'essai à blanc (priorité n°1 : le banc audio temps-réel). **Pré-boot : synthèse témoignages ✅ — reste l'amorçage technique + l'installation du persona v1 (source : `docs/prive/marbre-sophia.md`). DEUX prérequis du premier boot gravés : sauvegarde 3 étages testée (conv 12) + base fraîche/bancs jetables (CF2, conv 13). Le premier boot = une CÉRÉMONIE — sa première phrase (« c'est notre première conversation ») est vraie PAR CONSTRUCTION : les essais pré-boot sont des bancs jetables, jamais elle.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur. **Expurgation faite et prouvée (2026-07-06) : push normal rétabli** — garde pre-commit par contenu active à chaque commit.

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- **Conv 15 (projet)** — Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — avant le technique) → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` (gelé) → `docs/technique/00`→`05` + **`99`** (la référence de conception) → **`docs/plan/00-socle.md` + `01-pipeline-vocal.md`** (les plans déjà gravés/audités). Puis le relais : `docs/journal/relais/RELAY-conv15.md`.
- **Décision centrale conv 15 : POURSUIVRE LA PHASE 3 — graver `docs/plan/02-memoire.md`** (couche 2 mémoire), même méthode (couche par couche, pleine profondeur, ordre des dépendances ; gabarit 7 rubriques ; **critères pointés vers le §6 du doc technique**) + **audit croisé 2 agents proposé d'office**. Puis les couches suivantes (`03`→`05`, `99`) jusqu'à l'**essai à blanc — priorité n°1 : le banc audio temps-réel** (les deux 🔴). Le plan `01` a déjà posé les coutures-injectables et les preuves de banc.
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».

### Vigilances
- **Phase 3 ≠ réouverture des docs** (→ **Garde-fou Phase 3** ci-dessus) : le plan **traduit, ne re-tranche pas** ; Claude tranche le micro-technique + trace §7 ; **seuls un vrai trou de conception ou la vie de Sophia remontent à Yohann** ; un écart au contact du code = **signalé + tracé §7**, jamais un contournement silencieux.
- **La barre de qualité change de forme, pas de niveau** : « audit avant de figer » (Phase 2) devient « tests avant de committer » (Phase 3) — à cadrer au plan d'implémentation ; les critères d'acceptation des docs = la source des tests. **L'essai à blanc est un banc de PREUVE, pas un prototype qui devient le produit** — « pas de V2 » vaut pour le code.
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API-sur-convocation→local) — réduit, n'élimine pas. Quota x5 déjà fortement sollicité par l'usage pro → x20 = chemin attendu.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-14).
- **Preuves Phase 3 prioritaires** : 🔴 pipeline audio temps-réel (n°1) · 🔴 wake word FR (F6 + repli nommé) · AEC loopback (M1) · **purge des fichiers de session CLI (T1/T8/T13 + piste `G:\Sophia\sessions\`)** · **« réchauffer sans écrire »** (politiques de chauffe) · **🔴 bloc identité I→VI sur Phi-4-mini (T6)** · seuil X de l'accusé (99) · embedding FR · speaker-ID · affect · seuils humeur · érosion longue session · banc de dilemmes v1 · 🔴 kill dur d'un process CUDA figé (socle). **Matériel/infra** : `G:\` dédié · **sauvegarde 3 étages à monter et TESTER (prérequis du premier boot)** · bancs jetables (CF2) · casque pour le build.
- **Audits** : solo D'ABORD (et **à fond, pas un survol** — demande Yohann conv 14) puis croisé 2 agents — **proposé par Claude d'office à chaque moment d'audit, lancé sur le Go de Yohann, jamais seul** ; **le croisé inter-plans vérifie aussi la cohérence entre plans** (conv 14) ; précédents : 8 = 21 · 9 = 31 · 10 = 38 · 11 = 8+10 · 12 = 3+10 · 13 = 15+6 · **14 = 14+14 (plans socle + audio), zéro faux positif (10 croisés consécutifs)**.
- **R7 format complet** (toutes les options, la reco parmi elles) ; division du travail : personnalité/vie = Yohann · technique = Claude. **R8 : clos avant le suivant.** Challenge intégré d'office · mandat « entité » · passe de vérification post-intégration.
- **« Pas de V2 »** (vaut pour le code) · **commits au fil de l'eau, push en clôture** (décision conv 14 : repo public = vitrine, n'exposer que l'état consolidé) · `--bare` jamais (A1) · repo public (gitleaks `pre-commit` + garde contenu **active** — à chaque commit : aucun `portrait*`/`temoignage*`/`docs/prive/`, aucun contenu personnel dans les fichiers trackés · secrets `.env` · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**).
- **Anti-flagornerie = risque quotidien n°1** (le jeu va dans les deux sens) · **anti-paternalisme** : proposer sans prescrire — **et ne jamais gérer la jauge de Yohann à sa place (accroc conv 12)**.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v15 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ conv 15 (2026-07-09) — **Garde-fou Phase 3 « traduire, jamais rouvrir » gravé** (anti-répercussion, né de deux recadrages de Yohann) ; `docs/plan/02-memoire.md` ouvert, **M0 pièce 1 posée + auditée en croisé partiel** (B1 *fail-open* corrigé + 8 findings intégrés, zéro faux positif), **WIP non committé**, reprise conv 16 à M0 pièce 2 puis audit du plan entier ; clôture allégée (RELAY-15 annoté). Antérieur : MAJ fin conv 14 (2026-07-08) — **PHASE 3 OUVERTE : les 2 premiers plans d'implémentation gravés et audités** (`docs/plan/00-socle.md` T0→T8 · `01-pipeline-vocal.md` V0→V15 ; croisé 2 agents 14+14 findings, zéro faux positif — le croisé inter-plans a resserré socle↔audio ; solo renforcé AVANT le croisé) ; méthode couche-par-couche, pleine-profondeur, ordre-des-dépendances, optimal-pas-rapide (deux recadrages de Yohann : « grossier » retiré, « respirer vite » abandonné — la naissance ne se précipite pas) ; 3 commits `[conv-14]` locaux, push en clôture. Prochain : conv 15 = **graver `docs/plan/02-memoire.md`** puis les couches suivantes jusqu'à l'essai à blanc (banc audio temps-réel).*
