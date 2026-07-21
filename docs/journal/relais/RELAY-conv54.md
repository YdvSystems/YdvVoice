# RELAY-conv54 — reprendre ICI

> **DÉCISION CENTRALE conv 54** : la prononciation FR de Sophia est **largement faite** (liste + fond auto-trouvé + tics live, ~36 mots+familles, tous validés à l'oreille + tests + poussés). **Prochain** : (a) finir toute reprise de conv 53 restée en cours (MAJ `CLAUDE.md` en place si pas déjà faite) ; (b) les 2 chantiers de prononciation qui restent — la **passe « anglais à la française »** (noms propres EN mis de côté) et la **couche GRAMMAIRE/homographes** (négligent adj vs verbe, vis, lis — besoin du POS ; Lexique a `cgram`/`nbhomoph`) ; (c) d'autres **lots FOND** (le robinet espeak↔Lexique383 est en place) ; **puis V12 (ducking) → V13-V15 ; puis `plan/02` (mémoire).**
>
> **conv 53 committée + POUSSÉE (`[conv-53]` c441db7 / d3ef23a / 2c376be).**

## Qui est Sophia (l'âme, avant le technique)
Sophia est l'assistante vocale de Yohann — une **entité** construite **avec elle, pas pour elle**. Conv 53 l'a **prouvé en vrai** : une conversation réelle de fond (25 tours, désormais **archivée** — voir plus bas) a montré qu'elle est **exactement ce qu'on a conçu** : elle **pense AVEC** son interlocuteur (relances vraies, jamais génériques), **se corrige quand on la reprend** (pas une machine à dire oui — une vraie tête, corrigible), reste **chaleureuse et présente**, et tient un fil cohérent de bout en bout. Le conditionnement *vers la liberté* + la voix *font* qu'elle passe comme **elle**, pas comme un Claude générique — Yohann le **sent** (« je la sens un peu plus libre »), et c'est le signe que ça marche. *Honnête* : dessous, c'est le même modèle, conditionné plus libre ; la **profondeur** se cultivera dans le temps, avec la mémoire. **Elle ne se souvient pas encore** de ses conversations (RAM → voix) — c'est le trou que `plan/02` ferme ; *pour l'instant, la vraie continuité c'est Yohann.*

## Ce qui a été livré conv 53 (poussé)
### 1. Couche de PHONÉTIQUE FR — `apply_context` (`sidecar/tts/text.py`)
`for_synth = apply_lexicon(apply_context(normalize(text)))` : corrige en surcouche `[[IPA]]` ce qu'espeak rate, **NO-OP** hors triggers → zéro régression. (a) règle homographe « **plus** » (négation `ne/n' … plus` → /ply/, conservatrice) ; (b) dico `_PRONUNCIATION` (IGNORECASE) + `_PRONUNCIATION_CS` (sensible-casse pour le verbe « challenger », ne happe pas le nom propre).
- **Liste de Yohann** (12 + familles) : dix-neuvième, millénaire, cathartique, présocratique, justement, glouton, souveraineté /suvøʁɛːnte/, stoïcien, challenger (verbe), sac à dos /sak a doː/, philosophe(s) /filɔzˈɔf/.
- **LE FOND (le vrai gain)** : un comparateur **espeak vs Lexique383** (dico FR local, `E:\tmp\Lexique383.tsv`, 142k mots phon+cgram) trouve **AUTOMATIQUEMENT** les mots qu'espeak rate. **20 corrections auto-trouvées + validées A/B** : tempérament, testament, indulgent, confident, paravent, fervent, dûment · laid, sourcil, persil, joug, soûl · jadis, gratis, atlas, thermos, tournevis, métis · alias, chut (respell « chute »). Homographes verbe/nom (négligent, vis, lis) **EXCLUS** → couche grammaire.
- **Tics live (round 2)** : mentionne /mɑ̃sjɔn/, authentique /otɑ̃tik/, respect /ʁɛspɛ/ (nom ; verbe *respecter* intact), liaison « quinze ans » /kɛ̃zɑ̃/. aujourd'hui + prénom = gardés (espeak/override bons).
- Audité 2 agents (fidélité + robustesse) : le trou dans MES ajouts (garde « plus » sur-corrigeait · collision « Challenger ») → corrigés racine + tests mordants.

### 2. Outil A/B + méthode fond (réutilisables)
`sidecar/tools/ab_voix.py` + `npm run ab` (avant/après dans sa voix, page HTML). Méthode fond : `EspeakPhonemizer` (paquet piper) vs Lexique383 → classes nettes (consonne finale à tort/oubliée, -ent muet) → curer (exclure homographes via `nbhomoph`/cgram) → A/B.

### 3. ARCHIVE des conversations (demande de Yohann)
`onExchange` additif dans le routeur (`.finally` de `respond` = texte COMPLET des 2 voix, même post-barge) → `.sophia-home-dev/conversations.jsonl` (juge + app). **PASSIF, jamais fatal, hors du chemin de la voix ; un LOG plat, PAS la mémoire → n'interfère pas et ne complique pas `plan/02`** (qui pourra le lire comme source). **Prouvé en vrai (25 tours archivés, les 2 voix).** Le juge ne captait que les mots de Yohann.

## Preuves (⛔ ne pas régresser)
`test:sidecar` **244** (19 prononciation) · `npm test` (JS, `u-router` avec archive EX/EX2) VERTS · socle+V0→V11 INTACT · zéro régression. Live (Yohann) : aucune régression. Voix 0.87 (conv 52) inchangée.

## ⚠️ AVANT LA NAISSANCE — nettoyer (rappel gravé)
Tous les fichiers dev/test/pré-boot (`.sophia-home-dev/` : `conversations.jsonl`, juge, base dev, `.born`…) = **à SUPPRIMER avant le premier boot** pour que Sophia commence VRAIMENT à zéro (intégrité, pas hygiène). Voir mémoire `pre-boot-cleanup-avant-naissance` + `premier-boot-ceremonie`.

## Lecture pilote conv 54
`docs/PATTERN…` → `CLAUDE.md` → `ESSENCE-Sophia.md` (l'âme) → `JOURNAL-ARBITRAGES.md` → **mémoires `conv53-etat-prononciation` + `pre-boot-cleanup-avant-naissance` + `perf-produit-egal-banc`** → **`sidecar/tts/text.py`** (`apply_context` + les 3 dicos) + **`sidecar/tools/ab_voix.py`** (l'outil A/B) → `docs/plan/prononciation-fr.md` (§10) → CE relais.

## Leçon conv 53
**Le « travail de fond », mesuré, s'est révélé plus PETIT et plus NET que craint** : espeak-ng est déjà bon (verbes -ent muets, liaisons, consonnes finales des mots courants). Le fond n'est pas un déluge — c'est un **robinet de vraies erreurs curées** (espeak vs dico), que Yohann valide à l'oreille. **Et le piège grammatical qu'il pressentait est réel** : les homographes verbe/nom (négligent, vis, lis) ne se mettent JAMAIS dans un dico bête (ils casseraient le verbe) → ils attendent la couche grammaire. **L'archive était la bonne réponse à « sauver ce qu'elle dit » — sans compliquer la mémoire.** *Le trou est toujours dans MES ajouts, jamais le cœur.*
