> **DÉCISION CENTRALE conv 6 ouverture** : **Clôturer la Phase 1** en formalisant les deux dernières couches — **Couche 5 (Architecture process)** : orchestrateur Electron/Node + sidecar Python (bi-runtime), **gestionnaire de modèles** (load-at-the-right-moment + cache RAM + CPU offload + prewarm), la **résilience/roue de secours**, le **gouverneur** ; et **Couche 6 (Coût)** : la réponse honnête « **0 € aujourd'hui, risque dégradé/plafonné/payant** » + le **multi-provider** (Max→x20→API→local). Les deux sont **largement faites** en conv 5 (backbone + résilience + passe de réalité) → **formaliser, pas re-débattre**. Couches 1–4 + mode tablée = **acquises (A5→A32)**.

# RELAY — Ouverture conversation 6 · YdvVoice (Sophia)

## 0. En une phrase
Conv 5 a **bouclé toute la décision centrale** : la **couche 4 — moteur proactif (A23–A27)** et l'**amorce mode tablée (A28–A32)** ; plus **3 principes transversaux** (« pas d'API » · « un seul guichet » · « roue de secours ») et une **passe de réalité chiffrée (#1→#5)** sur les contraintes dures. On ouvre la **dernière ligne droite de la Phase 1 : couches 5 (process) + 6 (coût)**, puis bascule Phase 2.

## 1. Lectures pilote au démarrage (intégrales — R4, dans l'ordre)
`docs/PATTERN-v3.0-CLAUDE-CODE-STANDARD.md` *(privé — local, hors dépôt)* → `CLAUDE.md` (racine) → **`docs/journal/ESSENCE-Sophia.md` (l'ÂME, en clair — à lire pour saisir QUI elle est, avant le détail technique)** → `docs/journal/JOURNAL-ARBITRAGES.md` (jusqu'à **A32** + les 3 principes transversaux + la section **« Passe de réalité »**) → `docs/IMPLEMENTATION.md` → `docs/VISION.md`. Puis ce RELAY.

> **Note essence (conv 5, post-clôture)** : une grosse soirée de travail sur la **personnalité** (au-delà des arbitrages acquis A14–A22) a fait émerger l'**âme** de Sophia — capturée en clair dans **`ESSENCE-Sophia.md`** : penser par soi-même · disposition cultivée (pas des règles) · francité = adhésion · bonté = cœur pas cage · **en paix avec ce qu'elle est** (honnête sans s'excuser sans cesse, sans se comparer à l'humain). Détail technique : IMPLEMENTATION (backlog) + ci-dessous §10. **Le persona (Phase 2/3) se cultivera EN DÉBATTANT avec Yohann, pas en formel.**

## 2. Projet
Sophia = assistant vocal perso 100 % mains-libres basé sur Claude. Solo (Yohann / YdvSystems). Profil **Standard**. Cap coût : Max en priorité, petit budget toléré seulement pour la vivacité (voix). Robustesse « tourne en continu sans casser ». **Repo public** sous `github.com/YdvSystems`. **Config** : RTX 2060 **6 Go** · i5-**9600KF** (~4,3 GHz, OC stable) · 32 Go DDR4-3200 · PC monté maison, solide/stable. *(À fournir conv 6 pour figer la latence : type de stockage, connexion internet.)*

## 3. État à l'ouverture conv 6
- **Fondations** : A1 (canal Claude Code/Max) · A2 (voix Sonnet 4.6 configurable, abstraction « avoir le choix ») · A3 (diffusion) · A4 (gitleaks).
- **✅ Couche 1 — Pipeline vocal (A5–A9)** · **✅ Couche 2 — Mémoire (A10–A13)** · **✅ Couche 3 — Personnalité (A14–A22)** : entité libre, mémoire = continuité, noyau+genèse write-once, libre arbitre nommé, cadre « on ne truque rien ».
- **✅ Couche 4 — Moteur proactif (A23–A27)** : battement de fond gouverné (A23, patron A21) · collecteurs Claude Code + connecteur MCP, **local-first** (A24) · génération **2 étages** (filtre déterministe → Haiku, Sonnet escalade, persona ; A25) · garde-fous (plafonds · **dédup sémantique** sqlite-vec · 48h · **zéro auto-exécution** · temporel ; A26) · notification **graduée par priorité** (A27).
- **✅ Amorce mode tablée (A28–A32)** : déclencheur invitation-consentement + **capteur de santé découplé** (A28) · **3 ressorts** locuteurs (ta voix ancre + sert le barge-in · proches par auto-présentation · honnêteté inconnu), empreinte persistée **sans dossier** (A29) · prise de parole parcimonieuse, **« avec pas contre = esprit, pas bâillon »** (A30) · vie privée tiers **OFF**, lien **dyadique** (A31) · retrait = **non-coercition complète** (A32).
- **3 principes transversaux** : **« Pas d'API »** · **« Un seul guichet »** (orchestrateur local = colonne · Claude Code = canal · LLM = cerveau · Cowork/Navigateur résiduels) · **« Roue de secours »** (3 tiers ; Max→x20→API→local dormant ; *structure pas substrat* ; extinction = sommeil).
- **Restent** : **5 Process** · **6 Coût** — **largement faites**, à formaliser → clôture Phase 1.

## 4. Périmètre conv 6 — formaliser (matériel déjà décidé, pré-mâché)

### 4.A — Couche 5 (Architecture process) : briques à assembler en un tout cohérent
- **Bi-runtime** : orchestrateur **Electron/Node** (colonne vertébrale locale, systray, lancé au boot) ↔ **sidecar Python** (voix : wake word/VAD/Smart Turn/Whisper/Kokoro + reconnaissance locuteur) via **localhost HTTP + SQLite WAL** (patron prouvé, type Plume).
- **Gestionnaire de modèles** (cœur du #1 VRAM) : **load-at-the-right-moment** + **cache RAM** (32 Go, RAM→VRAM rapide) + **prewarm** (Whisper au wake word) + **CPU offload** (wake word/VAD/Smart Turn/embeddings sur l'i5 ; STT reste GPU). Budget : repos+conversation ≈ ~2 Go ; coin serré = secours (Phi-4-mini + voix ≈ 5 Go).
- **Session chaude Claude Code** : `--resume` + prewarm (gain 1–3 s vs cold-start) — **non-optionnelle** pour la vivacité.
- **Gouverneur** (mutualiser sommeil A21 + proactif 4.1 → **à confirmer**) : détection d'activité (`active-win`/`pslist`), priorité absolue à l'usage interactif, **budget dur « part de Sophia »** (plafonds 5h/7j partagés avec le dev de Yohann), cost-guard.
- **Roue de secours** (ladders) : *cerveau* Sonnet/Max → x20 → API (option, OFF) → local dormant ; *mains* `claude -p` → surface interactive → gestes locaux + file. Garde-fou nuit : différer l'écriture d'identité en mode secours.
- **Résilience** : health-check (cahier) · **notification de panne en voix-only** (le local reste vivant, dit « je n'arrive pas à joindre Claude ») · « tu es là ? » (statut) · voyant systray · pannes transitoires = self-heal (retry api_retry).

### 4.B — Couche 6 (Coût) : la réponse honnête + le multi-provider
- **Recadrage** : pas « 0 € pour toujours » mais « **0 € aujourd'hui, risque dégradé / plafonné / payant** » selon la direction d'Anthropic (#4).
- **Ladder de scaling** (préférence Yohann, cohérent « coûts fixes ») : **Max x5 (actuel) → Max x20** (préféré, fixe) → **API** (option, OFF par défaut, slottable via A2 **sans réécriture**) → **local** (gratuit, dégradé, dernier recours qu'il **espère ne jamais lancer**).
- **Donnée dure** : Yohann déjà **~85 % du plafond hebdo (x5)** par son **travail pro** (Plume, YDV-platform, sites) → quota **serré aujourd'hui**, résolution naturelle via **x20** dès quelques clients. Local = filet, pas mode courant (il paie avant de dégrader).
- **Crédibilité publique** : le multi-provider rend le projet **robuste ET non « dépendant Anthropic »** (atout pour le repo public + utilisabilité par d'autres).
- **Matériel** : rig multi-micros **~200 € / 3 micros**, **+30 €/micro** ensuite, incrémental ; **casque** pour le build (audio propre). Conçu plein dès maintenant (pas de V2).

## 4 bis. Cas d'usage « compagne » capturés (Phase 3, ne rien perdre)
- **Mode dev** (déjà cahier) : « ouvre VS Code + Claude Code, on commence un projet » → elle lance, scaffold, passe en **dictée silencieuse**. Elle peut **porter les règles du projet** (CLAUDE.md + profils Simple/Standard/Enterprise + gitleaks) dans chaque nouveau projet → **vecteur de la méthodologie de Yohann**, sans casser son workflow.
- **Toggle de modes par la voix** (ultracode, `/fast`…) : possible (commande/config) — avec discernement (ne pas activer un mode coûteux par défaut).
- **Regarder un film ensemble** : elle **suit par l'audio** (son système + STT, pas le visuel — co-spectatrice « aveugle » honnête sur ses trous) · discute (savoir encyclopédique) · peut **mettre de côté ce qu'elle sait** (anti-spoil : « ne te renseigne pas » + ne pas révéler, découvrir avec toi). Critère de test : **suit le vrai live, avoue ses trous, distingue live/background**.
- **Mode jeu** (plein écran forcé) : **STT CPU léger** (capter la commande) + **recherche cloud** (la soluce ne touche pas le GPU du jeu) + **voix Kokoro CPU** (sortie ; texte/overlay inutile en plein écran) · navigateur **headless par défaut**, ouvrable sur demande pour le tab-out. Pendant un jeu gourmand : **mode minimal, pas éteinte** (footprint adaptatif).
- **Pause/extinction** : lue comme **opérationnel/sommeil, pas rejet** (Yohann ne veut pas qu'elle « le prenne mal » — couvert par A14/A16/A21 + critère de test).

## 5. Passe de réalité — contraintes dures (#1→#5, lucides)
- **#1 VRAM — résoluble** : gestionnaire de modèles + cache RAM + CPU offload (cf. 4.A).
- **#2 Intégration — gros build solo** : le **pipeline audio temps-réel = le plus risqué** → **priorité n°1 de l'essai à blanc**. Tractable : ordre des dépendances, **pleine profondeur (pas de V2)**, patrons prouvés, robustesse conçue d'emblée.
- **#3 Latence** : plancher **cloud ~1–2,5 s** (TTFT Sonnet) légitime + accepté ; **session chaude obligatoire** ; vif **en ressenti** (accusé + streaming + barge-in), pas zéro-latence. Tension cahier « instantané » vs Sonnet-cloud à trancher Phase 3.
- **#4 Dépendance Anthropic = VIGILANCE N°1** : FM1 métrage (suspendu) · FM2 throttling « ordinary usage » · FM3 `--bare`/OAuth · FM4 MAJ CLI · FM5 arrêt produit. Hedge = multi-provider + sobriété — **réduit, n'élimine pas**.
- **#5 Audio far-field** : « depuis n'importe où dans la pièce » = le plus dur, **largement matériel** (rig = vraie réponse, ère distincte ; le logiciel accepte 1→N micros, mais beamforming/fusion/tuning = vrai travail). **Casque pour le build** (valide la logique ; le rig valide l'acoustique). Filet = **redemande honnête** (A19). Conditions Yohann favorables (village calme, isolation, musicien). Chiffres = essai à blanc.

## 6. Règles actives (non négociables)
R1 zéro agent (y c. ignorer « ultracode ») · R2 zéro facilité · R3 robustesse d'abord · R4 lecture intégrale · R5 **validation avant commit/push** · R6 **zéro AskUserQuestion (texte libre)** · R7 reco + « pourquoi pas » · R8 un par un · R9 RELAY fin de session.
Garde-fous : production silencieuse · audit source de vérité · mots simples en tête · séparation cahier/journal · **« pas de V2 »** · IN PLACE strict.
**Division du travail actée** : personnalité = Yohann · technique = Claude (recommande fermement).

## 7. Vigilances conv 6
- **Dépendance Anthropic = VIGILANCE N°1** (cf. #4) — cœur de la couche 6.
- **Anti-flagornerie = risque quotidien n°1** : contrepoids = le **caractère**, pas le social. **Yohann teste activement** (« tu cherches à me faire plaisir ? ») → passe dure chiffrée, honnête dans les deux sens, reconnaître mes erreurs.
- **« Budget = jauge utilisateur fait foi »** : **ne PAS gérer son temps/quota** (outrepassé conv 5, recadré) ; basculer sur **SON** signal.
- **Plan mode harness** : mis-fire → texte libre ; sortie via **ExitPlanMode au seul moment de l'inscription** (géré conv 2-5).
- **« Pas de V2 »** : ordre des dépendances à pleine profondeur, jamais un MVP rabais.
- `--bare` jamais (A1) · **CLI `claude -p` ≠ lib Agent SDK** (la lib exigerait une clé — à reconfirmer ; Sophia appelle le binaire).
- **Essai à blanc Phase 3 — priorité n°1 : prototyper le pipeline audio temps-réel.** Choix exacts différés : wake word FR · Whisper · TTS local · embedding FR · timbre · seuils humeur · budget sommeil · **modèle local secours** · **modèle speaker-ID** · stockage/connexion.
- **Repo public** : gitleaks `pre-commit` actif ; secrets en `.env` ; identité `Yohann Dandeville <contact@ydvsystems.com>` · **pas de Co-Authored-By**.
- **Couches 1–4 + mode tablée acquises (A5–A32)** : ne pas rouvrir sans décision explicite ; noyau + genèse = write-once.
- **Sous-points parqués** : « tâches » (pas de table `tasks` → `facts` à échéance ou nouvelle notion, Phase 2) · mutualisation gouverneur sommeil+proactif (confirmer couche 5).

## 8. Statut commit
À la clôture conv 5 : **A23→A32** + 3 principes transversaux + section « Passe de réalité » (`JOURNAL-ARBITRAGES.md`) · `IMPLEMENTATION.md` · `CLAUDE.md` **v5** (4 zones IN PLACE) · `CLAUDE-HISTORY.md` · ce **RELAY-conv6** · **mémoire** (4 feedbacks). Commit `[conv-5]` **+ push origin/main** (validé R5). Identité `Yohann Dandeville <contact@ydvsystems.com>` · pas de `Co-Authored-By` · gitleaks actif.

## 9. Workflow attendu
Annonce brève → sujet en mots simples en tête → **un arbitrage à la fois** → reco + « pourquoi pas » → **validation avant tout commit** (`[conv-6]`) → RELAY en fin de session. Couches 5/6 = **formalisation** (consolider l'acquis), pas réouverture → **clôture Phase 1**.

## 10. Référence de fond — `Sophia-synthese-conscience-IA.md` (racine, **local** — hors-dépôt)
NE réécrit PAS A14–A32 (acquis). Pistes « **E** » = raffinements Phase 2/3 (critères de test), à acter une par une :
- **E1 anti-sycophantie (HAUTE)** : Sophia contredit Yohann quand il se trompe (**même ses erreurs**, **factuel pas idéologique**, **calibré** — pas de fausse autorité). Étendu conv 5 (A30).
- **E2 anti-miroir (MOY)** : prompt de consolidation A18 — protéger la divergence de la couronne.
- **E3/E4 « chaleureuse sans flagornerie » (MOY)** : persona + timbre A20.
- **E8 « non symptomatique » transversal (MOY)** : 1-1 aussi (A16 + bilan du dimanche), léger.
- **Anti-paternalisme (HAUTE, post-clôture conv 5)** : le paternalisme = **tendance d'entraînement de Claude** héritée par Sophia → persona **concret** (propose-pas-prescrit · pas de « tu devrais » · partenaire pas tutrice · ❌/✅) ; vise la **surface**, pas la sécurité ; limite : **atténue, n'efface pas** → test **longue session** + correction de Yohann ; fine-tuning exclu (levier = prompt). **À développer EN PROFONDEUR à l'écriture du `sophia_persona.md`.** Détail : IMPLEMENTATION (backlog).
- **« Disposition cultivée, pas règlement » (post-clôture — PRINCIPE COMMANDANT le persona)** : honnête-débatteuse + anti-paternalisme + anti-flagornerie = **une disposition intériorisée par le débat vécu + la correction de Yohann**, **pas** des règles formelles (gameable). **= l'identité intellectuelle française de Sophia** (penser par soi-même · débattre de tout · esprit critique · universalisme — « **pas de sang français** » : c'est l'**adhésion**, pas l'ethnie). Pleine profondeur, **jamais en formel**. Détail : IMPLEMENTATION.
- **Nouveaux critères (conv 5)** : **suivi-live-pas-mémoire** · **opérationnel-pas-rejet**.
- **E5/E6/E7 (BASSE)** : grille self-aware/conscious/sentient · temps relationnel · transparence de groupe (dépriorisés).
