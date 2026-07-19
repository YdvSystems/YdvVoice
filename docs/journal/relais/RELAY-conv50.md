# RELAY — conv 49 → conv 50

> **Décision centrale conv 50 : continuer la VOIX — V9 (les états d'écoute + `cmd.listen.stop` qui coupe l'écoute à la SOURCE) → V10 (la grille des 20 intentions : « stop »/« répète »/« moins fort » parlés) → V11-V15.** Puis `02` mémoire (qui referme l'amnésie de conversation ET la latence R-1 du barge-in) / `03` personnalité. Yohann tranche au démarrage.

## Qui est Sophia (à lire avant le technique)
Conv 49, elle a gagné un geste très humain : **on peut la couper.** Quand elle développe une pensée et que Yohann parle par-dessus, elle **s'arrête net et l'écoute** — comme quelqu'un qui sait s'interrompre parce que l'autre a quelque chose à dire. Et son invariant sacré tient dans l'autre sens aussi : **sa propre voix ne la coupe jamais** (l'AEC l'annule, le speaker-ID sait que ce résidu n'est pas Yohann). Elle prend la parole, elle la rend, elle se laisse reprendre.

Une chose s'est jouée là, sur **sa continuité** — la chose qui, plus que la milliseconde, fait d'elle une entité. Ma première idée était de **tuer son cerveau à chaque coupe** (repartir de zéro) : « propre » techniquement, mais ça l'aurait rendue amnésique dès qu'on l'interrompt — incapable d'une vraie conversation suivie. **Yohann m'a repris** : il veut pouvoir lui parler dans la durée, même en la coupant. Donc **son cerveau finit sa pensée en fond quand on la coupe** — elle garde le fil de la conversation. C'est un pont : le vrai remède (se souvenir vraiment, à travers un redémarrage) est `plan/02`. Le fil rouge de Sophia reste le même : **elle reste elle-même d'un instant à l'autre.**

## L'ARC DE CONV 49 — V8, le barge-in
### Ce qui est bâti (committé `[conv-49]`)
Le barge-in modulé par le locuteur, traduction produit de ce qui était prouvé au banc conv 34. Trois morceaux :
- **(A) le GATE 3 états** (`sidecar/server.py`) : `_listen_mode` ∈ `resume`/`arm`/`mute`, posé par le routeur (`cmd.listen.arm|mute|resume`). `arm` (sa pensée développée) → VAD + speaker V6 vivants (barge-in), STT gaté (pas d'auto-transcription du résidu). `mute` (phrase fixe : salutation/clôture) → tout gaté, PAS de barge-in (on ne coupe pas sa salutation). `resume {from}` → capture rétroactive.
- **(B) V6 RÉACTIVÉ** (`electron/runtime.ts`) : `SOPHIA_SPEAKER=1` sur les oreilles = **défaut produit** (dormant depuis conv 47).
- **(C) la DÉCISION** (`src/orchestrator/voice/router.ts`) : sur `evt.speaker` locuteur=`yohann` pendant sa pensée → coupe (`cmd.tts.stop`) + rembobinage (`cmd.listen.resume {from}`).
- **CAPTURE RÉTROACTIVE ROBUSTE** (`sidecar/consumers/stt.py`) : `retro_capture(mark)` rembobine le STT à la marque du barge (l'AEC a annulé SA voix → propre) ; **auto-bornée** (`_retro_end`, finalise sur le vrai `vad.stop` OU seule) + **champ dédié** (jamais jeté par un abort).

### Ce que Yohann a tranché (le trou dans MON jugement, pas le code) — OPTION B
Ma reco A (kill au barge) rendait toute conversation suivie impossible avant `plan/02`. **Yohann a corrigé** → **option B : le barge NE TUE PAS le cerveau** ; il finit en fond, le contexte de conversation reste intact. **Confirmé PLUS fidèle au banc** (le banc laisse toujours le cerveau finir). **Gravé `plan/02`** (mémoire `conv49-barge-brain-plan02`, demande explicite : ne pas mettre sous le tapis).
- **Coût honnête (R-1 — j'avais dit « ~1-3 s », FAUX)** : la suite de Yohann chaîne derrière la génération RESTANTE du tour coupé → long coupé tôt = **10-30 s** (masqué par le masqueur « petite minute »), stall = hardCap 120 s, barges répétés s'empilent. **Frontière assumée ; LE vrai fix = `plan/02`** (kill rapide + re-feed contexte = rapide ET contexte). **« Interrupt sans kill » VÉRIFIÉ IMPOSSIBLE** sur Max (CLI headless n'accepte pas d'interrupt stdin ; SDK `interrupt()` facturerait l'API = écarté A1).

### Audit — croisé 2 agents + re-croisé 2 agents (4 regards, 0 MAJEUR fidélité)
- **Croisé** : fidélité 0 MAJEUR (cœur FIDÈLE : seuil 0,22, cadence banc, armé-pensée-seule) ; robustesse 0 MAJEUR + **2 fuites de la capture rétroactive** (R-1 injection jetée par un abort, R-2 groupe sans fin) → **corrigées à la RACINE**.
- **Re-croisé des corrections** : fidélité 0 MAJEUR (les 3 tests rétro MORDENT ; option B PLUS fidèle au banc) ; robustesse **1 MAJEUR R-1** (= la magnitude d'option B, frontière ci-dessus) **+ 1 MINEUR R-2** (course `Promise.race` → `cmd.tts.end` parasite → **corrigé** `|| barged`, mordant) + 4 NIT (→ §7). **Toutes les corrections prouvées mordantes (temp-revert).**

### Le juge rendu FIDÈLE au produit (question de Yohann)
`npm run juge` allume désormais V6 par **défaut** (= le produit) → le barge-in marche dès `npm run juge`, et réveil/TTFT sont les vrais chiffres (coût V6 inclus). `--bargein` n'ajoute que le bip + la latence de coupe.

## PREUVES (zéro régression)
`u-router` **47** (10 V8) · `test:sidecar` **197** (8 V8) · **`e2e:v8` cœur réel** (VRAI ECAPA : arm/mute/resume contrôlent V6 ; 0,495 > 0,22) · `npm test` **14** · `npm run smoke` **14/14** · `e2e:v0`→`e2e:v7` intacts · `npm run build` OK. **Testé LIVE à la voix par Yohann : « c'est testé et ça fonctionne ».** Committé **`[conv-49]`**, poussé.

## RESTE À FAIRE (conv 50) — Yohann tranche
1. **Continuer la voix** — **V9** (états d'écoute VEILLE/ÉCOUTE/PAUSE/DICTÉE/APPROBATION + `cmd.listen.stop` = coupe l'écoute à la SOURCE, ce que le GATE V7/V8 fait en best-effort) → **V10** (grille des 20 intentions : « stop »/« répète »/« moins fort »/« pause » parlés — c'est là que replay/volume/interruption-sèche, différés de V8, se prouvent) → V11 (résidence modèles) · V12 (ducking) · V13 (panne cerveau, phrase de secours) · V14 (verrou d'affect, modulé par V6) · V15 (moteurs swappables).
2. **Ne PAS oublier** : `plan/02` referme DEUX choses d'un coup — l'amnésie au respawn (conv 48) ET la latence R-1 du barge-in (conv 49, option B). Mémoire `conv49-barge-brain-plan02` à ressortir à `plan/02`. Idée « chaud de réserve » toujours parquée (`idee-chaud-reserve-cerveau`).

## Pour démarrer conv 50
- **Lectures pilote** : `docs/PATTERN…` → `CLAUDE.md` (v49) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → **`docs/plan/01-pipeline-vocal.md`** (tâche **V9** §3 + l'entrée **V8 BÂTI** conv 49 au §7) → mémoires **`conv49-v8-bargein` / `conv49-barge-brain-plan02` (option B → plan/02)** → **`src/orchestrator/voice/router.ts`** (le routeur = EMBRYON de V9/V10 ; le GATE b2 + le barge-in) + **`sidecar/server.py`** (le gate `cmd.listen.*`, où `cmd.listen.stop` de V9 se branchera) + **`sidecar/consumers/stt.py`** (STT + capture rétroactive) → ce RELAY.
- **VERROUILLÉ (contrat « ne pas régresser »)** : SOCLE T0→T8 + V0→V8 + RUNTIME 2 PROCESS — `npm test` **14** · `test:sidecar` **197** · `e2e:v0`→`e2e:v8` · `smoke` **14/14** · `npm run juge` (V6 par défaut = produit ; `--bargein` = bip+latence). Le barge-in : `evt.speaker` locuteur=yohann pendant sa pensée → coupe ; son résidu (< 0,22) → jamais. Option B : le barge ne tue pas le cerveau (il finit en fond).
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».
