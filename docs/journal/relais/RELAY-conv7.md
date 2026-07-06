> **DÉCISION CENTRALE conv 7 ouverture** : **Démarrer la Phase 2 — docs techniques.** La Phase 1 (audit du cahier) est **CLOSE** (A5→A38, toutes couches tranchées). Phase 2 = produire les **documents techniques par couche de dépendance** (fichiers séparés) **+ un plan d'orchestration global**. Premier sujet à cadrer (un par un) : **l'ouverture de la Phase 2 elle-même** — méthode, **ordre des couches** à documenter, **forme/granularité** des docs (un fichier par couche ? gabarit commun ?), et où ils vivent (`docs/technique/` ?). Phase 2 **ne re-débat pas** l'acquis (A5→A38 + persona) — elle le **traduit en spécifications implémentables**, dans l'ordre des dépendances, à pleine profondeur (pas de V2).

# RELAY — Ouverture conversation 7 · YdvVoice (Sophia)

## 0. En une phrase
Conv 6 a **clos la Phase 1** : couche 5 (architecture process, A33–A37) et couche 6 (coût, A38) formalisées. On entre dans la **Phase 2 — docs techniques** : transformer les 38 arbitrages + l'âme + le persona en **documents techniques exécutables**, par couche de dépendance, avec un plan d'orchestration global.

