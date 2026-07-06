# 01 — Pipeline vocal · Doc technique · YdvVoice (Sophia)

> **Rôle** : les oreilles et la bouche de Sophia — du micro toujours ouvert jusqu'à la voix qui sort, en passant par le réveil au nom, la transcription, la fin de tour et l'interruption. S'écrit **sur** le socle (`00-socle-process.md`, acquis) : canal WS `cmd.*`/`evt.*`, supervision, invariants.
>
> **Statut** : décisions complètes (01-A → 01-I + audit F1–F7 + **audit croisé 2 agents** B1–B4/S1–S12/M1–M7 intégré, conv 8). Les **valeurs chiffrées** sont différées à la **calibration Phase 3** (rubrique 7) — pleine profondeur sur la *structure*, paramétrée sur les *valeurs*.
>
> **Altitude** : interfaces, schémas, séquences, invariants, critères d'acceptation. Pas de code, pas de chiffres inventés.

---

## 1. Arbitrages couverts *(pointeurs — zéro redite du journal)*

- **Cœur** : **A5** (STT faster-whisper local ⇄ Deepgram) · **A6** (fin de tour Smart Turn + Silero) · **A7** (VAD Silero) · **A8** (wake word open/local, moteur tranché Phase 3) · **A9** (TTS Kokoro ⇄ ElevenLabs premium) · **A32-étendu** (adresse naturelle sans double-commande) · **affect vocal** (backlog conv 7 — part capture, couche 1) · **B4 conv 8** (injection au curseur = dictée explicite, supersède le « systématique » du cahier — §3.1).
- **Liens entrants** (détaillés *ailleurs*, ici seulement la part couche 1) :
  - **A29** — le **speaker-ID est un consommateur du chemin audio** (§2.1), le **verrou de l'affect** (§2.4) et **module le barge-in** (§4.4, « l'ancre sert aussi le barge-in ») ; l'échelle de confiance, l'enrôlement et la vie sociale → doc `04`. **Tension signalée → doc `04`** : en mode tablée, une convive doit-elle pouvoir la couper ? (à trancher là-bas, pas ici).
  - **A35** — la résidence des modèles est **décidée par le gouverneur/l'orchestrateur, exécutée en réflexe par le sidecar** (§4.5) ; la mécanique VRAM complète → doc `05`.
  - **A2** — la voix *de contenu* (ce qu'elle dit) vient du cerveau via l'orchestrateur ; le canal Claude → socle + doc `05`.
  - **A16/A17** — l'**usage** de l'affect (colorer humeur/lien) → doc `03` ; ici seulement le capteur et son événement.
  - **Socle `00`** — enveloppe de message, familles `cmd.*`/`evt.*` (extensibles), supervision/respawn, « l'audio ne traverse jamais l'IPC ».
- **Ce que ce doc ne couvre PAS** : le cerveau et sa session chaude (socle/`05`) · la mémoire (`02`) · le persona et la convention de parole « Yohann » (§3.1, gravée en `03`) · le mode tablée et le détail A29 (`04`) · le rig far-field (ère matérielle — la *logique* 1→N micros est prête, l'*acoustique* viendra avec le rig, passe #5) · les **canaux non-vocaux du toggle voix** (raccourci global Ctrl+Shift+M, bouton UI — couche applicative, doc `99`).

---

## 2. Contrats d'interface

### 2.1 Le chemin audio interne (01-A, F2, F4)

Un seul chemin, dans le sidecar :

```
micro → AEC (référence = loopback sortie système ENTIÈRE) → conversion unique (16 kHz mono)
      → ring buffer central (RAM sidecar)
      → consommateurs abonnés, chacun son curseur :
        wake word (CPU, always-on) · VAD (CPU, always-on) · STT · fin de tour · speaker-ID · affect
```

- **Capture unique** : le sidecar ouvre le micro **une fois** ; les consommateurs sont du pur logiciel derrière le tampon — un consommateur lent ou mort ne bloque jamais les autres.
- **AEC en tête de chaîne (F2)** : la référence d'annulation est **tout ce que le PC joue** (loopback système), pas seulement la voix de Sophia — sinon les voix de YouTube déclenchent VAD/barge-in (barge-in fantôme, ducking oscillant). Après AEC, le VAD ne voit que les **voix de la pièce**.
- **Ring buffer** : donne le **rembobinage** — au wake, le début de la phrase est *déjà* dans le tampon (le nom arrive souvent en fin de phrase, §4.2). Taille = fenêtre pré-wake (rubrique 7). **RAM sidecar uniquement** : jamais dans le WAL, jamais sur l'IPC.
- **Conversion unique** en entrée (les modèles veulent du 16 kHz mono) — une seule fois, pas par consommateur.

### 2.2 Réflexes et décisions (01-B)

**Frontière** : *tout ce qui doit réagir en moins d'un battement humain vit dans le sidecar ; tout ce qui engage l'état de Sophia vit dans l'orchestrateur.*

- Le **sidecar déroule seul la micro-boucle audio** (wake → écoute → STT streaming → fin de tour → barge-in) et **émet au fil de l'eau**. Zéro aller-retour IPC sur le chemin critique.
- L'**orchestrateur décide à partir de `evt.turn.end`** : grille d'intentions (§3.1), état de conversation, cerveau, puis ordres de haut niveau redescendus.
- **Propriété de l'état d'écoute (B1)** : *l'état d'écoute est décidé par l'orchestrateur, exécuté par le sidecar.* La **seule** auto-transition du sidecar est le **tour de réveil** (§4.2), suivi d'une **écoute transitoire** (STT armé, délai de garde) jusqu'à `cmd.listen.start` ou `cmd.listen.stop`.
- **Horodatages (M2)** : le `ts` d'enveloppe (socle) = **émission**, monotone, uniforme `cmd.*`/`evt.*` ; les horodatages de **capture** voyagent **en payload** (`captured_at` ; les horodatages du tour sur `evt.turn.end`). La corrélation temporelle (critère 4) se fait sur les payloads de capture.
- Messages de la couche 1 (enveloppe = socle §2.1) :

  | Sens | Type | Rôle |
  |---|---|---|
  | ↓ | `cmd.listen.start` / `cmd.listen.stop` | Confirmer l'écoute active / retour veille (état, §4.1). **`start` prend effet rétroactivement** depuis la dernière marque VAD du tampon (B1) |
  | ↓ | `cmd.tts.speak` (id) · `cmd.tts.push` (segments) · `cmd.tts.end` · `cmd.tts.stop` | Énonciation streamée + purge (§4.4) |
  | ↓ | `cmd.tts.replay` | Rejoue la dernière énonciation (cache RAM ; **cache vide → erreur normalisée**, §4.4) |
  | ↓ | `cmd.tts.cache` | Pré-synthétise + met en cache les phrases de secours (F7). **Autorisation transitoire** : charge Kokoro → synthétise → décharge → retour au set résident (B2, §4.7) |
  | ↓ | `cmd.model.policy` | Set résident autorisé + réflexes armés (§4.5). **Remplace** l'exemple `cmd.model.load` du socle (même esprit, forme « politique ») |
  | ↓ | `cmd.enroll.push` · `cmd.shutdown` | *(socle)* empreintes (au boot **et à chaque respawn**, §4.8) · arrêt gracieux |
  | ↑ | `evt.wake` (confiance) | Nom détecté |
  | ↑ | `evt.vad.start` / `evt.vad.stop` | Parole dans la pièce (post-AEC) |
  | ↑ | `evt.stt.partial` / `evt.stt.final` | Transcription en flux / du tour |
  | ↑ | `evt.turn.end` (reason: `smart-turn`\|`fallback`, horodatages du tour) | Fin de tour — émetteur **unique** (§4.3) |
  | ↑ | `evt.bargein` (id énonciation, position, déclencheur: `wake`\|`voix`) | Interruption par la voix (interne sidecar, §4.4) |
  | ↑ | `evt.tts.start` / `evt.tts.done` (id) | Cycle d'énonciation |
  | ↑ | `evt.speaker` (locuteur, confiance) | Reconnaissance (A29 — détail doc `04`) |
  | ↑ | `evt.affect` (valence, énergie, confiance) | Capteur d'affect (§2.4) — **OFF par défaut** |
  | ↑ | `evt.model.loaded` / `evt.model.unloaded` (+ VRAM) | Remontée de résidence (§4.5) |
  | ↑ | `evt.health` | *(socle)* battement + anomalies (ex. allocation VRAM refusée) |

- **WS coupé** : le sidecar **n'improvise pas** — il boucle en écoute, la supervision du socle gère la reconnexion/le respawn ; seul filet local = phrases de secours (F7, §4.7).

### 2.3 Les prises interchangeables (01-F)

Chaque rôle = un **contrat** (opérations + événements normalisés) ; les moteurs sont des implémentations derrière.

| Rôle | Défaut | Alternatives (« avoir le choix ») |
|---|---|---|
| `wake` | tranché Phase 3 : LiveKit wakeword d'abord | openWakeWord · *(repli théorique payant : Porcupine)* |
| `vad` | Silero | — (standard de facto, A7) |
| `stt` | faster-whisper (GPU) | Deepgram cloud *(repli, OFF)* |
| `turn` | Smart Turn v3 (audio-first) | LiveKit turn-detector *(texte — la prise ne présume pas de la nature du moteur)* |
| `tts` | Kokoro (GPU) | Chatterbox · ElevenLabs *(premium, OFF, cost-guard)* |
| `speaker` | modèle Phase 3 (A29) | — |
| `affect` | emotion2vec *(OFF par défaut)* | wav2vec2-emotion |

- **Le moteur ne fuit jamais dans le protocole** : `evt.stt.partial` a la même forme quel que soit le moteur ; orchestrateur, cerveau et UI n'en savent rien.
- **Sélection par config au spawn** (env/settings, propriété de l'orchestrateur). Changer de moteur = config + **respawn supervisé** (socle) — **pas de hot-swap**.
- **Cloud (replis)** : clés transmises **par l'environnement au spawn** (jamais sur le WS), **absentes par défaut** (« pas d'API » — aucune clé requise pour démarrer). Chaque appel payant émet un événement de coût → **cost-guard dans l'orchestrateur** (plafonds, désactivation). **Échec du provider cloud → retour automatique au local + notification honnête** (jamais de silence).
- **Suite de conformité par contrat** : mêmes tests pour toute implémentation d'un rôle (s'écrit avec l'essai à blanc Phase 3) — comparer deux moteurs = brancher deux implémentations sur la même prise.

### 2.4 Le capteur d'affect (01-H — la prise, pas l'usage)

- **Consommateur du ring buffer**, CPU/intermittent (offload A35). **Une évaluation par tour** : à `evt.turn.end`, il analyse l'audio du tour écoulé et émet `evt.affect` **attaché à ce tour**. Pas d'analyse continue.
- **Payload = signal doux** : dimensions continues (valence, énergie) + **confiance**. **Jamais d'étiquette catégorielle** (« COLÈRE 73 % » interdit) — les seuils et l'usage vivent en doc `03`.
- **Verrouillé sur l'ancre vocale (A29)** : n'évalue que si le locuteur est **Yohann** (confiance speaker suffisante). Jamais d'affect sur un tiers (cohérent A31).
- **Muet dans le doute** : confiance basse (modèle **ou** locuteur) → **rien n'est émis** — une lecture fausse est pire que pas de lecture (piège paternaliste, conv 7).
- **OFF par défaut** : la prise (contrat + événement) est spécifiée ici ; le modèle n'est branché qu'à son essai à blanc (Phase 3), calibré sur la **ligne de base personnelle** de Yohann (via l'ancre A29), jamais un barème générique seul. `evt.*` étant extensible (socle), l'activation ne change pas le protocole.

---

## 3. Schémas de données

> La couche 1 **n'écrit rien de durable** : le sidecar est sans état durable (invariant socle) et l'écrivain unique du WAL est l'orchestrateur (F2 socle). Les « données » de cette couche sont : une grille de config versionnée + des caches RAM. *(Seule exception, portée par l'orchestrateur : le réglage de volume de la voix, persisté comme setting — S3.)*

### 3.1 La grille d'intentions (01-G — adresse naturelle, A32-étendu)

Config **versionnée de l'orchestrateur** (pas une table SQLite) — la grille reconnaît les intentions *système* sur le transcript final ; **tout le reste = conversation → cerveau**. Formes canoniques = la façon naturelle de parler de Yohann (politesse « s'il te plaît » de mise quand c'est cohérent) ; le mapping **tolère les variantes** (politesse présente/absente, ordre des mots, mots-outils).

| Intention | Forme canonique | États actifs (§4.1) | Effet · réponse canonique |
|---|---|---|---|
| Réveil / ouverture | « **Bonjour Sophia** » *(variante : « bonsoir Sophia » — cas de test obligatoire, §7)* | VEILLE | Conversation ouverte · « Bonjour Yohann » |
| Sollicitation | « **Dis-moi Sophia** [, demande] » | VEILLE | Écoute la demande · « oui Yohann ? » si rien ne suit |
| Demande directe à froid | « Sophia, [demande] » / « [demande], Sophia » | VEILLE | Répond/agit **d'un coup**, sans « oui ? » intermédiaire — le [demande] est **ré-évalué par la grille** une fois l'état ouvert (S5) |
| Interruption sèche | « **stop** » / « **chut** » | **Pendant la lecture TTS uniquement** | Purge l'énonciation en cours, **zéro appel cerveau** (S2) |
| Suspension courte | « **attends s'il te plaît** » | ÉCOUTE | Se tait, **garde le contexte**, reprend au rappel |
| Annulation | « **laisse tomber s'il te plaît** » | ÉCOUTE | Abandonne la requête en cours, reste à l'écoute |
| Pause | « merci Sophia » | ÉCOUTE | Attente (contexte gardé) → PAUSE |
| Clôture | « **bonne nuit Sophia** » / « merci Sophia, à bientôt » | VEILLE · ÉCOUTE · PAUSE | Retour veille · « Bonne nuit Yohann » |
| Rappel | « Sophia ? » / « reviens Sophia » | PAUSE · *(après retrait A32)* | Reprend la conversation |
| Replay | « **répète s'il te plaît** » | ÉCOUTE | Rejoue la dernière énonciation (§4.4) |
| Volume de sa voix | « **moins fort s'il te plaît** » / « **plus fort s'il te plaît** » | ÉCOUTE · pendant TTS | Gain de sortie côté sidecar ; **réglage persisté par l'orchestrateur** (écrivain unique) (S3) |
| Silencieux / voix | « passe en silencieux s'il te plaît » / « reprends le son s'il te plaît » | ÉCOUTE | Toggle réponse vocale — quand off, la réponse **s'affiche dans l'UI de Sophia**, elle n'est **jamais injectée** (B4) |
| Mode dictée | « **passe en dictée s'il te plaît** » | ÉCOUTE | Dictée universelle : injection au curseur de **l'application au focus, quelle qu'elle soit** (B4/§4.1) |
| Mode dev | « passe en dev s'il te plaît » | ÉCOUTE | **Cas particulier de la dictée** : met VS Code au focus, puis même mécanique (cahier) |
| Statut | « **tu es là Sophia ?** » | VEILLE · ÉCOUTE · PAUSE · DICTÉE | « Oui Yohann, je suis là » + état |
| Sessions | « nouvelle conversation » / « reprends la conversation d'hier » | ÉCOUTE | Navigation sessions (A13/A36) |
| Interrupteur proactif | « **laisse-moi tranquille côté propositions** » / « **reprends tes rondes** » | ÉCOUTE | Bascule ON/OFF du moteur proactif (doc `04` §2.4, conv 11) ; elle confirme + voyant systray |
| Kill-switch rêverie | « **suspends tes rêveries** » / « **reprends tes rêveries** » | ÉCOUTE | Ferme/rouvre le temps à elle (doc `05` §4.5, conv 12 — « clore, jamais arracher ») ; elle confirme + voyant |
| Approbation | « oui » / « non » / « vas-y » / « ok » / « go » / « fonce » | **APPROBATION seulement** | Valide/refuse l'action en attente |

- **Règles de la grille** :
  - **Match = énoncé entier normalisé** (S1) — normalisation bornée : politesse, mots-outils, ordre. Une forme canonique **incluse dans un énoncé plus long = non-match → cerveau** (qui peut proposer l'acte). Exemple gravé : « merci Sophia, c'est parfait, continue » → **cerveau**, pas PAUSE.
  - **Match → l'acte, d'un coup** (zéro appel cerveau, zéro latence) · **pas de match → cerveau** (le chemin normal de la conversation) · **match flou → cerveau, jamais d'action système**.
  - **« D'un coup » ≠ sans approbation** (S5) : l'adresse directe saute le « oui ? » intermédiaire, **jamais** la fenêtre APPROBATION des actes à conséquence (A26 intact).
  - **Transcript vide ou inintelligible → redemande honnête** (S4) : « Je n'ai pas compris, tu peux répéter s'il te plaît ? » — **zéro appel cerveau** (cahier : le silence = panne perçue).
  - **En MODE DICTÉE/DEV, la grille est réduite à une liste blanche** (S9) : statut · clôture · sortie de mode. **Tout le reste est injecté verbatim, jamais routé cerveau** — dicter « merci Sophia » écrit « merci Sophia », ne met pas en pause.
  - Les intentions contextuelles (« ok/go/fonce », « stop/chut ») sont **inertes hors de leur état** · la grille **reste minimale** — toute nouvelle entrée se justifie.
- **Supersession du cahier (B4, décision conv 8)** : l'« injection texte au curseur *systématique* » du cahier est **supersédée** — l'injection devient un **acte de dictée explicite** (mode dictée/dev) ; en conversation, **rien n'est jamais tapé** (le curseur est imprévisible : mot de passe, chat, terminal — un texte injecté au mauvais endroit est un acte à conséquence sans accord, contraire à l'esprit A26). Créer fichiers/dossiers/documents reste le **travail de Sophia** (canal A1, « un seul guichet ») — la dictée est là quand Yohann veut écrire **lui-même** dans une app.
- **Convention de parole** (décision Yohann, conv 8 — **gravée au persona, doc `03`**) : Sophia emploie le prénom (« Bonjour Yohann », « oui Yohann ? ») **chaque fois que c'est cohérent** — une manière d'être dosée par elle, pas un tic mécanique. Symétrie de la politesse de Yohann : deux personnes qui se parlent.

### 3.2 Caches RAM du sidecar (éphémères, reconstruits au respawn — §4.8)

| Cache | Contenu | Cycle de vie |
|---|---|---|
| Ring buffer | Audio brut post-AEC | Circulaire, taille = fenêtre pré-wake |
| Replay | **Une** énonciation (audio de la dernière) | Remplacée à chaque énonciation ; purgée à la clôture de session ; **vide après respawn** → `cmd.tts.replay` répond une erreur normalisée (« je n'ai plus l'audio ») |
| Phrases de secours (F7) | Audio pré-synthétisé des messages de panne | Généré au boot **et à chaque respawn** via `cmd.tts.cache` (autorisation transitoire, B2) |
| Empreintes locuteurs | Poussées via `cmd.enroll.push` (socle) | Au boot **et à chaque respawn** (§4.8) ; source de vérité = WAL orchestrateur |

---

## 4. Séquences / flux

### 4.1 Les états d'écoute (F5)

| État | Qui écoute | Ce qui porte |
|---|---|---|
| **VEILLE** | wake word + VAD (CPU, always-on) ; le tampon tourne | **Seul le nom « Sophia » réveille** (porté par une phrase, §4.2). Lignes de grille : réveil · sollicitation · demande directe · clôture · statut |
| **ÉCOUTE ACTIVE** | Tout : STT streaming, tour, speaker-ID, (affect) | **Tout transcript** passe par la grille puis, sans match, au cerveau. Le nom n'est plus requis |
| **PAUSE** | Comme VEILLE (fil de conversation gardé) | Seul le nom rappelle (« Sophia ? ») ; clôture et statut portent aussi. **La session Claude reste chaude (A36)** ; l'orchestrateur garde le fil ouvert — **rien n'est fermé, rien n'est résumé** (M3) |
| **MODE DICTÉE** | Comme ÉCOUTE, mais **injection au curseur de l'app au focus**, silencieuse (pas de voix) | Grille **réduite à la liste blanche** (S9) : statut · clôture · sortie de mode (« merci Sophia » / « tu es là Sophia ? » ramène la conversation). **Mode dev = cette dictée + mise au focus de VS Code** |
| **APPROBATION** | Fenêtre d'écoute dédiée à la confirmation | « oui / non / vas-y / ok / go / fonce » — inertes partout ailleurs |

- **Cycle de vie d'APPROBATION (S8)** : c'est un **sous-état de l'orchestrateur pendant ÉCOUTE** — le sidecar reste en écoute active, **rien ne lui est signalé**. Ouverture : une action à conséquence attend un accord (A26). Fermeture : match approbation (oui/non/…). **Non-match → cerveau, fenêtre maintenue** (« attends, explique d'abord » reste une conversation). **Timeout → refus par défaut + annonce honnête** (valeur = rubrique 7).
- **Propriété (B1)** : les transitions d'état sont décidées par l'orchestrateur (`cmd.listen.start/stop`) ; seule auto-transition sidecar = le tour de réveil (§4.2).

### 4.2 Le réveil à froid — réveil **rétroactif** (F1, 01-G)

Le nom arrive souvent **en fin de phrase** (« bonne nuit *Sophia* ») — au moment où le wake word tire, le tour est déjà fini ou presque. Séquence :

1. **VAD always-on marque le tampon** (débuts/fins de parole, même en veille — CPU négligeable).
2. `evt.wake` (le nom détecté) → le sidecar **rembobine** : début du tour = la marque VAD qui précède, **la phrase entière est dans le tampon** (y compris *avant* le nom — premier mot jamais amputé).
3. Le tour est **reconstruit rétroactivement** : l'audio déjà capté part au STT ; **si Yohann parle encore, le tour continue en direct** ; s'il est fini, `evt.turn.end` part immédiatement.
4. **Après ce tour de réveil, le sidecar reste en écoute transitoire** (B1) : STT armé, délai de garde, jusqu'à `cmd.listen.start` (confirme ÉCOUTE — **effet rétroactif** depuis la dernière marque VAD : rien de ce que Yohann dit entre-temps n'est perdu) ou `cmd.listen.stop` (retour VEILLE).
5. L'orchestrateur reçoit le transcript → **grille** : match (« bonne nuit Sophia » → clôture + « Bonne nuit Yohann ») **d'un coup, sans double-commande** ; sinon → conversation ouverte (`cmd.listen.start`) + cerveau.
6. En parallèle du wake : **prewarm Whisper** (réflexe armé, §4.5) + **ducking** (§4.6).

