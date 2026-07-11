> **DÉCISION CENTRALE conv 23 ouverture** : **poursuivre l'essai à blanc — le Temps 2 du banc AEC : l'annulation d'écho** (WebRTC AEC3 ⇄ SpeexDSP). Prouver qu'**elle ne se coupe jamais elle-même** quand un média/sa voix joue (`plan/01` I-1) — avec un **signal audible** + la **config de sortie réelle** de Yohann (donc sa présence : enceintes/casque). Puis les cas durs (changement de périphérique · flux exclusifs), puis le 2ᵉ 🔴 (**wake word FR**). Le **Temps 1 (dérive d'horloge) est prouvé** — la partie classiquement la plus dure de M1 est gérée par Windows en mode partagé.

# RELAY conv 23 — le banc AEC, Temps 2 (l'annulation)

> Base écrite en clôture de conv 22 (Opus). Prompt de passation intra-projet, lu par la session de conv 23 (contexte frais). Zéro donnée perso.

## Ce qui s'est passé — conv 22
- **Tâche 1 close — vérif de l'audit corpus de Fable, aux sources (posture croisé).** Les 10 findings FC-1→FC-10 recoupés sur 3 sources (synthèse `AUDIT-fable-corpus.md` · texte vivant des plans · **diffs git réels** `f40a587` + `c530720`) : **tous appliqués, cohérents, fidèles** ; récap §3 = fichiers réellement modifiés ; seule note source (`technique/03` §4.6) bien portée ; aucun `technique/`/`prive/` touché à tort. **Corpus verrouillé, confirmé.**
- **Tâche 2 OUVERTE — l'essai à blanc / banc audio (priorité n°1).** Orientation validée par Yohann : **dérisquer les deux 🔴 par des bancs Python jetables (CF2), l'AEC en premier** (M1), avant tout build de production. Banc monté : `bancs/aec/` (gitignoré), **venv Python 3.13**, **PyAudioWPatch** (loopback WASAPI natif) + numpy/soundfile.
  - **Sonde 01** (`01_probe_devices.py`) : le **loopback système est capturable** ✓. Micro `[12] USBAudio1.0` (mono 48k, USB) · sortie par défaut `[10] webOS TV / NVIDIA HDMI` (stéréo 48k) · loopback `[13]`.
  - **Sonde 02** (`02_capture_aligned.py`, callbacks robustes, joue un signal inaudible + capture micro+loopback) : **Temps 1 PROUVÉ** — sur 90 s, écart `loopback−micro` **constant** (+480 frames ≈ 10 ms), dérive **+3.4 ppm sous plancher ±10 ppm → horloges VERROUILLÉES**. Cause : **mode partagé WASAPI** cadence les deux flux sur une horloge commune → déjà alignés. **Le resampling adaptatif anticipé n'est PAS nécessaire dans le chemin normal** ; reste un **délai fixe** (~10 ms, estimé une fois par l'AEC). Tracé **`plan/01` §7** (validé par Yohann).
- **Pas de croisé 2 agents** (décision, discutée honnêtement) : rien de conception gravé, banc **jetable** (rituel sans substance sinon) ; le résultat est **contre-vérifié empiriquement** (2 méthodes + plancher + 90 s + bug de métrique attrapé). Le vrai moment d'audit = quand on gravera du **code produit** (le vrai sidecar) ou de la conception — à froid, prochaine(s) conv.
- **Résidu corrigé au passage** : l'en-tête *Statut* de `plan/01` disait « audit croisé à venir » (le croisé conv 14 était fait) → corrigé.

## L'état du banc (jetable — ne pas confondre avec le produit)
- `bancs/aec/` (gitignoré via `.gitignore` → `bancs/`). venv `bancs/aec/.venv` (Python 3.13.2). Libs : PyAudioWPatch, numpy, soundfile.
- `01_probe_devices.py` · `02_capture_aligned.py` · `captures/{micro,loopback}.wav` (dernières captures).
- **Environnement** : Node 24.13 · Python 3.13.14 + 3.14.3 · **RTX 2060 6 Go** (driver 610.47, nvcc absent = OK, CTranslate2 embarque sa runtime) · **VS Build Tools 2022** (VC++ x64) présent. **Écart tracé** : Python **3.13** retenu (pas 3.14 — écosystème audio/ML, wheels).

