# 01 — Pipeline vocal · Plan d'implémentation · YdvVoice (Sophia)

> **Rôle** : le plan d'exécution des **oreilles et de la bouche** de Sophia — du micro toujours ouvert jusqu'à la voix qui sort. Deuxième plan de la Phase 3, **il s'écrit sur le socle** (`docs/plan/00-socle.md`) : canal WS `cmd.*`/`evt.*`, supervision/respawn, écrivain unique, `cmd.model.policy`.
>
> **Source de vérité** : `docs/technique/01-pipeline-vocal.md` (acquis — audit F1–F7 + croisé B1–B4/S1–S12/M1–M7 déjà intégré en Phase 2). Ce plan **ne rouvre rien** — il traduit. Tout écart au contact du code → **rubrique 7** + renvoi `01` §7.
>
> **Statut** : rédigé + **solo de fidélité renforcé (conv 14)** avant le croisé — couture injectable `evt.speaker`, alternatives de prises rétablies, invariants `01` §5 ancrés. **Audit croisé 2 agents FAIT (conv 14 — 14 findings, zéro faux positif, tous intégrés ; §7).** **Valeurs chiffrées différées** à la calibration Phase 3 (rubrique 6) — la couche audio en concentre les plus lourdes (les **deux 🔴** du projet vivent ici).
>
> **Discipline Phase 3** : tests avant commit ; base et bancs **jetables** (CF2), au **casque** (valide la *logique* ; le rig far-field validera l'*acoustique*, ère matérielle distincte). C'est ici que se joue **l'essai à blanc priorité n°1** (passe de réalité #2).

---

## 1. Objectif & ce que la couche prouve

Un **chemin audio unique** dans le sidecar (micro → AEC → 16 kHz mono → ring buffer → consommateurs), une **bouche streamée** (Sophia parle avant la fin de génération), une **grille d'intentions** déterministe côté orchestrateur, et **jamais de silence**.

**Ce qu'elle doit prouver** (les preuves les plus risquées du projet) :
- **🔴 Le réveil au nom en français** (« Sophia » porté par une phrase) est fiable, faux réveils bas — ou le repli nommé s'active (F6).
- **🔴 L'AEC** annule ce que le PC joue (loopback système entier) → elle ne se coupe jamais elle-même, le barge-in et le réveil tiennent même avec des médias (M1).
- **La vivacité** : premier mot audible peu après la fin du tour, la 1re phrase joue **avant** la fin de génération du cerveau.
- **La fin de tour acoustique** : vive quand c'est fini, jamais coupée sur une hésitation, robuste même si Smart Turn crashe.
- **Le barge-in modulé par le locuteur** ; **la grille** n'agit jamais sur un doute.

**Ce que ce plan ne couvre PAS** : le cerveau/la session chaude (socle + `05`) · la mémoire (`02`) · le persona et la convention « Yohann » (`03`) · le mode tablée + le détail de l'échelle A29 et le cran de barge-in « proche consenti » (`04`) · l'**usage** de l'affect (colorer humeur/lien → `03`) · le rig far-field (ère matérielle) · les canaux non-vocaux du toggle voix (Ctrl+Shift+M, bouton UI → `99`).

---

## 2. Prérequis

- **Le socle bâti** (`docs/plan/00-socle.md`, T0→T8) : canal WS opérationnel, supervision/respawn, `cmd.model.policy` **émis par l'orchestrateur** (résidence voix V11, intégrant les calques du gouverneur socle T7), boot phase 5 qui spawn le sidecar. La couche audio **réalise** les hooks que le socle invoque (`01`/`05`).
- **Casque / micro proche** (le banc valide la logique ; le far-field viendra avec le rig).
- **Moteurs installés dans le sidecar** : Silero (VAD), faster-whisper (STT, CUDA), Smart Turn v3, Kokoro (TTS), LiveKit wakeword **et** openWakeWord (à départager), emotion2vec (affect, OFF). Toolchain audio Python (capture bas-niveau WASAPI/loopback).
- **Aucune clé requise pour démarrer** : les providers cloud (Deepgram, ElevenLabs) sont OFF par défaut.

---

## 3. Tâches séquentielles

> Ordre = dépendances internes. Chaque tâche : **But · Contenu · Fichiers (indicatifs) · Dépend de · Fait quand**. Valeurs (X, seuils) **ouvertes** (rubrique 6). Fichiers indicatifs : `sidecar/audio/`, `sidecar/consumers/`, `sidecar/tts/`, `sidecar/plugs/` ; côté orchestrateur `src/orchestrator/voice/`.

### V0 — Chemin audio, ring buffer & patron de prise
- **But** : un seul flux audio, rembobinable, derrière des rôles interchangeables.
- **Contenu** : **capture unique** du micro (le sidecar ouvre le micro **une fois**) · **conversion unique** 16 kHz mono en entrée · **ring buffer central** (RAM sidecar) donnant le **rembobinage** (fenêtre pré-wake) · **patron de prise** (01-F) : chaque rôle = un **contrat** (opérations + événements normalisés), le moteur ne fuit **jamais** dans le protocole ; sélection **par config au spawn** · **horodatages (M2)** : `ts` d'enveloppe = **émission** monotone ; les horodatages de **capture** en payload (`captured_at`). **Le ring buffer et les caches restent RAM sidecar — jamais le WAL, jamais l'IPC** (invariant socle) ; **le sidecar est sans état durable** (tout se reconstruit au respawn, V15).
- **Prises & alternatives (01-F — à départager en calibration §6)** : `wake` LiveKit ⇄ openWakeWord *(repli théorique payant : Porcupine)* · `vad` Silero · `stt` faster-whisper ⇄ Deepgram *(cloud, OFF)* · `turn` Smart Turn v3 ⇄ LiveKit turn-detector · `tts` Kokoro ⇄ Chatterbox ⇄ ElevenLabs *(premium, OFF, cost-guard)* · `speaker` modèle Phase 3 · `affect` emotion2vec ⇄ wav2vec2 *(OFF)*. **Le moteur reste derrière son contrat** : le changer = config + respawn, mêmes événements (V15).
- **Fichiers** : `sidecar/audio/`, `sidecar/plugs/`.
- **Dépend de** : socle T2 (canal), T3 (supervision).
- **Fait quand** : le micro est ouvert une fois ; plusieurs consommateurs lisent le tampon avec leur propre curseur, un consommateur lent/mort n'en bloque aucun autre ; le rembobinage rend une phrase déjà passée. *(U-V0.)*

### V1 — AEC en tête de chaîne (🔴 M1)
- **But** : n'entendre que les voix de la pièce, pas ce que le PC joue.
- **Contenu** : **AEC en tête** de la chaîne, **référence = loopback de la sortie système ENTIÈRE** (pas seulement la voix de Sophia) → après AEC, VAD/wake/STT ne voient que les voix réelles. Traiter : **alignement d'horloges** micro/rendu (le loopback WASAPI vit sur l'horloge du périphérique de rendu — dérive, resampling adaptatif) · **changement du périphérique de sortie par défaut** (casque branché → la référence change) · **flux WASAPI exclusifs** qui échappent au loopback.
- **Fichiers** : `sidecar/audio/`.
- **Dépend de** : V0.
- **Fait quand** : une musique/vidéo qui joue **ne déclenche pas** VAD/barge-in fantôme ; **Sophia ne se coupe jamais elle-même** quand elle parle (sa propre voix annulée) ; un changement de périphérique de sortie est encaissé sans casser la référence ; **un flux WASAPI exclusif qui échappe au loopback est détecté et signalé** (dégradation caractérisée, résidu assumé → §6). *(Preuve M1 — U-V1, I-1 ; seuils/résidu → §6.)*

### V2 — VAD (Silero, CPU, always-on)
- **But** : distinguer voix / silence, marquer le tampon.
- **Contenu** : Silero VAD, **CPU, always-on**, post-AEC · émet `evt.vad.start` / `evt.vad.stop` · **marque le tampon même en veille** (débuts/fins de parole — CPU négligeable), socle du rembobinage (V3) et de la fin de tour (V5). Seuil configurable.
- **Fichiers** : `sidecar/consumers/vad`.
- **Dépend de** : V0, V1.
- **Fait quand** : parole détectée post-AEC → `evt.vad.start`/`stop` ; les marques VAD sont posées en continu (y compris en veille). *(U-V2.)*

