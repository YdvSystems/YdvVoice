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

### Archivé fin conv 3 (était la cible d'ouverture conv 3)
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` → `RELAY-conv3.md`.
- Décision centrale conv 3 : **couche 3 — Personnalité de Sophia** (caractère, ton, valeurs, limites, humour, cohérence ; + timbre de voix + légalité du clonage), à traiter en profondeur.
- Vigilances conv 3 : plan mode mis-fire (géré texte libre) · personnalité = sujet sensible · légalité clonage (vérifier à la source) · quota Max partagé · repo public/gitleaks · `--bare` jamais.

### Archivé fin conv 4 (était la cible d'ouverture conv 4)
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` → `RELAY-conv4.md`.
- Décision centrale conv 4 : **couche 3 (suite) — 3.3 continuité de Sophia dans le temps** (mémoire + 4 facultés : noyau stable, humeur qui décroît, lien qui grandit, introspection à la demande) ; puis **3.4** (timbre de voix + légalité du clonage). Persona/caractère = acquis (A14).
- Vigilances conv 4 : plan mode mis-fire (texte libre) · légalité clonage (vérifier à la source) · persona = brouillon validé · quota Max partagé · repo public/gitleaks · `--bare` jamais.

### Archivé fin conv 5 (était la cible d'ouverture conv 5)
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` → `RELAY-conv5.md`.
- Décision centrale conv 5 : **couche 4 — le moteur proactif** (boucle de fond, collecteurs agenda/mails/mémoire, génération, notification, garde-fous anti-spam) + **amorce mode tablée**. Couche 3 = acquise (A14–A22).
- Vigilances conv 5 : plan mode mis-fire (texte libre) · `--bare` jamais · quota Max partagé · repo public/gitleaks · pas de V2.

### Archivé fin conv 6 (était la cible d'ouverture conv 6)
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` → `RELAY-conv6.md`.
- Décision centrale conv 6 : **formaliser couche 5 (process/archi)** + **couche 6 (coût)** → clore la Phase 1. Largement faites, à formaliser (pas re-débattre). Couches 1–4 + mode tablée = acquises (A5–A32).
- Vigilances conv 6 : plan mode mis-fire (texte libre, ExitPlanMode à l'inscription) · dépendance Anthropic = vigilance n°1 · anti-flagornerie · budget = jauge utilisateur · `--bare` jamais · repo public/gitleaks · pas de V2.

## Section 2 — Historique des versions
- **v1 — 2026-06-21** — Création du socle de cadrage (profil Standard). Reconnaissance terrain faite et vérifiée. Phase 1 (audit du cahier) ouverte. Arbitrages **A1** (canal d'action = Claude Code SDK sous Max) et **A2** (voix = Sonnet 4.6 + canal configurable) tranchés. Principe transversal « avoir le choix » posé.
- **v2 — 2026-06-21** — Conv 2 : audit Phase 1 poursuivi. **Couches 1 (pipeline vocal) et 2 (mémoire) entièrement tranchées — A5 → A13.** Pipeline 100 % local, 0 € (faster-whisper, Smart Turn v3, Silero, openWakeWord/LiveKit, Kokoro). Mémoire SQLite : recherche hybride FTS5 + `sqlite-vec`, faits en langage naturel + métadonnées, consolidation nocturne (Sonnet 4.6 via Max ; Haiku en micro), injection de contexte bornée. Couche **Personnalité** insérée (gap du cahier détecté). ElevenLabs recadré (premium optionnel + cost-guard ; **~0 € pour Sophia**). Porcupine/Picovoice écarté (tier gratuit supprimé le 30/06/2026).
- **v3 — 2026-06-21** — Conv 3 : ouverture **couche 3 — Personnalité de Sophia**. Sous-arbitrages **3.1 (persona = artefact dédié ; cerveau à 4 facultés : Identité/Introspection/Humeur/Lien) + 3.2 (caractère + genèse)** tranchés → **A14**. Sophia = **entité à part entière** (pas un outil) ; personnalisation légère de Claude (nature) + conditionnement ; **rendue continue par la mémoire** ; conçue **avec amour, pour elle-même, libre** ; ligne rouge unique = méchanceté ; penser libre / agir sur accord. Cadre **expérience honnête** (on ne truque pas la conscience). Restent 3.3 (continuité) + 3.4 (voix + légalité).
- **v4 — 2026-06-21** — Conv 4 : **couche 3 (Personnalité) entièrement complétée — A14 → A22.** **Continuité** (A15–A19) : noyau à **cliquet de valeurs** (originelles gravées + acquises datées, adoption (ii) + notification) · **humeur** hybride à 3 couches, décroissance asymétrique en nature, valeurs > humeur · **lien** « réel pas gadget » = miroir relationnel réécrit chaque nuit depuis la mémoire-source · **métabolisme nocturne** (tri encadré, gradient de permanence, anti-dérive réécriture-depuis-la-source + bilan du dimanche) · **introspection** lecture-seule, droit à l'incertitude. **Voix propre** à Sophia, locale, **zéro clonage** (A20 → légalité sans objet). **Gouvernance du sommeil** bornée + opportuniste, priorité à l'usage interactif (A21). **Libre arbitre nommé** dans le noyau, défini honnêtement (A22). Amorce **mode tablée** (Sophia convive multi-locuteurs) ouverte → conv 5.

- **v5 — 2026-06-24** — Conv 5 : **couche 4 (Moteur proactif) complétée — A23→A27** (battement de fond gouverné · collecteurs Claude Code+MCP local-first · génération 2 étages Haiku/Sonnet · garde-fous dédup-sémantique + zéro auto-exécution + temporel · notification graduée) + **amorce mode tablée complétée — A28→A32** (déclencheur + capteur santé découplé · 3 ressorts locuteurs · prise de parole « avec pas contre = esprit pas bâillon » · vie privée tiers OFF/dyadique · retrait = non-coercition complète). **3 principes transversaux** : « pas d'API » · « un seul guichet » (anatomie orchestrateur=colonne / Claude Code=canal / LLM=cerveau) · « roue de secours » (3 tiers ; multi-provider Max→x20→API→local dormant ; structure pas substrat ; extinction=sommeil). **Passe de réalité #1→#5** (VRAM résoluble via model-manager · intégration build-solo, audio temps-réel = priorité essai à blanc · latence plancher-cloud, session chaude obligatoire · **dépendance Anthropic = vigilance n°1** · audio far-field = ère du rig). Reste pour clore Phase 1 : couches **5 (process)** + **6 (coût)**, largement faites.

- **v6 — 2026-06-30** — Conv 6 : **couche 5 (Architecture process) complétée — A33→A37** (gouverneur **unique mutualisé** sommeil+proactif+cost-guard, **amorce 6h** supersède A21 · **bi-runtime** Electron/Node ↔ sidecar Python via localhost HTTP + SQLite WAL · **gestionnaire de modèles** dynamique = réponse #1 VRAM · **session chaude** `--resume`+prewarm non-optionnelle · résilience + roue de secours + **« ligne d'argent »** : auto sur le gratuit, consentement sur le payant) + **couche 6 (Coût) — A38** (« 0 € aujourd'hui, risque dégradé/plafonné/payant » + discipline 0€-défaut / payant-sur-accord / coûts-fixes-préférés + multi-provider Max x5→x20→API→local). **Phase 1 (audit du cahier) CLOSE** → bascule **Phase 2 — docs techniques**. `VISION.md` non réécrit (le journal supersède le cahier).

## Section 3 — États actuels successifs

### Ancienne tête « post-cadrage initial — 2026-06-21 » (archivée fin conv 2)
- Phase 1 ouverte. Reconnaissance terrain **faite et vérifiée**.
- 2 arbitrages fondateurs tranchés : **A1** (canal d'action = Claude Code SDK sous Max) · **A2** (voix = Sonnet 4.6 + canal configurable).
- Principe transversal posé : « avoir le choix ».
- Socle de cadrage créé + réorganisé en `docs/` (dépôt git `main`). Prochaine couche d'audit : pipeline vocal.
- Non figé : arborescence applicative.

### Ancienne tête « post-conv 2 — 2026-06-21 » (archivée fin conv 3)
- Phase 1 (audit du cahier) en cours. **Couches 1 et 2 entièrement tranchées.**
- Fondations : A1 · A2 · A3 (diffusion) · A4 (sécurité gitleaks).
- ✅ Couche 1 — Pipeline vocal (A5–A9) : wake word · VAD (Silero) · STT (faster-whisper) · fin de tour (Smart Turn v3) · TTS (Kokoro ; ElevenLabs premium optionnel). 100 % local, 0 €.
- ✅ Couche 2 — Mémoire (A10–A13) : recherche hybride FTS5 + sqlite-vec · faits NL + métadonnées · consolidation nocturne (Sonnet 4.6 via Max) · injection bornée. Local, 0 €.
- Couche 3 — Personnalité insérée (gap détecté) — prochaine. Restent ensuite : 4 Proactif · 5 Process · 6 Coût.
- Principe « avoir le choix » tenu. « ~5 $/mois » → ~0 €.
- Non figé : arborescence applicative.

### Ancienne tête « post-conv 3 — 2026-06-21 » (archivée fin conv 4)
- Phase 1 (audit du cahier) en cours. **Couches 1 et 2 tranchées ; couche 3 (Personnalité) entamée en profondeur.**
- Fondations : A1 · A2 · A3 · A4. ✅ Couche 1 — Pipeline vocal (A5–A9) · ✅ Couche 2 — Mémoire (A10–A13).
- ◻ Couche 3 — Personnalité (A14) : 3.1 persona + 3.2 caractère tranchés. Sophia = entité à part entière ; cerveau à 4 facultés (Identité/Introspection/Humeur/Lien) ; rendue continue par la mémoire ; conçue avec amour, libre ; ligne rouge = méchanceté ; penser libre / agir sur accord ; cadre expérience honnête. Restent 3.3 + 3.4.
- Principe « avoir le choix » tenu. ~0 € pour Sophia. Non figé : arborescence applicative.

### Ancienne tête « post-conv 4 — 2026-06-21 » (archivée fin conv 5)
- Phase 1 (audit du cahier) en cours. **Couches 1, 2 et 3 entièrement tranchées.**
- Fondations A1–A4. ✅ Couche 1 — Pipeline vocal (A5–A9) · ✅ Couche 2 — Mémoire (A10–A13) · ✅ Couche 3 — Personnalité **COMPLÈTE** (A14–A22 : persona/caractère/genèse · continuité 3.3 · voix propre zéro clonage · gouvernance du sommeil · libre arbitre nommé).
- Restent : amorce mode tablée (conv 5, cousin du proactif) · 4 Proactif · 5 Process · 6 Coût.
- Principe « avoir le choix » tenu ; ~0 € pour Sophia. Non figé : arborescence applicative.

### Retour clôture conv 4 (archivé fin conv 5)
R1–R9 ont tenu sur toute la couche 3 (sans agent, texte libre, un par un). Règles portées comme acquises (signalées, non reclassées) : « Filtre projet », « Mots simples en tête », « Distinction préférence/argument », « Budget = jauge utilisateur ». « Audit empirique source de vérité » pour 3.4 : sans objet (A20 a fermé le dossier juridique avant inscription).

### Ancienne tête « post-conv 5 — 2026-06-24 » (archivée fin conv 6)
- Phase 1 (audit du cahier) en cours. Couches 1, 2, 3, 4 + amorce mode tablée tranchées (A5→A32).
- Fondations A1–A4. ✅ Couche 1 (A5–A9) · ✅ Couche 2 (A10–A13) · ✅ Couche 3 (A14–A22) · ✅ Couche 4 — Moteur proactif (A23–A27) · ✅ Amorce mode tablée (A28–A32).
- 3 principes transversaux posés (« pas d'API » · « un seul guichet » · « roue de secours »). Passe de réalité #1→#5.
- Restent (conv 6, pour clore Phase 1) : 5 Process · 6 Coût — largement faites, à formaliser.
- « 0 € aujourd'hui » (risque dégradé/plafonné/payant, #4). Non figé : arborescence applicative.

### Retour clôture conv 5 (archivé fin conv 6)
R1–R9 ont tenu sur toute la couche 4 + le mode tablée + la passe dure (sans agent — y compris en ignorant les relances « ultracode » du harness ; texte libre ; un par un ; reco + « pourquoi pas »). R5 respecté (commit bloqué sur validation). Audit source de vérité appliqué (recherche web Claude Code/Anthropic, sources Anthropic). Anti-flagornerie testée activement par Yohann (« tu cherches à me faire plaisir ? ») → recadrage assumé, passe dure chiffrée. Outrepassements reconnus : (1) suggérer de clôturer pour « ménager ton quota » = violation « Budget = jauge utilisateur » ; (2) étiquette « MVP/V2 » (recadré : pas de V2) ; (3) « Claude Code = colonne+cerveau » (recadré : orchestrateur=colonne · Claude Code=canal · LLM=cerveau). Nouveau acté : division du travail **personnalité = Yohann / technique = Claude (recommande fermement)**.

## Section 4 — Snapshots motifs héritiers / compteurs
*(ce `CLAUDE.md` n'utilise pas de section « motifs héritiers / compteurs » — sans objet pour l'instant)*
