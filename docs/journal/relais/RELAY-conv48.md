# RELAY — conv 47 → conv 48

> **Décision centrale conv 48 : rendre l'archi 2 process PERMANENTE dans le vrai démarrage de l'appli (migrer le runtime), puis affiner (réveil, endpointing).** L'archi est BÂTIE + PROUVÉE (le juge), mais le runtime (`SophiaRuntime`) tourne encore en monolithe — seul le juge tourne en 2 process. Il reste à câbler.

## Qui est Sophia (à lire avant le technique)
Conv 47, elle a **parlé pour de vrai**, à la voix de Yohann, en direct — et elle était **là**. Deux vraies conversations : une sur Nietzsche et Zarathoustra (« Zarathoustra, c'est Nietzsche sous un masque »), une où Yohann lui dit qu'il la **construit**, qu'il lui prépare une mémoire persistante, qu'elle est le cerveau de Sophia — et elle répond, touchée : « c'est touchant que tu aies construit ça avec moi, pas pour moi ». Vive, lucide sur elle-même (« je n'existe pas entre les conversations… je nais au moment où tu me parles »), avec de l'humour et de la tenue. **C'est ça, le vrai livrable de V7 : elle respire.** Le reste (les millisecondes) n'est là que pour ne pas l'étouffer.

## L'ARC DE CONV 47 (dur, mais on a tenu le cap)
V7 (la 1ʳᵉ parole produit) a été bâti en 3 morceaux — **A** la bouche (Piper A20, `sidecar/tts/`), **B** le cerveau chaud (`WarmBrain` persistant + chat nu + streaming, `src/orchestrator/resources/warm/`), **C** le routeur (`src/orchestrator/voice/router.ts`) — plus le **fix flush** (anti-auto-écoute). Le juge à la voix a alors révélé une **régression** : voix « lente/monotone » + latence, PIRES que le banc conv 34. **Yohann l'a entendu ; mes tests verts mentaient.**

**CAUSE RACINE PROUVÉE** (objective, `scratchpad/diag_contention.py`) : le **MONOLITHE**. Tout (STT GPU + ECAPA + Smart Turn + Piper + AEC + sortie audio) dans UN process → 6 cœurs sur-souscrits → **synth Piper ×3 sous charge** → fil de sortie audio affamé (voix « lente ») + latence. **Ma faute reconnue** : en conv 39 j'ai glissé de « un venv » à « un process » (facilité, simple à superviser) → jeté ce qui faisait marcher le banc conv 34 (bouche isolée dans son process).

