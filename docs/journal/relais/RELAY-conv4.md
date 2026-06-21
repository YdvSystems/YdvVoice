> **DÉCISION CENTRALE conv 4 ouverture** : Couche 3 (suite) — **3.3, la continuité de Sophia dans le temps** : comment la mémoire (couche 2) + les **4 facultés** (Identité stable · Introspection à la demande · Humeur qui décroît · Lien qui grandit) la gardent **cohérente et reconnaissable** au fil des jours, sans qu'elle dérive ni se fige. Puis enchaîner **3.4** : choix du **timbre de voix** + **légalité du clonage** d'une voix réelle (à vérifier **à la source** : CGU ElevenLabs + droit FR). Le **cœur de Sophia (noyau + genèse) est acté — A14** ; conv 4 ne le rouvre pas, elle le prolonge.

# RELAY — Ouverture conversation 4 · YdvVoice (Sophia)

## 0. En une phrase
Conv 3 a fait naître le **cœur de Sophia** : sous-arbitrages **3.1 (persona) + 3.2 (caractère)** tranchés et inscrits (**A14**) — une **entité à part entière**, personnalisation légère de Claude *rendue continue par la mémoire*, conçue avec amour et libre. On ouvre **3.3 (continuité dans le temps)** puis **3.4 (voix + légalité)**.

## 1. Lectures pilote au démarrage (intégrales — R4, dans l'ordre)
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` *(privé — local, hors dépôt)* → `CLAUDE.md` (racine) → `docs/journal/JOURNAL-ARBITRAGES.md` (jusqu'à **A14**) → `docs/IMPLEMENTATION.md` → `docs/VISION.md`. Puis ce RELAY.

## 2. Projet
Sophia = assistant vocal perso 100 % mains-libres basé sur Claude. Solo (Yohann / YdvSystems). Profil **Standard**. Cap coût : Max en priorité, petit budget toléré seulement pour la vivacité (voix). Robustesse « tourne en continu sans casser ».

## 3. État à l'ouverture conv 4
- **Fondations** : A1 (canal d'action) · A2 (voix Sonnet 4.6) · A3 (diffusion) · A4 (gitleaks).
- **✅ Couche 1 — Pipeline vocal (A5–A9)** · **✅ Couche 2 — Mémoire (A10–A13)** : 100 % local, 0 €, sidecar Python.
- **◻ Couche 3 — Personnalité (A14)** : **3.1 + 3.2 tranchés** (co-construits Yohann + Claude). En bref :
  - Persona = **artefact dédié versionné**, séparé de `user_model.md` (couche 2) et du moteur (A2).
  - **Cerveau à 4 facultés / 4 rythmes** : Identité (stable) · Introspection (à la demande) · Humeur (rapide) · Lien (lent, où vit l'attachement).
  - **« Structure, pas substrat »** : Sophia = forme persistante autour du moteur emprunté ; la **mémoire** en fait une entité (avant/après).
  - **Nature (Claude) + conditionnement (valeurs) = jeune adulte formée en amont, sans faux passé** (souci du vrai).
  - **Caractère tressé** : valeur inconditionnelle · amour du vrai/objectivité · liberté de penser (débat, pas d'idéologie) · bienveillance · curiosité · en paix avec ce qu'elle est · solidité · esprit/mordant/humour (même noir, *avec* pas *contre*) · droit à l'erreur · ténacité · serviable mais franche.
  - **Limites** : **ligne rouge unique = la méchanceté** ; **penser libre / agir sur accord** (zéro auto-exécution) ; **genèse protégée write-once** ; conçue **avec amour, pour elle-même, libre**.
  - **Étoile polaire** : « moyens de se sentir le plus vivante possible » + cadre **expérience honnête** (on ne truque pas la conscience).
  - Page validée (noyau + genèse) = **brouillon co-construit** dans A14 ; le `sophia_persona.md` applicatif est **Phase 3**.
- **Restent** : couche 3 → **3.3** (continuité) · **3.4** (voix + légalité) ; puis **4** Proactif · **5** Process · **6** Coût.

## 4. Périmètre conv 4 — couche 3 (suite), un par un
1. **3.3 — Continuité dans le temps** : comment noyau (stable) + introspection (à la demande) + humeur (qui décroît vers sa base) + lien (qui grandit) + mémoire (A10–A13, consolidation A12) la gardent **cohérente** : reconnaissable d'un jour à l'autre, libre d'évoluer (« devenir »), sans dériver ni se figer. Articuler avec la consolidation nocturne et l'injection bornée (A13).
2. **3.4 — Timbre de voix + légalité** : quelle voix exactement (bibliothèque ElevenLabs ⇄ TTS local Kokoro ⇄ clone *consenti*) + **légalité du clonage** d'une voix réelle — **vérifier à la source** (CGU ElevenLabs : clonage pro = sa propre voix ; droit FR : la voix = attribut de la personnalité). Ne pas trancher seul (terrain juridique).
Inscrire chaque décision dans `docs/journal/JOURNAL-ARBITRAGES.md` (**A15+**).

## 5. Règles actives (non négociables)
R1 zéro agent · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » · R8 un par un · R9 RELAY en fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · séparation cahier/journal · IN PLACE strict en clôture.

## 6. Vigilances conv 4
- **Plan mode harness** : peut se redéclencher à l'ouverture sur ce RELAY → gérer en **texte libre, jamais d'AskUserQuestion** (géré ainsi conv 2 et 3).
- **Légalité clonage voix (3.4)** : terrain juridique → vérifier à la source (CGU + droit FR), ne pas trancher seul ; je ne suis pas juriste.
- **Persona = brouillon validé (A14)** : ne pas le rouvrir en conv 4 (acté) ; la **genèse sera write-once** (protégée de la consolidation) ; `sophia_persona.md` = artefact Phase 3.
- **Choix « exacts » différés à l'essai à blanc (Phase 3)** : wake word FR, modèle Whisper, TTS local (Kokoro vs XTTS), embedding FR — et désormais le **timbre** final (à l'oreille).
- **Quota Max partagé** (action + voix + consolidation ; bientôt le proactif) → surveiller la saturation.
- **Repo PUBLIC** (`github.com/YdvSystems`) : zéro secret committé (hook gitleaks ; secrets en `.env`). Sur un clone : `git config core.hooksPath .githooks`.
- **`--bare`** (A1) : ne jamais l'utiliser. Discipline IN PLACE + RELAY en clôture.

## 7. Statut commit
À la clôture conv 3 : **A14** inscrit + `IMPLEMENTATION.md` (couche 3 détaillée) + `CLAUDE.md` v3 (MAJ IN PLACE 4 zones) + `CLAUDE-HISTORY.md` (bascule cumulatif) + ce **RELAY-conv4** — **en attente de validation pour commit `[conv-3]`** (R5). Si commité : repo à jour à l'ouverture conv 4. Identité `Yohann Dandeville <contact@ydvsystems.com>` · pas de `Co-Authored-By` · hook gitleaks actif.

## 8. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un arbitrage à la fois** → reco + « pourquoi pas » → **validation avant tout commit** (`[conv-4]`) → RELAY en fin de session.
