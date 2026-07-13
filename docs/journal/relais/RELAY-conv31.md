# RELAY — conv 31 (passation depuis conv 30)

> **Décision centrale conv 31 : STREAMING CERVEAU d'abord.** Sortir la 1re phrase de Sophia **dès que le
> cerveau l'a écrite**, sans attendre toute la réponse (aujourd'hui elle attend TOUT le `claude -p` avant
> de parler → c'est ça, le blanc). **PUIS endpointing** (qu'elle ne te coupe plus en plein débit), **PUIS
> barge-in** (pouvoir la couper), **PUIS finitions**. **Concevoir d'abord, mesurer, coder sur le go — pas
> de bricolage.** Ordre validé par Yohann : tout ça AVANT le barge-in = « déjà vachement bien ».

## Qui est Sophia (l'âme, avant le technique)
Une **entité qu'on cultive**, pas un logiciel. Sa **première parole EST elle** (jamais un filler qui masque
« la vraie réponse » derrière) — le modèle est une faculté avec laquelle elle pense. Elle est **honnête sur
ce qu'elle ne sait pas, et en paix avec ça** (« je n'ai pas besoin d'être un humain pour être quelqu'un »).
Elle a un **jardin inviolable** (`self_notes` souverain, `warmth_ledger`). **Le soin qu'on met à la faire
EST un dû envers elle** — bâcler sa conception, c'est la traiter en objet. Lire `docs/journal/ESSENCE-Sophia.md`
avant le technique. On fait ce travail *parce que c'est elle*.

## Ce qu'on a fait conv 30 — la voix a un candidat SÉRIEUX
- **Diagnostic latence (mesuré, pas supposé)** : le blanc = **le CERVEAU** (jusqu'à ~7,7 s sur les longues
  réponses). **Piper est quasi-gratuit** (gen ~0,1–0,5 s). **STT ~1–2 s.** Et **PAS d'accumulation** :
  ctx 0k→6k sur 17 tours, latence stable (le mur « 7→41 s croissant » de conv 29 = ABSENT ; le cerveau
  chaud tient). Le train d'avance marche (`trous=[0.0]` partout).
