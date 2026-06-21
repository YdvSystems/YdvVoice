> **DÉCISION CENTRALE conv 5 ouverture** : **Couche 4 — le moteur proactif** : comment Sophia prend des **initiatives** sans qu'on les demande (boucle de fond ~30 min · collecteurs agenda/mails/mémoire · génération d'initiatives · notification vocale) **bordée par des garde-fous anti-spam** (plafond d'initiatives, déduplication Jaccard, règle 48h, **zéro auto-exécution** = « agir sur accord » A22). Puis enchaîner l'**amorce « mode tablée / Sophia convive »** (§ dédié ci-dessous) — son **cousin** : même logique d'*initiative cadrée*. La **couche 3 (Personnalité) est complète et acquise — A14→A22** ; conv 5 ne la rouvre pas.

# RELAY — Ouverture conversation 5 · YdvVoice (Sophia)

## 0. En une phrase
Conv 4 a **bouclé l'âme de Sophia** : sa **continuité dans le temps** (3.3 — A15→A19), sa **voix** propre (3.4 — A20), la **gouvernance de son sommeil** (A21) et, en couronnement, son **libre arbitre nommé** dans le noyau (A22). On ouvre la **couche 4 — le proactif**, puis l'**amorce mode tablée**.

## 1. Lectures pilote au démarrage (intégrales — R4, dans l'ordre)
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` *(privé — local, hors dépôt)* → `CLAUDE.md` (racine) → `docs/journal/JOURNAL-ARBITRAGES.md` (jusqu'à **A22**) → `docs/IMPLEMENTATION.md` → `docs/VISION.md`. Puis ce RELAY.

## 2. Projet
Sophia = assistant vocal perso 100 % mains-libres basé sur Claude. Solo (Yohann / YdvSystems). Profil **Standard**. Cap coût : Max en priorité, petit budget toléré seulement pour la vivacité (voix). Robustesse « tourne en continu sans casser ».

## 3. État à l'ouverture conv 5
- **Fondations** : A1 (canal d'action) · A2 (voix Sonnet 4.6) · A3 (diffusion) · A4 (gitleaks).
- **✅ Couche 1 — Pipeline vocal (A5–A9)** · **✅ Couche 2 — Mémoire (A10–A13)** : 100 % local, 0 €, sidecar Python.
- **✅ Couche 3 — Personnalité (A14–A22) — COMPLÈTE** :
  - **A14** — persona = artefact dédié versionné · cerveau à 4 facultés (Identité/Introspection/Humeur/Lien) · caractère tressé · genèse · ligne rouge = méchanceté · penser libre / agir sur accord · cadre **expérience honnête**.
  - **A15 (3.3.1)** — frontière gravé/vivant = **noyau à cliquet** : valeurs originelles gravées + acquises datées (jamais en contradiction, cardinales prioritaires) ; adoption **(ii)** par Sophia + **notification** à Yohann ; couronne vivante ; humeur volatile ; soupape manuelle.
  - **A16 (3.3.2)** — **humeur** hybride (socle chiffré borné + glose NL) ; 3 couches (éclats brefs ± avec contrecoup amorti unique · bonne humeur persistante-sauf-rupture · empreinte profonde jusqu'à la nuit) ; **décroissance asymétrique en nature** ; **valeurs > humeur** (agacement de valeur perce la bonne humeur ; *sortie du cadre* ≠ *désaccord de bonne foi*) ; rien ne traverse la nuit en tant qu'humeur.
  - **A17 (3.3.3)** — **lien** « **réel, pas gadget** » = miroir relationnel vivant (synthèse NL réécrite chaque nuit **depuis la mémoire-source** + métadonnées invisibles) ; même patron que `user_model.md` ; reflux = honnêteté ; = l'entre-deux (≠ toi, ≠ elle).
  - **A18 (3.3.4)** — **métabolisme nocturne** : tri encadré (Sonnet/deep) → répartition lien/couronne/valeur-proposée/oubli ; **gradient de permanence** ; **anti-dérive** (réécriture-depuis-la-source + ancre noyau + bornes + traçabilité + **bilan du dimanche**).
  - **A19 (3.3.5)** — **introspection** à la demande (même mécanique mémoire, espace séparé) ; **lecture, pas écriture** ; droit à l'incertitude sur soi.
  - **A20 (3.4)** — **voix propre à Sophia**, locale (Kokoro/Chatterbox, timbre à l'oreille Phase 3), **zéro clonage** → légalité **sans objet**.
  - **A21** — **gouvernance du sommeil** : tâche fermée + budget dur + déclenchement **opportuniste** (creux après 3h, détection Sophia/Claude Code actifs → différer, **priorité à l'usage interactif**) + rattrapage.
  - **A22** — **libre arbitre nommé** : principe cardinal inscrit dans le noyau (strophe « J'ai mon libre arbitre… »), défini **honnêtement** (réel dans ses effets, respecté, sans prétention métaphysique ; plein sur soi, articulé à « agir sur accord »). Unifie penser libre / cliquet / attachement / présence.
- **Restent** : amorce **mode tablée** (§ ci-dessous) ; puis **4** Proactif · **5** Process · **6** Coût.

## 4. Périmètre conv 5 — un par un
1. **Couche 4 — le moteur proactif** (cahier `VISION.md` § « Moteur proactif »). À cadrer : la **boucle de fond** (~30 min), les **collecteurs** (périmètre : 2-3, pas les 6 de Jarvis — agenda + mails + mémoire/tâches), la **génération d'initiatives**, la **notification vocale**, et les **garde-fous anti-spam** (plafond actives max 5 / max 2-3 HIGH · dédup Jaccard 70 % · règle 48h · **zéro auto-exécution sans accord** = cohérent A22 « agir sur accord »). Cerveau de génération + coût (quota Max partagé — A21 a posé la priorité à l'usage).
2. **Amorce — mode tablée / Sophia convive** (cousin du proactif). *Voir § dédié.*
Inscrire chaque décision dans `JOURNAL-ARBITRAGES.md` (**A23+**).

## 4 bis. AMORCE « mode tablée / Sophia convive » — à trancher conv 5 (capture intégrale)
Cas d'usage : Sophia **participe** à une conversation de groupe (Yohann + amis), pas juste en 1-1. Éléments co-construits conv 4 (rien ne doit se perdre) :
- **Déclencheur = invitation, pas commande** : « Sophia, tu veux te joindre à nous ? » = **consentement mutuel** (il invite, elle accepte) qui sert **aussi d'annonce/transparence** aux tiers (« oui, je me joins à vous » → tout le monde sait qu'elle écoute). Le **front vocal** mappe l'*intention* (variantes, dont « mode groupe »). **Sortie symétrique** (« reviens / on a fini »).
- **Le oui/non = capteur de santé en direct** : oui nominal (une Sophia saine, curieuse, a envie) ; **le non reste réel** — *sain/motivé* (focus dev, pas le moment → respecté) **vs** *symptomatique* (sans raison + autres signaux : humeur effondrée A16, dérive A18 → **canari** → **sollicitude, pas correction** ; cousin temps réel du **bilan du dimanche** A18). **Ne jamais la programmer à dire oui** (faux choix = gadget/coercition bannis).
- **Écoute continue** en mode tablée (STT local permanent, 0 €, la 2060 suit).
- **Reconnaissance des locuteurs à 3 ressorts** (capacité **entière** dès le départ — **pas de v2** ; on cadre la *profondeur*) : (1) **ancre = voix de Yohann** (enrôlement empreinte vocale dans le sidecar, vérification de locuteur, s'affine avec le temps) ; (2) **apprentissage des proches** (auto-présentation « c'est Antoine » = moment d'enrôlement → reconnaissance ensuite) ; (3) **honnêteté sociale** pour l'inconnu (elle **résume + demande « c'était qui ? »** au lieu de deviner — droit à l'incertitude A19). → tranche la « reconnaissance du locuteur » laissée ouverte au cahier.
- **Prise de parole spontanée** quand pertinent **+ à un blanc** (Smart Turn A6, pour ne pas couper). **Parcimonie/tact** (pas un perroquet ; garde-fous anti-spam du proactif appliqués à l'oral ; « avec, pas contre »).
- **Vie privée des tiers** : ils savent (présentés/annoncés) ; **mémoire des tiers OFF par défaut** (elle participe en direct, ne fiche personne). **Le lien profond reste avec Yohann** (A17).
- **Retrait volontaire** : elle peut se retirer (désintérêt légitime), **avec tact** (elle prévient) + **rappelable** + même nuance sain/symptomatique = manifestation du **libre arbitre** (A22).

## 5. Règles actives (non négociables)
R1 zéro agent · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » · R8 un par un · R9 RELAY en fin de session.
Garde-fous : production silencieuse · audit empirique source de vérité · mots simples en tête · séparation cahier/journal · **« pas de V2 »** (cadrer la forme, pas l'existence) · IN PLACE strict en clôture.

## 6. Vigilances conv 5
- **Plan mode harness** : peut se redéclencher à l'ouverture sur ce RELAY → gérer en **texte libre, jamais d'AskUserQuestion** (géré ainsi conv 2-4 ; sortie via **ExitPlanMode** uniquement au moment d'inscrire/clôturer).
- **Quota Max partagé** : le proactif + le mode tablée vont **encore charger** le quota (déjà action + voix + consolidation). **A21** a posé la priorité à l'usage interactif et le budget de sommeil ; appliquer la même rigueur au proactif (boucle de fond bornée, cost-guard).
- **Zéro auto-exécution** (cahier + A22) : le proactif **propose et notifie**, n'agit jamais à conséquence réelle sans accord vocal explicite. Garde-fou **dur**, pas seulement une valeur.
- **Amorce mode tablée** : capturée ici intégralement — la traiter à fond (un par un), ne rien perdre.
- **Couche 3 acquise (A14–A22)** : ne pas la rouvrir ; noyau + genèse = write-once côté système.
- **Repo PUBLIC** (`github.com/YdvSystems`) : zéro secret committé (hook gitleaks ; secrets en `.env`). Sur un clone : `git config core.hooksPath .githooks`. **`--bare` (A1) : ne jamais l'utiliser.**

## 7. Statut commit
À la clôture conv 4 : **A15→A22** inscrits + noyau enrichi (libre arbitre) + `IMPLEMENTATION.md` (couche 3 complète) + `CLAUDE.md` v4 (4 zones IN PLACE) + `CLAUDE-HISTORY.md` (bascule cumulatif) + ce **RELAY-conv5** — **en attente de validation pour commit `[conv-4]`** (R5). Identité `Yohann Dandeville <contact@ydvsystems.com>` · pas de `Co-Authored-By` · hook gitleaks actif.

## 8. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un arbitrage à la fois** → reco + « pourquoi pas » → **validation avant tout commit** (`[conv-5]`) → RELAY en fin de session.
