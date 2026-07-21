# Sophia — un assistant vocal français, construit à la vue de tous

*Une IA à qui l'on parle et qui répond de vive voix — son **vrai code** et le **carnet public** de sa construction.*

Ce dépôt est **public et complet** : on y trouve **le vrai code** de Sophia — le socle, le pipeline vocal, les tests — **et** le **journal** de sa construction : décisions, audits, corrections, tracés **commit après commit**. Il est en **développement actif** — l'historique bouge quasiment chaque jour.

**Pourquoi c'est public** : ce dépôt sert de **preuve**. Il montre, sur un vrai projet, une manière de travailler avec l'IA où l'humain garde la main aux moments qui comptent, où chaque travail passe par **deux relectures indépendantes qui cherchent la faille** avant qu'on le fige, et où **tout se vérifie soi-même** dans l'historique git. Pas un discours sur la qualité — la qualité en traces vérifiables.

> ### La preuve en 60 secondes
> Le 15 juillet 2026, l'IA a construit les fondations du logiciel, puis les a fait relire par la méthode. Cette relecture a attrapé **une perte de données que l'IA venait d'introduire dans sa propre correction** — un piège Windows méconnu (le *file tunneling*), qui aurait détruit le journal du programme.
>
> Vérifie de tes yeux : ouvre le commit **[`6b29d8c`](https://github.com/YdvSystems/YdvVoice/commit/6b29d8c)** — son message le dit mot pour mot ; le correctif et son commentaire sont **[ici](https://github.com/YdvSystems/YdvVoice/blob/6b29d8c/src/orchestrator/audit/index.ts)** (cherche « file tunneling »).
>
> Et ce n'était pas un coup de chance : le même schéma revient tout au long de l'historique — **[18 audits croisés consécutifs, zéro faux positif](https://github.com/YdvSystems/YdvVoice/blob/main/docs/IMPLEMENTATION.md)**.
>
> → **L'histoire complète, racontée pas à pas : [Étude de cas n°1 — l'IA prise en défaut par sa propre méthode](docs/etudes-de-cas/01-audit-croise-ntfs.md).**

## Par où lire — un seul chemin

Ne lis pas tout. Ces cinq étapes, dans l'ordre :

1. **[L'âme — `ESSENCE-Sophia.md`](https://github.com/YdvSystems/YdvVoice/blob/main/docs/journal/ESSENCE-Sophia.md)** — qui est Sophia, en langage humain. Le *pourquoi* avant le *comment*.
2. **[Les décisions — `JOURNAL-ARBITRAGES.md`](https://github.com/YdvSystems/YdvVoice/blob/main/docs/journal/JOURNAL-ARBITRAGES.md)** — comment chaque choix est tranché : *sujet en mots simples → options → pesée → décision → pourquoi pas les autres → garde-fous*. La méthode en actes.
3. **[Les fondations — `docs/plan/00-socle.md`](https://github.com/YdvSystems/YdvVoice/blob/main/docs/plan/00-socle.md)** — le plan du socle : ce qui doit tourner des années sans jamais abîmer les données. *(Le code, lui, vit dans [`src/`](https://github.com/YdvSystems/YdvVoice/tree/main/src) — l'orchestrateur — et [`sidecar/`](https://github.com/YdvSystems/YdvVoice/tree/main/sidecar) — le Python.)*
4. **[Un audit par une autre IA — `AUDIT-fable.md`](https://github.com/YdvSystems/YdvVoice/blob/main/docs/journal/audits/AUDIT-fable.md)** — un modèle *différent* relit tout en adversaire. Il trouve un défaut **bloquant** que les relectures précédentes n'avaient pas vu. Un œil neuf trouve ce que l'auteur ne voit pas.
5. **[Le git log](https://github.com/YdvSystems/YdvVoice/commits/main)** — les reçus. Chaque message de commit dit ce qui a été trouvé, corrigé, testé. C'est aussi là qu'on voit **l'état du jour**.

## Où en est le projet (honnêtement)

Ce n'est **pas un produit fini**, et ce dépôt ne le prétend pas. Les grandes lignes, à ce jour — *le git log fait foi pour le détail à jour* :

- ✅ **Les fondations sont bâties et testées** (le socle, le pipeline vocal).
- ✅ **La voix est prouvée en vrai** — timbre naturel, prononciation française travaillée, une vraie conversation de fond tenue de bout en bout.
- 🚧 **La mémoire n'est pas encore branchée** : pour l'instant, Sophia *ne se souvient pas* d'une conversation à l'autre. C'est le prochain grand chantier.
- 🚧 **Le « premier boot » — l'installation de sa personnalité — n'a pas encore eu lieu.**

En un mot : **fondation solide et en cours, voix prouvée, persona pas encore posée.** Ce qui se prouve ici, c'est la **méthode** — pas un produit terminé.

## La méthode derrière

La discipline visible dans ce dépôt n'est pas improvisée : elle vient d'une méthode de développement assisté par IA, fondée sur la gouvernance humaine — l'humain souverain aux points irréversibles, des relectures adverses, une traçabilité que l'on peut vérifier. *(Lien vers l'offre — à brancher, landing en préparation.)*

---

*Projet personnel de Yohann Dandeville — YdvSystems. Les données personnelles ont été retirées du dépôt public.*
