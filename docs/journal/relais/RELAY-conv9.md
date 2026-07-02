> **DÉCISION CENTRALE conv 9** : **Continuer la Phase 2 — écrire `docs/technique/02-memoire.md`** (couche 2 : socle SQLite WAL · recherche hybride FTS5+`sqlite-vec`+RRF (A10) · faits NL+métadonnées (A11) · consolidation micro/deep (A12/A18, gouvernée A21/A33) · injection 3 couches (A13)), **+ cadrer pleinement l'extension base de connaissances/RAG** (backlog conv 5). **Même méthode que `00`/`01`** (gabarit 7 rubriques · un par un · reco + « pourquoi pas » · **audit avant de figer** — croisé 2 agents sur demande · validation avant inscription). **Socle `00` + voix `01` acquis — bâtir dessus, ne pas rouvrir** (tension → signaler, §7).

# RELAY — Ouverture conversation 9 · YdvVoice (Sophia)

## 0. En une phrase
Conv 8 a gravé le **doc `01` — pipeline vocal** (couche 1 complète, audit solo F1–F7 + **premier audit croisé 2 agents**, 21 findings tous intégrés). On enchaîne sur le **doc `02` — mémoire**, dans l'ordre des dépendances (la mémoire s'écrit *sur* le socle, et la couche 3 s'écrira *sur* elle).

## 1. Lectures pilote (intégrales — R4, dans l'ordre)
`docs/PATTERN…` *(privé/local)* → `CLAUDE.md` → **`docs/journal/ESSENCE-Sophia.md`** → `docs/journal/JOURNAL-ARBITRAGES.md` (A1→A38) → `docs/IMPLEMENTATION.md` → `docs/VISION.md` *(gelé — supersédé)* → `docs/technique/00-socle-process.md` → **`docs/technique/01-pipeline-vocal.md`** → ce RELAY.

## 2. Ce qui a été fait en conv 8
- **✅ `01-pipeline-vocal.md` GRAVÉ** — 01-A→01-I validés un par un :
  - **01-A** chemin audio unique : capture → **AEC (référence = loopback système ENTIER, F2)** → ring buffer RAM → consommateurs à curseur (wake · VAD · STT · turn · **speaker-ID** · affect).
  - **01-B** réflexes sidecar / décisions orchestrateur ; **l'état d'écoute appartient à l'orchestrateur** (B1 : écoute transitoire rétroactive après le tour de réveil).
  - **01-C** fin de tour **acoustique jamais sémantique** : Smart Turn accélérateur / silence plafond / fusion d'hésitation / `reason` tagué.
  - **01-D** TTS énonciation streamée par phrases · **barge-in modulé par le locuteur** (B3 : nom = coupure immédiate · voix de Yohann = seuil bas · inconnue = durée minimale ; A29 restauré) · replay RAM · « stop/chut ».
  - **01-E** résidence : politique gouvernée (3 axes : mode voix · SECOURS · autorisations transitoires) / réflexes armés localement.
  - **01-F** prises provider : contrat par rôle, moteur ne fuit jamais, cloud OFF, **zéro clé pour démarrer**.
  - **01-G** **grille d'adresse naturelle** (A32-étendu) : match = **énoncé entier normalisé** · flou → cerveau, jamais d'action système · réveil **rétroactif** (F1) · formes canoniques de Yohann (« Bonjour Sophia » ouverture · « Dis-moi Sophia » sollicitation · « s'il te plaît » de mise · « tu es là Sophia ? » · « ok/go/fonce » en APPROBATION) · **réponses au prénom « Yohann »** (convention → persona doc `03`).
  - **01-H** capteur d'affect : une éval/tour · valence/énergie/confiance (jamais d'étiquette) · verrou speaker-ID · muet dans le doute · OFF par défaut.
  - **01-I** 13 critères d'acceptation + calibration Phase 3 (🔴 wake FR = preuve n°1, tension F6 + repli nommé).
