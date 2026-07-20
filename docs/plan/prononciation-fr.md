# Prononciation « à la française » — Module de phonétique · Plan & base de réflexion · YdvVoice (Sophia)

> Conversation intermédiaire conv 53 (avant V12). **Décision centrale** : bâtir un vrai **module de
> phonétique française** — pas des rustines mot-à-mot, mais une brique de fond qui s'appuie sur la
> **grammaire / l'orthographe / la conjugaison** pour prononcer juste, et vise **mieux que le rendu
> Piper/espeak par défaut**. Local, sans API. Architecture **(C)** validée par Yohann. Chaque cas
> tranché **à son oreille** (A/B). Renvois : `plan/01` §7 (TTS/V7) · A9/A20 (voix) · mémoire
> [[conv52-prononciation-fr-scope]] · [[voix-lexique-ab-workflow]] · [[perf-produit-egal-banc]].

## 1. Objectif & ce que ça change
Aujourd'hui `for_synth = apply_lexicon(normalize(text))` (`sidecar/tts/text.py`) : `normalize` déplie les
chiffres/dates → mots, `apply_lexicon` remplace 41 **noms propres** par de l'IPA `[[…]]` — **context-free**
(mot isolé). Espeak-ng phonémise tout le reste, et **se trompe de façon prévisible** en français. Objectif :
une couche **consciente de la grammaire** qui corrige ces erreurs systématiquement, sans jamais dégrader
ce qu'espeak dit déjà bien (⛔ zéro régression). C'est ce qui fait passer Sophia de « lit du français » à
« **parle** français ».

