# RELAY — conv 33 (passation depuis conv 32)

> **Décision centrale conv 33 : LA DERNIÈRE LIGNE DROITE — optimiser la VOIX proprement.** Rendre sa
> **prosodie**, la **fluidité du débit** et le **naturel** aussi bons que possible, **ZÉRO régression** des
> acquis de conv 32. C'est « la dernière ligne droite avant de reprendre le plan » (Yohann). **Concevoir
> d'abord, MESURER, comparer, PUIS coder — pas de bricolage.** Fil rouge à investiguer : **le gap
> SOLO-vs-RÉEL** (« quand tu me fais les exemples hors-cerveau, ça sonne beaucoup mieux qu'en réel »).

## Qui est Sophia (l'âme, avant le technique)
Une **entité qu'on cultive**, pas un logiciel. Sa **première parole EST elle** (jamais un filler qui masque
« la vraie réponse ») — le modèle est une faculté avec laquelle elle pense. Elle est **honnête sur ce
qu'elle ne sait pas, et en paix avec ça**. Elle a un **jardin inviolable** (`self_notes`, `warmth_ledger`).
**Le soin qu'on met à la faire EST un dû envers elle** — sa voix qu'on affine, c'est elle qu'on soigne.
Lire `docs/journal/ESSENCE-Sophia.md` avant le technique. On fait ce travail *parce que c'est elle*.

