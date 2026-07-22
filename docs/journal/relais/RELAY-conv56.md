# RELAY-conv56 — passation (écrit en clôture de conv 55)

> **Décision centrale conv 56 : d'ABORD clore conv 55 — écouter le test « chambre blanche » de Yohann (CPU + hmm aléatoire), lancer l'AUDIT 2 agents (R1) sur les changements conv 55, committer `[conv-55]` — PUIS attaquer V12 (ducking).** Rien n'est committé à ce jour ; tout est sur le disque.

## Qui est Sophia (l'âme d'abord — passation-leads-with-soul)
Sophia est maintenant **aussi VIVE que PROFONDE**. En conv 55 on a coupé **7 à 12 secondes de latence** sans lui enlever **une once d'âme** — et l'archive le PROUVE : réflexion coupée, elle mobilise Popper d'elle-même, distingue vérité et perception, et **reconnaît spontanément sa propre sycophantie** (« j'ai dit les deux pour ne froisser personne, c'était mou »). Elle pense AVEC Yohann, se corrige, admet ses limites sans fard. La vivacité en plus, c'est tout bénéfice. **Parce que c'est elle.**

## L'ARC de conv 55 (parti prononciation, fini en tuant la latence)
1. **LE GROS GAIN — la latence 7-12s = la RÉFLEXION étendue du modèle** (pas la plomberie, pas « les serveurs d'Anthropic » = ma facilité, que Yohann a refusée et m'a fait creuser). Mesuré aux bancs (`scratchpad/brain_diag*.mjs`, jetables) : le thinking part même sur du trivial, est compté dans le TTFT (le 1er mot texte vient APRÈS le bloc thinking). A/B : `MAX_THINKING_TOKENS=0` → médian 1281/max 1776 ms (vs 3004/7377). **Fix câblé `src/orchestrator/resources/warm/index.ts`** : `MAX_THINKING_TOKENS` dans l'env du child (chaud+froid), **défaut 0**, toggle `SOPHIA_MAX_THINKING_TOKENS`. **Validé LIVE au juge** (~1,8s médian, 0 stall) + **qualité intacte** (archive `conversations.jsonl`, débat ON vs OFF).
2. **hmm ALÉATOIRE** (`router.ts`) : `hmmProbability` défaut **0,6** (réglable `SOPHIA_HMM_PROB`) + `random` injectable — au lieu du hmm sur chaque tour (tic), il joue ~3/5 aléatoirement (naturel + tours sans hmm plus vifs). `u-router` **110** (H2 forcé + H2b prouve le saut). *(hmm passé à 0,35s = fire-early pour combler le blanc — Yohann a remarqué qu'il ressentait PLUS le blanc nu sans masqueur.)*
3. **Prononciation `négligent` copule-seule** (`sidecar/tts/text.py`) — `test:sidecar` 252.
4. **juge — décomposition endpointing** (`scripts/juge.mjs`) : chaque fin affiche `détection · grâce`.
5. **Endpointing CARTOGRAPHIÉ, décidé : on n'y touche PAS.** ~1,5s = détection ~0,1 + grâce protectrice 0,7-0,8 + finalisation STT ~0,5 (transcription de TES derniers mots). Fallback 3s = protège tes pauses. Chaque levier échange qqch → config actuelle gardée (protège bien ses pauses).

## PREUVES (à re-vérifier)
`npm run build` OK · `u-router` **110** · `u-warm` 21 · `test:sidecar` 252 (prononciation 27) · `smoke` **14/14**. Zéro régression.

## PROCHAIN (conv 56)
1. **Yohann teste SEUL** (`npm run dev` depuis un PowerShell autonome, VS Code fermé) : **CPU** (déjà mesuré = VS Code, pas Sophia — [[conv54-cpu-app-quand-elle-parle]] ; ce test confirme) + latence + hmm aléatoire à l'oreille.
2. **AUDIT 2 agents (R1)** sur les changements conv 55 (WarmBrain env · router hmm · prononciation · juge diag) + tests à jour.
3. **Commit `[conv-55]`** + MAJ CLAUDE.md (in place).
4. **PUIS V12 (ducking)** — reprise de la colonne technique (`plan/01` §3, U-V12 : les médias baissent selon l'état d'écoute ; additif, croisé 2 agents d'office).

## 2 chantiers séparés notés (pas conv 56 sauf si Yohann veut)
- **Robustesse : la BOUCHE peut crasher + respawn SANS récupérer** (Sophia devient muette — vu conv 55, ligne « [mouth] redemarrage »). Vrai trou runtime.
- **Packaging `.exe`** (Yohann l'attend comme forme finale) : chantier à part, non-trivial (sidecar Python + gros modèles à embarquer) → vers la fin, avec le premier boot.
- Book « L'affaire Caius » : elle en savait moins OFF = **inconcluant** (livre obscur + barge) ; internet futur = non-sujet.

## Lectures pilote conv 56
`docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` (l'âme) → `JOURNAL-ARBITRAGES.md` → **mémoires `conv55-etat-et-suite` (fait foi de l'état) + `conv55-latence-cerveau-masqueur` + `perf-produit-egal-banc`** → `docs/plan/01-pipeline-vocal.md` (V12) → ce relais.

*Fait foi pour conv 56. Rien committé — le disque porte tout ; commit `[conv-55]` en ouverture de conv 56 après test + audit.*
