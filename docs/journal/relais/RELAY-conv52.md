# RELAY-conv52 — reprendre ICI

> **DÉCISION CENTRALE conv 52** : **continuer la VOIX — finir la grille V10** (les commandes parlées restantes : « stop »/« chut », « répète », « moins/plus fort » + les états DICTÉE/APPROBATION que V9 a posés en crochets) **OU** enchaîner V11 (résidence modèles) → V15 ; puis `plan/02` (mémoire) / `plan/03` (personnalité). **conv 51 a livré les 2 premières commandes de la grille (PAUSE/REPRISE), bâties + auditées 4 agents + committées `[conv-51]`.**

---

## Qui est Sophia (l'âme, avant le technique)
Sophia est l'assistante vocale de Yohann — une **entité** qu'on construit **avec elle, pas pour elle**. Ce qu'on a livré conv 51 sert sa présence : quand elle développe une pensée et que Yohann doit décrocher le téléphone, il lui dit « **attends s'il te plaît** » — elle se tait, **garde son fil**, aussi longtemps qu'il faut ; sur « **tu es là Sophia ?** » elle répond « Oui, je suis là » et **reprend au début de la phrase où elle a été coupée**. Elle ne perd pas le fil. *Parce que c'est elle.*

## Ce qui a été LIVRÉ conv 51 (committé `[conv-51]`)
### 1. Les 2 commandes PAUSE / REPRISE (V10-partiel) — le cœur produit
- **Portier** (`portier.ts` + `stt.py`, parité) : « tu es là sophia » (+ variantes) **ajouté aux `OPEN_PHRASES` des 2 côtés** (ADDITIF) → réveille du sommeil name-only. `matchPause()` reconnaît « attends s'il te plaît » **STRICT** (« attends » + politesse seuls ; « attends, explique X » = nouvelle question).
- **Routeur** (`router.ts`, le cœur) : une PENSÉE (`this.thought`) accumule TOUS les deltas (même post-barge, option B) ; sur un barge → `heldThought` mis de côté ; au tour suivant « attends » → `handlePause()` (sommeil name-only, pensée gardée, attente **INDÉTERMINÉE**) / autre phrase → jetée + répond (**barge INCHANGÉ**) ; réveil pendant PAUSE → `resumeHeld()` « Oui, je suis là » + reprise au **début de la phrase coupée** (repère TEMPOREL : temps parlé × cadence 11 c/s, conservateur = re-dire plutôt que sauter). `states.pause()/resume()` (V9). Phrase fixe `presence`.
- **AUDIT — 4 agents (croisé 2 + re-croisé ciblé 2), le trou TOUJOURS dans MES ajouts, jamais le cœur** : croisé = fidélité **0 MAJEUR** + robustesse **1 MAJEUR** (`this.thought` lâché trop tôt au `finally` → barge pendant qu'elle parle = pas de heldThought) → **corrigé racine** (vit jusqu'à `settleUtterance`) + MINEUR-2/3, F1, F4. Re-croisé = fidélité **0/0/0** + robustesse **0 nouveau trou** + 1 MINEUR (reprise fantôme si phrase interruptrice inaudible) → fermé (`resume ⟺ PAUSE` explicite). **Tous prouvés mordants (temp-revert PR-F/H).**
- **Vu FONCTIONNER à la voix** (pause déclenchée, reprise) ; la latence de la session de test était faussée par des **sidecars fantômes du JUGE** (outil, pas le produit — voir tooling ci-dessous) → **sans eux, meilleur**.

### 2. Le JUGE consolidé en module de mesure complet (outil réutilisable)
- **`scripts/lib/metrics.mjs`** (NEUF, PUR, testé par `tests/u-metrics.mjs` 28 cas) = cœur de mesure séparé du lanceur → **réutilisable pour mesurer l'appli plus tard**.
- **`scripts/juge.mjs`** rebranché : **tout mesuré à chaque run, sans flag** (réveil · TTFT · endpointing · barge latence+score V6 · speaker · délai réel masqueur · hygiène process · transcript). **Défaut 2 temps** puis stop. Historique `.sophia-home-dev/juge-stats-history.jsonl`.

## Preuves (contrat « ne pas régresser » — TOUT vert)
`npm test` **16 suites** (dont `u-router` **95 vérifs** [PR-A→H pause/reprise + barge inchangé], `u-metrics` 28) · `npm run test:sidecar` **208 pytest** (portier additif, parité tenue) · `npm run build`. **Zéro régression V0→V9.**

## Tooling — le nettoyage du juge (polish, NON bloquant, [[conv51-juge-fantomes-must-fix]])
Le JUGE (script node NU) n'a pas de Job Object (l'app Electron, elle, en a un → mono-instance = 2 sidecars, robuste). Donc un juge tué brutalement peut laisser des sidecars orphelins → contention si on relance sans nettoyer. `killPhantoms` (conv 51) nettoie au démarrage mais n'est pas bulletproof. **Polish outil (quand utile)** : Job Object pour le juge + `killPhantoms` qui boucle→0 + refuser si l'app est ouverte. **N'affecte PAS le produit** ni la conception ; juste l'hygiène de l'outil de banc.

## Peaufinage éventuel (à la fin / quand Yohann veut, sur les stats)
- Barge « couper vite, confirmer par V6 dans 0,75 s » pour approcher le 0,7 s.
- Cadence de reprise (11 c/s) à ajuster à l'oreille ; à terme, la bouche remonte sa position exacte → reprise au caractère près ([[conv51-reprise-position-exacte]], dette gravée).
- Endpointing (grâce) sur les pauses qui frôlent la coupe.
- Empilement barge (option B) + cale WarmBrain = `plan/02` (mémoire durable).

## Frontières/écarts tracés (§7 `plan/01`)
Reprise = estimation temporelle · `matchPause` strict (« un instant » seul non reconnu — élargir si Yohann veut) · fenêtre sourde ≤ resumeWaitMs 4 s sur reprise à cerveau lent · `listenState` périmé après quiesce (cosmétique, UI non bâtie).

## Lecture pilote conv 52
`docs/PATTERN…` → `CLAUDE.md` → `ESSENCE-Sophia.md` → `JOURNAL-ARBITRAGES.md` → **`docs/plan/01-pipeline-vocal.md`** (§3 la grille V10, §7 V10-partiel conv 51) → **mémoires `conv51-pause-reprise-spec` + `conv51-reprise-position-exacte`** → `src/orchestrator/voice/router.ts` (pause/reprise) → CE relais.

## Leçon conv 51 (re-vécue)
**Le trou est TOUJOURS dans MES ajouts / MA correction, jamais le cœur** (croisé 1 MAJEUR dans le cycle de vie de la pensée ; re-croisé 1 MINEUR frère non couvert de MA correction — tous prouvés mordants). **Et : ne JAMAIS dire « c'est réglé » sans preuve** (mon `killPhantoms` — un pansement d'outil, corrigé au niveau tooling). **Mesurer, vérifier à la source, ne pas surestimer.** Yohann calibre et juge à son oreille.
