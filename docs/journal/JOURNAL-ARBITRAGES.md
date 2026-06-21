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
| **Wake word FR** | « Dis-moi Sophia » via Porcupine : faisable, clé Picovoice gratuite (≤ 3 users) + activation périodique en ligne. **⚠️ MàJ 2026-06-21 : tier gratuit Picovoice supprimé au 30/06/2026 → bascule open/local, voir A8.** | picovoice.ai/docs |

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

## A5 — STT : l'oreille de Sophia (transcription) ✅ (2026-06-21)

**Sujet (mots simples)** : par quel moyen Sophia transforme ta voix en texte — sur ta machine ou via un service en ligne — et avec quel moteur.

**Décisions**
- **Défaut = Whisper local** : gratuit, zéro clé API, la voix ne sort jamais du PC, coût fixe nul. Cohérent « coûts fixes prédictibles ».
- **Moteur = faster-whisper** (CTranslate2 / CUDA) **dans le sidecar Python** — meilleur moteur sur la RTX 2060 par lui-même ; le sidecar Python regroupe **faster-whisper + Silero (VAD) + Smart Turn (fin de tour, cf. A6)** en un seul process. Écarte le build CUDA Windows fragile de whisper.cpp (R3). *(spaCy, d'abord invoqué pour mutualiser le Python, est écarté en A6 — sans effet sur ce choix.)*
- **Échappatoire = Deepgram cloud** par config (« avoir le choix ») — activable si la latence locale ne suit pas. Tranché sur mesure par essai à blanc (Phase 3), pas à l'aveugle.
- **Modèle Whisper = à calibrer** à l'essai à blanc (`medium` ⇄ `large-v3` int8) — la RTX 2060 6 Go les fait tourner plus vite que le temps réel.

**Matériel cible (validé)** : RTX 2060 **6 Go** VRAM + i5 (ancien, OK : le GPU porte la charge) + 32 Go DDR4-3200 (marge confortable pour la stack H24).

**Pourquoi pas Deepgram par défaut** : coût variable (pay-per-use) + clé API (surface A4) + voix qui sort de la machine — non nécessaires tant que le local tient ; le « petit budget toléré » est fléché vers la voix/TTS, pas l'oreille.

**Pourquoi pas whisper.cpp** : son seul atout (rester en Node sans Python) est annulé par spaCy qui amène Python de toute façon ; en échange, build CUDA Windows friable (contre R3). Gardé en repli théorique.

**Garde-fous / suites**
- Abstraction « provider STT » (local ⇄ cloud) à matérialiser en Phase 2 (couche pipeline vocal).
- Calibrage modèle + mesure latence locale : essai à blanc Phase 3.
- Deepgram : vérifier latence/prix à la source avant toute inscription chiffrée (pas encore inscrit).

---

## A6 — Détection de fin de tour : « quand Sophia se met à répondre » ✅ (2026-06-21)

**Sujet (mots simples)** : à quel moment Sophia décide que tu as fini de parler. Trop tôt → elle te coupe ; trop tard → ça traîne. C'est la brique de la vivacité.

**Décisions**
- **Architecture à 2 étages** :
  - **Garde-fou temporel = Silero VAD** — détecte le silence, impose une limite haute (fallback configurable ~2–3 s). Toujours actif.
  - **Cerveau = Smart Turn v3** (Pipecat, open source — poids + données + script) — prédit « tour fini ? » **sur l'audio** (intonation, pas la grammaire). Déclenche dès qu'il est confiant + court silence, sans attendre le fallback.
- **Emplacement = sidecar Python** (avec faster-whisper + Silero). Smart Turn v3 = **8 Mo, ~quelques dizaines de ms sur CPU** → ne touche pas la 2060.
- **Coût = 0 €** — open source self-hosted, pas de clé API, l'audio ne sort jamais. Cohérent « coûts fixes prédictibles » (nuls).
- **Abstraction « avoir le choix »** — cerveau interchangeable : Smart Turn v3 (défaut) ⇄ LiveKit turn-detector (plan B, texte) ⇄ spaCy (repli) ⇄ cloud (théorique).
- **Calibrage** (seuils silence, confiance) : essai à blanc Phase 3.

**Pourquoi pas spaCy (proposition initiale du cahier)** : dépassé — Smart Turn est plus léger (8 Mo vs ~50 Mo + pipeline NLP), plus juste (audio vs grammaire de l'écrit), aussi gratuit. Écarté de la stack (repli théorique).

**Pourquoi pas LiveKit turn-detector** : bon plan B, mais ~50–160 ms (vs ~12), plus lourd (Qwen 0,5 B, <500 Mo), basé sur le **texte** (dépend du STT en amont), licence maison. Gardé en alternative.

**Pourquoi pas le cloud (OpenAI semantic VAD)** : payant (~0,06–0,46 $/min) + clé + audio qui sort, pour une latence *pire* (+100–200 ms). Hors archi (le cerveau = Claude).

**Conséquence inter-arbitrages** : spaCy quitte la stack → formulation d'A5 ajustée ; A5 tient (faster-whisper reste le bon moteur en soi ; le sidecar regroupe faster-whisper + Silero + Smart Turn).

**Sources** (vérifiées 2026-06-21) : Smart Turn v3 — `daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms` · Smart Turn v2 — `huggingface.co/pipecat-ai/smart-turn-v2` · LiveKit turn detector — `docs.livekit.io/agents/build/turns/turn-detector` · OpenAI Realtime VAD + tarifs — `developers.openai.com/api/docs/guides/realtime-vad` / `openai.com/api/pricing`.

---

## A7 — VAD : détecter la voix (Silero) ✅ (2026-06-21)

**Sujet (mots simples)** : ce qui distingue « il y a de la voix » de « silence / bruit ». Sert à repérer le début de parole, filtrer les bruits parasites, et fournir le « silence » qu'utilise la fin de tour (A6).

**Décisions**
- **Silero VAD** confirmé — standard léger, précis, gratuit, **agnostique à la langue** (travaille sur le son, pas les mots). Déjà supposé par A6.
- **Emplacement = sidecar Python** (même chemin audio que faster-whisper + Smart Turn → un seul flux). Seuil configurable.
- **Coût = 0 €** (open source self-hosted).

**Pourquoi pas autre chose** : Silero est le standard de facto du VAD léger ; chercher ailleurs = complexité gratuite (filtre projet). Portage ONNX côté Node possible mais écarté pour garder un seul chemin audio dans le sidecar.

---

## A8 — Wake word : le « mot magique » qui réveille Sophia ✅ (2026-06-21)

**Sujet (mots simples)** : le détecteur always-on qui n'écoute que « Dis-moi Sophia », en local, et réveille le reste. Composant qui ne s'arrête jamais → légèreté + fiabilité + zéro dépendance externe priment.

**Décisions**
- **Voie = wake word open source, local, gratuit.** Moteur **tranché à l'essai à blanc** (Phase 3) sur le seul critère qui départage : la **qualité de détection en FR** (« Dis-moi Sophia »), non documentée → preuve, pas pari.
  - **LiveKit wakeword** à essayer en premier — entraînement en **1 commande**, léger, local, aligné rig ESP32 futur, même éditeur que le détecteur de tour (FR ok).
  - **openWakeWord** en alternative — plus établi (écosystème Home Assistant), mais **anglais-only officiel** (FR expérimental) + entraînement lourd (~4 Go data, GPU/Colab). Code Apache-2.0 ; modèles pré-entraînés CC-BY-NC (OK car usage **perso non commercial** — à revoir si commercialisation un jour).
- **Abstraction « avoir le choix »** : moteur interchangeable.
- **Coût = 0 €** (open/local, pas de clé, rien ne sort).
- Atout FR : phrase **longue et distinctive** (4 syllabes peu communes) → aide la détection quelle que soit la langue du modèle ; entraînement avec la **voix réelle de Yohann** recommandé.

**Pourquoi pas Porcupine (proposition initiale du cahier)** : **tier gratuit Picovoice supprimé au 30/06/2026** → essai 7 j puis payant/enterprise (prix non publié) + clé + activation périodique en ligne sur le composant always-on. Contre l'ADN du projet (gratuit / sans clé / sans dépendance réseau). Repli *théorique payant* seulement si les deux libres échouent en FR.

**Pourquoi pas figer le moteur maintenant** : le critère décisif (qualité FR) n'est pas dans les docs ; le figer à l'aveugle = facilité (R2). Tranché sur preuve (essai à blanc).

**Sources** (2026-06-21) : Picovoice fin tier gratuit (HN/Hackster) · openWakeWord (GitHub) · LiveKit wakeword (blog).

---

## A9 — TTS : la « bouche » de Sophia (synthèse vocale) ✅ (2026-06-21)

**Sujet (mots simples)** : ce qui transforme le texte de Sophia en voix parlée. Enjeux : naturel (FR), latence (streaming), coût.

**Décisions**
- **Défaut = TTS local *neural* sur GPU — Kokoro en tête** (82M params, < 2 Go VRAM, ~RTF 0,03, FR, Apache-2.0). Alternatives : Chatterbox (MIT, 23 langues, expressif) / XTTS v2 (clonage ; 6–8 Go = limite sur 6 Go). **Pas Piper** (robotique). **0 €, illimité, local.**
- **Premium optionnel = ElevenLabs** — voix de **bibliothèque** (pas de clonage), sous **cost-guard**. Non nécessaire à Sophia ; pertinent seulement si un abonnement existe par ailleurs.
- **Clonage = HORS périmètre YdvVoice** (relevait du projet YouTube séparé).
- **Choix du timbre** (dont idée « voix typée / d'actrice » + sa **légalité**) → **renvoyé à la couche Personnalité (couche 3)**.
- **Moteur local final** tranché à l'oreille (essai à blanc Phase 3) : mêmes phrases FR via Kokoro / Chatterbox / ElevenLabs → Yohann choisit.
- **Matériel** : RTX 2060 6 Go → Kokoro rentre large ; Voxtral / Qwen3-TTS (8–16 Go) écartés.

**Recadrage coût (vs cahier)** : le « ~5 $/mois ElevenLabs » corrigé → **Sophia ≈ 0 €** (local par défaut). Contexte 2026 : écart de naturel open source ↔ ElevenLabs ~0,1–0,3 MOS (quasi imperceptible en conversation) ; l'avance ElevenLabs ne reste nette que sur **voix clonées + très long format** — hors besoin de Sophia.

**Pourquoi pas ElevenLabs en défaut** : inutile sans besoin de clonage — Kokoro donne une belle voix FR gratuite et illimitée ; le mettre en défaut ramènerait coût variable + clé + texte qui sort, sans gain audible en conversation.

**Sources** (2026-06-21) : Kokoro (kokorottsai.com / tts.ai) · Chatterbox (resemble.ai) · comparatifs MOS open source ↔ ElevenLabs 2026.

---

## A10 — Recherche en mémoire : hybride mots-clés + sens ✅ (2026-06-21)

**Sujet (mots simples)** : comment Sophia retrouve un souvenir — par les mots exacts et/ou par le sens.

**Décisions**
- **Recherche hybride** : **FTS5/BM25** (mots-clés, noms propres, dates) **+ embeddings** (sens), **fusionnés par RRF** (Reciprocal Rank Fusion) — la précision des termes exacts *plus* le rappel par proximité de sens.
- **Stockage des vecteurs = `sqlite-vec`** — dans le **même fichier SQLite** (socle préservé) : pur C, sans dépendance, compatible Python **et** better-sqlite3, KNN brute-force (largement suffisant à l'échelle perso : milliers de faits), production (v0.1.x, Mozilla Builders). **0 €.**
- **Modèle d'embedding = petit modèle FR local** (dans le sidecar Python), choix final à l'essai à blanc. Tête de liste : **BGE-M3** (568M, 1024d, MIT, top multilingue FR, ~95 % des API, fait nativement dense + lexical) ; alternatives légères **multilingual-e5-base** / **gte-multilingual-base**. Tourne sur la 2060 ou CPU ; sollicité seulement à l'écriture d'un fait + à la requête (intermittent). **0 €.**
- **Abstraction « avoir le choix »** : couche de recherche abstraite (on peut désactiver le sens / changer de modèle sans réécriture).

**Coût = 0 €** (tout local). **Vie privée** : la mémoire ne quitte jamais le PC.

**Pourquoi pas FTS5 seul (cahier)** : l'argument « embeddings inutiles » valait *avant* GPU + sidecar ; les deux étant là, le surcoût du rappel par le sens est ~nul et le gain réel sur le cœur relationnel. *(Réf. interne écartée : pas le même usage vocal/conversationnel.)*
**Pourquoi pas une base vectorielle dédiée** (Chroma, Qdrant…) : sur-ingénierie pour du mono-utilisateur local ; `sqlite-vec` garde tout dans un seul fichier.

**Sources** (2026-06-21) : `sqlite-vec` (asg017/GitHub · PyPI v0.1.9) · hybrid FTS5+vec+RRF (blog Alex Garcia) · benchmarks embeddings FR 2026 (Ailog · MTEB-French).

---

## A11 — Forme des faits : langage naturel + métadonnées ✅ (2026-06-21)

**Sujet (mots simples)** : sous quelle forme Sophia range ce qu'elle apprend sur toi — rigide mais carré, ou riche mais flou.

**Décisions**
- **Fait = langage naturel concis** (riche, fidèle à la nuance), **embeddé** pour le rappel sémantique (cf. A10).
- **+ métadonnées structurées** : `category`, `importance`, `confidence`, `valid_from/to`, relation `SUPERSEDES` → filtrage (importance / récence / confiance), scoring du retrieval, cycle de vie.
- **Discipline anti-hallucination conservée** (du cahier) : confiance, `SUPERSEDES` (on remplace, on ne supprime jamais), validation à la consolidation nocturne — **sans** la camisole « triplet + vocabulaire fermé ».
- **Schéma** : la table `facts` du cahier convient quasi telle quelle (déjà `category/confidence/importance/valid_*`) → on autorise simplement le fait en langage naturel (plus de vocabulaire fermé strict sur subject/predicate/object).

**Pourquoi pas triplets stricts + vocabulaire fermé (cahier)** : rigidité + perte de nuance, pour un bénéfice (requêtabilité) désormais couvert par l'embedding (A10).
**Pourquoi pas NL pur sans structure** : on perdrait le filtrage importance/récence/confiance et la gestion `SUPERSEDES` qui évitent une mémoire contradictoire.

---

## A12 — Consolidation nocturne (« AutoDream ») ✅ (2026-06-21)

**Sujet (mots simples)** : chaque nuit, Sophia « fait le tri » dans sa journée — elle relit, synthétise, met à jour ce qu'elle sait de toi, et le range proprement. Comme le sommeil consolide les souvenirs.

**Décisions**
- **Cerveau de synthèse, selon la phase** :
  - **Phase deep (nocturne, ~3 h, 1×/nuit)** = **Claude Sonnet 4.6 via Max** (canal A1). Rare *et* critique (l'intégrité de la mémoire est en jeu) → la fidélité d'extraction prime ; à 1 appel/nuit le quota consommé est négligeable, le gain de Haiku n'achète rien.
  - **Phase micro (après chaque échange, fréquente, fire-and-forget)** = **Haiku 4.5** *si* appel LLM (volume élevé → modèle rapide/léger ; tâche simple). À confirmer au détail de cette phase.
- **Coût = 0 €** : passe par le quota Max, pas de facturation token. *(Repère tarifs API, non applicables sous Max : Haiku 1/5 $, Sonnet 3/15 $, Opus 5/25 $ par M tokens.)*
- **Abstraction « avoir le choix »** : modèle de synthèse interchangeable ; **LLM local en repli anti-quota** si le quota Max devient tendu.
- **Garde-fous (R3, « tourne sans casser »)** :
  - **Rattrapage** : PC éteint à 3 h → consolidation lancée au prochain démarrage, jamais sautée silencieusement.
  - **Opération sûre** : synthèse en **transaction** + idempotente, discipline d'A11 (confiance / `SUPERSEDES` / validation) → jamais de corruption mémoire.

**Pourquoi pas Haiku en défaut la nuit** : tâche rare et critique ; le gain quota de Haiku est négligeable à 1×/nuit, alors que Sonnet est plus fiable sur l'extraction nuancée.
**Pourquoi pas Opus** : overkill pour de la synthèse (plus de quota, sans gain proportionnel).
**Pourquoi pas l'API payante** : qualité équivalente à Max, mais payante alors que Max la couvre déjà.

**Sources** (vérifiées 2026-06-21) : modèles & tarifs Claude (référence claude-api, cache 2026-06-04).

---

## A13 — Injection de contexte : le « modèle de toi » ✅ (2026-06-21)

**Sujet (mots simples)** : ce que Sophia relit en début de chaque conversation pour te connaître dès le premier mot, sans tout refouiller.

**Décisions**
- **Injection en 3 couches, bornée** :
  1. **Portrait stable** (`user_model.md`) — qui tu es + préférences durables. **Compact et plafonné**, réécrit (pas accumulé) par la consolidation nocturne (A12).
  2. **+ faits pertinents à la volée** — récupérés par la recherche hybride (A10) selon le sujet, plutôt que tout injecter.
  3. **+ résumé des N derniers échanges** (continuité court terme, `MAX_HISTORY_MESSAGES = 20`).
- **Borné en tokens** (ne déborde jamais le contexte / le quota Max). **Local** (rien ne sort).

**Pourquoi pas tout injecter** : explose contexte + quota et noie l'important ; la recherche à la volée (A10) n'amène que le pertinent.
**Pourquoi pas « tout à la volée »** : perdrait le portrait de fond qui donne ton + cohérence avant la 1re recherche.

**Distinction** : `user_model.md` = modèle de **l'utilisateur** (couche 2). La **personnalité de Sophia** = persona séparé (couche 3).

---

## Arbitrages à venir (ordre des dépendances)

**✅ Couche 1 — Pipeline vocal (A5–A9). ✅ Couche 2 — Mémoire (A10–A13).** Reste :
1. **Personnalité de Sophia** : persona (caractère, ton, valeurs, limites, humour, cohérence dans le temps) + continuité via la mémoire + choix de la voix (**timbre** ; option voix typée + **légalité du clonage** à vérifier). *(Gap du cahier détecté à l'audit conv 2 — à traiter en profondeur.)*
2. **Moteur proactif** + garde-fous anti-spam.
3. **Architecture process** (Electron + Node + sidecar Python).
4. **Coût global réel** (recadrage du « ~5 $/mois »).
