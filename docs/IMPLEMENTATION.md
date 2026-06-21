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
| 1 | Pipeline vocal | STT, VAD, détection fin de phrase, wake word, TTS | ⏳ à venir |
| 2 | Mémoire | SQLite épisodique + sémantique (FTS5), consolidation nocturne | ⏳ à venir |
| 3 | Proactif | Moteur proactif + garde-fous anti-spam | ⏳ à venir |
| 4 | Process | Architecture Electron + Node + sidecar Python (bi-runtime) | ⏳ à venir |
| 5 | Coût | Recadrage du budget réel (« ~5 $/mois ») | ⏳ à venir |

## Phases suivantes (pattern v3.1)
- **Phase 2 — Docs techniques** : par couche de dépendance (fichiers séparés) + plan d'orchestration global. *(non démarrée)*
- **Phase 3 — Implémentation code** : tâches séquentielles + tests automatisés + critères d'acceptation vérifiables. *(non démarrée)*
