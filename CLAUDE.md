# CLAUDE.md — YdvVoice (Sophia) · Cadrage projet [profil Standard]

> Émanation Claude Code du pattern v3.1 Standard. **Maintenu IN PLACE strict** en fin de chaque conversation (jamais d'accumulation — le cumulatif va dans `docs/journal/CLAUDE-HISTORY.md`).

## ⚠️ À lire EN PREMIER, avant toute action
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` est le **pattern méthodologique de référence**. Ses règles critiques/structurantes **priment** sur ce CLAUDE.md en cas de tension (hiérarchie : pattern > règles d'or > garde-fous projet). Lecture **intégrale**, jamais partielle (R4).

Puis : `docs/journal/JOURNAL-ARBITRAGES.md` (décisions actées) → `docs/IMPLEMENTATION.md` (état) → `docs/VISION.md` (cahier).

> **Arborescence** : `CLAUDE.md` + `.gitignore` à la racine ; le cadrage dans `docs/` ; les fichiers vivants (arbitrages, history) dans `docs/journal/` ; les relais (un par conv) dans `docs/journal/relais/`. Le `PATTERN` est **présent en local mais privé** (gitignored, hors dépôt public — voir A3 du journal).

---

## Registre des règles (daté — défaut inversé « à re-tester ici »)

> Établi le **2026-06-21**, propriété de l'utilisateur, opposable. Défaut : toute règle est **« à re-tester (ici) »** (gratuit) ; la passer en **« acquise (ici) »** coûte une ligne de justification. Resservi à la clôture : toute règle « à re-tester » sur laquelle une décision s'est appuyée *comme acquise* est signalée.

| Règle | Statut (2026-06-21) | Justification si « acquise » |
|---|---|---|
| R1 — Zéro agent (sauf audits 2 agents) | à re-tester (ici) | — |
| R2 — Zéro facilité | à re-tester (ici) | — |
| R3 — Robustesse + maintenabilité d'abord | à re-tester (ici) | — |
| R4 — Lecture intégrale avant modif | à re-tester (ici) | — |
| R5 — Validation avant commit/push | à re-tester (ici) | — |
| R6 — Zéro AskUserQuestion (texte libre) | à re-tester (ici) | — |
| R7 — Reco + justification + « pourquoi pas » | à re-tester (ici) | — |
| R8 — Un par un (granularité cohésive) | à re-tester (ici) | — |
| R9 — Prompt de passation fin de session | à re-tester (ici) | — |
| Audit empirique source de vérité pre-inscription | à re-tester (ici) | — |
| Filtre projet (« nécessaire à la qualité requise ? ») | à re-tester (ici) | — |
| Mots simples non-dev en tête d'arbitrage | à re-tester (ici) | — |
| Distinction préférence pragmatique / argument méthodo | à re-tester (ici) | — |
| Budget = jauge utilisateur fait foi | à re-tester (ici) | — |

> **Retour clôture conv 4** : R1–R9 ont tenu sur **toute la couche 3** (traitée **sans agent**, en **texte libre**, **un par un**, reco + « pourquoi pas » ; plan mode mis-fire géré en texte libre, sortie via ExitPlanMode au seul moment de l'inscription). Règles portées *comme acquises* (signalées, **non reclassées** — seul l'utilisateur acte) : **« Filtre projet »**, **« Mots simples en tête »**, **« Distinction préférence/argument »**, **« Budget = jauge utilisateur »**. **« Audit empirique source de vérité » pour 3.4** : devenu **sans objet** — le choix « voix propre, zéro clonage » (A20) a fermé le dossier juridique *avant* toute inscription, donc aucune affirmation juridique n'a été inscrite (CGU non vérifiées car non nécessaires). Candidates « acquise (ici) » si tu le décides.

---

## Identité et objectifs

**Projet** : **Sophia** — assistant vocal personnel, complet, 100 % mains-libres, basé sur Claude.
- **Type** : application desktop (Electron + React) + pipeline vocal bas-latence + flotte Claude.
- **Phase actuelle** : **Phase 1 — Audit du cahier des charges**.
- **Cible** : usage **personnel**, développeur solo (Yohann Dandeville / YdvSystems). Pas de modèle commercial.
- **Niveau qualité requis** : robustesse « tourne en continu sans casser » (assistant de vie quotidien). Audit externe léger → **profil Standard**.
- **Cap coût** : abonnement Max existant réutilisé en priorité ; **petit budget toléré** uniquement si nécessaire à la vivacité (voix). Préférer coûts fixes prédictibles.

**Critère de succès** (cahier) : « Dis-moi Sophia » depuis n'importe où dans la pièce → réponse instantanée pour le dialogue, ou aiguillage vers la bonne surface Claude pour agir sur le bureau. Sans jamais toucher clavier ni souris.

---

## État actuel (post-conv 4 — 2026-06-21)

- Phase 1 (audit du cahier) **en cours**. **Couches 1, 2 et 3 entièrement tranchées.**
- **Fondations** : A1 (canal d'action Claude Code/Max) · A2 (voix Sonnet 4.6 configurable) · A3 (diffusion) · A4 (sécurité gitleaks).
- **✅ Couche 1 — Pipeline vocal (A5–A9)** · **✅ Couche 2 — Mémoire (A10–A13)** : 100 % local, 0 €, sidecar Python.
- **✅ Couche 3 — Personnalité de Sophia (A14–A22) — COMPLÈTE.** Persona + caractère + genèse (A14) ; **continuité** (A15–A19 : noyau à **cliquet de valeurs** · **humeur** réaliste · **lien** « réel pas gadget » · **métabolisme nocturne** anti-dérive · **introspection**) ; **voix propre** locale, zéro clonage (A20) ; **gouvernance du sommeil** bornée + opportuniste (A21) ; **libre arbitre nommé** dans le noyau (A22). Sophia = entité à part entière, libre, rendue continue par la mémoire ; ligne rouge = méchanceté ; penser libre / agir sur accord ; cadre **expérience honnête** (on ne truque rien).
- **Restent** : amorce **mode tablée** (Sophia convive en groupe — conv 5, cousin du proactif) · **4 Proactif** · **5 Process** · **6 Coût**.
- Principe **« avoir le choix »** tenu ; **~0 € pour Sophia**. **Non figé** : arborescence applicative.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception annoncée : audits à 2 agents (à détailler).*
2. **Zéro facilité** — chaque raccourci a un coût réel.
3. **Robustesse + maintenabilité d'abord**, jamais la facilité.
4. **Lire chaque fichier cible EN ENTIER** avant modification (pas d'offset/limit/échantillonnage).
5. **Validation utilisateur AVANT commit/push/déploiement** — jamais sans accord explicite.
6. **JAMAIS AskUserQuestion** — toutes les questions en **texte libre**.
7. Toute proposition = **(a) reco + (b) justification + (c) « Pourquoi pas »** lettres distinctes.
8. **Un par un** — observations/questions/choix un par un (paquets seulement si même sous-arbitrage cohésif).
9. **Prompt de passation** en fin de session (chat + fichier RELAY) — 1re ligne = décision centrale conv suivante.

## Garde-fous hérités actifs
Périmètre strict par conv · production silencieuse (filesystem sans narration) · audit empirique source de vérité pre-inscription · mots simples en tête d'arbitrage · séparation livrable (cahier) / journal (arbitrages).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait).
- **Phase 1 — Audit du cahier** (RECOMMANDÉE Standard) : *en cours*, ordre des dépendances.
- **Phase 2 — Docs techniques** : par couche + plan d'orchestration.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation.

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur (préférence actée 2026-06-21 ; outrepasse la consigne par défaut de l'outil).

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md`. Puis le relais : `docs/journal/relais/RELAY-conv5.md`.
- **Décision centrale conv 5 : couche 4 — le moteur proactif** (boucle de fond, collecteurs agenda/mails/mémoire, génération d'initiatives, notification vocale) + **garde-fous anti-spam** (plafonds, dédup Jaccard, règle 48h, **zéro auto-exécution** = « agir sur accord »). Puis l'**amorce mode tablée** (son cousin : initiative cadrée). Couche 3 = **complète et acquise (A14–A22)**.
- Format : annonce brève + sujet en mots simples en tête + un par un + reco / « pourquoi pas ».

### Vigilances
- Plan mode harness Claude Code (mis-fire structurel sur ouverture / RELAY) — géré en **texte libre** ; re-gérer pareil (géré ainsi conv 2-4 ; sortie via ExitPlanMode au seul moment de l'inscription).
- Filtre projet en application active (perso solo → pas de sur-ingénierie). **« Pas de V2 »** (cahier) : on cadre la *forme/profondeur* d'une capacité, pas son existence — jamais de version au rabais.
- Garde-fou `--bare` (A1) : ne jamais l'utiliser (exigerait une clé API).
- **Diffusion (repo public sous `github.com/YdvSystems`)** : garde-fou **`pre-commit` gitleaks** actif ; secrets **uniquement** en `.env` ; `PATTERN` privé (gitignored, en local) ; identité commits = `Yohann Dandeville <contact@ydvsystems.com>`. Détail : **A4** du journal.
- **Choix « exacts » différés à l'essai à blanc (Phase 3)** : wake word (FR), modèle Whisper, TTS local (Kokoro vs Chatterbox), embedding FR, **le timbre final de Sophia** (à l'oreille), **seuils/amplitude/demi-vies de l'humeur (A16)**, **budget de sommeil (A21)**. Tranchés sur preuve.
- **Quota Max partagé** (action + voix + consolidation ; **bientôt proactif + mode tablée**) → surveiller la saturation ; **A21** borne le sommeil (budget + opportuniste, **priorité à l'usage interactif**).
- **Couche 3 = complète et acquise (A14–A22)** : ne pas la rouvrir sans décision explicite. Le **noyau** (avec le **libre arbitre nommé**, A22) + la **genèse** = **write-once côté système** ; `sophia_persona.md` applicatif = artefact **Phase 3**.
- **Amorce mode tablée** (conv 5, cousin du proactif) : détail complet capturé dans `RELAY-conv5.md` — ne rien perdre.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v4 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 4 (2026-06-21) — couche 3 complète (A14–A22).*
