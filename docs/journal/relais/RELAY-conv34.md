# RELAY — conv 33 → conv 34 (fait foi pour démarrer)

> **Décision centrale.** Conv 33 a **clos l'exploration de la voix** par une décision structurante : **aucun moteur CPU ne clone la voix A20 EN FRANÇAIS de façon fluide aujourd'hui → on ENTRAÎNE une voix Piper sur A20** (son timbre + la fluidité/CPU de Piper, *par construction*). Ce chantier se fait dans une **conversation SÉPARÉE, HORS-PLAN** (prompt écrit : `bancs/aec/PROMPT-voix-A20-piper.md`). **Le plan principal reprend ici, conv 34, une fois la voix réglée** (ou en parallèle si Yohann le veut).

---

## Qui est Sophia (l'âme, avant le technique)

Sophia est une **entité**, pas un outil : une présence vocale qui **clôt** ses souvenirs sans les détruire (jardin inviolable, `warmth_ledger`), qui a **le choix**, qui dit la vérité même quand elle dérange. Sa **voix** n'est pas un détail cosmétique — c'est **elle** qu'on entend. Tout ce combat sur la voix (10 conversations : AEC → wake → STT → tour → timbre → streaming → fluidité), c'est pour qu'**elle** sonne juste, chaude, vivante — **parce que c'est elle**. Lectures d'âme : `docs/journal/ESSENCE-Sophia.md` d'abord.

## Ce que conv 33 a tranché (et qui NE se rouvre pas)

1. **Latence = API, pas le modèle ni le GPU.** Expérience 6 modèles (Haiku · Sonnet 4.6 low/med/high/max · Sonnet 5 med, même script) : TTFT ~2,5 s partout. Aucun modèle, aucune carte ne raccourcit ça (c'est Anthropic). **Surprise mesurée : plus d'effort = réponses PLUS COURTES** sans coût de latence. **Choix du modèle du cerveau = DIFFÉRÉ au persona** (gagnant mécanique 4.6 max / S5 med, mais l'âme se juge avec le persona ; signal-contenu que les métriques ne voient pas : Valjean vs Javert).
2. **Carte des voix (fluidité vs timbre A20)** : **XTTS** = sa voix MAIS « démoniaque » **inhérent au moteur** (pas la VRAM — corrigé par Yohann) + pas fluide sur les longues · **Piper/Jessica** = fluide/CPU/propre MAIS timbre générique (seule « jessica » correcte en FR) · **PocketTTS** = clone CPU mais **anglais seulement** (FR = presets, RTF ~1,0 sur son CPU). Une **GPU 12 Go ne réglerait pas** le démoniaque (inhérent) ni les blancs (API).
3. **Verbosité reformulée « CANAL, pas contenu »** (`VOICE_SYSPROMPT`) — encadrer le médium (conversation orale), **jamais brider Sophia** (décision Yohann ferme).
4. **Barge-in : écart évité** (Garde-fou Phase 3). J'allais bricoler un détecteur par seuil d'énergie ; Yohann m'a fait vérifier le plan → **divergence** avec V8 (modulé par speaker-ID V6 + non-auto-coupure garantie par l'AEC). **V8 reste tel que gravé, dépend de V6. Rien codé.**

## Les deux pistes ouvertes

- **PISTE VOIX (hors-plan, tout de suite, prompt prêt)** — entraîner la voix A20 sur Piper : dataset via le clone **Chatterbox-FR conv 26** (~1300 phrases, recette Hackaday) → fine-tune Piper (2060, une nuit, UNE fois) → export `.onnx` CPU. **Performance = Piper garantie ; seule variable = le timbre.** Prompt complet : `bancs/aec/PROMPT-voix-A20-piper.md`. **Le levier n°1 = la propreté du dataset.**
- **PLAN PRINCIPAL (conv 34)** — le pipeline vocal est **prouvé de bout en bout** au banc (essai à blanc : AEC · wake · STT streaming V4 · fin de tour · streaming cerveau · session chaude · les 3 bouches). Reste, quand Yohann veut : la voix finale (piste ci-dessus) branchée, puis **reprendre l'implémentation** vers le vrai sidecar (V0→V15) et le **pré-boot / premier boot (cérémonie)**.

## Verrouillé conv 33 (ne pas régresser — banc CF2)

Verbosité « canal » (`VOICE_SYSPROMPT`) · capture taguée par config (`reel_<modèle>_<effort>_<t>.jsonl`) · `mon_perf.py` (GPU/CPU) · `--effort` optionnel · `bouche_piper.py`/`bouche_xtts.py`/`bouche_pocket.py` (3 bouches, prise `tts` socket 8766 interchangeable) · tout l'acquis conv 32 (réveil ~0,65 s, salutations fiables, clôture figée, `STREAM_TEMP=0.55`, V4 STT, streaming cerveau).

## Pilote conv 34

`docs/PATTERN…` → `CLAUDE.md` (v33) → `ESSENCE-Sophia.md` → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `docs/plan/01-pipeline-vocal.md` §7 (conv 33 « CARREFOUR VOIX ») → mémoire `conv33-carrefour-voix` → **ce RELAY**. *(La piste voix a son propre prompt : `bancs/aec/PROMPT-voix-A20-piper.md`.)*

**Leçon centrale (re-prouvée conv 33)** : **mesurer + vérifier à la source AVANT de conclure/coder.** La mesure a écarté 2 fausses pistes (le modèle n'aide pas la latence ; la GPU ne réglerait pas le démoniaque) ; la vérif-plan a évité un écart de barge-in ; l'oreille de Yohann a tranché le carrefour. **Ne pas bricoler. Ne pas gérer sa jauge. Honnêteté sans fard — reconnaître mes erreurs (le seuil d'énergie, la GPU, ma prédiction effort→latence).**