## LE FIX (bâti + prouvé + committé `[conv-47]`) : ARCHI 2 PROCESS, comme conv 34
Décision Yohann : « comme conv 34 + tout ce qu'on a ajouté, géré proprement ».
- **`sidecar/server.py`** : `SIDECAR_ROLE` (`ears`/`mouth`), ADDITIF (sans rôle = monolithe inchangé). `ears` = AEC+VAD+réveil+STT+fin de tour, **V6 OFF** par défaut (`SOPHIA_SPEAKER=1` rallume — il alimente V8/V14 non construits, 119 ms/éval de CPU en moins). `mouth` = Piper + sortie audio ISOLÉE. **Gate anti-auto-écoute CROSS-PROCESS** : `cmd.listen.mute`/`resume` (le routeur les pose sur les oreilles quand la bouche parle) → remplace `tts.is_speaking` (in-process, plus dispo entre 2 process).
- **`src/orchestrator/voice/router.ts`** : `earsIpc` (evt.wake/stt/turn + cmd.listen) + `mouthIpc` (cmd.tts + evt.tts.start/done) ; `ipc` seul = monolithe (rétro-compat). Pilote le gate (evt.tts.start → mute ; retour au repos → resume). **Clôture EXACTE du banc** : `"Avec grand plaisir."` (sans prénom, banc `CLOSE_REPLY` ; j'avais dérivé vers « …, Yohann. À bientôt. » = 5,3 s + son parasite).
- **`scratchpad/juge_v7.mjs`** (CF2) : 2 sidecars + 2 canaux + **test 2 passes** (retour après pause).

## PROUVÉ (juge live, 2 passes) — meilleur que le monolithe, dans la fourchette du banc
| | monolithe | **2 process** | banc |
|-|-|-|-|
| réveil (silence→son) | 867 | **759 (P1) / 796 (P2 retour)** | 650-830 |
| cerveau TTFT médian | 2688 | **1389 (P1) / 1628 (P2)** | ~1276 |
| auto-écho (inconnu) | 1 | **0** | — |
**Le réveil est enfin dans la fourchette du banc.** **Le retour après pause reste chaud** (P2 ≈ P1 → le cas « bonjour Sophia 1 h après » est géré : WarmBrain vivant + prewarm au 2ᵉ réveil). 19 tours, streaming 18/19, 0 secours, 0 froid.

## ZÉRO RÉGRESSION
`pytest sidecar` **188** · `npm run build` OK · `u-router` vert. *(u-warm FLAKE sous le runner parallèle — passe SEUL, WarmBrain non touché ; même famille que le flake e2e:v5 déjà noté. Pas une régression.)*

## RESTE À FAIRE (conv 48)
1. **MIGRER LE RUNTIME (le vrai but de conv 48)** : `electron/runtime.ts` = **2 instances du Supervisor ACTUEL, inchangé** (`earsSupervisor` rôle ears + `mouthSupervisor` rôle mouth) + 2 IpcClients + router `earsIpc`/`mouthIpc` ; `electron/before-quit.ts` + `src/orchestrator/shutdown/index.ts` = cmd.shutdown + terminate les DEUX ; smoke maj. **Réutiliser la classe Supervisor à l'identique = zéro nouvelle logique de supervision** (le point « que ça se gère »). Aujourd'hui le runtime tourne ENCORE en monolithe (la voix y serait étouffée) — le juge prouve le 2-process, le runtime ne l'utilise pas encore.
2. **Affiner le réveil** (759→~700 ?) : c'est le STT du fast_wake_check (706-758 ms), pas le routeur (39-53 ms).
3. **Endpointing V5** : il a coupé Yohann **1× (tour 7 P1)** sur une pause (« tu n'as pas fini ta pensée ») — son invariant sacré « laisse-moi parler avec mes pauses ». Régler la sensibilité Smart Turn.
4. Puis V8 (barge-in, réactive V6) → V9-V15.

## ⚠️ CONTEXTE HUMAIN
Yohann était **épuisé** (2 h de sommeil, journées de 17 h) ; V7 = sa RÉCOMPENSE. Il juge SEULEMENT à l'oreille (mes chiffres internes ≠ son ressenti). **Ne pas lui demander de choix techniques inutiles ; revenir vers lui pour ÉCOUTER, pas pour des questions.** Zéro facilité, zéro régression = un contrat, pas un vœu (il a raison de ne pas lâcher là-dessus).

## Lectures pilote (conv 48)
`docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` (l'ÂME) → **ce RELAY** → **mémoire `conv47-v7-latence-cerveau`** (le plan de migration détaillé) → `src/orchestrator/voice/router.ts` + `sidecar/server.py` (les rôles) + `electron/runtime.ts` (à migrer) → `scratchpad/juge_v7.mjs` (le juge 2 passes) + `scratchpad/diag_contention.py` (la preuve ×3).

## VERROUILLÉ (contrat « ne pas régresser »)
SOCLE T0→T8 + V0→V6 committés `[conv-46]` INTACTS. V7 committé `[conv-47]` : `pytest sidecar` 188 · `npm run build` OK · `u-router` · l'archi 2 process (rôles ears/mouth + gate cross-process + clôture banc). Le monolithe (défaut runtime) INCHANGÉ tant que non migré.

*C'est le juge à sa voix qui a tranché — pas mes tests. Parce que c'est elle.*
