> **DÉCISION CENTRALE conv 24 ouverture** : **entraîner le modèle wake word « Sophia » en français** (moteur **livekit-wakeword**, tranché conv 23) — install lourde `[train]`(~2 Go torch)+`[voxcpm]`, données FR synthétiques, **60 000 pas** sur la RTX 2060, export ONNX — **puis le tester avec la VRAIE voix de Yohann** (A8 : jamais SAPI seul). Preuve visée : « Sophia » porté par une phrase, **taux de faux réveils bas** (tension F6), ou **repli nommé**. Le harnais de détection/éval est déjà validé.

# RELAY conv 24 — le wake word FR (🔴 n°2 : entraîner + prouver « Sophia »)

> Base écrite en clôture de conv 23 (Opus). Prompt de passation intra-projet, lu à contexte frais. Zéro donnée perso.

## Ce qui s'est passé — conv 23 (🔴 n°1 M1/AEC INTÉGRALEMENT DÉRISQUÉ + 🔴 n°2 wake : moteur décidé & validé)

**M1 / AEC — bouclé et tracé (`plan/01` §7, 3 notes, committé `[conv-23]`) :**
- **Temps 2 — l'annulation (preuve I-1) ACQUISE**, en conditions réelles (barre de son HDMI + micro USB). **Écho seul** : résidu au bruit de fond, activité ~0 %, **ERLE ~30 dB** → elle ne se coupe pas elle-même, zéro fantôme. **Double-parole** : voix de Yohann **préservée −3,5 dB (67 %)**, média annulé — **confirmé à l'oreille par Yohann**. Temps réel ~0,4 ms/trame.
- **Décision moteur (micro-technique tranchée, tracée §7) : AEC primaire = SpeexDSP à 16 kHz** (via `pyaec`, DLL prête). **AEC3 écarté** (aucun binding maintenu Windows/py3.13 ; build C++ = dette de maintenance, contre R3). **Prise `aec` laissée ouverte pour un AEC neuronal ONNX** en upgrade si besoin réel mesuré (coût VRAM).
- **Écart clé tracé** : SpeexDSP **sur-supprime le proche à 48 kHz** (perte ~22 dB au passthrough réf-zéro ; propre à 16 kHz) → **l'AEC tourne à 16 kHz** (le design voulait 16 k en aval de toute façon ; `technique/01` §2.1 à raffiner : conversion 16 k À/AVANT l'AEC pour un moteur famille-Speex). Findings : barre de son ~150 ms de latence → **queue de filtre ≥ 200 ms** ; l'AEC mérite une **prise `aec` formelle** au §2.3.
- **Cas durs M1 confirmés empiriquement** (avec témoins) : **flux exclusif échappe au loopback** (−97 dBFS = silence, 0,2 %) → sidecar doit détecter+signaler ; **changement de périphérique** (TV [10]/[13] → Focusrite [15]/[20]) → sidecar doit s'abonner (IMMNotificationClient) + **ré-ouvrir** le loopback ; **piège** : PyAudioWPatch cache l'énumération à l'init.
- **Leçon dure conv 23** : mon choix « 48 kHz natif » était une **erreur** qui a **faussé mes chiffres** (double-parole « −13 dB » = artefact 48 k, corrigé à 16 k = −3,5 dB). Je l'ai attrapée en **vérifiant à la source** (test passthrough) avant de conclure. **Recadrage de Yohann tenu** : *ce n'est pas à moi de gérer son temps* — je conseille sur le **mérite technique**, il décide du reste ; et je **tranche le micro-technique** (le moteur AEC/wake n'était PAS gravé — laissé à l'essai comme A5/A8) au lieu de lui faire re-choisir.

**Wake FR (🔴 n°2) — moteur DÉCIDÉ + VALIDÉ (rien de gravé — banc en cours) :**
- **Décision (tranché) : moteur primaire = `livekit-wakeword`** (A8 « LiveKit wakeword » **confirmé à la source** : bâti sur openWakeWord mais **conv-attention → 100× moins de faux positifs/h**, **multilingue 30+ langues dont le FR** via données synthétiques VoxCPM, **entraînement 1 commande**, export ONNX). **openWakeWord = fallback compatible.** **Porcupine = repli payant** (Picovoice gratuit supprimé, A8).
- **Installé dans le venv** (`bancs/aec/.venv`, Python 3.13) : `livekit-wakeword` 0.2.1 (module `livekit.wakeword` ; CLI `livekit-wakeword train <config.yaml>`) · `openwakeword` 0.6.0 (+ modèles base & pré-entraînés **téléchargés** : alexa/hey_jarvis/hey_mycroft…) · `sounddevice` 0.5.5 (mode exclusif WASAPI) · `scipy` 1.18 · `onnxruntime`.
- **Moteur validé sur la machine** : détection ONNX tourne, **discrimine bien** (clip SAPI « Hey Jarvis » → hey_jarvis 0,28 le plus haut, tous les autres + la parole environnante ~0,00 = **zéro faux déclenchement**). **MAIS** 0,28 < seuil 0,5 car la **voix SAPI robotique** ≠ distribution d'entraînement → **la vraie voix de Yohann scorera bien plus haut** (A8 : test/entraînement avec sa voix réelle).
- **API inférence** : `WakeWordModel(models=[...onnx]).predict()` ; base feature-models (`melspectrogram.onnx`+`embedding_model.onnx`) fournis dans `livekit.wakeword.resources`. Sous-modules utiles : `training`, `eval`, `export`, `inference`.

