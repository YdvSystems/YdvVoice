# -*- coding: utf-8 -*-
"""Sophia — sidecar / TTS : normalisation FR + lexique de prononciation (plan 01, V7).

Deux gestes AVANT le moteur (Piper/espeak), PORTÉS FIDÈLEMENT du banc (conv 26/34, validés à l'oreille
de Yohann — règle perf « produit >= banc » : « Yohann » doit être dit juste) :
  1. `normalize(text)` — déplie chiffres/dates/heures/%/monnaie/unités/romains/sigles → MOTS (règle le
     G2P des nombres, couvre même l'inédit). Pur texte → texte ; en cas de doute, LAISSE PASSER (jamais
     de plantage sur la parole). Copie fidèle de `bancs/aec/text_normalize.py` (prouvé par son banc de
     tests, porté en pytest `test_tts_text.py`).
  2. `apply_lexicon(text)` — noms propres → phonétique IPA `[[...]]` OU respelling FR, à l'ENTRÉE du
     moteur SEULEMENT (l'orthographe réelle reste intacte partout ailleurs — mémoire/texte). 41 entrées
     validées à l'oreille (conv 26/34) : « Yohann »→`[[joˈann]]` (espeak nasalise « an »), « Descartes »,
     + les 39 de `bancs/aec/lexique_valide.py:VALIDATED`.

Le pipeline de synthèse (engine.py) : `apply_lexicon(normalize(text))` → Piper. ÉCART A9/A20 tracé
`01` §7 (moteur = Piper A20, pas Kokoro). Module PUR (juste `re`) → testable sans moteur ni audio.
"""
from __future__ import annotations

import re

# ═══════════════════════════════════════════════════════════════════════════════
#  1) normalize() — chiffres/dates/… → mots (copie fidèle du banc, prouvée)
# ═══════════════════════════════════════════════════════════════════════════════

# Nombres cardinaux (0 → milliards). Le « s » muet (cents/quatre-vingts) est sans effet à l'oreille.
UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
         "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"]
