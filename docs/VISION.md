# YdvVoice — Sophia

## Identité du projet

**Sophia** est un assistant vocal personnel, complet, 100 % mains-libres, basé sur Claude.
L'utilisateur parle naturellement depuis n'importe où dans la pièce. Sophia écoute, comprend,
répond à l'oral, et agit sur le bureau — sans clavier, sans souris, jamais.

Projet solo. Développeur : Yohann Dandeville (YdvSystems). Pattern : standard.
Coût mensuel : ~5$/mois (ElevenLabs uniquement). Abonnement Claude Max existant utilisé.

---

## Principe de construction

**Un seul produit, fait bien, dans l'ordre.** Pas de version au rabais, pas de "V2".
Chaque capacité est dans le produit — on cadre sa *forme* (profondeur), pas son existence.
L'ordre de construction suit la logique des dépendances, pas des priorités commerciales.
Ce qui nécessite du matériel physique (Pi, ESP32) se construit quand le matériel est là.
Le logiciel est architecturé pour l'accueillir dès le départ — zéro réécriture.

---

## Séparation des outils

- **VS Code + Claude Code** : environnement de dev, construction des projets, contrôle total du code.
- **Sophia** : assistant de vie numérique pour tout le reste. Tâches périphériques, marketing,
  organisation, recherche, posts LinkedIn, prospection, gestion fichiers, navigation bureau.
  Sophia est la couche vocale. La flotte Claude est le cerveau d'action.

---

## Architecture : front vocal rapide + flotte Claude

**Constat clé** : le streaming accélère les oreilles (STT) et la bouche (TTS), jamais le cerveau.
Les surfaces Claude agentiques réfléchissent puis agissent — elles sont lentes par nature.

**Solution** : un front vocal rapide en première ligne, qui répond instantanément au dialogue
courant et aiguille vers la bonne surface selon l'intention. Quand il aiguille vers une surface
lente, il accuse réception à l'oral immédiatement ("ok, je lance ça…") pendant qu'elle travaille.

**Flotte Claude** (couverte par l'abonnement Max) :
- **Cowork** → bureau, fichiers, navigation desktop, tâches périphériques.
- **Claude Code** → dev, terminal. Seule surface réellement programmable (SDK agent) —
  bridge propre et robuste, pas du scraping d'UI.
- **Claude-navigateur** → web.

Cowork et Claude-navigateur = pilotage d'interface (agentique, plus fragile que l'API).
Le logiciel inclut une veille automatique pour détecter les ruptures d'interface (voir § Résilience).

---

## Pipeline vocal : streaming bas-latence

Non négociable. C'est ce qui rend la conversation vive.

- **Silero VAD** : détection d'activité vocale, filtre les sons parasites en temps réel.
- **STT streaming** (Whisper ou équivalent) : transcription en flux, résultats intermédiaires.
- **Détection de fin de phrase** : analyse syntaxique (spaCy FR) pour déclencher l'envoi quand
  l'utilisateur a réellement fini de parler, pas au premier silence. Fallback silence 3s.
- **TTS chunké** (ElevenLabs) : premier chunk court envoyé avant la fin de génération.
- **Barge-in** : l'utilisateur peut interrompre Sophia en parlant.
- **Prewarm** : les connexions sont préchauffées pour réduire la latence au premier mot.

Architecture multi-source : le logiciel accepte un micro unique ou un réseau de micros
(Raspberry Pi + ESP32 WiFi) sans réécriture. Le rig matériel se branche quand il est prêt.
Le serveur LiveKit self-hosted (open-source, gratuit) sera activé avec le rig multi-micros
(transport WebRTC multi-points). Le sidecar Python ↔ orchestrateur Node communique via
localhost HTTP + SQLite WAL (patron prouvé).

---

## Mémoire : épisodique + sémantique, consolidée la nuit

SQLite (better-sqlite3, WAL, FTS5) — même patron qu'un précédent interne.

**Épisodique** : table `conversations`, historique brut immuable, horodaté.

**Sémantique** : table `facts` (subject, predicate, object, category, confidence, importance,
decay_policy, valid_from/valid_to). Vocabulaire fermé (réduit les hallucinations).
Relation `SUPERSEDES` : on remplace, on ne supprime jamais.
Retrieval : BM25 × importance × récence × confidence + décroissance par demi-vie.
FTS5 natif — pas d'embeddings (inutiles à ce stade).

**Consolidation nocturne** (AutoDream, 3h du matin, node-cron) :
- Phase micro (après chaque échange, fire-and-forget) : mise à jour `user_model.md`.
- Phase deep (nocturne) : synthèse des 5 dernières sessions → réécriture `user_model.md` →
  ingestion batch dans `facts` → régénération du miroir.
