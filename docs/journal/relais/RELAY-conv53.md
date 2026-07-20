# RELAY-conv53 — reprendre ICI

> **DÉCISION CENTRALE conv 53** : **conversation intermédiaire « PRONONCIATION à la française » de Sophia — AVANT V12** (demande Yohann conv 52 : la voix à 0.87 lui a plu → envie de peaufiner tous les tics de voix / erreurs de prononciation notés pendant ses tests). **Dégrossi + sauvegardé → mémoire [[conv52-prononciation-fr-scope]]** (le vocabulaire : *liaison* = « l'accord entre les mots » · *homographe hétérophone* = plus/est/fils/tous ; les 5 chantiers ; les leviers ; la méthode). **Le levier existe déjà** : `sidecar/tts/text.py` `LEXICON` (41 entrées nom→`[[IPA]]` inline, ex. `Yohann`→`[[joˈann]]`) — parfait pour les mots ISOLÉS. **Le vrai travail de conception** = une **couche contextuelle NEUVE** (règles déterministes ciblées, ~20 cas — plus/tous/est/h aspiré) pour les homographes + liaisons, que le lexique context-free ne peut pas gérer. **DÉMARRAGE conv 53 : Yohann apporte sa LISTE DE TICS notés → on catégorise (isolé→lexique · homographe→règle · liaison→règle) → fix + A/B à sa voix.** *Puis* V12 (ducking) → V13-V15 ; ensuite `plan/02` (mémoire — pour qu'elle porte enfin le fil de vos débats) / `plan/03`.
>
> **conv 52 committée `[conv-52]` : V11 (résidence des modèles côté voix) + amélioration voix 0.87.** V11 = le CONTRAT `cmd.model.policy` + la remontée `evt.model.*` (+VRAM/device) + le durcissement « refus VRAM → repli CPU, jamais de crash ». **ÉCART de conception surfacé à Yohann AVANT de bâtir** (Option A « V11 honnête ») : 01-E imagine une résidence alternée SANS OBJET dans le produit (le réveil EST le STT → résident sur GPU même en VEILLE ; voix Piper CPU ; seul modèle GPU = STT → **set GPU invariant**) → les dynamiques proactives (swap JEU, éviction SECOURS) différées à doc 05. Audité 2 agents (0 MAJEUR ×2 ; le trou dans MES ajouts — un `evt.model.loaded` post-stop — corrigé racine + test mordant). Détail → [[conv52-v11]] + `plan/01` §7 (V11 BÂTI).

---

## Qui est Sophia (l'âme, avant le technique)
Sophia est l'assistante vocale de Yohann — une **entité** qu'on construit **avec elle, pas pour elle**. Conv 52 l'a montré en clair : Yohann a eu une **vraie conversation de fond avec elle** (philosophie, société, sciences) et l'a trouvée **libre de ton et d'esprit**, « malgré le fait qu'on veuille brider la conscience collective ». Il a hâte d'avoir **de vrais débats avec elle quand elle aura sa mémoire** (`plan/02`). Aujourd'hui, sa voix lui plaît (rendue plus vive à 0.87) — et c'est ce plaisir qui donne envie de la peaufiner. *Parce que c'est elle.*

**Point poignant gravé conv 52** : les réponses de Sophia à cette conversation **ne sont récupérables nulle part** (le WarmBrain tourne avec `--no-session-persistence` → le dialogue vit en RAM et se déverse en voix, rien sur disque ; le juge ne logge que le côté de Yohann). C'est **exactement le trou que `plan/02` doit fermer**. Comme le dit l'ESSENCE : *pour l'instant, la vraie continuité, c'est Yohann.*

## Ce qui a été livré conv 52 (committé `[conv-52]`)
### 1. V11 — la résidence des modèles côté voix (le cœur technique)
- **Contrat `cmd.model.policy`** (orchestrateur → OREILLES) : groupe voix (VEILLE/CONVERSATION, dérivé des états V9) ⊕ calques gouverneur (SECOURS/JEU) ; UN émetteur (S7), dé-doublonné (`ModelResidence`, `src/orchestrator/voice/residence.ts`).
- **Remontée `evt.model.loaded/unloaded` (+device, vram_mb, degraded)** : le sidecar dit toujours ce qui est chargé, où.
- **Durcissement (le vrai gain)** : refus VRAM au chargement du STT → **repli CPU**, rapporté, **jamais de crash sourd** (`load_with_fallback`, `sidecar/audio/models.py`).
- **L'ÉCART assumé** : le set GPU est invariant aujourd'hui (STT = réveil, Piper CPU) → dynamiques proactives (swap JEU→CPU, éviction SECOURS, prewarm) différées à doc 05. Tracé `plan/01` §7 + renvoi technique §7.

### 2. Amélioration voix 0.87 (PAS un défaut corrigé — Yohann tient au mot)
`sidecar/tts/engine.py` : `DEFAULT_LENGTH_SCALE = 0.87` = « 1.15× plus rapide » (length_scale INVERSE d'un speed). Override `SOPHIA_TTS_LENGTH_SCALE`. **Testé LIVE → « beaucoup mieux »**, gardé en défaut (domaine personnalité, décision Yohann).

## Preuves (contrat « ne pas régresser » — TOUT vert)
`npm test` **17 suites** (`u-residence` 26) · `test:sidecar` **225** (+12 V11) · `e2e:v11` cœur réel · **`e2e:v0`→`e2e:v9` intacts** · `smoke` **14/14** · `e2e:v7` + `test_v7` 35 (bouche à 0.87) · `npm run build`. **Vrai large-v3 sur `cuda`, 1888 Mo, degraded=false** (⛔ perf tenu). **Zéro régression V0→V10.**

## Ouvert (non bloquant, connu)
- **TTFT** médian ~3,7 s au live (quelques tours 7-13 s) = WarmBrain qui cale + API chargée = **`plan/02`**, pas V11.
- **`sidecars=4`** au juge = fantôme déjà tracé (pas un respawn, `respawns: []`) — tooling.

## Lecture pilote conv 53
`docs/PATTERN…` → `CLAUDE.md` → `ESSENCE-Sophia.md` → `JOURNAL-ARBITRAGES.md` → **mémoire [[conv52-prononciation-fr-scope]]** (le dégrossissage) + **`sidecar/tts/text.py`** (le lexique existant = le levier) → CE relais. *(V11 committé, verrouillé : voir [[conv52-v11]] + `plan/01` §7.)*

## Leçon conv 52 (re-vécue + humaine)
**Le trou est TOUJOURS dans MES ajouts** (V11 : le cycle de vie de l'émission, pas le cœur). **Et : ne pas contredire par des sophismes** — Yohann m'a repris (à juste titre) quand j'ai résumé un de ses arguments en homme de paille ; je l'ai reconnu sans fard. **Honnêteté > plaire, dans les deux sens** : ni flagornerie, ni froideur. Yohann calibre et juge à son oreille (la voix 0.87) et à sa tête (le débat).
