# CLAUDE-HISTORY.md — Cumul historique forensique · YdvVoice (Sophia)

> Fichier **cumulatif**, **jamais auto-ingéré** par Claude Code. Reçoit tout le contenu incrémental retiré de `CLAUDE.md` actif (qui, lui, reste stable ~500 L par **REMPLACEMENT IN PLACE strict**). Croissance libre, zéro impact sur le contexte de session.

## Convention — 4 sections cumulatives (alimentées en fin de chaque conversation)
1. Archives « Pour démarrer convN+1 »
2. Historique des versions (footers vN)
3. États actuels successifs (anciennes têtes de `CLAUDE.md`)
4. Snapshots des motifs héritiers / compteurs

---

## Section 1 — Archives « Pour démarrer convN+1 »

### Archivé fin conv 2 (était la cible d'ouverture conv 2)
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md`.
- Reprise audit Phase 1 : **couche 1 — pipeline vocal** (STT, VAD, fin de phrase, wake word, TTS).
- Format : annonce brève + sujet mots simples en tête + un par un.
- Vigilances conv 2 : plan mode mis-fire · filtre projet · `--bare` jamais · diffusion repo public/gitleaks · discipline IN PLACE.

## Section 2 — Historique des versions
- **v1 — 2026-06-21** — Création du socle de cadrage (profil Standard). Reconnaissance terrain faite et vérifiée. Phase 1 (audit du cahier) ouverte. Arbitrages **A1** (canal d'action = Claude Code SDK sous Max) et **A2** (voix = Sonnet 4.6 + canal configurable) tranchés. Principe transversal « avoir le choix » posé.
- **v2 — 2026-06-21** — Conv 2 : audit Phase 1 poursuivi. **Couches 1 (pipeline vocal) et 2 (mémoire) entièrement tranchées — A5 → A13.** Pipeline 100 % local, 0 € (faster-whisper, Smart Turn v3, Silero, openWakeWord/LiveKit, Kokoro). Mémoire SQLite : recherche hybride FTS5 + `sqlite-vec`, faits en langage naturel + métadonnées, consolidation nocturne (Sonnet 4.6 via Max ; Haiku en micro), injection de contexte bornée. Couche **Personnalité** insérée (gap du cahier détecté). ElevenLabs recadré (premium optionnel + cost-guard ; **~0 € pour Sophia**). Porcupine/Picovoice écarté (tier gratuit supprimé le 30/06/2026).

## Section 3 — États actuels successifs

### Ancienne tête « post-cadrage initial — 2026-06-21 » (archivée fin conv 2)
- Phase 1 ouverte. Reconnaissance terrain **faite et vérifiée**.
- 2 arbitrages fondateurs tranchés : **A1** (canal d'action = Claude Code SDK sous Max) · **A2** (voix = Sonnet 4.6 + canal configurable).
- Principe transversal posé : « avoir le choix ».
- Socle de cadrage créé + réorganisé en `docs/` (dépôt git `main`). Prochaine couche d'audit : pipeline vocal.
- Non figé : arborescence applicative.

## Section 4 — Snapshots motifs héritiers / compteurs
*(ce `CLAUDE.md` n'utilise pas de section « motifs héritiers / compteurs » — sans objet pour l'instant)*
