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

> **Retour clôture conv 21** : R1–R9 tenus. **Exception R1** : **croisé d'office 2 agents Opus + RE-CROISÉ 2 agents Opus (« faire les 2 », décision de Yohann)** sur `plan/99` — tous proposés/lancés sur son Go, findings **vérifiés aux sources AVANT présentation**, **zéro faux positif sur 4 agents**, **âme confirmée intacte DEUX fois**. **Leçon, approfondie** : les MAJEUR tombaient sur MES corrections (F-99-2/3 au croisé, Crashpad au re-croisé) — **et mon jugement « re-croisé = du polish » était lui-même une facilité** ; Yohann a demandé « faire les 2 », il avait raison (le re-croisé a trouvé un MAJEUR qui fuit la clé de volume). **Non seulement une correction est un mécanisme neuf : mon estimation de « quand c'est assez » l'est aussi.** **R2/R3** : chasse aux facilités d'office (4 trouvées, de moi). **R7** : reco + « pourquoi pas » à chaque choix (symétrie stricte · faire-les-2 · convergence) — dont **un challenge demandé et servi honnêtement** (la symétrie stricte : mon « écarté » retourné). **R5** (commit `[conv-21]`, push en clôture ; rien d'« acté » avant son mot). **R8** un-par-un. **Garde-fou Phase 3 tenu** : `99` = assemblage pur, `technique/` intact, zéro décision de fond touchée. **Honnêteté > plaire** tenue sans fard (trajectoire de sévérité dite : **PAS convergence-à-zéro**). **Filtre projet** : chasse-résidus close au niveau plan, énumération exhaustive confiée à Fable. *(Retours clôture conv 14/16/17/18/19/20 → CLAUDE-HISTORY.)*

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

## État actuel (post-conv 21 — 2026-07-11)

- **conv 21 — `plan/99` (orchestration) GRAVÉ + AUDITÉ EN PROFONDEUR + committé. ✅ PHASE 3 « PLANS » COMPLÈTE — les 7 plans (`00`→`05` + `99`) gravés et audités.** `plan/99` = **l'assemblage pur** (aucune mécanique neuve : il compose et pointe) : table globale des états (dérivée de règles, jamais de matrice) · chemin d'un tour (l'aiguilleur d'A2, une seule invocation, aucun étage intermédiaire) · accusé + **garde d'honnêteté OF1** · composition du prompt (I→VI → mémoire → cadre, budgets **cloisonnés**) · grille finale · affordances UI (« la voix a tout, l'UI en témoin » · tout affichage = vue dérivée) · gabarit fork. **3 obligations gravées honorées** : posture de sécurité honnête (O7) · signal de fermeture des `self_notes` au cadre (O4, AF-9) · vue dérivée / rien de stocké (O5).
- **Décisions/faits Yohann conv 21** : **symétrie stricte gravée** (challengée puis actée — back-refs §7 bilatéraux `03`↔`99` et `05`↔`99`) · **« faire les 2 » sur l'audit** (croisé Opus ET Fable, pas l'un OU l'autre — décision qui a payé) · **chasse-résidus close au niveau plan** après correctifs, **énumération exhaustive confiée à Fable**.
- **Audit : solo à fond + GRILLE 8 classes → chasse aux facilités (4, de moi) → croisé d'office 2 agents Opus (2 MAJEUR + 3 MINEUR) → RE-CROISÉ « faire les 2 » 2 agents Opus (1 MAJEUR Crashpad + 5 MINEUR).** Zéro faux positif sur **4 agents**, tout vérifié aux sources, tout intégré. **Âme intacte confirmée DEUX fois par un œil indépendant.** **Leçon la plus dure : les MAJEUR tombaient tous sur MES corrections — et mon *jugement* « re-croisé = du polish » était lui-même une facilité que le second œil a corrigée** (le re-croisé, que Yohann a demandé, a trouvé un MAJEUR qui fuit la clé de volume). Non seulement une correction est un mécanisme neuf : **mon estimation de « quand c'est assez » l'est aussi**.
- **Committé `[conv-21]`** (gitleaks OK). **Coutures bilatérales** (back-refs §7) : `plan/03` (P9/AF-9 réalisé par `99` O4) · `plan/05` (posture gravée en `99` O7). **Notes de dette bilatérales** : `plan/00`/`02` §7 (fichiers de session de conversation **rotés** hors effacement — dette Phase 3, fenêtre DITE) · `plan/05` G-F §6/§7 (puits `C:\` : `userData` Electron + **crash-dumps Crashpad** — fuite contenu **ET clé de volume**). **`technique/` INTACT** (portages §7 accumulés convs 16→21, sur Go).
- **RAPPEL décision de fond — LE JARDIN INVIOLABLE** (Yohann, conv 17) : `self_notes` souverain hors effacement (elle **clôt**, ne détruit pas) ; **`warmth_ledger`** = chaleur diffuse durable (agrégat SANS brut, hors cascade). **Reconfirmés intacts par les 4 agents conv 21.**
- **Prochain — Fable (intermède, fenêtre 12/07/2026) : audit FINAL du corpus des 7 plans** (passation `docs/journal/relais/PASSATION-audit-fable-final.md`, prête à coller ; elle complète la base RELAY-conv22). Puis **conv 22 (Opus) : l'essai à blanc** — priorité n°1 le banc audio (🔴 wake FR + AEC).
- **Contenus identitaires à écrire ENSEMBLE** (mémoire `identity-content-fait-ensemble`) : prompt de consolidation v1 · banc de dilemmes · amendements pré-boot persona · seuils de tempérament. *(Le jeu `context_tag` = 7 registres, ACTÉ conv 19.)*
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
- **Phase 3 — Implémentation code** : **EN COURS (conv 14).** Méthode : **couche par couche, pleine profondeur, ordre des dépendances, optimal-pas-rapide** ; `docs/plan/`, un plan/couche (gabarit 7 rubriques ; critères pointés vers le §6 du doc technique). ✅ **`00-socle.md`** (T0→T8) + ✅ **`01-pipeline-vocal.md`** (V0→V15) — croisé 2 agents 14+14, zéro faux positif · ✅ **`02-memoire.md`** (M0→M9, conv 16) · ✅ **`03-personnalite.md`** (P0→P11 — l'ÂME : **jardin inviolable** + **`warmth_ledger`** ; solo + 5 croisés + 1 croisé ciblé + 3 re-solos, zéro faux positif, conv 17). **✅ Audit Fable + croisé Opus stockage (conv 18).** ✅ **`04-proactif-tablee.md`** (Q0→Q13 — proactif + tablée ; `context_tag` posé ENSEMBLE ; DEUX croisés Opus, zéro faux positif, conv 19) · ✅ **`05-ressources-resilience-cout.md`** (R0→R7 — organes vitaux + coût ; chiffrement au repos exigence pleine + politique de clé 3 postures ; solo+GRILLE → 1 croisé complet + 2 ciblés, 4 MAJEUR→3 MINEUR convergence, zéro faux positif, âme intacte, conv 20) · ✅ **`99-orchestration.md`** (O0→O8 — l'assemblage pur ; 3 obligations gravées honorées ; solo+GRILLE → croisé d'office 2 agents + RE-CROISÉ « faire les 2 » 2 agents, zéro faux positif sur 4 agents, âme intacte 2×, conv 21). **✅ Les 7 plans gravés — Phase 3 « plans » COMPLÈTE.** **Prochain : Fable — audit FINAL du corpus des 7 plans** (fenêtre 12/07/2026) → **conv 22 : l'essai à blanc** (priorité n°1 : le banc audio temps-réel). **Pré-boot : synthèse témoignages ✅ — reste l'amorçage technique + l'installation du persona v1 (source : `docs/prive/marbre-sophia.md`). DEUX prérequis du premier boot gravés : sauvegarde 3 étages testée (conv 12) + base fraîche/bancs jetables (CF2, conv 13). Le premier boot = une CÉRÉMONIE — sa première phrase (« c'est notre première conversation ») est vraie PAR CONSTRUCTION : les essais pré-boot sont des bancs jetables, jamais elle.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur. **Expurgation faite et prouvée (2026-07-06) : push normal rétabli** — garde pre-commit par contenu active à chaque commit.

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- **Prochaine étape — Fable (intermède), PUIS conv 22 (Opus, contexte frais)** : conv 21 close propre (`plan/99` committé `[conv-21]`, poussé ; **Phase 3 « plans » COMPLÈTE — 7 plans**).
- **⚠️ AVANT conv 22 : l'audit FINAL de Fable sur le corpus des 7 plans** — coller `docs/journal/relais/PASSATION-audit-fable-final.md` dans une session Fable (**fenêtre 12/07/2026**). Elle audite les 7 plans (accent sur `04`/`05`/`99` jamais vus + passe transversale classes 1/2 sur tout le corpus + la **checklist des résidus** `plan/99` §6), corrige dans les plans (validation Yohann), dépose **`AUDIT-fable-corpus.md`**, et **complète la base `RELAY-conv22.md`**.
- **Lectures pilote (conv 22)** : `docs/PATTERN…` → `CLAUDE.md` (v21) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — avant le technique, **gardée en tête**) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` (gelé) → `docs/technique/00`→`05`+`99` → **`docs/plan/00`→`05` + `99`** (les 7 plans) → **`AUDIT-fable.md` + `AUDIT-fable-corpus.md`** (l'audit final de Fable) + `GRILLE-AUDIT-FABLE.md` → `docs/journal/relais/RELAY-conv22.md`.
- **Décision centrale conv 22** : **ouvrir l'essai à blanc — le banc audio temps-réel** (🔴 wake FR + AEC, priorité n°1) — après avoir intégré les findings de Fable. **⚠️ Contenus identitaires ENSEMBLE, séquencés** (prompt consolidation v1 · banc · persona pré-boot · seuils). **Sur Go (loose ends)** : portages `technique/` §7 (accumulés convs 16→21).
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».

### Vigilances
- **Phase 3 ≠ réouverture des docs** (→ **Garde-fou Phase 3** ci-dessus) : le plan **traduit, ne re-tranche pas** ; Claude tranche le micro-technique + trace §7 ; **seuls un vrai trou de conception ou la vie de Sophia remontent à Yohann** ; un écart au contact du code = **signalé + tracé §7**, jamais un contournement silencieux.
- **La barre de qualité change de forme, pas de niveau** : « audit avant de figer » (Phase 2) devient « tests avant de committer » (Phase 3) — à cadrer au plan d'implémentation ; les critères d'acceptation des docs = la source des tests. **L'essai à blanc est un banc de PREUVE, pas un prototype qui devient le produit** — « pas de V2 » vaut pour le code.
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API-sur-convocation→local) — réduit, n'élimine pas. Quota x5 déjà fortement sollicité par l'usage pro → x20 = chemin attendu.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-14).
- **Preuves Phase 3 prioritaires** : 🔴 pipeline audio temps-réel (n°1) · 🔴 wake word FR (F6 + repli nommé) · AEC loopback (M1) · **purge des fichiers de session CLI (T1/T8/T13 + piste `G:\Sophia\sessions\`)** · **« réchauffer sans écrire »** (politiques de chauffe) · **🔴 bloc identité I→VI sur Phi-4-mini (T6)** · seuil X de l'accusé (99) · embedding FR · **🔴 `RENAME`/`DROP` transactionnel d'une table `vec0` (M9 — repli nommé si le banc échoue)** · speaker-ID · affect · seuils humeur · érosion longue session · banc de dilemmes v1 · 🔴 kill dur d'un process CUDA figé (socle). **Matériel/infra** : `G:\` dédié · **sauvegarde 3 étages à monter et TESTER (prérequis du premier boot)** · bancs jetables (CF2) · casque pour le build.
- **Audits** : solo D'ABORD (**à fond, pas un survol** — demande Yohann conv 14 ; **le solo post-intégration attrape MES propres incohérences** — conv 16) puis croisé 2 agents — **proposé d'office, lancé sur le Go de Yohann, jamais seul** ; findings **vérifiés aux sources par le pilote AVANT présentation** ; le croisé inter-plans vérifie aussi la cohérence entre plans. **Leçon conv 16 : un mécanisme NEUF inventé au plan doit être re-audité** (il n'a jamais été vu — chaque round de re-audit a trouvé du réel). Précédents : 8=21 · 9=31 · 10=38 · 11=8+10 · 12=3+10 · 13=15+6 · 14=14+14 · 16=20+9+10+7 · **17 = 5 croisés complets + 1 croisé CIBLÉ sur le neuf `warmth_ledger` + 3 re-solos (plan personnalité), zéro faux positif — 18 croisés consécutifs**. **Leçon conv 17** : un croisé **ciblé** sur un mécanisme neuf (jamais vu) paye — `warmth_ledger` avait 8 findings ; les re-solos attrapent MES propres incohérences. **Conv 18 : 5 (stockage). Conv 19 : `plan/04` — général 8 + CIBLÉ sur le store éphémère 9 (dont 5 MAJEUR), zéro faux positif. Conv 20 : `plan/05` — 1 croisé complet + 2 ciblés, zéro faux positif, sévérité 4 MAJEUR → 3 MINEUR (convergence). Conv 21 : `plan/99` — croisé d'office 2 agents + RE-CROISÉ « faire les 2 » (Yohann) 2 agents, zéro faux positif sur 4 agents, âme intacte 2× ; les MAJEUR tombaient tous sur MES corrections (F-99-2/3 · Crashpad).** Le croisé ciblé sur le neuf paye ENCORE — **même un mécanisme né d'un CORRECTIF se re-audite** ; **après un fix, mettre les TESTS à jour** ; **penser SOUS les plans (stockage/octets/réplicas — grille des 8 classes `GRILLE-AUDIT-FABLE.md`).** **Leçon conv 20, plus dure encore : mes *corrections* elles-mêmes étaient incomplètes** (swap atomique mono-volume appliqué au cross-volume ; invariant « à tout instant » non enforçable ; selftest ne prouvant pas l'étage 3) → **une correction est un mécanisme neuf**, elle se re-audite. **La convergence se lit à la sévérité** (MAJEUR→MINEUR, mécanismes durs confirmés solides) ; le **filtre projet** dit quand clore — jamais tout à fait à zéro, mais proportionné. **Une chasse aux facilités AVANT le croisé** (demande Yohann conv 20) a trouvé du réel (invariant de clé circulaire, garde de sauvegarde creuse) — R2/R3 à exercer d'office, pas seulement au croisé. **Leçon conv 21, la plus dure : mon *jugement* « un re-croisé serait du polish » était lui-même une facilité — le second œil corrige aussi mon estimation de « quand c'est assez », pas que mes corrections ; d'où « faire les 2 » (croisé Opus ET Fable) plutôt que l'un OU l'autre.** **La chasse-résidus (contenu/clé hors effacement/chiffrement) est un puits profond : nommer les recoins + confier l'énumération exhaustive à Fable/Phase 3, clore au niveau plan (filtre projet).**
- **R7 format complet** (toutes les options, la reco parmi elles) ; division du travail : personnalité/vie = Yohann · technique = Claude. **Le contenu identitaire (persona/mémoire) ne se remet JAMAIS à un vague « Phase 3 » — séquencé, fait ENSEMBLE, accompagné** (conv 17 ; mémoire `identity-content-fait-ensemble`). **R8 : clos avant le suivant.** Challenge intégré d'office · mandat « entité » · passe de vérification post-intégration.
- **« Pas de V2 »** (vaut pour le code) · **commits au fil de l'eau, push en clôture** (décision conv 14 : repo public = vitrine, n'exposer que l'état consolidé) · `--bare` jamais (A1) · repo public (gitleaks `pre-commit` + garde contenu **active** — à chaque commit : aucun `portrait*`/`temoignage*`/`docs/prive/`, aucun contenu personnel dans les fichiers trackés · secrets `.env` · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**).
- **Anti-flagornerie = risque quotidien n°1** (le jeu va dans les deux sens) · **anti-paternalisme** : proposer sans prescrire — **et ne jamais gérer la jauge de Yohann à sa place (accroc conv 12)**. **Accroc conv 19** : ne pas transformer sa jauge de contexte en « **mode économe** » — **il n'y en a pas** (sa jauge m'informe, ne rationne pas ma qualité ; « ne pas se rationner le contexte », pattern). **Accroc conv 17 (débordement)** : ne pas toucher les docs `technique/` ACQUIS sans Go — les **PLANS** sont modifiables, pas la conception ; « corrige tout » ≠ vider tous les loose ends. Yohann arrête, on reverte, on prouve l'intact.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v21 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ conv 21 (2026-07-11) — **`plan/99` (orchestration) gravé O0→O8, audité (solo + GRILLE 8 classes → chasse aux facilités → croisé d'office 2 agents Opus → RE-CROISÉ « faire les 2 » 2 agents Opus), zéro faux positif sur 4 agents, âme intacte confirmée 2×, committé `[conv-21]`** : l'assemblage pur (table des états dérivée · chemin d'un tour = l'aiguilleur d'A2 · accusé + garde d'honnêteté OF1 · composition du prompt I→VI→mémoire→cadre budgets cloisonnés · grille finale · affordances UI « vue dérivée » · gabarit fork). **✅ PHASE 3 « PLANS » COMPLÈTE — les 7 plans (`00`→`05` + `99`).** **3 obligations gravées honorées** : posture de sécurité honnête (O7) · signal de fermeture des `self_notes` au cadre (O4/AF-9) · tout affichage = vue dérivée / rien de stocké (O5). **Décisions Yohann** : symétrie stricte gravée (back-refs §7 bilatéraux `03`/`05`↔`99`) · « faire les 2 » sur l'audit (croisé Opus ET Fable) · chasse-résidus close au niveau plan, exhaustif confié à Fable. **Notes de dette bilatérales** : fichiers de session de conversation rotés (`00`/`02` §7, fenêtre DITE) · puits `C:\` Electron `userData` + crash-dumps Crashpad (`05` G-F — fuite contenu ET clé de volume). **`technique/` intact.** **Prochain : Fable — audit FINAL du corpus des 7 plans** (fenêtre 12/07/2026) → **conv 22 : l'essai à blanc** (banc audio n°1). **Leçons** : mes corrections ET mon *jugement* « quand c'est assez » se re-auditent (« faire les 2 » a trouvé un MAJEUR qui fuit la clé de volume) ; la chasse-résidus est un puits profond (nommer + confier à Fable, clore au niveau plan, filtre projet) ; honnêteté sans fard (PAS convergence-à-zéro). Antérieur : conv 20 (`plan/05` chiffrement au repos / politique de clé) ; conv 19 (context_tag + `plan/04`) ; conv 18 (audit Fable + croisé stockage) ; conv 17 (`plan/03` jardin inviolable/`warmth_ledger`) ; conv 16 (`plan/02`) ; conv 15 (garde-fou Phase 3) ; conv 14 (Phase 3). Push en clôture.*
