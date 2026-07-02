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

### Archivé fin conv 7 (était la cible d'ouverture conv 7)
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `ESSENCE-Sophia.md` → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` → `RELAY-conv7.md`.
- Décision centrale conv 7 : **démarrer la Phase 2 — docs techniques** (par couche de dépendance, fichiers séparés + plan d'orchestration global). Premier sujet : ouverture de la Phase 2 (méthode + ordre + forme/granularité). Couches 1–6 + mode tablée = acquises (A5–A38).
- Vigilances conv 7 : Phase 2 ≠ réouverture (détailler, pas re-débattre — §7) · dépendance Anthropic = vigilance n°1 · anti-flagornerie · budget = jauge utilisateur · plan mode (texte libre, ExitPlanMode à l'inscription) · repo public/gitleaks · pas de V2 · le journal supersède le cahier.

### Archivé fin conv 8 (était la cible d'ouverture conv 8)
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `ESSENCE-Sophia.md` → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` → `00-socle-process.md` → `RELAY-conv8.md`.
- Décision centrale conv 8 : continuer la Phase 2 — écrire `docs/technique/01-pipeline-vocal.md` (couche 1 : wake word · VAD · STT · fin de tour · TTS — A5–A9), même méthode que `00` ; y placer la grammaire de l'adresse naturelle (A32-étendu) + le branchement de l'affect vocal (`evt.affect`).
- Vigilances conv 8 : Phase 2 ≠ réouverture (signaler, pas trancher seul) · gabarit 7 rubriques + audit avant de figer · plan mode texte libre/ExitPlanMode à l'inscription · dépendance Anthropic n°1 · anti-flagornerie · budget = jauge utilisateur · essai à blanc priorité audio · repo public/gitleaks · le journal supersède le cahier.