- `user_model.md` est injecté en contexte à chaque conversation.

**Navigation entre sessions** :
- URLs de conversation Cowork stockées en SQLite avec horodatage.
- Résumé des N derniers échanges injecté en contexte à chaque nouvelle conversation (N = MAX_HISTORY_MESSAGES, défaut 20).
- Commandes vocales : "nouvelle conversation", "reprends la conversation d'hier".

---

## Moteur proactif

Sophia prend des initiatives sans qu'on les demande. C'est un cœur du logiciel, pas un bonus.

Boucle de fond (~30 min) : collecteurs (agenda + mails + mémoire/tâches) → génération
d'initiatives → notification vocale. Périmètre : 2-3 collecteurs, pas les 6 de Jarvis.

**Garde-fous anti-spam** (repris de Jarvis-OS) :
- Plafond d'initiatives actives (max 5, max 2-3 HIGH).
- Déduplication Jaccard 70%.
- Règle 48h : action sous 48h sinon c'est une observation, pas une initiative.
- **Zéro auto-exécution** : Sophia propose et notifie, elle n'agit jamais à conséquence
  réelle sans accord explicite de l'utilisateur (cohérent avec l'approbation vocale).

---

## Approbation vocale

Les surfaces Claude ont leurs propres confirmations, pensées pour le clic.
En voix-only, Sophia détecte ces confirmations et les relaie à l'oral :
"Cowork veut faire X, je valide ?" → "oui" → elle clique pour toi.
Mode pré-autorisé possible pour les actions de confiance répétées.

**Retour audio d'état obligatoire** : en voix-only, le silence = panne perçue.
"Ok, je lance ça…", "je réfléchis", "c'est fait" sont l'interface, pas des options.

---

## Cost-guard et audit

- Estimation de coût avant chaque appel payant (ElevenLabs, STT, LLM front).
- Plafond session/jour. Alerte vocale non bloquante ("doctrine warnings pédagogiques").
- Audit JSONL append-only de toutes les actions déclenchées.

---

## Commandes vocales

| Commande | Action |
|---|---|
| "Dis-moi Sophia" | Activation, écoute active |
| "Merci Sophia" | Pause, reste active en attente |
| "Merci Sophia, à bientôt" | Clôture complète, retour en veille |
| "Dis-moi Sophia, tu es là ?" | Retour mode conversation + statut système |
| "Dis-moi Sophia, passe en dev s'il te plaît" | Mode dev, dictée silencieuse VS Code |
| "Répète" | Replay dernière réponse audio (cache local) |
| "Mode silencieux" | Coupe la réponse vocale (toggle off) |
| "Reprends le son" | Rétablit la réponse vocale (toggle on) |
| "Nouvelle conversation" | Ouvre une nouvelle session Cowork |
| "Reprends la conversation d'hier" | Recharge l'URL SQLite correspondante |

**Détection clôture** : Porcupine détecte "Merci Sophia". Whisper écoute 2-3s la suite.
"à bientôt" présent → clôture. Sinon → pause. Latence acceptable sur commande non critique.

---

## Modes de fonctionnement

**Mode conversation (défaut)**
Sophia connectée à Cowork. Front vocal rapide en première ligne. Réponse vocale active
si toggle on. C'est le mode normal, humain, quotidien.

**Mode dev**
"Dis-moi Sophia, passe en dev s'il te plaît" → Sophia met Cowork en arrière-plan,
VS Code prend le focus. Sophia passe en dictée silencieuse uniquement : elle transcrit
et injecte au curseur VS Code, sans parler. Le toggle audio est ignoré en mode dev.
Sophia confirme : "Je passe en mode dev." puis silence.

**Retour mode conversation**
"Dis-moi Sophia, tu es là ?" depuis n'importe quel mode → Sophia répond "Oui, je suis là"
+ état actuel, et reprend le mode conversation complet.

---

## Comportements systématiques

### Ducking audio — SYSTÉMATIQUE ET NON DÉSACTIVABLE
Le volume des médias (YouTube, musique, vidéos) baisse dès que l'utilisateur parle,
indépendamment de tout autre paramètre. Il remonte après la réponse.
Mécanisme orthogonal au toggle audio — jamais conditionnés l'un à l'autre.

