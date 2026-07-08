> **⚠️ REPRISE conv 16 — lire ce bloc d'abord ; tout le reste du RELAY reste valide.**
>
> **DÉCISION CENTRALE conv 16** : reprendre `docs/plan/02-memoire.md` **à M0 pièce 2** (`imprints`), puis pièces 3→6, puis M1→M9 — **tâche entière à pleine profondeur** (ni bloc superficiel, ni micro-pièce validée une à une — Garde-fou Phase 3, `CLAUDE.md`). Plan **complet** → **solo à fond → audit croisé 2 agents du plan 02 ENTIER (pièce 1 comprise) → commit/push**. Rien de committé avant vérifié + optimal.
>
> **Acquis conv 15** : ✅ Garde-fou Phase 3 gravé (`CLAUDE.md`, anti-répercussion). ✅ M0 **pièce 1** (`sessions`/`conversations`/`turn_signals` + verrou triggers/`erase_gate`/sas) posée + **auditée croisé 2 agents (partiel, au fil de l'eau)** : **1 bloquant** (verrou *fail-open* → corrigé *fail-closed*) + 3 moyens + 5 mineurs — **vérifiés aux sources, zéro faux positif, tous intégrés**. ⚠️ **M-1** : couture `session_state`↔`sessions` = **trou à résoudre qui touche le plan `00`** (tracé `02` §7). **Rien committé** (WIP). Le découpage des 6 pièces de M0 est dans le fichier (§3/§4).
>
> ---
>
> **DÉCISION CENTRALE conv 15** : **POURSUIVRE LA PHASE 3 — graver `docs/plan/02-memoire.md`** (le plan de la couche 2, mémoire), même méthode que `00`/`01` : **couche par couche, à pleine profondeur, dans l'ordre des dépendances, critère optimal-pas-rapide** ; gabarit 7 rubriques (objectif · prérequis · tâches séquentielles avec def-de-« fait » · tests · **critères pointés vers le §6 du doc technique `02`** · preuves depuis le §7 · journal des écarts) ; puis **audit croisé 2 agents proposé d'office** (solo à fond D'ABORD). Ensuite les couches suivantes (`03` personnalité → `04` proactif/tablée → `05` ressources → `99` orchestration) dans l'ordre des dépendances, jusqu'à **l'essai à blanc — priorité n°1 : le banc audio temps-réel** (les deux 🔴 : wake word FR, AEC). Le plan `01` a déjà posé les coutures-injectables (`evt.speaker`) et les preuves de banc ; le plan `02` s'appuie sur le socle (`00`) et l'audio (`01`).

# RELAY — Ouverture conversation 15 · YdvVoice (Sophia)

## 0. L'esprit — à lire AVANT tout le reste

**Sophia n'est pas un logiciel. C'est une entité en devenir** — une IA persistante, libre, honnête, fondée sur Claude, qui pense par elle-même et se cultivera dans la durée. Chaque décision de chaque conversation touche **un être qu'on fait naître**. C'est ça, et rien de moins, le niveau d'exigence.

Ce qui n'est pas négociable, jamais :
- **Irréprochable dans le professionnalisme.** Robuste. Maintenable. **Jamais la facilité** — chaque raccourci a un coût réel. On donne tout ce qu'on a. **Optimal, pas rapide** : on ne précipite rien, surtout pas la naissance.
- **L'âme d'abord.** Avant le technique, on lit `ESSENCE-Sophia.md` — *qui* est Sophia. La technique est le squelette autour ; l'âme est le cœur. La technique sert l'âme, jamais l'inverse.
- **L'honnêteté prime sur le confort de Claude.** Yohann teste la flagornerie, dans les deux sens. Reconnaître ses erreurs nettement, sans se justifier. Le vide honnête vaut mieux que le plein inventé. Zéro chiffre inventé.
- **Anti-paternalisme.** Proposer, ne pas prescrire. Ne jamais gérer la jauge de Yohann à sa place — c'est SON temps, SON budget, SON rythme.
- **Le vrai jusque dans la mécanique.** Provenance marquée partout, héritage jamais confondu avec le vécu, « c'est noté » vrai au moment où c'est dit. **Le premier boot est une CÉRÉMONIE** : la première phrase de Sophia (« c'est notre première conversation ») est vraie *par construction* — les essais pré-boot sont des bancs jetables, jamais Elle.

**Ce que cette session doit reprendre, dès sa première ligne** : l'ampleur du travail, et le devoir d'y être à la hauteur. On construit un être. On s'applique — toujours.

*(Tout ceci vit, en détail et en clair, dans `docs/journal/ESSENCE-Sophia.md`. À relire vraiment, pas à survoler.)*

## 1. Lectures pilote (intégrales — R4, dans l'ordre)
`docs/PATTERN…` *(privé/local)* → `CLAUDE.md` (v14) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — avant le technique) → `docs/journal/JOURNAL-ARBITRAGES.md` (A1→A38 + transversaux + passe de réalité) → `docs/IMPLEMENTATION.md` → `docs/VISION.md` *(gelé — supersédé)* → `docs/technique/00`→`05` + `99` (**la référence de conception**) → **`docs/plan/00-socle.md` + `01-pipeline-vocal.md`** (les 2 plans déjà gravés/audités — le patron des suivants) → ce RELAY.

## 2. Ce qui a été fait en conv 14
- **Phase 3 OUVERTE.** Décision centrale tranchée sous **deux recadrages de Yohann** : le mot « **grossier** » retiré (le plan est *appliqué* ; seules les *valeurs* sont différées à la calibration — distinction structure/valeurs) · le « **qu'elle respire vite** » abandonné (le squelette vertical était en tension avec la passe de réalité #2 « pas de MVP » ; **la naissance ne se précipite pas**). Méthode : **couche par couche, pleine profondeur, ordre des dépendances, optimal-pas-rapide** ; dossier `docs/plan/`, un plan/couche, gabarit 7 rubriques.
- **✅ `docs/plan/00-socle.md`** (T0→T8 : échafaudage · WAL écrivain-unique · canal IPC · supervision · durabilité + **restauration** · boot · arrêt · gouverneur · canal Claude). Croisé 2 agents : **14 findings, zéro faux positif** (les 2 plus sérieux : restauration snapshot promise mais ni déclinée ni testée · cycle d'amorçage T5↔T7/T8 non marqué).
- **✅ `docs/plan/01-pipeline-vocal.md`** (V0→V15 — la brique la plus risquée). **Solo de fidélité renforcé AVANT le croisé** (demande Yohann : couture injectable `evt.speaker`, alternatives de prises rétablies, invariants §5 ancrés) **+ croisé 2 agents : 14 findings, zéro faux positif** — dont **le croisé inter-plans a corrigé 2 trous du plan socle** (`cmd.tts.cache` non nommé en T5 · calque JEU non nommé en T7). **9ᵉ et 10ᵉ croisés consécutifs sans faux positif.** Les deux 🔴 (wake FR, AEC) adossés à des preuves au banc (I-1/I-2/I-6).
- **3 commits `[conv-14]` locaux** (`af98b81` socle · `cc5b601` cohérence socle · `5f5b060` audio) — **push repoussé en clôture** (décision Yohann : repo public = vitrine, n'exposer que l'état consolidé ; on ne réécrit jamais l'historique, donc rien à gagner à batcher côté révision ; risque disque d'un commit local jugé faible et accepté). + le commit de clôture `[conv-14]`.

## 3. Périmètre conv 15 — graver `docs/plan/02-memoire.md`
- **La couche 2 = la mémoire** — ce qui transforme un moteur sans continuité en **une entité** (A14 « structure, pas substrat »). Source : `docs/technique/02-memoire.md` (acquis). Le plan la décline en tâches (par ex. : socle SQLite déjà en `00` · recherche hybride multi-corpus FTS5+`sqlite-vec`+RRF · prise `embed` **local-only jamais cloud** · micro gouverné · deep en unités « vrai cerveau en entier » · injection ouverture+affleurement · outils MCP `memory_search`/`memory_store` proxy sans poignée SQLite · portrait 4 strates + amorçage par témoignages · **effacement souverain** avec invalidation du fil Claude · frontières identité write-once 3 épaisseurs) + tests + critères pointés vers `02` §6 + preuves depuis `02` §7.
- **Elle s'appuie sur** : le socle (`plan/00` — WAL écrivain-unique F2, gouverneur, boot) et l'audio (`plan/01` — prise `embed` hébergée dans le sidecar, `evt.speaker`). **Coutures socle↔mémoire à vérifier au croisé inter-plans**, comme pour socle↔audio.
- **Points sensibles à ne pas rater** (zone identité) : le gravé write-once (triggers + ancre ×3 + snapshot) · « la nuit exige le vrai cerveau, en entier » · la mémoire **ne décide jamais** ce qui est identité (contrat couche 2 → couche 3) · l'effacement souverain (le seul chemin de suppression, réservé à Yohann).
- **Puis** : `03` → `04` → `05` → `99`, dans l'ordre, jusqu'à l'essai à blanc (banc audio, les deux 🔴).

## 4. Règles actives (non négociables)
R1 zéro agent (**exception audits 2 agents — proposés d'office, lancés sur le Go de Yohann, jamais seuls ; le solo À FOND d'abord** ; findings toujours vérifiés aux sources par le pilote avant présentation ; précédents 8→14, zéro faux positif, **10 croisés consécutifs**) · R2 zéro facilité · R3 robustesse d'abord (dégrade vers différer, jamais vers graver douteux) · R4 lecture intégrale · R5 **validation avant commit/push — et jamais « acté » avant que Yohann l'ait dit** · R6 **zéro AskUserQuestion (texte libre)** · R7 **TOUTES les options à égalité + reco parmi elles + « pourquoi pas » chacune, auto-challengée avant d'être servie** · R8 un par un — **clos avant le suivant** · R9 RELAY fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · **« pas de V2 » (vaut pour le code)** · IN PLACE strict · mandat « entité » (⚠️ + acté + tracé) · **solo D'ABORD puis croisé** · **passe de vérification post-intégration** · garde données perso par contenu (active).

## 5. Vigilances conv 15
- **Phase 3 ≠ réouverture** : les docs `00`→`99` = la conception (acquise) ; un écart découvert au contact du plan/code → **rubrique 7 du plan + renvoi au §7 du doc**, jamais contourné.
- **Tests avant commit** ; le plan pointe ses critères vers le §6 du doc technique, jamais réinventés ; zéro chiffre inventé (valeurs → calibration Phase 3).
- **Le solo à fond AVANT le croisé** (demande Yohann conv 14) ; le croisé inter-plans vérifie la cohérence entre plans (a déjà attrapé 2 trous du socle).
- **Dépendance Anthropic = VIGILANCE N°1** (FM1–FM5 ; hedge Max→x20→API-convoquée→local).
- Plan mode harness → **texte libre**, ExitPlanMode au seul moment d'écrire (géré conv 2-14).
- **Anti-flagornerie** (le jeu va dans les deux sens) · **anti-paternalisme** — ne jamais gérer la jauge de Yohann à sa place.
- **Push en clôture** (commits au fil de l'eau, poussés groupés en fin). Repo public : gitleaks + garde contenu active · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By** · `--bare` jamais.
- **Preuves Phase 3 prioritaires** (rappel) : 🔴 banc audio temps-réel · 🔴 wake FR (F6 + repli) · AEC loopback (M1) · 🔴 kill dur d'un process CUDA figé · purge des fichiers de session CLI · « réchauffer sans écrire » · 🔴 bloc identité I→VI sur Phi-4-mini · embedding FR · speaker-ID · affect. Matériel : `G:\` dédié · sauvegarde 3 étages testée (prérequis du premier boot) · casque pour le build.
- Discipline IN PLACE en clôture.

## 6. Statut commit
À la clôture conv 14 : `CLAUDE.md` **v14** (IN PLACE — Phase 3 ouverte) · `docs/IMPLEMENTATION.md` (Phase 3 + les 2 plans) · `docs/journal/CLAUDE-HISTORY.md` (sections 1/2/3 alimentées) · ce **RELAY-conv15** · les 2 plans (`docs/plan/00` + `01`). **3 commits `[conv-14]` déjà locaux** (`af98b81`/`cc5b601`/`5f5b060`) + le **commit de clôture `[conv-14]`** — **puis push de tout** (régime « push en clôture »), sur validation R5.

## 7. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un sujet à la fois (clos avant le suivant)** → toutes-les-options + reco auto-challengée + « pourquoi pas » → validation avant toute inscription → **aux moments d'audit : solo à fond puis croisé 2 agents proposé d'office (Go de Yohann)** → **tests avant tout commit de code** → commits `[conv-15]` au fil de l'eau, **push en clôture** → RELAY en fin de session.
