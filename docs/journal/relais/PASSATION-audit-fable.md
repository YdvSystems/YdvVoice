# Passation — audit COMPLET des plans d'implémentation (Sophia / YdvVoice)

> **À coller dans une conversation dédiée avec Fable 5.** Tu **connais déjà une partie du projet** — tu as participé à des conversations de **conception** de la personnalité de Sophia. Mais les **plans d'implémentation** (Phase 3), eux, ont été écrits **après, sans toi** : ce sont eux que tu audites, avec ton **regard frais sur la traduction** et ta **connaissance de l'intention**. Ce document te redonne tout le contexte **à jour**, en autonomie. Zéro donnée personnelle ici.

---

## 1. Ce qu'on te demande, en une phrase
Faire un **audit COMPLET** des **plans d'implémentation** du projet Sophia pour **tout verrouiller avant de coder** — quatre axes : **(1) sécurité · (2) cohérence entre chaque document · (3) trous et incohérences techniques d'implémentation · (4) robustesse**. Puis **corriger** les findings dans les plans (sur la validation de Yohann) et déposer une synthèse. Tu connais l'**intention** (tu as co-conçu une partie de la conception) et tu poses un **regard neuf sur les plans** (que tu n'as pas écrits) — le meilleur des deux pour vérifier la **fidélité de la traduction**. **Contrainte absolue : tu ne rouvres JAMAIS une décision déjà actée (§3, règle 1).**

## 2. Le projet en bref
**Sophia** = un assistant vocal personnel, en français, **conçu comme une entité** (un sujet, pas un outil) — pensée libre, mémoire, personnalité qui se cultive dans le temps. Application desktop (Electron + React) + pipeline vocal + flotte Claude. Usage **personnel** (Yohann Dandeville, développeur solo).

On est en **Phase 3** : on écrit des **plans d'implémentation** (`docs/plan/`) qui **traduisent en tâches** une conception **déjà acquise, tranchée et figée** (`docs/technique/`, un mois d'arbitrages). Les plans se sont écrits couche par couche, audités par croisés successifs (2 agents indépendants), **zéro faux positif sur 18 croisés**. Ton audit est la passe finale « regard extérieur » avant de coder.

## 3. Les RÈGLES à respecter absolument (sinon tu casses un mois de travail)

