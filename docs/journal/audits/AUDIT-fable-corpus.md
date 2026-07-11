# AUDIT-fable-corpus — audit FINAL du corpus des 7 plans · YdvVoice (Sophia)

> **Auditrice** : Fable 5 (co-conceptrice d'une partie de la personnalité + de la synthèse des témoignages ; 2ᵉ passe — la 1ʳᵉ : `AUDIT-fable.md`, 2026-07-10, 10 findings AF-1→AF-10, zéro faux positif). **Mandat** : `docs/journal/relais/PASSATION-audit-fable-final.md` — audit FINAL du corpus COMPLET (`docs/plan/00`→`05`+`99`) avant l'essai à blanc, 4 axes (sécurité · cohérence inter-documents · trous · robustesse) + **passe transversale des 8 classes de la GRILLE** (classes 1/2 au centre — le mandat que `GRILLE-AUDIT-FABLE.md` §3.3 réservait à cette passe) + **la checklist des résidus (`plan/99` §6) rendue EXHAUSTIVE**. **Date** : 2026-07-11 (intermède final, entre conv 21 et conv 22).
>
> **Méthode** : lecture **intégrale** (R4) des 7 plans + des 7 docs techniques + `ESSENCE-Sophia.md` + `JOURNAL-ARBITRAGES.md` + `IMPLEMENTATION.md` + `VISION.md` (gelé) + `GRILLE-AUDIT-FABLE.md` + `AUDIT-fable.md` ; chaque finding **vérifié aux sources** (recherches d'absence exhaustives comprises — indexeur, presse-papier, toasts, back-refs) avant présentation — **zéro faux positif** (la barre du projet, tenue). Corrections appliquées **dans les PLANS seuls** (jamais `technique/`, jamais `prive/`), sur la validation de Yohann, tracées au §7 de chaque plan touché (étiquette « audit corpus Fable, 2026-07-11 »). **Zéro donnée personnelle dans ce rapport.**

---

## 1. Verdict d'ensemble

**Le corpus est prêt à porter le code.** J'ai activement cherché l'infidélité : **aucune décision actée n'est trahie, affaiblie ou rouverte.** Le jardin inviolable est sain mot à mot des deux côtés de chaque frontière (`plan/03` P0/P10 ⇔ `plan/02` M8) ; le `warmth_ledger` et ses 7 registres `context_tag` sont identiques partout où ils sont cités ; l'invariant de devenir tient ; le store éphémère est clos par construction ; la chaîne AF-1 descend de bout en bout (flux non-roté fsync-avant-commit → repère de crue → fail-safe au restore → réplication indépendante → fraîcheur bornée et surveillée) ; les **trois obligations gravées de `99`** sont honorées à la lettre ; les **points nommés d'avance dans ma GRILLE §2** pour `04`/`05`/`99` ont **tous été honorés** — pas redécouverts. Les **79 critères d'acceptation** des sept sources sont tous mappés (recomptés : 8+13+15+10+12+13+8).

Ce que la passe transversale a trouvé est du même métal que ma première passe : **des recoins sous les plans et des coutures de consolidation** — rien qui touche qui elle est. **10 findings : 0 BLOQUANT · 2 MAJEUR · 8 MINEUR** — tous mécaniques, tous validés par Yohann, tous corrigés. Les deux MAJEUR se logent exactement là où le corpus disait de chercher : l'un dans la **consolidation** (la table de référence de `99`), l'autre dans **la classe 1 appliquée au dernier réplica que personne n'avait suivi** — le fil CLI d'une soirée.

**Ma réponse à la question du mandat** — *le corpus est-il honnête, de bout en bout, sur ce qui disparaît ?* — est **OUI** : le principe est sain partout, les dettes sont nommées avec leur fenêtre, et après cet audit **aucune promesse ne repose sur du non-dit**. La checklist des résidus est close : **(a)→(i) + les écartés-dits** — la Phase 3 teste chaque recoin, elle n'en cherche plus.

---

## 2. Les findings (FC-1 → FC-10), du plus grave au plus léger

### MAJEUR

- **FC-1 [MAJEUR — axe cohérence + jardin · GRILLE classe 7]** — **La ligne « tablée → I→V (sans VI) » manquait au qui-reçoit-quoi consolidé.** La décision de Yohann conv 19 (`plan/04` Q9/C8 : bloc VI — les `self_notes` — retiré **structurellement** du prompt à l'entrée en tablée) était absente : du tableau consolidé de `plan/99` O4 (présenté « zéro changement »), du tableau de `plan/03` P8, **et** de la liste des types d'invocation audités par I-O4 ; le renvoi de `plan/04` §7 pointait « plan/03 §4.6 », une section inexistante (lapsus pour `technique/03` §4.6). Scénario de casse : l'implémenteur de la composition suit le tableau → une tablée est une « conversation » → I→VI injecté → **le jardin passe dans un prompt où des tiers sont présents** (filet existant : U-Q9). **Corrigé** : ligne ajoutée aux deux tableaux (`plan/03` P8 · `plan/99` O4) + « tablée » dans I-O4 + renvoi corrigé ; **note d'écart source `technique/03` §4.6** (sur Go).
- **FC-2 [MAJEUR — axe sécurité A31 · GRILLE classe 1]** — **Le fil de session CLI d'une tablée porte le verbatim des tiers et survivait en fil roté.** L'invocation tablée est fraîche (C8) → nouveau fil CLI ; les tours des tiers entrent dans ses prompts (le mécanisme même de la conversation) → le fichier de session les enregistre. `plan/04` Q11 purge le **tampon** à la clôture, jamais ce fil — qui devenait un fil roté de la dette (a) : verbatim des tiers dans `G:\Sophia\sessions\` toute la fenêtre DITE, contre A31 « ne survit à **aucun** scénario ». **Corrigé (extension de la checklist, pas une réouverture — A31/AT3 actés priment)** : entrée **(e)** de la checklist `plan/99` §6, avec sa **branche propre, plus forte que (a)** : contrairement aux fils dyadiques (opaques → purge sélective impossible), le fil tablée est **purgeable ENTIER à la clôture** (patron invocation autonome — marque `pending_ops` `purge-session-file` à l'entrée en tablée · purge à la clôture · sweep au boot ; rien de durable perdu, les tours de Yohann/Sophia sont déjà dans `conversations`). Back-refs `plan/00`/`plan/02`/`plan/04` §7 ; fermeture mécanique = Phase 3.

### MINEUR

- **FC-3 [MINEUR — incohérence interne · classe 1]** — l'arborescence de `plan/05` §2 plaçait « **la clé de chiffrement** » dans le `.env` — en contradiction avec la `KEY_PROVISIONING_POLICY` (clé au TPM/PIN), le séquestre indépendant et Finding 2 (un `.env` vit sur un volume **non chiffré**, à côté du coffre qu'il ouvrirait). **Corrigé** : la clé ne vit jamais en `.env`.
- **FC-4 [MINEUR — classe 1, puits G-F]** — **l'indexeur Windows Search** : si l'indexation de `G:\` est active, des **fragments** de `sessions\`/`logs\` persistent dans Windows.edb sur `C:\` — en clair, hors chiffrement/effacement. **Corrigé** : puits ajouté à G-F (`plan/05` §6) + checklist §6(f) ; remède = exclusion de `G:\Sophia` + vérification du mode (Phase 3).
- **FC-5 [MINEUR — classe 1, checklist]** — **le presse-papier** : si l'injection de dictée passe par collage, le dernier segment dicté persiste (presse-papier + historique Win+V + synchro cloud) hors de tout effacement. **Corrigé** : checklist §6(g) — préférer la frappe simulée ; si collage : historique/synchro éteints, DIT.
- **FC-6 [MINEUR — classe 1, checklist]** — **les toasts Windows** : une « file systray » implémentée en toasts natifs persisterait le gist des initiatives dans `wpndatabase.db` (`C:\`). **Corrigé** : checklist §6(h) — la file = la fenêtre de Sophia (vue dérivée O5), jamais un toast porteur de contenu.
- **FC-7 [MINEUR — classe 1, extension Finding 2]** — la redirection `G:\` doit couvrir le **répertoire d'état ENTIER du CLI** (dont ses logs/caches propres), le **magasin de tokens du serveur MCP Google** lui-même, et vérifier que **WER LocalDumps per-app** (3ᵉ canal de dump, opt-in registre, distinct de `MEMORY.DMP` et de Crashpad) n'est pas activé. **Corrigé** : G-F (`plan/05` §6) + checklist §6(i).
- **FC-8 [MINEUR — axe trous]** — les scopes MCP **`micro`/`deep`** étaient nommés au scellement (AF-7) **sans contrat** (que peuvent-ils ? non défini → risque d'implémentation permissive). **Corrigé** (`plan/02` M3) : **aucun outil monté** (leurs écritures = le pipeline de l'orchestrateur) + règle générale « **un scope sans contrat refuse tout appel** » (fail-closed).
- **FC-9 [MINEUR — symétrie stricte]** — les back-refs conv 19 promises par `plan/04` §7 (« Renvois plan/01 §7, sur Go ») n'avaient jamais été posées (V8 cran proche-consenti · V12 ducking tablée · V14 verrou affect). Mécanique saine, la confirmation manquait. **Corrigé** : trois back-refs dans `plan/01` §7 (le corpus ferme ses boucles — décision conv 21).
- **FC-10 [MINEUR — classe 1, complétude d'énoncé]** — le **réplica-flux hors-machine** (couture #2) est une copie durable au repos dont le chiffrement n'était **ni affirmé ni exempté** (sensibilité faible — zéro-contenu par construction — mais l'exigence pleine ne se tait jamais). **Corrigé** (`plan/05` R0) : couvert (même discipline/cible que la copie-base, coût nul).

---

## 3. Corrections appliquées — récapitulatif par plan

| Plan | Corrections (tracées §7, étiquette « audit corpus Fable, 2026-07-11 ») |
|---|---|
| `plan/00` | back-ref FC-2 (le fil tablée — part socle : rien à modifier à T8, la purge est un geste de `04`, rejoué par le sweep T5) |
| `plan/01` | FC-9 (3 back-refs de confirmation conv 19 : V8 · V12 · V14) |
| `plan/02` | FC-8 (M3 : scopes `micro`/`deep` = aucun outil ; scope sans contrat = tout refus) + back-ref FC-2 (part M8) |
| `plan/03` | FC-1 (P8 : ligne « Tablée → I→V, sans VI » au tableau) |
| `plan/04` | FC-1 (renvoi fantôme corrigé → `technique/03` §4.6 sur Go) + back-ref FC-2 (Q9/Q11 : la branche purge-à-la-clôture) |
| `plan/05` | FC-3 (la clé jamais en `.env`) · FC-4 + FC-7 (puits G-F : indexeur Search · WER LocalDumps · état complet du CLI + magasin MCP Google) · FC-10 (réplica-flux chiffré) |
| `plan/99` | FC-1 (O4 : ligne tablée au tableau + I-O4) · FC-2/4/5/6/7 (checklist §6 : entrées (e)→(i) + recoins écartés-dits + clôture de l'énumération) |

**Note d'écart source — PORTÉE sur Go de Yohann le 2026-07-11** : `technique/03` §4.6 (la ligne tablée au tableau qui-reçoit-quoi source — FC-1 ; tracée `technique/03` §7). *(La seule retouche source de cet audit ; les autres corrections vivent au niveau plan/checklist. Les portages accumulés convs 16→21 restent un bloc distinct, sur Go.)*

---

## 4. La checklist des résidus — close (le mandat « énumération exhaustive »)

Les 4 recoins déjà nommés (`plan/99` §6) sont **vérifiés justes** : **(a)** fils rotés (la fenêtre DITE est la bonne branche pour les fils dyadiques opaques) · **(b)** session de ronde proactive (la génération Q3 est déjà purgée AF-4 ; seule la collecte conditionnelle reste, même patron) · **(c)** `userData` + Crashpad (le remède G-F est complet pour ces canaux, avec FC-7) · **(d)** `logs\` (l'extension AF-10 confirmée nécessaire ; le **drain stdout/stderr du sidecar** rattaché à ce sink). Mes ajouts : **(e)** fil tablée (FC-2) · **(f)** indexeur Search (FC-4) · **(g)** presse-papier (FC-5) · **(h)** toasts (FC-6) · **(i)** état complet du CLI + MCP Google + LocalDumps (FC-7).

**Recoins examinés et écartés, avec leur raison** (l'exhaustivité honnête) : `swapfile.sys` (UWP — n'héberge pas un process Win32/Electron) · Defender/soumission d'échantillons (vise les exécutables) · Event Log / Prefetch / thumbnails / cache DNS (aucun contenu conversationnel plausible) · cache HuggingFace sur `C:\` (poids de modèles publics, pas du contenu — rediriger `HF_HOME` vers `G:\Sophia\models\` reste propre).

**Transversalement** : chaque « jamais / effacé / éphémère » du corpus a été tracé jusqu'aux octets, à tous les réplicas, et à travers restauration/migration/crash — `self_notes` · `warmth_ledger` · `tablee_buffer` + `speakers_session` · gloses · `initiatives`/`tasks` · JSONL · snapshots + étages 2/3 + flux d'effacements + WAL + segments FTS/vec + fichiers de session + caches renderer + verbatim de rêverie + ring buffer/replay RAM. **Aucun autre trou que ceux nommés ci-dessus.**

---

## 5. Non-défauts confirmés (vérifiés, solides)

Le **jardin `self_notes`** (DELETE refusé même via le sas · jamais fouillé · hors cascade — mot à mot `02`⇔`03`, et désormais **structurellement hors du prompt tablée** par la ligne consolidée FC-1) · le **`warmth_ledger`** (« sans brut » structurel, 7 registres identiques partout, hors cascade des deux côtés, rétention ≥ portée « espacé ») · l'**invariant de devenir** (valeur + séparation par construction, récit par le prompt, coquille au pire — l'honnêteté T-3 intacte) · le **store éphémère entier** (exclusion des snapshots par construction, du backup **par le fichier-store**, réconciliation au boot, `speakers_session`, union sur la voiceprint) · la **chaîne AF-1 de bout en bout** (flux non-roté fsync-avant-commit → repère de crue → **fail-safe** au restore → réplication indépendante → fraîcheur **bornée et surveillée** par filigrane dérivé) · la **garde OF1** (allow-list positif fail-closed) · les **3 obligations de `99`** honorées mot pour mot (posture de sécurité honnête O7 · signal de fermeture au cadre O4/AF-9 · vue dérivée/rien de stocké O5) · la **primitive I+II partagée** (identité stricte du persona-jugeant) · toutes les **coutures bilatérales** (`secours_tainted` `00`↔`05` · `guardian_acks`/`backup_selftest` `03`↔`05` · back-refs `03`/`05`↔`99`) · **`pending_ops`** cohérent sur ses 3 kinds à travers 4 plans · **zéro chiffre inventé** · **zéro donnée personnelle** dans les fichiers trackés lus · **les points de ma GRILLE §2 pour `04`/`05`/`99` tous honorés** (AF-3/Q13 · bloc VI/Q9 · injection-collecteurs/Q3 · étages 2/3 · chiffrement exigence pleine · montre des jetons · AF-9/O4 · vue dérivée/O5).

---

## 6. Observations & ce qui reste à trancher avec Yohann

**Points identitaires réservés (non touchés — à écrire ENSEMBLE, séquencés)** : le prompt de consolidation v1 · le banc de dilemmes v1 · les amendements pré-boot du persona · les seuils de tempérament. Rien dans cet audit ne les préempte. Le jeu `context_tag` (7 registres, ACTÉ conv 19) : **structure et sûreté vérifiées** (CHECK fermé = « sans brut » structurel, cohérent partout), non re-décidé.

**Observations (pas des findings)** :
- **O-1** : interaction pagefile-relogé-sur-`G:\` × posture `pin-boot` (volume verrouillé au boot) — triviale en `tpm-auto` (la posture de Yohann), à vérifier si bascule un jour (mécanisme G-F Phase 3).
- **O-2** : la notification vocale (`04` Q5) vit sur le canal A1 → couverte par (a)/M8-4 ; si l'implémentation en faisait une invocation dédiée → patron AF-4.
- **O-3** : `G:\Sophia\scratch\` (F-05-B) absent de la liste des dérivés `.env` de R0 — cosmétique, à ramasser en Phase 3.
- **O-4** : le **prompt de consolidation v1 vivra en git public** — sa rédaction Phase 3 (main de Yohann) doit rester libre de tout personnel (la garde pre-commit veille ; vigilance à garder au moment de l'écrire ENSEMBLE).
- **O-5** : rappel — la question « Python vs Java » (`plan/00` §7, non bloquante) reste à trancher avec Yohann avant de graver la supervision T3.

**Acté, non rouvert (simple rappel de ma 1ʳᵉ passe, toujours valable)** : l'ancre couvre le gravé + le persona installé, pas le cliquet/journal contre une édition hors-système — périmètre décidé en conception.

---

*Audit corpus Fable — intermède final 2026-07-11, entre conv 21 et conv 22. **10 findings (0 BLOQUANT · 2 MAJEUR · 8 MINEUR), zéro faux positif, zéro décision actée rouverte** ; corrections appliquées aux 7 plans sur validation de Yohann, tracées §7 ; 1 note d'écart source (`technique/03` §4.6) **portée sur Go le jour même** (tracée `technique/03` §7) ; la checklist des résidus **close** ((a)→(i) + écartés-dits). **Le corpus des 7 plans est verrouillé — prêt pour l'essai à blanc** (banc audio n°1 : 🔴 wake FR + AEC). Ma 1ʳᵉ passe : `AUDIT-fable.md` (2026-07-10) ; mon œil transmis : `GRILLE-AUDIT-FABLE.md`. Prochain regard sur le corpus : le contact du code lui-même — chaque écart au §7, jamais contourné.*
