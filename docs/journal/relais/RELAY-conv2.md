> **DÉCISION CENTRALE conv 2 ouverture** : Reprendre l'audit Phase 1 → **couche 1 (pipeline vocal)**, en commençant par le **STT** (transcription). Sous le principe « avoir le choix », l'arbitrage n'est pas exclusif : quel **défaut** entre (a) whisper **local** [gratuit, sans clé API, charge machine] et (b) Deepgram **cloud** [latence/précision, mais payant + clé API], en confirmant que les deux restent interchangeables. Commande la latence d'entrée, le coût, et la présence du sidecar Python.

# RELAY — Ouverture conversation 2 · YdvVoice (Sophia)

## 0. En une phrase
Socle de cadrage posé, committé et réorganisé (`docs/` + `docs/journal/relais/`) ; pattern sorti du dépôt (IP privée). 2 arbitrages fondateurs tranchés (A1 action, A2 voix) + A3 (diffusion). On reprend l'audit Phase 1 à la couche pipeline vocal.

## 1. Lectures pilote au démarrage (intégrales — R4, dans l'ordre)
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` *(privé — présent en local, hors dépôt)* → `CLAUDE.md` (racine) → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md`.

## 2. Projet
Sophia = assistant vocal perso 100 % mains-libres basé sur Claude. Solo (Yohann / YdvSystems). Profil **Standard**. Cap coût : Max existant en priorité, **petit budget toléré seulement pour la vivacité (voix)**. Robustesse « tourne en continu sans casser ».

## 3. État à l'ouverture conv 2
- Socle créé, committé, réorganisé. Arbo : `CLAUDE.md` (racine) ; `docs/` : VISION, IMPLEMENTATION (+ `PATTERN` **privé/gitignored**, présent en local) ; `docs/journal/` : JOURNAL-ARBITRAGES, CLAUDE-HISTORY ; `docs/journal/relais/` : RELAY-conv2.
- **Repo destiné à devenir public** ; pattern = IP privée (voir A3).
- Reconnaissance terrain **faite et vérifiée** (table dans le journal).
- Arbitrages **A1**, **A2**, **A3** tranchés. Principe **« avoir le choix »** posé.
- Arbo applicative **NON figée** (attend la fin des arbitrages).

## 4. Décisions actées (résumé — détail dans `docs/journal/JOURNAL-ARBITRAGES.md`)
- **A1** — Sophia agit sur le PC via **Claude Code headless/SDK** (`claude -p`) sous **token OAuth Max** (sans clé API). Canal **unique** ; pas de simulation d'UI Cowork. Garde-fou : **jamais `--bare`**.
- **A2** — Voix de Sophia = **Sonnet 4.6** (expression riche). Aiguilleur d'intention **séparé** (léger/déterministe). Canal de la voix **configurable** : Claude Code-Sonnet sous Max (gratuit) ⇄ API Sonnet (petit budget) + cost-guard. Canal tranché **sur mesure de latence** (essai à blanc Phase 3).
- **A3** — **Repo public + pattern privé** (IP, gitignored, en local) ; `CLAUDE.md` gardé en vitrine ; contrainte « zéro secret committé » ; revue confidentialité + nettoyage historique **avant tout push**.
- **Principe « avoir le choix »** — briques coût/qualité derrière abstractions configurables (voix, STT, TTS).

## 5. Périmètre conv 2 — audit couche 1 (pipeline vocal)
Ordre des dépendances : wake word (Porcupine FR, quasi-acté) → VAD (Silero) → **STT (1er vrai arbitrage : local vs cloud)** → détection fin de phrase (spaCy FR → sidecar Python) → TTS (**ElevenLabs : coût à recadrer**, viser Flash/Turbo v2.5 + streaming).
**Commencer par le STT.** Puis enchaîner la couche dans l'ordre. Inscrire chaque décision dans `docs/journal/JOURNAL-ARBITRAGES.md`.

## 6. Règles actives (non négociables)
R1 zéro agent (sauf audits 2 agents) · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » · R8 un par un · R9 RELAY en fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · séparation cahier/journal.

## 7. Vigilances conv 2
- **Plan mode harness** : peut se redéclencher à l'ouverture sur ce RELAY → gérer en faveur du fonctionnement Yohann (texte libre, jamais d'AskUserQuestion).
- **`--bare`** (A1) : ne jamais l'utiliser (exigerait une clé API).
- **Diffusion (repo visé public)** : zéro secret committé ; pattern privé (gitignored) ; **nettoyage de l'historique + revue confidentialité AVANT tout `git push`**.
- **Filtre projet** actif : perso solo → pas de sur-ingénierie.
- **Coût ElevenLabs** : à recadrer dès qu'on touche le TTS (le « 5 $/mois » ne tient pas).
- **Quota Max partagé** : action + voix sous Max → surveiller la saturation (la veille seule ne consomme rien ; ce sont le proactif en fond + les actions lourdes qui consomment).
- Discipline IN PLACE + RELAY en clôture.

## 8. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un arbitrage à la fois** → reco + « pourquoi pas » → **validation avant tout commit** (`[conv-2]`) → RELAY en fin de session.
