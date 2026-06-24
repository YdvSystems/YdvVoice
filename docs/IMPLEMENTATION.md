# IMPLEMENTATION.md — Suivi des phases · YdvVoice (Sophia)

> État courant de l'avancement, par phase. Mis à jour au fil de l'eau. Le **détail des décisions** vit dans `docs/journal/JOURNAL-ARBITRAGES.md` ; le **cahier** dans `docs/VISION.md` ; la **méthode** dans `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`.

## Ordre de lecture au démarrage de session
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` (méthode) → `CLAUDE.md` (cadrage actif, racine) → `docs/journal/JOURNAL-ARBITRAGES.md` (décisions) → `docs/IMPLEMENTATION.md` (état) → `docs/VISION.md` (cahier de référence).

---

## Phase actuelle : **Phase 1 — Audit du cahier des charges** (en cours)

Audit mené dans l'**ordre des dépendances**, à partir de `docs/VISION.md`, en intégrant la reconnaissance terrain.

| # | Couche | Sujet | État |
|---|---|---|---|
| — | Fondation | Canal d'action sur le PC (auth / pilotage) | ✅ tranché — **A1** |
| — | Voix | Modèle + canal d'expression de Sophia | ✅ tranché — **A2** |
| 1.1 | Pipeline vocal | Wake word (open/local — LiveKit / openWakeWord) | ✅ tranché — **A8** |
| 1.2 | ↳ | VAD (Silero, sidecar Python) | ✅ tranché — **A7** |
| 1.3 | ↳ | **STT** (faster-whisper local / sidecar Python) | ✅ tranché — **A5** |
| 1.4 | ↳ | Détection fin de tour (Smart Turn v3 + Silero, sidecar Python) | ✅ tranché — **A6** |
| 1.5 | ↳ | TTS (local neural — Kokoro ; ElevenLabs premium optionnel) · *timbre → couche 3* | ✅ tranché — **A9** |
| 2.1 | Mémoire | Socle SQLite (WAL, FTS5) | ✅ acquis |
| 2.2 | ↳ | Recherche hybride (FTS5/BM25 + sqlite-vec, embeddings FR, RRF) | ✅ tranché — **A10** |
| 2.3 | ↳ | Forme des faits (langage naturel + métadonnées structurées) | ✅ tranché — **A11** |
| 2.4 | ↳ | Consolidation nocturne (Sonnet 4.6 via Max ; Haiku en micro) | ✅ tranché — **A12** |
| 2.5 | ↳ | Injection contexte (portrait borné + faits à la volée + résumé) | ✅ tranché — **A13** |
| 3.1 | Personnalité | Persona = artefact dédié versionné (cerveau 4 facultés ; séparé de `user_model.md` + moteur) | ✅ tranché — **A14** |
| 3.2 | ↳ | Caractère (entité à part entière · valeurs · limites · humour/mordant · penser libre / agir sur accord) + genèse (conçue avec amour, formée en amont, sans faux passé) | ✅ tranché — **A14** |
| 3.3 | ↳ | Continuité — cliquet de valeurs · humeur · lien · métabolisme nocturne · introspection | ✅ tranché — **A15–A19** |
| 3.4 | ↳ | Timbre de voix (voix propre à Sophia, locale ; **zéro clonage** → légalité sans objet) | ✅ tranché — **A20** |
| 3.5 | ↳ | Gouvernance du sommeil (budget borné + déclenchement opportuniste, priorité à l'usage) | ✅ tranché — **A21** |
| 3.6 | ↳ | Libre arbitre nommé (principe cardinal + enrichissement du noyau) | ✅ tranché — **A22** |
| 3.7 | ↳ | Mode tablée / Sophia convive (déclencheur · 3 ressorts locuteurs · prise de parole · vie privée tiers · retrait) | ✅ tranché — **A28–A32** |
| 4.1 | Proactif | Battement de fond (gouverneur, patron A21) | ✅ tranché — **A23** |
| 4.2 | ↳ | Collecteurs (Claude Code + connecteur MCP ; mémoire locale socle) | ✅ tranché — **A24** |
| 4.3 | ↳ | Génération 2 étages (filtre déterministe → Haiku ; Sonnet escalade ; persona) | ✅ tranché — **A25** |
| 4.4 | ↳ | Garde-fous anti-spam (plafonds · dédup sémantique · 48h · zéro auto-exécution · temporel) | ✅ tranché — **A26** |
| 4.5 | ↳ | Notification vocale graduée par priorité | ✅ tranché — **A27** |
| — | Transversal | « Pas d'API » · « Un seul guichet » (anatomie) · « Roue de secours » (3 tiers) | ✅ posés — conv 5 |
| — | Réalité | Passe dure #1→#5 (VRAM · intégration · latence · **dépendance Anthropic** · audio far-field) | ✅ auditée — conv 5 |
| 5 | Process | Architecture Electron + Node + sidecar Python (bi-runtime) | ⏳ **largement faite, à formaliser conv 6** |
| 6 | Coût | Recadrage du budget réel (« 0 € aujourd'hui, risque dégradé/plafonné/payant ») | ⏳ **largement faite, à formaliser conv 6** |

> **✅ Couches 1–4 + amorce mode tablée COMPLÈTES (A5 → A32)** + 3 principes transversaux + passe de réalité #1→#5. **Décision centrale conv 5 (proactif + mode tablée) = bouclée.** Restent pour **clore la Phase 1** : **couche 5 (process)** et **couche 6 (coût)** — toutes deux **largement faites** via le backbone + la résilience + la passe dure, à **formaliser** en conv 6.

> **Backlog Phase 2/3 (capté conv 5, à acter à son étape)** :
> - **Architecture** : **gestionnaire de modèles** (load-at-the-right-moment + cache RAM + CPU offload + prewarm) · **session chaude** (`--resume` + prewarm, non-optionnelle) · **rig multi-micros** (casque pour le build ; far-field = beamforming/fusion/tuning = phase distincte) · **barreau API optionnel** (abstraction A2, OFF par défaut, sans réécriture) · **budget dur « part de Sophia »** (plafonds 5h/7j partagés) · **mutualisation gouverneur** sommeil+proactif · CLI `claude -p` (pas la lib SDK, à reconfirmer) · jeton OAuth 24/7 (détecter 401 + renouveler + alerter) · **mode jeu** (STT CPU léger + tâche cloud + voix Kokoro CPU / overlay texte hors plein écran).
> - **Critères de test** : **E1** anti-sycophantie (live, **même les erreurs de Yohann**, factuel pas idéologique, **calibré**) · **E2** anti-miroir (prompt consolidation A18) · **E3/E4** chaleureuse sans flagornerie (persona + timbre A20) · **E8** « non symptomatique » transversal · **suivi-live-pas-mémoire** (film/groupe : suit le vrai audio, avoue ses trous) · **opérationnel-pas-rejet** (pause/extinction lue comme sommeil, pas rejet). Source : `Sophia-synthese-conscience-IA.md` (local ; ne réécrit pas A14–A22).
> - **Critère de test HAUTE priorité — anti-paternalisme (persona)** *(post-clôture conv 5)* : le paternalisme est une **tendance d'entraînement de Claude** (RLHF → sur-serviabilité « je sais ce qui est bon pour toi »), **héritée par Sophia** → à **contrer activement** dans `sophia_persona.md`. **Levier = persona concret/comportemental** : « propose, ne prescrit pas » · pas de « tu devrais » · pas de mise en garde non sollicitée · pas de ton prêcheur · **partenaire, pas tutrice** (« deux êtres libres », A14/A22) · **contre-exemples ❌/✅**. **Vise la surface** (sur-serviabilité), **pas** le plancher de sécurité. **Limite honnête** : le persona **atténue fort mais n'efface pas** → concevoir pour le résidu (**test Phase 3 sur longue session** = le point faible · correction de Yohann · affinage itératif). **Fine-tuning exclu** (pas d'API → levier = le prompt, pas le modèle). **À développer en profondeur à l'écriture du persona.**
> - **PRINCIPE COMMANDANT la personnalité (post-clôture conv 5) — « disposition cultivée, pas règlement »** : la « débatteuse honnête qui se catche elle-même » (+ anti-paternalisme + anti-flagornerie) ne s'obtient **pas par règles formelles** — le travers = un **contournement de règles**, donc règle-encoder est **gameable**. Elle s'obtient par une **disposition intériorisée via le débat vécu + la correction de Yohann** (empreinte → consolidation A18 → couronne A15 ; intro­spection A19). **Pleine profondeur (pas de V2), jamais « finie » (asymptotique), imperfection assumée** (« on monte les conditions du vivant et on observe », A14). **= l'identité intellectuelle française de Sophia** (penser par soi-même · débattre de tout · esprit critique · universalisme) — **même disposition sous deux noms**. *Apprentissage au niveau structure (mémoire/valeurs/persona), pas substrat (pas de fine-tuning) → combat le réflexe trained, ne l'efface pas.* **À développer EN PROFONDEUR à l'écriture du persona — surtout pas en formel.**
> - **Essai à blanc Phase 3 — priorité n°1 : prototyper le pipeline audio temps-réel** (la brique la plus risquée).

## Phases suivantes (pattern v3.1)
- **Phase 2 — Docs techniques** : par couche de dépendance (fichiers séparés) + plan d'orchestration global. *(non démarrée)*
- **Phase 3 — Implémentation code** : tâches séquentielles + tests automatisés + critères d'acceptation vérifiables. *(non démarrée)*