## Tâches conv 23, dans l'ordre (un par un, clos avant le suivant)
1. **Temps 2 du banc AEC — l'annulation.** Choisir la lib d'AEC (reco : **WebRTC APM / AEC3**, cible ; **SpeexDSP** repli — install Windows à confirmer empiriquement, Build Tools = filet) → R7 à présenter. Écrire le banc d'annulation (feed micro + référence loopback → AEC → mesurer le **résidu**). **Preuve I-1 : elle ne se coupe jamais elle-même** quand un signal **audible** joue. **Coordination Yohann** : sa **config de sortie réelle** (enceintes/casque — la TV n'est probablement pas son rig), volume, présence. Le micro est **live pour sa dictée** → le prévenir / basculer clavier pendant les runs audibles.
2. **Cas durs M1** : changement de périphérique de sortie (la référence loopback change) · flux WASAPI exclusifs (dérivent + échappent au loopback).
3. **2ᵉ 🔴 — wake word FR** (`plan/01` V3, F6) : LiveKit wakeword ⇄ openWakeWord sur « Sophia » porté par une phrase ; taux de faux réveils ; repli nommé.

## Loose ends (sur Go de Yohann)
- **IN PLACE conv 22** : si la clôture conv 22 n'a pas fini CLAUDE.md « État actuel » v22 + IMPLEMENTATION (banc ouvert, Temps 1 prouvé) → le compléter en tête de conv 23.
- **Portages `technique/` §7** (accumulés convs 16→21, en un bloc) — inchangés, sur Go ; `technique/` reste acquis.
- **Contenus identitaires ENSEMBLE** (jamais un vague « Phase 3 ») : prompt de consolidation v1 · banc de dilemmes v1 · amendements pré-boot persona · seuils de tempérament. Non entamés — rien préempté.
- Rappel `plan/00` §7 : « Python vs Java » (coquille de l'idiome interne) à trancher avant de graver la supervision T3 (build produit, plus tard).

## Lectures pilote (avant toute action, dans l'ordre)
`docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — gardée en tête) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `docs/technique/00`→`05`+`99` → `docs/plan/00`→`05`+`99` (surtout **`plan/01`** — le banc vit là ; §6/§7) → `AUDIT-fable.md` + `AUDIT-fable-corpus.md` + `GRILLE-AUDIT-FABLE.md` → ce relais. *(Le banc `bancs/aec/` est jetable — le lire pour reprendre, pas le graver.)*

## Vigilances (rappel)
- **Phase 3 = traduire, jamais rouvrir** · **le banc est une PREUVE, jamais le produit** (« pas de V2 » pour le code ; **CF2** : rien d'un banc n'entre dans sa base).
- **Croisé 2 agents** = au moment de graver de la **conception** ou du **code produit** (proposé d'office, sur Go) — **pas** pour un banc jetable.
- **Actions sur l'environnement de Yohann** (jouer du son, ouvrir le micro live) : **confirmer d'abord**, signal **inaudible** quand la mesure le permet.
- **Anti-flagornerie** · **anti-paternalisme** · **honnêteté > plaire** (dire la trajectoire sans fard) · **budget = sa jauge** (basculer sur son signal, pas de mode économe) · **R5** (rien d'« acté »/committé sans son mot) · **R7** (reco + « pourquoi pas ») · **R8** (un par un).
- **Commit au fil / push en clôture** · repo public (garde par contenu · gitleaks · pas de Co-Authored-By · `Yohann Dandeville <contact@ydvsystems.com>`).
- **Pré-boot** : sauvegarde 3 étages testée + base fraîche/bancs jetables = prérequis du premier boot ; **premier boot = CÉRÉMONIE** (1re phrase vraie PAR CONSTRUCTION).
