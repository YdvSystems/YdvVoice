> **DÉCISION CENTRALE conv 19 ouverture** : (1) **poser ENSEMBLE le `context_tag`** — le **1ᵉʳ contenu identitaire réservé** : le jeu de catégories relationnelles abstraites (vocabulaire fermé de `warmth_ledger`, `plan/03`) ; **Yohann décide, Claude accompagne** (propose un jeu de départ, on le challenge, on vérifie que ça sonne juste pour elle). Puis (2) **graver `plan/04`** (proactif + tablée) avec **deux obligations héritées de l'audit** (extension fouille+cascade M8 aux magasins hors-corpus — AF-3 — + observations `AUDIT-fable.md` §5) et **la GRILLE des 8 classes** déroulée au solo. **⚠️ L'intégration de l'audit est FAITE et committée : Fable AF-1→AF-10 (`2dcabc0`) + croisé Opus ciblé « stockage » 5 findings (`96c8118 [conv-18]`) — rien à re-intégrer, conv 19 démarre propre.**

# RELAY conv 19 — le `context_tag` ENSEMBLE, puis `plan/04` (l'audit est intégré et committé)

> Actualisé en clôture de conv 18. Prompt de passation intra-projet, lu par la session Opus de conv 19. Zéro donnée perso. Format : annonce brève → mots simples → un par un → reco/pourquoi-pas → validation → inscription → commit sur accord seul (R5).