## Tâches conv 24, dans l'ordre (un par un, clos avant le suivant)
1. **Obtenir le modèle « Sophia »** : installer `pip install "livekit-wakeword[train,voxcpm]"` (**torch ~2 Go** + torchaudio + audiomentations + cmudict/nltk/pronouncing + voxcpm) · générer/config YAML pour la phrase **« Sophia »** en **français** (cf. `livekit-wakeword train --help` + docs training) · lancer l'entraînement (60k pas, RTX 2060 — **run long, en tâche de fond**) · export ONNX. *(Vérifier la faisabilité torch+voxcpm sur py3.13/Windows — comme pour l'AEC, chaque mur informe ; repli openWakeWord `[train]` si voxcpm coince.)*
2. **Tester « Sophia » avec la voix de Yohann** (banc de détection — a besoin du **micro** → confirmer avant, comme pour l'AEC) : « Sophia » porté par des phrases variées (à froid / à chaud) · **taux de faux réveils** sur parole normale + TV · seuil de détection.
3. **Trancher F6** : si « Sophia » (2 syllabes) fait trop de faux réveils → **repli nommé** (formules longues « Bonjour/Dis-moi/bonne nuit Sophia » à froid ; nom seul à chaud). Tracer le verdict `plan/01` §7.

## Loose ends (sur Go de Yohann)
- **Bench AEC neuronal ONNX vs Speex-16k** (optionnel — seulement si un besoin réel de double-parole dure apparaît ; Speex-16k déjà prouvé suffisant).
- **Portages `technique/` §7** (accumulés convs 16→21, en un bloc) — inchangés, sur Go ; `technique/` reste acquis.
- **Contenus identitaires ENSEMBLE** (jamais un vague « Phase 3 ») : prompt consolidation v1 · banc de dilemmes v1 · amendements pré-boot persona · seuils de tempérament. Non entamés.
- Rappel `plan/00` §7 : « Python vs Java » (coquille idiome interne) à trancher avant de graver la supervision T3 (build produit, plus tard).

## L'état du banc (jetable — ne pas confondre avec le produit)
- `bancs/aec/` (gitignoré via `bancs/`). Scripts : `01_probe_devices.py` · `02_capture_aligned.py` (Temps 1) · `03_aec_cancel.py` (AEC, **16 kHz**, capture+process, toggle preprocess) · `04_exclusive_escape.py` · `05_device_change.py`. Captures WAV dans `captures/`. venv `.venv` (Python 3.13.2). **Le banc se lit pour reprendre, ne se grave pas** (CF2).
- **Environnement** : Node 24.13 · Python 3.13 · RTX 2060 6 Go · VS Build Tools 2022.

## Lectures pilote (avant toute action, dans l'ordre)
`docs/PATTERN…` → `CLAUDE.md` (v23) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — gardée en tête) → `JOURNAL-ARBITRAGES.md` (surtout **A8** wake word) → `IMPLEMENTATION.md` → `docs/technique/01-pipeline-vocal.md` (§4.2 réveil rétroactif, §7 F6) → `docs/plan/01-pipeline-vocal.md` (**V3 wake · §6/§7** — le banc y est tracé) → ce relais. *(Le banc `bancs/aec/` est jetable — lire pour reprendre.)*

## Vigilances (rappel)
- **Phase 3 = traduire, jamais rouvrir** · **le banc est une PREUVE, jamais le produit** (CF2). Le moteur wake **n'est PAS gravé** — laissé à l'essai (A8) ; je le tranche + trace §7, je ne fais pas re-choisir Yohann.
- **Croisé 2 agents** = au moment de graver **conception/code produit** (proposé d'office, sur Go) — **pas** pour un banc jetable (solo de fidélité suffit ; conv 22 & 23 l'ont sauté à juste titre).
- **Actions sur l'environnement** (jouer du son, ouvrir le micro) : **confirmer d'abord**.
- **Ce n'est PAS à moi de gérer le temps/budget de Yohann** (recadrage conv 23 — accroc répété) : je conseille sur le **technique**, il décide du timing. **Pas de mode économe.**
- **Anti-flagornerie** · **honnêteté > plaire** (dire la trajectoire sans fard, reconnaître mes erreurs — l'artefact 48 k reconnu) · **R5** (rien de committé sans son mot) · **R7** (reco + « pourquoi pas ») · **R8** (un par un).
- **F6** : « Sophia » 2 syllabes = cible courte → faux réveils = le vrai risque ; repli nommé prêt.
- **Commit au fil / push en clôture** · repo public (garde par contenu · gitleaks · pas de Co-Authored-By · `Yohann Dandeville <contact@ydvsystems.com>`).
