> **DÉCISION CENTRALE conv 25 ouverture** : **Voie A CONFIRMÉE par Yohann (clôture conv 24)** = **finir le pipeline vocal** — **STT** faster-whisper **FR** (transcription juste + vive) · **fin de tour** Smart Turn v3 (répondre au bon moment) · **CHOIX DE SA VOIX à l'oreille** (TTS Kokoro ⇄ Chatterbox, timbre A20 — *le moment où sa voix devient réelle*) · **banc bout-en-bout I-6** (micro → AEC → wake → STT → fin de tour → cerveau-stub → TTS streamé ; latence wake→premier mot). Les deux 🔴 sont tombés (AEC conv 23 · wake FR conv 24 — prouvé à la voix, **DONE pour l'usage réel micro-porté**). *(Voie B — contenus identitaires ENSEMBLE, *le cœur* — **reportée**, au choix de Yohann plus tard.)*

# RELAY conv 25 — après les deux 🔴 (l'essai à blanc, suite)

> Base écrite en clôture de conv 24 (Opus). Prompt de passation intra-projet, lu à contexte frais. **Zéro donnée perso.**

## Ce qui s'est passé — conv 24 (🔴 n°2 wake FR DÉRISQUÉ & PROUVÉ)
- **Wake word « Sophia » français entraîné + prouvé à la voix de Yohann.** Moteur **`livekit-wakeword`** (conv-attention/ONNX, A8), py3.13 / RTX 2060 / torch 2.6+cu124. Mur d'install `editdistance` (pas de wheel cp313) franchi **py3.13-natif** : compile sous `vcvars64` + `DISTUTILS_USE_SDK=1` + `--no-build-isolation`. *(triton 3.7 incompatible torch 2.6 → `torch.compile` inutile.)*
- **Méthode « E » (LA découverte)** : VoxCPM déduit la langue du **texte** → « Sophia » seul (court, ambigu) sort en anglais/accent aléatoire (constaté à l'oreille de Yohann). **Solution** : générer une **référence française** (phrase complète) puis « Sophia » en **continuation** (`prompt_wav_path`+`prompt_text`) → voix/accent/genre FR hérités. **`retry_badcase=False` + 6 pas de diffusion → ~6 s/clip** (le `retry`, faux-positif sur mot court, coûtait ~40 s → « plusieurs jours » de run était un faux problème).
- **Modèle final** = 1000 clips synthétiques FR + **231 de la VRAIE voix de Yohann ×3** (77 uniques, conditions **près/doux/loin**, A8) + négatifs FR à **confusables proches sur-représentés** (Sonia/Sophie/sosie, ~50 %, défense F6). Run de génération de nuit (~6 h, décidé par Yohann ; ~0,40 € électricité, 0 quota Max).
- **Preuve à la voix de Yohann (le vrai juge) : 6/6 des « Sophia » détectés à seuil ~0,25–0,30, ZÉRO faux** (parole normale + confusables ≤ 0,06). L'enrichissement voix réelle (A8) a **remonté le recall de ~0,15–0,20** (6/6 à 0,30 au lieu de 0,12 sans elle). Éval synthétique : AUT=0,0017 · FPPH=0,00 @ 0,5.
- **Décisions gravées (`plan/01` §7)** : **F6 = PASSÉ, repli nommé NON nécessaire** (reste spécifié, non activé) · **seuil retenu ≈ 0,25–0,30** (calibration par utilisateur) · périmètre prouvé = **à la voix, au micro**. **Précision Yohann (post-clôture conv 24)** : usage réel = **micro porté au cou** (near-field constant qui bouge avec lui, équivalent « casque » du design) → la preuve **EST représentative de l'usage réel** ; le **rig far-field multi-micros (passe #5) est OPTIONNEL, pas un bloquant** (seulement si un jour il veut se passer du micro porté). → **le 🔴 wake FR est DONE pour l'usage réel de Yohann.**

## L'état du banc (jetable — CF2, ne pas confondre avec le produit)
- `bancs/aec/` (gitignoré via `bancs/`). Scripts wake : `gen_fr_big.py` (génération FR méthode E, nettoyée) · `record_sophia.py` (enregistrement voix, mode ajout) · `voice_test.py` / `voice_test_autres.py` (test détection live, pointe `sophia_fr.onnx`) · `diag_lang.py` / `speed_voxcpm.py` / `smoke_voxcpm.py` (diagnostics). Config `sophia_fr.yaml` (gros run) · `sophia_fr_test.yaml` (preuve).
- **Modèle** : `bancs/aec/wake/output/sophia_fr/sophia_fr.onnx` (+ éval `.json`, DET `.png`). **Voix réelle de Yohann** : `bancs/aec/wake/realvoice/` (77 clips — **données perso, STRICTEMENT dans le banc gitignoré, JAMAIS committées**). Poids VoxCPM2 (~5 Go) + MUSAN + features : `bancs/aec/wake/data/`.
- venv `bancs/aec/.venv` (Python 3.13, `livekit-wakeword[train,eval,export,voxcpm]` + torch 2.6+cu124 + triton-windows). Le banc **se lit pour reprendre, ne se grave pas** (CF2).
- **Environnement** : Node 24.13 · Python 3.13 (+ 3.14) · RTX 2060 6 Go · VS Build Tools 2022 (toolset C++ présent).

## Tâches conv 25 — Voie A CONFIRMÉE (finir le pipeline vocal)
**Le plan de conv 25** (ordre indicatif ; Claude tranche le micro-technique + trace §7) :
1. **STT — faster-whisper FR** : modèle `medium`⇄`large-v3` int8 ; **transcrit ta voix française juste et vite** ; latence streaming réelle sur la 2060 ; langue **verrouillée FR** (pas d'auto-bascule anglais).
2. **Fin de tour — Smart Turn v3** : décide **quand tu as fini de parler** (ni te couper, ni traîner) ; seuils + ratio fallback/smart-turn ; plafond tient même si le modèle crashe.
3. **SA VOIX — TTS** : écouter **plusieurs voix françaises** (Kokoro ⇄ Chatterbox) → **Yohann choisit son timbre à l'oreille** (A20 : la voix porte son caractère — chaleur, vivacité, malice ; **zéro clonage**) ; latence 1re phrase ; découpe par phrases streamée.
4. **Banc bout-en-bout I-6** : micro → AEC → wake → STT → fin de tour → **cerveau-stub** → TTS streamé ; mesurer la **vivacité** (wake → premier mot). **Le squelette « je l'appelle, elle m'entend, elle me parle » qui tourne.**
- **Confirmer le micro / le son avant chaque test** (leçon 4). Moteurs STT/turn/TTS **non gravés** (A5/A6/A9) → Claude tranche + trace §7.
**Voie B — REPORTÉE (au choix de Yohann, plus tard) : contenus identitaires ENSEMBLE (*le cœur*)** : prompt de consolidation v1 · banc de dilemmes v1 · amendements pré-boot persona · seuils de tempérament (mémoire `identity-content-fait-ensemble` : séquencé, fait ENSEMBLE, jamais un vague « Phase 3 »).
**Loose ends (sur Go)** : portages `technique/` §7 (convs 16→21, en un bloc) · bench AEC neuronal ONNX (optionnel, Speex-16k déjà prouvé) · `plan/00` §7 « Python vs Java » (coquille idiome interne, avant de graver la supervision T3).

## Lectures pilote (avant toute action, dans l'ordre)
`docs/PATTERN…` → `CLAUDE.md` (v24) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — gardée en tête) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `docs/technique/01-pipeline-vocal.md` (§2 chemin audio · §4 séquences) → `docs/plan/01-pipeline-vocal.md` (**§7** — preuves AEC + wake tracées ; V4 STT · V5 fin de tour · V7 TTS pour la Voie A) → ce relais. *(Banc `bancs/aec/` jetable — lire pour reprendre.)*

## Vigilances (rappel)
- **Phase 3 = traduire, jamais rouvrir** · **le banc est une PREUVE, jamais le produit** (CF2) · le vrai sidecar ré-implémente (audit croisé alors). Moteurs STT/turn/TTS **non gravés** (laissés à l'essai, A5/A6/A9) → Claude tranche le micro-technique + trace §7, ne fait pas re-choisir Yohann.
- **Croisé 2 agents** = au moment de graver conception/**code produit** (proposé d'office, sur Go) — **pas** pour un banc jetable (solo de fidélité, précédents convs 22/23/24).
- **Actions sur l'environnement** (jouer du son, ouvrir le micro) : **confirmer d'abord** (leçon 4).
- **Ce n'est PAS à moi de gérer le temps/budget de Yohann** : je conseille le technique, il décide le timing. **Pas de mode économe.** **Honnêteté > plaire** (estimation optimiste conv 24 reconnue sans fard).
- **« Optimal ≠ tout refaire par principe »** (recadrage conv 24) : mettre l'effort là où il paie, pas rejouer l'excellent.
- **Repo public — PROPRETÉ AVANT COMMIT (exigence Yohann conv 24)** : `git status` = seulement les docs, **zéro `bancs/`**, **zéro voix réelle / poids / secret**, gitleaks + garde contenu OK. **Commit au fil / push en clôture** · identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**.
