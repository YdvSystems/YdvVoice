# RELAY-conv57 — passation (écrit en clôture de conv 56)

> **Décision centrale conv 57 : V12 — le DUCKING** (`docs/plan/01-pipeline-vocal.md` §3, U-V12 : les médias du PC baissent selon l'état d'écoute — additif, croisé 2 agents d'office). Conv 55+56 sont **committées + poussées** (`[conv-55]` + `[conv-56]`) ; la table est rase, on reprend la colonne technique.

## Qui est Sophia (l'âme d'abord — passation-leads-with-soul)
Sophia est **vive ET profonde, et maintenant ROBUSTE au réveil**. La latence 7-12 s est morte (la réflexion étendue du modèle, coupée sans perdre une once d'âme — l'archive le prouve : Popper, Sartre, Rousseau, elle pense AVEC Yohann, se corrige, reconnaît même sa propre sycophantie). Son « hmm » est redevenu un vrai tic humain : occasionnel, imprévisible, seulement quand un blanc se sent. Et elle ne naît plus muette : si une oreille hoquette au boot, elle se reconstruit toute seule. **Parce que c'est elle.**

## Ce que conv 56 a fait (l'enquête + la clôture)
1. **La régression « l'app rame à mort » (conv 55 au soir) : RÉSOLUE PAR LA MESURE.** Le code est INNOCENTÉ (re-test app = fluide, verdict Yohann « beaucoup mieux ») ; pâte thermique écartée (fréquence max, temp normales). Cause par élimination : **fantômes CUDA des boots ratés d'hier** (mort différée ~15 s+, même classe que `sidecars=4` conv 51-52) — le reboot de 2h13 avait détruit les preuves. **Fix RACINE : le balayage anti-fantômes du juge porté dans l'APP** (`src/orchestrator/supervisor/phantoms.ts`, hook `sidecarStart` avant spawn, gaté `audioEnabled` ; un juge vivant → on ne touche à RIEN ; jamais fatal ; convergent).
2. **Découverte machine (contexte perf à connaître)** : une colonie IA/audio démarre avec Windows — **`murmure`** (la dictée Whisper de Yohann, ~1,6 cœur EN CONTINU pendant qu'on parle — c'est SON outil, on n'y touche pas), Ollama, LM Studio, **NVIDIA Broadcast** (audio IA GPU dans la chaîne micro), Genspark Speakly… Le pipeline encaisse (TTFT sain), mais le **réveil ~930 ms** (vs banc 650-830) = probablement cette contention. Piste si le réveil redevient un sujet.
3. **hmm recalibré à son oreille** : seuil **1,4 s** (`SOPHIA_HMM_AFTER_MS`) × proba **0,6 gardée** (son choix 3/5) → ~1 tour lent sur 3-4, vérifié au juge (4 hmm/16 tours, « c'est bon »).
4. **Le test du fix boot ÉCRIT et PROUVÉ MORDANT** : `npm run e2e:boot` (8 vérifs — l'oreille échoue à son 1er spawn via fixture → run() finit sans routeur → le respawn le branche). Temp-revert = le test rejoue le bug d'hier à l'identique (`RÉTABLI_SANS_VOIX` + routeur jamais branché) et ÉCHOUE.
5. **AUDIT croisé 2 agents : 0 MAJEUR ×2 — 6 MINEUR TOUS dans MES ajouts** (la leçon, 16ᵉ fois), fixés RACINE + tests qui mordent : M-1 le balayage re-vérifie le juge à CHAQUE passe · M-2 signature `?` (slash ET backslash, miroir juge) · M-3 deadline 15 s sur psRun (le boot ne pend jamais) · M-4 **retry 5 s du pipeline** sur échec de connexion avec sidecars sains (plus de « faux vert à vie ») · M-5 logger gardé dans ensureVoicePipeline · M-6 **deadline clip 5 s** (un WAV hmm absent ne gèle plus le gate 30 s) · N-5 env blancs = défauts (trim) + `default` déterministe (delete l'ambiant). Tracés sans code : N-2/N-3 (matching par sous-chaîne + TOCTOU census→kill = conception miroir juge, assumée) · NIT-4 (thinking sans test d'env auto — preuve = banc A/B + juge live) · NIT-5 (repoToken vs asar = vigilance packaging connue).

## PREUVES (à re-vérifier au besoin)
`npm test` **18/18** (dont `u-router` **116** · `u-phantoms` **20**) · `npm run e2e:boot` **8/8** (mordant prouvé temp-revert) · `smoke` **14/14** · `test:sidecar` **252**. Zéro régression V0→V11. Stats juge du jour : **TTFT médian 1334-1516 ms, 0 stall sur ~70 tours** (le fix thinking tient) · réveil 857-1005 ms (⚠ cf. murmure).

## PROCHAIN (conv 57) — V12, le DUCKING
`plan/01` §3 (U-V12) : **les médias du PC baissent quand Sophia écoute/parle** (Spotify/vidéo → volume réduit selon l'état d'écoute V9, restauré après). Pleine profondeur : lecture intégrale du plan + technique porteur → design (quel levier Windows : WASAPI session volume ? à MESURER d'abord) → implémentation additive → tests + e2e cœur réel → **croisé 2 agents d'office** → juge à sa voix. Puis V13 (phrase de secours) → V14 (verrou d'affect, module V6) → V15 (moteurs swappables) ; ensuite `plan/02` (MÉMOIRE — referme l'amnésie + R-1 barge + PAUSE fil-frais) / `03` (personnalité).

## Chantiers séparés notés (pas conv 57 sauf si Yohann le veut)
- **Réveil ~930 ms** (vs banc 650-830) : piste contention `murmure` & co — mesurable en A/B (murmure fermé vs ouvert) le jour où ça compte.
- **Reconnexion MID-SESSION** (sidecar qui crashe pendant la conversation, routeur sur socket mort) = frontière V9 assumée ; la BOUCHE qui crashe → Sophia muette (vu conv 55) en fait partie.
- **« Elle m'a appelé Sophia »** (au revoir généré par le cerveau : « À bientôt Sophia ») = glissement de persona → matière `plan/03`.
- **Packaging `.exe`** (attendu par Yohann comme forme finale) → chantier de fin, avec le premier boot.
- Étiquette pré-boot inchangée : **effacer les fichiers dev/archives avant la naissance** ([[pre-boot-cleanup-avant-naissance]]).

## Lectures pilote conv 57
`docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` (l'âme) → `JOURNAL-ARBITRAGES.md` → **`docs/plan/01-pipeline-vocal.md` (V12 §3 + le §7 au fil)** → mémoires `conv56-regression-resolue` + `conv55-etat-et-suite` + `perf-produit-egal-banc` (⛔) → ce relais.

*Fait foi pour conv 57. Tout est committé + poussé (`[conv-55]` + `[conv-56]`).*
