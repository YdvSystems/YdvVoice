# CONV 30 (en cours) — Carrefour VOIX / streaming · état AVANT compactage

> État intermédiaire (Yohann compacte la conversation pour continuer). À consolider au §7 de `plan/01` + `CLAUDE.md` à la **clôture** (pas encore committé). Zéro donnée perso. Bancs **jetables** (CF2, gitignorés). **1re ligne / prochaine étape : tester le PIPELINE COMPLET cerveau + XTTS.**

## Le fil de conv 30 (ce qu'on a fait)
1. Parti de l'endpointing + latence (`RELAY-conv30.md`). Attaqué la **latence (mur ②)** par la mesure : bancs `oreilles_live`/`bouche_live` instrumentés (chronos par tour).
2. **Diagnostic latence** : le vrai problème n'est PAS le cerveau chaud (ctx 0→3k, pas de dérive) ni une file qui déborde. C'est **la génération TTS phrase-entière** (on fabrique toute la phrase avant de la jouer → pour une phrase longue ~10 s de fabrication avant le 1er son).
3. **Train d'avance** (banc `13_train_avance_reel`, 10 vraies réponses du cerveau) : le trou **« phrase courte → phrase longue » est FRÉQUENT (30 %)**, pire 5 s. Frappe surtout le registre **conversationnel** (accroches courtes « Bonjour ! » suivies d'une longue).
4. **Co-résidence GPU** = artefact du banc : Chatterbox seul RTF ~0,87 ; STT+Chatterbox ensemble RTF ~2. Le design (`01` V11 alternance : décharger le STT pendant qu'elle parle) le corrigerait, non implémenté au banc.
5. **Le coussin de pré-génération = ÉCARTÉ** (Yohann : « on camoufle un vrai problème, pas de pansement »). Le **VRAI levier = un TTS qui STREAME nativement** (jouer le son AU FIL de la fabrication → 1er son en une fraction de seconde, plus de blanc).
6. **Chatterbox (A20 actuel)** : streaming **pas exposé** dans l'API `ChatterboxTTS.generate` (fait tout en bloc ; le backbone T3 génère tous les jetons d'abord). Les briques existent (`S3GenStreamer`, flow `finalize`) mais **à assembler = chantier** (le `S3GenStreamer` de référence manque même de notre install).
7. **jarvis-OS exploré** (github Grominet95/jarvis-OS) : bâti sur **LiveKit Agents** (framework temps réel : TTS streaming + barge-in + écho + tour de parole **natifs**) + TTS streamables (**Piper**, **ElevenLabs**). Idées mémoire (facts atomiques). Leçon : les assistants fluides = framework + **TTS streamable**.

## Le CARREFOUR VOIX — OUVERT (touche A2/A9/A20 → Yohann décide)
| Moteur | Timbre | Vitesse (2060) | Streame ? | Défaut |
|---|---|---|---|---|
| **Chatterbox** (A20 actuel) | **parfait** (le choisi) | RTF ~0,87 (seul) | non exposé (chantier) | lent + streaming à assembler |
| **Piper** (siwis, upmc/Jessica) | **en-dessous** d'A20 (Yohann) | **RTF 0,04-0,15**, CPU (libère le GPU) | **oui, natif** | timbre moindre ; FR plafonné *medium* (2 voix fém., pas de *high* FR — `upmc-high` = 404) |
| **XTTS-v2** (clone la réf A20) | **BEAU** (« pas mal du tout, la voix est belle » — Yohann) | RTF ~0,43-0,55, GPU (CUDA OK) | **oui, natif** | **artefacts « démoniaques »** dans les **silences/fins** (prennent la place de la voix) — défaut connu XTTS, **traitable par trim**, pas garanti 100 % |

**Prise `tts` interchangeable** (`01`-F/V0) → changer de moteur = **config + respawn, zéro reprise**. Le carrefour n'engage rien d'irréversible.