### Toggle réponse vocale
- **A — Raccourci clavier global** (Ctrl+Shift+M) : bascule immédiate sans parler.
- **B — Commandes vocales** : "mode silencieux" / "reprends le son".
- **Bouton UI** : état visible en permanence.
Quand off : injection texte au curseur uniquement, réponse TTS désactivée.
Le moteur proactif et la mémoire continuent de tourner indépendamment.
Quand on : comportement complet, Sophia répond à l'oral.

### Injection texte au curseur
Le texte transcrit est injecté à l'endroit où se trouve le curseur système.
Fonctionne dans VS Code, navigateur, n'importe quel champ. Via robotjs ou uiohook-napi.
Action systématique, indépendante du toggle.

### Replay
"Répète" : ElevenLabs rejoue le dernier buffer audio sans rappeler Cowork.
Cache en mémoire (session uniquement, pas en SQLite).

---

## États du système

```
VEILLE        → Porcupine écoute "dis-moi Sophia" uniquement (local)
               → node-cron : consolidation 3h, health check dimanche 4h
ACTIVATION    → "Dis-moi Sophia" détecté, ducking ON, indicateur visuel actif
               → Vérification Claude Desktop présent (alerte si absent)
ÉCOUTE        → Silero VAD actif, STT streaming actif
ANALYSE       → spaCy FR détecte fin de phrase (fallback silence 3s)
FRONT VOCAL   → Front rapide traite l'intention
               → Dialogue courant → réponse instantanée
               → Action demandée → accusé oral + aiguillage surface Claude
TRAITEMENT    → Injection texte au curseur (systématique)
               → Si toggle ON : envoi surface Claude, réponse récupérée
RÉPONSE       → TTS chunké joue (si toggle ON), ducking OFF après
PAUSE         → "Merci Sophia" détecté, Whisper écoute 2-3s
               → "à bientôt" → CLÔTURE
               → Sinon → retour ACTIVATION en attente
CLÔTURE       → "Merci Sophia à bientôt", retour VEILLE
MODE DEV      → VS Code focus, dictée silencieuse, toggle ignoré
               → "Tu es là ?" → retour MODE CONVERSATION
APPROBATION   → Surface Claude demande confirmation
               → Sophia relaie à l'oral, attend "oui" / "non"
PROACTIF      → Initiative détectée → notification vocale
               → Zéro auto-exécution sans accord
```

---

## Résilience et veille

**Sophia tourne en tâche de fond permanente** (PC toujours allumé, systray).

**Test automatique hebdomadaire** (dimanche 4h du matin) :
Sophia envoie une phrase test à Cowork et vérifie la réponse. Si échec : alerte vocale
au prochain wake word : "L'intégration Cowork a peut-être changé, vérifie."

**Veille changelog Anthropic** (hebdomadaire) :
Scraping RSS ou page dédiée. Signal d'anticipation avant rupture d'interface.

Les deux combinés : anticipation + détection. L'usage quotidien reste le détecteur primaire.

---

## Stack technique

| Composant | Technologie |
|---|---|
| Interface desktop | Electron + React |
| Wake word | Porcupine (Picovoice) local |
| VAD | Silero VAD |
| STT streaming | Whisper streaming (whisper.cpp ou API) |
| Détection fin de phrase | spaCy FR + fallback silence 3s |
| Front vocal rapide | LLM véloce (décision ouverte : API sidecar ou Node natif) |
| Injection texte | robotjs ou uiohook-napi |
| Flotte Claude | Cowork + Claude Code + Claude-navigateur (via Max) |
| Approbation vocale | Détection confirmations + relay oral |
| TTS | ElevenLabs API (voix féminine FR, prénom Sophia) |
| Ducking audio | windows-audio-mixer (Node.js) |
| Détection fenêtre active | active-win (Node.js) |
| Mémoire épisodique | SQLite better-sqlite3 (WAL, FTS5) |
| Mémoire sémantique | Table facts + FTS5 BM25 |
| Consolidation nocturne | node-cron 3h |
| Moteur proactif | Boucle fond + collecteurs + garde-fous |
| Cost-guard | Estimation avant appel payant + plafond |
| Audit | JSONL append-only |
| Health check | node-cron dimanche 4h |
| Multi-micros (matériel) | Raspberry Pi 4 + ESP32 MEMS WiFi |
| Transport multi-micros | Serveur LiveKit self-hosted (open-source) |
| Sidecar Python ↔ Node | localhost HTTP + SQLite WAL |

---

## Schéma SQLite