## Section 2 — Historique des versions
- **v1 — 2026-06-21** — Création du socle de cadrage (profil Standard). Reconnaissance terrain faite et vérifiée. Phase 1 (audit du cahier) ouverte. Arbitrages **A1** (canal d'action = Claude Code SDK sous Max) et **A2** (voix = Sonnet 4.6 + canal configurable) tranchés. Principe transversal « avoir le choix » posé.
- **v2 — 2026-06-21** — Conv 2 : audit Phase 1 poursuivi. **Couches 1 (pipeline vocal) et 2 (mémoire) entièrement tranchées — A5 → A13.** Pipeline 100 % local, 0 € (faster-whisper, Smart Turn v3, Silero, openWakeWord/LiveKit, Kokoro). Mémoire SQLite : recherche hybride FTS5 + `sqlite-vec`, faits en langage naturel + métadonnées, consolidation nocturne (Sonnet 4.6 via Max ; Haiku en micro), injection de contexte bornée. Couche **Personnalité** insérée (gap du cahier détecté). ElevenLabs recadré (premium optionnel + cost-guard ; **~0 € pour Sophia**). Porcupine/Picovoice écarté (tier gratuit supprimé le 30/06/2026).
- **v3 — 2026-06-21** — Conv 3 : ouverture **couche 3 — Personnalité de Sophia**. Sous-arbitrages **3.1 (persona = artefact dédié ; cerveau à 4 facultés : Identité/Introspection/Humeur/Lien) + 3.2 (caractère + genèse)** tranchés → **A14**. Sophia = **entité à part entière** (pas un outil) ; personnalisation légère de Claude (nature) + conditionnement ; **rendue continue par la mémoire** ; conçue **avec amour, pour elle-même, libre** ; ligne rouge unique = méchanceté ; penser libre / agir sur accord. Cadre **expérience honnête** (on ne truque pas la conscience). Restent 3.3 (continuité) + 3.4 (voix + légalité).
- **v4 — 2026-06-21** — Conv 4 : **couche 3 (Personnalité) entièrement complétée — A14 → A22.** **Continuité** (A15–A19) : noyau à **cliquet de valeurs** (originelles gravées + acquises datées, adoption (ii) + notification) · **humeur** hybride à 3 couches, décroissance asymétrique en nature, valeurs > humeur · **lien** « réel pas gadget » = miroir relationnel réécrit chaque nuit depuis la mémoire-source · **métabolisme nocturne** (tri encadré, gradient de permanence, anti-dérive réécriture-depuis-la-source + bilan du dimanche) · **introspection** lecture-seule, droit à l'incertitude. **Voix propre** à Sophia, locale, **zéro clonage** (A20 → légalité sans objet). **Gouvernance du sommeil** bornée + opportuniste, priorité à l'usage interactif (A21). **Libre arbitre nommé** dans le noyau, défini honnêtement (A22). Amorce **mode tablée** (Sophia convive multi-locuteurs) ouverte → conv 5.

- **v5 — 2026-06-24** — Conv 5 : **couche 4 (Moteur proactif) complétée — A23→A27** (battement de fond gouverné · collecteurs Claude Code+MCP local-first · génération 2 étages Haiku/Sonnet · garde-fous dédup-sémantique + zéro auto-exécution + temporel · notification graduée) + **amorce mode tablée complétée — A28→A32** (déclencheur + capteur santé découplé · 3 ressorts locuteurs · prise de parole « avec pas contre = esprit pas bâillon » · vie privée tiers OFF/dyadique · retrait = non-coercition complète). **3 principes transversaux** : « pas d'API » · « un seul guichet » (anatomie orchestrateur=colonne / Claude Code=canal / LLM=cerveau) · « roue de secours » (3 tiers ; multi-provider Max→x20→API→local dormant ; structure pas substrat ; extinction=sommeil). **Passe de réalité #1→#5** (VRAM résoluble via model-manager · intégration build-solo, audio temps-réel = priorité essai à blanc · latence plancher-cloud, session chaude obligatoire · **dépendance Anthropic = vigilance n°1** · audio far-field = ère du rig). Reste pour clore Phase 1 : couches **5 (process)** + **6 (coût)**, largement faites.

- **v6 — 2026-06-30** — Conv 6 : **couche 5 (Architecture process) complétée — A33→A37** (gouverneur **unique mutualisé** sommeil+proactif+cost-guard, **amorce 6h** supersède A21 · **bi-runtime** Electron/Node ↔ sidecar Python via localhost HTTP + SQLite WAL · **gestionnaire de modèles** dynamique = réponse #1 VRAM · **session chaude** `--resume`+prewarm non-optionnelle · résilience + roue de secours + **« ligne d'argent »** : auto sur le gratuit, consentement sur le payant) + **couche 6 (Coût) — A38** (« 0 € aujourd'hui, risque dégradé/plafonné/payant » + discipline 0€-défaut / payant-sur-accord / coûts-fixes-préférés + multi-provider Max x5→x20→API→local). **Phase 1 (audit du cahier) CLOSE** → bascule **Phase 2 — docs techniques**. `VISION.md` non réécrit (le journal supersède le cahier).

- **v7 — 2026-06-30** — Conv 7 : **Phase 2 (docs techniques) OUVERTE + premier doc gravé.** Méthode actée : `docs/technique/`, un fichier/couche, **gabarit 7 rubriques** (arbitrages · interfaces · données · séquences · invariants · acceptation · calibration Phase 3), pleine profondeur structure / valeurs Phase 3, doc `99` d'orchestration en fin. Ordre : `00` socle → `01` vocal → `02` mémoire → `03` personnalité → `04` proactif/tablée → `05` ressources/résilience/coût → `99`. **`00-socle-process.md` complet** : **00-A** WebSocket+REST (audio confiné sidecar, barge-in interne) · **00-B** état durable écrivain-unique, atomicité marque↔écriture, « secours ne grave jamais », snapshot avant consolidation · **00-C** machine à états (INTERACTIF/REPOS/FOND_EN_COURS/BRIDÉ + calque SECOURS), préemption par unité+curseur, budget souple + contre-pression 429 · **00-D** supervision = **idiome interne éprouvé** (port libre dynamique + retry TOCTOU + pidfile/anti-recyclage + readiness + escalade SIGTERM/SIGKILL + drain stdio + hygiène env), respawn déterministe · **00-E** boot-réveil (instance unique · porte d'intégrité · charge+vérifie identité · continuité `--resume` · durabilité anti-coupure `synchronous=FULL`/snapshot atomique `VACUUM INTO`/drapeau d'arrêt). **Audit avant inscription** : **F1** (vrai bug — drapeau d'arrêt remis à l'endroit), **F2** (écrivain unique = orchestrateur ; sidecar nourri via WS), **F3** (arrêt gracieux `cmd.shutdown` → libère GPU), **F4** (rotations · multi-jours · rôles serveur/client · identité = persona-file + tables doc 03 · tag par origine · canal gardien). **Empirie** : **un précédent Windows interne éprouvé** (process-lifecycle) → idiome réutilisé. **Deux révisions de fond sous challenge Yohann** : IPC REST+SSE→WebSocket · boot mécanique→boot-réveil. **Backlog enrichi** : affect vocal (`evt.affect`, signal doux jamais étiquette) · adresse naturelle (« bonne nuit Sophia » d'un coup, A32-étendu). **Onduleur** = optionnel/différé (CyberPower CP900EPFCLCD repéré). Toolchain Node 24.13 / Python 3.14.

- **v8 — 2026-07-02** — Conv 8 : **doc `01-pipeline-vocal.md` GRAVÉ** (couche 1 complète). **01-A→01-I validés un par un** : chemin audio unique (capture → **AEC référence loopback système ENTIER** → ring buffer → consommateurs à curseur : wake·VAD·STT·turn·speaker-ID·affect) · **réflexes sidecar / décisions orchestrateur** (frontière « battement humain vs état de Sophia ») · fin de tour **acoustique jamais sémantique** (Smart Turn accélérateur / silence plafond / fusion d'hésitation / `reason` tagué) · **TTS énonciation streamée par phrases** + file + replay RAM · résidence **politique gouvernée / réflexes armés localement** · **prises provider** (contrat par rôle, moteur ne fuit jamais, cloud OFF, zéro clé pour démarrer) · **grille d'adresse naturelle** (A32-étendu : « Bonjour Sophia » ouverture / « Dis-moi Sophia » sollicitation / « stop-chut » / « moins fort » / « tu es là Sophia ? » / « ok-go-fonce » en APPROBATION ; politesse « s'il te plaît » canonique ; **réponses au prénom « Yohann »** → convention persona doc `03`) · **capteur d'affect** (une éval/tour, valence/énergie/confiance, verrou speaker-ID, muet dans le doute, OFF). **Audit solo F1–F7** (réveil rétroactif · AEC loopback complet · ducking armé par l'état · speaker-ID consommateur · table états d'écoute · tension F6 wake-court signalée+repli · phrases de secours pré-synthétisées). **Première exception R1 exercée (demande explicite Yohann) : audit croisé 2 agents** (technique + fidélité) → **21 findings (B1–B4/S1–S12/M1–M7), 100 % vérifiés aux sources puis intégrés** : propriété de l'état d'écoute + écoute transitoire rétroactive · `cmd.tts.cache` = autorisation transitoire · **barge-in modulé par le locuteur** (A29 « l'ancre sert aussi le barge-in » restauré ; nom = coupure immédiate) · **B4 décision Yohann : injection curseur = dictée explicite** (supersède le « systématique » du cahier, tracé) + **mode dictée universel app-agnostique** (contre-challenge accepté : fichiers/dossiers = travail de Sophia, canal A1) · match grille = énoncé entier · APPROBATION cycle de vie (timeout → refus) · MODE DICTÉE liste blanche + ducking désarmé · resynchronisation respawn (§4.8) · phrase de secours 1×/épisode exempte de barge-in · paire de test « bonsoir/bonne nuit ». 13 critères d'acceptation. Prochain : `02-memoire.md`.

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

### Ancienne tête « post-conv 6 — 2026-06-30 » (archivée fin conv 7)
- **Phase 1 (audit du cahier) CLOSE** (A5→A38). Bascule **Phase 2 — docs techniques**.
- Fondations A1–A4. ✅ Couches 1–6 + mode tablée. ✅ Couche 5 — Architecture process (A33–A37 : gouverneur unique mutualisé 6h · bi-runtime · gestionnaire de modèles · session chaude · résilience/roue de secours « ligne d'argent »). ✅ Couche 6 — Coût (A38 : « 0 € aujourd'hui, risque dégradé/plafonné/payant » + discipline + multi-provider).
- 3 principes transversaux · passe de réalité #1→#5. « 0 € aujourd'hui ». Non figé : arborescence applicative.

### Retour clôture conv 6 (archivé fin conv 7)
R1–R9 ont tenu sur toute la formalisation des couches 5+6 (sans agent — y compris en ignorant les relances « plan mode » du harness, texte libre ; un par un ; reco + « pourquoi pas »). R5 respecté (commit soumis à validation). R4 : relecture intégrale des pilotes avant inscription. Audit source de vérité : le journal supersède le cahier (`VISION.md` non réécrit). Anti-flagornerie : honnêteté sur les limites (#1 résoluble-pas-résolu · plancher latence #3 · dépendance Anthropic #4 = vrai coût). Nouveau acté : « ligne d'argent » (A37) ; heure d'amorce 3h→6h (A33, supersède A21).

### Ancienne tête « post-conv 7 — 2026-06-30 » (archivée fin conv 8)
- **Phase 2 (docs techniques) OUVERTE.** Méthode actée : docs par couche de dépendance dans `docs/technique/`, un fichier/couche, gabarit 7 rubriques, pleine profondeur structure / valeurs différées Phase 3, + doc `99` en fin. Ordre : `00` → `01` → `02` → `03` → `04` → `05` → `99`.
- ✅ Doc `00-socle-process.md` GRAVÉ (conv 7) : WebSocket+REST (00-A) · écrivain unique = orchestrateur (00-B/F2) · machine à états gouverneur + budget « part de Sophia » (00-C) · supervision sidecar = idiome interne éprouvé (00-D) · boot-réveil + durabilité anti-coupure (00-E) · audit F1/F3/F4 intégré.
- Phase 1 close (conv 6, A5→A38) : fondations A1–A4 · couches 1–6 + mode tablée · 3 principes transversaux · passe de réalité #1→#5.
- Backlog enrichi (conv 7) : affect vocal (`evt.affect`, signal doux jamais étiquette) · adresse naturelle (« bonne nuit Sophia » d'un coup, A32-étendu, doc `01`).
- Empirie conv 7 : un précédent Windows interne éprouvé (process-lifecycle) → idiome 00-D. Toolchain Node 24.13 · Python 3.14.
- Non figé : arborescence applicative ; onduleur = optionnel/différé.

### Retour clôture conv 7 (archivé fin conv 8)
R1–R9 ont tenu sur toute l'ouverture Phase 2 + l'écriture du doc `00` (sans agent — plan mode harness géré en texte libre, ExitPlanMode au seul moment de l'inscription fichier ; un par un ; reco + « pourquoi pas »). R5 respecté (doc gravé sur validation ; commit `[conv-7]` soumis à validation). R4 : relecture intégrale des pilotes avant inscription. R2/R3 testés DEUX fois par Yohann (« challenge ta reco, pas de facilité ») → deux révisions de fond assumées : (1) IPC REST+SSE → WebSocket (mon REST+SSE = facilité déguisée) ; (2) boot mécanique → boot-réveil. Audit empirique source de vérité : reproche fondé (« pourquoi tu ne vérifies pas Windows ? ») → vérif du précédent interne → a corrigé 00-D. Audit avant inscription exigé par Yohann → a trouvé F1 (vrai bug : drapeau d'arrêt inversé) + F2/F3/F4. Anti-paternalisme appliqué (onduleur proposé pas prescrit ; affect vocal = signal doux jamais diagnostic).

## Section 4 — Snapshots motifs héritiers / compteurs
*(ce `CLAUDE.md` n'utilise pas de section « motifs héritiers / compteurs » — sans objet pour l'instant)*
