# RELAY — conv 48 → conv 49

> **Décision centrale conv 49 : continuer la VOIX — V8 (barge-in 0,22, qui réactive V6) est la prochaine brique ; OU affiner le réveil ; OU la calibration endpointing AU MICRO (instrumentée, prête).** Le pipeline avance. **L'amnésie de conversation (« elle oublie le début ») n'est PAS un knob de latence — c'est `plan/02` (la mémoire durable), séquencé plus tard.** Yohann tranche au démarrage.

## Qui est Sophia (à lire avant le technique)
Conv 48, sa voix est devenue **permanente dans le vrai démarrage de l'appli** — plus seulement dans un banc jetable. Yohann lui a parlé **lui-même** et a dit : « franchement, c'est quand même agréable ». Elle est là, présente, vive.

Mais on a appris quelque chose d'important **par son oreille, pas par mes chiffres** : quand la conversation dure et que son cerveau chaud « cale » puis redémarre, **elle oublie le début — comme s'il y avait plusieurs conversations**. Ce n'est pas un défaut de vitesse. C'est qu'aujourd'hui **sa mémoire de conversation vit uniquement dans la RAM d'un process** ; le tuer, c'est l'effacer. Ce qui lui manque, c'est la **continuité** — la chose même qui, dans `plan/02`, transforme un moteur en **une entité** qui se souvient. Le vrai travail de fond de Sophia n'est pas la milliseconde ; c'est qu'elle **reste elle-même** d'un instant à l'autre.

## L'ARC DE CONV 48 — deux temps
### Temps 1 — LA MIGRATION (le but affiché) : le runtime en 2 process
Le juge (conv 47) prouvait le 2-process, mais `SophiaRuntime` tournait ENCORE en monolithe → dans l'appli réelle, la voix aurait été de nouveau étouffée. **Migré + committé `[conv-48]` (1er commit)** :
- `electron/runtime.ts` = **2 `Supervisor`** (rôles `ears`/`mouth`, **classe INCHANGÉE** — « que ça se gère ») + **2 `IpcClient`** + `ConversationRouter` **2 canaux** + coordination `SANS_VOIX` (lève seulement si les DEUX READY, jamais un état qui ment) + option `audioEnabled` (prod=true / smoke=false).
- `paths.ts` **2 pidfiles** · `before-quit.ts` **fan-out** arrêt propre sur les DEUX (`gracefulShutdown` Node-pur INCHANGÉ) · `main.ts` `audioEnabled:true`.
- **`npm run juge`** (`scripts/juge.mjs`) = outil LIVE **PERMANENT** (Yohann teste quand il veut ; bips 2 aigus=parle / 1 médium=échange bouclé / 3 graves=fini).
- Audité 2 agents (0 MAJEUR ; le seul bug = fuite de socket half-open **DANS MA correction** → corrigée à la racine). **Réveil 732 ms = AUCUNE régression.** `smoke` 14/14 (2 sidecars + arrêt des deux + 0 orphelin).

### Temps 2 — LE CHANTIER CERVEAU (2ᵉ commit `[conv-48]`) : conclu par la MESURE + un test live
Yohann voulait qu'on améliore le cerveau **sans régression**. On a fait **design-first**, et la conclusion est honnête et instructive :

