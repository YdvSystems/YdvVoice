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

---

*Plan 01 — Pipeline vocal. Traduit `01-pipeline-vocal.md` (A5–A9 + A32-étendu + affect + B4 + part couche 1 d'A29/A35) en tâches V0→V15 + tests + critères pointés. S'appuie sur `docs/plan/00-socle.md`. Suite (ordre des dépendances) : `docs/plan/02-memoire.md`. Les deux 🔴 du projet (wake FR, AEC) se prouvent ici.*
