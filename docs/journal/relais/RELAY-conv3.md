> **DÉCISION CENTRALE conv 3 ouverture** : Ouvrir la **couche 3 — Personnalité de Sophia** (le gap du cahier détecté en conv 2), à traiter **en profondeur**. Premier sous-arbitrage proposé : **qu'est-ce qui définit « qui est Sophia »** — son **persona** (caractère, ton, valeurs, limites, humour, cohérence dans le temps), écrit comme un texte de cadrage **distinct** du « modèle de toi » (mémoire, couche 2) et du **moteur** d'expression (A2 = Sonnet 4.6). Puis enchaîner : continuité via la mémoire → **choix du timbre de voix** (+ **légalité du clonage** d'une voix réelle, à vérifier à la source : CGU ElevenLabs + droit FR).

# RELAY — Ouverture conversation 3 · YdvVoice (Sophia)

## 0. En une phrase
Conv 2 a poussé l'audit Phase 1 à fond : **couches 1 (pipeline vocal) et 2 (mémoire) entièrement tranchées** (A5 → A13), tout en **local à 0 €**. On ouvre la **couche 3 — Personnalité de Sophia**.

## 1. Lectures pilote au démarrage (intégrales — R4, dans l'ordre)
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` *(privé — présent en local, hors dépôt)* → `CLAUDE.md` (racine) → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md`. Puis ce RELAY.

## 2. Projet
Sophia = assistant vocal perso 100 % mains-libres basé sur Claude. Solo (Yohann / YdvSystems). Profil **Standard**. Cap coût : Max existant en priorité, **petit budget toléré seulement pour la vivacité (voix)**. Robustesse « tourne en continu sans casser ».

## 3. État à l'ouverture conv 3
- **Fondations** : A1 (canal d'action Claude Code/Max) · A2 (voix Sonnet 4.6 configurable) · A3 (diffusion repo public + pattern privé) · A4 (sécurité gitleaks).
- **✅ Couche 1 — Pipeline vocal (A5–A9)** : wake word (openWakeWord/LiveKit, moteur FR à l'essai) · VAD (Silero) · STT (faster-whisper) · fin de tour (Smart Turn v3) · TTS (Kokoro local ; ElevenLabs premium optionnel). **100 % local, 0 €, sans clé, sidecar Python.**
- **✅ Couche 2 — Mémoire (A10–A13)** : recherche hybride FTS5 + `sqlite-vec` · faits en langage naturel + métadonnées · consolidation nocturne (Sonnet 4.6 via Max ; Haiku en micro) · injection de contexte bornée (portrait `user_model.md` + faits à la volée + résumé N derniers échanges). **Local, 0 €.**
- **Restent à auditer** : **3 Personnalité** (prochaine, en profondeur) · 4 Moteur proactif · 5 Architecture process · 6 Coût global réel.
- **Non figé** : arborescence applicative (attend la fin des arbitrages).

## 4. Décisions actées conv 2 (résumé — détail dans `docs/journal/JOURNAL-ARBITRAGES.md`)
- **A5 STT** — défaut Whisper local (faster-whisper, sidecar Python) ; échappatoire Deepgram cloud par config ; matériel RTX 2060 6 Go + i5 + 32 Go.
- **A6 Fin de tour** — 2 étages : Silero VAD (garde-fou silence) + **Smart Turn v3** (cerveau, audio, FR, 8 Mo CPU, 0 €). spaCy écarté.
- **A7 VAD** — Silero confirmé, sidecar Python, agnostique langue, 0 €.
- **A8 Wake word** — open/local/gratuit ; moteur tranché à l'essai à blanc (LiveKit-first ⇄ openWakeWord) ; **Porcupine écarté** (tier gratuit Picovoice supprimé 30/06/2026).
- **A9 TTS** — défaut **local neural (Kokoro)** 0 € ; ElevenLabs premium optionnel sous cost-guard ; clonage hors scope YdvVoice ; choix du **timbre → couche 3**.
- **A10 Recherche mémoire** — hybride FTS5/BM25 + embeddings (`sqlite-vec`, RRF) ; modèle FR local (BGE-M3 en tête) à l'essai ; 0 €.
- **A11 Forme des faits** — langage naturel + métadonnées structurées (catégorie/confiance/importance/`valid_*`/`SUPERSEDES`) ; triplets stricts écartés.
- **A12 Consolidation nocturne** — Sonnet 4.6 via Max (deep, 1×/nuit) ; Haiku en micro ; garde-fous rattrapage + transaction.
- **A13 Injection de contexte** — 3 couches bornées : portrait `user_model.md` + faits à la volée (A10) + résumé N derniers échanges.

## 5. Périmètre conv 3 — couche 3 (Personnalité de Sophia)
Le gap du cahier : il décrit la *voix* (A2, féminine FR) et des comportements, mais **pas qui elle est**. À traiter **en profondeur**. Ordre proposé (un par un) :
1. **Persona** : caractère, ton, valeurs, limites, humour, cohérence dans le temps — un texte de cadrage (≈ « system prompt » de Sophia), **distinct** du `user_model.md` (= modèle de **toi**, couche 2) et du **moteur** d'expression (A2 = Sonnet 4.6).
2. **Continuité relationnelle** : comment le persona s'appuie sur la mémoire pour rester cohérent.
3. **Choix du timbre de voix** : quelle voix exactement (bibliothèque ElevenLabs ⇄ voix locale ⇄ clone *consenti*) + **légalité** du clonage d'une voix réelle — **à vérifier à la source** (CGU ElevenLabs : clonage pro = sa propre voix ; droit FR : la voix est un attribut de la personnalité).
Inscrire chaque décision dans `docs/journal/JOURNAL-ARBITRAGES.md`.

## 6. Règles actives (non négociables)
R1 zéro agent (sauf audits 2 agents) · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » · R8 un par un · R9 RELAY en fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · séparation cahier/journal.

## 7. Vigilances conv 3
- **Plan mode harness** : peut se redéclencher à l'ouverture sur ce RELAY → gérer en **texte libre, jamais d'AskUserQuestion** (géré ainsi en conv 2).
- **Personnalité = sujet riche et sensible** : à fouiller (Yohann l'a demandé), un par un, sans sur-cadrer ni déborder vers le perso de Yohann.
- **Légalité clonage voix** : terrain juridique → **vérifier à la source** (CGU + droit FR), ne pas trancher seul ; je ne suis pas juriste.
- **Choix « exacts » différés à l'essai à blanc (Phase 3)** : moteur wake word (FR), modèle Whisper, moteur TTS local (Kokoro vs XTTS), modèle d'embedding FR. Tranchés sur preuve — cadrer l'essai à blanc le moment venu.
- **Quota Max partagé** : action + voix + consolidation ; le **proactif** (couche 4, boucle de fond) pourrait peser → surveiller.
- **Repo PUBLIC** : zéro secret committé (hook gitleaks ; secrets en `.env`). Sur un clone : `git config core.hooksPath .githooks`.
- **`--bare`** (A1) : ne jamais l'utiliser. Discipline IN PLACE + RELAY en clôture.

## 8. Statut commit
À la clôture conv 2 : travail (9 arbitrages inscrits + MAJ CLAUDE.md/IMPLEMENTATION/RELAY) **en attente de validation** pour commit `[conv-2]` (R5). Si commité : repo à jour à l'ouverture conv 3.

## 9. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un arbitrage à la fois** → reco + « pourquoi pas » → **validation avant tout commit** (`[conv-3]`) → RELAY en fin de session.
