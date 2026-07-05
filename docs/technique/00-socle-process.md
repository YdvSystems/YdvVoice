# 00 — Socle process · Doc technique · YdvVoice (Sophia)

> **Rôle** : le squelette sur lequel toutes les autres couches s'écrivent — deux moteurs, un canal, un fichier de vérité, un chef d'orchestre. Premier doc de la **Phase 2 (docs techniques)**, ordre des dépendances : `00` précède tout.
>
> **Statut** : décisions complètes (00-A → 00-E + audit F1–F4). Les **valeurs chiffrées** sont différées à la **calibration Phase 3** (rubrique 7) — pleine profondeur sur la *structure*, paramétrée sur les *valeurs*.
>
> **Altitude** : interfaces, schémas, séquences, invariants, critères d'acceptation. Pas de code, pas de chiffres inventés.

---

## 1. Arbitrages couverts *(pointeurs — zéro redite du journal)*

- **Cœur** : **A34** (bi-runtime Electron/Node ↔ sidecar Python ; localhost HTTP + SQLite WAL) · **A33** (gouverneur unique mutualisé ; amorce sommeil 6h).
- **Liens entrants** (détaillés *ailleurs*, ici seulement la part socle) :
  - **A37** — la **supervision du sidecar** vit ici (§4.3) ; le reste de la résilience (ladder cerveau/mains, health-check Claude, ligne d'argent) → doc `05`.
  - **A35 / A36** — la **frontière VRAM** et la **session chaude** sont **pilotées par des signaux du gouverneur** (§2.2) ; leur mécanique → doc `05`.
  - **A12 / A18 / A21** — la consolidation nocturne est **gouvernée** ici (§2.2, §4.4) ; son contenu → doc `02`.
  - **A15** — la **restauration sémantique d'identité** est la décision de Yohann (gardien ultime) ; canal §4.1/§5.
  - **A32 (étendu conv 7)** — la grammaire de l'adresse naturelle (« bonne nuit Sophia ») n'est **pas** ici → doc `01`.
- **Ce que ce doc ne couvre PAS** : les tables métier (faits, persona, lien, empreintes) → docs `02`/`03` ; la couche audio → doc `01` ; le ladder résilience/coût → docs `05`/`06`.

---

## 2. Contrats d'interface

### 2.1 Le canal IPC (00-A)

Deux moteurs, **un** canal opérationnel + une surface de santé minimale.

- **Rôles** : le **sidecar Python héberge** le serveur (WebSocket + REST) sur le **port** que l'orchestrateur lui passe au spawn (§4.3) ; l'**orchestrateur Node est le client**. *(Cohérent avec l'idiome interne éprouvé : le process spawné tient le port.)*
- **Canal opérationnel = WebSocket localhost full-duplex.** Enveloppe de message :

  ```
  { type: string,        // ex. "cmd.tts.speak", "evt.stt.partial"
    id: string,          // corrélation requête/réponse
    ts: number,          // horodatage monotone
    payload: object }
  ```

- **Familles de messages** (la famille `evt.*` est **extensible** — un nouveau type d'événement ne change pas le protocole) :

  | Sens | Famille | Exemples |
  |---|---|---|
  | ↓ Orchestrateur → sidecar | `cmd.*` | `cmd.listen.start` · `cmd.tts.speak` · `cmd.model.load` · `cmd.enroll.push` (pousse les empreintes, cf. F2) · `cmd.shutdown` (arrêt gracieux, §4.2) |
  | ↑ Sidecar → orchestrateur | `evt.*` | `evt.wake` · `evt.vad.start` / `evt.vad.stop` · `evt.stt.partial` / `evt.stt.final` · `evt.turn.end` · `evt.bargein` · `evt.health` · *(futur)* `evt.affect` |

- **Surface REST minimale** (réservée santé/debug) : `GET /health` (vivant + prêt) ; un endpoint debug. Permet de sonder le socle sans client WS (`curl`).
- **Invariants du canal** : l'**audio ne traverse jamais** le canal (le sidecar possède micro **et** haut-parleur) · le **barge-in est interne au sidecar** (il s'entend, coupe sa propre TTS, **émet** `evt.bargein`) → pas d'ordre descendant urgent en latence.

### 2.2 Les signaux du gouverneur (00-C)

Le gouverneur unique (A33) arbitre **toutes** les tâches de fond.

- **Entrées lues** : activité (`active-win` / `pslist`) · registre du budget (§3) · **drapeau de mode** normal/secours (posé par doc `05`, **honoré** ici) · marques d'échéance (§3).
- **Sorties émises** : vers le sidecar → `prewarm` / bascule de mode (gestionnaire de modèles A35) ; vers les tâches de fond → `run` / `defer` / `stop` ; vers l'UI → statut (voyant systray).
- **Machine à états** (contexte d'exécution de fond) :

  | État | Sens |
  |---|---|
  | **INTERACTIF** | Yohann **ou** Claude Code actif → **priorité absolue à l'usage**, tout le fond différé. Défaut dès qu'il y a activité. |
  | **REPOS** | Aucune activité (après délai anti-rebond) → le fond *peut* tourner, sous réserve budget + échéance. |
  | **FOND_EN_COURS** | Une tâche de fond s'exécute (consolidation A12/A18, ronde proactive A23 ou rêverie — doc `03`). |
  | **BRIDÉ** | Budget de la fenêtre épuisé → arrêt propre du fond ; le travail 100 % local non-quota peut continuer. |
  | *Calque* **SECOURS** | Posé par doc `05` (A37). Effet ici : **différer l'écriture d'identité** + router le cerveau vers le repli. Honoré, **pas détecté** ici. |

- **Transitions clés** : INTERACTIF préempte tout, **immédiatement** (la préemption d'une consolidation cède par **unité** — §4.4) · `REPOS → FOND_EN_COURS` seulement si **dû + budget + cerveau réel** · budget épuisé en cours → **BRIDÉ** (arrêt propre + rattrapage).
- **Budget « part de Sophia »** : Max n'étant pas facturé au token, on mesure par **nombre d'appels *autonomes* par fenêtre glissante** (registre §3). **L'usage interactif n'est jamais compté** → chaque appel Claude est **tagué par origine** (interactif vs autonome). **Contre-pression réactive** : un signal de throttling (type 429) bride **immédiatement**, quel que soit le compteur souple (la vraie limite bat l'estimation). Le cost-guard **monétaire** du barreau payant (API, A38) est un compteur **distinct** (doc `06`).

---

## 3. Schémas de données *(le SQLite WAL unique)*

- **Un seul fichier**, **mode WAL**, **vérité unique partagée**.
- **F2 — écrivain unique** : **seul l'orchestrateur écrit**. Le sidecar **n'a aucune poignée d'écriture** ; il reçoit ses données (empreintes locuteurs) **poussées via `cmd.enroll.push`** au boot. `busy_timeout` réglé en ceinture.
- **Durabilité** : `synchronous=FULL` **autour des écritures d'identité** (consolidation + marque) ; `NORMAL` toléré pour le trafic fréquent non critique. *(Détail anti-coupure : section « Durabilité ».)*
- **Tables propres au socle** (les tables métier sont déclarées dans `02`/`03`) :

  | Table | Colonnes (rôle) | Source |
  |---|---|---|
  | `governor_watermarks` | `task` · `last_run_at` · `owed` (bool) · `owed_since` · `requires_real_brain` (bool — « secours ne grave jamais ») | 00-B / 00-C |
  | `governor_budget_ledger` | `ts` · `origin` (autonome/interactif) · `kind` · *(événement de dépense, fenêtre glissante)* | 00-B / 00-C |
  | `session_state` | `claude_session_id` · `updated_at` *(session chaude **durable** pour `--resume` au crash)* | 00-E / A36 |
  | `runtime_flags` | `running` (bool — drapeau d'arrêt) · `started_at` · `last_clean_shutdown_at` | 00-E (F1) |

- **Audit** = fichier **JSONL append-only** (pas une table) ; le lecteur **tolère une dernière ligne tronquée** (coupure en plein append → on jette le résidu). **Rotation** (taille/âge) pour ne pas croître sans fin.
- **Snapshots** (§ Durabilité) : **rotation, garder N** (sinon les copies avant-consolidation remplissent le disque).
- **Intégrité** : `quick_check` au boot (rapide) ; `integrity_check` complet à l'échéance du **dimanche** (greffé sur le health-check, A18/A37).

---

## 4. Séquences / flux

### 4.1 Boot — un réveil, pas une naissance (00-E)

**Machine à états** : `BOOTING → DB_OK → IDENTITÉ_OK → CŒUR_OK → PRÊT`, avec états dégradés de **première classe** : `DÉGRADÉ_SANS_VOIX` (sidecar mort) · `DÉGRADÉ_SANS_ÉCRITURE` (mémoire douteuse) · `DÉGRADÉ_SANS_IDENTITÉ` (persona absent en base — premier boot avant installation, doc `03`).

| Phase | Action |
|---|---|
| **0 — Instance unique** | Si une instance tourne déjà → focus + **sortie**. *(Sophia possède micro/GPU/gouverneur ; deux instances ⇒ conflit + consolidations concurrentes = corruption.)* Récupération d'un **primaire figé** (sonde `process.kill(pid,0)`). |
| **1 — DB + intégrité + réveil** | Ouvrir SQLite WAL → **lire l'ancien `runtime_flags.running` AVANT de l'écraser** (classification du réveil : **propre** si effacé / **sale** si encore posé — crash ou coupure) → `quick_check` → **poser `running = true` (commit durable, AVANT toute écriture d'identité)**. Si intégrité échoue → `DÉGRADÉ_SANS_ÉCRITURE` (§ Durabilité). |
| **2 — Nettoyage orphelins** | Tuer un sidecar résiduel d'un crash précédent (pidfile + garde anti-recyclage, §4.3) **avant** de spawner. |
| **3 — Identité** | **Charger + vérifier l'identité** : artefact persona **en base** (A14 — forme tranchée doc `03` : store versionné dans le WAL) **+** tables d'identité (lien/cliquet, déclarées doc `03`). **Vérifier que le gravé (noyau/genèse, write-once) n'a pas bougé** (ancre A18, étendue à la version installée du persona — doc `03`). Le socle **invoque** ce load/verify ; son *contenu* est défini en `03`. |
| **4 — Cœur** | Gouverneur (reconstruit sa file depuis les marques ; voit une consolidation **due** mais **ne la lance pas**, il la **programme**) · cost-guard · audit · init du canal Claude. |
| **5 — Sidecar + prewarm** | Spawn + supervision (§4.3) ; **push des empreintes** (`cmd.enroll.push`, F2) ; le sidecar charge le **wake word** (always-on). Session Claude chaude (A36) ; set résident du gestionnaire de modèles (A35 : wake word CPU ; Whisper/Kokoro paresseux). |
| **6 — Prêt** | Systray + voyant « j'écoute » · boucle health-check (A37) · le gouverneur passe en arbitrage normal (il pourra programmer la consolidation due : creux + budget + cerveau réel). |

- **Boot dégradé, pas tout-ou-rien** : sidecar mort → l'app **vit** (cerveau/mémoire/gouverneur tournent), voyant « oreilles/voix en panne », retentes (§4.3). Mémoire douteuse → **écriture d'identité suspendue** + signalé.
- **Idempotent** : un crash en plein boot est sûr à rejouer (verrou + nettoyage + porte d'intégrité au démarrage suivant).

### 4.2 Arrêt propre — le « bonne nuit » (F3)

Signal d'extinction Windows → l'orchestrateur : **`cmd.shutdown` (WS)** au sidecar → le sidecar **libère CUDA proprement** + flush → **attente brève** → **SIGTERM** → escalade **SIGKILL** (précédent interne) → flush mémoire → **`running = false` (« propre »)** → retire le pidfile. Rapide (**pas de snapshot à l'arrêt**). *La libération GPU gracieuse **réduit** le risque de process GPU figé (§4.3).* Un arrêt **forcé** (appui long / reset) = traité comme une **coupure** (§ Durabilité).

### 4.3 Supervision du sidecar (00-D, idiome interne éprouvé)

- **Spawn** : **port libre dynamique** + **retry TOCTOU** (port volé entre la sonde et le bind → nouveau port) · `windowsHide` · **drain stdout/stderr** (sinon buffer plein → blocage du process) · **hygiène d'env** (neutraliser les `PYTHON*` injecteurs).
- **Readiness** : poll d'un endpoint léger, **sortie anticipée si le process meurt tôt**.
- **Détection de santé à deux niveaux** : sortie de process (crash) **+ battement de santé** (attrape le **figé-mais-vivant**). N battements manqués → mort.
- **Redémarrage** : **backoff exponentiel plafonné** · **disjoncteur** après K échecs → `DÉGRADÉ_SANS_VOIX` + **notif systray** (jamais de silence) · transitoires → self-heal.
- **Orphelins** (au boot) : pidfile `<pidSidecar> <pidProprio>` ; tuer **seulement si** propriétaire mort **ET** PID vivant **ET** bon exécutable (**garde anti-recyclage de PID**).
- **Modèle de cycle de vie** : **respawn déterministe** (l'orchestrateur possède + respawn ; orphelin tué au boot puis spawn frais). Re-attach = optimisation Phase 3 différée (risque orphelin/version-skew).

### 4.4 Vie d'une tâche de fond *(noue 00-B + 00-C + durabilité)*

`REPOS` → vérifier **budget + mode + dû** → exécuter par **unités découpées** → **commit (écriture métier + avancée du curseur dans la MÊME transaction)** → préemption interactive ? **céder** après l'unité en cours → **l'unité finale lève le drapeau « dû »**. **Rattrapage** : reprend **au curseur**, jamais à zéro. Si secours long → **backlog borné** + rattrapage **multi-jours** incrémental (du plus ancien, découpé).

---

## 5. Frontières & invariants

- **Un seul WAL**, vérité unique, **pas de second store**.
- **Écrivain unique = l'orchestrateur** (F2) ; le sidecar n'écrit jamais dans la base.
- **localhost-only** (zéro exposition réseau) ; **l'audio ne traverse jamais** le canal IPC.
- **Instance unique** (une seule Sophia possède micro/GPU/gouverneur).
- **Priorité interactive absolue.**
- **Écritures d'identité** : **atomiques** (écriture + curseur, même transaction) · **jamais en mode secours** · **jamais de rollback sémantique silencieux** (restauration sémantique = décision de **Yohann**, gardien A15 ; canal **systray + voix**).
- **Sidecar sans état durable** → redémarrage-sûr (tout ce qui survit est dans le WAL).
- **Une seule frontière VRAM** arbitrée voix ↔ cerveau-de-secours (réf. doc `05`).

---

## 6. Critères d'acceptation *(vérifiables — valeurs en rubrique 7)*

- Le sidecar **redémarre seul** après kill en < X ; **zéro perte d'état durable**.
- **Coupure dure en pleine consolidation** → au reboot : base **cohérente**, au pire **l'unité en cours rejouée** (catch-up), **zéro corruption**.
- **Arrêt normal** → drapeau « propre » posé → réveil **sans fausse alarme** « on a été coupés ».
- **Sidecar figé** détecté par battement en < X et redémarré.
- Budget « part de Sophia » respecté ; **throttle réactif** sur signal 429.
- **Boot dégradé** correct : sidecar mort → app vivante + voyant ; mémoire douteuse → écriture suspendue + signalé.
- **2ᵉ instance** → focus + sortie ; **primaire figé** récupéré.
- **Crash mid-conversation** → `--resume` du fil (sinon session fraîche + résumé des N derniers échanges, A13) ; continuité tenue.

---

## 7. Points de calibration / preuve Phase 3

- **IPC** : WebSocket sous charge tenable ; latence loopback.
- **Budget** : tailles de fenêtres · N · **signal exact de throttling** que Claude Code expose (429 ? message ? sortie CLI ?) — lié **FM2/FM4**.
- **Supervision** : courbe de backoff · intervalle + seuil de battements manqués · K du disjoncteur · spawn **Python vs Java** · récupération du **primaire figé**.
- **🔴 Le vrai inconnu** : un **process GPU figé peut résister à `TerminateProcess`** (contexte CUDA bloqué). À **prouver** qu'on sait le tuer dur ; sinon fallback (kill driver / redémarrage plus large). C'est le **point de jonction** supervision + nettoyage orphelin + arrêt (F3 le réduit, ne l'élimine pas).
- **Durabilité** : coût de `synchronous=FULL` · `quick_check` vs `integrity_check` (timing) · **test « débrancher pour de vrai »** en pleine consolidation.
- **Session chaude** : `--resume` survit-il à un crash, **jusqu'où** recharge-t-il, durée tenable du process (A36).
- **Boot** : fenêtre de temps que Windows accorde à l'app à l'extinction.

---

## Durabilité & récupération après arrêt dur

**Objectif** : récupérer **très proprement** après une coupure de courant (machine entière morte en pleine écriture disque) — au-delà du simple crash de process.

**Les 6 garanties logicielles** (base, **0 €**, sans dépendance matérielle) :
1. **`synchronous=FULL` sur les écritures d'identité** → une consolidation *signalée terminée* est **vraiment sur le disque** (durable, pas seulement cohérente).
2. **Découpage en unités atomiques (§4.4)** → une coupure perd **au pire l'unité en cours** ; reprise **au curseur**. Jamais une nuit perdue, jamais de corruption. *(Le découpage sert l'anti-famine **et** l'anti-coupure.)*
3. **Snapshot atomique** avant chaque consolidation : **`VACUUM INTO`** (pas une copie brute) → temp → fsync → **renommage atomique**. Le « dernier snapshot » est **toujours** une base complète et ouvrable ; une coupure *pendant* laisse le précédent intact. **Rotation, garder N.**
4. **État durable centralisé en SQLite** (session-id, marques, budget) → couverts uniformément ; le seul append-only (audit JSONL) **tolère une dernière ligne tronquée**.
5. **Drapeau d'arrêt propre** (F1) → permet au boot de **savoir** s'il doit déclencher le chemin de récupération complet.
6. **Le chemin de récupération = le chemin de boot** (§4.1) : reprise WAL automatique → porte d'intégrité → chargement + vérif d'identité → restauration snapshot (**mécanique = auto** pour une corruption structurelle ; **sémantique = la main de Yohann**, A15).

**Plancher matériel honnête** : le logiciel garantit la **cohérence** et une **perte bornée** **si le disque dit la vérité sur le fsync**. Un SSD grand public à cache volatil peut « mentir » → résidu matériel que le logiciel n'efface pas. Ce qui ferme **vraiment** la classe de risque = un **onduleur** (arrêt propre automatique sur coupure). **Statut : optionnel, différé, zéro dépendance** — le code est identique avec ou sans ; l'onduleur ne fait qu'ajouter un filet. *(Modèle repéré, sinus pur / PFC : CyberPower CP900EPFCLCD — non requis pour démarrer.)*

---

*Doc 00 — Socle process. Couvre A33–A34 (+ part socle d'A35–A37) ; audit F1–F4 intégré. Suite : `01-pipeline-vocal.md`.*