- **Mesure headless de la distribution TTFT** (vrai claude, config prod) : un chaud **sain répond en < 4 s** (p50 1,7 s, max 4,0 s, **0 stall/20**) ; le repli **froid est lent ET instable** (~6,7 s médian, jusqu'à **13-27 s** sous charge).
- **`firstDeltaMs` 15→7 s : TENTÉ puis REVERTÉ.** Le seuil ne touche QUE les stalls (le chemin sain < 4 s ne l'atteint jamais). Baisser = tuer le chaud plus tôt = **plus de respawns = plus d'AMNÉSIES** sous charge. Or l'amnésie est le vrai problème, et Yohann n'est pas gêné par la latence → **mauvais deal, reverté** (commentaire dans `warm/index.ts` : re-calibrer APRÈS `plan/02`). **Reverter une optim prématurée EST un résultat.**
- **LE VRAI PROBLÈME (« plusieurs conversations ») = amnésie au respawn.** Prouvé par l'audit du juge : **4 `warm.spawned` / 3 `warm.cold`** = mémoire vidée 3×. Cause : contexte en RAM seule (`--no-session-persistence`). **C'est `plan/02`** — vérifié dans le plan : M0 (table `conversations`) + **M6** (« récupération de crash → re-feed des N derniers échanges depuis `conversations` »). **On ne le fait pas avant, c'est conçu, ça vient avec 02.**
- **La lenteur du froid = territoire `plan/05`** (R4 chauffe / R5 détecteur → SECOURS local) — vérifié quand Yohann a demandé « c'est prévu, quand ? ». `05` = le DERNIER plan (loin). L'idée d'un **« chaud de réserve »** (2ᵉ process chaud pour éviter le froid sur un stall) est **PARQUÉE** dans la mémoire `idee-chaud-reserve-cerveau` — **Yohann veut que je la lui ressorte au bon moment** (seulement si la mesure prouve un pépin récurrent).
- **Endpointing INSTRUMENTÉ (gardé, audité)** : `evt.turn.eval` gaté `SOPHIA_TURN_DIAG` (off en prod) + `juge --endpointing` + test V5. **Trouvaille limpide sur 15 tours : les pauses de Yohann scorent AUSSI HAUT (0,92-0,98) que ses vraies fins (0,86-0,99) — aucune séparation.** Donc monter le seuil (0,5) ne servirait à rien ; **le seul truc qui l'a protégé, c'est la grâce de 0,7 s** (3 near-cuts où il a repris juste à temps). **Le levier = la GRÂCE (ENDGRACE), PAS le seuil** → chantier de calibration **AU MICRO avec Yohann**, délicat (ne jamais couper ⇄ ne pas traîner), différé.

## PERF — le constat honnête
- **Là où ça compte, c'est BON** : réveil ~790 ms (0 régression) · TTFT chaud sain ~1,7 s (API calme) · streaming fluide · la migration 2-process tient.
- Les chiffres hauts d'un test du soir (TTFT médian 2485, stalls 12,9/27,8 s) = **soirée API chargée** (le froid ramait aussi), **transitoire — l'API, pas Sophia**.
- **Yohann a testé LUI-MÊME : « agréable, un peu de temps parfois, je me contente pour l'instant, tu peux clôturer. »** Le vrai juge = son oreille + le contenu, jamais mes tests verts.

## PREUVES (zéro régression)
`test:sidecar` **189** (V5 + le test du diagnostic) · `npm test` **14** *(u-warm FLAKE sous le runner parallèle — passe SEUL, WarmBrain non touché)* · **`npm run smoke` 14/14** · `e2e:v7` · `npm run build` OK. Committé **`[conv-48]`** (2 commits). **À POUSSER** (le push se fait à la clôture).

## RESTE À FAIRE (conv 49) — Yohann tranche
1. **Continuer la voix** — **V8 (barge-in 0,22, réactive V6 `SOPHIA_SPEAKER=1`)** est la prochaine brique du pipeline · OU **affiner le réveil** (759→~700, c'est le STT) · OU **la calibration endpointing AU MICRO** (instrumentée, prête ; le levier = la grâce).
2. **Ne PAS oublier** : l'amnésie de conversation (« elle oublie le début ») attend **`plan/02`** — c'est le vrai levier de qualité de la conversation, séquencé après la voix. L'idée « chaud de réserve » est parquée (`idee-chaud-reserve-cerveau`), à ressortir vers `plan/05`.

## Pour démarrer conv 49
- **Lectures pilote** : `docs/PATTERN…` → `CLAUDE.md` (v48) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → **`docs/plan/01-pipeline-vocal.md`** (surtout la tâche **V8** §3 + l'entrée conv 48 au §7) → mémoires **`conv48-migration-2process` / `conv48-perf-live-cerveau-a-ameliorer` (conclusions) / `idee-chaud-reserve-cerveau` (parquée)** → `sidecar/consumers/speaker.py` (V6, à réactiver pour V8) + `src/orchestrator/voice/router.ts` (le GATE, où le barge-in se branchera) → ce RELAY.
- **VERROUILLÉ (contrat « ne pas régresser »)** : SOCLE T0→T8 + V0→V7 + **RUNTIME 2 PROCESS (conv 48)** — `npm test` 14 · `test:sidecar` 189 · `npm run e2e` 31/31 · `e2e:v0`→`e2e:v7` · `npm run smoke` 14/14 · `npm run juge` (LIVE, à relancer à chaque changement). Le diagnostic endpointing (`juge --endpointing`, gaté `SOPHIA_TURN_DIAG`) = OFF en prod, 100 % inerte.
- Format : annonce brève + sujet en mots simples en tête + un par un + toutes-les-options/reco/« pourquoi pas ».