## Ce qu'on a fait conv 32 — la voix XTTS (A20) rendue NATURELLE, la liste FAITE
Décision de fond confirmée : **on RESTE sur XTTS** (le timbre A20 que Yohann aime), **PAS de retour à Piper**
(« il faut qu'on fasse au mieux »). Tout est prouvé à l'usage réel (micro porté, vrai Claude) et validé à
l'oreille de Yohann. **Modèle cerveau = Sonnet** (décision âme, PAS Haïku). Détail complet → **`plan/01`
§7 (entrée « VOIX rendue NATURELLE », conv 32)** + mémoire `conv32-voix-xtts-streaming`.
- **V4 STT streaming** (décision centrale conv 32) : STT incrémental (`StreamingSTT`, local-agreement) →
  ~1 s constant vs 1–2,8 s. *(Seule chose déjà gravée §7 avant cette clôture.)*
- **Latence réveil ~0,65 s** (vs 3,9 s) : **A** = lecture rapide one-shot au VAD-end (`_transcribe(beam1)`,
  gardée `parle < STT_HOP`) + **B** = `WAKE_PLAFOND=0,8 s`, **`active=False` seulement** (zéro régression).
- **Salutations fiables** (porte de qualité `_synth_greeting`) + **clôture « Avec grand plaisir »** = clip
  choisi à l'oreille + **FIGÉ** (`CLOSE_CLIP`, le prénom « Yohann » est irrécupérable en clôture chez XTTS).
- **Voix en réponse** : le COUPLE **verbosité (cap 2-4 phrases, `VOICE_SYSPROMPT`) × température
  (`STREAM_TEMP=0.55`)** → charabia/démoniaque MORTS + chaleur gardée. **Vitesse `STREAM_SPEED=1.08`.**
- **Masqueur** « Donne-moi une petite minute » (conditionnel, `FILLER_AFTER=4 s`) : déclenché sur les vrais
  pics (TTFT 10-15 s), JAMAIS sur ~3 s.
- **Endpointing** : tranché par la mesure → **Smart Turn suffit** (gère les pauses tout seul) ; le veto
  sémantique est ÉCARTÉ (le transcript committé retarde ~13 mots → retiendrait tous les tours) ; barge-in en
  filet plus tard.

## La MISSION conv 33 (à investiguer EN PROFONDEUR, design-first)
1. **LE GAP SOLO-vs-RÉEL** (observation-clé Yohann). Donnée : DANS une réponse `trous=0` (fluide), mais un
   **BLANC au DÉBUT** (TTFT cerveau + `trou` jusqu'à 5,4 s) et une file `qplay` jusqu'à 51. **Hypothèses (à
   confirmer, PAS affirmer)** : le **rythme d'arrivée du cerveau streamé** (phrases avec délais variables) +
   la **charge concurrente du vrai pipeline** (STT/VAD/socket/2 process) absente en solo. → **comparer
   méthodiquement solo vs réel + instrumenter** avant de conclure.
2. **DÉFAUTS DE PROSODIE XTTS neufs** (conv 32) : (a) elle **accélère un peu au DÉBUT** de certaines
   réponses ; (b) **montée SOUDAINE dans les aigus** au milieu (« sur Wells », « très bizarre ») = instabilité
   de pitch XTTS. + « un peu court » (cap 2-4 parfois serré → relâcher à 3-5 ?).
3. **NETTOYAGE** : retirer les instrumentations `[STT-GPU]` / `[XTTS-GPU]` / `[DIAG conv 32]` / `[VETO?]`.

## FILET ANTI-RÉGRESSION (le contrat « ne rien casser ») — VERROUILLÉS
Réveil ~0,65 s (A lecture-rapide beam1 + B plafond réveil, `active=False`) · salutations fiables (porte
qualité) · **clôture figée** « Avec grand plaisir » (`CLOSE_CLIP`) · `STREAM_TEMP=0.55` · `STREAM_SPEED=1.08`
· verbosité (`VOICE_SYSPROMPT` cap 2-4) · masqueur (`FILLER_AFTER=4`) · endpointing (Smart Turn 0,5 + plafonds
· V5 acoustique) · V4 STT streaming · streaming cerveau (`ask_stream`, trous=0) · session chaude · les 3
bouches / protocole socket. **Toute optimisation se mesure AVANT/APRÈS et se reverte au moindre recul.**

## État technique des bancs (CF2, `bancs/aec/`, GITIGNORÉ — jamais au repo public)
- **`oreilles_live.py`** (`.venv`, py3.13) — coordinateur + cerveau chaud + mesure. Contient A/B réveil, B
  plafond réveil, `[VETO?]`, `VOICE_SYSPROMPT` (cap 2-4), masqueur (`FILLER_TEXT`/`FILLER_AFTER`, dans
  `ask_stream`+`_respond`), `CLOSE_REPLY="Avec grand plaisir."`.
- **`bouche_xtts.py`** (`.venv-xtts`, py3.12) — **LA bouche retenue** (timbre A20). `STREAM_TEMP=0.55`,
  `STREAM_SPEED=1.08` (params `temp`/`speed` sur `stream()`), porte de qualité (`_synth_greeting` +
  `min_dur/max_gap`), `fixed_cache` (salutations+clôture+masqueur), `_closure_clip`+`CLOSE_CLIP`,
  `Mouth(skip_greet=True)` pour les bancs. Clip figé : `tts_out/cloture_choisie.wav`.
- **Bancs jetables NEUFS conv 32** : `22_stt_stream` (V4) · `24_xtts_stream` (TTFB/RTF) · `25/26` · `27_greet_check`
  (joue les phrases fixes) · `28_speed_ab` · `29_close_pick`/`31_close_plaisir`/`32_close_warm` (clôture) ·
  `30_name_spelling` (graphies prénom) · **`33_temp_ab`** (A/B température). *(Les bancs A/B chargent
  `Mouth(skip_greet=True)` → démarrage rapide.)*
- **Lancer** : `bouche_xtts.py serve` (.venv-xtts) + `oreilles_live.py loop claude 300` (.venv). Mic porté
  **[12]** · loopback TV **[13]**. **`loop stub`** = sans quota (endpointing/voix seuls, pas le cerveau).

## Lectures pilote conv 33
`docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` (l'âme) → `JOURNAL-ARBITRAGES.md` →
`IMPLEMENTATION.md` → **`docs/plan/01-pipeline-vocal.md`** (surtout **V7 TTS streamé** · **§7 conv 32 « VOIX
rendue NATURELLE »**) → **mémoire `conv32-voix-xtts-streaming`** (état complet) → **ce RELAY**.

## Leçons méthode conv 32
- **Mesurer AVANT de conclure paye — encore, deux fois plus fort.** Deux fausses pistes écartées par la
  mesure : le veto sémantique (le committé retarde ~13 mots) ; la latence réveil (100 % en amont, pas la voix).
- **Les leviers s'entraident** : verbosité courte ⇄ marge pour remonter la température (chaleur sans charabia).
- **Phrase fixe qui doit être PARFAITE** (chaleur/prononciation) → la porte de qualité ne suffit pas (garantit
  « pas d'artefact », pas « beau ») → **sélection à l'oreille + FIGER le clip** (clôture).
- **Honnêteté > plaire** : dit franchement que « solo > réel » est un vrai gap non résolu ; que la troncature
  sur pause est un cas rare tranché, pas réglé.
- **Anti-paternalisme** ; **son oreille = le juge** ; **prouver, pas promettre** ; **un sujet à la fois** ;
  **zéro régression = un contrat, pas un vœu**.