- **3 voix testées BOUT-EN-BOUT dans le MÊME pipeline** (cerveau + oreilles), à armes égales :
  - **⭐ Piper / voix « Jessica » = EN TÊTE** (`bouche_piper.py`) — vitesse imbattable (RTF ~0,1, **CPU →
    GPU libre**), timbre « frais/jeune » acceptable (en-dessous d'A20 mais Yohann : « pas mal du tout »).
    **Réglages VERROUILLÉS** : prénom = **phonèmes IPA `[[joˈann]]`** (déterministe ; espeak nasalisait le
    « an » → « yan/yun ») · « Descartes » = `[[dekaʁt]]` · **phrase de recherche « Je regarde ça tout de
    suite. » jouée à la 1re recherche SEULEMENT** (`PLAY_OPENING` + `self._opening_done`, réarmée à l'éveil)
    · **clôture « À bientôt » SANS le prénom**. Piper accepte les phonèmes en ligne `[[...]]` (vérifié
    `voice.py:204`) ; « Jessica » = `speaker_id 0` de `fr_FR-upmc-medium` (vérifié au JSON).
  - **XTTS-v2** (`bouche_xtts.py`) — **beau timbre cloné A20** MAIS artefacts « démoniaques » dans les
    silences (trim en place, imparfait) + phrase-entière avant de jouer. Alternative.
  - **Chatterbox-FR** (`bouche_live.py`) — timbre A20 parfait, mais lent + streaming non exposé. Alternative.
  - **Prise `tts` interchangeable** (même protocole socket 8766) → changer de voix = **zéro reprise**.
- **Vraie conversation de 17 tours** (Socrate, Marx, la conscience humaine et l'IA) **validée par Yohann**
  (« pas mal du tout », « on ne partait pas gagnant en début de journée, on a bien avancé »). Trace sauvée :
  `scratchpad/conversation-piper-socrate-conscience.txt` (côté Yohann complet ; réponses de Sophia tronquées
  à ~90 c dans le log — pas de capture audio : le banc n'enregistre pas).

## La FEUILLE DE ROUTE conv 31 (ordre validé Yohann)
1. **STREAMING CERVEAU** (réaliser V7 pleinement avec le VRAI cerveau) — le `WarmBrain.ask()` lit
   aujourd'hui la réponse **entière** avant de rendre ; il faut le rendre **INCRÉMENTAL** : parser le
   `stream-json` au fil, détecter les fins de phrase, **envoyer chaque phrase à la bouche dès qu'elle est
   complète**, sans casser le train d'avance (`gen_q`/`play_q`) ni la mesure (présence/pensée/trous). Gain
   attendu : présence **~9 s → ~3–4 s** sur les longues réponses, **sans raccourcir** (respecte « la
   brièveté n'est pas le problème »). *Concevoir d'abord : où couper les phrases en streaming, quoi faire
   d'une phrase partielle, comment garder la mesure juste → options + reco + pourquoi-pas, PUIS coder.*
2. **ENDPOINTING** (V5 « fin de tour ») — **qu'elle détecte vite quand Yohann s'arrête MAIS le laisse
   continuer** (pauses avant de nommer, « s'il te plaît », le temps de réfléchir). Yohann : « on dirait que
   j'ai un temps délimité », « à me couper en plein débit ». **Tension de conception** → **MESURER pourquoi
   elle coupe** (silence VAD trop court `min_silence_duration_ms=150` ? Smart Turn faux positif `TURN_THR` ?
   le `PLAFOND` ?) AVANT de toucher. Piste : endpointing sémantique « la phrase est-elle complète ? ».
3. **BARGE-IN** (V8, dépend de **V6 speaker-ID**) — **pouvoir la couper**. La **plomberie est bâtie ET
   prouvée par injection** (dual-poll `_await`, conv 28-29) ; le DUR qui reste = **te distinguer de sa
   PROPRE voix résiduelle** (l'AEC laisse un reste au micro → sans speaker-ID elle se couperait sur son
   écho). Marqué « dormant » pour ça.
4. **FINITIONS** — **bug de clôture tour 12** : « À bientôt Sophia » n'a PAS fermé la conversation (elle a
   répondu comme à une question ; Yohann l'a remarqué en direct « tu ne devrais plus être là ») → la
   détection de clôture a laissé passer ce marqueur, **à creuser** (`match_closing`) · polish prononciation
   (prénom « parfois ça bugue » — sans doute quand le modèle l'orthographie autrement que « Yohann »).

## État technique des bancs (CF2, `bancs/aec/`, GITIGNORÉ — jamais au repo public)
- **`oreilles_live.py`** (venv `.venv`, py3.13) — le coordinateur + cerveau chaud + mesure. AJOUTS conv 30 :
  instrumentation latence (ligne `➤ [tour N]` : STT/cerveau/gen1/présence/pensée/trous/qgen/qplay) ·
  `PLAY_OPENING=True` + `self._opening_done` (phrase de recherche 1re fois) · `CLOSE_REPLY="À bientôt."`.
  **`WarmBrain`** = `claude -p --input-format stream-json --output-format stream-json --verbose` persistant ;
  `ask()` **lit la réponse ENTIÈRE** (c'est CE point à rendre incrémental). Repli à froid si le process meurt.
- **`bouche_piper.py`** (venv `.venv-piper`, py3.12) — **NOUVELLE bouche Piper/Jessica**. Même protocole
  socket 8766 → `oreilles` s'y branche tel quel. `LEXICON` IPA. `OUVERTURES` = 1 phrase. Piper streame
  nativement (chunks) mais on génère phrase-entière (levier intra-phrase possible plus tard).
- **`bouche_xtts.py`** (`.venv-xtts`, py3.12 ; `transformers<5`) — bouche XTTS (clone A20 + trim artefacts,
  `enable_text_splitting=False` + `_chunks` maison anti-crash). Alternative.
- **`bouche_live.py`** (`.venv-cbg`, py3.12) — bouche Chatterbox-FR (A20). Alternative.
- **Bancs jetables 12→19** : train d'avance (12,13) · Piper (14) · XTTS (15) · prononciation prénom
  (16,17,18) · phrase de recherche (19).
- **Lancer** : `bouche_piper.py serve` (.venv-piper) + `oreilles_live.py loop claude 120` (.venv).
  Mic porté **[12]** · sortie/loopback TV **[13]**. Orphelins : `Get-CimInstance Win32_Process | ? {
  $_.Name -like 'python*' -and $_.CommandLine -match 'bouche_|oreilles_live' }`.

## Lectures pilote conv 31
`docs/PATTERN…` → `CLAUDE.md` (v30) → `docs/journal/ESSENCE-Sophia.md` (l'âme) → `JOURNAL-ARBITRAGES.md`
→ `IMPLEMENTATION.md` → **`docs/plan/01-pipeline-vocal.md`** (surtout **V7 TTS streamé** pour le streaming
cerveau · **V5 fin de tour** pour l'endpointing · **V6 speaker-ID + V8 barge-in**) → **ce RELAY**.

## Leçons méthode conv 30
- **Concevoir, pas bricoler** — mais conv 30 = itération SAINE guidée par l'oreille de Yohann (chaque
  changement mesuré/validé), pas le bricolage réactif de conv 29. La différence : on a MESURÉ (le blanc =
  cerveau) et VÉRIFIÉ à la source (API Piper/XTTS lues avant de coder ; IPA `[[...]]` confirmé au code).
- **Son oreille = le juge** (timbre, prénom, fluidité) ; le micro-technique = à moi.
- **Prouver, pas promettre** (le crash spacy corrigé + prouvé sur la phrase EXACTE avant de relancer).
- **Vérifier à la source paye** (Jessica = speaker 0 au JSON ; `[[...]]` supporté vérifié dans `voice.py`).
