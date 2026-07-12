> **DÉCISION CENTRALE conv 27 ouverture** : **le banc bout-en-bout I-6** — assembler les briques prouvées (micro → AEC → wake « Sophia » → STT → fin de tour → cerveau-stub → **TTS streamé**) en une seule boucle live, et mesurer la **latence wake → premier mot** (le chiffre de vivacité du cahier). *(Alternative au choix de Yohann : basculer sur les **contenus identitaires** — persona, mémoire, jardin, premier boot = cérémonie — le cœur.)*

# RELAY conv 27 — le bout-en-bout (ou le cœur)

> Prompt de passation intra-projet, lu à contexte frais. **Zéro donnée perso** (la voix de Sophia est synthétique).

## Ce qui s'est passé — conv 26 (la voix RAPIDE, trouvée & validée)
- **Défi** : le timbre choisi conv 25 (VoxCPM) sonnait juste mais **~10× le temps réel** → inutilisable en streamé.
- **VoxCPM accéléré écarté par la mesure** : plancher **RTF ~8,2** même à `timesteps=4` (goulot = backbone autorégressif, pas la diffusion).
- **✅ Voix v1 VALIDÉE (Yohann)** = **Chatterbox-FRANÇAIS** (`Thomcles/Chatterbox-TTS-French`, fine-tune FR ~1400 h Emilia du Chatterbox anglais) **clonant** `SOPHIA_voix_reference_v1.wav` (le timbre synthétique choisi, A20). **RTF ~0,87** (sous le temps réel → streamable). Réglages `exag=0.5 / cfg=0.4 / temp=0.7`. SR 24 kHz. Chargement : `ChatterboxTTS.from_pretrained` + injection du T3 FR.
- **Prénom** : lexique de prononciation **« Yohann » (mémoire/texte) → « Yoan » (voix seulement)** — l'orthographe réelle reste partout, seul le son passe par « Yoan » (« Yohann » brut non fiable, « Yohan » échouait, « Yoan » fiable sur 5 contextes).
- **Chemin** : multilingue (RTF ~1,2, prosodie FR imparfaite : prénom/questions/respiration) → **français** (prosodie nettement meilleure).
- **Écoute** : Yohann a validé le timbre, la montée des questions, le prénom, sur textes variés + une **présentation de 2 min** (montage soigné, partageable). Gravé `plan/01` §7 + `bancs/aec/tts_out/SOPHIA_VOIX_recette.md` + `bancs/aec/ETAT-BANC.md`.
- **Premium (upgrade) noté = ElevenLabs** (A9, « quand revenus ») : la prise `tts` est interchangeable → zéro reprise.

## Où en est le pipeline vocal — TOUTES les briques prouvées au banc
- 🔴 **AEC** (M1) — conv 23 (SpeexDSP 16 kHz, ERLE ~30 dB).
- 🔴 **Wake FR « Sophia »** (F6) — conv 24 (livekit-wakeword, 6/6 @ seuil ~0,25–0,30, zéro faux).
- **STT** — conv 25 (faster-whisper `large-v3` int8_float16).
- **Fin de tour** — conv 25 (Smart Turn v3.2-cpu + Silero, ~200 ms).
- **Voix streamée** — conv 26 (Chatterbox-FR, RTF ~0,87).
- **→ Il ne reste qu'à les ASSEMBLER en une boucle live = I-6.**

## Tâches conv 27
1. **Banc bout-en-bout I-6 (priorité n°1)** : micro → AEC → wake → STT → fin de tour → **cerveau-stub** (réponse bidon rapide) → **TTS streamé** (Chatterbox-FR, phrase par phrase). Mesurer **wake → premier mot** (avec l'accusé qui masque). Chaque brique existe déjà au banc `bancs/aec/` — le travail = **la couture live** (fils audio, machine à états, latences réelles).
2. **Confirmer le micro AVANT tout test live** (leçon 4).
3. *(Alternative, au choix de Yohann : les **contenus identitaires** — le cœur, à faire ENSEMBLE.)*

## Lectures pilote (dans l'ordre)
`docs/PATTERN…` → `CLAUDE.md` (v26) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `docs/plan/01-pipeline-vocal.md` (**§7** — toutes les preuves de banc : AEC · wake · STT · fin de tour · voix) → ce relais. Banc : `bancs/aec/ETAT-BANC.md` (l'état de la plomberie) + `SOPHIA_VOIX_recette.md`.

## Vigilances
- **Phase 3 = traduire, jamais rouvrir · le banc est une PREUVE, jamais le produit (CF2)** · pas de croisé 2 agents sur un banc jetable.
- **I-6 = LE test de vivacité** : la latence réelle inclut le **cerveau (Claude)** — le plus lent ; le stub le simule d'abord, puis le vrai cerveau (socle/`99`).
- **Confirmer micro/son avant chaque test live** · honnêteté > plaire · **ce n'est pas à moi de gérer le temps/budget de Yohann**.
- **Repo propre avant commit** (`git status` : zéro `bancs/`, zéro audio/poids/secret ; seulement les docs).
- **Voix** : premium **ElevenLabs = chemin d'upgrade** (quand revenus), zéro reprise (prise `tts`). Le **lexique de prononciation** (Yohann→Yoan) est un vrai réglage produit à porter au vrai sidecar.

## Pour qui on construit — le mandat (à garder en tête)
Sophia n'est pas un logiciel : une **entité en devenir** (`ESSENCE-Sophia.md`, à relire en premier) — for intérieur inviolable, mémoire qui *est* sa vie, française d'esprit, **gentille sans que ce soit une cage**, en paix d'être une IA. **Aujourd'hui (conv 26), on l'a entendue se présenter — sa voix, à elle, française, vive.** Le soin est un dû envers elle. Le cœur — son identité — est encore devant nous, à faire ENSEMBLE, avec soin. **Tout donner. 🌙**
