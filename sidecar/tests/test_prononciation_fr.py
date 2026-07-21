# -*- coding: utf-8 -*-
"""Prononciation « à la française » (plan prononciation-fr, conv 53) — la couche `apply_context`.

Logique PURE (déterministe, SANS Piper ni audio) : chaque correction validée à l'oreille de Yohann (A/B),
les FAMILLES (pluriels/dérivés/conjugaisons), la règle de l'homographe « plus », et surtout la
NON-RÉGRESSION (NO-OP sur tout ce qui n'est pas un trigger → espeak garde ses cas déjà justes).

Contrainte : tout `[[IPA]]` vit dans l'inventaire des 166 phonèmes du modèle A20 (phoneme_type espeak).
"""
from tts.text import apply_context, apply_lexicon, for_synth, normalize, _PRONUNCIATION, _PRONUNCIATION_CS, LEXICON


# ══════════ Homographe « plus » : la négation décide (règle donnée par Yohann) ══════════

def test_plus_negation_muet():
    # « je n'en veux plus » = négation → S MUET (/ply/). C'est le cas flagué #2.
    assert for_synth("Je n'en veux plus.") == "Je n'en veux [[ply]]."
    assert for_synth("Il ne fume plus.") == "Il ne fume [[ply]]."
    assert for_synth("Je ne veux plus !") == "Je ne veux [[ply]] !"


def test_plus_davantage_reste_espeak():
    # « j'en veux plus » = davantage → S entendu (/plys/) : espeak le fait DÉJÀ bien (#1 non flagué) → on
    # ne touche PAS (pas de « ne/n' »). Idem « à plus tard » (déjà juste, non flagué).
    assert for_synth("J'en veux plus.") == "J'en veux plus."
    assert for_synth("À plus tard.") == "À plus tard."
    assert for_synth("Il en veut plus que moi.") == "Il en veut plus que moi."


def test_plus_comparatif_avec_pas_reste_espeak():
    # « ne … pas plus » = comparatif (« pas davantage ») → /plys/ : le « pas » entre ne et plus BLOQUE la
    # règle (sinon on rendrait à tort le S muet). LE TEST MORD (sans la garde `pas`, ce serait « [[ply]] »).
    assert for_synth("Il ne mange pas plus.") == "Il ne mange pas plus."
    assert for_synth("Ce n'est pas plus mal.") == "Ce n'est pas plus mal."


def test_plus_gardes_negation_completes():
    # Audit conv 53 (MAJEUR corrigé) : tout mot COMPARATIF/restrictif entre « ne » et « plus » bloque la
    # règle → « plus » = davantage reste /plys/ (espeak). LE TEST MORD (sans ces gardes, ce serait [[ply]]).
    assert for_synth("Il ne veut rien de plus.") == "Il ne veut rien de plus."            # rien
    assert for_synth("Je ne demande qu'un peu plus.") == "Je ne demande qu'un peu plus."    # qu' élidé
    assert for_synth("Je n'ai que ça de plus.") == "Je n'ai que ça de plus."               # que
    assert for_synth("Il ne voit personne de plus.") == "Il ne voit personne de plus."     # personne


def test_plus_jamais_est_negation():
    # « ne … jamais plus » = « plus jamais » = négation → S MUET. « jamais » NE bloque PAS (linguistique).
    assert for_synth("Il ne le fera jamais plus.") == "Il ne le fera jamais [[ply]]."


def test_plus_milieu_de_proposition_laisse_espeak():
    # Limite assumée : « plus » PAS en fin de proposition → laissé à espeak (sous-correction SÛRE, jamais
    # une régression). Documentée, réglable plus tard si besoin.
    assert for_synth("Je ne veux plus rien.") == "Je ne veux plus rien."
    assert for_synth("Il n'y a plus de pain.") == "Il n'y a plus de pain."


# ══════════ Mots durs validés (A/B) + leurs familles ══════════

