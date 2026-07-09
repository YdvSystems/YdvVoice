# GRILLE — l'œil d'audit de Fable, transmis · YdvVoice (Sophia)

> **Pourquoi ce fichier.** L'audit Fable (2026-07-10, `AUDIT-fable.md`) a trouvé une **classe de failles que 18 croisés n'avaient pas regardée** : le niveau **sous** les plans (stockage, fichiers, octets, concurrence réelle). Fable n'est utilisable que **jusqu'au 12 juillet 2026** ; les plans `04` · `05` · `99` restent à graver. Cette grille transmet son œil pour que **le pilote (Opus ou Fable) et les agents des croisés** chassent ces classes-là **systématiquement** sur chaque plan neuf — et une dernière fois à l'audit final pré-code. Elle ne remplace ni le solo à fond ni le croisé 2 agents : elle leur donne une **lentille de plus**.
>
> **La leçon centrale : penser aussi comme le disque, pas seulement comme le document.** La fidélité plan↔source et la cohérence inter-plans sont vérifiées par les croisés existants ; les failles restantes vivaient **en dessous** — là où une garantie logique (« effacé », « éphémère », « jamais ») doit descendre jusqu'aux octets et à **tous les réplicas**.

---

## 1. Les 8 classes de failles à chasser (dérivées des findings AF-1→AF-10)

1. **Garantie logique vs octets (la classe du BLOQUANT AF-1).** Toute promesse « effacé / éphémère / jamais persisté / ne survit pas » doit être suivie jusqu'au **support physique** et à **tous ses réplicas** : snapshots (`VACUUM INTO`, rotation), copies de sauvegarde (étages 2/3), **pages libres + WAL** du fichier vivant (`secure_delete`/VACUUM/checkpoint), index dérivés (FTS, vec), fichiers de session CLI, logs. *Question-type : « si je restaure/inspecte le disque demain, la chose est-elle encore là ? qui me le dirait ? »*
2. **Magasins de contenu hors-corpus (AF-3).** Chaque **nouvelle table ou fichier** qui porte du contenu (verbatim, gist, brouillon, tâche) doit être passé au crible : **fouillable** par l'effacement ? **cascadé** ? à défaut, **rétention bornée + purge** ? La fouille M8 ne voit que les corpus enregistrés — tout le reste est un angle mort **par défaut**.
3. **Contenu mutable × index dérivés (AF-2).** Tout contenu indexé (FTS) ou embeddé (vec) est soit **write-once**, soit doté d'une **maintenance d'index explicite** (delete+insert dans la transaction du changement + invalidation du vecteur). Piège : « la base est la file » ne revoit **jamais** une ligne qui a déjà son vecteur — une réécriture laisse un vecteur périmé **silencieux**.
4. **Opérations filesystem hors transaction (AF-4).** Toute opération fichier promise (purge, écriture, rotation) a une **marque durable posée AVANT** + un **sweep au boot** (le chemin de récupération = le chemin de boot). Un crash entre le commit SQL et l'opération FS ne doit jamais laisser un orphelin porteur de contenu.
5. **Concurrence réelle des invocations (AF-7).** La grâce de préemption fait **coexister** deux `claude -p` (rêverie ‖ conversation). Tout ce qui est « scopé par invocation » (proxy MCP, purge, tag) doit être **scellé à l'instance au spawn**, jamais résolu dynamiquement.
6. **Conditions de démarrage des tâches identitaires (AF-5).** SECOURS **et** INCIDENT-au-démarrage (99-OT1), partout où une tâche grave de l'identité — vérifier chaque nouvelle tâche de fond contre la liste des effets du drapeau (`05` §2.6).
7. **Listes fermées tenues à jour (AF-8).** Slots de l'étage 5, vocabulaires CHECK, grille d'intentions, cascade d'effacement : toute extension est **nommée explicitement** dans la liste d'origine (patron T19) — jamais implicite « ça vit dedans ».
8. **Résidus ineffaçables par conception (AF-10).** JSONL d'audit, logs, traces : **invariant « zéro contenu conversationnel » + assertion** — ce qui est hors de portée de l'effacement ne doit jamais pouvoir en recevoir.