## 2. Faits établis à la source (2026-07-20)
- **A20 connaît tout l'IPA** : `phoneme_type: espeak`, voix `fr`, **166 phonèmes** (voyelles `a e i o u y ø œ ə
  ɛ ɔ ɑ ɥ`, nasales via `̃`, `ʁ ʃ ʒ ɲ ŋ w j`, `t`+`ʃ` = /tʃ/, accents `ˈ ˌ`, longueur `ː`). → **aucune
  contrainte de phonèmes** : notre module peut dicter n'importe quelle prononciation FR au phonème près via
  `[[IPA]]`. (Vérifié : `resources/models/voice/fr_FR-a20-e400.onnx.json`.)
- **Piper phonémise via espeak-ng** (`espeakbridge.pyd` + `espeak-ng-data/` embarqués). Le `[[…]]`
  **court-circuite** espeak sur la portée voulue → on **surcharge** là où il se trompe, on garde espeak ailleurs.
- **espeak-ng erre en FR, de façon prévisible** : consonnes finales (bug amont *cerf* /sɛʁf/→/sɛʁ/), mots
  étrangers « à la française », et tout ce qui **dépend de la grammaire** — le **« -ent » muet des verbes**
  (« ils mangent » /mɑ̃ʒ/ vs « lentement »), les homographes hétérophones (plus/est/fait/tous), la liaison
  (h aspiré). Un moteur sans grammaire ne peut pas trancher.
- **Lexique383** (lexique.org, local, gratuit, **pas d'API**) : 140 000 mots avec **orthographe · phonologie ·
  lemme · catégorie grammaticale · genre · nombre · syllabation**. = le dictionnaire de référence FR + la
  grammaire. Wrapper `pylexique` OU le `.txt` brut (on préférera le `.txt` → zéro dépendance runtime).
- **gruut** (même auteur que Piper) : phonémiseur dico+POS FR — **source d'idées**, pas un remplaçant
  (son IPA ≠ conventions espeak sur lesquelles A20 est entraîné).
- **Recherche 2025** : « Fast, Not Fancy » — **règles + bon dictionnaire** battent le ML fancy sur le G2P ;
  POS tagging = étape de base ; homographes durs = classifieur F>0.96 (overkill pour nous).

## 3. Architecture — (C) module hybride adossé au dictionnaire *(validée Yohann)*
- (A) surcouche ciblée (espeak + rustines) — trop peu ambitieux.
- (B) phonémiseur FR complet remplaçant espeak partout — viole ⛔ zéro-régression (casse les cas déjà bons)
  + chantier disproportionné + prosodie/accents à refaire.
- **(C)** un **vrai module** — grammaire légère + dictionnaire Lexique + règles — **appliqué en surcouche**
  (`[[IPA]]`), espeak gardant les cas justes. Profond **et** sans régression, A/B validé, extensible vers (B).

## 4. Conception du module
### 4.1 Pipeline (le point d'insertion — unique)
```
for_synth(text) = apply_lexicon( apply_context( normalize(text) ) )
```
`apply_context` = le module. **Après** `normalize` (voit les mots, pas « 20 »), **avant** `apply_lexicon`
(français propre, pas de `[[…]]` en travers ; peut lui-même insérer des `[[IPA]]`). NO-OP sur ce qu'il ne
gère pas → non-régression par construction. `for_synth` est le **point de passage UNIQUE** avant Piper
(`engine.py`) → tout ce que Sophia dit y passe.

### 4.2 Les couches internes de `apply_context` (ordre = du plus sûr au plus contextuel)
1. **Corrections systématiques par motif** (le fond) : quand espeak se trompe sur un **groupe de lettres /
   un suffixe**, on corrige le **motif** → attrape la **famille** d'un coup (chevaucher/chevauche/…,
   philosophe/philosophie/philosopher). Règles déterministes, gatées, A/B validées.
2. **Grammaire / conjugaison** : le **« -ent » muet** des verbes 3ᵉ pers. pl. (morphologie : radical connu
   + terminaison verbale → -ent muet), sans gros tagger.
3. **Homographes** (plus/est/fait/tous) : règles contextuelles nettes.
   - **plus** : négation `ne`/`n'` présente → `[[ply]]` (« je n'en veux plus ») · sinon → `[[plys]]`
     (« j'en veux plus ») · devant voyelle (liaison) → `[[plyz]]`. *(Règle donnée par Yohann.)*
   - **est** cardinal « l'Est » → `[[ɛst]]` (le verbe /ɛ/ = défaut) · **fils** câble → `[[fil]]` · **cosmos**
     s final → `[[kɔsmos]]` · **en fait** t final → `[[ɑ̃ fɛt]]`.
4. **Liaisons** : surtout le **h aspiré** (bloquer la liaison à tort « les héros ») + liaisons obligatoires
   utiles (vingt‿ans…). Petite liste h-aspiré + règles de frontière.
5. **Dictionnaire de mots durs** (adossé Lexique) : mots individuels où espeak dévie + leurs familles →
   `[[IPA]]`. (Généralise l'actuel `apply_lexicon`, désormais aussi pour des mots courants, pas que des noms.)

### 4.3 Lexique = source BUILD-TIME ; runtime = dictionnaire curé (le choix perf)
On ne charge **pas** 140 000 mots au runtime. **Build-time** (hors-ligne, outil de dev) : on **diffuse
espeak vs Lexique383** sur le vocabulaire → liste des mots où ils **divergent** → on retient (après contrôle)
un **petit dictionnaire curé** (erreurs d'espeak + familles + homographes + h aspiré). **Runtime** : ce dico
curé seul — quelques milliers d'entrées, **chargement instantané, ~centaines de Ko en RAM**. Coût par phrase
= `dict.get(mot)` = microsecondes. → « faire mieux que Piper » **systématiquement**, à coût runtime ~nul.

### 4.4 Contrainte phonèmes + mapping
Le dico curé produit de l'IPA dans l'**inventaire des 166** (espeak). La phonologie de Lexique est en alphabet
maison (SAMPA-like) → **table de mapping finie** (≈36 phonèmes FR → IPA espeak), écrite + testée une fois.

## 5. Perf & non-régression (⛔ règle perf — produit ≥ banc)
- **Local = plus rapide qu'une API** ici (pas de réseau ; recherche RAM en µs). CPU only, **avant** synthèse,
  **GPU (STT) intact**, bouche Piper non ralentie. Pas de contention (≠ conv 47 = fils audio).
- **Coût** : par phrase = µs (négligeable devant Piper RTF ~0,04) ; au warm = un chargement unique (comme le
  warmup Piper/STT) ; RAM = quelques centaines de Ko. **SSD dédié non-critique ici** (données minuscules,
  RAM-résidentes ; le SSD sert la mémoire/modèles/sauvegardes, pas ce module).
- **Banc de mesure** (design-first) : temps de charge du dico + coût par phrase mesurés **avant de graver**.
- **Zéro régression par construction** : surcharge seulement là où espeak se trompe ; cas justes intacts.

## 6. Méthode — l'oreille de Yohann est le juge (A/B)
- **Mesurer d'abord** : rendre la liste de tics dans la **voix actuelle** → Yohann marque ce qui écorche
  **et comment** (évite le « piège du sur-lexique » : ne rien corriger qui est déjà bon).
- **Outil A/B** `sidecar/tools/ab_voix.py` (NEUF, permanent, `npm run ab`) : avant (`for_synth` actuel) vs
  après (règle proposée), WAV + page HTML A/B, à length_scale 0.87 (défaut produit). Sous `.venv-sidecar`.
- **Tic par tic** : catégoriser (motif/grammaire/homographe/liaison/mot dur) → coder → A/B → test qui mord.

## 7. Tests
- `sidecar/tests/test_prononciation_fr.py` (NEUF, logique pure) : chaque règle + **no-op** sur texte sans
  trigger (non-régression du voisinage) + mapping Lexique→IPA + le « plus » (ne/n' vs sans).
- Contrat existant intact : `test:sidecar` (225 → +N), `test_v7` (normalize/lexicon/for_synth) VERTS.
- `npm run juge` en fin (les phrases réelles sonnent juste ; réveil/latence intacts).
- Audit croisé 2 agents (fidélité + robustesse) + re-croisé, à la clôture (R1).

## 8. Honnêteté / limites
- Homographe **vraiment** ambigu sans le sens : on câble les cas nets (le « ne » du « plus » = donné par
  Yohann), on laisse le défaut sinon. Rare.
- Faiblesses de **timbre** du modèle A20 (réfléchir/manières) = hors G2P, non réparables au texte.

## 9. Séquencement (mains dans le cambouis)
1. **Outil A/B** `ab_voix.py` + rendre la liste de Yohann telle quelle → son oreille marque le réel.
2. **Squelette** `apply_context` (no-op, inséré, testé zéro-régression).
3. **Build-time** : récupérer Lexique383 (local) + outil de diff espeak↔Lexique + mapping IPA + banc perf.
4. **Couches** (motif → grammaire -ent → homographes → liaison → dico dur), une par une, A/B + test.
5. **Noms propres / anglais** de la liste (Challenger `[[tʃalɛnˈʒœʁ]]` à A/B, Fincher, Seven…) → dico.
6. Audit croisé + `npm run juge` + commit `[conv-53]` + trace `plan/01` §7 + mémoire + `RELAY-conv54`.

## 10. Journal des écarts (code ↔ ce plan)

### Bâti conv 53 (committé `[conv-53]`)
- **`apply_context`** (`sidecar/tts/text.py`) inséré dans `for_synth = apply_lexicon(apply_context(normalize(text)))` :
  (a) règle homographe « plus » `_NEG_PLUS` (négation `ne/n'` … plus en fin de proposition → `[[ply]]`,
  conservatrice) ; (b) dico `_PRONUNCIATION` (INSENSIBLE à la casse) ; (c) dico `_PRONUNCIATION_CS`
  (SENSIBLE à la casse, la famille du verbe « challenger », pour ne pas happer le nom propre « Challenger »).
- **12 corrections validées à l'oreille (A/B)** + familles : `plus` (règle) · dix-neuvième `/disnœvjɛm/` ·
  millénaire `/milenɛːʁ/` · cathartique `/kataʁtik/` · présocratique `/pʁesɔkʁatik/` · justement `/ʒystəmɑ̃/` ·
  glouton `/ɡlutɔ̃/` · souveraineté `/suvøʁɛːnte/` · stoïcien `/stɔˈisjɛ̃/` · challenger (verbe) `/tʃalɛndʒe/` ·
  sac à dos `/sak a doː/` · philosophe(s) `/filɔzˈɔf/`.
- **Outil A/B** `sidecar/tools/ab_voix.py` (permanent) + `npm run ab`. **16 tests** `test_prononciation_fr.py`.
- **ÉCART assumé (mode LISTE, pas encore mode FOND)** : ces corrections sont **artisanales** (IPA écrit main,
  validé A/B), PAS issues de Lexique383/POS. Le dico/grammaire automatique = **chantier suivant** (§9 pt 3).

### Gardés au défaut espeak (acceptables / hors G2P)
- en fait · adulte · époque · Napoléon · hauteur : le mieux entendu = l'original (ou limite de **timbre** du
  modèle A20, comme réfléchir/manières — non réparable au texte).

### Différé — passe « anglais à la française » (demande Yohann)
- Noms propres anglais : Jesse Pinkman `[[dʒesi …]]` · The Wire `[[ðə wajœʁ]]` (candidat) · Kevin Bacon ·
  Footloose · David Fincher · Thriller · Seven. À traiter ensemble dans une passe dédiée aux anglicismes.

### Audit (R1) — croisé 2 agents (fidélité + robustesse)
- **Le trou dans MES ajouts, pas le cœur** : convergent **MAJEUR** = la garde « plus » sur-corrigeait (« il ne
  veut **rien de plus** » → `[[ply]]` à tort) → garde élargie (rien/qu'/que/personne/aucun/nul/guère/ni ;
  `jamais` retiré car « jamais plus » = négation) + ne traverse plus tirets/parenthèses. **MINEUR** = le verbe
  « challenger » IGNORECASE happait « Challenger » (nom propre) → dico sensible à la casse. NIT (crash outil
  dev · O(n²) négligeable une-phrase-à-la-fois · familles incomplètes) fermés/tracés. **Tests mordants ajoutés.**
- **Preuves** : `test:sidecar` **241** (dont 16 prononciation) · zéro régression V0→V11 · `npm test` OK.

### Limites assumées (documentées, réglables plus tard)
- Homographe « plus » vraiment ambigu ou « ne … plus **de** X » (plus au milieu) → laissé à espeak
  (SOUS-correction sûre, jamais une régression). Réglable si ça écorche en usage réel.
- Familles incomplètes (stoïquement, challengeais…, cathartiquement) → ajoutées au fil si signalées.

### FOND livré + ARCHIVE (conv 53, 2ᵉ commit)
- **Le FOND en action (espeak vs Lexique383) : 20 corrections AUTO-TROUVÉES + validées A/B** ajoutées au dico
  (tempérament, testament, indulgent, confident, paravent, fervent, dûment · laid, sourcil, persil, joug, soûl ·
  jadis, gratis, atlas, thermos, tournevis, métis · alias, chut→respell « chute »). Homographes verbe/nom
  (négligent, vis, lis) EXCLUS → couche grammaire à venir. Mécanisme : `EspeakPhonemizer` (piper) vs
  `Lexique383.tsv` (`E:\tmp`, 142k mots phon+cgram), scripts jetables scratchpad → classes nettes → cure → A/B.
- **ARCHIVE des conversations (demande Yohann : sauver ce qu'ELLE dit + que Claude lise le cœur des échanges)** :
  `onExchange` (routeur, `.finally` de `respond` = texte COMPLET des 2 voix, même post-barge) → `conversations.jsonl`
  (juge + app). ADDITIF/passif/jamais-fatal → **n'interfère pas + ne complique PAS `plan/02`** (un LOG plat, pas la
  mémoire ; plan/02 pourra le lire comme source). Testé `u-router` (EX/EX2). Câblé `runtime.ts` + `juge.mjs`.
- **À FAIRE (tics notés en live, conv non clôturée)** : prénom Yohann, liaison « quinze‿ans », mentionne /
  authentique / aujourd'hui / respect ; puis passe anglais + couche grammaire/homographes.
