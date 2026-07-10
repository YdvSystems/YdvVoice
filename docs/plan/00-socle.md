# 00 — Socle process · Plan d'implémentation · YdvVoice (Sophia)

> **Rôle** : le plan d'exécution de la fondation — ce que le doc technique `00-socle-process.md` décrit *en architecture*, ce plan le décline *en tâches ordonnées + tests + critères*. Premier plan de la **Phase 3**, dans l'ordre des dépendances : le socle précède tout (le pipeline audio `01` s'écrit dessus).
>
> **Source de vérité** : `docs/technique/00-socle-process.md` (acquis). Ce plan **ne rouvre rien** — il traduit. Tout écart découvert au contact du code est porté à la **rubrique 7** *et* renvoyé au `00` §7 concerné, jamais contourné.
>
> **Statut** : ossature validée + **audit croisé 2 agents intégré (conv 14)** — fidélité (FID-1→6) + robustesse (ROB-1→8), **14 findings, zéro faux positif, tous intégrés** ; réconciliation de la récupération et frontière du jeton tracées §7. **+ 3 retouches conv 16** (remontées par le croisé du plan `02`, volet cohérence inter-plans) : **M-1** (`session_state` gagne `current_session_id`, garde `claude_session_id`) · **`foreign_keys=ON`** (T1) · **reset `erase_gate` au boot** (T5, hook `02`) — structure T0→T8 inchangée, tracées §7. **Valeurs chiffrées différées** à la calibration Phase 3 (rubrique 6). Critère de construction : **optimal, pas rapide**.
>
> **Discipline de Phase 3** : « audit avant de figer » devient « **tests avant de committer** ». Aucune tâche n'est « faite » sans son test vert. Les essais tournent sur **base jetable** (CF2) — rien de persona-portant ici ; le premier boot identitaire (la cérémonie) est un jalon distinct, bien plus tard.

---

## 1. Objectif & ce que le socle prouve

Bâtir la **fondation process** sur laquelle toutes les couches s'écrivent : deux moteurs (orchestrateur Electron/Node ↔ sidecar Python), **un** canal IPC, **un** fichier de vérité (SQLite WAL), un **gouverneur** unique, un **boot/arrêt** robustes, une **durabilité** anti-coupure.

**Ce qu'il doit prouver** (les preuves conditionnent tout le reste) :
- Il **redémarre seul** (sidecar tué → respawn ; app dégradée sans planter).
- Il **survit à une coupure dure** sans corruption (au pire l'unité de travail en cours rejouée) — **et sait restaurer** un snapshot quand la base est structurellement corrompue.
- Il **arbitre le fond** avec **priorité interactive absolue** et un budget « part de Sophia » borné.
- Il **sait mourir proprement** (arrêt gracieux, drapeau propre) et **se réveiller honnêtement** (distinguer arrêt propre / coupure).
- Il **ne grave jamais une identité douteuse** : jamais en secours, jamais de rollback sémantique silencieux (la restauration sémantique = la main de Yohann, A15).

**Ce que ce plan ne couvre PAS** (couches aval) : le chemin audio et ses réflexes → `01` ; les tables métier (faits, persona, lien) → `02`/`03` ; la mécanique de chauffe des modèles, le ladder résilience/coût **et la montre des jetons OAuth (401)** → `05` ; la **sauvegarde 3 étages hors-machine** (prérequis du premier boot) → `05` — **distincte** des snapshots locaux de T4, à ne pas confondre.

---

## 2. Prérequis

- **Toolchain** : Node 24.13 · Python 3.14 (versions du RELAY-conv14 ; à confirmer disponibles sur la machine).
- **`SOPHIA_HOME` sur `G:\`** : disque dédié (base, snapshots, audit, logs). Au socle, on peut travailler sur un `SOPHIA_HOME` **jetable** (bancs de test) ; le `G:\` de production suit.
- **Sécurité repo public** : `.gitignore` blindé + hook `pre-commit` gitleaks **actif** + garde de contenu (aucun `portrait*`/`temoignage*`/`docs/prive/`, aucun secret) — à vérifier avant tout commit de code.
- **Casque / micro proche** : pour le banc audio (`01`), pas nécessaire au socle.

**Arborescence de travail (indicative — non figée, CLAUDE.md ; adaptable au contact du code)** : le code vit à la racine du repo `e:\YdvVoice`, à côté de `docs/`.

```
e:\YdvVoice\
├── package.json            # orchestrateur Node/Electron
├── electron/               # main + preload (contextIsolation)
├── src/
│   └── orchestrator/       # le cœur — « Sophia vit ici »
│       ├── ipc/            # client WS + surface REST santé/debug (T2)
│       ├── supervisor/     # spawn + supervision sidecar (T3)
│       ├── db/             # WAL, tables socle, durabilité, snapshots, restauration (T1, T4)
│       ├── boot/           # machine à états de boot + récupération (T5)
│       ├── shutdown/       # arrêt gracieux (T6)
│       ├── governor/       # machine à états + budget + tâches de fond (T7)
│       ├── claude/         # canal claude -p, session_state (T8)
│       └── audit/          # JSONL append-only
├── sidecar/                # Python — serveur WS/REST (squelette ; l'audio vient en 01)
│   ├── server.py
│   └── requirements.txt
├── db/schema-00.sql        # les 4 tables socle
└── tests/                  # unitaires + intégration
```

---

## 3. Tâches séquentielles

> Ordre = dépendances internes du socle. Chaque tâche : **But · Contenu · Fichiers (indicatifs) · Dépend de · Fait quand** (def-de-« fait » observable, adossée à son test — rubrique 4). Les valeurs (X, N, K…) restent **ouvertes** (rubrique 6).

### T0 — Échafaudage
- **But** : un projet bi-runtime qui démarre et un sidecar qu'on peut lancer.
- **Contenu** : init `package.json` (Electron/Node) · squelette `sidecar/` (Python + `requirements.txt`) · `.gitignore` + hook gitleaks + `.env.example` (zéro valeur) · dossiers de l'arborescence · script de lancement dev.
- **Fichiers** : `package.json`, `electron/main`, `sidecar/server.py`, `.gitignore`, `.githooks/pre-commit`, `.env.example`.
- **Dépend de** : —
- **Fait quand** : l'app Electron s'ouvre (fenêtre/systray minimal) ; le sidecar se lance à la main et répond `GET /health` ; `git commit` déclenche gitleaks. *(Test U-T0.)*

### T1 — WAL unique + écrivain unique
- **But** : la vérité partagée, un seul stylo.
- **Contenu** : ouvrir SQLite en **mode WAL** · `db/schema-00.sql` = les 4 tables socle `governor_watermarks` · `governor_budget_ledger` · `session_state` · `runtime_flags` (colonnes selon `00` §3) · **écrivain unique = orchestrateur** (F2 : le sidecar n'a **aucune** poignée d'écriture) · **`PRAGMA foreign_keys=ON`** à la connexion d'écriture (**retouche conv 16** : sans lui, les FK des couches `02`/`03` seraient purement documentaires — SQLite le laisse OFF par défaut ; §7) · **`session_state` gagne `current_session_id`** (**colonne dans `schema-00`** — définition socle de `session_state` — **nullable, sans FK**, donc **présente dès le socle-seul** ; **cible `sessions` déclarée en `schema-02`** ; **NULL/inutilisée tant que `02` n'existe pas** — #4 croisé conv 16 ; le socle **garde** `claude_session_id`, dont il reste propriétaire pour `--resume`, et `sessions` (02) **cesse de le dupliquer** — **M-1 réorienté conv 16**, §7) · `busy_timeout` en ceinture.
- **Fichiers** : `src/orchestrator/db/`, `db/schema-00.sql`.
- **Dépend de** : T0.
- **Fait quand** : les 4 tables sont créées à l'init si absentes ; un aller-retour écriture→lecture passe ; une tentative d'écriture côté sidecar est **impossible par construction** (pas de handle) ; **`foreign_keys=ON` actif** sur la connexion d'écriture (une violation de FK est refusée) ; `session_state.current_session_id` **présent et nullable** (NULL au temps socle-seul). *(U-T1.)*

### T2 — Canal IPC
- **But** : les deux moteurs se parlent, sans jamais faire transiter l'audio.
- **Contenu** : le **sidecar héberge** WS localhost (port **passé au spawn**) + **surface REST minimale réservée santé/debug** : `GET /health` (vivant + prêt) **+ un endpoint debug** (sonder le socle sans client WS, `curl`) · enveloppe `{ type, id, ts, payload }` (`ts` = émission, monotone) · familles `cmd.*` (↓) / `evt.*` (↑) ; **la famille `evt.*` est extensible** (un nouveau type d'événement ne change pas le protocole) · squelette des types socle (`cmd.shutdown`, `cmd.enroll.push` réservé, `evt.health`) · **l'audio ne traverse jamais le canal** (invariant).
- **Fichiers** : `src/orchestrator/ipc/`, `sidecar/server.py`.
- **Dépend de** : T0.
- **Fait quand** : un `cmd.*` → `evt.*` fait l'aller-retour corrélé par `id` ; `curl /health` répond, l'endpoint debug aussi ; un nouveau type d'`evt.*` ne casse pas le protocole (extensibilité prouvée) ; le WS/REST **bind sur `127.0.0.1` uniquement** (invariant localhost). *(U-T2, I-1.)*

### T3 — Supervision du sidecar
- **But** : le sidecar ne meurt jamais pour de bon, et un figé est détecté.
- **Contenu** : **spawn** (port libre dynamique + **retry TOCTOU** si le port est volé, `windowsHide`, **drain stdout/stderr**, **hygiène d'env** — neutraliser les `PYTHON*` injecteurs) · **readiness** (poll léger, sortie anticipée si le process meurt tôt) · **santé 2 niveaux** (sortie de process **+ battement** → attrape le figé-mais-vivant) · **redémarrage** (backoff exponentiel plafonné · **disjoncteur** après K échecs → `DÉGRADÉ_SANS_VOIX` + notif systray · transitoires → self-heal) · **orphelins** (pidfile `<pidSidecar> <pidProprio>` ; tuer **seulement si** propriétaire mort **ET** PID vivant **ET** bon exécutable — **garde anti-recyclage de PID**) · modèle **respawn déterministe** (re-attach = différé Phase 3).
- **Fichiers** : `src/orchestrator/supervisor/`.
- **Dépend de** : T2.
- **Fait quand** : kill du sidecar → respawn supervisé (< X, valeur en §6) ; sidecar figé (bloque le battement) → détecté et redémarré ; un orphelin d'un run précédent est tué au boot **sans** tuer un PID recyclé innocent. *(U-T3, I-2.)*

### T4 — Durabilité & récupération
- **But** : une coupure de courant en pleine écriture ne corrompt jamais la base — et une base structurellement corrompue est **restaurable**.
- **Contenu** : `synchronous=FULL` **autour des écritures d'identité** / `NORMAL` pour le trafic fréquent · **snapshot `VACUUM INTO`** (temp → fsync → **renommage atomique**, rotation **garder N**) — un snapshot n'existe pas pour dormir : il **sert à restaurer** (chemin en T5) · **audit JSONL append-only** (le lecteur **tolère une dernière ligne tronquée** ; rotation taille/âge ; **invariant AF-10, audit Fable : le JSONL ne porte JAMAIS de contenu conversationnel** — traces, compteurs, coûts, événements, zéro verbatim : le fichier est append-only, roté, **hors de portée de l'effacement souverain** — un contenu qui y fuirait serait un résidu ineffaçable) · **flux d'effacements dédié append-only JAMAIS roté (croisé Opus conv 18, F1)** : les enregistrements d'effacement (`erasures` — horodatage + compteurs, **zéro contenu**, même invariant AF-10) vivent dans un flux **exempté de la rotation taille/âge** (fichier dédié / partition non-rotée) — c'est le **témoin hors-base de l'alerte-à-la-restauration** (T5), fsync **avant** le commit de la transaction d'effacement (`plan/02` M8-5), à **répliquer hors-machine indépendamment** (couture `plan/05` — sinon une restauration-catastrophe l'emporte avec la base) · intégrité : **`quick_check` au boot**, **`integrity_check` au dimanche** (greffé health-check) · le **chemin de récupération = le chemin de boot** (T5), **restauration comprise**.
- **Fichiers** : `src/orchestrator/db/`, `src/orchestrator/audit/`.
- **Dépend de** : T1.
- **Fait quand** : le « dernier snapshot » est toujours une base **complète et ouvrable** ; une coupure *pendant* la création du snapshot laisse le précédent intact (renommage atomique) ; une ligne d'audit tronquée est ignorée sans crash ; `quick_check` est disponible pour le boot. *(U-T4, I-3, I-9.)* — **Rappel** : la **sauvegarde 3 étages hors-machine** (copie off-site, prérequis du premier boot) est **doc `05`**, pas ici.

### T5 — Boot & récupération
- **But** : un réveil sûr, dégradé plutôt que tout-ou-rien, idempotent — et une identité douteuse jamais réparée en douce.
- **Contenu** : machine à états `BOOTING→DB_OK→IDENTITÉ_OK→CŒUR_OK→PRÊT` + **états dégradés de 1re classe** `DÉGRADÉ_SANS_VOIX` / `DÉGRADÉ_SANS_ÉCRITURE` / `DÉGRADÉ_SANS_IDENTITÉ` (**`DÉGRADÉ_SANS_ÉCRITURE` est atteignable AUSSI au runtime, pas qu'au boot : l'ancre d'identité de `03` P1, avant l'étage 5 / au dimanche, y fait basculer l'app depuis PRÊT + alerte persistante jusqu'à la main de Yohann — retouche remontée par le croisé de `plan/03`, conv 17, cf. `plan/03` §7**) · **Phase 0** instance unique (focus + sortie ; récupération d'un **primaire figé**, sonde `process.kill(pid,0)`) · **Phase 1** DB + intégrité + **réveil propre/sale** (lire l'ancien `runtime_flags.running` **avant** de l'écraser ; poser `running=true` en commit durable **avant** toute écriture d'identité ; **reset des gardes d'immutabilité mémoire** — hook réalisé par `02` : `erase_gate.open=0` **inconditionnel + assertion**, filet contre une garde **persistée ouverte** qui déverrouillerait tout en silence, posé **avant toute écriture** — **B-α conv 16**, **no-op au temps socle-seul** (table `02` absente), §7) — **branche de récupération** : intégrité KO **structurelle → restauration auto du dernier bon snapshot** (T4, mécanique) ; corruption **ambiguë ou sémantique → `DÉGRADÉ_SANS_ÉCRITURE` + la restauration est la décision de Yohann (A15), signalée systray + voix — jamais de rollback sémantique silencieux** ; **à TOUTE restauration de snapshot (AF-1, audit Fable)** : comparer les entrées d'effacement (`erasures`) du **flux d'effacements dédié** (append-only **non roté**, T4 — qui survit hors base ; croisé Opus conv 18 F1 : **pas** le JSONL général, qui rote et pourrait avoir jeté le témoin) — à la date du snapshot restauré → des effacements postérieurs ⇒ **alerte honnête à Yohann** (« un effacement est peut-être revenu — redis-moi quoi oublier »), **jamais un retour en douce du contenu effacé** (le remède amont — snapshot frais + purge des antérieurs à chaque effacement — vit en `02` M8-6) · **Phase 2** nettoyage orphelins (T3) **+ sweep des opérations différées `pending_ops`** (`plan/02` M0 p6 — chaque ligne `due` rejoue son op : **fichiers de session** marqués « purge due » [micro/deep/rêverie + fil M8-4, pattern T8, AF-4] **ET le remède stockage post-effacement** [`storage-scrub` : snapshot frais + purge des antérieurs + checkpoint WAL — croisé Opus conv 18 F2] ; **multi-lignes, idempotent** ; hook réalisé par `02`, **no-op au temps socle-seul** ; **+ le store éphémère `tablee-buffer` de `04` (croisé ciblé conv 19 G2/G4)** : le sweep rejoue les marques **`purge-ephemeral`** (attacher le store → DELETE + `secure_delete` + **`wal_checkpoint(TRUNCATE)`** → lever ; no-op si la cible/le store est absent) **ET RÉCONCILIE le store au boot** — n'ayant **aucun snapshot** (jamais restauré), il **survit** à une restauration de la vérité (qui rembobine la base) → **purger (`secure_delete` + checkpoint) toute ligne dont le `session_id` n'a pas de session ouverte dans `main.sessions`** (orphelins) ; store absent/corrompu → **recréé vide** (jamais la branche de restauration vérité ; perte du tampon en vol assumée, « jour sacrifié »)) · **Phase 3** **hook load/verify identité** (invoqué ici — vérifier que le gravé n'a pas bougé ; **contenu défini en `03`** → au socle, seul le hook + `DÉGRADÉ_SANS_IDENTITÉ` si persona absent) · **Phase 4** cœur — **gouverneur + canal Claude invoqués ici via leurs interfaces, bâtis en T7/T8** (testé d'abord sur **stubs** ; intégration réelle prouvée à I-7/I-8) ; le gouverneur **reconstruit sa file depuis les marques et une consolidation due est *programmée*, pas lancée** ; + cost-guard + audit · **Phase 5** spawn + supervision sidecar (+ hooks `cmd.enroll.push` / prewarm / politique de modèles / **`cmd.tts.cache`** — pré-synthèse des phrases de secours, F7/B2 — **invoqués mais définis en `01`/`05`**) · **Phase 6** prêt (systray, health-check) · **idempotent** (rejeu sûr d'un crash en plein boot).
- **Fichiers** : `src/orchestrator/boot/`.
- **Dépend de** : T1, T3, T4 (+ interfaces stubbables de T7/T8 pour la Phase 4).
- **Fait quand** : boot complet → `PRÊT` ; sidecar mort au boot → app **vivante** en `DÉGRADÉ_SANS_VOIX` + voyant ; persona absent → `DÉGRADÉ_SANS_IDENTITÉ` (assertion dédiée) ; base structurellement corrompue → **restauration snapshot puis service repris** ; corruption sémantique → `DÉGRADÉ_SANS_ÉCRITURE` + main de Yohann, jamais de réparation silencieuse ; 2ᵉ instance → focus + sortie ; **crash à n'importe quelle phase du boot → rejeu sûr au boot suivant** (verrou + nettoyage + porte d'intégrité). *(U-T5, I-4, I-5, I-10, I-11.)*

### T6 — Arrêt propre
- **But** : le « bonne nuit » — mourir vite et proprement.
- **Contenu** : signal d'extinction Windows → `cmd.shutdown` (WS) au sidecar → le sidecar **libère CUDA proprement** + flush → **attente brève** → **SIGTERM** → escalade **SIGKILL** → flush mémoire → **`running=false` (« propre »)** → retire le pidfile · **pas de snapshot à l'arrêt** (rapide) · un arrêt **forcé** = traité comme une **coupure** (T4).
- **Fichiers** : `src/orchestrator/shutdown/`.
- **Dépend de** : T2, T5.
- **Fait quand** : arrêt normal → drapeau « propre » posé → **réveil sans fausse alarme** « on a été coupés » ; la libération GPU gracieuse réduit le risque de process GPU figé (sans l'éliminer — cf. §6 🔴). *(U-T6, I-6.)*

### T7 — Gouverneur unique
- **But** : un seul chef arbitre tout le fond, l'usage interactif prime toujours.
- **Contenu** : machine à états `INTERACTIF / REPOS / FOND_EN_COURS / BRIDÉ` + **calques `SECOURS` et `JEU` honorés** (posés par `05`, pas détectés ici ; le doc `00` §2.2 les liste — **SECOURS** : différer l'écriture d'identité — les tâches `requires_real_brain` ne tournent pas — + router vers le repli ; **JEU** : effets définis en `05`) · **détection d'activité** (`active-win`/`pslist`) **exposée comme couture injectable** (test déterministe, indépendant du focus OS réel) · **priorité interactive absolue** (Yohann ou Claude Code actif → tout le fond différé) · **budget « part de Sophia »** (mesuré en **appels autonomes par fenêtre glissante** ; l'usage interactif **jamais compté** ; **chaque appel tagué par origine** ; **contre-pression 429** immédiate, bat le compteur souple) · **file de tâches de fond** priorisées (politique nocturne/diurne = **paramètres**, pas composants) · **vie d'une tâche de fond** (unités découpées → **commit métier + curseur dans la MÊME transaction** → préemption interactive : **céder après l'unité en cours** → l'unité finale lève « dû » → rattrapage **au curseur**, backlog borné multi-jours) · le cost-guard **monétaire** (barreau payant) est un compteur **distinct** (`05`).
- **Fichiers** : `src/orchestrator/governor/`.
- **Dépend de** : T1. *(Intégré au boot en T5 Phase 4 via son interface — stub d'abord, réel prouvé à I-7.)*
- **Note d'ordonnancement** : le gouverneur gouverne des tâches de fond dont les **vraies** (consolidation `02`, proactif `04`) n'existent pas encore → **testé ici via un harnais de tâche factice** (unité découpée simulée, tag d'origine, drapeau `requires_real_brain`). Pas de MVP : la mécanique est complète ; seuls ses clients arrivent plus tard.
- **Fait quand** : un **signal d'activité simulé** (fenêtre active / process Claude Code) fait entrer le gouverneur en `INTERACTIF` et **préempte une tâche de fond après l'unité en cours** (jamais au milieu) ; budget de fenêtre épuisé → `BRIDÉ` (arrêt propre + rattrapage) ; **N appels interactifs → compteur autonome inchangé**, N autonomes → décrémenté ; signal 429 → throttle immédiat ; **calque SECOURS posé → une unité `requires_real_brain` est différée, pas exécutée** ; rattrapage reprend **au curseur**, jamais à zéro. *(U-T7, I-7.)*

### T8 — Canal Claude Code (part socle)
- **But** : le « téléphone » vers le cerveau, gardé chaud, jamais via une clé.
- **Contenu** : init du canal **`claude -p` OAuth** (token Max ; **jamais `--bare`** — A1) · `session_state` (`claude_session_id`, durable — **le socle en reste propriétaire** ; le pointeur `current_session_id`→`sessions.id` est ajouté en `schema-02` et renseigné par `02`, M-1 conv 16) · **`--resume <id>`** au crash (recharge le fil) · **rotation** du session-id sur « nouvelle conversation ». *(La **montre des jetons OAuth** — détection 401, alerte, renouvellement qui reste un **geste de Yohann** — appartient au doc `05` §2.4, **pas au socle** ; ne pas la dupliquer ici.)*
- **Fichiers** : `src/orchestrator/claude/`.
- **Dépend de** : T1. *(Intégré au boot en T5 Phase 4 via son interface — stub d'abord, réel prouvé à I-8.)*
- **Fait quand** : une session chaude persiste dans `session_state` ; après un crash simulé, `--resume` recharge le fil (au lieu de repartir de zéro) ; « nouvelle conversation » fait tourner le session-id. *(U-T8, I-8.)* — **Honnêteté** : le plancher cloud TTFT reste (masqué en ressenti, pas annulé) ; jusqu'où `--resume` recharge = preuve §6.

---

## 4. Tests

> Règle : **aucune tâche « faite » sans son test vert** ; les tests d'intégration prouvent l'assemblage. Les seuils temporels (< X) sont des **cibles à calibrer** (§6) — le test vérifie d'abord le **comportement**, la valeur se fixe ensuite.

**Unitaires (par tâche)** :
- **U-T0** lancement app + sidecar + gitleaks.
- **U-T1** tables + round-trip + interdit d'écriture sidecar + **`foreign_keys=ON` (violation FK refusée)** + **`session_state.current_session_id` nullable** (M-1/conv 16).
- **U-T2** aller-retour corrélé + `/health` + **endpoint debug** + extensibilité `evt.*` + **bind `127.0.0.1` seul (une connexion non-loopback est refusée)**.
- **U-T3** respawn + détection figé + garde anti-recyclage PID.
- **U-T4** snapshot ouvrable + **rotations (snapshot garder N · audit taille/âge)** + audit tronqué toléré + `quick_check` + **assertion « zéro contenu conversationnel » sur le JSONL (AF-10)** + **flux d'effacements dédié présent et EXEMPTÉ de rotation (croisé Opus conv 18 F1)**.
- **U-T5** transitions de boot + états dégradés + réveil propre/sale + **assertion dédiée `DÉGRADÉ_SANS_IDENTITÉ`** + **la consolidation due est programmée, pas lancée** + **hook reset des gardes d'immutabilité mémoire invoqué avant écriture** (no-op au temps socle-seul ; réel prouvé en `02`/U-M0-p1 — B-α conv 16) + **hook sweep des purges dues invoqué en Phase 2** (no-op au temps socle-seul ; réel prouvé en `02`/U-M4/U-M8 — AF-4) + **le sweep `pending_ops` couvre AUSSI le `storage-scrub` dû, pas que les fichiers de session (croisé Opus conv 18 F2)** + **couvre `purge-ephemeral` (attache le store éphémère de `04` → DELETE+`secure_delete`+`wal_checkpoint`) ET réconcilie le store au boot (purge des orphelins post-restauration) — croisé ciblé conv 19 G2/G4**.
- **U-T6** drapeau propre + libération GPU.
- **U-T7** préemption par unité + `BRIDÉ` + throttle 429 + rattrapage au curseur + **détection d'activité injectée → INTERACTIF** + **budget : interactif jamais compté** + **calque SECOURS → tâche `requires_real_brain` différée**.
- **U-T8** session chaude + `--resume` + rotation.

**Intégration (transverses)** :
- **I-1** canal bout-en-bout orchestrateur↔sidecar sous charge légère.
- **I-2** kill sidecar en cours de route → respawn supervisé, zéro perte d'état durable.
- **I-3** **coupure dure simulée** (kill -9 machine/process en pleine écriture) → au reboot : base **cohérente**, au pire l'unité en cours rejouée.
- **I-4** boot dégradé (sidecar absent) → app vivante + voyant.
- **I-5** 2ᵉ instance → focus + sortie ; primaire figé → récupéré.
- **I-6** arrêt normal → réveil **sans** fausse alarme.
- **I-7** préemption interactive d'une tâche de fond (harnais factice) → cède après l'unité, rattrape au curseur.
- **I-8** crash mid-« conversation » (harnais) → `--resume` du fil, continuité tenue.
- **I-9** coupure *pendant* la création d'un snapshot → le snapshot précédent reste intact et ouvrable (renommage atomique éprouvé).
- **I-10** **base structurellement corrompue** → au boot, **restauration auto du dernier bon snapshot** → service repris ; corruption **sémantique/ambiguë** → `DÉGRADÉ_SANS_ÉCRITURE` + attente de la main de Yohann, **aucun rollback sémantique silencieux** ; **restauration d'un snapshot antérieur à un effacement (simulé via le flux d'effacements dédié) → alerte « un effacement est peut-être revenu », jamais silencieux (AF-1)** ; **le témoin lu = le flux dédié non-roté (pas le JSONL rotable), et un crash pendant le remède stockage est rejoué au boot par `pending_ops` (croisé Opus conv 18 F1/F2)**.
- **I-11** **crash injecté à chaque phase du boot** → au reboot, rejeu sûr (verrou + nettoyage + porte d'intégrité), pas de double-effet (idempotence).
- **I-12** `integrity_check` du dimanche déclenché via une **couture d'horloge** (planification hebdomadaire vérifiée sans attendre un vrai dimanche).

---

## 5. Critères d'acceptation

> **Pointés vers `00` §6 — la source, jamais réinventés.** Mapping critère → tâche/test qui le prouve. *(Les invariants de `00` §5 — écrivain unique, localhost-only, atomicité, jamais-en-secours, jamais-de-rollback-sémantique-silencieux/A15 — sont ancrés dans les tâches T1/T2/T4/T5/T7 et leurs tests U/I ci-dessus.)*

1. Sidecar **redémarre seul** après kill (< X), **zéro perte d'état durable** → T3 / I-2.
2. **Coupure dure en pleine consolidation** → base cohérente, au pire l'unité rejouée, **zéro corruption** ; **corruption structurelle → restauration snapshot** → T4/T5/T7 / I-3, I-10.
3. **Arrêt normal** → drapeau « propre » → réveil **sans** fausse alarme → T6 / I-6.
4. **Sidecar figé** détecté par battement (< X) et redémarré → T3 / U-T3.
5. **Budget respecté** (interactif jamais compté) ; **throttle réactif** sur 429 → T7 / U-T7.
6. **Boot dégradé** correct (sidecar mort → app vivante + voyant ; mémoire douteuse → écriture suspendue + signalé ; persona absent → `DÉGRADÉ_SANS_IDENTITÉ`) → T5 / I-4.
7. **2ᵉ instance** → focus + sortie ; **primaire figé** récupéré → T5 / I-5.
8. **Crash mid-conversation** → `--resume` (sinon session fraîche + résumé N derniers échanges, A13 — filet couche `02`) ; continuité tenue → T8 / I-8.

---

## 6. Preuves de calibration Phase 3

> Ce qui **ne se sait qu'en mesurant** (les valeurs laissées ouvertes ci-dessus). Depuis `00` §7. **Zéro chiffre inventé.**

- **🔴 Tuer dur un process GPU figé** — un contexte CUDA bloqué peut **résister à `TerminateProcess`**. À **prouver** qu'on sait le tuer dur ; sinon fallback (kill driver / redémarrage plus large). **Point de jonction** supervision (T3) + arrêt (T6) + nettoyage orphelin (T5). *La preuve la plus critique du socle.*
- **Test « débrancher pour de vrai »** en pleine écriture (au-delà du kill de process) — valide T4 sur du vrai matériel.
- **IPC** : WebSocket sous charge tenable · **latence loopback**.
- **Supervision** : courbe de backoff · intervalle + seuil de battements manqués · **K** du disjoncteur · délai de respawn (le « X » du critère 1) · récupération du primaire figé.
- **Durabilité** : coût de `synchronous=FULL` · timing `quick_check` vs `integrity_check` · **N** snapshots gardés · seuils de rotation de l'audit (taille/âge).
- **Budget/gouverneur** : tailles de fenêtres · **N** appels autonomes · **signal exact de throttling** que Claude Code expose (429 ? message ? sortie CLI ?) — lié FM2/FM4.
- **Session chaude** : `--resume` survit-il au crash, **jusqu'où** recharge-t-il, durée tenable du process (A36).
- **Boot** : fenêtre de temps que Windows accorde à l'app à l'extinction (le « X » de l'arrêt).

---

## 7. Journal des écarts (code ↔ `00`)

> Tout écart découvert au contact du code est **inscrit ici ET renvoyé au `00` §7**, jamais contourné en silence.

- **[À clarifier — non bloquant]** `00` §7 (Supervision) liste « spawn **Python vs Java** ». Il n'y a **pas de Java** dans Sophia (orchestrateur Node, sidecar Python) — « Java » semble un résidu de l'**idiome interne éprouvé** d'un projet support (`00` §4.3 s'y réfère). *Question ouverte* : coquille, ou référence au patron de spawn prouvé ailleurs à reporter en Node/Python ? À trancher avec Yohann avant de graver la supervision (T3) ; sans impact sur la structure du plan.

- **[Réconciliation actée — audit croisé conv 14, FID-1 + ROB-1]** `00` énonce la récupération à **deux endroits** : §4.1 Phase 1 (« intégrité KO → `DÉGRADÉ_SANS_ÉCRITURE` ») et §Durabilité garantie 6 (« restauration snapshot — **auto pour le structurel, la main de Yohann pour le sémantique**, A15 »). Le plan les **compose fidèlement** en T5 Phase 1 : *structurel → restauration auto ; sémantique/ambigu → `DÉGRADÉ_SANS_ÉCRITURE` + Yohann, jamais de rollback silencieux*. Pas une contradiction de la source — une explicitation de sa composition. Renvoi `00` §7 : signaler que la formulation des deux passages gagnerait à nommer explicitement la bifurcation structurel/sémantique.

- **[Frontière tracée — audit croisé conv 14, FID-2]** La **montre des jetons OAuth (401)** a été **retirée du socle** (v1 la plaçait à tort en T8) et **renvoyée au doc `05` §2.4**, seul propriétaire (le renouvellement y est un geste de Yohann, pas un auto-renouvellement). Le socle garde uniquement : init du canal + `session_state` + `--resume` + rotation.

- **[Cohérence socle↔audio — remontée par l'audit du plan `01`, conv 14]** T5 Phase 5 nomme désormais `cmd.tts.cache` (pré-synthèse F7/B2) ; T7 nomme le calque **JEU** (doc `00` §2.2, oublié à la 1re gravure) — deux trous du socle attrapés par le croisé inter-plans.
- **[Note d'audit]** Audit croisé 2 agents conv 14 (fidélité FID-1→6 · robustesse ROB-1→8) : **14 findings, zéro faux positif, tous intégrés**. Non-défauts confirmés : zéro chiffre inventé · 8 critères de `00` §6 tous repris · 🔴 GPU-figé correctement gardé en preuve (pas un critère) · aucune facilité.

- **[Retouche socle ← croisé du plan `02`, conv 16 — M-1 `session_state`↔`sessions`]** le croisé du plan mémoire a **confirmé une duplication** : `claude_session_id` vivait à la fois dans `session_state` (socle, `00` §3 / T1) et dans `sessions` (02). **Résolu sans inverser la stratification** (le socle est bâti/testé **seul, avant `02`** — U-T8) : le socle **garde** `claude_session_id` (propriétaire du fil chaud pour `--resume`), **gagne le pointeur `current_session_id`→`sessions.id`** (T1 — **colonne en `schema-00`**, nullable, sans FK, **présente dès le socle-seul** ; **cible `sessions` en `schema-02`** ; NULL au temps socle — #4 croisé conv 16) ; c'est **`sessions` (02) qui cesse de dupliquer**. Cohérent avec `05` §4.1/AT2 (qui pose déjà une colonne de cycle-de-vie du fil sur `session_state`). **Renvoi `technique/00` §3** (schéma `session_state`).
- **[Retouche socle ← croisé du plan `02`, conv 16 — `PRAGMA foreign_keys=ON`]** ni `plan/00` T1 ni `technique/00` §3 ne stipulaient le PRAGMA (défaut SQLite = OFF → FK décoratives). **Activé à la connexion d'écriture** (T1) : les FK des couches `02`/`03` deviennent réelles. Conséquence côté `02` : M8 (effacement) **ordonne ses suppressions enfant→parent** (un tour servant de `basis` traité avant sa suppression). **Renvoi `technique/00` §3.**
- **[Retouche socle ← croisé du plan `02`, conv 16 — reset `erase_gate` au boot, B-α]** défense en profondeur pour l'immutabilité mémoire : le boot (T5 Phase 1) **force `erase_gate.open=0` + assertion, avant toute écriture**, filet contre une garde persistée ouverte (qui déverrouillerait `conversations`/`chronicle`/tables `03` en silence). **Hook réalisé par `02`** (comme le hook identité de la Phase 3), **no-op au temps socle-seul**. **Renvoi `technique/00` §4.1** (séquence de boot).
- **[Note d'audit conv 16]** Ces 3 retouches viennent du **croisé 2 agents du plan `02`** (20 findings, zéro faux positif — 11ᵉ croisé consécutif), volet cohérence inter-plans, comme le croisé conv 14 avait corrigé le socle depuis l'audio. **Aucune ne change la structure T0→T8** ; toutes tracées + renvoyées à `technique/00` §7.

- **[Retouches ← AUDIT FABLE (intermède, 2026-07-10) — validées par Yohann]** trois retouches du socle issues de l'audit complet des 4 plans (mandat `PASSATION-audit-fable.md`), **aucune ne change la structure T0→T8** : **AF-1 (part socle du BLOQUANT effacement × stockage)** — T5 : à toute restauration de snapshot, comparaison des `erasures` du JSONL (hors base, survit) à la date du snapshot → **alerte honnête si un effacement est postérieur** (le contenu effacé ne ressuscite jamais en douce ; le remède amont — snapshot frais + purge des antérieurs — vit en `02` M8-6) + test I-10 ; **renvoi `technique/00` §Durabilité** (les snapshots/rotation ignoraient l'effacement souverain — trou de la source, à noter §7 sur Go) · **AF-4** — T5 Phase 2 : **hook sweep des purges dues** (fichiers de session marqués, pattern T8 rêverie généralisé — réalisé par `02`/`03`, no-op au temps socle-seul) · **AF-10** — T4 : invariant **« le JSONL d'audit ne porte jamais de contenu conversationnel »** + assertion U-T4 (le JSONL est hors de portée de l'effacement — un contenu qui y fuirait serait ineffaçable). *(Synthèse complète : `docs/journal/audits/AUDIT-fable.md`.)*

- **[Retouches ← croisé Opus conv 18 (classe « stockage », sur le correctif AF-1) — validées par Yohann]** le croisé ciblé (2 agents Opus, 5 findings, zéro faux positif) a trouvé des arêtes résiduelles **dans le correctif AF-1** ; part socle (**aucune ne change T0→T8**) : **T4** — un **flux d'effacements dédié append-only JAMAIS roté** (le JSONL général rote par taille/âge → il pouvait **jeter le témoin** de l'alerte ; F1) ; **T5 Phase 1** — l'alerte-à-la-restauration lit **ce flux dédié** (pas le JSONL rotable) ; **T5 Phase 2** — le sweep balaie les **`pending_ops`** (`plan/02` M0 p6) : **fichiers de session (AF-4)** ET le **remède stockage `storage-scrub`** (M8-6, hors-transaction, reçoit le patron classe-4 AF-4 ; F2). **Renvoi `technique/00` §Durabilité** (les snapshots/le JSONL ignoraient l'effacement souverain + la fiabilité de son témoin — sur Go). *(Détail complet : `plan/02` §7 + `docs/journal/audits/AUDIT-fable.md`.)*

- **[Retouche socle ← croisé de `plan/04` (conv 19, C1/Voie 1) — validée par Yohann]** le **`tablee_buffer`** (verbatim des tiers, `plan/04` Q0/§3.5) vit dans un **magasin éphémère À PART** (base attachée `G:\Sophia\db\tablee-buffer`, **propre WAL** pour survivre à un crash), **EXCLU des snapshots `VACUUM INTO`** (mono-base) → « le verbatim des tiers ne survit à aucun scénario » (A31) vrai **par construction** pour les snapshots. **OBLIGATION gravée sur `plan/05` (G1, croisé ciblé conv 19)** : la sauvegarde hors-machine DOIT l'exclure (dériver des snapshots, ou exclure `tablee-buffer*`) — sinon un `rsync G:\` recapture le verbatim. **Correctif G4** : à une restauration de la vérité, le store **SURVIT** (jamais restauré) — il n'est **pas** « perdu », il faut le **réconcilier au boot** (purge des orphelins vs `main.sessions`, T5 Phase 2) ; ma 1ʳᵉ note « perte assumée par le jour sacrifié » était **à l'envers**, corrigée. **Précision de l'invariant « un seul fichier de vérité »** : il couvre le **durable** (mémoire/identité/état) ; ce **store des non-durables par session** (le `tablee_buffer` **+** les `voiceprint` `consent=session`, C2-bis) est légitimement séparé — pas une seconde vérité. **Aucune retouche de la structure T0→T8** ; l'effacement du tampon est coordonné à M8 par `pending_ops` (`plan/04` Q13, patron AF-4 déjà au socle T5 Phase 2) ; son `session_id` = **pointeur mou non-FK** (une FK ne traverse pas deux bases). **Mécanisme neuf** (store séparé + coordination cross-store) → **croisé CIBLÉ conv 19 FAIT (9 findings G1–G9 intégrés)** ; re-vérif finale à l'audit pré-code (GRILLE classes 1/4/5/**6**). **Renvoi `technique/00` §Durabilité / §3** (sur Go).

---

*Plan 00 — Socle process. Traduit `00-socle-process.md` (A33–A34 + part socle A35–A37) en tâches T0→T8 + tests + critères pointés ; audit croisé 2 agents conv 14 intégré (14 findings, zéro faux positif) **+ 3 retouches conv 16** (M-1 `current_session_id` · `foreign_keys=ON` · reset `erase_gate` au boot) remontées par le croisé du plan `02`, tracées §7 + renvoi `technique/00` **+ 3 retouches audit Fable (2026-07-10 : alerte effacement-à-la-restauration AF-1 · sweep purges dues AF-4 · invariant JSONL AF-10)** **+ croisé Opus conv 18 (part socle : flux d'effacements non-roté T4 · alerte lit le flux dédié + sweep `storage-scrub` T5 — 5 findings classe stockage, zéro faux positif)**. Suite (ordre des dépendances) : `docs/plan/01-pipeline-vocal.md`.*