### V3 — Wake word + réveil rétroactif (🔴 F6)
- **But** : « Sophia » réveille, même dit en fin de phrase, sans amputer le premier mot.
- **Contenu** : moteur **tranché à l'essai** (LiveKit wakeword d'abord ⇄ openWakeWord ; repli nommé si la preuve FR échoue — §6) · **always-on, CPU** · émet `evt.wake` (confiance) · **réveil rétroactif** (F1) : au wake, **rembobiner** au début du tour (marque VAD précédente) → la phrase entière est dans le tampon, **premier mot jamais amputé** · **écoute transitoire** après le tour de réveil (STT armé, délai de garde) jusqu'à `cmd.listen.start`/`stop` · **sémantique hors cas nominal (S12)** : wake pendant un tour ouvert = no-op ; wake en ÉCOUTE = ignoré (journalisé) ; wake pendant la TTS = barge-in (V8) · détection douteuse en veille → **demander brièvement plutôt qu'agir** (A19).
- **Fichiers** : `sidecar/consumers/wake`.
- **Dépend de** : V0, V2.
- **Fait quand** : « bonne nuit Sophia » **à froid** → réveil, premier mot intact (rembobinage prouvé), rien de perdu entre le tour de réveil et `cmd.listen.start` (écoute transitoire rétroactive, B1). *(Preuve FR — U-V3, I-2 ; taux de faux réveils → §6.)*

### V4 — STT streaming (faster-whisper GPU)
- **But** : transcrire en flux, en français.
- **Contenu** : faster-whisper (CTranslate2/CUDA) *(repli Deepgram cloud, OFF — V15)* · émet `evt.stt.partial` (au fil) / `evt.stt.final` (du tour) · **français forcé** (langue verrouillée — pas d'auto-détection qui basculerait en anglais) · modèle à calibrer (`medium` ⇄ `large-v3` int8) · prewarm au wake (réflexe, V11).
- **Fichiers** : `sidecar/consumers/stt`.
- **Dépend de** : V0.
- **Fait quand** : parole → `evt.stt.partial` au fil puis `evt.stt.final` ; transcription française sans bascule de langue. *(U-V4 ; modèle/latence/précision FR → §6.)*

### V5 — Fin de tour (Smart Turn v3 + Silero fallback)
- **But** : décider *quand* Yohann a fini de parler — vif, jamais au milieu d'une hésitation.
- **Contenu** : **machine à états unique dans le sidecar**, **émetteur unique de `evt.turn.end`** (reason `smart-turn`|`fallback`) · `evt.vad.start` ouvre le tour · chaque silence = candidat → Smart Turn évalue l'audio : **confiant + court silence → `turn.end` immédiat** ; **pas confiant → attend**, reprise de parole → candidat annulé, **même tour continue** (l'« euh… » ne coupe jamais) ; **plafond de silence → `turn.end` (fallback)** · `evt.stt.final` précède `turn.end`, qui le référence + porte les horodatages du tour (payload, M2) · **le plafond tient même si Smart Turn crashe** (dégradation douce) · **alternative de prise : LiveKit turn-detector** (texte — la prise ne présume pas de la nature du moteur). **Frontière gravée** : fin de tour **acoustique, jamais sémantique** (« attends », « merci Sophia » = grille V10, pas ici).
- **Fichiers** : `sidecar/consumers/turn`.
- **Dépend de** : V2, V4.
- **Fait quand** : Smart Turn confiant → réponse enclenchée peu après la fin réelle ; une hésitation ne coupe jamais la phrase ; **Smart Turn tué → le tour finit quand même au plafond**. *(U-V5 ; seuils + ratio fallback/smart-turn → §6.)*