## 1. Lectures pilote au démarrage (intégrales — R4, dans l'ordre)
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` *(privé — local, hors dépôt)* → `CLAUDE.md` (racine) → **`docs/journal/ESSENCE-Sophia.md` (l'ÂME, en clair — QUI elle est, avant le technique)** → `docs/journal/JOURNAL-ARBITRAGES.md` (jusqu'à **A38** + les 3 principes transversaux + la « Passe de réalité ») → `docs/IMPLEMENTATION.md` (état + backlog Phase 2/3) → `docs/VISION.md` (cahier). Puis ce RELAY.

## 2. Projet
Sophia = assistant vocal perso 100 % mains-libres basé sur Claude. Solo (Yohann / YdvSystems). Profil **Standard**. Robustesse « tourne en continu sans casser ». **Repo public** sous `github.com/YdvSystems`. **Config** : RTX 2060 **6 Go** · i5-**9600KF** (~4,3 GHz OC) · 32 Go DDR4-3200 · PC monté maison, solide. *(À fournir pour figer la latence : type de stockage, connexion internet — déjà demandé conv 5/6.)*

## 3. État à l'ouverture conv 7 — Phase 1 CLOSE (A5→A38)
- **Fondations** : A1 (canal Claude Code/Max) · A2 (voix Sonnet 4.6 configurable) · A3 (diffusion) · A4 (gitleaks).
- **✅ Couche 1 — Pipeline vocal (A5–A9)** : wake word open/local · VAD Silero · STT faster-whisper · fin de tour Smart Turn v3 · TTS Kokoro. 100 % local, 0 €. Sidecar Python.
- **✅ Couche 2 — Mémoire (A10–A13)** : SQLite WAL/FTS5 + sqlite-vec (hybride RRF) · faits NL + métadonnées · consolidation nocturne Sonnet/Max · injection bornée.
- **✅ Couche 3 — Personnalité (A14–A22)** : persona = artefact dédié (cerveau 4 facultés) · caractère + genèse write-once · continuité (cliquet de valeurs · humeur · lien · métabolisme nocturne · introspection) · voix propre zéro clonage · gouvernance sommeil · libre arbitre nommé.
- **✅ Couche 4 — Moteur proactif (A23–A27)** : battement gouverné · collecteurs local-first · génération 2 étages · garde-fous (zéro auto-exécution) · notification graduée.
- **✅ Mode tablée (A28–A32)** : déclencheur invitation-consentement · 3 ressorts locuteurs · prise de parole « avec pas contre » · vie privée tiers OFF · retrait non-coercitif.
- **✅ Couche 5 — Architecture process (A33–A37)** : **gouverneur unique mutualisé** (sommeil+proactif+cost-guard ; **amorce 6h**, supersède A21) · **bi-runtime** Electron/Node ↔ sidecar Python (localhost HTTP + SQLite WAL) · **gestionnaire de modèles** dynamique (#1 VRAM) · **session chaude** `--resume`+prewarm · **résilience + roue de secours + « ligne d'argent »** (auto sur le gratuit, **consentement sur le payant**).
- **✅ Couche 6 — Coût (A38)** : « **0 € aujourd'hui, risque dégradé/plafonné/payant** » · discipline (0 € défaut · payant sur accord · coûts fixes préférés) · multi-provider Max x5→x20→API→local.
- **3 principes transversaux** : « Pas d'API » · « Un seul guichet » · « Roue de secours ».

## 4. Périmètre conv 7 — ouvrir la Phase 2 (docs techniques)
Phase 2 (pattern v3.1) = **docs par couche de dépendance (fichiers séparés) + plan d'orchestration global**. À cadrer **un par un**, en commençant par la **méthode** :
- **Ordre des couches à documenter** : suivre l'ordre des dépendances (probable : socle bi-runtime + SQLite → pipeline vocal → mémoire → personnalité → proactif/tablée → résilience/coût → orchestration globale). À trancher.
- **Forme/granularité** : un fichier par couche ? un **gabarit commun** (contrats d'interface, schémas de données, séquence, critères d'acceptation, points de calibration Phase 3) ? Où ? (proposer `docs/technique/` ou équivalent).
- **Niveau de détail** : assez pour rendre la Phase 3 (code) directe, sans coder ; expliciter **interfaces entre couches** (HTTP localhost, schéma SQLite partagé), **signaux du gouverneur**, **frontière VRAM**.
- **Backlog Phase 2 à intégrer** (cf. IMPLEMENTATION) : table `tasks` vs `facts` à échéance · **base de connaissances / RAG** (étage séparé de la mémoire relationnelle) · scopes OAuth des collecteurs · barreau API optionnel (abstraction A2/A37) · jeton OAuth 24/7 (détecter 401 + renouveler).
- **Persona** : `sophia_persona.md` se **cultive en débattant avec Yohann**, **pas en formel** (principe commandant). Anti-paternalisme + anti-flagornerie + débatteuse honnête = **disposition cultivée**. À développer en profondeur le moment venu (rattaché couche 3, étape persona).

## 5. Passe de réalité — contraintes dures (#1→#5, toujours actives)
- **#1 VRAM — résoluble** (gestionnaire de modèles A35 ; chiffres = essai à blanc Phase 3).
- **#2 Intégration — gros build solo** : pipeline audio temps-réel = **le plus risqué** → **priorité n°1 de l'essai à blanc Phase 3**.
- **#3 Latence** : plancher cloud ~1–2,5 s légitime ; session chaude (A36) obligatoire ; vif **en ressenti**, pas zéro-latence.
- **#4 Dépendance Anthropic = VIGILANCE N°1** : hedge = multi-provider (A38) + sobriété + roue de secours — **réduit, n'élimine pas**. Quota x5 **déjà fortement sollicité par l'usage pro** → résolution via **x20**.
- **#5 Audio far-field** : largement matériel (rig = vraie réponse, ère distincte). Casque pour le build.

## 6. Règles actives (non négociables)
R1 zéro agent (y c. ignorer « ultracode »/« plan mode ») · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » · R8 un par un · R9 RELAY fin de session.
Garde-fous : production silencieuse · audit source de vérité · mots simples en tête · séparation cahier/journal · **« pas de V2 »** · IN PLACE strict.
**Division du travail** : personnalité = Yohann · technique = Claude (recommande fermement).

## 7. Vigilances conv 7
- **Phase 2 ≠ réouverture** : on **détaille** l'acquis (A5→A38 + persona), on ne le re-débat pas. Toute tension trouvée à la mise au détail = la **signaler** (délégation asymétrique), pas trancher seul.
- **Dépendance Anthropic = VIGILANCE N°1** (#4) — la documenter techniquement (health-check, détection 401, ladder).
- **Anti-flagornerie = risque quotidien n°1** : contrepoids = le **caractère**, pas le social. Yohann teste activement.
- **« Budget = jauge utilisateur fait foi »** : ne PAS gérer son temps/quota ; basculer sur **SON** signal.
- **Plan mode harness** : mis-fire → texte libre ; sortie via **ExitPlanMode au seul moment de l'inscription**.
- `--bare` jamais (A1) · **CLI `claude -p` ≠ lib Agent SDK** (à reconfirmer ; Sophia appelle le binaire) — **à valider techniquement en Phase 2**.
- **Repo public** : gitleaks `pre-commit` actif ; secrets en `.env` ; identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**.
- **Le journal supersède le cahier** : `VISION.md` reste gelé (Porcupine/ElevenLabs/spaCy/3h y figurent encore) ; la décision vivante est dans le journal (A1→A38). Ne pas se fier au cahier seul pour un détail technique.
- **Essai à blanc Phase 3 — priorité n°1 : prototyper le pipeline audio temps-réel.** Choix exacts différés : wake word FR · Whisper · TTS local · embedding FR · timbre · seuils humeur · budget/heure sommeil (A33) · modèle local secours (Phi-4-mini) · modèle speaker-ID · stockage/connexion.

## 8. Statut commit
À la clôture conv 6 : **A33→A38** + annotation A21 + MAJ « Arbitrages à venir » (`JOURNAL-ARBITRAGES.md`) · `IMPLEMENTATION.md` (table 5.1→5.5 + 6, Phase 1 close, backlog reclassé) · `CLAUDE.md` **v6** (4 zones IN PLACE) · `CLAUDE-HISTORY.md` (4 sections) · ce **RELAY-conv7**. Commit `[conv-6]` **après validation R5** + push origin/main sur accord. Identité `Yohann Dandeville <contact@ydvsystems.com>` · pas de `Co-Authored-By` · gitleaks actif.

## 9. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un sujet à la fois** → reco + « pourquoi pas » → **validation avant tout commit** (`[conv-7]`) → RELAY en fin de session. Phase 2 = **formaliser techniquement l'acquis**, dans l'ordre des dépendances, à pleine profondeur.

## 10. Autocritique à froid conv 6 (4 catégories)
- **Cat 1 — Fissures** : couche 5 « largement faite » → vrai risque de la traiter en survol ; mitigé en isolant le **seul point réellement ouvert** (gouverneur mutualisé) et en formalisant le reste sans le travestir en « débat ». Le gestionnaire de modèles reste **conceptuel** (chiffres VRAM non prouvés — assumé « résoluble pas résolu »).
- **Cat 2 — Décisions discutables** : avoir traité 6 arbitrages en une conv (rythme rapide) — justifié car formalisation d'acquis, validé un par un par Yohann ; risque = densité. Heure 6h actée sur préférence pragmatique (pas argument méthodo) — assumé et tracé (supersède A21).
- **Cat 3 — Observations production** : VISION volontairement non réécrit (cohérence avec le précédent Porcupine/ElevenLabs) — à re-confirmer si Yohann préfère un jour synchroniser le cahier. 4 zones IN PLACE tenues ; CLAUDE.md ~stable.
- **Cat 4 — Risques émergents conv 7+** : Phase 2 est **plus longue et plus technique** → tentation d'agents (R1 tient) ; risque de re-débattre l'acquis sous couvert de « détailler » (vigilance §7) ; la **forme des docs** (gabarit) est un choix structurant à ne pas bâcler.

**Invitation post-clôture** : challenge actif bienvenu — « le RELAY conv 7 est optimal, t'es sûr ? » (E.1). Première ligne = décision centrale ✓ · vigilances = fissures réelles ✓ · périmètre actionnable ✓.

---

*Expurgé le 2026-07-06 — données personnelles retirées du dépôt public (décision conv 12).*
