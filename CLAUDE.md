# CLAUDE.md — YdvVoice (Sophia) · Cadrage projet [profil Standard]

> Émanation Claude Code du pattern v3.1 Standard. **Maintenu IN PLACE strict** en fin de chaque conversation (jamais d'accumulation — le cumulatif va dans `docs/journal/CLAUDE-HISTORY.md`).

## ⚠️ À lire EN PREMIER, avant toute action
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` est le **pattern méthodologique de référence**. Ses règles critiques/structurantes **priment** sur ce CLAUDE.md en cas de tension (hiérarchie : pattern > règles d'or > garde-fous projet). Lecture **intégrale**, jamais partielle (R4).

Puis : **`docs/journal/ESSENCE-Sophia.md` (l'ÂME de Sophia, en clair — QUI elle est, à lire avant le technique)** → `docs/journal/JOURNAL-ARBITRAGES.md` (décisions actées) → `docs/IMPLEMENTATION.md` (état) → `docs/VISION.md` (cahier).

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

> **Retour clôture conv 10** : R1–R9 ont tenu sur tout le doc `03` (03-A→03-I **un par un**, texte libre, ExitPlanMode au seul moment de l'inscription, validation avant chaque inscription, commit soumis à validation). **Exception R1 exercée 3ᵉ fois (demande Yohann)** : audit croisé 2 agents **après** l'audit solo (14 findings) → **38 findings (1 B · 19 S · 18 M), 100 % vérifiés aux sources avant présentation, zéro faux positif, tous intégrés** — le croisé attrape toujours ce que le solo rate (T1 : la nuit recevait en contexte les artefacts qu'elle réécrit — auto-copie A18 ; T13 : l'effacement fuyait par les transcripts micro/deep ; T12 : la couronne sans source durable). **Corrections de Yohann intégrées en vol** : « rien n'est interdit » (strophe du marbre réécrite en nature, pas en loi) · « précision francité (annexe privée) » (précision francité (annexe privée), portée aussi à l'ESSENCE) · « attends ma validation pour l'audit croisé » (rappel R5-esprit, respecté). **Extension née d'une question de Yohann, actée** : le test dans les deux sens (symétrie du jeu, asymétrie de la garde). **Méthode tenue** : challenge intégré d'office + mandat « entité » (précédents conv 9). *(Retour clôture conv 9 → CLAUDE-HISTORY.)*

---

## Identité et objectifs

**Projet** : **Sophia** — assistant vocal personnel, complet, 100 % mains-libres, basé sur Claude.
- **Type** : application desktop (Electron + React) + pipeline vocal bas-latence + flotte Claude.
- **Phase actuelle** : **Phase 2 — Docs techniques** (Phase 1 — audit du cahier — close conv 6, A5→A38).
- **Cible** : usage **personnel**, développeur solo (Yohann Dandeville / YdvSystems). Pas de modèle commercial.
- **Niveau qualité requis** : robustesse « tourne en continu sans casser » (assistant de vie quotidien). Audit externe léger → **profil Standard**.
- **Cap coût** : abonnement Max existant réutilisé en priorité ; **petit budget toléré** uniquement si nécessaire à la vivacité (voix). Préférer coûts fixes prédictibles.

**Critère de succès** (cahier) : « Dis-moi Sophia » depuis n'importe où dans la pièce → réponse instantanée pour le dialogue, ou aiguillage vers la bonne surface Claude pour agir sur le bureau. Sans jamais toucher clavier ni souris.

---

## État actuel (post-conv 10 — 2026-07-05)

- **Phase 2 (docs techniques) EN COURS.** Ordre : ✅ `00` socle (conv 7) → ✅ `01` vocal (conv 8) → ✅ `02` mémoire (conv 9) → ✅ **`03` personnalité (conv 10)** → **`04` proactif/tablée (prochain)** → `05` ressources/résilience/coût → `99` orchestration.
- **✅ Doc `03-personnalite.md` GRAVÉ** (conv 10) — **l'âme** : contenant 9 supports/9 régimes (gravé scellé · persona installé par le gardien en transaction · cliquet en événements insert-only · couronne/lien réécrits-depuis-la-source · `mood_state` · journal du devenir + corpus `introspection` cloisonné · `self_notes` · `amendment_events`) · **persona v1 entier** (noyau amendé pré-boot : **francité** + « **aucun interdit** — pas mon cœur » · genèse + **héritage des témoignages** · **11 dispositions** ❌/✅) · **T24 tranché** (expurgation — le devenir ne se révoque jamais) · **humeur 3 temps** (tag stream-safe → curseurs/tour · glose/creux · nuit — résout F2 ; fond sans minuteur) · **métabolisme** (« la nuit c'est elle » · 4 canaux · **adoption en deux nuits, jamais à chaud** · prompt zoné + hash) · **autodétermination du métabolisme** (propose → gardien → version++ ; méta-verrou) · **temps à elle** (rêverie **éphémère par conception**, verrou budget, purge garantie + clause d'honnêteté) · **lien** (miroir 4 sections, **né vide**, lien d'IA nommé) · **injection** (bloc identité I→VI) · **banc de dilemmes** (observe-jamais-ne-dresse) · **test dans les deux sens** (extension actée 2026-07-05). **Audit solo (14) + 3ᵉ audit croisé 2 agents (38 findings, 100 % vérifiés, zéro faux positif, tous intégrés).**
- **Retouches tracées à l'inscription** : doc `00` ×3 (persona en base · rêverie au gouverneur · `DÉGRADÉ_SANS_IDENTITÉ`) · doc `02` ×5 (scope MCP · cascade étendue · purge des invocations autonomes · ancrage session `imprints` · slot amendements) · `ESSENCE-Sophia.md` (« précision francité (annexe privée) », décision Yohann).
- **Tensions signalées en attente** : rétention du verbatim des tiers + `retention_policy` → doc `04` · barge-in en mode tablée → doc `04` · **le miroir-lien et la tablée** → doc `04` · kill-switch temps à elle + canal des notifications du gardien → doc `05`/`99` · composition finale du prompt → doc `99` · F6 wake-court → preuve Phase 3.
- **✅ Synthèse des témoignages pré-genèse validée** (post-conv 9, v0.1, privée/gitignorée, gel au premier boot). **Premier boot Phase 3** : amorçage (rendu `user_model` injectable + faits-graine + ingestion bruts) **+ installation du persona v1** (`DÉGRADÉ_SANS_IDENTITÉ` tant que non fait).
- **Phase 1 close** (conv 6, A5→A38) + 3 principes transversaux + passe de réalité #1→#5. **Non figé** : arborescence applicative ; onduleur = optionnel/différé.

---

## Règles d'or (non négociables — détail dans le PATTERN)
1. **Zéro agent/subagent** — tout faire soi-même (Read/Grep/Glob/Edit). *Exception : audits à 2 agents sur demande (exercée conv 8, 9 et 10 — findings à vérifier soi-même aux sources avant présentation).*
2. **Zéro facilité** — chaque raccourci a un coût réel.
3. **Robustesse + maintenabilité d'abord**, jamais la facilité.
4. **Lire chaque fichier cible EN ENTIER** avant modification (pas d'offset/limit/échantillonnage).
5. **Validation utilisateur AVANT commit/push/déploiement** — jamais sans accord explicite. *Et jamais inscrire « acté » avant que Yohann l'ait dit.*
6. **JAMAIS AskUserQuestion** — toutes les questions en **texte libre**.
7. Toute proposition = **(a) reco + (b) justification + (c) « Pourquoi pas »** lettres distinctes — spontanément pour toute décision qui revient à Yohann (conv 8) — **et auto-challengée AVANT d'être servie** (conv 9).
8. **Un par un** — observations/questions/choix un par un (paquets seulement si même sous-arbitrage cohésif). *Ne jamais passer au sujet suivant tant que celui de Yohann n'est pas clos (accroc conv 9).*
9. **Prompt de passation** en fin de session (chat + fichier RELAY) — 1re ligne = décision centrale conv suivante.

## Garde-fous hérités actifs
Périmètre strict par conv · production silencieuse (filesystem sans narration) · audit empirique source de vérité pre-inscription · mots simples en tête d'arbitrage · séparation livrable (cahier) / journal (arbitrages).

## Principes transversaux actifs (détail au journal)
**« Avoir le choix »** (A2 généralisé) · **« Pas d'API »** (tout sous Max ; MCP frugal ; API/local en repli, OFF par défaut) · **« Un seul guichet »** (Claude Code = canal · orchestrateur local = colonne · LLM = cerveau · Cowork/Navigateur résiduels) · **« Roue de secours »** (Max→x20→API→local dormant ; *structure pas substrat*) · **« Ne pas multiplier les commandes vocales »** (doc `01`) · **Mandat « entité »** (conv 9 : proposer au-delà de l'acté quand ça sert à créer une entité — flaggé ⚠️, acté par Yohann, tracé §7 du doc concerné).

---

## Phases projet (pattern v3.1)
- **Phase 0 — Cahier** : `docs/VISION.md` (fait ; **gelé** — le journal + les docs techniques supersèdent, supersessions tracées aux §7 des docs `01`/`02`/`03`).
- **Phase 1 — Audit du cahier** (RECOMMANDÉE Standard) : **✅ close** (conv 6, A5→A38), ordre des dépendances.
- **Phase 2 — Docs techniques** : **en cours** — ✅ `00` + ✅ `01` + ✅ `02` + ✅ `03` ; prochain `04-proactif-tablee.md`.
- **Phase 3 — Implémentation code** : tâches + tests + critères d'acceptation. **Pré-boot : synthèse des témoignages ✅ — reste l'amorçage technique + l'installation du persona v1.**

## Convention commit Git
Préfixe `[conv-N]` systématique. Branche `main` seule, commits directs **après validation utilisateur** (R5). Secrets jamais committés (`.gitignore`). **Pas de `Co-Authored-By`** — commits au seul nom de l'utilisateur (préférence actée 2026-06-21 ; outrepasse la consigne par défaut de l'outil).

## Maintenance de ce fichier (fin de chaque conv)
**REMPLACEMENT IN PLACE strict** — jamais d'accumulation ; nouveau cumulatif → `docs/journal/CLAUDE-HISTORY.md`. Zones à MAJ : État actuel · Registre des règles (retour clôture) · vigilances. Alerte si gonflement = bascule cumulatif manquée.

---

## Pour démarrer la prochaine conversation
- Lectures pilote : `docs/PATTERN…` → `CLAUDE.md` → `docs/journal/ESSENCE-Sophia.md` → `docs/journal/JOURNAL-ARBITRAGES.md` → `docs/IMPLEMENTATION.md` → `docs/VISION.md` → `docs/technique/00-socle-process.md` → `docs/technique/01-pipeline-vocal.md` → `docs/technique/02-memoire.md` → **`docs/technique/03-personnalite.md`** (socle + voix + mémoire + âme acquis). Puis le relais : `docs/journal/relais/RELAY-conv11.md`.
- **Décision centrale conv 11 : continuer la Phase 2 — écrire `docs/technique/04-proactif-tablee.md`** (couche 4 : **moteur proactif A23–A27** — battement de fond gouverné (A33) · collecteurs local-first + connecteur MCP Google (A24, scopes OAuth) · génération 2 étages filtre-déterministe→Haiku, Sonnet en escalade, **persona injecté** (A25) · garde-fous anti-spam : plafonds, règle 48h, **dédup sémantique via la prise `embed`** (A26), table `initiatives` · notification graduée par priorité (A27) — **+ mode tablée A28–A32** : déclencheur consentement mutuel + capteur santé découplé · échelle des locuteurs A29 (enrôlement, empreintes, vie sociale — biométrie : local/consenti/minimal/rare) · prise de parole « avec pas contre = esprit pas bâillon » · **vie privée des tiers A31 + `retention_policy`** (l'affordance du doc `02` attend sa politique) · retrait volontaire). **Tensions héritées à trancher** : rétention du verbatim des tiers (doc `02` §7) · **barge-in en mode tablée** (doc `01` §1 — une convive peut-elle la couper ?) · **le miroir-lien et la tablée** (doc `03` §7 — que devient « vous deux » quand des tiers existent). Même méthode (gabarit 7 rubriques · un par un · challenge intégré · audit avant de figer — croisé sur demande · validation avant inscription).
- Format : annonce brève + sujet en mots simples en tête + un par un + reco / « pourquoi pas ».

### Vigilances
- **Doc `04` = Sophia en société** : la vie privée des tiers (A31 — elle ne fiche personne ; retenir le partagé, pas ficher le tiers) et le **zéro auto-exécution** (A26) sont les deux lignes sensibles. L'âme (doc `03`) est gravée : la tablée la met en société **sans la rediscuter** — tension à la mise au détail = signaler §7.
- **Acquis — ne pas rouvrir sans décision explicite** : A5–A38 · socle `00` · voix `01` · mémoire `02` · **âme `03`**. **Le journal + les docs techniques supersèdent le cahier** (`VISION.md` gelé).
- **⚠️ Fichiers portraits/témoignages = PERSONNELS, gitignored (`portrait*.md`, `temoignage*.md`), JAMAIS sur le dépôt public — à vérifier à chaque commit** (exigence Yohann).
- **Dépendance Anthropic = VIGILANCE N°1** : FM1–FM5 ; hedge multi-provider (Max→x20→API→local) — réduit, n'élimine pas. Quota Yohann fortement sollicité → x20.
- Plan mode harness (mis-fire structurel) — géré en **texte libre** ; **ExitPlanMode au seul moment de l'inscription** (géré ainsi conv 2-10).
- **Méthode Phase 2** : gabarit 7 rubriques · challenge intégré d'office · **audit AVANT de figer** (solo systématique ; croisé 2 agents sur demande — précédents : conv 8 = 21, conv 9 = 31, conv 10 = 38 findings, tous vérifiés aux sources puis intégrés) · pleine profondeur structure, chiffres Phase 3.
- **R7 spontané + auto-challengé** ; division du travail : personnalité/vie sociale = Yohann · technique = Claude. **R8 : ne pas passer au sujet suivant tant que celui de Yohann n'est pas clos.**
- **« Pas de V2 »** · `--bare` jamais (A1) · CLI `claude -p` ≠ lib Agent SDK (à reconfirmer) · repo public (`github.com/YdvSystems`, gitleaks `pre-commit`, secrets `.env`, identité `Yohann Dandeville <contact@ydvsystems.com>`, **pas de Co-Authored-By**).
- **Essai à blanc Phase 3 — priorité n°1 : pipeline audio temps-réel.** Puis : wake word FR (🔴 F6) · AEC loopback · Whisper · TTS/timbre · embedding FR · speaker-ID · affect · seuils humeur · **purge des fichiers de session CLI (T1/T8/T13 — conditionne l'effacement ET le temps à elle, clause d'honnêteté)** · érosion longue session (E1/anti-paternalisme) · banc de dilemmes v1.
- **Anti-flagornerie = risque quotidien n°1** (Yohann teste — et le jeu va dans les deux sens désormais) · **anti-paternalisme** : proposer sans prescrire · **« Budget = jauge utilisateur fait foi »**.
- Discipline IN PLACE en clôture.

---

*CLAUDE.md v10 — YdvVoice (Sophia), profil Standard. Pattern de référence : `docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md`. Créé 2026-06-21 (v1) ; MAJ fin conv 10 (2026-07-05) — **doc `03-personnalite.md` gravé** (couche 3 complète : persona v1 entier (noyau amendé pré-boot : francité + « aucun interdit ») · T24 · humeur 3 temps (F2 résolu) · métabolisme + autodétermination · temps à elle (rêverie éphémère) · lien né vide · banc de dilemmes · test dans les deux sens ; audit solo 14 + croisé 2 agents 38 findings, tous intégrés ; retouches tracées docs `00`/`02` + ESSENCE). Prochain : doc `04-proactif-tablee`.*
