# JOURNAL-ARBITRAGES.md — Décisions de cadrage · YdvVoice (Sophia)

> Livrable **séparé du cahier** (`docs/VISION.md`) et de la méthode (`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`). Trace les arbitrages tranchés + la reconnaissance terrain qui les fonde. Format d'un arbitrage : sujet en mots simples → options → pesée → reco → « pourquoi pas » → garde-fous.

---

## Reconnaissance terrain — 2026-06-21 (vérifiée aux sources Anthropic)

| Sujet | Constat | Source |
|---|---|---|
| **Cowork** | Vrai produit Anthropic. Onglet de l'app Desktop (Chat / Cowork / Code). **Même moteur que Claude Code.** App Desktop = OAuth exclusif, **jamais de clé API**. | docs Claude Code · claude.com/product/cowork |
| **Sans clé API** | `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` (token 1 an, inference-only). Usage compté sur le **quota Max**, pas de charge séparée. | code.claude.com/docs/en/authentication |
| **Agir sur le PC** | `claude -p` / Agent SDK + MCP + connectors + computer use. Ordre de préférence des outils : connectors → Bash → navigateur → computer use (dernier recours). | code.claude.com/docs/en/headless · /desktop |
| **Remote Control** | Pilotage depuis un AUTRE appareil ; exige un **full login** (`claude /login`), PAS le token inference-only. **Non nécessaire** (Sophia = même machine). | code.claude.com/docs/en/remote-control |
| **ElevenLabs** | Facturation **par caractère**. « 5 $/mois » (Starter ≈ 30k crédits) irréaliste pour usage quotidien. Leviers : Flash/Turbo v2.5 (0,5 crédit/car + streaming). | elevenlabs.io/pricing/api |
| **Wake word FR** | « Dis-moi Sophia » via Porcupine : faisable, clé Picovoice gratuite (≤ 3 users) + activation périodique en ligne. | picovoice.ai/docs |

---

## A1 — Canal par lequel Sophia agit sur le PC ✅ (2026-06-21)

**Sujet (mots simples)** : quand Sophia doit faire quelque chose sur le PC, par quel « tuyau » elle parle à Claude.

**Options**
- **(a) Canal unique** — Claude Code headless/SDK (`claude -p`) sous token OAuth Max. Un seul tuyau programmable ; Claude choisit l'outil (Bash / MCP / computer use). Couvre dev **et** knowledge-work.
- **(b) Deux canaux** (vision initiale) — Claude Code SDK pour le dev + simulation de l'UI de Cowork (sélecteur DOM) pour le reste.

**Pesée** : (a) un seul tuyau robuste, rien à recâbler quand une UI change, coût nul (Max), sert R3. (b) double le travail + garde la brique la plus fragile.

**Décision : (a)** — canal unique Claude Code headless/SDK sous Max.

**Pourquoi pas (b)** : la simulation d'UI est le « talon d'Achille » que la reconnaissance permet d'écarter ; la garder réintroduit la fragilité éliminée, pour une capacité que (a) couvre déjà.

**Garde-fous**
- ⚠️ **Ne jamais utiliser `--bare`** (saute l'OAuth → exige une clé API ; deviendra le défaut de `-p` → gérer l'auth OAuth explicitement).
- Remote Control non requis (même machine) → token inference-only suffit.
- Usage **plafonné par le quota Max** → à surveiller pour un usage intensif.
- Computer use GUI (Windows) = via app Desktop, complément résiduel.

---

## A2 — Modèle & canal de la voix de Sophia ✅ (2026-06-21)

**Sujet (mots simples)** : avec quel modèle Sophia *s'exprime*, et par quel tuyau, sachant qu'on veut richesse **et** vivacité.

**Clarification de rôles — deux cerveaux distincts**
- **Aiguilleur d'intention** : composant léger (Haiku ou déterministe), invisible — décide « bavardage vs action » + lance l'accusé de réception. **N'est pas** la voix.
- **Voix de Sophia** : ce qu'elle *dit* → modèle riche.

