> **DÉCISION CENTRALE conv 8** : **Continuer la Phase 2 — écrire `docs/technique/01-pipeline-vocal.md`** (couche 1 : wake word · VAD · STT · fin de tour · TTS — A5–A9), **même méthode que le doc `00`** (gabarit 7 rubriques · un par un · reco + « pourquoi pas » · **audit avant de figer** · validation avant inscription). Y **placer** : la **grammaire de l'adresse naturelle** (« bonne nuit Sophia » d'un coup, A32-étendu) et le **branchement de l'idée d'affect vocal** (`evt.affect`). **Le socle `00` est acquis — bâtir dessus, ne pas le rouvrir** (sauf vraie tension → la signaler, §7).

# RELAY — Ouverture conversation 8 · YdvVoice (Sophia)

## 0. En une phrase
Conv 7 a **ouvert la Phase 2** et gravé le **premier doc technique** : `00-socle-process.md` (bi-runtime + gouverneur + boot/durabilité). On enchaîne sur le **doc `01` — pipeline vocal**, dans l'ordre des dépendances (la voix s'écrit *sur* le socle).

## 1. Lectures pilote (intégrales — R4, dans l'ordre)
`docs/PATTERN…` *(privé/local)* → `CLAUDE.md` → **`docs/journal/ESSENCE-Sophia.md`** → `docs/journal/JOURNAL-ARBITRAGES.md` (A1→A38) → `docs/IMPLEMENTATION.md` → `docs/VISION.md` → **`docs/technique/00-socle-process.md`** (le socle, désormais acquis) → ce RELAY.