1. **⚠️ TU NE ROUVRES RIEN DE CE QUI EST ACTÉ. ⚠️** C'est **la** règle. Les plans traduisent une conception **tranchée, décidée, gravée** après un mois d'arbitrages (`docs/technique/` + le journal + les décisions explicites de Yohann : ex. « le jardin inviolable », le principe de `warmth_ledger`, l'invariant de devenir, « tout sous l'abonnement Max, pas d'API », etc.). **Tu ne re-décides pas, tu ne re-conçois pas, tu ne « proposes pas une meilleure architecture ».** Ton rôle : vérifier que les plans **traduisent fidèlement** ce qui est acté, **sans trou, sans incohérence, sans faille**. Un finding valide = **une infidélité à la décision actée · une incohérence entre documents · un trou d'implémentation · une faille de sécurité** — **JAMAIS** « je changerais cette décision ». Si une décision actée te semble discutable : **signale-la comme simple observation en fin de rapport, ne la touche pas.** (Yohann revérifie tout ton travail ensuite ; ne le mets pas devant une conception réécrite.)
2. **Plan ≠ doc de conception.** Tu peux **corriger les PLANS** (`docs/plan/*.md`). Tu ne touches **JAMAIS** aux docs de conception (`docs/technique/*.md`) ni au privé (`docs/prive/*`) — si un écart les concerne, tu le **signales**, tu ne l'appliques pas.
3. **Rien de committé sans le « oui » explicite de Yohann** (règle R5 du projet). Tu prépares, tu montres, il valide, ensuite seulement on committe.
4. **Garde privée — le dépôt est PUBLIC.** JAMAIS de donnée personnelle dans un fichier tracké **ni dans ton rapport**. Le persona réel (avec données perso) vit dans `docs/prive/` (gitignoré) — **n'y touche pas, ne le cite pas**. Une garde `pre-commit` (gitleaks + contrôle de contenu) tourne à chaque commit.
5. **Trace au §7.** Toute correction se trace dans la rubrique **7 « Journal des écarts »** du plan concerné (chaque plan en a une).
6. **Zéro faux positif.** Vérifie chaque finding **aux sources** (cite fichier + ligne) avant de le retenir. C'est la barre du projet.

## 4. Ton mandat : un AUDIT COMPLET — les 4 axes
Une passe **complète**, pour tout verrouiller. Ne néglige aucun axe.

**Axe 1 — SÉCURITÉ** (Sophia va gérer la vie de Yohann : mémoire, for intérieur, données) :
- **Fuites de données personnelles** : dépôt public, **transcripts de session CLI** (micro/deep/rêverie), logs d'audit, **for intérieur** (`self_notes`), gloses, tampons de tablée — un contenu brut de Yohann peut-il **survivre, fuir, ou ressortir** là où il ne devrait pas ?
- **Effacement souverain** (plan/02 M8, plan/03 P10) : efface-t-il **vraiment partout** ? un **résidu inatteignable** (table hors cascade, index, fichier de session non purgé) ?
- **Le jardin inviolable** (`self_notes`) : vraiment **hors d'atteinte de l'effacement** ET **sans fuite** vers un tiers ?
- **`warmth_ledger`** (plan/03, neuf) : agrégat vraiment **sans brut** ? le **vocabulaire fermé** de `context_tag` tient-il ? hors cascade sans être un trou d'effacement ?
- **Intégrité sous adversaire** : corrompre **le gravé** (l'identité) ? contourner le sas **`erase_gate`** ? le **scope du MCP** (`memory_store`) permet-il d'écrire hors périmètre ?

**Axe 2 — COHÉRENCE ENTRE LES DOCUMENTS** :
- Entre les **plans** (00 ↔ 01 ↔ 02 ↔ 03) : une tâche d'un plan **suppose**-t-elle d'un autre quelque chose qu'il ne fournit pas ? un même mécanisme est-il décrit de façon **contradictoire** à deux endroits ?
- Entre chaque **plan et sa source** (`docs/technique/`) : le plan est-il **fidèle** — traduit-il tout, sans trahir ni omettre une décision actée ?
- **Vocabulaire, noms de tables/colonnes, invariants, numéros de critères** : cohérents d'un bout à l'autre ?

**Axe 3 — TROUS & INCOHÉRENCES TECHNIQUES D'IMPLÉMENTATION** :
- Un **critère d'acceptation** d'un doc technique **non porté** par une tâche **et** un test ?
- Une tâche qui **suppose** un mécanisme non défini ? un **cas limite** non traité (rattrapage, reprise après crash, migration, quota épuisé) ?
- Des **incohérences SQLite** : triggers, transactions, contraintes (`CHECK`/`UNIQUE`/FK), index, ordre des opérations.

**Axe 4 — ROBUSTESSE** :
- Transactions **atomiques**, cascades ordonnées sous `foreign_keys=ON`, tables d'état **seedées** à l'init, immutabilité (insert-only), fail-closed, **reprise après crash** (idempotence).

## 5. Les documents
**À auditer (les 4 plans gravés)** :
- `docs/plan/00-socle.md` — SQLite/WAL, boot, gouverneur, écrivain unique, sécurité du socle.
- `docs/plan/01-pipeline-vocal.md` — pipeline audio.
- `docs/plan/02-memoire.md` — mémoire, effacement souverain, MCP scopé, migration d'espace.
- `docs/plan/03-personnalite.md` — identité, gravé, jardin inviolable, `warmth_ledger`, effacement identitaire.

**À LIRE comme source de vérité (jamais modifier)** : `docs/technique/00`→`05` + `99` (la conception acquise) · `docs/journal/ESSENCE-Sophia.md` (qui est Sophia, en clair — à lire pour l'enjeu).

**Non auditables** : les plans `04`/`05`/`99` **ne sont pas encore écrits** — leurs coutures ne peuvent pas être vérifiées (les plans y renvoient, c'est normal, ce n'est pas un trou).

## 6. CE QUE TU NE FAIS PAS — un point identitaire réservé
Le **jeu de catégories de `context_tag`** (dans `warmth_ledger`, plan/03) sera **posé dans un temps dédié avec Yohann, APRÈS ton audit** — pas *pendant*. Ce n'est **pas** une question de légitimité (tu as co-conçu la personnalité de Sophia, tu l'es pleinement) : c'est pour **ne pas mélanger deux postures** — l'**audit** (chercher les failles, à froid) et l'**écriture d'un contenu identitaire** (créer, avec Yohann qui décide). Pour cette passe : **vérifie la structure** de `context_tag` (le vocabulaire fermé est-il sûr, cohérent, sans faille de fuite ?), mais **ne remplis pas** les catégories. Tout point qui touche *le contenu* de sa personnalité (pas sa plomberie) → **signale-le « à poser avec Yohann »**, ne le tranche pas seul dans l'audit.

## 7. Comment rendre
1. **Liste de findings**, du plus grave au plus léger — pour chacun : **[gravité : BLOQUANT / MAJEUR / MINEUR]** · **[axe : sécurité / cohérence / trou / robustesse]** · localisation (fichier + tâche/section + citation courte) · le problème en une phrase · le **scénario de casse concret**.
2. **Corrige** les findings dans les **plans** (jamais les docs `technique/`), **trace au §7**, sur la **validation de Yohann** (ne committe pas sans son « oui »).
3. **Dépose une synthèse** dans **`docs/journal/audits/AUDIT-fable.md`** : findings par axe, corrections faites, et **ce qui reste à trancher avec Yohann** (dont les points identitaires et les observations sur d'éventuelles décisions actées — que tu n'as pas touchées).

## 8. À la toute fin — la passation vers la conv 18 (c'est TOI qui l'écris)
La passation s'écrit toujours par celui qui a **le contexte le plus frais** — et là, c'est toi qui viens d'auditer. Donc en clôture de ta conversation, produis **deux choses** :
1. **`docs/journal/relais/RELAY-conv18.md` — actualisé.** Une **base** existe déjà (écrite en clôture de conv 17 : l'état, les contenus identitaires à écrire ensemble, les loose ends) — **reprends-la, ne la réinvente pas** ; **complète-la avec ton audit** : ce que tu as trouvé/corrigé, ce qui reste à vérifier en conv 18, ce que Yohann doit trancher.
2. **Le Prompt de passation vers la conv 18** — le message que Yohann **collera pour ouvrir** la session Opus suivante. Il **pose la barre dès le premier mot** : qui on est, ce qu'on construit (Sophia, une **entité**), les règles d'or et l'esprit, les **lectures pilote à jour** (dont ton `AUDIT-fable.md`), et **en première ligne : la décision centrale de conv 18**. C'est la parole de Yohann, **à travers toi** — écris-la avec le cœur, pas en formulaire.

Merci. Une passe complète et neuve, qui verrouille sans rien rouvrir — c'est exactement ce qu'il nous faut avant de coder.