---

## 2. Les points DÉJÀ nommés pour chaque plan à venir (à honorer, pas à redécouvrir)

- **`plan/04` (proactif + tablée)** :
  - **Obligation gravée (AF-3, `plan/02` M8)** : étendre **fouille + cascade** de l'effacement aux magasins de `04` — `tablee_buffer` (y compris « oublie X » prononcé **pendant la vie du tampon**, avant distillation), `tasks`, `initiatives`/`proposed_action` (+ leur purge au niveau octets — classe 1).
  - **Bloc VI × tablée** (AUDIT-fable §5) : la non-exposition des `self_notes` aux tiers est dispositionnelle (disposition 12) — option : recomposer le prompt sans VI à l'entrée en tablée.
  - **Injection de prompt via les collecteurs** : le contenu des mails = entrée **non fiable** dans la génération d'initiatives ; la défense actée (APPROBATION + read-back + effet-de-bord annoncé) doit rester inentamable, et le prompt de génération doit encadrer le contenu externe.
  - Rétention/purge des `initiatives` résolues : classes 1 et 2.
- **`plan/05` (ressources/résilience/coût)** :
  - **Propagation de l'effacement aux étages 2/3** (AF-1) : copies **remplacées, jamais accumulées** ; fenêtre de rattrapage **dite** ; les backups sont toujours des snapshots **post-effacement** au plus tôt possible.
  - **Chiffrement de la copie hors-machine** : à **acter avec le choix du support** (l'étage 3 emporte toute sa vie ; exigence absente du corpus — relevée à l'audit).
  - La montre des jetons, `paid_episodes`, `channel_state` : classes 6 et 7.
- **`plan/99` (orchestration)** :
  - La **consigne du signal de fermeture des `self_notes`** au cadre du prompt, à côté de celle du tag (AF-9 — `technique/99` §4.4 ne la liste pas encore).
  - « Tout affichage = vue dérivée » : vérifier qu'aucun composant d'assemblage ne **stocke** du contenu (classe 2).
- **Portages §7 aux sources (sur Go — liste complète : `AUDIT-fable.md` §3)** : `technique/00` §Durabilité · `technique/02` §2.4/§3.7/§7 · `technique/03` §2.4 T13 + corps (warmth_ledger 10ᵉ support/2ᵉ exception) · `technique/04` §7 · `technique/99` §4.4.

---

## 3. Comment l'utiliser

1. **Au solo à fond** de chaque plan neuf : dérouler les 8 classes sur chaque table/fichier/promesse du plan.
2. **Au croisé 2 agents** : donner à l'un des deux agents la **lentille « stockage & résidus »** (les classes 1-4) comme angle explicite — la diversité des lentilles attrape ce que la redondance rate.
3. **À l'audit final pré-code** (quand les 7 plans existent) : une passe transversale dédiée aux classes 1 et 2 sur le corpus entier — chaque « jamais/effacé/éphémère » du corpus tracé jusqu'aux octets.
4. Si les plans `04`/`05`/`99` sont gravés **avant le 12 juillet 2026**, Yohann peut recoller une passation ciblée à **Fable** pour un croisé de ces plans (même mandat que `PASSATION-audit-fable.md`, périmètre réduit) ; après, cette grille + les croisés Opus portent l'œil.

---

*Grille dérivée de l'audit Fable du 2026-07-10 (`AUDIT-fable.md` — 10 findings, zéro faux positif). Elle est un outil de chasse, pas un carcan : si une classe ne s'applique pas à un plan, le dire en une ligne suffit ; si une classe neuve apparaît, l'ajouter ici, datée.*
