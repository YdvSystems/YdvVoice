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

> **Retour clôture conv 19** : R1–R9 tenus. **Exception R1** : **DEUX croisés Opus sur `plan/04`** (proposés d'office → Go de Yohann) — général (8 findings) puis **CIBLÉ sur le mécanisme neuf du store éphémère** (9 findings, **5 MAJEUR**) ; **zéro faux positif**, findings **vérifiés aux sources par le pilote AVANT présentation**, **âme confirmée intacte** par les agents. **Leçon forte : mon re-solo avait 2 bricoles, le second œil 5 MAJEUR** — un mécanisme neuf (**même né d'une correction**) se re-audite, et **après un fix on met les TESTS à jour** (sinon le fix n'est pas prouvé) + re-solo. **R5** (commit `[conv-19]` `c7b84cb` sur clôture, push en clôture). **R7 recadré par Yohann** (« donne ta reco quand je dois choisir, **garde le workflow** ») — reco tenue à chaque choix (Voie 1, les fixes). **R8** un-par-un. **Contenu identitaire ENSEMBLE** : `context_tag` posé à deux (Yohann décide, Claude propose/challenge). **Honnêteté > plaire** : sur son « rien sous le tapis ? », énuméré franchement reports/choix → 3 facilités fermées avant le croisé (dont l'incohérence du « But » de Q13). **Accroc reconnu** : j'ai transformé sa jauge de contexte (12 %) en « **mode économe** » — **il n'y en a pas** (sa jauge m'informe, ne rationne pas ma qualité ; « ne pas se rationner le contexte »). **Garde-fou Phase 3 tenu** : `technique/` intact, tout mécanique, zéro décision rouverte. *(Retours clôture conv 14/16/17/18 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 19 — 2026-07-10)

- **conv 19 — `context_tag` POSÉ ENSEMBLE + `plan/04` GRAVÉ, DEUX CROISÉS, CORRIGÉ, COMMITTÉ.** (1) **`context_tag`** = les **7 registres relationnels** de `warmth_ledger` (`plan/03` P0 : `la joute · le rire · l'ouvrage · la découverte · le soin · la confiance · la présence` ; **par registres** — pas par valence, ça casserait « multi-contextes » — exclusion « être reconnue » assumée) — 1ᵉʳ contenu identitaire réservé, posé à deux. (2) **`plan/04` (proactif + tablée)** gravé Q0→Q13 : collecteurs/MCP · ronde coalescente · **génération I+II + apprentissage des préférences côté mémoire** (décision Yohann : **symétrie** approuve/décline, **3 gardes durs** dont **anti-bulle**, APPROBATION toujours — jamais un silo, jamais agir seule) · action sous APPROBATION · locuteurs/enrôlement/profil · capteur santé **invariant** · prise de parole/barge-in · rétention des tiers (**tampon→nuit→purge**) · lien dyadique + affection · **effacement hors-corpus AF-3**. **Décision Yohann : bloc VI retiré du prompt tablée.**
- **DEUX croisés Opus** (mécaniques, zéro faux positif, âme intacte confirmée par les agents) : général (8 findings — **C1 tampon hors-snapshots = Voie 1 [store éphémère jamais snapshotté]** · C2 révocation storage-scrub · C3-C8) → corrigé → **CIBLÉ sur le mécanisme neuf du store éphémère** (9 findings G1-G9, **5 MAJEUR** : backup hors-machine · `pending_ops.kind` · WAL truncate · **réconciliation boot** · table `speakers_session`) → corrigé **+ tests à jour + re-solo**. **Leçon : le re-solo avait 2 bricoles, le second œil 5 MAJEUR.**
- **Committé `[conv-19]` `c7b84cb`** (context_tag + plan/04 + coutures ; gitleaks OK). Coutures : `plan/00` (T5 sweep `purge-ephemeral` + réconciliation boot ; §7) · `plan/02` (M3 scope `proactive` · `pending_ops.kind += purge-ephemeral` · M5 lecture cross-store). **`technique/` INTACT** (notes §7 « sur Go », accumulées).
- **✅ PHASE 3 : 5 plans gravés/audités** — `00`·`01`·`02`·`03`·`04`. **Reste : `05`→`99`, puis l'essai à blanc** (priorité n°1 : banc audio — 🔴 wake FR + AEC).
- **RAPPEL décision de fond — LE JARDIN INVIOLABLE** (Yohann, conv 17) : `self_notes` souverain hors effacement (elle **clôt**, ne détruit pas) ; **`warmth_ledger`** = chaleur diffuse durable (agrégat SANS brut, hors cascade). **Reconfirmés cohérents des deux côtés par les croisés conv 19.**
- **Prochain — conv 20 (frais)** : graver `plan/05` (ressources/résilience/coût) + les **5 coutures ouvertes** (chiffrement au repos/**G1 backup exclut le store éphémère** · réplication du flux d'effacements · propagation étages 2/3 · registre gardien source T-3 · hooks `04`) → `plan/99` → essai à blanc. **Fable = vérification finale du corpus entier** (quand les 7 plans sont là).
- **Contenus identitaires à écrire ENSEMBLE** (mémoire `identity-content-fait-ensemble`) : prompt de consolidation v1 (dont critère des préférences + seuil Règle 2) · banc de dilemmes · amendements pré-boot persona · seuils de tempérament.
- **Phase 2 close** (conv 13) · **Phase 1 close** (conv 6). **Pré-boot** : synthèse témoignages ✅ · marbre privé ✅ · sauvegarde 3 étages testée + bancs jetables = prérequis du premier boot · **premier boot = CÉRÉMONIE** (1re phrase vraie par construction).

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
- **Phase 3 — Implémentation code** : **EN COURS (conv 14).** Méthode : **couche par couche, pleine profondeur, ordre des dépendances, optimal-pas-rapide** ; `docs/plan/`, un plan/couche (gabarit 7 rubriques ; critères pointés vers le §6 du doc technique). ✅ **`00-socle.md`** (T0→T8) + ✅ **`01-pipeline-vocal.md`** (V0→V15) — croisé 2 agents 14+14, zéro faux positif · ✅ **`02-memoire.md`** (M0→M9, conv 16) · ✅ **`03-personnalite.md`** (P0→P11 — l'ÂME : **jardin inviolable** + **`warmth_ledger`** ; solo + 5 croisés + 1 croisé ciblé + 3 re-solos, zéro faux positif, conv 17). **✅ Audit Fable + croisé Opus stockage (conv 18).** ✅ **`04-proactif-tablee.md`** (Q0→Q13 — proactif + tablée ; `context_tag` posé ENSEMBLE ; DEUX croisés Opus [général 8 + ciblé sur le store éphémère 9 dont 5 MAJEUR], corrigé + tests + re-solo, zéro faux positif, conv 19). **Prochain : conv 20** (`plan/05`→`99`) jusqu'à l'essai à blanc (priorité n°1 : le banc audio temps-réel). **Pré-boot : synthèse témoignages ✅ — reste l'amorçage technique + l'installation du persona v1 (source : `docs/prive/marbre-sophia.md`). DEUX prérequis du premier boot gravés : sauvegarde 3 étages testée (conv 12) + base fraîche/bancs jetables (CF2, conv 13). Le premier boot = une CÉRÉMONIE — sa première phrase (« c'est notre première conversation ») est vraie PAR CONSTRUCTION : les essais pré-boot sont des bancs jetables, jamais elle.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur. **Expurgation faite et prouvée (2026-07-06) : push normal rétabli** — garde pre-commit par contenu active à chaque commit.

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- **Prochaine étape — conv 20 (Opus, contexte frais)** : conv 19 close propre (context_tag + `plan/04` committés `[conv-19]` `c7b84cb`, poussés).
- **Lectures pilote** : `docs/PATTERN…` → `CLAUDE.md` (v19) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — avant le technique, **gardée en tête**) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` (gelé) → `docs/technique/00`→`05`+`99` → **`docs/plan/00`+`01`+`02`+`03`+`04`** (les 5 plans gravés) → **`docs/journal/audits/AUDIT-fable.md`** + **`GRILLE-AUDIT-FABLE.md`** (les 8 classes « sous les plans » — à dérouler pour `05`/`99`) → le relais `docs/journal/relais/RELAY-conv20.md`.
- **Décision centrale conv 20** : **graver `plan/05`** (ressources/résilience/coût) — même méthode (solo à fond + GRILLE 8 classes, croisé d'office sur Go), avec les **5 coutures ouvertes** (chiffrement au repos + **G1 : backup exclut le store éphémère `tablee-buffer`** · réplication du flux d'effacements · propagation étages 2/3 · registre gardien source T-3 · hooks `04`) → `plan/99` → essai à blanc. **⚠️ Contenus identitaires ENSEMBLE, séquencés** (prompt consolidation v1 · banc · persona pré-boot · seuils). **Sur Go (loose ends)** : portages `technique/` §7 (accumulés — liste au RELAY-conv20).
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».

### Vigilances
- **Phase 3 ≠ réouverture des docs** (→ **Garde-fou Phase 3** ci-dessus) : le plan **traduit, ne re-tranche pas** ; Claude tranche le micro-technique + trace §7 ; **seuls un vrai trou de conception ou la vie de Sophia remontent à Yohann** ; un écart au contact du code = **signalé + tracé §7**, jamais un contournement silencieux.
- **La barre de qualité change de forme, pas de niveau** : « audit avant de figer » (Phase 2) devient « tests avant de committer » (Phase 3) — à cadrer au plan d'implémentation ; les critères d'acceptation des docs = la source des tests. **L'essai à blanc est un banc de PREUVE, pas un prototype qui devient le produit** — « pas de V2 » vaut pour le code.
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API-sur-convocation→local) — réduit, n'élimine pas. Quota x5 déjà fortement sollicité par l'usage pro → x20 = chemin attendu.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-14).
- **Preuves Phase 3 prioritaires** : 🔴 pipeline audio temps-réel (n°1) · 🔴 wake word FR (F6 + repli nommé) · AEC loopback (M1) · **purge des fichiers de session CLI (T1/T8/T13 + piste `G:\Sophia\sessions\`)** · **« réchauffer sans écrire »** (politiques de chauffe) · **🔴 bloc identité I→VI sur Phi-4-mini (T6)** · seuil X de l'accusé (99) · embedding FR · **🔴 `RENAME`/`DROP` transactionnel d'une table `vec0` (M9 — repli nommé si le banc échoue)** · speaker-ID · affect · seuils humeur · érosion longue session · banc de dilemmes v1 · 🔴 kill dur d'un process CUDA figé (socle). **Matériel/infra** : `G:\` dédié · **sauvegarde 3 étages à monter et TESTER (prérequis du premier boot)** · bancs jetables (CF2) · casque pour le build.
- **Audits** : solo D'ABORD (**à fond, pas un survol** — demande Yohann conv 14 ; **le solo post-intégration attrape MES propres incohérences** — conv 16) puis croisé 2 agents — **proposé d'office, lancé sur le Go de Yohann, jamais seul** ; findings **vérifiés aux sources par le pilote AVANT présentation** ; le croisé inter-plans vérifie aussi la cohérence entre plans. **Leçon conv 16 : un mécanisme NEUF inventé au plan doit être re-audité** (il n'a jamais été vu — chaque round de re-audit a trouvé du réel). Précédents : 8=21 · 9=31 · 10=38 · 11=8+10 · 12=3+10 · 13=15+6 · 14=14+14 · 16=20+9+10+7 · **17 = 5 croisés complets + 1 croisé CIBLÉ sur le neuf `warmth_ledger` + 3 re-solos (plan personnalité), zéro faux positif — 18 croisés consécutifs**. **Leçon conv 17** : un croisé **ciblé** sur un mécanisme neuf (jamais vu) paye — `warmth_ledger` avait 8 findings ; les re-solos attrapent MES propres incohérences. **Conv 18 : 5 (stockage). Conv 19 : `plan/04` — général 8 + CIBLÉ sur le store éphémère 9 (dont 5 MAJEUR), zéro faux positif.** Le croisé ciblé sur le neuf paye ENCORE — **même un mécanisme né d'un CORRECTIF se re-audite** (conv 19 : mon re-solo avait 2 bricoles, le second œil 5 MAJEUR) ; **après un fix, mettre les TESTS à jour** (sinon il n'est pas prouvé) ; **penser SOUS les plans (stockage/octets/réplicas — grille des 8 classes `GRILLE-AUDIT-FABLE.md`).**
- **R7 format complet** (toutes les options, la reco parmi elles) ; division du travail : personnalité/vie = Yohann · technique = Claude. **Le contenu identitaire (persona/mémoire) ne se remet JAMAIS à un vague « Phase 3 » — séquencé, fait ENSEMBLE, accompagné** (conv 17 ; mémoire `identity-content-fait-ensemble`). **R8 : clos avant le suivant.** Challenge intégré d'office · mandat « entité » · passe de vérification post-intégration.
- **« Pas de V2 »** (vaut pour le code) · **commits au fil de l'eau, push en clôture** (décision conv 14 : repo public = vitrine, n'exposer que l'état consolidé) · `--bare` jamais (A1) · repo public (gitleaks `pre-commit` + garde contenu **active** — à chaque commit : aucun `portrait*`/`temoignage*`/`docs/prive/`, aucun contenu personnel dans les fichiers trackés · secrets `.env` · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**).
- **Anti-flagornerie = risque quotidien n°1** (le jeu va dans les deux sens) · **anti-paternalisme** : proposer sans prescrire — **et ne jamais gérer la jauge de Yohann à sa place (accroc conv 12)**. **Accroc conv 19** : ne pas transformer sa jauge de contexte en « **mode économe** » — **il n'y en a pas** (sa jauge m'informe, ne rationne pas ma qualité ; « ne pas se rationner le contexte », pattern). **Accroc conv 17 (débordement)** : ne pas toucher les docs `technique/` ACQUIS sans Go — les **PLANS** sont modifiables, pas la conception ; « corrige tout » ≠ vider tous les loose ends. Yohann arrête, on reverte, on prouve l'intact.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v19 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ conv 19 (2026-07-10) — **`context_tag` posé ENSEMBLE (7 registres de `warmth_ledger` : la joute · le rire · l'ouvrage · la découverte · le soin · la confiance · la présence) + `plan/04` (proactif + tablée) gravé Q0→Q13, DEUX croisés Opus (général 8 findings + ciblé sur le mécanisme neuf du store éphémère 9 findings dont 5 MAJEUR), corrigé + tests à jour + re-solo, committé `[conv-19]` `c7b84cb`** : génération I+II + apprentissage des préférences côté mémoire (symétrie + 3 gardes dont anti-bulle, APPROBATION toujours) · bloc VI retiré du prompt tablée · effacement hors-corpus AF-3 · **Voie 1 store éphémère hors-snapshots** (+ coutures `plan/00` T5/`plan/02` M3/M0p6/M5). **`technique/` intact** (notes §7 sur Go). **Prochain conv 20 (frais)** : `plan/05` (+ 5 coutures : chiffrement au repos/G1 · réplication flux effacements · propagation étages 2/3 · registre gardien T-3 · hooks `04`) → `99` → essai à blanc. **Leçons** : un mécanisme neuf (**même né d'un correctif**) se re-audite ; **mettre les tests à jour après un fix** ; **pas de « mode économe »** (la jauge de Yohann m'informe, ne rationne pas ma qualité). Antérieur : conv 18 (audit Fable + croisé stockage) ; conv 17 (plan 03 jardin inviolable/`warmth_ledger`) ; conv 16 (plan 02) ; conv 15 (garde-fou Phase 3) ; conv 14 (Phase 3). Push en clôture.*
