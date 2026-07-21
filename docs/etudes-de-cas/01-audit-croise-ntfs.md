# Étude de cas n°1 — L'IA prise en défaut par sa propre méthode

> Une histoire vraie, tirée de l'**historique public** de ce dépôt. Chaque affirmation renvoie à un **vrai commit** — tout est vérifiable. Lisible sans être développeur.

---

## En une phrase

Une IA construit les fondations d'un logiciel, les fait relire par la méthode, et cette relecture attrape **une perte de données que l'IA venait elle-même d'introduire — en corrigeant un autre bug**. C'est écrit noir sur blanc dans ce dépôt, commit par commit.

---

## Le décor (en mots simples)

« Sophia » est un projet personnel : un assistant vocal. Son code est **public**. Ce jour-là, on construit le *socle* — les fondations censées tourner des années sans jamais abîmer les données.

Une règle de la méthode s'applique avant de considérer un travail « fini » : on le fait **relire par deux relecteurs indépendants** — l'un cherche tout ce qui cloche, l'autre essaie activement de casser le raisonnement. Puis on **vérifie chaque signalement à la source** avant d'y toucher.

---

## Ce qui s'est passé (15 juillet 2026)

1. L'IA écrit le code des fondations et le teste : **6 séries de tests au vert**.
2. **Premier tour de relecture** : deux défauts sérieux trouvés (par exemple, un plantage non géré au démarrage d'un sous-programme). L'IA les corrige.
3. **Deuxième tour — le moment clé.** On ne s'arrête pas aux corrections : **on relit les corrections elles-mêmes.** Et là, on trouve un défaut sérieux **dans la correction que l'IA venait tout juste d'écrire**.

---

## Le bug, expliqué pour tout le monde

Le programme tient un **journal** : une trace de ce qui se passe, pour pouvoir enquêter en cas de pépin. Ce journal doit « tourner » (garder les récents, écarter les vieux) selon son **âge**.

Comment connaître l'âge d'un fichier ? La façon évidente : lire sa **date de création**. Sauf que Windows cache un piège, **activé par défaut**, appelé *file tunneling* : quand on recrée un fichier sous un nom récemment libéré, Windows lui recolle la **date de création de l'ancien**. Le journal tout neuf paraît alors très vieux → le programme le fait « tourner » en boucle → **le journal se détruit tout seul**.

Perdre ce journal, c'est perdre la trace qui sert justement à comprendre ce qui s'est passé — un défaut **silencieux**, qui ne se révèle qu'un jour de crise, sur des fondations censées durer.

**Le correctif :** ne jamais se fier à la date de création de Windows ; mesurer l'âge sur une horloge que le programme maîtrise. Le [code et son commentaire](https://github.com/YdvSystems/YdvVoice/blob/6b29d8c/src/orchestrator/audit/index.ts) l'expliquent, mot pour mot.

---

## Pourquoi ce n'est pas de la chance

Le défaut n'a pas été trouvé par hasard. Il a été trouvé parce que la méthode impose de **relire les corrections comme du code neuf** — car c'en est un. Une correction peut casser autant que le code d'origine.

Et ce n'est pas arrivé qu'une fois. Le même schéma revient, session après session, dans l'historique **public** :

| Commit | Ce que dit l'historique |
|---|---|
| [`07708e1`](https://github.com/YdvSystems/YdvVoice/commit/07708e1) | « plusieurs de mes corrections étaient elles-mêmes incomplètes » |
| [`6b29d8c`](https://github.com/YdvSystems/YdvVoice/commit/6b29d8c) | le tunneling NTFS **dans ma propre correction** (le cas ci-dessus) |
| [`772c9e9`](https://github.com/YdvSystems/YdvVoice/commit/772c9e9) | « à chaque tour, le trou était dans MES corrections » |
| [`36d1eb1`](https://github.com/YdvSystems/YdvVoice/commit/36d1eb1) | 13 défauts, puis 5 de plus au re-croisé — **tous dans mes corrections** |

C'est précisément ce constat, répété, qui a poussé la méthode à en faire une **étape nommée** : quand on corrige, on re-teste la correction.

---

## Les chiffres, vérifiables

- **18 audits croisés consécutifs, zéro faux positif.** (Source publique : [`docs/IMPLEMENTATION.md`](https://github.com/YdvSystems/YdvVoice/blob/main/docs/IMPLEMENTATION.md) — « zéro faux positif, 18 croisés consécutifs ».)
- « **Zéro faux positif** » veut dire : quand la méthode signale un défaut, c'en est un vrai — vérifié à la source à chaque fois. Pas de bruit, pas de quota d'alertes pour faire nombre.

---

## Et pour éviter l'auto-congratulation

Plus tard, un **modèle d'IA différent** a relu les plans en adversaire. Il a trouvé un défaut **bloquant** que les 18 relectures précédentes n'avaient pas vu : un effacement demandé par l'utilisateur qui ne descendait pas jusqu'au stockage — le contenu « effacé » pouvait réapparaître. Toujours **zéro faux positif**. Un œil neuf trouve ce que l'auteur ne voit pas : la méthode le sait, et l'organise. *(Source : [`docs/journal/audits/AUDIT-fable.md`](https://github.com/YdvSystems/YdvVoice/blob/main/docs/journal/audits/AUDIT-fable.md).)*

---

## Vérifie-le toi-même (2 minutes)

1. **Le commit :** [`6b29d8c`](https://github.com/YdvSystems/YdvVoice/commit/6b29d8c). Son message dit, mot pour mot : *« audité 2 tours (2 MAJEUR M1/M2 + tunneling NTFS dans ma propre correction, tous corrigés, 6 suites vertes) »*.
2. **Le correctif et son commentaire :** [`src/orchestrator/audit/index.ts`](https://github.com/YdvSystems/YdvVoice/blob/6b29d8c/src/orchestrator/audit/index.ts) — cherche « file tunneling ».
3. **Le chiffre :** [`docs/IMPLEMENTATION.md`](https://github.com/YdvSystems/YdvVoice/blob/main/docs/IMPLEMENTATION.md) — « 18 croisés consécutifs ».

---

## Ce que ça prouve — et ce que ça ne prouve pas

- **Ça prouve :** une discipline qui attrape ses propres erreurs, tracée publiquement, commit après commit. C'est la méthode en actes, pas un discours.
- **Ça ne prouve pas :** que Sophia est un produit fini. Ce n'en est pas un — les fondations sont solides et **en cours**, la voix est prouvée en vrai, la persona n'est pas encore posée. Le sujet ici, c'est la **méthode**, pas le produit.

---

*[← Retour à l'accueil du dépôt](../../README.md)*