```sql
-- Épisodique
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  cowork_url TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  surface TEXT, -- 'cowork' | 'claude-code' | 'navigator' | 'front'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Sémantique
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  category TEXT,
  status TEXT DEFAULT 'ACTIVE',
  confidence REAL DEFAULT 1.0,
  importance REAL DEFAULT 0.5,
  support_count INTEGER DEFAULT 1,
  decay_policy TEXT DEFAULT 'standard',
  valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
  valid_to DATETIME
);

CREATE VIRTUAL TABLE facts_fts USING fts5(
  subject, predicate, object, content=facts
);

CREATE TABLE fact_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_fact_id INTEGER,
  relation TEXT, -- 'SUPERSEDES' etc.
  to_fact_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Système
CREATE TABLE health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK(status IN ('ok', 'failed')),
  detail TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  surface TEXT,
  cost_usd REAL,
  approved_by TEXT, -- 'user' | 'auto'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE initiatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  priority TEXT CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH')),
  status TEXT DEFAULT 'PENDING',
  source TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Variables d'environnement

```env
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
PICOVOICE_ACCESS_KEY=
ASSISTANT_NAME=Sophia
WAKE_WORD=dis-moi-sophia
PAUSE_WORD=merci-sophia
STOP_WORD=merci-sophia-a-bientot
REPLAY_COMMAND=répète
VOICE_STOP_COMMAND=mode silencieux
VOICE_AUDIO_ON_COMMAND=reprends le son
VOICE_DEV_MODE_COMMAND=passe en dev
VOICE_STATUS_COMMAND=tu es là
AUDIO_TOGGLE_SHORTCUT=Ctrl+Shift+M
WHISPER_MODEL=small
MAX_HISTORY_MESSAGES=20
DUCK_VOLUME=20
SILENCE_FALLBACK_MS=3000
COWORK_INPUT_SELECTOR=
HEALTH_CHECK_HOUR=4
HEALTH_CHECK_DAY=sunday
CONSOLIDATION_HOUR=3
COST_GUARD_SESSION_USD=0.50
COST_GUARD_DAY_USD=2.00
PROACTIVE_INTERVAL_MIN=30
PROACTIVE_MAX_INITIATIVES=5
# Credentials collecteurs proactifs (à configurer selon les collecteurs activés)
GOOGLE_CALENDAR_CREDENTIALS=   # chemin vers credentials.json Google
GOOGLE_GMAIL_CREDENTIALS=      # chemin vers credentials.json Google (peut être le même)
```

---

## Structure fichiers

```
ydv-voice/
├── CLAUDE.md                    # Contexte projet pour Claude Code
├── IMPLEMENTATION.md            # Suivi phases et état courant
├── .env
├── .env.example
├── package.json
├── electron/
│   ├── main.ts                  # Process principal Electron
│   └── preload.ts               # Bridge sécurisé contextIsolation
├── src/
│   ├── App.tsx                  # Interface principale
│   ├── components/
│   │   ├── VoiceButton.tsx      # Indicateur état système
│   │   ├── AudioToggle.tsx      # Toggle réponse vocale
│   │   └── Transcript.tsx       # Affichage conversation
│   ├── services/
│   │   ├── porcupine.ts         # Wake word detection
│   │   ├── vad.ts               # Silero VAD
│   │   ├── stt.ts               # STT streaming + détection fin de phrase
│   │   ├── front.ts             # Front vocal rapide + aiguillage
│   │   ├── inject.ts            # Injection texte curseur (robotjs)
│   │   ├── cowork.ts            # Pilotage Cowork via simulation UI
│   │   ├── claude-code.ts       # Pilotage Claude Code (SDK/non-interactif)
│   │   ├── approval.ts          # Approbation vocale + relay oral
│   │   ├── tts.ts               # ElevenLabs chunké + cache replay
│   │   ├── audio-duck.ts        # Ducking systématique
│   │   ├── audio-toggle.ts      # Toggle + raccourci global
│   │   ├── memory.ts            # SQLite épisodique + sémantique
│   │   ├── consolidation.ts     # AutoDream nocturne (node-cron 3h)
│   │   ├── navigation.ts        # Navigation sessions + résumé contexte
│   │   ├── proactive.ts         # Moteur proactif + garde-fous
│   │   ├── cost-guard.ts        # Estimation coût + plafond + alerte
│   │   ├── audit.ts             # JSONL append-only
│   │   └── health.ts            # Health check + veille changelog
│   └── store/
│       └── state.ts             # État global système
├── db/
│   └── schema.sql
├── sidecar/                     # Process Python (si voie LiveKit/spaCy)
│   ├── voice_agent.py
│   └── requirements.txt
└── resources/
    └── wake-word/               # Modèles Porcupine custom
