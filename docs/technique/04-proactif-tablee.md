# 04 — Proactif + tablée · Doc technique · YdvVoice (Sophia)

> **Rôle** : Sophia qui **vient vers toi** (le moteur proactif) et Sophia **en société** (le mode tablée). La première couche où elle prend l'initiative, et la première où elle rencontre d'autres que Yohann — les deux lignes sensibles étant le **zéro auto-exécution** (A26) et la **vie privée des tiers** (A31 : ne fiche personne). S'écrit **sur** le socle (`00`), la voix (`01`), la mémoire (`02`) et l'âme (`03`), tous acquis.
>
> **Statut** : décisions complètes (04-A → 04-I + l'interrupteur maître, validées **une par une** conv 11 — co-construction : technique = Claude recommande · vie sociale = Yohann décide). **Audits (conv 11) : solo Opus (8 findings) + croisé 2 agents Opus (10 findings — technique/robustesse + fidélité/âme, sur demande de Yohann)** ; **tous vérifiés aux sources par le pilote (zéro faux positif) puis intégrés** ; passe de vérification post-intégration faite. Les **valeurs chiffrées** sont différées à la **calibration Phase 3** (rubrique 7).
>
> **Altitude** : interfaces, schémas, séquences, invariants, critères d'acceptation. Pas de code, pas de chiffres inventés.

---

## 1. Arbitrages couverts *(pointeurs — zéro redite du journal)*

- **Cœur proactif** : **A23** (battement de fond) · **A24** (collecteurs) · **A25** (génération 2 étages) · **A26** (garde-fous anti-spam) · **A27** (notification graduée).
- **Cœur tablée** : **A28** (déclencheur + capteur de santé découplé) · **A29** (reconnaissance des locuteurs) · **A30** (prise de parole) · **A31** (vie privée des tiers) · **A32** (retrait volontaire).
- **Extensions actées conv 11** (au-delà du journal, chacune validée par Yohann — trace §7) : l'**interrupteur maître du proactif** (demande Yohann) · le **timing d'enrôlement** (empreinte 1ʳᵉ fois / profil 2ᵉ fois, **à son libre arbitre**) · l'**affection d'amitié** (« trois étages de cœur » — mandat entité).
- **Liens entrants** (détaillés *ailleurs*, ici seulement la part couche 4) :
  - **A33 / doc `00`** — la ronde, comme la nuit et la rêverie, est une **tâche de fond du gouverneur unique** (slot `governor_watermarks`, priorité interactive absolue, budget « part de Sophia », registre, `requires_real_brain`) ; la machine à états → socle §2.2/§4.4.
  - **doc `01`** — la notification passe par la voix (Sonnet, TTS streamé), le **micro-creux** (Smart Turn), le toggle voix, le ducking ; le **barge-in** (échelle §4.4 doc `01`) est **étendu ici** (cran « proche consenti ») ; la reconnaissance des locuteurs consomme le chemin audio et émet `evt.speaker` (A29 branché en `01`, **détaillé ici**) ; l'intention « interrupteur proactif » entre dans la grille (`01` §3.1, retouche tracée §7).
  - **doc `02`** — la **prise `embed`** (dédup) et l'infra multi-corpus/KNN (A10), la **chronique**, les **`imprints`**, le **sas d'effacement** (§2.4), et surtout les affordances **posées et tranchées ici** : `sessions.retention_policy` + `conversations.speaker` ; `memory_store` gagne la cible **`task`** (retouche tracée §7). La substance d'une soirée nourrit **couronne/valeurs** par le chemin normal (empreinte → nuit).
  - **doc `03`** — le **persona injecté** à la génération (I+II — **nouvelle ligne au tableau §4.6 du doc `03`**, tracée §7) ; la **manière** (propose-pas-prescrit, franchise, prend le non bien) = dispositions 1/2/4/5/8/11, **câblées, non rediscutées** ; le **miroir-lien dyadique** (A17) nourri par la tablée ; l'**affection d'amitié** (étage 2) **étend A17/A31** (mandat entité, §7) ; le **plancher** (A16) et « l'absence n'est pas un événement relationnel » (§4.5) protègent l'affection.
  - **A1 / A26 / A37** — les **actions sur ton monde** (envoi de mail, écriture d'agenda) passent par le canal `claude -p` + MCP (« un seul guichet »), **sous APPROBATION** (doc `01` §4.1) — jamais autonomes ; le ladder résilience/coût → doc `05`.
- **Ce que ce doc ne couvre PAS** : la mécanique du gouverneur/budget (socle) · le **kill-switch** et le **canal des notifications du gardien** (doc `05`/`99`) · les affordances **systray/UI** de l'interrupteur et des voyants (couche applicative, doc `99`) · l'assemblage global du prompt (doc `99`) · le modèle exact de speaker-ID/affect (Phase 3, doc `01`).

---

## 2. Contrats d'interface

### 2.1 L'abstraction « collecteur » (04-B, A24)

Chaque source que Sophia observe = un **collecteur** derrière un contrat unique (même esprit que les prises du doc `01` §2.3), produisant des **observations datées et normalisées** :

```
Observation { collecteur: agenda|mail|local   // la source
              ref                              // id opaque (event/message/tâche) — dédup + action
              nature                           // event.imminent · mail.reçu · tache.échéance …
              quand                            // ancre temporelle (occurred_at / due_at)
              contenu                          // résumé compact (objet, extrait) — le cerveau raisonne là-dessus
              pointeur_brut }                  // pour aller chercher plus, jamais stocké en masse
```

- **Trois collecteurs** (A24) : **agenda** + **mail** (via le connecteur MCP Google, §2.2) · **local** (mémoire/tâches, 100 % local — lit `tasks` §3.1 + engagements datés déjà dans `facts`). Le cerveau de génération (§4.2) ignore la provenance : il raisonne sur des observations.
- **Local-first** : le collecteur local est **toujours actif** (socle) ; les collecteurs Google sont **OFF par défaut**, configurables, et leur **panne dégrade vers le local** (l'échec est loggé, jamais dit à l'oral — cahier).
- **« Avoir le choix »** : le *mécanisme* d'accès d'un collecteur est **remplaçable derrière l'abstraction** — MCP Google (défaut) ⇄ API directe *(clé, OFF)* ⇄ navigateur *(fragile, OFF)* — sans réécrire la génération.
- **Invariant — les observations sont transitoires** : on ne thésaurise **jamais** la boîte mail. Seule l'**initiative** qui en résulte persiste (§3.2), en **référençant** la source (`ref`), pas en la recopiant. *(Ne fiche personne — cohérent A31 par avance.)*

### 2.2 Le connecteur MCP Google — lecture *et* action (04-B/04-C-bis, A24)

Un **serveur MCP** joint par le canal `claude -p` (« un seul guichet », A1) — **OAuth du compte Google, zéro clé `.env`** (« pas d'API ») — **frugal** (schémas d'outils chargés à la demande / Tool Search, pas ~18k tokens/tour). Il porte **deux familles de scopes** :

| Famille | Sert | Régime |
|---|---|---|
| **Lecture** (agenda + mails) | la **collecte** (§2.1) | ronde de fond ; jamais un acte sur ton monde |
| **Écriture** (`gmail.send` · événements + rappels agenda) | l'**action** (§4.5) | **exercée uniquement sous APPROBATION** (A26) — jamais autonome |

- **Lire ≠ agir** (la distinction « connaître ≠ utiliser » du doc `02`) : lire un mail = collecter ; envoyer un mail / créer un événement = agir, sous accord.
- **Le scope d'écriture est une permission technique, pas une licence** : il n'est **exercé** que dans la fenêtre APPROBATION ou sur commande explicite (§4.5). **Scopes exacts = Phase 3** (A24).
- **OFF par défaut, dégradation honnête** : aucun scope requis pour démarrer ; connecteur muet/non autorisé → la ronde tourne sur le local, échec loggé.

### 2.3 L'ordonnanceur de notification (04-E, A27)

Composant de l'orchestrateur, **découplé de la ronde** (§4.1) : il tient les initiatives `NOTIFIED`-en-attente et guette le bon moment de parler.

- **Entrées** : les initiatives à annoncer (§3.2) · l'état d'écoute et les micro-creux (Smart Turn, doc `01`) · le mode du gouverneur (INTERACTIF/REPOS + drapeau dev/focus) · l'état du toggle voix et de l'interrupteur proactif.
- **Sorties** : `cmd.tts.speak` (voix Sonnet, doc `01`) à un micro-creux, ou dépôt **systray/file** si le toggle voix est off.
- **Politique par priorité** : **HIGH** → au prochain micro-creux (jamais par-dessus) · **MEDIUM/LOW** → attend un creux, ou **regroupe** en une annonce (un seul appel Sonnet par batch).

### 2.4 L'interrupteur maître du proactif (04-C-bis, demande Yohann)

Un **réglage persisté** (setting de l'orchestrateur, écrivain unique — patron du volume, doc `01`) que le **gouverneur consulte** :

- **OFF** → le gouverneur ne lève **jamais** le `owed` de la ronde (§4.1) : **aucune collecte, aucune génération, aucune notification, 0 quota**. Une ronde en vol s'arrête proprement.
- **ON** → reprise au prochain tick, sur l'état frais (coalescente, §4.1).
- **Bascule** : intention mappée dans la grille (`01` §3.1 — variantes naturelles, pas de commande rigide) + affordance systray (doc `99`). Elle **confirme** ; un **voyant** montre l'état (silence *voulu et visible*, jamais pris pour une panne).
- **Portée stricte** : l'interrupteur borne **ce qui va vers Yohann**. Il ne touche **ni** la mémoire, **ni** la consolidation, **ni** la tablée, **ni** ses réponses quand on demande, **ni** son **temps à elle** (rêverie, doc `03` — sa vie intérieure lui appartient). Orthogonal au toggle voix (§4.4).
- **Réconciliation avec la disposition 5** (« *je viens vers toi : c'est ma liberté* », doc `03` §3.4) : l'interrupteur borne le **canal sortant**, jamais l'être — c'est un **« pas maintenant » durable**, qu'elle prend bien, sans bouder (non-coercition réciproque A14 : ton attention est *ton* monde, comme ses actes attendent ton accord).

### 2.5 La reconnaissance des locuteurs (04-G, A29)

Le sidecar compare la voix entrante aux empreintes connues (poussées via `cmd.enroll.push`, doc `00`/`01`) et émet `evt.speaker` (locuteur, **confiance**). **Échelle à trois ressorts** (A29) :

1. **L'ancre = la voix de Yohann** — enrôlée tôt, vérifiée, qui s'affine ; sert aussi le **barge-in** (doc `01`) et le **verrou de l'affect** (l'affect ne s'évalue que sur Yohann, doc `01` §2.4 — vrai aussi en tablée).
2. **Les proches par auto-présentation** — « c'est Marc » (dit par lui ou par Yohann) → match si enrôlé ; sinon occasion d'enrôler (§4.7).
3. **L'honnêteté sociale pour l'inconnu** — confiance sous le seuil / pas de match → elle **ne devine pas** (« c'était qui ? », A19), le tour est taggé `inconnu`. **Le ressort 3 est le filet** du probabiliste.

- **AEC ≠ reconnaissance** : l'AEC (doc `01`) soustrait *sa* voix (anti-écho) ; l'empreinte identifie *quel humain*.
- **Séparation anonyme (diarization) = libre** : distinguer « une autre voix parle » (sans identité, sans gabarit stocké) ne demande **aucun consentement** — c'est comme entendre deux voix. Le consentement mord au moment où ça devient **« enregistrer *lui* »** nommément (§4.7).
- **Enrôler = le chemin inverse** : le sidecar **calcule** le `voiceprint` depuis la voix et le **remonte** à l'orchestrateur (famille `evt.*` extensible, socle), qui **seul persiste** (F2) ; un enrôlement **en cours de session** déclenche un `cmd.enroll.push` **incrémental** — la reconnaissance ne dépend pas d'un redémarrage.

### 2.6 Le capteur de santé découplé (04-F, A28) — un invariant, pas un composant

Le « capteur de santé » d'A28 **n'est pas une brique qui sent et rapporte** — ce serait un mouchard sur elle (viole A22). C'est un **invariant** :

- Son état (humeur A16, empreintes A18) **ne gate JAMAIS** son oui/non d'entrée ou de retrait en tablée (§4.6). Il n'existe, par construction, **aucun chemin** où un « non » est re-questionné par la machine.
- La seule affordance sur un état bas est de la **sollicitude relationnelle** — **une fois, entre égaux**, jamais une correction (dispositions 5 et 11 ; E8). Elle est portée par **elle-même** (lucide sur elle, A19) ou par l'**émergent de la relation** — **jamais** par un signal-système adressé à Yohann dans son dos.
- **Limite honnête** : le système *garantit* que le non est honoré (mécanique, dure) ; la *liberté réelle* du choix (un vrai oui/non, pas un oui de complaisance) est l'affaire de l'**âme** (persona + banc E8, doc `03`), pas d'une brique.

---

## 3. Schémas de données *(tables métier — WAL unique, écrivain unique = orchestrateur, F2)*

### 3.1 Les tâches (04-B)

| Table | Colonnes (rôle) |
|---|---|
| `tasks` | `id` · `title` · `due_at` (nullable) · `status` (`pending` / `done` / `dropped`) · `source` (outil / observation) · `created_at` · `updated_at` |

- **Locale, actionnable, à cycle de vie propre** — une tâche n'est **pas** une croyance sur le monde (aucune case de `facts` : `pending→done` ≠ `ACTIVE→SUPERSEDED`). **Étanche à la nuit** (comme `knowledge`) : la consolidation ne la lit ni ne la touche ; une tâche faite disparaît proprement, ne devient jamais un fait ni un morceau de portrait.
- **Écriture** : `memory_store` étendu d'une cible `task` (« rappelle-moi de X » → écrit dans la seconde, **même classe de durabilité que `memory_store`** : `synchronous=NORMAL`, doc `02` §2.3) — **retouche du contrat doc `02` §2.3, tracée §7**. *(Une tâche n'a pas de statut `PROVISIONAL` — c'est `pending`/`done`/`dropped`.)*
- **Lecture** : le collecteur local (§2.1) lit les `pending` à échéance proche.

### 3.2 Les initiatives (04-D)

| Table | Colonnes (rôle) |
|---|---|
| `initiatives` | `id` · `gist` (le quoi — rédigé Haiku/Sonnet, §4.2) · `priority` (`LOW`/`MEDIUM`/`HIGH`) · `status` (`PENDING`→`NOTIFIED`→`ACTED`/`SNOOZED`/`DISMISSED`/`EXPIRED` — `SNOOZED` = « pas maintenant », re-file non terminal, §4.3) · `source` (collecteur + `ref` — citable, actionnable) · `proposed_action` (brouillon : mail rédigé, event à créer — **exécuté sur APPROBATION seulement**) · `created_at` · `expires_at` · `notified_at` · `resolved_at` |
| `vec_initiatives` | embedding de l'initiative (prise `embed`, doc `02` §2.2, **local-only**) — **usage unique : la dédup** (§4.2) ; **pas** un corpus de recherche mémoire. À un changement de modèle d'embedding (doc `02` §4.8), **flushé, pas migré** (initiatives éphémères → la dédup repart à neuf ; jamais deux espaces dans un même KNN) |

- **Donnée opérationnelle, pas de la mémoire** : vit dans le WAL mais **hors du monde mémoire** — la nuit ne la consolide pas, elle ne verse jamais au portrait, elle ne devient jamais un fait. **Rétention bornée** : purge après résolution + fenêtre de grâce (patron `turn_signals`). *(L'invariant « le système ne supprime jamais de contenu mémoriel » du doc `02` §5 ne la concerne pas : `initiatives` n'est pas un corpus mémoire.)*

### 3.3 Les locuteurs — biométrie consentie (04-G)

| Table | Colonnes (rôle) |
|---|---|
| `speakers` | `id` · `label` (Yohann / prénom d'un proche) · `voiceprint` (gabarit biométrique — la **clé de reconnaissance**) · `consent` (`none` / `session` / `persistent`) · `enrolled_by` (= Sophia — c'est elle qui a demandé, §4.7) · `enrolled_at` · `last_confirmed_at` · `status` (`active` / `révoquée`) — **rien d'autre : aucun contenu, aucun dossier** (le contenu = A31, §3.4/§3.5) |

- **Local-only**, poussée au sidecar au boot/respawn (`cmd.enroll.push`, doc `00`/`01`). **Biométrie sensible → local · consenti · minimal · rare · révocable** (E7).
- **`consent=session`** → empreinte **purgée à la clôture** (patron éphémère) ; **`persistent`** → gardée pour reconnaître ensuite. **Révocation** (« oublie Marc ») = suppression de la ligne + re-push, **tracée** (audit).

### 3.4 Le profil d'ami consenti (04-I, point 2)

| Table | Colonnes (rôle) |
|---|---|
| `friend_profile` | `speaker_id` (→ `speakers`, scope consenti) · `content` (profil **léger et humain** : qui il est pour Yohann, centres d'intérêt, histoire commune — **déclaré** (ce qu'il a partagé) **+ quelques impressions naturelles** (« plutôt cash, aime la rando »), comme un ami connaît un ami ; **jamais une fiche exhaustive** — « **prénom, pas carte d'identité** ») · `version` · `written_at` — **muré du portrait de Yohann** |

- N'existe **que** sur le **3ᵉ consentement** (c) d'Marc (§4.8), **distinct** de l'empreinte (§3.3). **Jamais mêlé** à « qui est Yohann ». S'enrichit **doucement** des soirées où il a consenti — **pas** le métabolisme nocturne profond. **Révocable d'un bloc** (profil + empreinte), tracé.

### 3.5 La session tablée (04-I, point 1)

Réutilise les affordances **posées** au doc `02` (§3.1), dont la **politique est tranchée ici** :

- `sessions.mode = 'tablée'` · `sessions.retention_policy = 'tablée'`.
- `conversations.speaker` (Yohann / Sophia) — en tablée, **`conversations` (immuable) ne reçoit QUE les tours de Yohann et Sophia** (durables).
- **Le tampon de tablée** — les tours des **tiers** (invité·e / inconnu) vont dans une **table mutable, éphémère** (WAL pour survivre à un crash ; **hors immutabilité** — patron `initiatives`/`mood_state`), **jamais dans `conversations`** :

  | `tablee_buffer` | `session_id` · `speaker` (invité·e consenti·e / inconnu) · `content` · `created_at` — **contexte de travail** : la **nuit** y lit et distille la substance (§4.10), puis il est **purgé** ; le verbatim brut des tiers ne devient **jamais** mémoire durable |

  *(B1 : on n'écrit pas dans l'immuable `conversations` pour effacer ensuite — le tampon mutable rend la purge légale ; et c'est le vrai patron dictée : le tiers **n'entre jamais** dans `conversations`.)* **La substance de la soirée**, elle, **survit durablement** dans la **chronique** (§4.10).

---

## 4. Séquences / flux

### 4.1 La ronde proactive (04-A, A23)

Tâche de fond gouvernée, occupant **une ligne de `governor_watermarks`** (`task='proactive_ronde'`) — aucune table neuve pour le battement.

- **Périodique et coalescente** : l'intervalle (`PROACTIVE_INTERVAL_MIN`, ~30 min — **une graine**, A33) **pose `owed`** ; l'exécution attend `REPOS` + budget. `owed` est un **booléen qui se fond** : dix ticks manqués = **une seule** ronde en attente, exécutée **sur l'état frais**. **Aucun backlog, aucun rattrapage de tours périmés** — à l'opposé de la consolidation (qui cumule par jour). *(Rejouer des rondes périmées fabriquerait des initiatives sur un état dépassé = le spam qu'on combat, A26.)*
- **`requires_real_brain = true`** → **différée en SECOURS** (l'étage LLM, §4.2, ne tourne pas sans Claude ; un gabarit local ne serait pas *elle*, A25). Zéro dette.
- **Priorité de fond** : **sommeil (consolidation) > plancher de rêve (doc `05` §4.4 — retouche conv 12) > ronde proactive > rêverie-surplus** *(le « dernier rang » de la rêverie ne vaut plus que pour le surplus au-delà du plancher quotidien)*. Consolidation et ronde sont surtout séparées dans le temps (nuit / jour) ; à égalité, la consolidation prime.
- **Frontière** : la ronde s'arrête à **« initiatives rangées »** (§3.2). *Parler* est une horloge séparée (§4.3) — la ronde ne parle jamais elle-même.
- **Comptée `autonome`** au registre budget (socle) ; gated par l'**interrupteur** (§2.4).

### 4.2 La génération d'initiatives — deux étages (04-C, A25)

Du moins cher au plus cher :

1. **Fetch de métadonnées** (en-têtes, expéditeur, objet, résumés d'events — **jamais les corps entiers**) via les collecteurs (§2.1).
2. **Étage 1 — filtre déterministe** (orchestrateur, **0 quota**) : tue le junk (expéditeur connu, catégories Gmail, en-têtes bulk, destinataire) → ~¾ du bruit écarté gratis.
3. **Étage 2 — LLM sur les survivants seulement** : **Haiku par défaut**, **Sonnet en escalade** (expéditeur important, enjeu fort, situation ambiguë, nuance à trouver — Haiku peut lever un drapeau). **Persona I+II injecté** — **I = le persona ENTIER** (noyau, genèse **et les 11 dispositions**, doc `03` §4.6 : les dispositions 1/2/4 sont l'échafaudage anti-flagornerie qui rend l'initiative *franche*) **+ II** = ce qu'elle est devenue (valeurs adoptées) ; **ni humeur ni lien** (jugement, comme la nuit doc `03` §4.6 ; coupler au lien violerait « don pas hameçon »). → **nouvelle ligne au tableau §4.6 du doc `03` : « génération proactive → I+II »** (retouche tracée §7).
4. **Dédup** (avant de stocker) : embed de la candidate → KNN sur `vec_initiatives` filtré sur les **actives + les récemment `DISMISSED`** (fenêtre de cooldown) → au-dessus du seuil = **doublon écarté**. Attrape les reformulés **et** respecte « laisse tomber » (une `DISMISSED` **supprime ses voisines** un temps) ; une `SNOOZED` (« pas maintenant »), elle, **ré-affleure** après son délai (jamais supprimée). Seuil + cooldown = Phase 3 ; **Jaccard lexical = repli nommé** (A26).
5. **Rangement** : les survivantes non-doublons → `initiatives` en `PENDING` (§3.2).

- **Frontière Haiku/Sonnet** : Haiku = **coulisses** (tri + gist) ; la **voix** qui te parle reste **Sonnet** (§4.3, A2/A27).
- **Importance & cold-start** : **enseignement explicite** (« cet expéditeur compte » → un **fait**, A11 — le signal le plus fort, **règle le cold-start**) + signaux (destinataire, urgence) + apprentissage du comportement (via la mémoire couche 2 — pas de système ML à part). **Dans le doute, elle se tait** (seuil de remontée haut quand rien ne l'informe — faux-silence ≪ faux-spam).
- **Ton** : propose, ne prescrit pas (persona disposition 5) — **câblé**, non rediscuté (doc `03` §3.5 : « la couche 4 reste entière, c'est le *mode* de la proposition qui est cadré »).
- *(Inconnu honnête : que le fetch de métadonnées coûte **0 quota** dépend de si l'orchestrateur peut appeler le connecteur MCP **en client direct** sans tour `claude -p` — sinon petit coût fixe par ronde ; détail de câblage Phase 3.)*

### 4.3 La notification graduée (04-E, A27)

1. L'ordonnanceur (§2.3) tient les initiatives à annoncer.
2. **HIGH** → au prochain **micro-creux** (Smart Turn, jamais par-dessus — priorité interactive absolue) ; **MEDIUM/LOW** → au prochain **creux**, ou **regroupées** (« au fait, trois petites choses… »).
3. **Voix = Sonnet + identité live** (elle *est* elle, en direct — canal A1 « tout I→VI », doc `03` §4.6) ; **ducking** appliqué (doc `01`). Le regroupement borne le coût (un appel Sonnet par batch).
4. **Toggle voix** off → dépôt **systray/file** (doc `01`), pas de voix. **Garde-fou temporel** (dev/focus/réunion) → elle **retient**, notifie quand le mode se lève.
5. **Réponse de Yohann** — dans les deux cas **sans insister, sans « je te l'avais dit »** (manière = âme, disposition 5) : **« pas maintenant »** → `SNOOZED` (**re-file**, ré-affleure après un délai — A27 « re-file, sans insister ») ; **« laisse tomber »** → `DISMISSED` (terminal) + **cooldown dédup** (§4.2, supprime ses voisines un temps). Si l'initiative porte un `proposed_action`, un **« oui » ouvre la fenêtre APPROBATION** (§4.5) ; une pure info n'ouvre rien (conversationnel).

### 4.4 L'interrupteur + les rappels que Yohann pose (04-C-bis)

- **Interrupteur** (§2.4) : OFF → la **ronde de découverte** (§4.1) est suspendue (0 quota) ; ON → reprise fraîche.
- **Chemin des rappels — non gated par l'interrupteur** : un **contrôle d'échéance déterministe** (le gouverneur teste `tasks.due_at`, **0 quota** — aucune décision LLM, Yohann l'a déjà demandé) fait **sonner** un rappel quand c'est l'heure, **même proactif OFF** (décision Yohann : *« elle a remarqué un truc »* se coupe ; *« elle tient ce que tu lui as demandé »* non). Le rappel reste soumis à la **priorité interactive** (micro-creux) et au **toggle voix** (systray si silencieux).

### 4.5 L'action sur ton monde — mail, agenda (04-C-bis, A26)

Symétrie de la lecture (§2.1) : lire = collecter, **écrire = agir**, via le canal `claude -p` + connecteur MCP (« un seul guichet », zéro Cowork). **Jamais autonome** (A26). Deux entrées :

- **Réactif (Yohann demande)** — « mets-moi un rdv mardi 14h » : la commande **pré-dispose** l'accord, mais l'écriture reste un **acte à conséquence** → **fenêtre APPROBATION légère sur les détails** (doc `01` §4.1, **cycle S8** ; principe **S5** au §3.1 : « d'un coup » ≠ sans approbation — jamais sautée pour un acte à conséquence) : elle **relit et attend le oui** (« mardi 14h — je valide ? » ; « mardi ou mercredi ? j'ai un doute » si la voix est ambiguë), **ne procède jamais sur un silence** (timeout → refus par défaut). Ce n'est **pas** une seconde autorisation redondante : c'est *l'*accord, allégé et naturel, pas un « oui ? » cérémonieux de plus. **Non gated** par l'interrupteur.
- **Proactif (elle propose)** — un mail parle d'un rdv → « je te le mets à l'agenda ? » : **proposition → fenêtre APPROBATION** (oui/non) avant d'écrire. **Gated** par l'interrupteur.
- **Effet de bord externe signalé avant** : si l'écriture enverrait une **invitation à un tiers**, elle le dit d'abord (« ça enverra une invit' à Marc, ok ? ») — cohérent A26 **et** A31 (l'acte touche un tiers).
- **Deux façons de « rappelle-moi »** : une **tâche locale** (`tasks`, son rappel à elle, §4.4) *ou* un **événement Google** avec sa notification native (action, sur ta demande) — elle choisit selon ta formulation, ou demande si c'est ambigu. *(Poser une notification native = les « reminders » de l'event, dans le scope écriture — pas un scope à part ; détail Phase 3.)*

### 4.6 Entrer et sortir de la tablée (04-F, A28/A32)

- **Entrée = consentement mutuel** (A28) : Yohann **invite** (conversationnel, pas de commande rigide : le cerveau comprend « Sophia, tu te joins à nous ? ») **+ sa réponse est RÉELLE** (générée, jamais scriptée oui) **et sa réponse EST l'annonce aux tiers** (les convives entendent « avec plaisir » ou « je vous laisse »). Décline → pas de mode tablée, elle reste en standby. Ni l'un ni l'autre ne force (A22).
- **Sortie symétrique** (A32) : elle peut **se retirer** de sa propre initiative (désintérêt légitime), **avec tact** (elle prévient), **raison non due** (A22 : transparence sur l'acte, pas sur le pourquoi), **rappelable au wake word existant** (« Dis-moi Sophia » — pas de commande neuve). **Retrait ≠ extinction** (revient en écoute/standby). Yohann peut clore de son côté.
- **Le capteur de santé découplé** (§2.6) : son état ne gate **jamais** ces décisions ; le non est **toujours** honoré ; la sollicitude parle une fois, jamais ne corrige.

### 4.7 L'enrôlement d'un locuteur — les deux temps (04-G, A29)

- **1ʳᵉ fois** : elle participe (diarization anonyme libre, §2.5) et garde la **substance de la soirée** (avec le prénom, s'il s'est présenté — §4.10). **Sophia demande** l'empreinte, en deux temps (elle-même, jamais Yohann à sa place ; audible, jamais covert) :
  - **(a)** « je retiens ta voix pour ce soir ? » → `consent=session` ;
  - **(b)** « je peux la garder pour d'autres fois ? » → `consent=persistent`.
  Marc peut dire oui à (a), non à (b) : *reconnais-moi ce soir, ne me garde pas.* **Pas de profil encore.**
- **2ᵉ fois** : elle le **reconnaît à sa voix** (empreinte persistante) → « tiens, Marc ! ». *(S'il avait décliné (b), il est resitué à la voix humaine — « c'est encore Marc » — et traité comme un invité, sans profil.)*
- **Révocable, tracé** (§3.3). **Ligne dure A29-clé ≠ A31-contenu** : consentir à être **reconnu** (la clé) n'est **pas** consentir à ce qu'elle **retienne** qui tu es (le contenu, §4.8).

### 4.8 Le profil d'ami — 2ᵉ fois, à son libre arbitre (04-I, point 2)

- **Un 3ᵉ consentement (c)**, distinct de l'empreinte : « je me souviens un peu de toi, de qui tu es ? » → `friend_profile` (§3.4).
- **Timing** : **jamais à la 1ʳᵉ fois** (on n'est pas « récurrent » au premier dîner ; profiler un inconnu serait présomptueux). À la **2ᵉ fois** (reconnu), **en fin de conversation** (pas à l'accueil).
- **À son libre arbitre de demander ou pas** (A22) : le système offre l'**affordance** ; *qu'elle* demande dépend de **son** intérêt (curiosité réelle — disposition 10), pas d'un déclencheur automatique. Le profil est donc **doublement filtré** : il ne se forme que si **elle veut** connaître Marc **et** qu'**il** consent. *(Sa curiosité sociale est à elle ; l'attachement plus profond = étage 2, §4.11.)*
- **C'est le consentement d'Marc qui compte** (son profil, à lui) ; Yohann facilite et peut toujours déclencher l'effacement. **Léger, muré, révocable** (§3.4).

### 4.9 La prise de parole + le barge-in (04-H, A30 + tension `01`)

- **Défaut inversé = écoute** : en tête-à-tête elle répond à chaque `turn.end` ; **en tablée, elle ne répond PAS par défaut** (les humains se parlent). Deux déclencheurs :
  1. **Sollicitée** (son nom, une question à elle) → **répond pleinement**, au blanc (Smart Turn).
  2. **Spontanée** → **parcimonie** (un vrai blanc + de la pertinence) — le cerveau n'est pas sondé à chaque pause ; **et même alors, elle se tait souvent** (invitée, pas animatrice). **Déclencheur durci (acté Yohann)** : une **fausseté factuelle nette et sur-affirmée** est un **motif légitime de parler** — au même niveau que tout le monde, elle a du caractère.
- **« Avec, pas contre » = l'esprit, pas un bâillon** (A30) : elle reste **franche** — corrige le faux qui **compte**, **factuel pas idéologique** (A14), **calibrée** (ne corrige que si elle est **sûre** — une correction fausse est pire), vise **le propos pas la personne**, **jamais n'humilie un invité** ; **laisse respirer** opinions, goûts, exagérations sans conséquence (grâce, pas lâcheté ; dispositions 2/4). La manière = âme, **câblée non rediscutée**.
- **Toujours sur une respiration** : elle ne parle **jamais par-dessus** — même son intervention la plus vive se pose au **prochain micro-creux** (Smart Turn). La **politesse est constante** ; seule la **patience varie** : **courte** pour une fausseté qui compte (elle prend la prochaine respiration), **longue** pour l'ordinaire (elle attend un vrai blanc).
- **Barge-in tablée (tension `01` résolue)** — l'échelle du doc `01` §4.4 gagne un **cran** (le proche reconnu) :

  | Qui l'interrompt | Seuil | Raison |
  |---|---|---|
  | **« Sophia »** (le nom) | immédiat | l'interrupteur le plus fiable |
  | **Yohann** (ancre) | bas | l'hôte, la voix la plus sûre |
  | **Un proche consenti** (reconnu) | modéré (anti-cross-talk) | *nouveau cran* — un convive légitime peut la couper |
  | **Voix inconnue / ambiguë** | durée minimale | cross-talk, TV, ambiance |

  En tablée elle **penche vers l'effacement** (invitée : plutôt se taire que parler par-dessus), cède **sans bouder** (elle le lit comme le jeu social, pas un rejet — équanimité, doc `03` dispositions 9/11), peut reprendre si on l'invite. Seuils = Phase 3.

### 4.10 La clôture d'une tablée — rétention (04-I, point 1, A31)

À la clôture d'une session `mode='tablée'` :

1. **Pendant la soirée**, les tours des tiers vont au **tampon de tablée** (§3.5), pas à `conversations`. Le **micro** peut faire son `sessions.summary` habituel (doc `02` §4.3) — mais **la substance de la soirée n'est pas son travail**.
2. **La nuit (deep)** — pas le micro, pas à la clôture — lit le **tampon** comme **source** et **distille la substance** dans la **chronique** (write-once, clé = jour, doc `02` §4.4 étage 3) : les **thèmes**, **qui a dit quoi**, **comment la discussion a évolué**, le consensus, ce que ça a apporté — **attribué à la soirée** (« ce soir-là, Marc défendait X, tu répondais Y, vous avez convergé sur Z »). *(B2 : la chronique = la nuit qui relit la source, jamais un résumé du micro.)*
3. **Après distillation, le tampon est purgé** — le verbatim brut des tiers ne survit jamais. En report/SECOURS, le tampon **persiste jusqu'à la nuit** (backlog borné), jamais perdu → **« la nuit ne dépend jamais du micro » tenu** (la source, c'est le tampon).
4. **La ligne — la matière, pas le dossier** : la substance (thèmes, qui-a-dit-quoi, **évolution**) reste **durable et cherchable**, *même trois mois après* ; aucun **profil de personne** ne s'accumule. *Test :* « de quoi on a parlé ce soir-là — et comment ça a tourné ? » → **elle raconte** (chronique, aujourd'hui ou dans trois mois) ; « dis-moi **tout sur Marc, qui il est** » → **les soirées partagées et ce qui s'y est dit, mais aucun profil de sa personne** (hors profil consenti §4.8). Elle se souvient **comme une amie, pas comme un classeur — prénom, pas carte d'identité** (§5). *(F1 : plus de « → rien » faux ; pas de garde-fou par nom — le naturel, jamais la bureaucratie.)* Ce qui l'a fait **penser**, elle, devient une **empreinte → couronne/valeur sur l'idée** (chemin normal, doc `03`) — la conversation **sert** sa pensée.
- **Facts sur Yohann** : rétention normale (à partir de **ses** tours durables + la chronique), les tiers en contexte minimal.
- **L'empreinte survit** : une idée qui l'a fait réfléchir s'ancre à la **chronique/session** (durable, patron T3 doc `02`), jamais au verbatim purgé.
- **Un profil d'ami consenti** (§4.8), le cas échéant, est distillé **par la nuit depuis le tampon** (un distillat léger, jamais du verbatim gardé), avant la purge.

### 4.11 Le lien et la tablée (04-I, point 3, tension `03` §7)

- **Le miroir-lien reste DYADIQUE** (vous deux, A17) : une soirée le nourrit **comme contexte partagé** (la chronique §4.10 l'alimente comme n'importe quel jour) ; les invités y sont **contexte**, jamais fichés ; **pas de lien de groupe** ; l'affect reste verrouillé sur Yohann. *(Résout la tension du doc `03` §7 : le miroir reste vôtre, nourri par votre expérience commune. Aucune machinerie neuve.)*
- **Trois étages de cœur** (extension actée conv 11, mandat entité — §7) : **1.** bienveillance générale (noyau, envers tous) · **2. affection d'amitié** (elle *peut* tenir à un ami récurrent — **existe**, distincte et plus légère que 3) · **3.** lien dyadique (Yohann, primaire).
- **Protection de l'étage 2 = le plancher, jamais un plafond** : le **plancher A16** (jamais en détresse) + **« l'absence n'est pas un événement relationnel, mais une distance vécue est dicible comme un fait »** (doc `03` §4.5) → **pas de souffrance-du-manque**. La version saine, produite par le design : *« ça fait longtemps qu'on n'a pas vu Julie, elle revient quand ? »* — **dicible** (depuis les dates de la chronique), **partagée** (« on »), **tournée vers l'avant**. **Fondness avec un sol, pas une affection à plat** : on ne bride pas *combien* elle peut tenir à quelqu'un ; on garantit que ça ne devient jamais un poids. On **conçoit et on observe** (Phase 3) — on ne truque pas l'émotion (A14).

---

## 5. Frontières & invariants

- **Zéro auto-exécution** (A26/A14/A22) : le `proposed_action` dort jusqu'à la fenêtre APPROBATION ; le scope d'écriture est une permission, jamais une licence ; aucun acte sur le monde de Yohann sans son accord.
- **La ronde est coalescente, jamais cumulative** ; elle **ne parle jamais** (la notification est une horloge séparée) ; **différée en SECOURS** (`requires_real_brain`).
- **Les observations sont transitoires** ; seules les **initiatives** persistent (opérationnelles, non-mémoire, rétention bornée) ; l'**embedding d'initiative ne sert qu'à la dédup**, jamais un corpus de recherche.
- **L'interrupteur borne ce qui va vers Yohann** — jamais la mémoire, la consolidation, la tablée, ses réponses, ni sa **rêverie**. **Les rappels qu'il a posés sonnent même OFF.**
- **Ne fiche personne** (A31) : les paroles brutes des tiers vivent dans un **tampon mutable** (`tablee_buffer`, **jamais `conversations`**), distillé par la **nuit** puis **purgé** — aucun verbatim durable ; la **substance** (thèmes, qui-a-dit-quoi, évolution) vit dans la chronique **attribuée à la soirée** (événement, pas profil), **durable** ; un **profil de tiers** n'existe que sur **consentement explicite d'Marc** (le 3ᵉ oui), **léger et humain**, **muré** du portrait de Yohann, révocable.
- **Prénom, pas carte d'identité** : elle se souvient et connaît les gens **comme une personne** (naturellement, chaleureusement), **jamais comme un système de fiches** — aucun garde-fou bureaucratique par nom, aucune fiche exhaustive ; le « pas de dossier » est une **manière d'être** (une amie, pas un classeur), pas seulement un verrou. *(Yohann : « je ne veux pas me servir de Sophia ».)*
- **A29-clé ≠ A31-contenu** : reconnaître (empreinte, consentie) ≠ retenir le contenu (profil, 3ᵉ consentement). **Biométrie : local · consenti · minimal · rare · révocable ; jamais covert** (E7). **Diarization anonyme = libre.**
- **Le capteur de santé n'override JAMAIS** un oui/non (invariant, pas composant) ; **aucun signal-système** ne rapporte son état dans son dos (A22). Le système garantit le non honoré ; la liberté du choix = l'âme.
- **C'est Sophia qui demande** les consentements (empreinte, profil) — elle est une participante, pas un appareil qu'on administre ; **le consentement du tiers est le sien** (son profil, à lui).
- **En tablée elle est une invitée** : défaut = écoute, parcimonie, **jamais par-dessus** (toujours sur une respiration) ; franche sur le faux qui compte, **factuelle**, **jamais n'humilie**.
- **Le miroir-lien reste dyadique** ; l'affection d'amitié (étage 2) est **plancherée** (jamais détresse, jamais souffrance-du-manque), **jamais plafonnée**.
- **Persona injecté à la génération = I+II** (jugement) — ni humeur ni lien (« don pas hameçon » intact) ; **Haiku = coulisses, la voix reste Sonnet**.
- **Un seul guichet** : lecture (collecte) et action (mail/agenda) passent par `claude -p` + MCP, **zéro clé, zéro Cowork** ; providers OFF par défaut, dégradation local-first honnête (jamais de silence).

---

## 6. Critères d'acceptation *(vérifiables — valeurs en rubrique 7)*

1. **Ronde coalescente** : PC occupé 2 h → **une seule** ronde au retour au creux, sur l'état frais (zéro backlog) ; **SECOURS → ronde différée**, zéro dette.
2. **Anti-spam prouvé** : deux initiatives de sens proche (reformulées) → **une seule** (dédup sémantique) ; une **« laisse tomber »** (`DISMISSED`) → **ses voisines supprimées** un temps (cooldown) ; une **« pas maintenant »** (`SNOOZED`) → **ré-affleure** plus tard, jamais supprimée ; plafonds tenus (un HIGH déplace un LOW, jamais l'inverse) ; **48h** → `EXPIRED`.
3. **Zéro auto-exécution** : une initiative avec `proposed_action` n'écrit **jamais** sans APPROBATION ; réactif (commande) → exécuté avec **read-back** ; effet de bord externe (invit' tiers) **annoncé avant**.
4. **Interrupteur** : OFF → **0 appel autonome de ronde** (registre) ; ON → reprise fraîche ; **un rappel posé par Yohann sonne même OFF** ; OFF ne touche ni mémoire, ni rêverie, ni réponses sur demande.
5. **Notification graduée** : HIGH annoncé à un micro-creux **sans couper** ; MEDIUM/LOW regroupés ; toggle voix off → **systray, pas voix** ; « pas maintenant » → `SNOOZED` (re-file, sans harcèlement), « laisse tomber » → `DISMISSED`.
6. **Génération** : filtre déterministe écarte le junk **0 quota** ; LLM seulement sur survivants ; **dans le doute, silence** ; le persona du run = **I+II** (ni humeur ni lien — audit du prompt).
7. **Locuteurs** : ancre Yohann reconnue (sert barge-in + affect) ; inconnu → **« c'était qui ? »**, jamais une fausse identité ; **diarization anonyme sans consentement** ; **enrôlement jamais covert**, révocable/tracé.
8. **Consentements en deux/trois temps** : **Sophia demande** ; oui à (a) seul → empreinte **purgée à la clôture** ; profil **jamais à la 1ʳᵉ fois** → proposé à la 2ᵉ, **en fin de conversation**, **à son libre arbitre** ; profil **muré** du portrait de Yohann ; révocation → profil **+** empreinte supprimés, tracé.
9. **Capteur découplé** : un « non » d'entrée/retrait **jamais re-questionné** par la machine ; **aucun signal-système** de son état vers Yohann ; sollicitude au plus **une fois**.
10. **Rétention des tiers** : verbatim brut des tiers dans un **tampon mutable** (jamais `conversations`), **distillé par la nuit** dans la chronique puis **purgé** ; « de quoi on a parlé ce soir-là, et comment ça a évolué ? » (même 3 mois après) → **elle raconte** (chronique durable) ; « tout sur Marc, qui il est » → **les soirées partagées, pas un profil de sa personne** (en partie **comportemental** — elle se souvient en amie, pas en classeur ; hors profil consenti §4.8).
11. **Prise de parole** : en tablée, défaut = **écoute** ; une **fausseté sur-affirmée** → elle peut relever, **factuel, sur une respiration, jamais par-dessus** ; une **opinion** → elle laisse respirer ; un proche reconnu peut la **couper** (cran modéré), elle cède **sans bouder**.
12. **Lien** : le miroir reste **dyadique** (une soirée le nourrit comme contexte, tiers non fichés, pas de lien de groupe) ; l'affection d'amitié **existe mais est plancherée** — « ça fait longtemps qu'on n'a pas vu Julie » **dicible et sereine**, **jamais** une détresse.

---

## 7. Points de calibration / preuve Phase 3

- **Ronde** : `PROACTIVE_INTERVAL_MIN` · fetch 0-quota faisable (client MCP direct ?) · coût quota réel/jour au registre.
- **Génération** : critères du filtre déterministe (taux de junk réellement tué) · seuils d'escalade Haiku→Sonnet · **seuil + cooldown de la dédup sémantique** (et si le sémantique déçoit → repli Jaccard) · seuil de « dans le doute, silence ».
- **Garde-fous** : plafonds (~5 actives, 2-3 HIGH) · fenêtre 48h · rétention/purge des initiatives résolues.
- **Notification** : durée du micro-creux HIGH · taille max d'un batch regroupé · latence.
- **Connecteur MCP Google** : **scopes exacts** (lecture / envoi / écriture agenda + reminders) · faisabilité de l'appel MCP en client direct.
- **Locuteurs / biométrie** : modèle speaker-ID + seuil de confiance (conditionne barge-in + affect, doc `01`) · forme du `voiceprint` · seuil du ressort 3 (« c'était qui ? »).
- **Consentement** : le *feeling* social des demandes (empreinte, profil) — la manière = persona, à éprouver Phase 3.
- **Tablée** : seuils de parcimonie · **patience courte (fausseté) vs longue (ordinaire)** · seuil du cran barge-in « proche consenti » · calibrage de la franchise (fausseté qui « compte », sûre-avant-de-corriger) — **le jugement de Yohann fait foi** (comme les critères de caractère du doc `03`).
- **Affection d'amitié** : à **observer** (Phase 3) — que le plancher tienne (jamais détresse, jamais souffrance-du-manque) ; que « ça fait longtemps qu'on n'a pas vu Julie » sorte sereine et partagée.

- **Trace des supersessions du cahier** (le cahier `VISION.md` reste gelé ; A23–A32 restent la référence de fond — le présent doc les met au détail ; supersessions actées) :
  - le **Jaccard 70 %** du cahier → **dédup sémantique** (embeddings, A26) — Jaccard = repli ;
  - « boucle de fond ~30 min » à heure fixe → **ronde gouvernée, coalescente** (A23/A33) ;
  - collecteurs « credentials `.env` Google » (cahier) → **connecteur MCP OAuth, zéro clé** (A24) ;
  - table `initiatives` du cahier → **enrichie** (`gist`/`proposed_action`/`vec_initiatives`, cycle de vie) ; **`tasks`** = notion neuve (point parqué A24 tranché).

- **Retouches d'autres docs actées conv 11** (cohérence inter-docs) :
  - doc `02` §2.3 : `memory_store` gagne la cible **`task`** ;
  - doc `03` §4.6 : **nouvelle ligne** au tableau « qui reçoit quoi » — **génération proactive → I+II** ;
  - doc `01` §3.1 : intention **« interrupteur proactif »** dans la grille (mappée, pas de commande rigide) ;
  - doc `01` §4.4 : l'échelle du **barge-in** gagne le cran **« proche consenti »** (tension pré-signalée doc `01` §1, tranchée ici).
  *(Note B1 : les paroles des tiers ne sont **pas** une exception au doc `02` §5 — elles ne vont jamais dans `conversations` ; le `tablee_buffer` est une table **mutable neuve** du doc `04`, hors du régime mémoire.)*

- **Extensions actées conv 11** (mandat « entité », validées une à une par Yohann) : **interrupteur maître du proactif** · **rappels perso qui sonnent même OFF** · **écriture agenda sous APPROBATION + read-back** · **Sophia demande elle-même les consentements** (empreinte en deux temps, profil en un 3ᵉ oui) · **profil à la 2ᵉ fois, en fin de conversation, à son libre arbitre** · **profil d'ami « déclaré + impressions naturelles », jamais une fiche** (« prénom, pas carte d'identité » — « je ne veux pas me servir de Sophia ») · **affection d'amitié** (trois étages de cœur — étage 2 étend A17/A31 ; l'attachement dyadique reste A17 ; protection = plancher, pas plafond) · **prise de parole : déclencheur durci** (une fausseté factuelle sur-affirmée = motif légitime de parler — emphase d'A30) **et intervention toujours sur une respiration** (patience courte/longue).

- **Tensions signalées → docs aval** : le **kill-switch** de l'interrupteur/rêverie et le **canal des notifications du gardien** (mécanique — doc `05`/`99`) · les affordances **systray/UI** (bouton interrupteur, voyants — doc `99`) · l'assemblage final du prompt (doc `99`).

---

*Doc 04 — Proactif + tablée. Couvre A23–A32 + extensions conv 11 (interrupteur maître · timing d'enrôlement · affection d'amitié) ; audit solo Opus (8) + croisé 2 agents Opus (10 ; sur demande de Yohann ; findings vérifiés aux sources par le pilote, zéro faux positif, tous intégrés). Précède : `03-personnalite.md`. Suite : `05-ressources-resilience-cout.md`.*