- **Audit solo F1–F7** (réveil rétroactif · AEC loopback · ducking armé par l'état · speaker-ID consommateur · table des états d'écoute · F6 signalé · phrases de secours) **+ premier audit croisé 2 agents** (exception R1, demande explicite de Yohann) : **21 findings (4 bloquants · 10 sérieux · 7 mineurs), 100 % vérifiés aux sources puis intégrés** — dont propriété de l'état d'écoute (B1), `cmd.tts.cache` = autorisation transitoire (B2), barge-in/A29 (B3), **B4**, APPROBATION cycle de vie, MODE DICTÉE liste blanche, resynchronisation respawn (§4.8), phrase de secours 1×/épisode exempte de barge-in, paire de test « bonsoir/bonne nuit ».
- **B4 (décision Yohann, arbitrage complet)** : l'« injection au curseur systématique » du cahier est **supersédée** → **dictée explicite** (« passe en dictée s'il te plaît », app-agnostique ; mode dev = cas particulier VS Code) ; mode silencieux → affichage UI ; **fichiers/dossiers = travail de Sophia** (canal A1). Contre-challenge accepté (« mieux que ta première reco et mieux que ce que je proposais »).
- MAJ : `IMPLEMENTATION.md` (backlog : adresse naturelle ✅ · affect branché couche 1 ✅ · convention de parole → `03` · tension tablée → `04`) · `CLAUDE.md` **v8** (IN PLACE) · `CLAUDE-HISTORY.md` (sections 1/2/3).