```

---

## Démarrage à froid

Au premier lancement, aucune session, aucun user_model.md, aucun fact.
Sophia se présente à l'oral : "Bonjour, je suis Sophia. C'est notre première conversation."
Le user_model.md est créé vide. La consolidation nocturne le remplira après la première journée.
Les tables SQLite sont initialisées au démarrage si elles n'existent pas.
Sophia est opérationnelle immédiatement, sans configuration manuelle.

---

## Gestion des erreurs vocales

En voix-only, le silence = panne perçue. Chaque erreur a une réponse audio explicite.

| Situation | Réponse de Sophia |
|---|---|
| ElevenLabs indisponible | "Je ne peux pas parler en ce moment, vérifie ta connexion." |
| STT échoue ou timeout | "Je n'ai pas compris, tu peux répéter ?" |
| Cowork ne répond pas | "Cowork ne répond pas, je réessaie dans un instant." |
| Claude Desktop absent | "Claude Desktop n'est pas ouvert, je ne peux pas agir sur le bureau." |
| Cowork change d'interface (health check) | "L'intégration Cowork a peut-être changé, vérifie." |
| Plafond de coût atteint | "J'ai atteint le plafond de dépenses de la session." |
| Collecteur proactif échoue | Silencieux — l'erreur est loggée, pas remontée à l'oral. |

Principe : toute erreur qui impacte l'utilisateur est annoncée vocalement.
Toute erreur silencieuse est loggée dans l'audit JSONL.

## Points d'attention pour Claude Code

- **Electron sécurité** : contextIsolation + preload.ts obligatoires. Clés API jamais dans le renderer.
- **Prérequis Claude Desktop** : vérifier au démarrage que le process est actif (pslist ou équivalent). Alerte vocale si absent : "Claude Desktop n'est pas ouvert."
- **Cowork simulation** : sélecteur DOM stocké dans COWORK_INPUT_SELECTOR (.env). Corrigeable sans toucher au code si Anthropic change l'UI.
- **Claude Code** : seule surface programmable proprement (SDK non-interactif). Bridge robuste, pas de scraping.
- **robotjs** : rebuild natif nécessaire selon version Node/Electron. Vérifier en premier. Alternative : uiohook-napi.
- **Ducking audio** : windows-audio-mixer = Windows only. Fallback no-op sur macOS/Linux pour ne pas bloquer le build.
- **Variables d'environnement** : VOICE_AUDIO_ON_COMMAND correspond à "reprends le son" (toggle on). VOICE_STOP_COMMAND correspond à "mode silencieux" (toggle off). Ne pas confondre avec STOP_WORD qui est la clôture complète.
- **spaCy FR** : Python. Intégrer via python-shell ou FastAPI local (sidecar/). Isoler dans stt.ts.
- **Silero VAD** : intégrer avant STT streaming. Seuil configurable.
- **Barge-in** : interrompre le TTS en cours si wake word détecté. Gérer le buffer audio proprement.
- **Prewarm** : préchauffer les connexions ElevenLabs et STT au démarrage de l'app.
- **TTS chunké** : ne pas attendre la fin de génération pour jouer le premier chunk.
- **Ducking et toggle** : deux mécanismes strictement séparés, jamais conditionnés l'un à l'autre.
- **Cache replay** : Buffer audio en mémoire dans tts.ts. Session uniquement, pas en SQLite.
- **cowork_url** : stocker dès le premier échange même si la navigation vocale n'est pas encore active.
- **Consolidation nocturne** : node-cron à 3h. Un seul appel LLM par session pour la synthèse. FTS5 suffit, pas d'embeddings.
- **Moteur proactif** : zéro auto-exécution sans accord explicite. Garde-fous anti-spam non négociables.
- **Audit JSONL** : append-only, jamais de modification ou suppression.
- **Health check** : alerte vocale au prochain wake word si dernier check échoué.
- **Reconnaissance du locuteur** : décision ouverte. Faisable, à trancher avant build.
- **Front vocal rapide** : décision ouverte (LLM API sidecar vs Node natif). À trancher avant build.
- **STT** : décision ouverte (whisper.cpp local vs Deepgram cloud). À trancher avant build.

---

## Critère de succès

L'utilisateur dit "Dis-moi Sophia" depuis n'importe où dans la pièce, parle naturellement,
et Sophia répond instantanément pour le dialogue courant ou aiguille vers la bonne surface
Claude pour agir sur le bureau. YouTube baisse pendant l'échange. La mémoire se consolide
chaque nuit. Le dimanche à 4h, Sophia vérifie silencieusement que tout fonctionne.
Sans jamais toucher au clavier ni à la souris.
