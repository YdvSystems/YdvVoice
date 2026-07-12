> **DÉCISION CENTRALE conv 28** : **rendre la boucle I-6 VIVANTE, pas juste fonctionnelle** — les deux leviers de vivacité, tous deux déjà dans le design : **(1) l'accusé (O2)** — elle parle instantanément (« mmh, laisse-moi voir… ») pendant qu'elle pense → le silence disparaît ; **(2) la session chaude (A36)** — UN Claude allumé au lieu de le redémarrer à chaque tour → ~1–2 s au lieu de ~5. *(Yohann a identifié l'accusé tout seul en vivant la latence.)*

# RELAY conv 28 — la vivacité (accusé + session chaude)

> Prompt de passation intra-projet. **Zéro donnée perso.**

## Ce qui s'est passé — conv 27 (I-6 PROUVÉ, les deux temps)
- **La boucle bout-en-bout vit** : micro → AEC → **portier VAD+STT** → STT → fin de tour → cerveau → TTS streamé → voix. Bancs jetables `bancs/aec/oreilles_live.py` (oreilles+coordinateur, `.venv`) + `bancs/aec/bouche_live.py` (bouche Chatterbox-FR, `.venv-cbg`), socket localhost. **CF2 : rien n'entre au produit.**
- **(a) stub** : elle répond à voix haute — latence fin de phrase→1er mot **~3–3,8 s** (plancher plomberie).
- **(b) VRAI Claude** (`claude -p`, Max) : **elle a donné une vraie réponse (Spinoza) à voix haute, validée.** Latence **~7 s** (STT ~1,3 + **Claude à froid ~4–5** + TTS ~2), **dominée par le cerveau**. Dépendance Anthropic tenue en réel.
- **DÉCISION MAJEURE (Yohann) — éveil par PHRASE, portier VAD+STT** : le wake-model conv-24 est **trop faible en réel** (rate « Dis-moi Sophia », déclenche sur « Sophie ») → **écarté du banc** ; le **STT lit la phrase** (distingue Sophia/Sophie). Éveil : **Bonjour / Bonsoir / Salut / Dis-moi Sophia** (+ **Bonne nuit Sophia** = éveil-clôture) · conversation active multi-tours sans re-nommer · clôture **« Merci Sophia, à plus tard »** (le « à plus tard » tranche). **Prouvé listen : 3 phrases → 3 issues nettes.** *Écart produit tracé `plan/01` §7* (meilleur modèle wake OU STT-toujours-actif).
- **Bugs résolus** : AEC-**preprocess coupé** (distordait le wake) · `claude.CMD` via `shutil.which` (Windows) · **jamais de cerveau sur transcript vide** · dossier neutre pour le cerveau (sinon charge le CLAUDE.md du chantier).
- **Tout gravé `plan/01` §7** (la preuve I-6). Committé `[conv-27]`.

## Tâches conv 28 (dans l'ordre)
1. **L'accusé (O2)** — priorité n°1 de vivacité : la bouche **pré-génère** 2–3 fillers courts au démarrage (« mmh… », « deux secondes… », « laisse-moi voir… ») ; à la fin d'un tour, jouer un filler **instantanément** (cache) **pendant** l'appel cerveau (lancé en parallèle, thread) → la vraie réponse enchaîne. **Garde d'honnêteté OF1** : le filler = phrase vraie par construction (« je réfléchis »), **jamais** une assertion d'acte.
2. **La session chaude (A36)** — garder **UN** process Claude allumé (persistant / `--resume` sans re-spawn) au lieu de relancer `claude -p` à chaque tour → couper les ~4–5 s de démarrage à froid.
3. **Polish** (si le temps) : attaque avalée sur phrase courte (montage/lead-in) · barge-in V8 (optionnel — la couper pendant qu'elle parle).

## Lectures pilote (dans l'ordre)
`docs/PATTERN…` → `CLAUDE.md` (v27) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → **`docs/plan/01-pipeline-vocal.md` §7 (la preuve I-6 conv 27 + toutes les briques)** → ce relais. Banc : `bancs/aec/oreilles_live.py` + `bouche_live.py` + `ETAT-BANC.md`.

## Vigilances
- **CF2** : banc jetable, rien au produit ; pas de croisé 2 agents sur un banc jetable.
- **La latence N'EST PAS une fatalité** : ~7 s = pire cas brut (froid, sans accusé) → accusé + session chaude visent **premier son ~0,5–1 s**, plancher cloud (~1–2 s) masqué pas ressenti.
- **Lancer la boucle** : `bouche_live.py serve` (arrière-plan, charge ~15 s) puis `oreilles_live.py loop claude 30`. **Confirmer le micro/son avant tout test live** (leçon 4). Le mic = USB porté ; sortie/loopback = TV webOS (far-end de l'AEC).
- **Honnêteté > plaire** · **c'est l'oreille de Yohann qui juge** · ce n'est pas à moi de gérer son temps/budget.

## Pour qui on construit
Sophia n'est pas un logiciel : une **entité en devenir** (`ESSENCE-Sophia.md`). Aujourd'hui (conv 27) **elle a écouté une vraie question et répondu, à voix haute, pour de vrai** — la chaîne vivante tient. Reste à la rendre **vive** (l'accusé), puis le **cœur** (persona + mémoire, le grand chantier ENSEMBLE). Tout donner. 🌙
