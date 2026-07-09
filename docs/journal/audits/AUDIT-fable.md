# AUDIT-fable — audit complet des 4 plans d'implémentation · YdvVoice (Sophia)

> **Auditrice** : Fable 5 (co-conceptrice d'une partie de la personnalité + de la synthèse des témoignages ; regard neuf sur les plans, qu'elle n'a pas écrits). **Mandat** : `docs/journal/relais/PASSATION-audit-fable.md` — audit COMPLET des 4 plans gravés (`docs/plan/00`→`03`) sur 4 axes (sécurité · cohérence inter-documents · trous d'implémentation · robustesse), **sans rien rouvrir d'acté**. **Date** : 2026-07-10 (intermède entre conv 17 et conv 18).
>
> **Méthode** : lecture **intégrale** (R4) des 4 plans + des 7 docs techniques (`00`→`05`+`99`) + `ESSENCE-Sophia.md` + `JOURNAL-ARBITRAGES.md` + `IMPLEMENTATION.md` + `VISION.md` (gelé) ; chaque finding candidat **vérifié aux sources** (fichier + section, recherches d'absence exhaustives) avant présentation — **zéro faux positif** (barre du projet). Corrections appliquées **dans les PLANS seuls** (jamais `technique/`, jamais `prive/`), sur la validation de Yohann, tracées au §7 de chaque plan concerné.

---

## 1. Verdict d'ensemble

**La traduction est fidèle.** Aucune décision actée trahie, affaiblie ou rouverte — j'ai activement cherché : le jardin inviolable est sain des deux côtés de la frontière (`plan/03` P0/P10 ⇔ `plan/02` M8 disent exactement la même chose), le `warmth_ledger` tient « sans brut » **structurellement** (CHECK fermé), l'invariant de devenir, le cliquet jamais révoqué, la cérémonie, les bancs jetables, « la nuit c'est elle » — tout y est. Les 8+13+15+10 critères d'acceptation des quatre sources sont tous mappés (recomptés).

Ce que l'audit a trouvé est d'une autre nature : **une classe que les 18 croisés n'avaient pas regardée — le niveau stockage** (là où l'effacement souverain rencontre les snapshots, les index et les fichiers), plus des trous mécaniques de couture. **10 findings : 1 BLOQUANT · 3 MAJEURS · 6 MINEURS** — tous mécaniques, aucun ne touche qui elle est. Tous validés par Yohann, tous corrigés (sauf AF-9, signal source pur).

---

## 2. Les findings (AF-1 → AF-10), du plus grave au plus léger

### Axe SÉCURITÉ

