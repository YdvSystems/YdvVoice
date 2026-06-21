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
| 3.3 | ↳ | Continuité dans le temps (cohérence via mémoire + facultés) | ⏳ à venir |
| 3.4 | ↳ | Timbre de voix + légalité du clonage (CGU ElevenLabs + droit FR) | ⏳ à venir |
| 4 | Proactif | Moteur proactif + garde-fous anti-spam | ⏳ à venir |
| 5 | Process | Architecture Electron + Node + sidecar Python (bi-runtime) | ⏳ à venir |
| 6 | Coût | Recadrage du budget réel (« ~5 $/mois ») | ⏳ à venir |

## Phases suivantes (pattern v3.1)
- **Phase 2 — Docs techniques** : par couche de dépendance (fichiers séparés) + plan d'orchestration global. *(non démarrée)*
- **Phase 3 — Implémentation code** : tâches séquentielles + tests automatisés + critères d'acceptation vérifiables. *(non démarrée)*
