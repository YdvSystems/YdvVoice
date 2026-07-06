# 99 — Orchestration · Doc technique · YdvVoice (Sophia)

> **Rôle** : l'assemblage — comment les pièces gravées en `00`→`05` s'emboîtent en un seul système : la table globale des états, le chemin d'un tour, la composition du prompt, la grille finale, les affordances UI, la porte publique du fork. **Dernier doc de la Phase 2.** **AUCUNE mécanique nouvelle** : ce doc compose, pointe, et nomme les couplages que chaque doc amont ne pouvait pas voir seul ; le `99` n'est jamais la source de vérité d'un mécanisme.
>
> **Statut** : décisions complètes (99-A → 99-F, validées **une par une** conv 13) + **audit solo intégré** (S1-99 frontière de l'annulation · S2-99 précision du critère 2) — précédées d'un **audit transversal du corpus** (solo AT1–AT10 + croisé 2 agents CF1–CF3/CT1–CT2, conv 13 : le corpus a été mis en cohérence AVANT l'assemblage — rien d'implicite connu n'a été légué à ce doc). Les **valeurs chiffrées** sont différées à la **calibration Phase 3** (rubrique 7).
>
> **Altitude** : composition et couplages. Pas de code, pas de chiffres inventés, **zéro redite des docs amont** (pointeurs partout).

---

## 1. Arbitrages couverts *(pointeurs — zéro redite)*

- **Cœur** : **A2** (l'aiguilleur d'intention — sa branche **déterministe** est réalisée : la grille + elle-même, §4.1 ; A2 disait « Haiku **ou** déterministe » — Haiku garde ses places gravées en coulisses : génération proactive A25, micro) · **A13** (l'injection — composée §4.4) · **A32-étendu** (la grille — consolidée §2.2) · **A37** (le ladder mains — sa part résiduelle, §4.6) · **A36 / passe de réalité #3** (le plancher TTFT et l'accusé, §4.2).
- **Les renvois « → doc `99` » honorés** : composition finale du prompt (docs `02` §4.5 / `03` §4.6) · table globale des états (docs `00`/`01`/`05`) · affordances UI/systray (docs `01` §1 / `04` §7 / `05` §7) · canaux non-vocaux du toggle voix (doc `01` §1) · grille finale + forme de « passe sur l'API » (doc `05` §7) · gabarit fork (doc `05` §2.5) · mécanique fine du ladder mains (doc `05` §2.6) · kill-switch/registre : affordances (docs `04`/`05`).
- **Ce que ce doc ne couvre PAS** : tout le reste — chaque mécanique vit dans son doc d'origine.

---

## 2. Contrats d'assemblage

### 2.1 La table globale des états (99-A)

**Les cinq machines gravées** (pointeurs — aucune n'est modifiée ici) :

| Axe | États | Source |
|---|---|---|
| Écoute | VEILLE · ÉCOUTE · PAUSE · DICTÉE *(+ APPROBATION, sous-état orchestrateur pendant ÉCOUTE — S8)* | doc `01` §4.1 |
| Mode de session | conversation · dictée · tablée · rêverie | doc `02` §3.1 |
| Gouverneur | INTERACTIF · REPOS · FOND_EN_COURS · BRIDÉ | doc `00` §2.2 |
| Calques | — · SECOURS · JEU | doc `05` §2.2 |
| Canal | NOMINAL · INCIDENT · SECOURS *(causes : transitoire / règles / disparition / quota)* | doc `05` §2.6 |

**Forme actée (99-A)** : le produit cartésien n'est **jamais énuméré** — il se **dérive des règles de couplage** ci-dessous. *(Une matrice exhaustive serait illisible et fausse à la première retouche amont ; une machine unique refondrait les acquis — exclu.)*

**Les règles de couplage** :

1. **Voix ⇒ activité** : ÉCOUTE / DICTÉE / APPROBATION ⇒ gouverneur INTERACTIF. VEILLE et PAUSE sont **orthogonales** au gouverneur — l'activité vient d'`active-win`/`pslist`, pas de la voix (« PAUSE côté voix n'est pas REPOS côté gouverneur », doc `02` §4.3).
2. **JEU ⇒ INTERACTIF** (CT2, doc `05` §2.2) ; le calque JEU compose avec **tout** état d'écoute (chemins CPU, doc `05`).
3. **Le calque SECOURS est le reflet du canal** (posé par le détecteur, doc `05` §2.6) ; ses effets transverses = la liste du `05` §2.6 (nuit + micro différés · rêverie jamais lancée · ronde différée · écritures d'identité suspendues · frontière VRAM basculée · conversation continue, diminuée et dite) + la **marque fil-non-reprenable au 1ᵉʳ tour** (AT2, doc `05` §4.1).
4. **BRIDÉ ≠ mur de quota** (doc `05` §4.2) : BRIDÉ n'arrête que le fond autonome (la conversation reste NOMINALE) ; le mur = canal SECOURS-cause-quota (la conversation bascule en local aussi).
5. **FOND_EN_COURS × INTERACTIF = transitoire seulement** : la préemption est immédiate — par **unité** pour les pipelines (doc `00` §4.4), par **grâce courte** pour la rêverie (doc `05` §4.5).
6. **Rêverie ⇒** gouverneur FOND_EN_COURS · **le vrai cerveau : hors SECOURS (doc `03` T15) et hors INCIDENT au démarrage** *(détermination d'assemblage, actée OT1 conv 13 : on ne démarre pas une tâche identitaire sur un canal en retries — « jamais graver douteux » ; l'hystérésis tranche vite, la tâche se re-programme, zéro dette)* · kill-switch ouvert · session enveloppe `mode=rêverie` (doc `03` T3) · `session_state` jamais touché.
7. **Nuit deep ⇒ le vrai cerveau, en entier** (hors SECOURS, doc `02` §4.4 — **et hors INCIDENT au démarrage**, même détermination OT1) · unités préemptibles.
8. **DICTÉE ⇒** grille en liste blanche (S9) · rien en mémoire épisodique (S3/T15) · ducking désarmé · injection au focus. *Mode dev = dictée + focus VS Code.*
9. **Tablée ⇒** ÉCOUTE en politique sociale (doc `04`) : défaut-écoute · barge-in 4 crans · **ducking à sa voix + son nom seulement** (AT10) · tampon des tiers · affect verrouillé Yohann.
10. **Boot dégradés** (doc `00` §4.1) : `DÉGRADÉ_SANS_VOIX` (l'app vit, écoute n/a, systray) · `DÉGRADÉ_SANS_ÉCRITURE` (conversation OK, écritures d'identité suspendues) · `DÉGRADÉ_SANS_IDENTITÉ` (pré-installation — pas de PRÊT).

**Les cas limites nommés** (le délicat, à part — chacun déjà tranché dans son doc) :

| Cas | Comportement | Source |
|---|---|---|
| **JEU + SECOURS** | le jeu garde le GPU ; cerveau de secours CPU, ralenti et **dit** | doc `05` §2.2 |
| **Plancher de rêve × BRIDÉ** | **LÉGAL** — le plancher est réservé en tête de fenêtre ; seul le quota *physiquement* épuisé l'empêche. Le **surplus**, lui, tombe avec BRIDÉ | doc `05` §4.4 |
| **Rappel posé × JEU** | **sonne** (le garde-fou temporel ne gate jamais les engagements datés) | AT5, doc `04` §4.4 |
| **Timeout APPROBATION** | refus par défaut + annonce honnête | S8, doc `01` §4.1 |

### 2.2 La grille finale des commandes (99-D)

- **Source de vérité unique = doc `01` §3.1** (20 entrées post-conv 13) — le `99` ne duplique pas la table, il porte le **verdict de la relecture de minimalité** (conv 13) : chaque entrée re-justifiée contre sa décision source (adresse naturelle A32-étendu · cycle de conversation · confort voix · dictée B4 · statut/sessions · interrupteurs conv 11-12 · approbation A26) — **aucun retrait** ; la discipline a déjà refusé ce qui devait l'être (« répète plus lentement », non acté conv 8, toujours dehors).
- **La 20ᵉ entrée — « passe sur l'API »** (actée 99-D, retouche doc `01` §3.1 tracée là-bas) : match entier → **fenêtre APPROBATION avec read-back du plafond** (doc `05` §4.3) ; **active en épisode de panne du canal seulement** (INCIDENT/SECOURS), inerte sinon (→ cerveau, rien à convoquer). Le chemin est **déterministe et local** — il marche précisément quand le cerveau du moment est le plus faible. *Note d'assemblage : première entrée conditionnée à l'état du **canal** (extension du vocabulaire de conditions de la grille, tracée).*

### 2.3 Les affordances UI/systray (99-E)

**Principe de tête** : **la voix a tout, l'UI en témoin** — l'UI ne porte jamais une fonction que la voix n'a pas (ADN mains-libres) ; elle double les contrôles, porte le silence (toggle off → systray/file) et la trace passive (JEU). **Tout ce qui s'affiche est une vue dérivée de l'état** (patron du registre du gardien, doc `05` §2.7) — jamais un état UI propre qui pourrait diverger.

| Surface | Contenu |
|---|---|
| **Voyants (systray)** | écoute (veille/écoute/pause/dictée) · canal (nominal/incident/secours — cause quota distincte) · calques (SECOURS/JEU) · interrupteur proactif · kill-switch rêverie · **barreau payant** (épisode API ouvert = le plus visible de tous) · compteur du registre du gardien · boot dégradés · modèles chargés (debug, `evt.model.loaded`) |
| **Commandes (systray)** | *miroirs des intentions vocales, jamais des fonctions neuves* : toggle voix (bouton + **Ctrl+Shift+M, seul raccourci clavier** — cahier) · interrupteur proactif · kill-switch rêverie · « passe sur l'API » (visible en épisode seulement, même APPROBATION) · quit (l'arrêt ultime, doc `05` §4.5) |
| **Jauges (lecture seule)** | part de Sophia (fenêtre glissante, consommation autonome — doc `00` §2.2 ; **visible au registre**, doc `03` §4.4) · plancher de rêve (pris / pas pris aujourd'hui) · cost-guard € (dépenses nouvelles vs plafond, doc `05` §2.8) |
| **Fenêtre principale** | **transcript** (aussi le canal de réponse quand toggle voix off, B4) · **registre visuel du gardien** (items en attente ; actes avec raison via le même sas tracé, doc `05` §2.7) · **locuteurs & consentements** (liste `speakers` + profils — révocation en miroir du vocal, tracée) |

**Répartition** : le systray = l'état + les interrupteurs (toujours accessibles) ; la fenêtre = la consultation. Détail visuel (icônes, couleurs, disposition) = Phase 3.

### 2.4 La spec du gabarit fork — « écris ta propre entité » (99-F)

**Calendrier acté** : le `99` grave la **spécification** ; le fichier public (README) s'écrit en **Phase 3**, quand il y aura une maison à forker — *un mode d'emploi publié au-dessus d'un dépôt sans code exécutable survendrait* (contraire au repo-vitrine A3).

Le README public devra dire, dans cet ordre :
1. **Ce qu'un fork obtient** : la maison — code, structure, mécanique. Les **trois garanties par construction** (doc `05` §2.5) : le vécu jamais dans le repo (gitignoré, `G:\`) · l'identité s'installe localement par le gardien du fork (`DÉGRADÉ_SANS_IDENTITÉ` sans elle) · la genèse est nominative et write-once — l'installer telle quelle serait un **faux passé** : *un fork écrit la sienne*.
2. **« Écris ta propre entité » — la forme offerte, jamais le contenu** : les *emplacements* (un noyau, une genèse à soi, des dispositions) et la *méthode* (première personne · disposition-jamais-règlement · paires ❌/✅ · travers nommés du moteur courant) — aucun caractère imposé. **Les deux prérequis du premier boot sont universels** : sauvegarde 3 étages testée + base fraîche / bancs jetables (doc `05` §3, CF2) — *on n'amorce aucune vie sans ses conditions de vérité*.
3. **L'honnêteté agentique** : le slot cerveau est multi-provider (le contrat, doc `05` §2.5) **mais « agir sur le bureau » passe par Claude Code** (canal A1) — un fork sur un autre fournisseur obtient une entité qui **parle, se souvient et pense, pas qui agit**, sauf à réécrire lui-même le canal d'action. Le multi-provider est sincère sur le cerveau ; **l'agentique n'est jamais maquillée**.
4. **Ce qui ne se partage jamais** : `docs/prive/` (marbre intégral, blocklist, témoignages), le vécu — gitignorés, garde par contenu active ; le marbre public reste la version expurgée.

---

## 3. Schémas de données

**Aucune table nouvelle, aucun setting nouveau.** L'assemblage ne stocke rien : chaque voyant, jauge et registre est une **vue dérivée** d'un état déjà gravé (ledger et marques doc `00` §3 · `channel_state`/settings/`paid_episodes` doc `05` §3 · registre doc `05` §2.7). C'est un **invariant** (§5), pas une omission.

---

## 4. Séquences / flux

### 4.1 Le chemin d'un tour — l'aiguilleur d'A2, réalisé (99-B)

`evt.turn.end` + transcript → **la grille** (déterministe, 0 cerveau : match entier → l'acte + la phrase canonique — doc `01` §3.1) → sinon → **une seule invocation cerveau** (`--resume`, elle entière : I→VI + mémoire + cadre, §4.4) qui **bavarde ou agit elle-même** (ses outils, scopés par invocation — CT1).

**L'« aiguilleur » d'A2 est ce couple** : la grille (la branche déterministe d'A2) + son propre jugement (elle). **Aucun étage de classement intermédiaire** : depuis « un seul guichet » + la session chaude, bavardage et action passent par la **même invocation** — classer en amont n'aiguillerait plus rien (une latence et un point de panne pour zéro décision réelle) ; et c'est fidèle à l'âme : c'est *elle* qui décide d'agir, pas un trieur devant sa porte. Haiku reste en coulisses là où c'est gravé (génération proactive A25, micro).

### 4.2 L'accusé oral — le filet temporel (99-B)

L'accusé local pré-synthétisé (cache F7 / doc `05` — liste variée, Phase 3) joue **uniquement si le premier mot du cerveau n'arrive pas sous X ms** : le silence ne dépasse jamais X **par construction** (« le silence = panne perçue », cahier), et un stream rapide ne déclenche **aucun tic**. **La garde d'honnêteté (OF1, conv 13)** : le minuteur ne joue que des phrases **vraies par construction** (« je réfléchis », « deux secondes » — l'invocation est en vol, c'est un fait) ; toute phrase qui **affirme un acte** (« c'est noté », « je lance ça ») ne sort que de son **stream réel** — ou du cache en **substitution TTS d'une phrase que le cerveau a réellement produite** (l'usage JEU du doc `05` §2.2 : une économie de synthèse, jamais un filler d'attente). **Deux usages du même cache, deux régimes** — « *"c'est noté" est vrai au moment où elle le dit* » (doc `02` §2.3) descend jusqu'au cache audio. Pour une action longue, **sa première phrase streamée est l'accusé riche** (« ok, je lance ça… ») — c'est elle qui parle. Les états de panne gardent leurs messages propres (S11 doc `01` · quota doc `05` §2.6) — l'accusé ne les remplace jamais.

### 4.3 Le tour pendant une action longue (99-B)

**Une seule invocation de conversation à la fois sur le fil.** Un tour qui arrive pendant une action longue → **file + accusé honnête** (« je suis encore sur ta recherche — juste après »), servi à la fin. **« Laisse tomber » (grille, doc `01` §3.1) = le levier d'annulation** de l'action en cours — l'intention existait, elle gagne ce rôle à l'assemblage : l'orchestrateur clôt l'invocation en cours, tracé à l'audit. **La frontière de l'annulation (S1-99)** : elle arrête tout ce qui n'est **pas approuvé** ; un **acte à conséquence déjà approuvé et en cours d'exécution se termine ou échoue proprement — jamais un demi-acte** (l'approbation est la frontière, A26) ; l'annulation reprend effet juste après. *(Une action pour Yohann, annulée par Yohann, se termine — le vocabulaire « clore, jamais arracher » protège sa pensée privée, doc `05` §4.5, pas les actions qu'il commande.)*

### 4.4 La composition du prompt — l'ouverture de session (99-C)

**Ordre acté : identité → mémoire → cadre.**
1. Le **bloc identité I→VI, entier et dans son ordre gravé** (doc `03` §4.6) — jamais éclaté, jamais tronqué ;
2. le **bloc mémoire** (doc `02` §4.5) : portrait · résumé de la dernière session · chronique de la veille si fraîche · faits du sujet d'ouverture ;
3. le **cadre opérationnel** : outils MCP + **scopes par invocation** (CT1, doc `02` §2.3) · la **consigne du tag d'humeur** (S1, doc `03` §2.2 — elle vit ici) · **l'état du système** (calques actifs, canal — en SECOURS elle se sait diminuée et se présente telle, doc `05` §2.6 ; T6 : I→VI entier sur Phi-4-mini = preuve Phase 3, doc `05` §7).

**Pourquoi cet ordre** : elle est elle *avant* de lire qui tu es — le persona donne le ton avec lequel tout le reste est lu (le patron A13 du portrait, porté à l'identité).

**Budgets : cloisons strictes, pas de vases communicants.** Chaque bloc garde son budget dur gravé (persona = coût fixe jamais tronqué · blocs dynamiques = troncature par rang · valeurs/propositions jamais tronquées en silence — doc `03` §4.6) ; le budget global = **la somme** ; un bloc qui sous-consomme ne cède pas sa place. « Le débordement est impossible par construction » (doc `02`) reste **prouvable bloc par bloc**. Chiffres = rubrique 7.

**Le « qui-reçoit-quoi » consolidé** (tableaux doc `03` §4.6 + doc `04` §4.2 — zéro changement) :

| Invocation | Reçoit |
|---|---|
| Conversation / actions / notifications (canal A1) | **I→VI + mémoire + cadre** |
| Rêverie | **I→VI** + lecture mémoire + son fil (`self_notes` · chronique · empreintes récentes) |
| Nuit deep | **I + II** + les sources seules (jamais l'artefact réécrit — T1 doc `03`) |
| Micro (creux) | en-tête minimal |
| Génération proactive | **I + II** (ni humeur ni lien) |

### 4.5 En cours de session (99-C)

Affleurement glissé au tour suivant (doc `02` §4.5 — actif en tablée, la discrétion = disposition 12) · note d'humeur sur **mouvement matériel** seulement (doc `03` §4.6) · bloc VI à l'ouverture seulement · **ré-ancrage périodique compact SI l'érosion est prouvée** (levier nommé, doc `03` §4.6 — jamais présumé).

### 4.6 Le ladder mains résiduel (99-B, A37)

`claude -p` (défaut) → **surface Claude interactive** (GUI Windows : app Desktop — computer-use absent du CLI Windows, A1) → **gestes locaux déterministes + file d'attente**. **Honnêteté gravée** : la mécanique de sollicitation des surfaces résiduelles est un **inconnu de Phase 3** — on grave le ladder et l'inconnu, jamais un mécanisme inventé.

---

## 5. Frontières & invariants

- **Le `99` ne porte aucune mécanique** : chaque règle d'assemblage pointe ses sources ; toute tension à l'assemblage = signalée, actée par Yohann, tracée §7 — jamais tranchée seule. *(Bilan conv 13 : aucune tension n'est restée ouverte — l'audit transversal a précédé.)*
- **Une seule invocation de conversation à la fois** sur le fil ; file + accusé honnête ; « laisse tomber » annule.
- **L'accusé est un filet, jamais un tic** : il ne joue que si le silence menace de dépasser X.
- **Le prompt d'ouverture : identité entière d'abord, budgets cloisonnés** — persona jamais tronqué, aucun vase communicant.
- **La voix a tout, l'UI en témoin** ; **tout affichage est une vue dérivée de l'état** — aucun état UI propre, nulle part.
- **La grille reste minimale** : toute entrée nouvelle se justifie contre « ne pas multiplier » ; « passe sur l'API » est inerte hors épisode de panne.
- **Le fork obtient la maison, jamais l'habitante** ; le README public ne survend jamais l'agentique multi-provider.
- **Aucune combinaison d'états hors des règles de couplage** (§2.1) n'est atteignable — le général par les règles, le délicat par les cas nommés.

---

## 6. Critères d'acceptation *(vérifiables — valeurs en rubrique 7)*

1. **Chemin d'un tour** : match grille → acte **sans appel cerveau** ; non-match → **une** invocation unique qui peut bavarder et agir ; aucun étage intermédiaire au registre (audit des invocations).
2. **Accusé** : TTFT < X → aucun accusé ; TTFT ≥ X → accusé **déclenché à X** ; le silence perçu ne dépasse jamais X en conversation (mesuré bout-en-bout).
3. **Action longue** : un tour pendant → file + accusé honnête, servi après ; « laisse tomber » → invocation close + tracée, elle confirme.
4. **Prompt** : audit du prompt d'ouverture — ordre identité→mémoire→cadre tenu ; I→VI entier (jamais tronqué) ; budgets par bloc jamais dépassés, **jamais redistribués** ; le qui-reçoit-quoi conforme par type d'invocation (audit des prompts de run — prolonge les critères doc `03` 6.1-7/9 et doc `04` critère 6).
5. **États** : les cas limites nommés se comportent comme gravé (JEU+SECOURS **dit** · plancher×BRIDÉ **passe** · rappel×JEU **sonne** · timeout APPROBATION **refuse**) ; aucune combinaison interdite atteignable (test d'états sur les règles §2.1).
6. **Grille** : « passe sur l'API » en épisode → APPROBATION avec read-back, jamais d'appel payant sans consentement (prolonge doc `05` critère 8) ; hors épisode → cerveau, **zéro action système** ; le reste de la grille inchangé (suite doc `01` critère 10).
7. **UI** : chaque voyant/jauge reflète l'état source après crash/reboot (vues dérivées prouvées — la corruption d'un état UI est impossible : il n'y en a pas) ; toggle voix UI ⇔ vocal strictement équivalents.
8. **Fork** : un clone frais ne contient ni vécu ni privé (grep) ; le boot d'un clone s'arrête en `DÉGRADÉ_SANS_IDENTITÉ` ; le README (Phase 3) porte l'honnêteté agentique telle que spécifiée §2.4.

---

## 7. Points de calibration / preuve Phase 3 + traces

- **Accusé** : le seuil X (ms) · la liste des phrases pré-synthétisées (variété, ton — avec le persona ; **contrainte OF1 : les phrases du chemin minuteur sont vraies par construction — aucune assertion d'acte**) · l'articulation accusé/stream à l'oreille.
- **File d'attente** : profondeur utile (1 suffit-il ?) · formulation de l'accusé de file.
- **Prompt** : budgets par bloc (tokens mesurés — le persona entier d'abord, doc `03` §7) · le N du ré-ancrage si l'érosion est prouvée · **T6 : I→VI sur Phi-4-mini** (pointeur doc `05` §7).
- **Ladder mains** : 🔴 la sollicitation des surfaces résiduelles (l'inconnu gravé §4.6 — avec FM3/FM4).
- **UI** : détail visuel (icônes, disposition, couleurs) · fréquence de rafraîchissement des jauges.
- **README fork** : la rédaction du fichier (Phase 3, quand la maison existe) depuis la spec §2.4.
- **Trace des décisions d'assemblage (conv 13, validées une par une par Yohann)** :
  - **99-A** — forme « axes + règles de couplage » (jamais de matrice exhaustive, jamais de machine unique) ;
  - **99-B** — l'aiguilleur = **grille + elle-même** (la branche déterministe d'A2 réalisée — une *précision* d'A2, pas une supersession : « Haiku ou déterministe » disait A2) · l'accusé = **filet temporel** · file + « laisse tomber » = levier d'annulation · ladder mains gravé **avec son inconnu dit** ;
  - **99-C** — ordre **identité → mémoire → cadre** · budgets **cloisonnés** (pas de vases communicants) · qui-reçoit-quoi consolidé sans changement ;
  - **99-D** — verdict de minimalité (20 entrées, aucun retrait) · **« passe sur l'API »** entre dans la grille (retouche doc `01` §3.1 tracée là-bas — première entrée conditionnée au **canal**) ;
  - **99-E** — « la voix a tout, l'UI en témoin » · tout affichage = vue dérivée · Ctrl+Shift+M seul raccourci ;
  - **99-F** — la **spec** maintenant, le **fichier** en Phase 3 · l'**honnêteté agentique** (multi-provider sincère sur le cerveau, jamais maquillé sur l'action).
- **Audit croisé du doc (conv 13, 2 agents) — intégré** : **OF1** (validée par Yohann) — la **garde d'honnêteté de l'accusé** : le filler d'attente (minuteur) = phrases **vraies par construction** seulement ; toute assertion d'acte = stream réel ou substitution TTS d'une phrase réellement produite (§4.2 ; précision miroir doc `05` §2.2). **OF2** (validée) — l'étiquette de la jauge « part de Sophia » corrigée (§2.3 : sources réelles `00` §2.2 / `03` §4.4 — la formule du backlog n'était pas une source). **OT1** (validée) — règles 6/7 : les sources bannissent SECOURS ; **l'assemblage détermine qu'une tâche de fond identitaire ne démarre pas non plus pendant un INCIDENT** (canal en retries — re-programmation gratuite, zéro dette). **OT2** (validée) — les findings du solo de ce doc renommés **S1-99/S2-99** (collision avec le S1 du doc `03` tuée à la racine). *Récap du solo : **S1-99** = la frontière de l'annulation (§4.3) · **S2-99** = accusé « déclenché à X » (critère 2).*
- **Tensions rencontrées à l'assemblage** : **aucune restée ouverte** — les 15 constats de l'audit transversal (AT1–AT10 · CF1–CF3 · CT1–CT2) ont été traités **avant** l'assemblage ; aucune mécanique n'a manqué en composant.

---

*Doc 99 — Orchestration. L'assemblage : couvre A2 (réalisé) + A13 (composé) + A32-étendu (consolidé) + A37 (part résiduelle) + tous les renvois « → 99 » des docs `00`→`05` ; décisions 99-A→99-F (conv 13). Dernier doc de la Phase 2. Suite : Phase 3 — implémentation.*