**Décisions**
- **Modèle d'expression = Sonnet 4.6** (richesse + meilleur équilibre vitesse ; Opus = overkill/plus lent pour une voix).
- **Canal de la voix = configurable** (« avoir le choix ») — abstraction unique, 2 implémentations interchangeables :
  - (a) Claude Code `--model sonnet` sous Max — gratuit, latence agent-loop à mesurer ;
  - (b) API Sonnet 4.6 directe — fluide, petit budget.
  Bascule par config (+ toggle éco/premium possible) + **cost-guard** sur le canal payant.

**Décision utilisateur** : petit budget voix **acceptable si** ça rend Sophia vraiment vive, **mais le choix doit rester possible**.

**Tension richesse ↔ vivacité** : masquée par accusé de réception instantané + **TTS streaming** (Sophia parle avant la fin de génération).

**Reste à trancher sur mesure** (essai à blanc Phase 3, pas à l'aveugle) : canal Max vs API selon la latence réelle de Claude Code-Sonnet.

---

## Principe transversal — « Avoir le choix » (2026-06-21)

Toute brique à **coût/qualité variable** vit derrière une **abstraction configurable** (provider pattern) + cost-guard. Issu de A2, généralisé. S'applique à : voix (acté), **STT** (Whisper local ⇄ Deepgram cloud), **TTS** (ElevenLabs ⇄ local). Cohérent avec l'esprit multi-source de la vision.

---

## A3 — Diffusion : repo public + pattern privé ✅ (2026-06-21)

**Sujet (mots simples)** : le dépôt est destiné à devenir **public** (vitrine de la qualité). Que montre-t-on, que garde-t-on privé ?

**Décisions**
- **Repo public** assumé — il expose la démarche (arbitrages, journal, décisions) = teaser de la qualité, sans livrer le manuel.
- **PATTERN privé** : c'est une **IP propriétaire** (3 profils calibrés : prototype / Standard / Enterprise), potentiellement **commercialisable**. Sorti du suivi git (`git rm --cached` + `.gitignore` → `docs/PATTERN-*.md`), **présent en local** pour le workflow.
- **`CLAUDE.md` gardé en vitrine** : il prouve la qualité sans livrer le manuel. **Pas de double version** (privé/public) — sur-ingénierie évitée, sauf si la formulation des règles devient elle-même « secrète ».
- **Contrainte sécurité transversale** : zéro secret committé (clés en `.env` gitignored ; audit/logs sans secrets).

**À faire avant le 1er `git push`** (revue confidentialité) : nettoyer l'historique (le pattern y est encore via le commit conv-1) · décider de l'email des commits (réel vs `noreply`) · vérifier zéro secret.

---

## A4 — Sécurité du repo public ✅ (2026-06-21)

**Sujet (mots simples)** : le repo étant public, garantir qu'aucun secret (clé, token) ne puisse **jamais** y arriver — automatiquement, pas à la vigilance humaine.

**Dispositif (en couches)** :
- 🛡️ **Hook `pre-commit`** (`.githooks/pre-commit`) : scanne chaque commit avec **gitleaks** et le **bloque** si un secret est détecté. Activé via `git config core.hooksPath .githooks` (à relancer sur chaque clone). **Testé : bloque bien une clé privée.**
- **`.gitignore` blindé** : `.env*`, `*.key`, `*.pem`, `credentials*.json`, `*.token`, base SQLite (données perso), audit, logs.
- **`.env.example`** versionné : noms de variables, **zéro valeur**.
- **Principe** : secrets **uniquement** en `.env` (gitignored), jamais en dur dans le code ; audit/logs sans secrets.
- **Si fuite** : rotation/révocation **immédiate** de la clé (un secret poussé en public est compromis).

**Identité des commits** : `Yohann Dandeville <contact@ydvsystems.com>` (pro, assumé ; comptes personnels écartés). Repo hébergé sous l'organisation **github.com/YdvSystems**.

---

## Arbitrages à venir (ordre des dépendances)
1. **Pipeline vocal** : STT (local/cloud), VAD (Silero), fin de phrase (spaCy FR), wake word (Porcupine), TTS (ElevenLabs — coût à recadrer).
2. **Mémoire** (SQLite épisodique + sémantique, consolidation nocturne).
3. **Moteur proactif** + garde-fous anti-spam.
4. **Architecture process** (Electron + Node + sidecar Python).
5. **Coût global réel** (recadrage du « ~5 $/mois »).
