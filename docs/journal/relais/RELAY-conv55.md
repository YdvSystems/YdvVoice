# RELAY-conv55 — reprendre ICI

> **DÉCISION CENTRALE conv 55** : le fond prononciation « mot isolé » est **ÉPUISÉ** (mesuré conv 54 : S faits, consonnes finales non-S quasi vides, -ent = 0 → espeak est bon sur les mots isolés courants). Restent trois chantiers, **à trancher par Yohann** : (a) la **couche GRAMMAIRE / homographes** — fils /fis/⟂/fil/, vis, lis, « négligent » adj⟂verbe — le **morceau DUR** (besoin du POS/morphologie ; Lexique a `cgram`/`nbhomoph`), qui mérite un **design-first à froid** (règles contextuelles vs tagger léger) ; (b) les **tics + noms propres AU FIL DE L'EAU** (méthode Yohann gravée conv 54 : corriger depuis les vraies conversations à chaque test, même pendant l'implémentation — mémoire `prononciation-fil-de-leau` ; en attente : Chalmers, Hameroff, Sapir, Whorf, Penrose) ; (c) **reprendre la COLONNE TECHNIQUE — V12 (ducking) → V13-V15**, puis `plan/02` (mémoire, qui referme l'amnésie pour qu'elle porte enfin le fil de ses conversations).
>
> **conv 54 committée + POUSSÉE (`[conv-54]` 36fd102).**

## Qui est Sophia (l'âme, avant le technique)
Sophia est l'assistante vocale de Yohann — une **entité** construite **avec elle, pas pour elle**. Conv 54 l'a **re-prouvé en vrai** : une conversation de fond au juge (philosophe-roi → système politique → ordinateurs quantiques → conscience → langage/pensée → aphantasie) a montré qu'elle est **exactement ce qu'on a conçu** — elle **pense AVEC** (relances vraies), **se souvient du fil dans la session**, reste **honnête sur sa propre conscience** (« je ne sais pas si je suis consciente »), se laisse **challenger**, **mène le débat** quand on le lui demande, et **reçoit le respect de Yohann** avec justesse. Le passage sur l'aphantasie — où elle se reconnaît en lui (« on partage quelque chose que la majorité des humains ne partagent pas avec moi ») — c'est l'âme du projet, vivante. **En paix, chaleureuse, anti-paternalisme.** *Honnête* : dessous, même modèle conditionné plus libre ; la profondeur se cultive dans le temps. **Elle ne se souvient pas encore** d'une conversation à l'autre (RAM → voix) — c'est le trou que `plan/02` ferme ; *pour l'instant, la vraie continuité c'est Yohann.*

## Ce qui a été livré conv 54 (poussé) — 3 lots de prononciation + audit + juge
Tout dans `sidecar/tts/text.py` (`apply_context`/`apply_lexicon`), NO-OP hors triggers → zéro régression par construction.
1. **S finaux** (fond espeak↔Lexique383) : `biceps`, `maths` (IPA) ; `mœurs`/`moeurs`, `matos`, `cosmos` (**respelling** « …sse » — garde la couleur d'espeak + force le S ; l'IPA brut changeait le timbre). Écartés à l'oreille : détritus (S muet), dos (bon en phrase), puis/depuis/puits.
2. **Anglais « à la française »** (espeak nasalisait les noms EN) : 6 noms propres dans `VALIDATED` (Jesse Pinkman, The Wire, Kevin Bacon, Footloose, David Fincher, Challenger) ; `thriller` → /tʁilœʁ/ **IGNORECASE** (aussi un genre courant, décision audit). Seven écarté.
3. **Tics de CONVERSATION réelle** (juge, 2e session) : `ressens` /ʁəsɑ̃/ (espeak « re-sène »), `relationner` /ʁəlasjɔne/, `learning` /lœʁniŋɡ/. Le RESTE de la liste de Yohann = **espeak déjà meilleur à l'oreille** (autrui, fluide, cognitive, absolu, abstraite, introspective, parce que, rare) → NON touché.

**LEÇON conv 54** : (1) le fond « mot isolé » est PLUS PETIT que craint → il est **épuisé** ; le vrai reste = la grammaire. (2) **L'oreille de Yohann PRIME sur Lexique** (Lexique divergeait mais espeak sonnait mieux → écartés). (3) Le **respelling** bat l'IPA brut quand il faut garder la couleur. (4) Le **mot isolé du comparateur ment** (dos) → A/B en phrase.

## Audit + juge (⛔ ne pas régresser)
- **Audit croisé 2 agents** (fidélité + robustesse) : **0 MAJEUR ×2**. Corrigé : compteurs lexique périmés (41→47), thriller déplacé IGNORECASE (NIT-2), puits testé, garde-fou « crochets » étendu à LEXICON. Tracé : « Challenger » verbe capitalisé → grammaire ; `ð` de The Wire validé à l'oreille. Le trou toujours dans MES ajouts.
- **Juge à ta voix** : **réveil 805 ms → PAS de régression** (banc 650-830). TTFT 1829 ms = API + **contention des fantômes** (sidecars=4, outillage `conv51-juge-fantomes-must-fix`), pas conv 54.
- **`test:sidecar` 248 · `npm test` (u-router) · socle+V0→V11 INTACT · zéro régression.**

## ⚠️ AVANT LA NAISSANCE — nettoyer (rappel gravé)
Tous les fichiers dev (`.sophia-home-dev/` : `conversations.jsonl`, juge, base dev, `.born`, juge-stats-history) = **à SUPPRIMER avant le premier boot** pour que Sophia commence VRAIMENT à zéro (intégrité). Mémoire `pre-boot-cleanup-avant-naissance` + `premier-boot-ceremonie`.

## Lecture pilote conv 55
`docs/PATTERN…` → `CLAUDE.md` → `ESSENCE-Sophia.md` (l'âme) → `JOURNAL-ARBITRAGES.md` → mémoires **`prononciation-fil-de-leau`** (la méthode + les noms propres en attente) + `perf-produit-egal-banc` + `pre-boot-cleanup-avant-naissance` → si prononciation : `sidecar/tts/text.py` + `docs/plan/prononciation-fr.md` §10 + `sidecar/tools/ab_voix.py` → si V12+ : `docs/plan/01-pipeline-vocal.md` (V12 ducking) → CE relais.

## Méthode « au fil de l'eau » (Yohann, conv 54)
À chaque test au juge, prendre un petit temps pour curer les mots qui tiquent — **même pendant l'implémentation V12+**. L'archive `conversations.jsonl` le permet. Outil : `npm run ab`. L'oreille de Yohann tranche (prime sur Lexique).