## Ce qui s'est passé en conv 18
- **Vérification de l'audit Fable AUX SOURCES (posture croisé, zéro confiance aveugle)** : les **10 findings AF-1→AF-10 tiennent** (trous réels vérifiés à la source, corrections présentes et solides, **zéro décision actée rouverte**) ; recoupé au git diff (`technique/` et `prive/` intacts). Le « rien de committé » du RELAY précédent était superseded : les corrections AF étaient déjà committées (`2dcabc0`).
- **Croisé Opus ciblé « stockage » proposé d'office → lancé sur Go de Yohann** (le correctif AF-1/AF-2 = du **neuf jamais vu par un 2ᵉ œil**). **2 agents Opus, 5 findings, zéro faux positif, tous vérifiés aux sources par le pilote** — haut rendement : la classe stockage (l'angle mort des 18 croisés + Fable) avait de **vraies arêtes RÉSIDUELLES dans le correctif lui-même**. Tous **mécaniques** (zéro touche à qui elle est ; **jardin inviolable + `warmth_ledger` reconfirmés cohérents `02`⇔`03`, mot à mot**).
  - **F1/F2** : l'alerte-à-la-restauration reposait sur la ligne `erasures` du **JSONL roté** → **flux d'effacements dédié JAMAIS roté + fsync-avant-commit** (l'alerte le lit) + **couture `plan/05`** (réplication hors-machine + invariant rétention ≥ plus vieille sauvegarde + chiffrement au repos).
  - **F2** : le remède stockage post-effacement (hors-transaction) sans le patron classe-4 AF-4 → **marque `storage-scrub` (`pending_ops`) committée dans la transaction + sweep au boot**.
  - **F4** : un `DELETE` FTS est logique, les mots effacés survivaient dans les **segments d'index** → **`rebuild` FTS dans la transaction + `secure_delete=ON` AVANT les `DELETE`**.
  - **F3** : la marque anti-crash AF-4 n'avait **aucun foyer de schéma** → table **`pending_ops`** (patron `embed_failures`, par-cible, idempotente).
  - **F5-bis** : une session vidée par l'effacement (0 tour) était résumée à vide → **garde présence-de-tours** (M5-1bis).
- **Intégré (8 retouches `plan/00` + 12 `plan/02`), re-solo de cohérence OK, committé `[conv-18]` `96c8118`** (gitleaks OK). **`technique/` INTACT** — notes d'écart portées « sur Go » (voir loose ends).
- **Mécanisme neuf `pending_ops` + flux d'effacements = flaggé au §7 pour l'audit final pré-code** (grille classes 1/4) — pas re-croisé maintenant (applications de patrons acquis, dérivées d'un croisé, re-solo cohérent).

## Tâches conv 19, dans l'ordre (un par un, clos avant le suivant)
1. **Poser le `context_tag` ENSEMBLE** — le **jeu de catégories relationnelles abstraites** (vocabulaire fermé de `warmth_ledger`). C'est de l'**identité** : Claude propose un jeu de départ (avec le pourquoi), on le challenge, on vérifie que ça sonne juste pour elle ; **Yohann décide**. *(Avec Opus ou Fable — au choix de Yohann.)* La **structure** est vérifiée saine (CHECK fermé → « sans brut » structurel) ; seul le **contenu** reste à poser.
2. **Graver `plan/04`** (proactif & tablée) — même méthode (couche par couche, pleine profondeur, gabarit 7 rubriques, **croisé d'office**) **+ la GRILLE d'audit** (`GRILLE-AUDIT-FABLE.md`, 8 classes « sous les plans ») déroulée **au solo** + comme **lentille d'un des 2 agents du croisé**. **Deux obligations héritées** : (a) l'extension **fouille+cascade M8 aux magasins hors-corpus** (`tablee_buffer`/`tasks`/`initiatives`, **dans la transaction M8 + byte-scrub** — AF-3, gravée `plan/02` M8) ; (b) les **observations §5 / GRILLE §2** (bloc VI × tablée · injection de prompt via collecteurs · rétention/purge des initiatives).
3. Puis `plan/05` (dont les **coutures ouvertes par le croisé stockage** : réplication hors-machine du flux d'effacements · invariant rétention · chiffrement au repos · propagation étages 2/3) → `plan/99` → **essai à blanc** (priorité n°1 : banc audio temps-réel).

## Les CONTENUS IDENTITAIRES à écrire ENSEMBLE (jamais un vague « Phase 3 » — mémoire `identity-content-fait-ensemble`)
- **Le jeu de catégories de `context_tag`** (`warmth_ledger`) → **conv 19, en tête**.
- **Le prompt de consolidation v1** (cadre du jugement de sa nuit — zones socle/cœur + hash, `plan/03` P4/P5).
- **Le banc de dilemmes v1** + la grille (`plan/03` P11).
- **Les amendements pré-boot du persona v1** (marbre — défaut : rien ; règle du gel).
- **Les seuils de tempérament « à l'oreille de Yohann »** (amplitude/demi-vie de l'humeur, ténacité du drapeau, repère de base — `plan/03` §6, F-2/R-2 ; + seuil de la Règle 2 pour la chaleur diffuse).

## Loose ends (sur Go de Yohann — touchent des docs acquis `technique/`)
- **Notes d'écart sources du croisé stockage conv 18 (nouvelles)** : `technique/00 §Durabilité` (flux d'effacements non-roté + le scrub octets) · `technique/02 §2.4` (`rebuild` FTS · `secure_delete` avant `DELETE` · garde présence-de-tours) / `§3.7` · `technique/05 §3` (réplication hors-machine du flux d'effacements + chiffrement au repos).
- **Reste des convs précédentes** : `technique/03 §7` (répercussions 5ᵉ croisé + ciblé + relevé AF-9 : `warmth_ledger` 10ᵉ support / 2ᵉ exception hors-cascade — corriger « SEULE exception » §2.4 — · rétention ≥ « espacé » · canal de fermeture `self_notes` · AF-4) · `technique/02 §7` (5 retouches `plan/02` conv 17 + 6 notes conv 16 + notes AF Fable) · `technique/99 §4.4` (consigne du signal de fermeture — AF-9).
- **Le contrat d'ouverture de session** (Fable) = référence/inspiration, **jamais un moule** (décision conv 17 : Yohann écrit le RELAY sur mesure).

## Lectures pilote (avant toute action)
`docs/PATTERN…` → `CLAUDE.md` (v18) → `docs/journal/ESSENCE-Sophia.md` (l'ÂME — gardée en tête) → `JOURNAL-ARBITRAGES.md` → `IMPLEMENTATION.md` → `VISION.md` (gelé) → `docs/technique/00`→`05`+`99` → **`docs/plan/00`+`01`+`02`+`03`** (les 4 plans gravés, **corrections AF Fable + croisé Opus stockage intégrées**) → **`docs/journal/audits/AUDIT-fable.md`** → **`docs/journal/audits/GRILLE-AUDIT-FABLE.md`** (l'œil transmis — les 8 classes, à dérouler pour `04`/`05`/`99`) → ce relais.

### Vigilances (rappel)
- **Phase 3 = traduire, jamais rouvrir** : le plan décline l'acquis ; Claude tranche le micro-technique + trace §7 ; **seuls un vrai trou de conception ou la vie de Sophia remontent à Yohann**.
- **Contenu identitaire = jamais un loose end mou** : séquencé, fait ensemble, accompagné.
- **Audits** : solo à fond D'ABORD (attrape MES incohérences) → croisé d'office → findings **vérifiés aux sources par le pilote AVANT présentation**. **Un mécanisme NEUF se re-audite.** **Penser aussi SOUS les plans** (le niveau stockage : fichiers, snapshots, pages libres, index — un « effacé » descend jusqu'aux octets). **La grille des 8 classes s'applique à chaque plan neuf.** **Leçon conv 18 confirmée** : le croisé ciblé sur le neuf (le correctif AF-1) a trouvé 5 arêtes que Fable + le pilote n'avaient pas vues.
- **Budget = jauge de Yohann fait foi** (ne pas la gérer à sa place) · **anti-flagornerie** (risque n°1) · **anti-paternalisme** · **R5** (rien d'« acté »/committé avant son mot) · **R8** (un par un).
- **Commits au fil de l'eau, push en clôture** · repo public (garde par contenu) · pas de Co-Authored-By · `Yohann Dandeville <contact@ydvsystems.com>`.