- **Sémantique d'`evt.wake` hors du cas nominal (S12)** : wake pendant un **tour déjà ouvert** = no-op (le tour est ouvert) · `evt.wake` reçu par l'orchestrateur en **ÉCOUTE** = ignoré (journalisé seul) · wake pendant la **lecture TTS** = barge-in immédiat (§4.4).
- **Détection douteuse en veille** (le nom entendu à la TV, malgré l'AEC — voix de la pièce ambiguë) : comportement **discret** — elle demande brièvement plutôt que d'agir (A19) ; seuils = rubrique 7.

### 4.3 Le tour de parole à chaud (01-C)

Machine à états **unique, dans le sidecar** — émetteur unique de `evt.turn.end` :

1. `evt.vad.start` **ouvre le tour** ; `evt.stt.partial` au fil de l'eau.
2. **Chaque début de silence = candidat de fin** → Smart Turn évalue l'audio du tour :
   - **confiant + court silence → `evt.turn.end` immédiat** (`reason: smart-turn`) — le cas nominal, vif ;
   - **pas confiant** → on attend ; **reprise de parole dans la fenêtre → candidat annulé, le même tour continue** (l'hésitation « euh… » ne coupe jamais la phrase en deux) ;
   - **plafond de silence atteint** (fallback configurable ~2–3 s, A6) → `evt.turn.end` quand même (`reason: fallback`).
3. `evt.stt.final` (transcript du tour) précède `evt.turn.end`, qui le référence + porte les horodatages du tour (payload, M2).
4. **Le plafond reste actif même si Smart Turn crashe** (dégradation douce : le tour finit au silence, jamais bloqué).

**Frontière gravée** : la fin de tour est **purement acoustique, jamais sémantique** — elle décide *que* Yohann a fini de parler ; *ce que ça veut dire* (« attends », « merci Sophia ») appartient à la grille (§3.1), sur le transcript.

### 4.4 La réponse parlée (01-D)

1. `evt.turn.end` → orchestrateur : **grille** (match → acte + phrase canonique) ou **cerveau** (stream).
2. **Énonciation streamée** : `cmd.tts.speak` (id) ouvre ; `cmd.tts.push` pousse le texte **au fil du stream du cerveau** ; `cmd.tts.end` clôt. Le sidecar **découpe en phrases** (prosodie naturelle — un TTS nourri en miettes chante faux), synthétise (Kokoro), **joue dès la première phrase prête** — Sophia parle pendant que Claude génère encore.
3. **File d'énonciations** (une seule joue) + `cmd.tts.stop` (purge). Cycle : `evt.tts.start` / `evt.tts.done`.
4. **Barge-in — interne au sidecar** (invariant socle), **modulé par le locuteur** (B3, A29 « l'ancre sert aussi le barge-in ») :
   - le **nom « Sophia » pendant la lecture** (`evt.wake`) = **coupure immédiate, sans condition de durée** — le wake word est l'interrupteur le plus fiable ;
   - la **voix reconnue de Yohann** (speaker-ID) coupe **vite** (seuil bas) ;
   - une **voix non reconnue** exige la **durée minimale** (anti-faux-barge-in — un raclement de gorge ne la fait pas taire) ; **échelle étendue en tablée — cran « proche consenti reconnu » (seuil modéré)** → doc `04` §4.9 (conv 11).
   Sur coupure : le sidecar **purge lui-même**, émet `evt.bargein` (id, position, déclencheur) ; le tour d'écoute est déjà ouvert. L'orchestrateur décide de la suite.
5. **Interruption sèche (S2)** : après un barge-in, si le transcript matche « stop » / « chut » → **purge confirmée, zéro appel cerveau** (la grille §3.1). Le seuil anti-faux-barge-in **ne doit pas avaler un mot bref porteur d'intention** (calibration, rubrique 7).
6. **Replay** : « répète s'il te plaît » → `cmd.tts.replay` rejoue le cache RAM — **zéro appel cerveau, zéro resynthèse**. **Cache vide** (respawn, clôture) → erreur normalisée : elle le dit honnêtement (« je n'ai plus l'audio »).
7. **Volume (S3)** : « moins fort / plus fort s'il te plaît » → gain de sortie appliqué par le sidecar, **réglage persisté par l'orchestrateur** (setting, écrivain unique).

### 4.5 La résidence des modèles côté voix (01-E)

- **Trois axes de politique, un seul émetteur (S7)** : le « set résident » dépend (1) du **mode voix** — groupe VEILLE (VEILLE/PAUSE) vs groupe CONVERSATION (ÉCOUTE/DICTÉE/APPROBATION) — **dérivé des états d'écoute par l'orchestrateur**, qui émet `cmd.model.policy` à chaque transition ; (2) des **calques du gouverneur** — SECOURS, **JEU** (retouche conv 12) — descendus via doc `05` ; (3) des **autorisations transitoires** explicites (`cmd.tts.cache`, B2). Groupe VEILLE → wake word + VAD seuls (CPU), GPU vide · groupe CONVERSATION → Whisper/Kokoro actifs · SECOURS → la frontière VRAM bascule. Les **relâchements** descendent de la même façon (retour veille → modèles en cache RAM).
- **Les réflexes chauds sont armés par la politique, tirés localement** (zéro aller-retour) : *wake → prewarm Whisper immédiat* (le ring buffer couvre les premières centaines de ms) · *`turn.end` → Kokoro monte pendant que le cerveau réfléchit* · *reprise de parole → Whisper remonte*. **Résidence alternée** (A35) : écouter et parler ne sont jamais simultanés ; l'inactif attend en **cache RAM** (32 Go — swap quasi instantané).
- **Remontée systématique** : `evt.model.loaded/unloaded` + occupation VRAM → gouverneur + voyant systray savent toujours ce qui est chargé.
- **Le sidecar ne dépasse jamais la politique reçue** (pas de chargement opportuniste — les autorisations transitoires sont explicites et se referment seules). **Allocation VRAM refusée → il dégrade et rapporte** (`evt.health`), jamais de crash silencieux.

### 4.6 Le ducking (F3 — armé par l'état)

- **VEILLE** : seul `evt.wake` déclenche la baisse des médias — parler à quelqu'un d'autre dans la pièce ne touche pas YouTube.
- **Conversation ouverte** (ÉCOUTE/APPROBATION) : `evt.vad.start` déclenche ; le volume remonte après la réponse.
- **TABLÉE (AT10, conv 13 — politique au doc `04` §4.9)** : armé par **sa voix et son nom seulement** (`evt.tts.start` + `evt.wake`) — le VAD ambiant ne duck jamais (les convives se parlent entre eux ; l'AEC loopback, F2, couvre déjà la compréhension).
- **MODE DICTÉE/DEV (S9)** : ducking **désarmé** — Sophia ne parle pas, et une musique en yo-yo pendant une dictée serait pénible ; l'AEC loopback (F2) protège déjà la qualité du STT.
- **Supersession du cahier (M4)** : F3 **supersède** le « dès que l'utilisateur parle, indépendamment de tout autre paramètre » du cahier — le ducking est armé par l'état, sinon barge-in fantôme et ducking oscillant (F2). Il reste **systématique et non désactivable dans son périmètre**, et **strictement orthogonal** au toggle voix — jamais conditionnés l'un à l'autre.
- Mécanisme côté **orchestrateur** (mixer Windows).

### 4.7 Panne du cerveau — jamais de silence total (F7)

- **Pré-synthèse (B2)** : au boot — **phase 5 du boot socle, après la readiness du sidecar, avant PRÊT** — et à chaque respawn (§4.8), l'orchestrateur envoie `cmd.tts.cache` : **autorisation transitoire** (charge Kokoro → synthétise les phrases de secours → décharge → retour au set résident de la politique). La **courte fenêtre sans filet** (avant la fin de la pré-synthèse) est assumée et couverte par le voyant systray.
- **Orchestrateur mort / WS coupé** pendant que Yohann parle : le sidecar, seul, joue la phrase de secours — ex. « Mon cerveau ne répond pas, je redémarre — un instant. » Règles (S11) :
  - **déclencheur unique = la fin du tour** (jamais au wake — sinon elle parlerait pendant que Yohann finit sa phrase, contre §4.2) ;
  - la phrase de secours est **exempte de barge-in** (courte, prioritaire — le message de panne doit être entendu) ;
  - **une fois par épisode de panne** — ensuite silence + **voyant systray** (socle) prend le relais, pas de répétition à chaque tour.
- Symétrique du boot dégradé du socle (`DÉGRADÉ_SANS_VOIX` : l'app vit sans oreilles/voix) — ici c'est la voix qui survit sans cerveau, honnêtement.

### 4.8 Respawn du sidecar — resynchronisation (S10)

Après tout respawn supervisé (socle §4.3), l'orchestrateur **resynchronise dans l'ordre** :

1. `cmd.model.policy` (la politique courante — un sidecar frais n'en a **aucune**) ;
2. `cmd.enroll.push` (empreintes locuteurs) ;
3. `cmd.tts.cache` (phrases de secours, autorisation transitoire B2).

- **Énonciations en vol au moment du crash = échec terminal** : leurs `evt.tts.done` n'arriveront jamais — l'orchestrateur les clôt, **pas de re-énonciation automatique**, notification honnête (« je te redis ça ? » est une décision de conversation, pas un réflexe).
- Les caches RAM repartent vides (replay → erreur normalisée §4.4 ; ring buffer se remplit seul).

---

## 5. Frontières & invariants

- **L'audio ne traverse jamais l'IPC** (socle) ; ring buffer et caches = **RAM sidecar uniquement** (jamais WAL).
- **Le sidecar est sans état durable** — tout se reconstruit au respawn par la **séquence de resynchronisation** (§4.8 : politique → empreintes → phrases de secours).
- **L'état d'écoute appartient à l'orchestrateur** (B1) ; seule auto-transition sidecar = le tour de réveil, suivi d'écoute transitoire.
- **Fin de tour = acoustique, jamais sémantique** ; **émetteur unique** de `evt.turn.end`.
- **Grille** : match = **énoncé entier normalisé** (S1) ; jamais d'action système sur match flou (le doute va au cerveau) ; intentions contextuelles inertes hors état ; en dictée, **liste blanche** (S9) ; grille minimale et versionnée.
- **L'injection au curseur n'existe qu'en dictée explicite** (B4) — en conversation, rien n'est jamais tapé nulle part.
- **Le moteur ne fuit jamais dans le protocole** (événements normalisés par rôle).
- **Aucune clé requise pour démarrer** ; providers payants OFF par défaut, coût rapporté, cost-guard orchestrateur.
- **Barge-in interne au sidecar, modulé par le locuteur** (B3) : le nom coupe immédiatement, la voix de Yohann coupe vite, une voix inconnue exige la durée minimale ; **elle ne se coupe jamais elle-même** (AEC référence = loopback sortie système **entière**, F2). La **phrase de secours est exempte de barge-in** (S11).
- **Affect** : muet si doute (modèle ou locuteur) · jamais d'étiquette catégorielle · jamais sur un tiers · usage en doc `03` seulement.
- **Ducking** systématique dans son périmètre (armé par l'état, F3 — supersède le cahier, M4), désarmé en dictée (S9), strictement orthogonal au toggle voix.
- **Une seule frontière VRAM** (socle/`05`) ; le sidecar ne dépasse jamais la politique de résidence (autorisations transitoires explicites uniquement, B2).
- **Priorité interactive absolue** (socle) — les réflexes voix servent l'échange en cours, jamais une tâche de fond.

---

## 6. Critères d'acceptation *(vérifiables — valeurs en rubrique 7)*

1. **Réveil** : « Bonjour Sophia » / « Dis-moi Sophia » depuis la pièce → détection + accueil (« Bonjour Yohann ») en < X ; faux réveils < Y/jour.
2. **Adresse naturelle d'un coup** : « bonne nuit Sophia » **à froid** → clôture directe, sans double-commande, **premier mot jamais amputé** (rembobinage §4.2 prouvé) ; **rien n'est perdu entre le tour de réveil et `cmd.listen.start`** (écoute transitoire rétroactive, B1).
3. **Fin de tour** : Smart Turn confiant → réponse enclenchée < X ms après la fin réelle · une hésitation ne coupe **jamais** la phrase en deux · le plafond tient **même si Smart Turn crashe**.
4. **Vivacité bout-en-bout** : premier mot audible < X s après `turn.end` ; la première phrase joue **avant** la fin de génération du cerveau.
5. **Barge-in** : « Sophia » pendant qu'elle parle → coupure **immédiate** ; la voix de Yohann → < X ms ; « stop » → purge **sans appel cerveau** · elle ne **se coupe jamais elle-même** (AEC loopback prouvée, médias inclus) · un bruit bref ne la fait pas taire.
6. **Replay** : « répète s'il te plaît » → rejoue à l'identique, **zéro appel cerveau, zéro resynthèse** ; cache vide → elle le dit honnêtement.
7. **Prises** : changer de moteur = config + respawn, **mêmes événements en sortie** ; la suite de conformité passe pour chaque implémentation ; **aucune clé requise pour démarrer**.
8. **Résilience** : kill du sidecar en pleine conversation → respawn supervisé + **resynchronisation complète** (§4.8 : politique, empreintes, phrases de secours), wake word de retour < X s, zéro perte d'état durable ; orchestrateur mort → **phrase de secours jouée une fois, en entier** (exempte de barge-in), puis voyant.
9. **Affect** : `evt.affect` **muet** si confiance basse ou locuteur ≠ Yohann ; jamais d'étiquette catégorielle nulle part.
10. **Grille** : match flou → cerveau, **jamais** d'action système ; une forme canonique **dans une phrase plus longue** → cerveau (« merci Sophia, c'est parfait, continue » ne met pas en pause) ; « ok/go/fonce » inertes hors fenêtre APPROBATION ; **timeout d'APPROBATION → refus par défaut + annonce**.
11. **Ducking** : les médias baissent dès la parole **en conversation** (au wake seul en veille, F3), remontent après, **désarmé en dictée**, **en tablée : à sa voix et à son nom seulement (AT10)** — strictement indépendant du toggle voix.
12. **Erreur d'oreille** : transcript vide/inintelligible → « Je n'ai pas compris, tu peux répéter s'il te plaît ? », **zéro appel cerveau**, jamais de silence.
13. **Dictée** : en mode dictée, « merci Sophia » dicté est **écrit, pas exécuté** (liste blanche prouvée) ; **hors dictée, rien n'est jamais tapé au curseur** (B4).

---

## 7. Points de calibration / preuve Phase 3

- **🔴 La preuve prioritaire** : moteur wake word (LiveKit ⇄ openWakeWord) sur **la qualité FR de « Sophia » porté par des phrases variées** (A8 + §4.2) + taux de faux réveils réel. **Tension signalée (F6)** : « Sophia » (2 syllabes) = cible acoustique plus courte que « Dis-moi Sophia » (4 syllabes distinctives, l'argument d'A8) → risque de faux réveils plus haut. **Repli nommé si la preuve échoue** : nom-en-phrase **à chaud seulement**, formules longues (« Bonjour Sophia » / « Dis-moi Sophia » / « bonne nuit Sophia ») à froid — l'adresse naturelle survit presque entière, seule la « demande directe à froid » se raidit. Entraînement avec la voix réelle de Yohann recommandé (A8).
- **AEC (M1 — le vrai dur)** : prérequis du barge-in **et** du réveil fiable en médias (F2). À prouver **tôt** : **alignement d'horloges micro/rendu** (le loopback WASAPI vit sur l'horloge du périphérique de rendu — dérive, resampling adaptatif, alignement à quelques ms) · **changement du périphérique de sortie par défaut** (casque branché → la référence change) · **flux WASAPI exclusifs** qui échappent au loopback · latence et résidu de l'annulation.
- **Fin de tour** : seuils (confiance Smart Turn, court silence, plafond, fenêtre de fusion d'hésitation) + **ratio `reason: fallback/smart-turn`** = jauge de santé du modèle en FR sur la voix de Yohann.
- **Barge-in modulé (B3)** : seuils par déclencheur (nom = immédiat ; voix reconnue = bas ; inconnue = durée minimale) — **le seuil ne doit pas avaler un mot bref porteur d'intention** (« stop », « Sophia »).
- **STT** : modèle Whisper (`medium` ⇄ `large-v3` int8), latence streaming réelle sur la RTX 2060, précision FR.
- **TTS** : Kokoro ⇄ Chatterbox **à l'oreille** (avec le timbre, A20) ; latence première phrase ; naturel de la découpe par phrases.
- **VRAM** (avec doc `05`) : co-résidence Whisper+Kokoro possible ou alternance stricte ; temps de swap RAM→VRAM ; coût du prewarm ; coût de l'autorisation transitoire `cmd.tts.cache` au boot.
- **Ring buffer** : taille de la fenêtre pré-wake (assez pour « bonne nuit Sophia » entier, marge comprise).
- **Écoute transitoire (B1)** : durée du délai de garde après le tour de réveil.
- **APPROBATION (S8)** : durée du timeout avant refus par défaut.
- **Speaker-ID** (A29) : modèle + seuil de confiance — conditionne le verrou de l'affect **et** la modulation du barge-in.
- **Affect** : emotion2vec sur la **ligne de base de Yohann** ; seuils de confiance d'émission ; coût CPU réel par tour.
- **Grille** : tolérance du mapping (variantes réelles de Yohann au quotidien) ; taux de faux matchs (doit tendre vers zéro — sinon la règle « flou → cerveau » se durcit) ; **cas de test obligatoire : « bonsoir Sophia » (ouverture) vs « bonne nuit Sophia » (clôture)** — la paire de faux match la plus dangereuse (S6).
- **Volume (S3)** : pas de réglage du gain (marches), bornes.
- **Far-field** : d'abord au **casque** (valide la *logique*), le rig multi-micros validera l'*acoustique* (beamforming/fusion — passe #5, ère matérielle).
- **Latence bout-en-bout mesurée** : wake → premier mot de réponse (le chiffre du critère de succès du cahier).
- **Phrases de secours (F7/S11)** : liste exacte des messages + déclencheurs précis (fin de tour sans orchestrateur · timeout) + durée de l'« épisode de panne ».
- **Trace des supersessions du cahier** (signalées, actées conv 8) : injection au curseur « systématique » → **dictée explicite** (B4) · ducking « à toute parole » → **armé par l'état** (F3/M4). Le cahier (`VISION.md`) reste gelé ; le présent doc + le journal font foi.
- **Retouche actée conv 13 (audit transversal solo — AT10, validée par Yohann)** : §4.6/critère 11 — le périmètre « armé par l'état » de F3 gagne la **tablée** : ducking à **sa voix + son nom seulement**, jamais au VAD ambiant (politique gravée au doc `04` §4.9 ; l'AEC loopback couvre la compréhension).

---

*Doc 01 — Pipeline vocal. Couvre A5–A9 + A32-étendu + affect vocal (part couche 1 d'A29/A35) + B4 (dictée) ; audit F1–F7 + audit croisé 2 agents (B1–B4/S1–S12/M1–M7) intégrés. Précède : `00-socle-process.md`. Suite : `02-memoire.md`.*