## ⭐ PROCHAINE ÉTAPE (décidée par Yohann) — à faire à la reprise
**Tester le PIPELINE COMPLET : cerveau (WarmBrain) + voix XTTS**, en vraie conversation.
- Brancher XTTS (venv `.venv-xtts`) dans une variante de la bouche (à la place de Chatterbox), même protocole socket → `oreilles_live` s'y connecte sans changement.
- **Gérer les artefacts** : comme ils sont dans les **silences/fins**, appliquer un **trim / détection de silence en fin de segment** (les couper). Phrases courtes générées à la volée = XTTS sous son meilleur jour.
- Juger en réel : **timbre** (tient-il ?) · **artefacts** (gérables ?) · **fluidité** (zéro blanc via le débit RTF 0,5 + streaming).
- Si XTTS propre en réel → candidat sérieux (ton timbre + fluidité). Sinon → trancher Piper (propre/timbre-moindre) vs effort Chatterbox.

## État technique des bancs (CF2, `bancs/aec/`, gitignoré)
- **Venvs** : `.venv` (oreilles, py3.13) · `.venv-cbg` (Chatterbox/bouche, py3.12) · `.venv-piper` (Piper, py3.12) · `.venv-xtts` (coqui-tts 0.27.5 + **torch cu124** + **transformers<5** [le pin qui débloque `isin_mps_friendly`], py3.12).
- **Scripts** : `12_train_avance.py` (train d'avance Chatterbox voix seule) · `13_train_avance_reel.py` (trous sur vraies réponses → verdict FRÉQUENT/30 %) · `14_piper_test.py` (Piper, **arg = nom de voix**) · `15_xtts_test.py` (XTTS clonage, **pré-gén + anti-artefacts** `temperature=0.6`/`repetition_penalty=6.0`/`enable_text_splitting`).
- **Modèles** : Piper `fr_FR-siwis-medium` + `fr_FR-upmc-medium` dans `piper_voices/` · XTTS-v2 en cache HF (~1,8 Go) · Chatterbox-FR (bouche_live) · **référence A20** = `tts_out/SOPHIA_voix_reference_v1.wav` (7,5 s, 48 kHz, mono — durée correcte).
- **Lancer** : `bouche_live.py serve` (.venv-cbg) + `oreilles_live.py loop claude 120` (.venv). Mic porté **[12]** · sortie/loopback TV **[13]**.
- **Piège orphelins** : `Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'bouche_live|oreilles_live|train_avance|xtts|piper|assistant vocal francophone' }`.

## CHANTIERS RESTANTS (au-delà du choix de voix)
- **TTS** : trancher le moteur (carrefour) + le **brancher en streaming** (le vrai fix des blancs).
- **BARGE-IN / tour de parole** (« elle repart quand je parle », « on ne sait pas quand elle a fini ») = **V6 speaker-ID + V8**, chantier **SÉPARÉ** (pas réglé par le TTS). Difficulté conçue = **la distinguer d'elle-même** (speaker-ID vs sa propre voix résiduelle — déjà tracé §7 conv 29 « dormant »). **La brièveté = écartée** (pas un problème pour Yohann).
- **Endpointing** (elle coupe Yohann sur ses phrases longues) = pas encore traité.
- **À graver §7 `plan/01`** (à la clôture) : trou train-d'avance courte→longue FRÉQUENT · co-résidence GPU (artefact banc, V11) · carrefour voix + écart moteur si on change (A9/A20).

## LEÇONS DE MÉTHODE (conv 30)
- **NE PAS BRICOLER** : le coussin était un **camouflage** du vrai problème (génération phrase-entière). Yohann l'a arrêté à raison.
- **MESURER avant de conclure** (le diagnostic a démasqué la co-résidence + le train d'avance).
- **PROUVER, pas promettre** : accroc reconnu (« je t'avais dit pas de blanc » — le design le promettait, la mesure a montré le trou). Le vrai levier fluidité = **streaming natif**, jamais un coussin.