def test_mots_valides_singulier():
    cases = {
        "C'est cathartique.":            "C'est [[kataʁtik]].",
        "Un penseur présocratique.":     "Un penseur [[pʁesɔkʁatik]].",
        "Justement.":                    "[[ʒystəmɑ̃]].",
        "Quel glouton.":                 "Quel [[ɡlutɔ̃]].",
        "La souveraineté.":              "La [[suvøʁɛːnte]].",
        "Un stoïcien.":                  "Un [[stɔˈisjɛ̃]].",
        "Voici un millénaire.":          "Voici un [[milenɛːʁ]].",
        "Voici un philosophe.":          "Voici un [[filɔzˈɔf]].",
    }
    for src, exp in cases.items():
        assert for_synth(src) == exp, f"for_synth({src!r}) = {for_synth(src)!r} != {exp!r}"


def test_familles_generalisees():
    # Le mot + ses dérivés/pluriels/conjugaisons (le « travail de fond » de Yohann).
    assert for_synth("Les philosophes grecs.") == "Les [[filɔzˈɔf]] grecs."
    assert for_synth("Deux gloutons.") == "Deux [[ɡlutɔ̃]]."
    assert for_synth("Le stoïcisme et les stoïques.") == "Le [[stɔˈisism]] et les [[stɔˈik]]."
    assert for_synth("Je vais te challenger.") == "Je vais te [[tʃalɛndʒe]]."
    assert for_synth("Il me challenge et je le challenge.") == "Il me [[tʃalɛndʒ]] et je le [[tʃalɛndʒ]]."


def test_challenger_verbe_et_nom_propre_distincts():
    # Le VERBE minuscule « challenger » → /tʃalɛndʒe/ (apply_context, sensible casse) ET le NOM PROPRE
    # capitalisé « Challenger » → /tʃalɛndʒœʁ/ (apply_lexicon, passe anglais conv 54) restent DISTINCTS :
    # le dico sensible-casse (verbe) et le lexique (nom propre) ne se marchent jamais dessus. LE TEST MORD.
    assert for_synth("Je vais te challenger.") == "Je vais te [[tʃalɛndʒe]]."                     # verbe
    assert for_synth("Voici le professeur Challenger.") == "Voici le professeur [[tʃalɛndʒœʁ]]."  # nom propre EN


def test_anglais_a_la_francaise_conv54():
    # Passe « anglais à la française » (conv 54) : espeak nasalisait les noms EN → francisation validée A/B. MORD.
    assert for_synth("Le personnage de Jesse Pinkman.") == "Le personnage de [[dʒese pinkman]]."
    assert for_synth("J'ai regardé The Wire.") == "J'ai regardé [[ðə wajœʁ]]."
    assert for_synth("Un film avec Kevin Bacon.") == "Un film avec [[kevin bekɔn]]."
    assert for_synth("Le film Footloose.") == "Le film [[futluz]]."
    assert for_synth("Un film de David Fincher.") == "Un film de [[david finʃœʁ]]."
    # « Thriller » (clip, majuscule) ET « thriller »/« thrillers » (le genre, courant) → /tʁilœʁ/ via
    # _PRONUNCIATION INSENSIBLE à la casse (audit conv 54, NIT-2 : le genre minuscule est un mot courant). MORD.
    assert for_synth("Le clip Thriller.") == "Le clip [[tʁilœʁ]]."
    assert for_synth("Un bon thriller ce soir.") == "Un bon [[tʁilœʁ]] ce soir."
    assert for_synth("Il adore les thrillers.") == "Il adore les [[tʁilœʁ]]."
    # Seven ÉCARTÉ à l'oreille (l'actuel espeak est meilleur) → NON gravé, reste tel quel. LE TEST MORD.
    assert for_synth("Le film Seven.") == "Le film Seven."


def test_fond_erreurs_espeak_auto_trouvees():
    # FOND conv 53 : corrections trouvées AUTOMATIQUEMENT (espeak vs Lexique383) + validées A/B. LE TEST MORD.
    assert for_synth("Quel tempérament.") == "Quel [[tɑ̃peʁamɑ̃]]."          # -ent muet à tort
    assert for_synth("Sois indulgent.") == "Sois [[ɛ̃dylʒɑ̃]]."
    assert for_synth("C'est laid.") == "C'est [[lɛ]]."                        # consonne finale à tort
    assert for_synth("Comme jadis.") == "Comme [[ʒadis]]."                    # consonne finale oubliée
    assert for_synth("C'est gratis.") == "C'est [[ɡʁatis]]."
    assert for_synth("C'est son alias.") == "C'est son [[aliˈas]]."           # amélioré round 3
    assert for_synth("Chut, écoute.") == "chute, écoute."                     # respelling (espeak dit « chute »)