TENS = {2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante"}


def two_digits(n: int) -> str:
    """0 → 99, avec les pièges FR (soixante-dix, quatre-vingts, « et un »)."""
    if n < 17:
        return UNITS[n]
    if n < 20:
        return "dix-" + UNITS[n - 10]
    ten, u = n // 10, n % 10
    if ten in (2, 3, 4, 5, 6):
        b = TENS[ten]
        if u == 0:
            return b
        if u == 1:
            return b + " et un"
        return b + "-" + UNITS[u]
    if ten == 7:
        if u == 1:
            return "soixante et onze"
        return "soixante-" + two_digits(10 + u)
    if ten == 8:
        if u == 0:
            return "quatre-vingts"
        return "quatre-vingt-" + UNITS[u]
    return "quatre-vingt-" + two_digits(10 + u)          # 90-99


def _group(g: int, terminal: bool = True) -> str:
    """1 → 999. `terminal` : « cent » ne prend le « s » que s'il finit le nombre."""
    h, r = g // 100, g % 100
    parts = []
    if h == 1:
        parts.append("cent")
    elif h > 1:
        parts.append(UNITS[h] + " cent" + ("s" if (r == 0 and terminal) else ""))
    if r > 0:
        parts.append(two_digits(r))
    return " ".join(parts)


def int_to_fr(n: int) -> str:
    if n == 0:
        return "zéro"
    neg = n < 0
    n = abs(n)
    parts = []
    for value, name in ((10**9, "milliard"), (10**6, "million"), (10**3, "mille"), (1, "")):
        if n >= value:
            count = n // value
            n %= value
            if name == "mille":
                parts.append("mille" if count == 1 else _group(count, terminal=False) + " mille")
            elif name == "":
                parts.append(_group(count, terminal=True))
            else:                                    # million/milliard = noms → « cent » peut prendre le s
                parts.append(_group(count, terminal=True) + " " + name + ("s" if count > 1 else ""))
    res = " ".join(parts)
    return ("moins " + res) if neg else res


def ordinal_fr(n: int, feminine: bool = False) -> str:
    if n == 1:
        return "première" if feminine else "premier"
    card = int_to_fr(n)
    last = card.split()[-1].split("-")[-1]
    if last == "un":
        return card[:-2] + "unième"        # vingt et un -> vingt et unième
    if last.endswith("q"):
        base = card + "u"                   # cinq -> cinquième
    elif last.endswith("f"):
        base = card[:-1] + "v"              # neuf -> neuvième
    elif last.endswith("e"):
        base = card[:-1]                    # quatre/onze/... -> drop e
    else:
        base = card
    return base + "ième"


# Chiffres romains — validés par ré-encodage (rejette « IIII », « VV », faux).
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def _int_to_roman(n: int) -> str:
    if not (0 < n < 4000):
        return ""
    vals = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
            (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
    out = ""
    for v, sym in vals:
        while n >= v:
            out, n = out + sym, n - v
    return out


def roman_to_int(s: str):
    s = s.upper()
    if not s or any(c not in _ROMAN for c in s):
        return None
    total, prev = 0, 0
    for c in reversed(s):
        v = _ROMAN[c]
        total += -v if v < prev else v
        prev = max(prev, v)
    return total if _int_to_roman(total) == s else None       # canonique seulement


def _roman_ord(m):
    v = roman_to_int(m.group(1))
    return ordinal_fr(v) if v else m.group(0)


MONTHS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet",
          "août", "septembre", "octobre", "novembre", "décembre"]

# Unités : (singulier, pluriel). Le nombre décide (1 → singulier, sinon pluriel).
UNITS_MAP = {
    "km/h": ("kilomètre heure", "kilomètres heure"),
    "km": ("kilomètre", "kilomètres"), "cm": ("centimètre", "centimètres"),
    "mm": ("millimètre", "millimètres"), "m": ("mètre", "mètres"),
    "kg": ("kilogramme", "kilogrammes"), "g": ("gramme", "grammes"),
    "°C": ("degré", "degrés"), "°": ("degré", "degrés"), "L": ("litre", "litres"),
}

# Sigles épelés lettre par lettre. Ceux qui se lisent comme un MOT (OTAN, NASA…) ne sont PAS ici.
LETTERS_FR = {"A": "a", "B": "bé", "C": "cé", "D": "dé", "E": "e", "F": "effe", "G": "gé",
              "H": "ache", "I": "i", "J": "ji", "K": "ka", "L": "elle", "M": "emme",
              "N": "enne", "O": "o", "P": "pé", "Q": "ku", "R": "erre", "S": "esse",
              "T": "té", "U": "u", "V": "vé", "W": "double vé", "X": "ixe",
              "Y": "i grec", "Z": "zède"}
ACRONYMS_LETTERS = {"ONU", "SNCF", "ADN", "PDG", "TGV", "USA", "RATP", "CDI", "CDD",
                    "SMS", "TVA", "RIB", "IUT", "BTS", "PIB", "OMS", "FBI", "CIA"}

_NAMES = (r"Louis|Napoléon|Charles|Henri|Pie|Jean|Benoît|François|Philippe|Georges|"
          r"Guillaume|Édouard|Élisabeth|Frédéric|Léon|Paul|Innocent|Grégoire|Clément|"
          r"Alexandre|Ferdinand|Richard|Othon|Sixte|Urbain|Boniface")
# Contextes CARDINAUX (roman SANS suffixe) : rois (Louis XIV = quatorze) + structure (chapitre III = trois).
_CARD_CTX = rf"(?:(?:{_NAMES})\s+|(?i:chapitre|tome|acte|partie|livre|scène|article|numéro)\s+)"
# Contextes ORDINAUX pour un roman d'UNE lettre + « e » (Ve République, Xe siècle).
_ORD_CTX = r"(?:siècle|arrondissement|République|république|millénaire|dynastie|Concile)"


def _sup_norm(text: str) -> str:
    """Exposants Unicode (« ᵉ », « ʳ ») → lettres simples, pour le repérage des ordinaux."""
    return text.replace("ᵉ", "e").replace("ʳ", "r").replace("ᵈ", "d").replace("ᵃ", "a")


def _card_after(m):
    """Roman après un mot déclencheur → CARDINAL (Louis XIV → quatorze ; chapitre I → premier)."""
    v = roman_to_int(m.group(2))
    if not v:
        return m.group(0)
    return m.group(1) + (ordinal_fr(v) if v == 1 else int_to_fr(v))


def _date_words(d, mo, y):
    if not (1 <= d <= 31 and 1 <= mo <= 12):
        return None
    jour = "premier" if d == 1 else int_to_fr(d)
    s = f"{jour} {MONTHS[mo]}"
    if y is not None:
        s += " " + int_to_fr(y)
    return s


def _decimal_read(digits):
    """Partie décimale : GROUPÉE si courte et sans zéro de tête (« 3,14 » → « quatorze »), sinon
    chiffre par chiffre (« 3,14159 » ; « 3,05 » → « zéro cinq », sinon on perd le zéro)."""
    if len(digits) <= 2 and digits[0] != "0":
        return int_to_fr(int(digits))
    return " ".join(UNITS[int(c)] for c in digits)


def normalize(text: str) -> str:
    """Chiffres/dates/heures/%/monnaie/unités/romains/sigles → mots. Copie fidèle du banc (prouvée)."""
    t = _sup_norm(text)

    # 1) Dates jj/mm/aaaa puis jj/mm
    t = re.sub(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b",
               lambda m: _date_words(int(m.group(1)), int(m.group(2)), int(m.group(3))) or m.group(0), t)
    t = re.sub(r"\b(\d{1,2})/(\d{1,2})\b",
               lambda m: _date_words(int(m.group(1)), int(m.group(2)), None) or m.group(0), t)

    # 2) Heures : 14h30 · 14 h 30 · 9h · 1 h
    t = re.sub(r"\b(\d{1,2})\s*h\s*(\d{2})\b",
               lambda m: (("une heure" if int(m.group(1)) == 1 else int_to_fr(int(m.group(1))) + " heures")
                          + " " + int_to_fr(int(m.group(2)))), t)
    t = re.sub(r"\b(\d{1,2})\s*h\b",
               lambda m: ("une heure" if int(m.group(1)) == 1 else int_to_fr(int(m.group(1))) + " heures"), t)

    # 3) Pourcentages
    t = re.sub(r"\b(\d+)(?:,(\d+))?\s*%",
               lambda m: (int_to_fr(int(m.group(1)))
                          + (" virgule " + _decimal_read(m.group(2)) if m.group(2) else "") + " pour cent"), t)

    # 4) Monnaie €  (1,50 € → « un euro et cinquante centimes » ; 12 € → « douze euros »)
    def _euro(m):
        e = int(m.group(1))
        euros = "un euro" if e == 1 else int_to_fr(e) + " euros"
        if m.group(2):
            cv = int(m.group(2))
            return euros + " et " + int_to_fr(cv) + (" centime" if cv == 1 else " centimes")
        return euros
    t = re.sub(r"\b(\d+)(?:,(\d{2}))?\s*€", _euro, t)

    # 5) Unités avec nombre  (12 km, 1 kg, 20 °C, 130 km/h)
    def _unit(m):
        num = int(m.group(1).replace(" ", "").replace(".", ""))
        dec = m.group(2)
        sg, pl = UNITS_MAP[m.group(3)]
        txt = int_to_fr(num) + (" virgule " + _decimal_read(dec) if dec else "")
        return f"{txt} {sg if (num == 1 and not dec) else pl}"
    unit_alt = "|".join(re.escape(u) for u in sorted(UNITS_MAP, key=len, reverse=True))
    t = re.sub(rf"\b(\d[\d .]*?)(?:,(\d+))?\s*({unit_alt})(?![A-Za-zÀ-ÿ])", _unit, t)

    # 6) Ordinaux arabes  (1er, 1re, 2e, 2ème, 21e)
    t = re.sub(r"\b(\d+)\s*er\b", lambda m: ordinal_fr(int(m.group(1))), t)
    t = re.sub(r"\b(\d+)\s*(?:re|ère|res)\b", lambda m: ordinal_fr(int(m.group(1)), feminine=True), t)
    t = re.sub(r"\b(\d+)\s*(?:ème|èmes|es|e)\b", lambda m: ordinal_fr(int(m.group(1))), t)

    # 7) Chiffres romains — UNIQUEMENT dans des contextes SÛRS (jamais « Le »/« Ce »/« Mer ») :
    t = re.sub(r"\b([IVXLCDM]{2,})(?:er|e)\b", _roman_ord, t)                 # XVIe, IIe, XVIIIe
    t = re.sub(rf"\b([IVX])e\b(?=\s*{_ORD_CTX})", _roman_ord, t)              # Ve République, Xe siècle
    t = re.sub(r"\bIer\b", "premier", t)
    t = re.sub(r"\bI(?:re|ère)\b", "première", t)
    t = re.sub(rf"({_CARD_CTX})([IVXLCDM]+)\b", _card_after, t)               # Louis XIV, chapitre III

    # 8) Sigles épelés (laisse intacts ceux qui se lisent comme un mot)
    t = re.sub(r"\b[A-Z]{2,6}\b",
               lambda m: " ".join(LETTERS_FR[c] for c in m.group(0)) if m.group(0) in ACRONYMS_LETTERS else m.group(0), t)

    # 9) Décimaux (partie décimale chiffre par chiffre = robuste : 3,14 → « trois virgule un quatre »)
    t = re.sub(r"\b(\d+),(\d+)\b",
               lambda m: int_to_fr(int(m.group(1))) + " virgule " + _decimal_read(m.group(2)), t)

    # 10) SEULS les grands nombres à séparateurs de milliers (1 000 000 · 1.000) — espeak les lit mal.
    #     Les entiers/années NUS sont LAISSÉS À ESPEAK (Yohann conv 34 : il les dit très bien).
    t = re.sub(r"\b\d{1,3}(?:[ .]\d{3})+\b", lambda m: int_to_fr(int(re.sub(r"[ .]", "", m.group(0)))), t)

    return t


# ═══════════════════════════════════════════════════════════════════════════════
#  2) apply_lexicon() — noms propres → phonétique (41 entrées validées à l'oreille)
# ═══════════════════════════════════════════════════════════════════════════════
# Valeur = IPA entre [[...]] (Piper accepte les phonèmes inline — vérifié b3 conv 47) OU respelling FR nu.
# Clé = orthographe réelle (INTACTE en mémoire/texte ; la phonétique n'est appliquée qu'à l'entrée du moteur).
# Porté de `bancs/aec/lexique_valide.py:VALIDATED` (39) + « Yohann »/« Descartes » (de bouche_piper.py) = 41.
VALIDATED = {
    # Philosophes / penseurs
    "Nietzsche": "[[nitʃ]]", "Kant": "[[kɑ̃t]]", "Hegel": "Éguelle", "Schopenhauer": "[[ʃopɛnawɛʁ]]",
    "Heidegger": "[[ajdɛɡɛʁ]]", "Freud": "[[fʁœjd]]",
    # Scientifiques
    "Heisenberg": "[[ajzɛnbɛʁɡ]]", "Darwin": "Darouine",
    # Compositeurs / artistes
    "Bach": "[[bak]]", "Beethoven": "[[betɔvɛn]]", "Tchaïkovski": "[[tʃajkɔfski]]", "Van Gogh": "Van gogue",
    # Écrivains
    "Shakespeare": "[[ʃɛkspiʁ]]", "Goethe": "[[ɡøt]]", "Dostoïevski": "[[dɔstɔjɛfski]]",
    # Villes
    "Reykjavik": "[[ʁɛkjavik]]",
    # Fournée complète (conv 34)
    "Wittgenstein": "[[vitɡɛnʃtajn]]", "Weber": "[[vebɛʁ]]", "Copernic": "[[kɔpɛʁnik]]",
    "Bruckner": "[[bʁuknɛʁ]]", "Klimt": "[[klimt]]", "Stravinski": "[[stʁavinski]]",
    "Rachmaninov": "[[ʁakmaninɔf]]", "Prokofiev": "[[pʁokɔfjɛf]]", "Soljenitsyne": "[[sɔlʒenitsin]]",
    "Roosevelt": "[[ʁozvɛlt]]", "Wilde": "[[wajld]]", "Nabuchodonosor": "[[nabykɔdɔnɔzɔʁ]]",
    "Zarathoustra": "[[zaʁatustʁa]]", "Johannesburg": "[[joanɛsbuʁɡ]]", "Jung": "Yong",
    # Round 3 (conv 34)
    "Husserl": "[[usœʁl]]", "Brahms": "Bramss", "Vermeer": "[[vɛʁmɛːʁ]]", "Bruegel": "Breughelle",
    "Hemingway": "Éminngwé", "Lincoln": "Line-coln", "Gengis Khan": "Gennegisse Kann",
    "Schrödinger": "[[ʃʁo]] dine gueur",
}

# « Yohann » : espeak nasalise le « an » (→ « yan/yun »). Phonèmes IPA exacts [[joˈann]] (déterministe,
# banc 16→18). « Descartes » : espeak dit « des cartes » → [[dekaʁt]]. (bouche_piper.py conv 26/34.)
LEXICON = {"Yohann": "[[joˈann]]", "Descartes": "[[dekaʁt]]", **VALIDATED}   # 41 entrées


def apply_lexicon(text: str) -> str:
    """Remplace chaque nom du lexique (mot entier) par sa phonétique. Ordre : les clés multi-mots (« Van
    Gogh », « Gengis Khan ») d'abord — un `\\b...\\b` sur la forme entière ne peut pas être coupé par un
    remplacement d'un mot plus court (les valeurs contiennent des `[[...]]`, jamais les clés)."""
    for written in sorted(LEXICON, key=len, reverse=True):
        text = re.sub(rf"\b{re.escape(written)}\b", LEXICON[written], text)
    return text


def for_synth(text: str) -> str:
    """Le pipeline texte AVANT le moteur : normalize (chiffres/dates→mots) puis apply_lexicon (noms→phonétique)."""
    return apply_lexicon(normalize(text))