## 2. Ce qui a été fait en conv 7
- **Phase 2 ouverte — méthode actée** : docs **par couche de dépendance** dans `docs/technique/`, **un fichier/couche**, **gabarit commun à 7 rubriques** (1 arbitrages · 2 interfaces · 3 données · 4 séquences · 5 invariants · 6 acceptation · 7 calibration Phase 3), **pleine profondeur sur la structure / valeurs différées Phase 3**, + un doc d'orchestration global `99` en fin.
- **Ordre des couches acté** : `00` socle → `01` vocal → `02` mémoire → `03` personnalité → `04` proactif/tablée → `05` ressources/résilience/coût → `99` orchestration.
- **✅ `00-socle-process.md` GRAVÉ** — décisions 00-A→00-E + audit F1–F4 :
  - **00-A** canal IPC = **WebSocket localhost full-duplex** (`cmd.*`/`evt.*`, `evt.*` extensible) + **REST minimal** (santé/debug) ; audio **confiné au sidecar** ; barge-in interne.
  - **00-B** état durable (marques d'échéance + budget) dans le **WAL unique** ; éphémère re-dérivé ; **atomicité marque↔écriture** ; **« secours ne grave jamais »** ; **snapshot avant consolidation**.
  - **00-C** **machine à états** (INTERACTIF/REPOS/FOND_EN_COURS/BRIDÉ + calque SECOURS) ; **préemption par unité + curseur** ; budget souple « part de Sophia » + **contre-pression 429**.
  - **00-D** **supervision sidecar = idiome Plume** (port libre dynamique + retry TOCTOU + pidfile/anti-recyclage + readiness + escalade SIGTERM/SIGKILL + drain stdio + hygiène env) ; respawn déterministe.
  - **00-E** **boot = réveil** (instance unique · porte d'intégrité · **charge+vérifie l'identité** · classification du réveil · **continuité conversationnelle** `--resume`/repli · états dégradés) + **durabilité anti-coupure** (`synchronous=FULL` · snapshot atomique `VACUUM INTO` · drapeau d'arrêt · base tout-logiciel).
  - **Audit avant inscription** : **F1** (vrai bug — drapeau d'arrêt remis à l'endroit : « EN COURS » au boot, « PROPRE » à l'arrêt) · **F2** (écrivain unique = orchestrateur ; sidecar nourri via WS) · **F3** (arrêt gracieux `cmd.shutdown` → libère GPU) · **F4** (rotations snapshot/audit · rattrapage multi-jours · rôles serveur/client · identité = persona-file + tables doc 03 · tag par origine · canal gardien).
- **Empirie (audit source de vérité)** : **Plume = précédent Windows éprouvé** du process-lifecycle (`electron/main/ortho/engine.ts` + `orphan-cleanup.ts`) → idiome réutilisé (00-D). Toolchain : **Node 24.13 · Python 3.14**.
- **Backlog enrichi** : **affect vocal** (humeur de Yohann dans la voix → `evt.affect`, couche 1⇄3, **signal doux jamais étiquette**) · **adresse naturelle** (« bonne nuit Sophia » d'un coup, A32-étendu).
- **Acté hors socle** : **A32-étendu** (adresse naturelle sans double-commande). **Onduleur** (durabilité matérielle) = **optionnel/différé**, zéro dépendance (modèle repéré sinus pur/PFC : CyberPower CP900EPFCLCD).

## 3. Périmètre conv 8 — doc `01-pipeline-vocal.md`
Détailler techniquement la couche 1 (A5–A9), dans le gabarit 7 rubriques, **un par un**. Points probables à trancher :
- **Flux audio dans le sidecar** : capture micro → ring buffer → consommateurs (wake word, VAD, STT, fin de tour, affect) — un seul chemin audio.
- **Chaîne d'événements** sur le WS : `evt.wake` → `evt.vad.*` → `evt.stt.partial|final` → `evt.turn.end` → (cerveau) → TTS streaming + `evt.bargein`.
- **Résidence des modèles** (frontière avec A35/doc 05) : wake word **always-on CPU** · **prewarm Whisper au wake word** · Kokoro à la demande — *qui déclenche quoi* via signaux gouverneur.
- **Abstractions « avoir le choix »** : STT (local ⇄ Deepgram) · TTS (local ⇄ ElevenLabs) · moteur wake word interchangeable.
- **Grammaire de l'adresse naturelle** (A32-étendu) + **inventaire des interactions véritables** (grille minimale) + **branchement `evt.affect`**.
- **Critères d'acceptation** vocaux + **points de calibration Phase 3** (modèles exacts, seuils — l'essai à blanc audio = priorité n°1).

## 4. Règles actives (non négociables)
R1 zéro agent (y c. ignorer « plan mode »/« ultracode ») · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » · R8 un par un · R9 RELAY fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · séparation cahier/journal · **« pas de V2 »** · IN PLACE strict.
**Division du travail** : personnalité = Yohann · technique = Claude (recommande fermement).

## 5. Vigilances conv 8
- **Phase 2 ≠ réouverture** : on **détaille** l'acquis (A5→A38 + socle `00`), on ne le re-débat pas. Tension trouvée à la mise au détail = **signaler** (§7), pas trancher seul.
- **Méthode Phase 2 = gabarit 7 rubriques + audit AVANT de figer** (a trouvé un vrai bug F1 conv 7 — Yohann l'exige). **ExitPlanMode au seul moment de l'inscription fichier.**
- **Plan mode harness** : mis-fire → **texte libre** (géré conv 2-7).
- **Dépendance Anthropic = VIGILANCE N°1** (#4) — à documenter techniquement en `05` (health-check, 401, ladder). Quota Yohann ~85 % hebdo (x5) → x20.
- **Anti-flagornerie = risque quotidien n°1** : contrepoids = le **caractère**, pas le social. Yohann **teste activement** (« challenge ta reco »). Honnêteté chiffrée, reconnaître les erreurs.
- **Anti-paternalisme** : proposer sans prescrire (onduleur proposé pas imposé ; affect vocal = signal doux jamais diagnostic).
- **« Budget = jauge utilisateur fait foi »** : ne PAS gérer son temps/quota ; basculer sur **SON** signal.
- **Essai à blanc Phase 3 — priorité n°1 : prototyper le pipeline audio temps-réel.** Choix exacts différés : wake word FR · Whisper · TTS local · embedding FR · timbre · seuils humeur · modèle secours (Phi-4-mini) · modèle speaker-ID · **modèle affect (emotion2vec)** · stockage/connexion (à fournir).
- **Repo public** : gitleaks `pre-commit` actif ; secrets en `.env` ; identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**.
- **Le journal supersède le cahier** : `VISION.md` reste gelé (Porcupine/ElevenLabs/spaCy/3h y figurent encore).

## 6. Statut commit
À la clôture conv 7 : nouveau fichier **`docs/technique/00-socle-process.md`** · MAJ `IMPLEMENTATION.md` (backlog affect vocal + adresse naturelle ; Phase 2 en cours) · `CLAUDE.md` **v7** (IN-PLACE) · `CLAUDE-HISTORY.md` (sections 1/2/3) · ce **RELAY-conv8**. Commit `[conv-7]` **après validation R5** + push origin/main sur accord. Identité `Yohann Dandeville <contact@ydvsystems.com>` · pas de `Co-Authored-By` · gitleaks actif.

## 7. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un sujet à la fois** → reco + « pourquoi pas » → **audit avant inscription** → **validation avant tout commit** (`[conv-8]`) → RELAY en fin de session.

## 8. Autocritique à froid conv 7
- **Cat 1 — Fissures** : ma 1ʳᵉ reco IPC (REST+SSE) était de la **facilité déguisée** ; ne tenait que parce que Yohann a poussé. Idem boot « mécanique » (persona oublié) — corrigé sous challenge, pas spontanément. → garder l'audit/challenge **systématique**, pas sur demande.
- **Cat 2 — Décisions discutables** : rythme rapide (5 décisions socle en une conv) — justifié (formalisation guidée, validée un par un), risque = densité. Le gestionnaire de modèles + frontière VRAM restent **conceptuels** (chiffres Phase 3).
- **Cat 3 — Production** : doc `00` gravé proprement (gabarit tenu) ; backlog enrichi sans réouverture d'acquis ; CLAUDE.md IN-PLACE.
- **Cat 4 — Risques conv 8+** : doc `01` (audio temps-réel) = **plus risqué encore** → tentation d'agents (R1 tient) ; tentation de figer des modèles à l'aveugle (différer Phase 3) ; ne pas laisser l'inventaire des commandes vocales « sous le tapis » (Yohann y tient).

**Invitation post-clôture** : challenge actif bienvenu — « le RELAY conv 8 est optimal, t'es sûr ? ». Première ligne = décision centrale ✓ · vigilances = fissures réelles ✓ · périmètre actionnable ✓.