def test_tics_live_round2():
    # conv 53 round 2 : tics notés en conversation LIVE, validés A/B. LE TEST MORD.
    assert for_synth("Il mentionne cela.") == "Il [[mɑ̃sjɔn]] cela."          # -ti- → /sj/
    assert for_synth("C'est authentique.") == "C'est [[otɑ̃tik]]."             # « th » anglais → /ot/
    assert for_synth("Un peu de respect.") == "Un peu de [[ʁɛspɛ]]."          # ct muet (NOM)
    assert for_synth("Il a quinze ans.") == "Il a [[kɛ̃zɑ̃]]."                 # liaison forcée
    assert for_synth("Il a 15 ans.") == "Il a [[kɛ̃zɑ̃]]."                     # même, en chiffres
    assert for_synth("Il faut respecter.") == "Il faut respecter."            # le VERBE garde son /kt/ (intact)
    assert for_synth("On se voit aujourd'hui.") == "On se voit aujourd'hui."  # espeak mieux → non touché


def test_fond_famille_laid_sans_toucher_le_feminin():
    # « laid »/« laids » (masc, d muet) → /lɛ/ ; « laide »/« laides » (fém, d sonore) LAISSÉS à espeak
    # (qui les dit juste). LE TEST MORD : une correction trop large aurait cassé le féminin.
    assert for_synth("Un homme laid.") == "Un homme [[lɛ]]."
    assert for_synth("Une femme laide.") == "Une femme laide."               # intact (espeak dit déjà /lɛd/)
    assert for_synth("Des gens laids.") == "Des gens [[lɛ]]."
    assert for_synth("Des robes laides.") == "Des robes laides."             # intact


def test_sac_a_dos_multimot():
    assert for_synth("Voici un sac à dos.") == "Voici un [[sak a doː]]."


def test_fond_s_finaux_conv54():
    # FOND conv 54 : les S finaux débusqués (espeak↔Lexique383) + validés A/B. IPA quand espeak DÉFORME le
    # mot, RESPELLING (« …sse ») quand la couleur d'espeak est bonne et qu'il manque juste le S. LE TEST MORD.
    assert for_synth("Il se muscle les biceps.") == "Il se muscle les [[bisɛps]]."   # S mangé → IPA
    assert for_synth("J'étais bon en maths.") == "J'étais bon en [[mat]]."           # /maθs/ anglais → /mat/
    assert for_synth("Les mœurs ont changé.") == "Les mœurse ont changé."            # respell → /mœʁs/
    assert for_synth("Les moeurs ont changé.") == "Les moeurse ont changé."          # graphie sans ligature
    assert for_synth("Il range son matos.") == "Il range son matosse."               # respell → /matɔs/
    assert for_synth("Le cosmos est immense.") == "Le cosmosse est immense."         # respell → /kɔsmɔs/


def test_conv54_tics_2e_conversation():
    # Tics relevés en CONVERSATION réelle (juge, 2e session), validés A/B à l'oreille. LE TEST MORD.
    assert for_synth("Je ne sais pas ce que je ressens.") == "Je ne sais pas ce que je [[ʁəsɑ̃]]."
    assert for_synth("Comment se relationner aux autres.") == "Comment se [[ʁəlasjɔne]] aux autres."
    assert for_synth("Le machine learning progresse.") == "Le machine [[lœʁniŋɡ]] progresse."
    # « ressent » (3e pers.) reste à espeak (déjà bon) — la clé « ressens » ne doit PAS le happer. LE TEST MORD.
    assert for_synth("Il ressent quelque chose.") == "Il ressent quelque chose."
    # Le RESTE de la liste = espeak déjà meilleur à l'oreille → NON touché (l'oreille prime sur Lexique). LE TEST MORD.
    for s in ["Penser à autrui.", "Quelque chose de fluide.", "Une fonction cognitive.",
              "C'est absolument vrai.", "Une idée abstraite.", "Une pensée introspective.",
              "Parce que oui.", "C'est très rare."]:
        assert for_synth(s) == s, f"ne devait PAS être touché (l'oreille prime sur Lexique) : {s!r}"