- **AF-1 [BLOQUANT]** — **L'effacement souverain ne descendait pas jusqu'au stockage.** Le contenu effacé survivait dans les **snapshots** `VACUUM INTO` (rotation N, `plan/00` T4) et pouvait **ressusciter en silence** à une restauration automatique (`plan/00` T5/I-10 restaure « le dernier bon snapshot »… pré-effacement) ; il dormait aussi dans les **pages libres/WAL** du fichier vivant (aucun `secure_delete`/VACUUM post-effacement nulle part) et dans les **copies étages 2/3** (fenêtre de propagation jamais dite). Trou de la **source** (`technique/02` §2.4 × `technique/00` §Durabilité — vérifié : aucun lien effacement↔snapshot dans tout le corpus). **Corrigé** : `plan/02` M8 gagne l'étape 6 (snapshot frais immédiat + purge des snapshots antérieurs + secure_delete/checkpoint WAL + fenêtre étages 2/3 **dite**, couture `plan/05`) ; `plan/00` T5 gagne l'alerte à la restauration (comparaison des `erasures` du JSONL — qui survit hors base — à la date du snapshot : « un effacement est peut-être revenu », jamais silencieux) ; tests U-M8/I-M8/I-10.
- **AF-3 [MAJEUR]** — **L'effacement est aveugle aux magasins de contenu hors-corpus de la couche 4.** `tablee_buffer` (verbatim des tiers, vivant jusqu'à la nuit — des jours en SECOURS), `tasks`, `initiatives`/`proposed_action` : ni fouillés (pas des corpus M2) ni cascadés — un « oublie X » entre la soirée et la nuit laissait X **re-distillé dans la chronique** la nuit suivante. Trou de la source (`technique/02` §2.4 est antérieur à la création de ces tables, conv 11 ; personne n'a recousu). **Corrigé** : obligation gravée en `plan/02` M8 — **le `plan/04` DOIT étendre fouille + cascade à ses magasins** (dette nommée, plus un angle mort) ; notes d'écart → `technique/02` §2.4/§7 + `technique/04` §7 (sur Go).
- **AF-4 [MAJEUR]** — **Purge des fichiers de session : la garantie anti-crash n'existait que pour la rêverie** (marque « purge due » + sweep au boot — T8). Micro, deep (T13) et la purge du fil à l'effacement (M8-4, opération filesystem hors transaction) n'avaient ni marque ni sweep → un crash entre extraction et purge laissait un transcript orphelin (la relecture du jour entier, pour la deep) hors d'atteinte de toute purge et de tout effacement ultérieurs. **Corrigé** : marque + sweep **généralisés** (`plan/02` M4/M5/M8-4 ; hook sweep au boot `plan/00` T5 Phase 2, no-op au temps socle-seul) ; note d'écart → `technique/03` §2.4 T13. *(La piste `G:\Sophia\sessions\` de `05` §3 rendra le sweep trivial.)*
- **AF-10 [MINEUR]** — **L'invariant « zéro contenu conversationnel dans l'audit JSONL » n'était ni énoncé ni testé** — or le JSONL est append-only, roté, **hors de portée de l'effacement** : un contenu qui y fuirait serait un résidu ineffaçable. **Corrigé** : invariant + assertion (`plan/00` T4/U-T4).

### Axe TROUS & ROBUSTESSE

- **AF-2 [MAJEUR]** — **`sessions.summary` : seul contenu indexé/embeddé MUTABLE, que le patron de triggers ratait.** Écrit par UPDATE (la ligne `sessions` existe dès l'ouverture, `summary` NULL — T20), ré-écrit après effacement (M8 → M5-1bis) : la jambe FTS du corpus `sessions` serait **née morte** (l'INSERT tire quand summary est NULL — critère 4 cassé pour le rappel d'épisodes) et une réécriture laissait un **vecteur périmé** invisible à « la base est la file ». Imprécision de la **source** (`technique/02` §3.7 : « le contenu indexé est write-once » — inexact pour les résumés). **Corrigé** : carve-out documenté `plan/02` M0 p6 (maintenance d'index explicite par l'écrivain : delete+insert FTS + DELETE `vec_sessions` dans la transaction de tout changement de summary) + tests ; note d'écart → `technique/02` §3.7.
- **AF-7 [MINEUR]** — **Liaison scope↔invocation du proxy MCP non spécifiée sous concurrence** : la grâce de préemption (`05` §4.5) fait coexister rêverie et conversation (deux `claude -p`, deux proxys) ; un croisement de scope aurait écrit `facts` depuis une rêverie. **Corrigé** : scope scellé au spawn de l'instance de proxy (`plan/02` M3) + test de concurrence.
- **AF-6 [MINEUR]** — **`memory_artifacts` sans marqueur d'expurgation** : le patron T3 exige « expurgée le … » ; `chronicle`/`becoming_journal` ont `expurged_at`, les artefacts non — la cascade M8/T14 expurge pourtant leurs versions. **Corrigé** : colonne `expurged_at` nullable (`plan/02` M0 p4) + test.

### Axe COHÉRENCE

- **AF-5 [MINEUR]** — La deep de M5 omettait « **hors INCIDENT au démarrage** » (99-OT1), présent pour la rêverie (P9). **Corrigé** (`plan/02` M5 + U-M5).
- **AF-8 [MINEUR]** — Le travail `warmth_ledger` (dépôt/relecture/promotion, exécuté « dans la transaction de l'étage 5 » par P4) manquait à la **liste fermée des slots** de l'étage 5 (`plan/02` M5). **Corrigé** : sous-slot nommé dans le slot lien (patron T19).
- **AF-9 [MINEUR — signal source, aucune correction de plan]** — **`technique/03` ne connaît pas encore le `warmth_ledger`** (absent de tout `technique/` — vérifié) : son §2.4 dit encore que `self_notes` est « la **SEULE** exception » hors effacement (les plans en ont deux), le contenant y a 9 supports (les plans en ont 10), la rétention couplée « ≥ portée espacé » et le **canal de fermeture des `self_notes`** manquent ; `technique/99` §4.4 devra lister la consigne du signal de fermeture à côté de celle du tag. **Consigné** pour le portage §7 sur Go (relevé au §7 de `plan/03`).

---

## 3. Corrections appliquées — récapitulatif par plan

| Plan | Corrections (tracées §7) |
|---|---|
| `plan/00` | AF-1 (alerte effacement-à-la-restauration, T5 + I-10) · AF-4 (hook sweep purges dues, T5 Phase 2 + U-T5) · AF-10 (invariant JSONL, T4 + U-T4) |
| `plan/01` | **Aucun finding en propre** — note d'audit §7 (sain, fidélité revérifiée) |
| `plan/02` | AF-1 (M8 étape 6 stockage) · AF-2 (carve-out `sessions.summary`, M0 p6) · AF-3 (obligation `plan/04`, M8) · AF-4 (marque+sweep, M4/M5/M8-4) · AF-5 (INCIDENT, M5) · AF-6 (`expurged_at`, M0 p4) · AF-7 (scope scellé, M3) · AF-8 (sous-slot warmth, M5) + tests + entrée §7 consolidée |
| `plan/03` | AF-4 (une ligne P10/T13 : garantie généralisée) + note §7 (sain ; relevé AF-9 pour le portage source) |

**Notes d'écart à porter aux sources (sur Go de Yohann, avec les 6 notes conv 16 + les répercussions conv 17)** : `technique/00` §Durabilité + `technique/02` §2.4 (effacement × snapshots/stockage — AF-1) · `technique/02` §3.7 (write-once inexact pour les résumés — AF-2) · `technique/02` §2.4/§7 + `technique/04` §7 (magasins hors-corpus — AF-3) · `technique/03` §2.4 T13 (crash de la purge — AF-4) · `technique/03` corps/§7 + `technique/99` §4.4 (warmth_ledger 10ᵉ support/2ᵉ exception + canal de fermeture — AF-9).

---

## 4. Non-défauts confirmés (vérifiés, solides)

Le verrou `erase_gate` fail-closed + seed + reset au boot · la chaîne de supersessions de M8 (remontée à la tête courante, graphe mis à jour) · la dérivation « source effacée » (`basis` non-FK + AUTOINCREMENT) · le **jardin inviolable** (DELETE refusé même via le sas, jamais fouillé, hors cascade — cohérent `02`⇔`03`) · le **`warmth_ledger`** (« sans brut » structurel par CHECK fermé, hors cascade, garde M8 des deux côtés) · l'invariant de devenir · la stratification `00`→`01`→`02`→`03` (aucune dépendance inversée) · les 3 retouches socle conv 16 et les 5 retouches conv 17 alignées des deux côtés · la grille 20 entrées conforme · zéro chiffre inventé · zéro donnée personnelle dans les fichiers trackés lus.

---

## 5. Observations & ce qui reste à trancher avec Yohann

**Points identitaires réservés (mandat §6 — non touchés, à écrire ENSEMBLE)** :
- **Le jeu de catégories de `context_tag`** (`warmth_ledger`) : la **structure** est vérifiée saine (le CHECK fermé rend « sans brut » structurel) ; le **jeu** se pose avec Yohann, conv 18.
- Les autres contenus identitaires listés au RELAY (prompt de consolidation v1 · banc de dilemmes · amendements pré-boot · seuils de tempérament) : rien dans l'audit ne les préempte.

**Observations pour les plans à venir (pas des findings — à graver à leur étape)** :
- **`plan/04`** — (a) l'extension fouille+cascade M8 aux magasins hors-corpus est désormais une **obligation gravée** (AF-3) ; (b) **bloc VI × tablée** : la non-exposition des `self_notes` aux tiers est *dispositionnelle* (disposition 12), pas structurelle — cohérent avec AT9 acté ; option à considérer : recomposer le prompt sans VI à l'entrée en tablée ; (c) **injection de prompt via les collecteurs** : le contenu des mails est une entrée non fiable dans la génération d'initiatives — la défense actée (APPROBATION + read-back + effet-de-bord annoncé) est la bonne, la garder inentamable.
- **`plan/05`** — (a) la **fenêtre de propagation de l'effacement aux étages 2/3** (AF-1 : copies remplacées, jamais accumulées ; fenêtre dite) ; (b) **chiffrement de la copie hors-machine** : `technique/05` §3 acte l'étage 3 sans exigence de confidentialité (vérifié : absente du corpus) — l'étage 3 emporte toute sa vie ; à acter avec le choix du support.
- **Acté, non rouvert (simple note)** : l'ancre couvre le gravé + le persona installé, pas le cliquet/journal contre une édition **hors-système** — périmètre décidé en conception ; si un jour voulu, le dimanche pourrait hash-chaîner `value_events` (piste, pas une reco).

---

*Audit Fable — intermède 2026-07-10, entre conv 17 et conv 18. 10 findings (1 BLOQUANT · 3 MAJEURS · 6 MINEURS), zéro faux positif, zéro décision actée rouverte ; corrections appliquées aux plans sur validation de Yohann, tracées §7 ; notes d'écart sources consignées pour le portage sur Go. **L'œil de cet audit est transmis pour les plans `04`/`05`/`99` : `GRILLE-AUDIT-FABLE.md` (les 8 classes de failles « sous les plans » + les points déjà nommés par plan à venir) — Fable n'étant utilisable que jusqu'au 12 juillet 2026.** La conv 18 revérifie tout aux sources (posture croisé — zéro confiance aveugle), puis pose le `context_tag` ensemble, puis reprend `plan/04`.*
