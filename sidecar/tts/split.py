# -*- coding: utf-8 -*-
"""Sophia — sidecar / TTS : découpe en phrases (plan 01, V7 · §4.4).

« Un TTS nourri en miettes chante faux » (V7) : le sidecar accumule le texte poussé au fil du cerveau
(`cmd.tts.push`) et le découpe en PHRASES ENTIÈRES avant de synthétiser (prosodie juste). Deux fonctions
PURES, portées fidèlement du banc (conv 31, `oreilles_live._split_stream`/`split_sentences` — le splitter
vivait au coordinateur ; ici il passe dans le SIDECAR, fidèle au plan gravé — écart banc↔doc tracé `01` §7).

`split_stream` = au fil (frontière = terminateur SUIVI d'un blanc → ne coupe pas « 3.14 » ni « M. » en
plein flux) ; `split_sentences` = flush final (le reliquat sans blanc terminal). Module PUR → testable seul.
"""
from __future__ import annotations

_TERMINATORS = ".?!…"


def split_sentences(text: str) -> list[str]:
    """Découpe un texte COMPLET en phrases (flush final d'un tour). Copie fidèle du banc."""
    out, cur = [], ""
    for ch in text:
        cur += ch
        if ch in _TERMINATORS:
            out.append(cur.strip())
            cur = ""
    if cur.strip():
        out.append(cur.strip())
    return [s for s in out if s]


def split_stream(buf: str) -> tuple[str | None, str]:
    """Découpe AU FIL (streaming). Retourne (phrase|None, reste). Frontière = terminateur `.?!…` SUIVI
    d'un blanc → ne coupe pas « 3.14 » ni « M. » en plein flux (le blanc n'est pas encore arrivé). Le tout
    dernier bout (sans blanc final) est flushé à la fin du flux (`cmd.tts.end` → `split_sentences`). Copie
    fidèle du banc `oreilles_live._split_stream`."""
    for i in range(len(buf) - 1):
        if buf[i] in _TERMINATORS and buf[i + 1].isspace():
            return buf[:i + 1].strip(), buf[i + 1:].lstrip()
    return None, buf


def clean_for_tts(text: str) -> str:
    """Retire markdown/émojis (la réponse est lue à voix haute). Copie fidèle du banc `clean_for_tts`.
    Appliqué AVANT la découpe/synthèse (le cerveau peut ponctuer, jamais du markdown à prononcer)."""
    import re
    text = re.sub(r"[*_#`>|]", "", text)                                        # markdown
    text = re.sub(r"[\U0001F000-\U0001FAFF\U00002600-\U000027BF]", "", text)   # émojis
    return re.sub(r"\s+", " ", text).strip()