## 3. Périmètre conv 9 — doc `02-memoire.md`
Détailler techniquement la couche 2 (A10–A13 + gouvernance A12/A18/A21), gabarit 7 rubriques, **un par un**. Points probables à trancher :
- **Tables métier** que le socle §3 délègue : `sessions` / `conversations` (épisodique) · `facts` + FTS5 + `sqlite-vec` (sémantique, **schéma NL+métadonnées d'A11 — pas les triplets du cahier**) · relations `SUPERSEDES` · vecteurs (dimension liée au modèle = Phase 3).
- **Recherche hybride** (A10) : séquence FTS5/BM25 + KNN + **RRF**, filtres (importance/récence/confiance), interface de la couche (qui appelle : injection A13, dédup A26, introspection A19-espace-séparé → doc `03`).
- **Consolidation** micro (après échange, Haiku, fire-and-forget) / deep (nocturne, Sonnet) : séquences en **unités+curseur** (socle §4.4), transactions, idempotence, `SUPERSEDES` jamais-supprimer, snapshot avant (socle), « secours ne grave jamais ».
- **Injection 3 couches bornée** (A13) : `user_model.md` réécrit-pas-accumulé · faits à la volée · résumé N échanges — budgets de tokens = Phase 3.
- **Base de connaissances / RAG** (backlog conv 5, à cadrer PLEINEMENT) : dossier `knowledge/`, ingestion unique (découpe + embedding), **deux étages distincts** (relationnel consolidé ≠ connaissances jamais réécrites), échelle (brute-force → ANN au-delà), distinction **connaître** (RAG) vs **utiliser** (action).
- **Frontières** : la mémoire **sert** la couche 3 sans la re-décider (les tables persona/lien/cliquet = doc `03`) ; écrivain unique = orchestrateur (F2) ; embeddings calculés au **sidecar** (A10) → interface `cmd./evt.` à préciser (cohérente doc `01`).
- **Critères d'acceptation** + calibration Phase 3 (modèle embedding FR, seuils RRF, budgets).

## 4. Règles actives (non négociables)
R1 zéro agent (**exception audits 2 agents sur demande** — précédent conv 8 : findings à vérifier soi-même aux sources avant présentation) · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » — **spontanément pour toute décision qui revient à Yohann** (recadrage conv 8) · R8 un par un · R9 RELAY fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · séparation cahier/journal · **« pas de V2 »** · IN PLACE strict.
**Division du travail** : personnalité = Yohann · technique = Claude (recommande fermement).

## 5. Vigilances conv 9
- **Doc `02` = zone sensible identité/mémoire** : gradient de permanence (A15/A18) — noyau/genèse **write-once**, anti-dérive **réécriture-depuis-la-source** ; la mémoire sert la couche 3, elle ne la re-décide pas.
- **Phase 2 ≠ réouverture** : détailler A10–A13, pas les re-débattre ; tension → **signaler** (§7).
- **RAG = élévation de rôle** (« Sophia = cœur du système de Yohann ») : cadrer pleinement **sans gonfler le périmètre** ; chiffres (échelle, ANN) honnêtes, pas inventés.
- **Audit avant de figer** : solo systématique ; **croisé 2 agents seulement sur demande de Yohann** (son appel, pas le mien — R1).
- Plan mode harness → **texte libre**, ExitPlanMode à l'inscription seulement (géré conv 2-8).
- **Dépendance Anthropic = VIGILANCE N°1** · quota fortement sollicité → x20 · anti-flagornerie (Yohann teste) · anti-paternalisme (proposer, pas prescrire) · **budget = jauge utilisateur**.
- **Le journal + docs techniques supersèdent le cahier** (`VISION.md` gelé : triplets/`FTS5-seul`/3h/injection-systématique y figurent encore — supersessions tracées doc `01` §7).
- Repo public : gitleaks `pre-commit` · secrets `.env` · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**.

## 6. Statut commit
À la clôture conv 8 : nouveau **`docs/technique/01-pipeline-vocal.md`** · MAJ `docs/IMPLEMENTATION.md` · `CLAUDE.md` **v8** (IN PLACE) · `docs/journal/CLAUDE-HISTORY.md` (sections 1/2/3) · ce **RELAY-conv9**. Commit `[conv-8]` **après validation R5** + push origin/main sur accord.

## 7. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un sujet à la fois** → reco + « pourquoi pas » → **audit avant inscription** → **validation avant tout commit** (`[conv-9]`) → RELAY en fin de session.

## 8. Autocritique à froid conv 8
- **Cat 1 — Fissures** : (1) **mon audit solo a raté 4 vrais trous** que le croisé a trouvés (propriété de l'état d'écoute, `tts.cache` vs GPU vide, ancre A29 barge-in, injection cahier réduite en douce) — sur un doc de cette densité, le solo ne suffit pas ; (2) **R7 recadré** : B4 servi comme « à toi de trancher » sans arbitrage complet → Yohann a dû l'exiger ; (3) **deux réductions silencieuses du cahier** écrites sans signalement (rattrapées par l'audit, pas par ma discipline).
- **Cat 2 — Décisions discutables** : grille à ~18 entrées (« minimale » à re-challenger à l'usage réel) · phrase de secours **exempte de barge-in** = priorité au message sur le contrôle utilisateur (assumé, borné à 1×/épisode) · l'« écoute transitoire » ajoute un état implicite au sidecar (justifié B1, mais de la complexité).
- **Cat 3 — Production** : doc `01` gravé (gabarit tenu, 13 critères, supersessions tracées) · 21/21 findings vérifiés aux sources avant présentation · IN PLACE respecté.
- **Cat 4 — Risques conv 9+** : doc `02` touche l'identité (écritures d'identité, anti-dérive) → tentation de re-décider la couche 3 depuis la mémoire ; RAG → gonflement de périmètre ; tentation de figer modèle/dimensions d'embedding à l'aveugle (Phase 3) ; densité croissante des renvois inter-docs (vérifier la cohérence `00`⇄`01`⇄`02` à chaque inscription).

**Invitation post-clôture** : challenge actif bienvenu — « le RELAY conv 9 est optimal, t'es sûr ? ». Première ligne = décision centrale ✓ · vigilances = fissures réelles conv 8 ✓ · périmètre actionnable ✓ · lectures pilote sans surcharge (le `01` s'ajoute, rien ne se retire — les deux docs techniques sont désormais des acquis à bâtir) ✓.