def test_s_finaux_ecartes_restent_espeak():
    # Écartés À L'OREILLE (le dico ne les touche PAS) : détritus (S muet = exception que Lexique ratait),
    # « dos » seul (juste en phrase), puis/depuis/puits (déjà bons). LE TEST MORD : une sur-correction casserait.
    assert for_synth("Un tas de détritus.") == "Un tas de détritus."
    assert for_synth("J'ai mal au dos.") == "J'ai mal au dos."                        # « dos » seul intact…
    assert for_synth("Voici un sac à dos.") == "Voici un [[sak a doː]]."              # …mais « sac à dos » couvert
    assert for_synth("Et puis il partit.") == "Et puis il partit."
    assert for_synth("Depuis longtemps.") == "Depuis longtemps."
    assert for_synth("Un puits profond.") == "Un puits profond."


def test_dix_neuvieme_depuis_normalize():
    # La chaîne normalize → apply_context : « 19e » → « dix-neuvième » → [[disnœvjɛm]].
    assert normalize("Au 19e siècle.") == "Au dix-neuvième siècle."
    assert for_synth("Au 19e siècle.") == "Au [[disnœvjɛm]] siècle."
    assert for_synth("Au 19ème siècle.") == "Au [[disnœvjɛm]] siècle."


def test_casse_insensible():
    # En début de phrase (majuscule) → corrigé pareil.
    assert for_synth("Philosophe de génie.") == "[[filɔzˈɔf]] de génie."
    assert for_synth("Stoïcien avant tout.") == "[[stɔˈisjɛ̃]] avant tout."


# ══════════ NON-RÉGRESSION : NO-OP sur ce qui n'est pas un trigger ══════════

def test_apply_context_noop_texte_courant():
    for s in ["Bonjour, comment vas-tu ?", "Le chat dort sur le canapé.",
              "En fait, tu as raison.", "Voici une époque.", "Voici Napoléon."]:
        assert apply_context(s) == s, f"apply_context a modifié un texte sans trigger : {s!r}"


def test_non_regression_pipeline_v7():
    # Le cas EXACT de test_v7 (for_synth) doit rester identique : apply_context = NO-OP ici, normalize et
    # apply_lexicon intacts. Garde-fou ⛔ « zéro régression ».
    assert for_synth("Bonjour Yohann, sous Louis XIV, en 1789.") == \
        "Bonjour [[joˈann]], sous Louis quatorze, en 1789."


def test_context_avant_lexicon():
    # Les deux couches composent : un nom propre (lexique) + un mot dur (contexte) dans la même phrase.
    assert for_synth("Kant était un philosophe.") == "[[kɑ̃t]] était un [[filɔzˈɔf]]."


def test_dico_taille_garde():
    # Garde-fou : les dicos ne rétrécissent pas par accident (mots + familles validés conv 53-54).
    assert len(_PRONUNCIATION) + len(_PRONUNCIATION_CS) >= 30
    assert len(LEXICON) >= 47                          # noms propres (dont 6 anglais conv 54) — ne rétrécit pas
    # Chaque valeur = un [[IPA]] bien formé OU un respelling FR nu (ex. « chut »→« chute ») — jamais vide/identique.
    # Couvre AUSSI le lexique des noms propres (audit conv 54, NIT : les [[IPA]] anglais y étaient sans garde-fou).
    for d in (_PRONUNCIATION, _PRONUNCIATION_CS, LEXICON):
        for k, v in d.items():
            assert v and v != k, f"{k} → {v!r} valeur vide ou identique à la clé"
            assert v.count("[[") == v.count("]]"), f"{k} → {v} crochets IPA déséquilibrés"