### V6 — Speaker-ID (prise ; modèle Phase 3)
- **But** : savoir si c'est Yohann qui parle (sert le barge-in et le verrou de l'affect).
- **Contenu** : consommateur du ring buffer, **local, léger** · émet `evt.speaker` (locuteur, confiance) · **ancre = la voix de Yohann** : l'empreinte est **créée par l'enrôlement (doc `04` / premier boot)**, poussée au boot via `cmd.enroll.push` (socle) — **ici, on la consomme** · **`evt.speaker` = couture injectable** (pour tester le barge-in modulé V8 et le verrou d'affect V14 de façon **déterministe**, indépendamment du modèle réel) · **probabiliste** → le doute est géré en aval (honnêteté sociale, barge-in prudent). **L'échelle de confiance complète, l'enrôlement des proches et la vie sociale = doc `04`** ; ici, seulement le consommateur + son événement.
- **Fichiers** : `sidecar/consumers/speaker`.
- **Dépend de** : V0 ; empreinte via socle (`cmd.enroll.push`).
- **Fait quand** : la voix de Yohann est reconnue avec une confiance exploitable par V8/V14 ; un locuteur inconnu est signalé comme tel. *(U-V6 ; modèle + seuil → §6.)*

### V7 — TTS streamé (Kokoro GPU)
- **But** : parler pendant que le cerveau génère encore.
- **Contenu** : `cmd.tts.speak` (id) ouvre · `cmd.tts.push` pousse le texte **au fil du stream du cerveau** · `cmd.tts.end` clôt · le sidecar **découpe en phrases** (prosodie — un TTS nourri en miettes chante faux), synthétise (Kokoro ; *alternatives Chatterbox, ou ElevenLabs premium OFF sous cost-guard*), **joue dès la 1re phrase prête** · **file d'énonciations** (une seule joue) + `cmd.tts.stop` (purge) · cycle `evt.tts.start`/`evt.tts.done`.
- **Fichiers** : `sidecar/tts/`.
- **Dépend de** : V0.
- **Fait quand** : la 1re phrase joue **avant** la fin de génération du cerveau ; la découpe par phrases sonne naturel ; une purge coupe net. *(U-V7, I-3 ; TTS à l'oreille + latence 1re phrase → §6.)*

### V8 — Barge-in modulé + interruption sèche + replay + volume
- **But** : elle s'interrompt quand on lui parle, sans se couper elle-même ni sur un bruit.
- **Contenu** : **barge-in interne au sidecar** (invariant), **modulé par le locuteur** (B3, A29) : le **nom « Sophia »** pendant la TTS (`evt.wake`) → **coupure immédiate** (pas de condition de durée) ; **voix reconnue de Yohann** → coupe **vite** (seuil bas) ; **voix inconnue** → **durée minimale** (anti-faux-barge-in) ; *(cran « proche consenti » en tablée → `04`)* · sur coupure : le sidecar **purge lui-même**, émet `evt.bargein` (id, position, déclencheur) · **interruption sèche (S2)** : après barge-in, transcript « stop »/« chut » → **purge confirmée, zéro appel cerveau** · **replay** : « répète » → `cmd.tts.replay` (cache RAM, **zéro resynthèse** ; cache vide → erreur honnête « je n'ai plus l'audio ») · **volume** (S3) : « moins/plus fort » → gain sortie sidecar, **réglage persisté par l'orchestrateur** (écrivain unique).
- **Fichiers** : `sidecar/tts/bargein`, `src/orchestrator/voice/`.
- **Dépend de** : V7, V3, V6.
- **Fait quand** : « Sophia » pendant qu'elle parle → coupure **immédiate** ; voix de Yohann → coupe vite ; **un bruit bref ne la fait pas taire** ; le **mécanisme** de purge/replay/gain est prouvé ici par injection directe (`cmd.tts.stop` / `cmd.tts.replay` / gain), cache vide → dit honnêtement. **La reconnaissance parlée** (« stop », « répète », « moins fort ») est prouvée à **V10** (grille). *(U-V8 — avec `evt.speaker` injecté pour un barge-in modulé déterministe ; I-3 ; seuils par déclencheur → §6.)*

### V9 — États d'écoute
- **But** : qui écoute quoi, décidé par l'orchestrateur.
- **Contenu** : `VEILLE` / `ÉCOUTE ACTIVE` / `PAUSE` / `MODE DICTÉE` / `APPROBATION` (F5) · **propriété orchestrateur (B1)** : transitions par `cmd.listen.start`/`stop` (`start` **rétroactif** depuis la dernière marque VAD) ; **seule auto-transition sidecar = le tour de réveil** (V3) · **PAUSE** garde le fil (session Claude chaude, socle) · **MODE DICTÉE** = injection au curseur de l'app au focus, silencieuse, **grille réduite à une liste blanche** (S9 ; mode dev = dictée + focus VS Code) · **APPROBATION (S8)** = sous-état de l'orchestrateur pendant ÉCOUTE (rien signalé au sidecar) ; non-match → cerveau, fenêtre maintenue ; **timeout → refus par défaut + annonce**.
- **Fichiers** : `src/orchestrator/voice/states`.
- **Dépend de** : V3, V5 (événements) ; socle (session chaude).
- **Fait quand** : les transitions sont décidées par l'orchestrateur ; l'écoute transitoire est rétroactive ; le **mécanisme** d'injection en dictée et le cycle APPROBATION (transitions, timeout → refus) sont prouvés ici. **Le routage parlé** (dictée liste blanche : « merci Sophia » **écrit, pas exécuté**) est prouvé à **V10** (grille). *(U-V9 ; délai de garde + timeout APPROBATION → §6.)*

### V10 — Grille d'intentions (01-G — 20 entrées)
- **But** : reconnaître les intentions *système* sur le transcript final ; tout le reste = conversation → cerveau.
- **Contenu** : **config versionnée de l'orchestrateur** (pas une table SQLite) · **les 20 entrées** (réveil/ouverture · sollicitation · demande directe à froid · interruption sèche · suspension · annulation · pause · clôture · rappel · replay · volume · silencieux/voix · dictée · dev · statut · sessions · interrupteur proactif · kill-switch rêverie · **convocation API** · approbation) · **règles** : **match = énoncé entier normalisé** (S1, normalisation bornée : politesse, mots-outils, ordre) ; **match → l'acte d'un coup** (zéro cerveau) ; **pas de match → cerveau** ; **flou → cerveau, jamais d'action système** ; **« d'un coup » ≠ sans approbation** (S5 : les actes à conséquence gardent la fenêtre APPROBATION) ; transcript vide → **redemande honnête, zéro cerveau** (S4) ; **dictée → liste blanche** (S9) ; intentions contextuelles **inertes hors état** ; **« passe sur l'API » = active en épisode de panne du canal seulement** (99-D) · **convention « Yohann »** (gravée `03`) · supersession cahier B4 (injection = dictée explicite).
- **Fichiers** : `src/orchestrator/voice/grid`.
- **Dépend de** : V4, V9.
- **Fait quand** : les 20 intentions reconnues sur énoncé entier ; **« merci Sophia, c'est parfait, continue » → cerveau** (pas pause) ; « ok/go/fonce » inertes hors APPROBATION ; **« bonsoir » vs « bonne nuit » Sophia distingués** (S6) ; **transcript vide/inintelligible → redemande honnête, zéro cerveau** (S4 — jamais de silence) ; « passe sur l'API » inerte hors épisode de panne. *(U-V10 ; tolérance du mapping + faux matchs → §6.)*

### V11 — Résidence des modèles côté voix (01-E, S7)
- **But** : charger/décharger les modèles selon l'état, sans jamais dépasser la politique.
- **Contenu** : **trois axes, un seul émetteur** : (1) **mode voix** (groupe VEILLE vs CONVERSATION, dérivé des états V9 par l'orchestrateur → `cmd.model.policy` à chaque transition) ; (2) **calques du gouverneur** (SECOURS, JEU — descendus via socle/`05`) ; (3) **autorisations transitoires** (`cmd.tts.cache`, B2) · **réflexes chauds armés par la politique, tirés localement** (wake → prewarm Whisper ; `turn.end` → Kokoro monte ; reprise → Whisper remonte) · **résidence alternée** (écouter/parler jamais simultanés ; l'inactif en cache RAM) · **remontée** `evt.model.loaded/unloaded` (+ VRAM) · **le sidecar ne dépasse jamais la politique** (allocation refusée → dégrade et rapporte, jamais de crash silencieux) · `embed` (couche 2) autorisé dans tous les groupes (CPU, hors frontière VRAM) · **une seule frontière VRAM** arbitrée voix ↔ cerveau-de-secours (socle/`05`) · **priorité interactive absolue (socle) : les réflexes voix servent l'échange en cours, jamais une tâche de fond**.
- **Fichiers** : `src/orchestrator/voice/residence`, `sidecar/audio/models`.
- **Dépend de** : V9 ; socle T7 (gouverneur/calques).
- **Fait quand** : le set résident suit l'état voix ; le prewarm au wake est tiré localement (zéro aller-retour) ; une allocation VRAM refusée est rapportée sans crash. *(U-V11 ; co-résidence Whisper+Kokoro, swap RAM→VRAM, coût prewarm → §6 + doc `05`.)*

### V12 — Ducking (F3 — armé par l'état)
- **But** : baisser les médias quand il faut, jamais en yo-yo.
- **Contenu** : **armé par l'état** — VEILLE : seul `evt.wake` duck ; conversation (ÉCOUTE/APPROBATION) : `evt.vad.start` duck, remonte après ; **TABLÉE : sa voix + son nom seulement** (`evt.tts.start` + `evt.wake`), jamais le VAD ambiant (AT10, politique `04`) ; **DICTÉE : désarmé** (S9) · **systématique et non désactivable dans son périmètre**, **strictement orthogonal au toggle voix** · mécanisme côté **orchestrateur** (mixer Windows). Supersède le « à toute parole » du cahier (M4).
- **Fichiers** : `src/orchestrator/voice/ducking`.
- **Dépend de** : V9 ; le process orchestrateur (socle T0 — le mixer Windows est piloté depuis là ; le contrôle du mixer est bâti ici).
- **Fait quand** : les médias baissent selon l'état (au wake en veille, au VAD en conversation), remontent après ; désarmé en dictée ; indépendant du toggle voix ; **l'armement tablée (sa voix + son nom seuls) est prouvé ici par injection** de `evt.tts.start` + `evt.wake` (le VAD ambiant ne duck pas) — **la politique *quand* activer la tablée reste `04`**. *(U-V12.)*

### V13 — Panne du cerveau : jamais de silence (F7, B2)
- **But** : si le cerveau tombe, la voix le dit — une fois.
- **Contenu** : **pré-synthèse** au boot (**phase 5 du boot socle, après readiness sidecar, avant PRÊT**) et à chaque respawn → `cmd.tts.cache` (**autorisation transitoire** B2 : charge Kokoro → synthétise les phrases de secours → décharge → retour au set résident) · **phrase de secours (S11)** : **déclencheur unique = la fin du tour** (jamais au wake) ; **exempte de barge-in** (courte, prioritaire) ; **une fois par épisode de panne**, puis silence + voyant systray.
- **Fichiers** : `sidecar/tts/fallback`, `src/orchestrator/voice/`.
- **Dépend de** : V7.
- **Fait quand** : orchestrateur mort / WS coupé pendant que Yohann parle → la phrase de secours joue **une fois, en entier**, exempte de barge-in ; ensuite voyant ; **après la pré-synthèse (`cmd.tts.cache`), Kokoro est déchargé et le set résident restauré** — l'autorisation transitoire se referme, VRAM non dépassée (B2). *(U-V13, I-4 ; liste des messages + durée d'épisode → §6.)*

### V14 — Capteur d'affect (01-H — la prise, OFF par défaut)
- **But** : lire l'état affectif de Yohann dans sa voix — signal doux, jamais une étiquette.
- **Contenu** : consommateur du ring buffer, **CPU/intermittent** · **une évaluation par tour** (à `evt.turn.end`), `evt.affect` **attaché au tour** · **signal doux** (valence, énergie, **confiance**) — **jamais d'étiquette catégorielle** · **verrouillé sur l'ancre vocale** (n'évalue que si locuteur = Yohann) · **muet dans le doute** (confiance basse modèle **ou** locuteur → rien) · **OFF par défaut** (emotion2vec — *alternative wav2vec2-emotion* — branché à son essai, calibré sur la ligne de base de Yohann). **L'usage (colorer humeur/lien) = doc `03`.**
- **Fichiers** : `sidecar/consumers/affect`.
- **Dépend de** : V0, V6 (verrou locuteur).
- **Fait quand** : `evt.affect` **muet** si confiance basse ou locuteur ≠ Yohann ; **jamais d'étiquette** nulle part ; l'activation ne change pas le protocole (`evt.*` extensible). *(U-V14 — avec `evt.speaker` injecté pour vérifier le verrou locuteur ; modèle + seuils + coût CPU → §6.)*

### V15 — Respawn resync + suite de conformité des prises (S10, 01-F)
- **But** : après un respawn, tout se reconstruit ; changer de moteur ne change rien en aval.
- **Contenu** : **resync dans l'ordre** (S10) — `cmd.model.policy` (la politique courante) → `cmd.enroll.push` (empreintes) → `cmd.tts.cache` (phrases de secours) · **énonciations en vol au crash = échec terminal** (leurs `evt.tts.done` n'arrivent jamais → l'orchestrateur les clôt, **pas de re-énonciation auto**, notif honnête) · caches RAM repartent vides (replay → erreur normalisée) · **suite de conformité par contrat** : mêmes tests pour toute implémentation d'un rôle ; **cloud (replis)** : clés **par l'environnement au spawn** (jamais sur le WS), **OFF par défaut**, chaque appel payant → événement de coût → **cost-guard orchestrateur** ; **échec provider cloud → retour automatique au local + notification honnête**.
- **Fichiers** : `sidecar/plugs/`, `src/orchestrator/voice/`.
- **Dépend de** : V0–V14 ; socle T3 (respawn).
- **Fait quand** : après kill du sidecar → resync complète (politique, empreintes, secours), wake de retour ; changer de moteur = config + respawn, **mêmes événements en sortie**, suite de conformité passe (**prise `affect` V14 comprise**) ; **un échec de prise cloud (stub) → retour automatique au local + notification honnête** ; aucune clé requise pour démarrer. *(U-V15, I-5.)*

---

## 4. Tests

> Aucune tâche « faite » sans son test vert. Les seuils (< X) sont des **cibles à calibrer** (§6) — le test vérifie d'abord le **comportement**.

**Unitaires (par tâche)** : U-V0 capture unique + ring buffer + rembobinage · U-V1 AEC (pas de barge-in fantôme sur médias · pas d'auto-coupure · changement de périphérique encaissé) · U-V2 marques VAD post-AEC · U-V3 réveil rétroactif (premier mot intact) + sémantique wake hors cas nominal · U-V4 partial/final + français forcé · U-V5 fin de tour (confiant/hésitation/plafond + Smart Turn tué → plafond tient) · U-V6 evt.speaker (Yohann reconnu, inconnu signalé) · U-V7 découpe en phrases + 1re phrase avant fin de génération + purge · U-V8 barge-in par déclencheur *(evt.speaker injecté)* + bruit bref ignoré + stop/chut sans cerveau + replay + cache vide honnête + volume · U-V9 transitions orchestrateur + dictée liste blanche + APPROBATION (non-match → fenêtre maintenue, timeout → refus) · U-V10 les 20 intentions + énoncé entier + « bonsoir/bonne nuit » (S6) + **transcript vide → redemande zéro cerveau (S4)** + « passe sur l'API » conditionnée · U-V11 set résident dérivé de l'état + prewarm local + allocation refusée rapportée · U-V12 ducking armé par l'état + orthogonal au toggle · U-V13 phrase de secours (fin de tour, exempte barge-in, une fois) · U-V14 affect muet dans le doute + jamais d'étiquette *(evt.speaker injecté)* · U-V15 resync ordonnée + moteur interchangeable + **échec de prise cloud (stub) → reprise locale + notif**.

**Intégration (transverses)** :
- **I-1** **🔴 AEC bout-en-bout** : médias jouent + Sophia parle → aucun barge-in fantôme, aucune auto-coupure (M1 prouvée).
- **I-2** **🔴 réveil FR** : « Bonjour/Dis-moi/bonne nuit Sophia » depuis la pièce (au casque) → détection + premier mot intact ; taux de faux réveils mesuré.
- **I-3** **vivacité + barge-in** : wake → premier mot audible peu après `turn.end`, 1re phrase **avant** fin de génération (cerveau-stub) ; « Sophia » pendant qu'elle parle → coupure immédiate.
- **I-4** **jamais de silence** : orchestrateur tué pendant un tour → phrase de secours jouée une fois, en entier.
- **I-5** **résilience** : kill sidecar en pleine conversation → respawn + resync complète (V15), wake de retour < X.
- **I-6** **le banc bout-en-bout** (l'essai à blanc priorité n°1) : micro → AEC → VAD/wake/STT → fin de tour → cerveau-stub → TTS streamé, **au casque**, latence wake→premier mot mesurée.

---

## 5. Critères d'acceptation

> **Pointés vers `01` §6 (les 13) — la source, jamais réinventés.** *(Les invariants de `01` §5 — audio hors IPC, sidecar sans état durable, état d'écoute à l'orchestrateur, fin de tour acoustique, grille sur énoncé entier, injection en dictée seulement, moteur hors protocole, barge-in modulé, affect muet-dans-le-doute, ducking armé par l'état, une frontière VRAM, priorité interactive — sont ancrés dans les tâches V0–V15 et leurs tests.)*

1. **Réveil** (« Bonjour/Dis-moi Sophia » depuis la pièce, accueil < X, faux réveils < Y/j) → V3 / I-2.
2. **Adresse naturelle d'un coup** (« bonne nuit Sophia » à froid, premier mot intact, rien perdu) → V3, V10 / I-2.
3. **Fin de tour** (confiant < X ms · hésitation ne coupe pas · plafond tient si Smart Turn crashe) → V5 / U-V5.
4. **Vivacité** (premier mot < X s après `turn.end` ; 1re phrase avant fin de génération) → V7, V11 / I-3, I-6.
5. **Barge-in** (« Sophia » immédiat · Yohann < X ms · « stop » sans cerveau · jamais d'auto-coupure · bruit bref ignoré) → V8, V1 / I-1, I-3.
6. **Replay** (à l'identique, zéro cerveau/resynthèse ; cache vide dit honnêtement) → V8 / U-V8.
7. **Prises** (changer de moteur = config + respawn, mêmes événements ; conformité ; aucune clé pour démarrer) → V0, V15 / U-V15.
8. **Résilience** (kill sidecar → respawn + resync complète, wake < X ; orchestrateur mort → phrase de secours une fois) → V15, V13 / I-4, I-5.
9. **Affect** (`evt.affect` muet si confiance basse/locuteur ≠ Yohann ; jamais d'étiquette) → V14 / U-V14.
10. **Grille** (flou → cerveau jamais d'action ; forme dans une phrase plus longue → cerveau ; « ok/go/fonce » inertes hors APPROBATION ; timeout → refus) → V10, V9 / U-V10, U-V9.
11. **Ducking** (baisse dès la parole en conversation, au wake en veille, désarmé en dictée ; **armement tablée voix+nom seuls testé par injection en V12, politique tablée → `04`** ; indépendant du toggle) → V12 / U-V12.
12. **Erreur d'oreille** (transcript vide → redemande honnête, zéro cerveau, jamais de silence) → V10 / U-V10.
13. **Dictée** (« merci Sophia » dicté est écrit, pas exécuté ; hors dictée, rien n'est jamais tapé) → V9, V10 / U-V9.

---

## 6. Preuves de calibration Phase 3

> Les valeurs laissées ouvertes ci-dessus. Depuis `01` §7. **Zéro chiffre inventé.** *La couche audio porte les deux 🔴 du projet.*

- **🔴 Wake word FR** : LiveKit ⇄ openWakeWord sur la qualité FR de « Sophia » porté par des phrases variées + taux de faux réveils. **Tension F6** : « Sophia » (2 syllabes) = cible plus courte que « Dis-moi Sophia » → **repli nommé** si la preuve échoue (nom-en-phrase à chaud seulement, formules longues à froid). Entraînement avec la voix réelle de Yohann.
- **🔴 AEC (M1 — le vrai dur)** : alignement d'horloges micro/rendu (loopback WASAPI, dérive, resampling) · changement du périphérique de sortie · flux WASAPI exclusifs · latence et résidu d'annulation. Prérequis du barge-in **et** du réveil fiable en médias.
- **Fin de tour** : seuils (confiance Smart Turn, court silence, plafond, fenêtre de fusion d'hésitation) + **ratio `fallback`/`smart-turn`** (jauge de santé FR).
- **Barge-in modulé** : seuils par déclencheur (nom immédiat · Yohann bas · inconnu durée minimale) — sans avaler un mot bref porteur d'intention.
- **STT** : modèle Whisper (`medium` ⇄ `large-v3` int8), latence streaming réelle sur la 2060, précision FR.
- **TTS** : Kokoro ⇄ Chatterbox **à l'oreille** (avec le timbre A20) ; latence 1re phrase ; naturel de la découpe.
- **VRAM** (avec `05`) : co-résidence Whisper+Kokoro ou alternance stricte ; temps de swap RAM→VRAM ; coût du prewarm ; coût de `cmd.tts.cache` au boot.
- **Ring buffer** : taille de la fenêtre pré-wake (« bonne nuit Sophia » entier, marge comprise).
- **Écoute transitoire** : durée du délai de garde après le tour de réveil. **APPROBATION** : timeout avant refus.
- **Speaker-ID** (A29) : modèle + seuil (conditionne le verrou affect **et** la modulation barge-in).
- **Affect** : emotion2vec sur la ligne de base de Yohann ; seuils d'émission ; coût CPU/tour.
- **Grille** : tolérance du mapping (variantes réelles) ; taux de faux matchs (→ 0) ; **cas obligatoire « bonsoir » vs « bonne nuit » Sophia** (S6).
- **Volume (S3)** : pas de réglage du gain (marches), bornes.
- **Far-field** : d'abord au **casque** (valide la logique) ; le rig validera l'acoustique (passe #5).
- **Latence bout-en-bout** : wake → premier mot de réponse (le chiffre du critère de succès du cahier).
- **Phrases de secours** : liste exacte + déclencheurs + durée de l'épisode de panne.

---

## 7. Journal des écarts (code ↔ `01`)

> Vide au départ. Tout écart découvert au contact du code est **inscrit ici ET renvoyé au `01` §7**, jamais contourné.

- **[Emprunt tracé — audit croisé conv 14, FID-7]** V11 mentionne « `embed` (couche 2) autorisé dans tous les groupes (CPU, hors frontière VRAM) » : exact, mais c'est une notion de **`02` §2.2 / `05` §2.1** (embed dans le vocabulaire de `cmd.model.policy`), au-delà de la source `01`. Conservée (utile à la résidence voix) et tracée ici comme emprunt.
- **[Note d'audit]** Audit croisé 2 agents conv 14 (fidélité FID-1→7 · robustesse ROB-1→7) : **14 findings, zéro faux positif, tous intégrés**. **Deux findings (FID-2, FID-4) ont porté sur le plan du socle** (cohérence socle↔audio) → corrigés dans `docs/plan/00-socle.md` (T5 phase 5 nomme `cmd.tts.cache` ; T7 nomme le calque JEU). Non-défauts confirmés : couture injectable `evt.speaker` réellement branchée · les deux 🔴 (wake FR I-2, AEC I-1) adossés à un test · zéro chiffre inventé.
- **[Note ← AUDIT FABLE (intermède, 2026-07-10)]** Audit complet des 4 plans (sécurité · cohérence · trous · robustesse) : **ce plan est sain — zéro finding le concernant** (fidélité aux 13 critères de `01` §6 revérifiée, invariants §5 ancrés, grille 20 entrées conforme). Les findings de l'audit portent sur `plan/00`/`plan/02` (classe stockage + coutures) — cf. `docs/journal/audits/AUDIT-fable.md`.
- **[Back-refs de confirmation ← gravure de `plan/04` (conv 19), posées par l'audit corpus Fable (2026-07-11, FC-9 — symétrie stricte conv 21)]** trois coutures que `plan/04` §7 promettait « Renvois `plan/01` §7 (sur Go) » sont **confirmées bilatérales** (la mécanique était déjà saine — les renvois amont vivent dans le corps ; seule la trace manquait) : **V8** — l'échelle du barge-in gagne le cran **« proche consenti »** (reconnu, seuil modéré anti-cross-talk — politique `plan/04` Q10) ; **V12** — la **politique de ducking tablée** (armé par `evt.tts.start` + `evt.wake` seuls, jamais le VAD ambiant — posée `plan/04` Q10, mécanique ici) ; **V14** — le **verrou d'affect sur Yohann vaut aussi en tablée** (`plan/04` Q7). *(Le corpus ferme ses boucles — décision de symétrie stricte, conv 21.)*

- **[Preuve de banc — Temps 1 du banc AEC, conv 22 (2026-07-11) — validée par Yohann]** premier essai à blanc (banc **jetable** `bancs/aec/`, Python 3.13, PyAudioWPatch loopback WASAPI). **La dérive d'horloge micro↔loopback — la part classiquement la plus dure de V1/M1 — est NÉGLIGEABLE dans le chemin normal.** Sur 90 s, l'écart `loopback − micro` reste **constant** (+480 frames ≈ 10 ms), dérive mesurée **+3.4 ppm sous un plancher de ±10 ppm → horloges VERROUILLÉES**. Cause : en **mode partagé WASAPI**, le moteur audio de Windows cadence les deux flux sur une **horloge commune** (rééchantillonnage par périphérique masqué en interne) → micro et référence loopback arrivent **déjà alignés**. **Conséquence V1** : le **resampling adaptatif** anticipé par `01` §7/§V1 **n'est PAS nécessaire dans le chemin normal** ; reste un **délai fixe** (~10 ms) que l'AEC estime **une fois** (facile — pas de la dérive). **Limites, à prouver (Temps 2 / suite)** : vaut en mode **partagé** — les **flux exclusifs** (déjà nommés `01` §7) court-circuitent le moteur → dériveraient ET échapperaient au loopback (cas à part) ; l'**annulation elle-même** (WebRTC AEC3 ⇄ SpeexDSP) et le **changement de périphérique de sortie** restent à prouver au Temps 2. Environnement confirmé : Node 24.13 · Python 3.13/3.14 · RTX 2060 6 Go · Build Tools 2022. Renvoi `01` §6 (AEC/M1 = la preuve prioritaire).

- **[Preuve de banc — Temps 2 du banc AEC (l'annulation), conv 23 (2026-07-11) — validée par Yohann]** Second essai à blanc (banc **jetable** `bancs/aec/`, `03_aec_cancel.py`, gitignoré). **La preuve I-1 est acquise, en conditions réelles** (barre de son HDMI + micro USB, sortie réelle de Yohann) :
  - **Écho seul** (média fort) : après AEC, résidu au bruit de fond (activité résiduelle ~0 %, pic −33 dBFS), **ERLE ~30 dB** → **elle ne se coupe pas elle-même, zéro barge-in/VAD fantôme**.
  - **Double-parole** : voix de Yohann **préservée à −3,5 dB (67 %)**, média annulé — **confirmé à l'oreille par Yohann** → **elle l'entend par-dessus le média**.
  - Temps réel trivial (~0,4 ms/trame pour 10 ms de budget).

  **Moteur benché : SpeexDSP** (via `pyaec`, DLL SpeexDSP compilée prête). **Aucun binding maintenu de WebRTC APM/AEC3 n'existe** sur Windows/Python 3.13 (seul paquet PyPI cassé + périmé AECM ; vrai AEC3 = build C++ from-source Meson/abseil = **dette de maintenance**, contre R3).

  **Écart / raffinement (renvoi `technique/01` §2.1) :** le design pose « micro → AEC → PUIS conversion 16 kHz ». **Empiriquement, SpeexDSP sur-supprime le proche à 48 kHz** (perte ~22 dB au passthrough référence-zéro ; propre à 16 kHz). Speex est conçu pour 8/16 kHz → **pour un moteur famille-Speex, la conversion 16 kHz doit se faire À/AVANT l'AEC**. (AEC3 encaisserait le 48 k.) Le harnais tourne l'AEC à 16 kHz.

  **Findings :** barre de son = **~150 ms de latence** (réf→écho) → **queue de filtre AEC ≥ 200 ms** (trop court = écho raté). L'AEC mérite d'être une **prise `aec` formelle** au §2.3 (absente aujourd'hui — signalé, non modifié).

  **Décision technique (micro-technique tranchée par Claude — garde-fou Phase 3 pt 2 ; pas une réouverture : le moteur n'a jamais été gravé, laissé à l'essai comme A8/A5) : moteur AEC primaire = SpeexDSP à 16 kHz** (robuste, maintenable, coût ~nul, prouvé suffisant pour M1 sur le cas réel un-locuteur + barre de son). Prise `aec` laissée **ouverte pour un AEC neuronal (ONNX/onnxruntime)** en upgrade — SOTA double-parole, s'intègre au sidecar neuronal existant, maintenable — **si** un besoin réel mesuré apparaît, au coût d'une part de VRAM (frontière `05`). **AEC3 non retenu** (algorithme respecté, intégration non maintenable dans ce stack). **CF2 : rien du banc n'entre dans le produit** ; l'audit croisé viendra au vrai sidecar.

- **[Cas durs M1 — banc AEC, conv 23 (2026-07-11) — validée par Yohann]** Les deux limites nommées de V1, **confirmées empiriquement** :
  - **Flux exclusif — échappement confirmé** (`04_exclusive_escape.py`, **avec témoin**) : ton en **partagé** capté (−42 dBFS) ; même ton en **exclusif** NON capté (**−97 dBFS = silence, 0,2 %**). L'exclusif court-circuite le moteur partagé → **hors référence de l'AEC → non annulable** → **le sidecar doit détecter l'usage exclusif et signaler la dégradation** (résidu assumé, conforme V1/§6).
  - **Changement de périphérique de sortie — confirmé** (`05_device_change.py`, sur la Focusrite USB de Yohann) : allumer un 2ᵉ périphérique bascule la sortie/loopback par défaut ([10] TV/[13] → [15]/[20] Focusrite) ; l'ancien loopback reste **lié à l'ancienne sortie (périmé)**. → **le sidecar doit détecter le changement (notifications Core Audio IMMNotificationClient) et RÉ-OUVRIR le loopback** sur la nouvelle sortie. **Piège** : PyAudioWPatch cache l'énumération à l'init → re-init/notifications nécessaires (pas un simple re-query).
  - Handling des deux = **code sidecar produit** (API Core Audio), hors du banc jetable.

- **[Preuve de banc — wake word FR « Sophia » (🔴 n°2 · V3/F6), conv 24 (2026-07-12) — validée par Yohann]** **Dérisqué et PROUVÉ** au banc jetable `bancs/aec/` (venv py3.13, `livekit-wakeword` 0.2.1 + VoxCPM2, torch 2.6+cu124 / RTX 2060). *(Micro-technique tranchée par Claude — garde-fou Phase 3 pt 2 ; moteur non gravé, laissé à l'essai comme A8.)*

  **Moteur & install :** **`livekit-wakeword`** (conv-attention, ONNX ; A8 confirmé). Mur d'install franchi : `editdistance` sans wheel cp313 → compilé sous `vcvars64` + `DISTUTILS_USE_SDK=1` + `--no-build-isolation`. *(triton 3.7 incompatible torch 2.6 → `torch.compile` inutile ; sans effet sur la vitesse, voir ci-dessous.)*

  **Méthode de génération FR = « E » (conditionnement par référence) :** VoxCPM déduit la langue du **texte** → « Sophia » seul (court, ambigu) sort en anglais/accent aléatoire (**constaté à l'oreille de Yohann**). Solution : générer une **référence française** (phrase complète) puis « Sophia » en **continuation** (`prompt_wav_path`+`prompt_text`) → voix/accent/genre **français** hérités. **`retry_badcase=False` + 6 pas de diffusion** → **~6 s/clip** (le `retry`, faux-positif sur mot court, coûtait ~40 s).

  **Modèle final :** 1000 clips synthétiques FR **+ 231 clips de la VRAIE voix de Yohann ×3** (77 uniques, conditions près/doux/loin — A8) ; négatifs FR avec **confusables proches sur-représentés** (Sonia/Sophie/sosie, ~50 %, défense F6). Éval synthétique : AUT=0,0017 · FPPH=0,00 @ 0,5 (n_neg≈30k / ~17 h).

  **Preuve à la voix de Yohann (le vrai juge) :** **6/6 des « Sophia » détectés à seuil ~0,25–0,30, ZÉRO faux** (parole normale + confusables Sonia/symphonie/sosie plafonnent à ~0,06). L'enrichissement par la voix réelle (A8) a **remonté la courbe de recall de ~0,15–0,20** (6/6 à 0,30 au lieu de 0,12 sans elle).

  **Décision (tracée) : F6 = PASSÉ — repli nommé NON nécessaire** (reste spécifié `01` §6/§7, non activé). « Sophia » (2 syllabes) est fiable à ta voix, faux réveils quasi nuls. **Seuil de détection retenu ≈ 0,25–0,30** (calibration par utilisateur, `01` §6 — à affiner à l'usage réel ; en environnement FR réel les faux paraissent très improbables, marge ~5× sous le seuil).

  **Périmètre :** prouvé = reconnaissance du nom **à la voix de Yohann, au micro**. Le **far-field acoustique** (réverbération/distance réelles, beamforming/fusion) reste la **passe #5 / ère matérielle** (rig micros) — le modèle est déjà entraîné sur des « Sophia » lointains. **Précision Yohann (post-clôture conv 24)** : son usage réel = **micro porté au cou** (near-field constant qui bouge avec lui — l'équivalent « casque » du design, §7) → la preuve « à la voix, au micro » **EST représentative de l'usage réel** ; le **rig far-field (passe #5) devient OPTIONNEL, pas un bloquant** (utile seulement s'il veut un jour se passer du micro porté). Testé « plus loin que la chaînette » avec bon résultat ; bruit de chaînette absorbé (AEC + marge 0,06 vs seuil 0,25). **CF2 : rien du banc n'entre dans le produit** ; le vrai sidecar (prise `wake`, §2.3) ré-implémentera, audit croisé alors. Renvoi `01` §6 (wake FR = preuve prioritaire) + §7 (F6).

- **[Preuve de banc — STT FR (V4), conv 25 (2026-07-12) — validée par Yohann]** Tournoi à la voix de Yohann au banc jetable `bancs/aec/06_stt.py` (**faster-whisper 1.2.1 / ctranslate2 4.8.1**, py3.13 / CUDA 12.4 / RTX 2060). *(Micro-technique tranchée par Claude — garde-fou Phase 3 pt 2 ; modèle non gravé, laissé à l'essai comme A5.)*

  **Fix Windows** : ctranslate2 charge cuDNN9/cuBLAS/cudart **depuis `torch/lib`** (`os.add_dll_directory` avant l'import) — pas de doublon `nvidia-*`. **Langue verrouillée `fr`** ; décodage `temperature=0` + `condition_on_previous_text=False` ; **VAD en amont indispensable** — Whisper **hallucine sur le silence pur** (« Merci d'avoir regardé cette vidéo »), le VAD (Silero, V2) l'élimine (fichiers benchés avec `vad_filter`).

  **Deux passes à la voix de Yohann (le vrai juge)** : (1) **lecture** de 3 phrases FR ; (2) **parole spontanée** (débit réel). Modèles comparés sur le **même audio** : `large-v3-turbo`, `large-v3`, `medium`, **+ fine-tunés FR** (`bofenghuang/whisper-large-v3-french` complet + `…-distil-dec16`, CT2).

  **VRAM mesurée (RTX 2060, int8_float16 sauf mention)** : turbo **1,15 Go** · large-v3 **2,1 Go** · large-v3 **float16 3,9 Go** · medium 1,15 Go → **`float16` écarté** (+1,8 Go pour un gain nul : `int8_float16` ne quantifie que les poids, calculs en fp16).

  **Justesse** : **`large-v3` le plus propre ET complet** (parfait en lecture ; élisions/ponctuation nettes ; capte « anthropique »). turbo **quasi** (rate 2 mots durs : « ronronnent »→« rouronnent » ; « Anthropic »→« entropique »). medium : 1 erreur de sens. **Fine-tunés FR = aucun gain** sur la voix de Yohann (même « anthropique » que large-v3 ; le complet a **perdu des mots** en fin de phrase) → *hypothèse « un spécialiste FR sera plus juste » INFIRMÉE au banc*.

  **Vitesse** : GPU tous largement temps réel (turbo RTF ~0,04 · large-v3 ~0,13, silences coupés). **CPU seul (i5-9600KF — mode JEU, GPU saturé)** : turbo RTF **~0,3–0,65**, medium ~0,45–0,9 → **plancher CPU viable** (phrase courte ≈ 2 s, réponse vocale maintenue).

  **Décision (tracée)** : **STT par défaut = `large-v3` int8_float16 sur GPU** (optimal justesse ; 2,1 Go, la 2060 le porte large en usage normal). **Cran de dégradation = `large-v3-turbo`** selon la **VRAM libre** — GPU en jeu lourd, **CPU si GPU saturé** (prise `stt` par paliers = gestionnaire de modèles, **doc `05` / mode JEU** : « dégrader en vitesse, jamais en canal »). **Fine-tuné FR non retenu.** **Filet transverse** : les erreurs mineures sont **absorbées par le cerveau** (le LLM comprend l'intention, pas les lettres) et **tout acte à conséquence est confirmé avant exécution** (A26).

  **Périmètre** : prouvé **à la voix de Yohann, au micro porté** (near-field = usage réel, cohérent §7 wake). **CF2 : rien du banc n'entre dans le produit** ; le vrai sidecar (prise `stt`, §2.3) ré-implémentera, audit croisé alors. Renvois `01` §6 (STT = calibration) · doc `05` (paliers VRAM / mode JEU).

- **[Preuve de banc — Fin de tour (V5), conv 25 (2026-07-12) — validée par Yohann]** Banc jetable `bancs/aec/07_turn.py` (**Smart Turn v3.2-cpu ONNX** + **Silero VAD**, `onnxruntime` CPU, py3.13). *(Micro-technique tranchée par Claude — garde-fou Phase 3 pt 2 ; moteur non gravé, laissé à l'essai comme A6.)* **Deux étages (A6 / `01` §4.3)** : Silero VAD = garde-fou (silence + plafond) ; **Smart Turn v3.2** = le cerveau (waveform/**intonation**, pas le texte).

  **Chaîne (vérifiée à la source — `inference.py` Pipecat)** : audio 16 kHz → **8 s** (dernières, pad zéros à gauche) → mel-spectrogram Whisper (`WhisperFeatureExtractor(chunk_length=8)`, 80×800, **`do_normalize=True`**) → ONNX → **la sortie EST une probabilité** (sigmoïde intégrée ; le tensor `logits` est trompeur — **PAS de sigmoïde à rajouter**, sinon tassement vers 0,5 : bug attrapé en lisant la source). Modèle `smart-turn-v3.2-cpu.onnx` (dernier au repo, > la v3.1 que citait le code). **~40 ms/appel sur l'i5** (annonce 12 ms ; écart = i5 ancien + FE non optimisé — négligeable pour la fin de tour).

  **Français DÉRISQUÉ à la voix de Yohann** (la doc dit seulement « multilingual » sans lister le FR → **le test tranche, comme le wake**). **Mode fichier** (parole spontanée) : 4 vraies fins de demande captées (0,57–0,99), respirations/« Ah, et… » internes ignorées (≤ 0,12). **Mode live** : **le cas dur réussi** — un « euh… » suspendu → **0,214, ne coupe pas** → puis 0,936 à la vraie fin ; 4 fins nettes (0,94–0,99), pauses internes ≤ 0,005. **Zéro coupure prématurée, zéro fin ratée.** **Latence ~200 ms** après la fin réelle (150 ms silence Silero + ~40 ms Smart Turn) → vif.

  **Décision (tracée)** : **fin de tour = Smart Turn v3.2-cpu + Silero VAD** ; **seuil ≈ 0,5** (fossé énorme : fins > 0,93 / hésitation ~0,21 / pauses < 0,01 → marge large, calibrable 0,3–0,7) ; `min_silence` Silero ~150 ms avant d'évaluer. **Machine à états unique = émetteur unique de `evt.turn.end`** (V5). **Frontière gravée tenue** : fin de tour **acoustique, jamais sémantique** (le sens = grille V10). **Alternative de prise (LiveKit turn-detector, texte) non nécessaire.**

  **Non exercé (honnête)** : le **plafond/fallback** (3 s) ne s'est **jamais déclenché** — Smart Turn a tranché à chaque fois (bon signe de fiabilité) → garde-fou spécifié et codé, mais non prouvé empiriquement ici (à voir sur un cas ambigu, ou Smart Turn tué → le plafond tient, `01` §4.3). **CF2 : rien du banc n'entre dans le produit** ; le vrai sidecar (prise `turn`, §2.3) ré-implémentera, audit croisé alors. Renvoi `01` §6 (fin de tour = seuils + ratio fallback/smart-turn).

- **[Preuve de banc — Voix / timbre TTS (V7 · A20), conv 25 (2026-07-12) — validée par Yohann]** Tournoi de voix FR au banc jetable (`bancs/aec/tts_out/`). *(Le moteur/timbre TTS n'est pas gravé — laissé à l'essai, A9 ; et le TIMBRE relève de Yohann, A20.)*

  **Tournoi à l'oreille de Yohann (le juge — A20)** : **Kokoro `ff_siwis`** (seule voix FR, native mais **trop froide/robotique**) · **Chatterbox** (cloneur — **sans référence, voix par défaut MASCULINE non-FR** → inutilisable tel quel, écarté) · **VoxCPM2** (déjà présent pour le wake) = **la meilleure voix FR douce**. Kokoro/Chatterbox montés sur **venvs py3.12 isolés** (mur spaCy py3.13 + conflit `transformers` → isolation ; écartés).

  **Écart A9 assumé et tracé** : A9 listait **Kokoro (défaut) / Chatterbox / ElevenLabs** ; le retenu = **VoxCPM** (hors A9). Motif : à l'épreuve du FR réel, les candidats A9 ne donnent pas la voix voulue ; VoxCPM oui.

  **Timbre CHOISI par Yohann (A20)** : voix **douce, suave, naturelle, féminine FR**, intonation juste (« très bien… compliqué de faire mieux »). **Zéro clonage réel** (voix **synthétique** — personne de réel → esprit A20 respecté : on sculpte la sienne). **Recette** (`SOPHIA_VOIX_recette.md`) : VoxCPM2 · référence `SOPHIA_voix_reference_v1.wav` (seed synthétique) + son `prompt_text` · **continuation** (`prompt_wav_path`) · `cfg_value=2.0` · `inference_timesteps=16` · **débit natif** (le time-stretch dégradait/saccadait — abandonné). Démo validée : portrait de 42,7 s.

  **DÉFI OUVERT — vitesse (conv 26)** : VoxCPM ≈ **10× le temps réel** (RTF ~10, RTX 2060) → **trop lent pour le TTS streamé** (V7 / A9 / §6). **Piste** : reproduire CE timbre avec un moteur **rapide** en lui donnant `SOPHIA_voix_reference` comme **voix cible** (Chatterbox/XTTS sur GPU — les cloneurs redeviennent l'outil, la voix cible étant synthétique et choisie). **Le choix esthétique est acquis ; la vitesse reste à prouver.**

  **CF2** : la référence de voix = **asset « timbre choisi » à préserver** (banc, hors dépôt public) ; le vrai sidecar TTS ré-implémentera (prise `tts`, §2.3), audit croisé alors. Renvois `01` §6 (TTS = à l'oreille + latence 1re phrase) · doc `03`/A20 (le timbre porte le caractère) · A9 (écart moteur).

- **[Preuve de banc — Voix RAPIDE / moteur TTS streamé (V7 · A9 · A20), conv 26 (2026-07-12) — validée par Yohann]** Le timbre choisi conv 25 (VoxCPM) était **~10× le temps réel** → défi vitesse. **VoxCPM accéléré écarté par la mesure** : plancher **RTF ~8,2** même à `inference_timesteps=4` (goulot = **backbone autorégressif** ~1,3 s/trame sur la 2060, pas la diffusion) → inutilisable en streamé. **Solution retenue = cloner le timbre** (`SOPHIA_voix_reference_v1.wav`) avec un moteur rapide. Chatterbox **multilingue** clone vite (RTF ~1,2) mais prosodie FR imparfaite (prénom, montée des questions, respiration). → **Chatterbox-FRANÇAIS** (`Thomcles/Chatterbox-TTS-French` — fine-tune du Chatterbox **anglais** sur ~1400 h Emilia FR ; on charge la base `ChatterboxTTS.from_pretrained` puis on **injecte le T3 français** via `hf_hub_download(...,'t3_cfg.safetensors')` → `model.t3.load_state_dict`) : **RTF ~0,87** (sous le temps réel → streamable), prosodie FR nettement meilleure (validée à l'oreille). **Prénom = lexique de prononciation** « **Yohann** » (mémoire/texte, intact) → « **Yoan** » (à l'entrée du moteur seulement) : « Yohann » brut **non fiable**, « Yohan » (avec h) échouait, « **Yoan** » fiable sur 5 contextes → mécanisme **général** (réglage produit ; tout mot mal dit peut recevoir une entrée). **Réglages** (oreille de Yohann, A20) : `exaggeration=0.5`, `cfg_weight=0.4`, `temperature=0.7` ; SR **24 kHz** ; watermark Perth **inaudible** (désactivable au vrai sidecar). **La ponctuation pilote la prosodie** (virgules=pauses ; `:`/`…`→virgules ; le cerveau ponctuera naturellement). **Génération phrase-par-phrase** (= le streaming V7). **Écart A9** (ouvert conv 25) : moteur rapide = **Chatterbox français** (Chatterbox était listé A9 ; fine-tune FR hors liste, esprit tenu) clonant le timbre **synthétique** choisi (A20, zéro personne réelle). **Premium = ElevenLabs** (chemin nommé A9, « quand revenus ») : la **prise `tts`** (01-F/V0) rend le moteur **interchangeable** → bascule = config, **zéro reprise**. **Validé Yohann : voix v1** (+ démo de présentation partageable, montage soigné). **Non encore mesuré** : latence bout-en-bout **wake→premier mot** (I-6, dominée par le cerveau) = prochaine étape. **CF2** : banc jetable, rien n'entre au produit ; le vrai sidecar (prise `tts`, §2.3) ré-implémentera, audit croisé alors. Renvois `01` §6 (TTS à l'oreille + latence 1re phrase) · A9 (moteur/écart) · A20 (timbre).

- **[Preuve de banc — banc bout-en-bout I-6 (assemblage live), conv 27 (2026-07-12) — validée par Yohann]** **I-6 PROUVÉ dans ses deux temps.** Toutes les briques réunies pour la 1re fois en une boucle live (micro → AEC → portier → STT → fin de tour → cerveau → TTS streamé → voix). Bancs jetables `bancs/aec/oreilles_live.py` (chaîne d'écoute + coordinateur, `.venv` py3.13) + `bancs/aec/bouche_live.py` (service TTS Chatterbox-FR, `.venv-cbg` py3.12), reliés par **socket localhost** (l'audio ne transite jamais par l'IPC). Deux venvs incompatibles (numpy/py) → boucle **multi-process**, fidèle à la frontière orchestrateur↔sidecar. *(Micro-technique tranchée par Claude ; CF2 : rien n'entre au produit, le vrai sidecar ré-implémentera, audit croisé alors.)*

  - **(a) cerveau-stub** : boucle prouvée live, elle répond à voix haute à l'adresse de Yohann. Latence **fin de phrase → 1er mot ≈ 3–3,8 s** (plancher plomberie : STT `large-v3` ~1,3 s + génération 1re phrase TTS ~2 s ; cerveau ≈ 0).
  - **(b) VRAI Claude** (`claude -p`, Max, « pas d'API ») : **elle a donné une vraie réponse (Spinoza) à voix haute, validée par Yohann.** Latence **≈ 7 s** (STT ~1,3 + **Claude à FROID ~4–5** + TTS ~2), **dominée par le cerveau** (conforme au cahier). **Dépendance Anthropic (vigilance n°1) tenue en réel.** Détails : cerveau lancé depuis un **dossier neutre** (sinon il charge le CLAUDE.md *du chantier* → « ravi de reprendre l'aventure de Sophia » !) · **Sonnet** · consigne « assistant vocal, bref, oral, sans markdown ni émojis » · fil gardé par `--resume` · **`claude.CMD` résolu via `shutil.which`** (Windows : `claude` nu = FileNotFound depuis Python) · **jamais de cerveau sur un transcript vide** (garde).

  - **DÉCISION MAJEURE (Yohann) — l'éveil par PHRASE, portier VAD+STT (écart produit tracé).** Le **wake-model conv-24 s'est révélé trop faible en conditions réelles** : il **ratait « Dis-moi Sophia »** (~0,29, sous seuil) et **déclenchait sur « Sophie »** (0,45) — un « Sophia » noyé dans une phrase naturelle score plus bas qu'un « Sophie » isolé ; l'AEC-**preprocess** l'aggravait (denoise/AGC hors distribution → coupé pour le wake) ; l'intégration temporelle n'y suffit pas (un confusable clair tient aussi longtemps qu'un vrai). **→ wake-model ÉCARTÉ du banc ; portier = VAD (entend la parole) + STT (lit la PHRASE, distingue Sophia/Sophie de façon fiable).** **Éveil par phrase (« OK Siri », pas « Siri ») : Bonjour / Bonsoir / Salut / Dis-moi Sophia** (+ **Bonne nuit Sophia** = éveil-clôture) ; **conversation active multi-tours sans re-nommer** ; **clôture « Merci Sophia, à plus tard »** (le « à plus tard » lève l'ambiguïté — un « merci Sophia » seul ne ferme pas) + rendormissement sur silence. **Prouvé (mode listen) : 3 phrases → 3 issues nettes** (ÉVEIL / CLÔTURE / IGNORÉ « Sophie »). **Écart produit** : conv-24 insuffisant pour la détection *en phrase* → produit = **meilleur modèle wake (ré-entraîné)** OU **STT-toujours-actif** (acceptable en usage perso local/privé) — renvoi `01` §6 (wake) + §7 (F6, repli nommé désormais ADOPTÉ sous forme de phrases).

  - **RESTE = optimisations CONNUES, pas des inconnues (priorité conv 28)** : **l'accusé (O2)** — elle parle instantanément (« mmh… ») pendant qu'elle réfléchit → masque la latence (**Yohann l'a identifié seul**) ; **la session chaude (A36)** — garder UN Claude allumé → ~1–2 s au lieu de ~5 (le gros du délai = le redémarrage à froid, pas la réflexion). Plus : **barge-in absent** (V8) ; **attaque avalée sur phrase très courte** (Chatterbox rêche sur le très court — recette conv 26, montage best-of). Renvois `99` O2 (accusé) · `05` R4/A36 (session chaude) · `01` V8 (barge-in) · `01` §6 (latence 1re phrase).

- **[Preuve de banc — conv 29 (2026-07-13) — validée par Yohann À L'USAGE RÉEL (micro porté, vrai Claude)]** Ordre du plan (V1→V4→V8→session chaude) exécuté au banc jetable `bancs/aec/` (CF2). **V1 (AEC live, sonde `08_v1_diag`, M0-M4)** : câblage prouvé (le son joué ressort dans le loopback = réf AEC ; délai TV ~110 ms, dans la queue 200 ms) · **média en fond = 0 tour fantôme** · **silence = 0 tour**, plancher micro **-82 dBFS** · alignement des files sain (garde anti-backlog jamais déclenchée). Le **résidu de sa PROPRE voix** déclenche le VAD (l'AEC plafonne **~8-10 dB** au micro porté — écho FAIBLE *floor-limité*, pas le « média fort » de conv 23 ; **ni** le preprocess/suppresseur de résidu **ni** la compensation du délai 110 ms ne débloquent) → **tranché : ce résidu n'est PAS un trou de V1** (l'AEC annule ce qu'il peut), c'est **V8/speaker-ID** (sa voix synthétique ≠ Yohann), **dormant** dans la boucle tour-par-tour. **V4 (anti-hallu)** : le « Sous-titrage… » = hallu Whisper sur silence, **tuée par `vad_filter`** (sonde `09`) ; média → le **VAD bloque le tour** (0 déclenchement) ; edge « bruit bref → phrase inventée » → **filet** (liste de phrases-fantômes + `no_speech_prob`, sonde `10`, **11/11**) branché dans `oreilles_live`, **prouvé live** (ignore « Sous-titrage ST' 501 » deux fois). **V8 étape 1** : `_await` devient **dual-poll** (elle écoute pendant la TTS, **fil unique** = pas de course, invariant « émetteur unique ») + **ids d'énonciation uniques → la fuite de jalons de conv 28 est CORRIGÉE** (0 temps négatif en réel) ; mécanisme de coupure prouvé **par injection** (couture injectable, comme `V6`/`V8` le prévoient) ; **la vraie DÉTECTION audio du barge-in = V8 étape 2, NON faite**. **Session chaude (A36 · renvoi `05` R4)** : cerveau `claude` **persistant** (`--input-format stream-json --output-format stream-json --verbose`, sous Max, pas d'API) → **~4 s d'allumage puis ~1,4 s/tour** (vs 5-13 s à froid ; sonde `11`) ; intégré (`WarmBrain` + pré-allumage au boot + **repli à froid** robuste) → **fini le backlog cerveau-froid**. **Clôture** (spec Yohann) : « Merci Sophia, à bientôt » → « À bientôt Yohann » → veille + reste muette. **Bug corrigé** : le **plafond de silence** (V5) comptait AUSSI pendant une phrase continue > 3 s (le VAD ne « pointe » qu'au début de la parole) → coupure à 3 s en plein milieu ; corrigé (compteur suspendu tant que `in_speech`).
  **DEUX MURS restants = problèmes de CONCEPTION, PAS des patchs (→ conv 30)** : **① l'endpointing / fin de tour (V5)** — la pile **Silero VAD + Smart Turn v3.2 + plafond** n'est **pas fiable** pour la parole naturelle de Yohann (phrases longues, pause avant de nommer « …entre Kant » *puis* « et Hegel », politesse finale « …, s'il te plaît ») : **elle le coupe en plein milieu** et la réactivité est **inconstante**. *Écart tracé (renvoi `01` §6 fin de tour) : la **fin de tour ACOUSTIQUE seule ne suffit pas** ; pistes à concevoir — **endpointing sémantique** (la phrase est-elle *complète* ?) · meilleur modèle · autre mode d'interaction.* **② la latence de la voix (V7)** : le temps avant le **1er mot prononcé** est de **7→41 s et CROISSANT** au fil de la conversation (**accumulation dans le tuyau de la bouche — à MESURER avant de fixer** ; + réponses trop longues vs consigne « 1-3 phrases »). **Leçon de méthode (Yohann) : ces murs se CONÇOIVENT, ils ne se bricolent pas** (chaque rustine — grâce, seuil — a régressé la réactivité). **CF2 : rien du banc n'entre au produit** ; le vrai sidecar ré-implémentera, audit croisé alors. Renvois `01` §6 (fin de tour = seuils + endpointing · latence 1re phrase) · `05` R4/A36 (session chaude) · V8 (détection barge-in).

---

*Plan 01 — Pipeline vocal. Traduit `01-pipeline-vocal.md` (A5–A9 + A32-étendu + affect + B4 + part couche 1 d'A29/A35) en tâches V0→V15 + tests + critères pointés. S'appuie sur `docs/plan/00-socle.md`. Suite (ordre des dépendances) : `docs/plan/02-memoire.md`. Les deux 🔴 du projet (wake FR, AEC) se prouvent ici.*
