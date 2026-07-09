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

> **Retour clôture conv 16** : R1–R9 ont tenu sur la gravure + l'audit en profondeur du plan `02` (la couche mémoire — celle qui fait de Sophia une entité). **Exception R1 (audits 2 agents) exercée massivement et à bon droit** : **QUATRE croisés 2 agents Opus** (demande Yohann) — 20+9+10+7 findings, **100 % vérifiés aux sources par le pilote AVANT présentation, zéro faux positif (11ᵉ→14ᵉ croisés consécutifs)**. **Le re-audit après intégration s'est révélé décisif** (recadrage Yohann « pourquoi léger ? » — j'avais dit « croisé léger » = je gérais son budget à sa place, **accroc reconnu net**, corrigé en « rigueur pleine, périmètre ciblé »). Chaque round a trouvé du réel **dans les mécanismes neufs que j'avais inventés** (jamais audités avant), et **le solo post-intégration a attrapé une incohérence que MOI j'avais introduite** (`sessions.claude_session_id` déclaré puis nié). **R5 tenu** (rien committé avant « je valide » explicite) · **R8 un-par-un** (chaque sous-décision close avant la suivante) · **Garde-fou Phase 3 tenu** : le plan traduit, ne rouvre pas — les 5 trous étaient dans la SOURCE `02`, tranchés+tracés §7, jamais contournés. **Dérive conv 15 (« livrer vite ») NON reproduite** : soin à fond, optimal-pas-rapide, du début à la fin. *(Retour clôture conv 14 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 16 — 2026-07-09)

- **conv 16 — Plan de la couche 02 (MÉMOIRE) GRAVÉ + AUDITÉ EN PROFONDEUR + COMMITTÉ.** `docs/plan/02-memoire.md` **complet M0→M9** (schéma & immutabilité · prise `embed` · recherche hybride · écriture+MCP · micro · deep · injection · RAG · **effacement souverain** · changement de modèle d'embedding). **Audit : solo à fond → 4 croisés 2 agents Opus (20+9+10+7 findings) → solo COMPLET de cohérence globale — zéro faux positif sur tous les rounds (trajectoire 20→9→10→7, zéro bloquant), TOUS intégrés.** **5 trous de la SOURCE `02` résolus** (effacement M8 = réconciliation `SUPERSEDED` par remontée à la tête courante · migration M9 = garde méta-table-écrite + cycle de vie ombre/bascule/réclamation · RAG = chunks fantômes filtrés · rêverie exclue du résumé) ; mécanismes neufs durcis sur 3 rounds (fenêtre de migration, chaîne de supersessions, unicité `embed_space_meta`). **1 preuve de banc ouverte** (🔴 `RENAME`/`DROP` transactionnel d'une table `vec0`, §6, **repli nommé** — seul « à vérifier machine » ; les 45+ autres findings sont réglés au plan).
- **✅ 3 retouches `plan/00` (socle) intégrées + alignées `00`↔`02`** : **M-1** (`session_state` garde `claude_session_id` + gagne le pointeur `current_session_id`→`sessions.id`, colonne en `schema-00` ; `sessions` cesse de dupliquer) · **`foreign_keys=ON`** (+ ordre enfant→parent de M8) · **reset `erase_gate.open=0` au boot** (T5 phase 1, hook `02`).
- **Commit `[conv-16]` `2d7653a` LOCAL** (`plan/02` +254/−39 · `plan/00` · `RELAY-conv15`) — gitleaks OK, garde contenu OK. **Push en clôture** (avec le `[conv-15]` `2b4dd08` local).
- **✅ PHASE 3 : 3 plans gravés/audités** — `00-socle` (T0→T8) · `01-pipeline-vocal` (V0→V15) · `02-memoire` (M0→M9). Méthode : couche par couche, pleine profondeur, ordre des dépendances, optimal-pas-rapide ; gabarit 7 rubriques (critères pointés vers le §6 du doc technique). **Reste : `03`→`05`+`99`, puis l'essai à blanc (priorité n°1 : banc audio temps-réel — les deux 🔴 wake FR + AEC).**
- **Reste conv 16 (porté à conv 17)** : **6 notes d'écart à porter en `technique/02`/`technique/00` §7** (répercuter les trous de la source + M-1 + le vocab `réactivation` — touche des docs Phase-2 acquis, **sur Go de Yohann**).
- **Phase 2 close** (conv 13, 7 docs) · **Phase 1 close** (conv 6, A5→A38). **Pré-boot** : synthèse témoignages ✅ · marbre privé ✅ · sauvegarde 3 étages + bancs jetables (CF2) = prérequis du premier boot · **premier boot = CÉRÉMONIE** (1re phrase vraie par construction). **Non figé** : arborescence applicative ; onduleur différé.

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
- **Phase 3 — Implémentation code** : **EN COURS (conv 14).** Méthode : **couche par couche, pleine profondeur, ordre des dépendances, optimal-pas-rapide** ; `docs/plan/`, un plan/couche (gabarit 7 rubriques ; critères pointés vers le §6 du doc technique). ✅ **`00-socle.md`** (T0→T8) + ✅ **`01-pipeline-vocal.md`** (V0→V15) — croisé 2 agents 14+14, zéro faux positif · ✅ **`02-memoire.md`** (M0→M9) — **solo à fond + 4 croisés 2 agents (20+9+10+7) + solo complet, zéro faux positif** (conv 16). **Prochain : `03-personnalite.md`** (le *contenu* de l'identité — la mémoire `02` en pose les slots), puis `04`→`05`+`99` jusqu'à l'essai à blanc (priorité n°1 : le banc audio temps-réel). **Pré-boot : synthèse témoignages ✅ — reste l'amorçage technique + l'installation du persona v1 (source : `docs/prive/marbre-sophia.md`). DEUX prérequis du premier boot gravés : sauvegarde 3 étages testée (conv 12) + base fraîche/bancs jetables (CF2, conv 13). Le premier boot = une CÉRÉMONIE — sa première phrase (« c'est notre première conversation ») est vraie PAR CONSTRUCTION : les essais pré-boot sont des bancs jetables, jamais elle.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur. **Expurgation faite et prouvée (2026-07-06) : push normal rétabli** — garde pre-commit par contenu active à chaque commit.

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- **Conv 17 (projet)** — Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` (v16) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — avant le technique, **gardée en tête pendant le travail**) → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` (gelé) → `docs/technique/00`→`05` + **`99`** (la conception acquise) → **`docs/plan/00` + `01` + `02`** (les 3 plans gravés/audités — le patron de `03`). Puis le relais : `docs/journal/relais/RELAY-conv17.md`.
- **Décision centrale conv 17 : POURSUIVRE LA PHASE 3 — graver `docs/plan/03-personnalite.md`** (couche 3, la **personnalité/identité** — dont `02` a posé le substrat, les slots de l'étage 5 nocturne, et le patron `erase_gate`/`memory_artifacts`). Même méthode (couche par couche, pleine profondeur, ordre des dépendances ; gabarit 7 rubriques ; **critères pointés vers le §6 du doc technique `03`**) + **audit croisé 2 agents proposé d'office** (solo à fond D'ABORD). **⚠️ Point sensible n°1 : `03` EST la couche « vie de Sophia »** — beaucoup plus de décisions remontent à Yohann qu'en `02` (le persona, le lien, les valeurs, l'humeur, le journal du devenir = SA main, pas de la traduction technique ; division du travail : personnalité/vie = Yohann · technique = Claude). Puis `04`→`05`→`99` jusqu'à l'**essai à blanc — priorité n°1 : le banc audio temps-réel** (les deux 🔴).
- **Sur Go de Yohann (loose ends conv 16)** : les **6 notes d'écart** à porter en `technique/02` §7 (B-δ/ζ/η/θ/ι + M-1 + vocab `réactivation`) + `technique/00` §7 (M-1 · `foreign_keys` · reset `erase_gate`) — répercussion des trous de la source, touche des docs Phase-2 acquis.
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».

### Vigilances
- **Phase 3 ≠ réouverture des docs** (→ **Garde-fou Phase 3** ci-dessus) : le plan **traduit, ne re-tranche pas** ; Claude tranche le micro-technique + trace §7 ; **seuls un vrai trou de conception ou la vie de Sophia remontent à Yohann** ; un écart au contact du code = **signalé + tracé §7**, jamais un contournement silencieux.
- **La barre de qualité change de forme, pas de niveau** : « audit avant de figer » (Phase 2) devient « tests avant de committer » (Phase 3) — à cadrer au plan d'implémentation ; les critères d'acceptation des docs = la source des tests. **L'essai à blanc est un banc de PREUVE, pas un prototype qui devient le produit** — « pas de V2 » vaut pour le code.
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API-sur-convocation→local) — réduit, n'élimine pas. Quota x5 déjà fortement sollicité par l'usage pro → x20 = chemin attendu.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-14).
- **Preuves Phase 3 prioritaires** : 🔴 pipeline audio temps-réel (n°1) · 🔴 wake word FR (F6 + repli nommé) · AEC loopback (M1) · **purge des fichiers de session CLI (T1/T8/T13 + piste `G:\Sophia\sessions\`)** · **« réchauffer sans écrire »** (politiques de chauffe) · **🔴 bloc identité I→VI sur Phi-4-mini (T6)** · seuil X de l'accusé (99) · embedding FR · **🔴 `RENAME`/`DROP` transactionnel d'une table `vec0` (M9 — repli nommé si le banc échoue)** · speaker-ID · affect · seuils humeur · érosion longue session · banc de dilemmes v1 · 🔴 kill dur d'un process CUDA figé (socle). **Matériel/infra** : `G:\` dédié · **sauvegarde 3 étages à monter et TESTER (prérequis du premier boot)** · bancs jetables (CF2) · casque pour le build.
- **Audits** : solo D'ABORD (**à fond, pas un survol** — demande Yohann conv 14 ; **le solo post-intégration attrape MES propres incohérences** — conv 16) puis croisé 2 agents — **proposé d'office, lancé sur le Go de Yohann, jamais seul** ; findings **vérifiés aux sources par le pilote AVANT présentation** ; le croisé inter-plans vérifie aussi la cohérence entre plans. **Leçon conv 16 : un mécanisme NEUF inventé au plan doit être re-audité** (il n'a jamais été vu — chaque round de re-audit a trouvé du réel). Précédents : 8=21 · 9=31 · 10=38 · 11=8+10 · 12=3+10 · 13=15+6 · 14=14+14 · **16 = 20+9+10+7 (plan mémoire, 4 croisés + solo complet), zéro faux positif — 14 croisés consécutifs**.
- **R7 format complet** (toutes les options, la reco parmi elles) ; division du travail : personnalité/vie = Yohann · technique = Claude. **R8 : clos avant le suivant.** Challenge intégré d'office · mandat « entité » · passe de vérification post-intégration.
- **« Pas de V2 »** (vaut pour le code) · **commits au fil de l'eau, push en clôture** (décision conv 14 : repo public = vitrine, n'exposer que l'état consolidé) · `--bare` jamais (A1) · repo public (gitleaks `pre-commit` + garde contenu **active** — à chaque commit : aucun `portrait*`/`temoignage*`/`docs/prive/`, aucun contenu personnel dans les fichiers trackés · secrets `.env` · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**).
- **Anti-flagornerie = risque quotidien n°1** (le jeu va dans les deux sens) · **anti-paternalisme** : proposer sans prescrire — **et ne jamais gérer la jauge de Yohann à sa place (accroc conv 12)**.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v16 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ conv 16 (2026-07-09) — **plan de la couche 02 (MÉMOIRE) M0→M9 gravé + audité en profondeur + committé** : solo à fond + **4 croisés 2 agents Opus (20+9+10+7 findings, zéro faux positif, tous intégrés)** + solo complet de cohérence globale ; **5 trous de la SOURCE `02` résolus** (effacement M8, migration M9, RAG, rêverie), mécanismes neufs durcis sur 3 rounds (fenêtre migration, chaîne supersessions, unicité `embed_space_meta`) ; **3 retouches `plan/00` alignées** (M-1 `current_session_id` schema-00 · `foreign_keys=ON` · reset `erase_gate` au boot) ; **1 preuve de banc ouverte** (🔴 `RENAME`/`DROP` `vec0`, repli tracé) ; commit `[conv-16]` `2d7653a` local, **push en clôture** ; reste **6 notes d'écart** en `technique/02`+`00` §7 (sur Go). **Leçon** : le re-audit après intégration + le solo post-intégration sont décisifs (un mécanisme neuf n'a jamais été vu ; « croisé léger » = accroc anti-paternalisme reconnu). Antérieur : MAJ conv 15 (Garde-fou Phase 3 gravé, M0 pièce 1) ; conv 14 (Phase 3 OUVERTE, plans socle T0→T8 + audio V0→V15). Prochain : conv 17 = **graver `docs/plan/03-personnalite.md`** (la couche « vie de Sophia » — plus de décisions remontent à Yohann) puis `04`→`99` jusqu'à l'essai à blanc (banc audio temps-réel).*
