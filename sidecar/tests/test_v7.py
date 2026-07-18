# -*- coding: utf-8 -*-
"""U-V7 (plan 01) — la BOUCHE (TTS Piper A20). Trois etages, comme test_v6 :

  - LOGIQUE PURE (deterministe, SANS Piper ni audio) : `normalize` (chiffres/dates/…→mots, cases PORTEES du
    banc prouve, fidelite « Yohann » dit juste = regle perf), `apply_lexicon` (41 noms), `for_synth` (le
    pipeline), le splitter (`split_stream`/`split_sentences`, ne coupe pas « 3.14 »), `clean_for_tts`.
  - PLOMBERIE (`TtsPlug` + moteur & sortie FAKES) : cycle nominal (start(1er son)/done(fin), phrases dans
    l'ordre), PURGE coupe net (done interrupted), moteur MORT -> bouche muette (jamais un crash), le TRAIN a
    de l'avance (b4 : gen >> play -> trous=0), files BORNEES, push hors enonciation ignore, enonciation vide
    -> done, start UNE fois, stop idempotent.
  - COEUR REEL (le VRAI PiperEngine) : le modele A20 vendorise charge, synthetise (RTF < banc, SR 22050),
    « Yohann » -> audio non vide. Skip si le modele est absent (CF2, gitignore).

Le TtsPlug est un PRODUCTEUR (threads gen/play, pas de `_tick` deterministe) -> plomberie testee via poll borne.
"""
import threading
import time

import numpy as np
import pytest

from test_v4 import _collect
from tts.engine import PiperEngine, TtsEngine, voice_model_path
from tts.plug import Output, TtsPlug, _enqueue_drop_oldest, _GEN_MAX
from tts.split import clean_for_tts, split_sentences, split_stream
from tts.text import apply_lexicon, for_synth, int_to_fr, normalize, ordinal_fr, roman_to_int, LEXICON
import queue as _queue


# ══════════ Fakes (moteur + sortie injectables) ══════════

class FakeEngine(TtsEngine):
    """Moteur TTS SCRIPTE : synth rend un audio deterministe (proportionnel au texte). `warm_fail` -> la
    bouche est muette. `synth_delay`/`fail_on` pilotent le train et les erreurs."""

    sample_rate = 16000

    def __init__(self, synth_delay=0.0, warm_fail=False, fail_on=None):
        self.calls = []
        self.synth_delay = synth_delay
        self.warm_fail = warm_fail
        self.fail_on = set(fail_on or ())
        self._lock = threading.Lock()

    def warm(self):
        if self.warm_fail:
            raise RuntimeError("Piper absent (test degradation honnete)")

    def synth(self, text):
        with self._lock:
            self.calls.append(text)
        if text in self.fail_on:
            raise RuntimeError("synth en echec (test)")
        if self.synth_delay:
            time.sleep(self.synth_delay)
        return np.ones(max(1, len(text) * 100), dtype=np.float32) * 0.1


class FakeOutput(Output):
    """Sortie SCRIPTEE : enregistre ce qui joue, simule une duree de lecture, compte les stop()."""

    def __init__(self, play_dur=0.0):
        self.played = []
        self.stops = 0
        self.play_dur = play_dur
        self._lock = threading.Lock()

    def play(self, audio, sr):
        with self._lock:
            self.played.append((len(audio), sr))
        if self.play_dur:
            time.sleep(self.play_dur)

    def stop(self):
        self.stops += 1


def _wait(pred, timeout=6.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return True
        time.sleep(0.005)
    return False


def _plug(engine=None, output=None):
    events, emit = _collect()
    plug = TtsPlug(emit, engine=engine if engine is not None else FakeEngine(),
                   output=output if output is not None else FakeOutput())
    return events, plug


def _ev(events, etype):
    return [p for t, p in events if t == etype]


# ══════════ LOGIQUE PURE : normalize (cases PORTEES du banc — fidelite prouvee) ══════════

def test_int_to_fr_pieges_fr():
    cases = {0: "zéro", 16: "seize", 17: "dix-sept", 21: "vingt et un", 71: "soixante et onze",
             80: "quatre-vingts", 81: "quatre-vingt-un", 91: "quatre-vingt-onze", 100: "cent",
             200: "deux cents", 201: "deux cent un", 1000: "mille",
             1789: "mille sept cent quatre-vingt-neuf", 1000000: "un million",
             1234567: "un million deux cent trente-quatre mille cinq cent soixante-sept"}
    for n, exp in cases.items():
        assert int_to_fr(n) == exp, f"int_to_fr({n}) = {int_to_fr(n)!r} != {exp!r}"


def test_ordinal_fr():
    for n, exp in {1: "premier", 2: "deuxième", 5: "cinquième", 9: "neuvième", 21: "vingt et unième"}.items():
        assert ordinal_fr(n) == exp


def test_roman_rejects_non_canonical():
    assert roman_to_int("XIV") == 14 and roman_to_int("MCMLXXXIX") == 1989
    assert roman_to_int("IIII") is None and roman_to_int("VV") is None    # rejette les faux (re-encodage)


def test_normalize_cases_from_banc():
    # Copie des cas prouves du banc text_normalize.test() — fidelite EXACTE (regle perf : la voix dit juste).
    cases = {
        "En 1789, tout a changé.": "En 1789, tout a changé.",              # annee NUE -> laissee a espeak
        "Il a eu 75 % à l'examen.": "Il a eu soixante-quinze pour cent à l'examen.",
        "La valeur de pi est 3,14.": "La valeur de pi est trois virgule quatorze.",
        "Le taux est de 0,05.": "Le taux est de zéro virgule zéro cinq.",
        "Louis XIV régna longtemps.": "Louis quatorze régna longtemps.",
        "Au XVIe siècle, en Europe.": "Au seizième siècle, en Europe.",
        "La Ve République.": "La cinquième République.",
        "François Ier était roi.": "François premier était roi.",
        "Le lac est là.": "Le lac est là.",                                # « Le » jamais pris pour L=50
        "Rendez-vous à 14h30.": "Rendez-vous à quatorze heures trente.",
        "Le 14/07/1789 fut décisif.": "Le quatorze juillet mille sept cent quatre-vingt-neuf fut décisif.",
        "Il roule à 130 km/h.": "Il roule à cent trente kilomètres heure.",
        "Ça coûte 1,50 €.": "Ça coûte un euro et cinquante centimes.",
        "L'ADN et l'ONU.": "L'a dé enne et l'o enne u.",
        "Le mer est calme, le lac aussi.": "Le mer est calme, le lac aussi.",   # aucun faux romain
    }
    for src, exp in cases.items():
        assert normalize(src) == exp, f"normalize({src!r}) = {normalize(src)!r} != {exp!r}"


def test_lexicon_yohann_and_names():
    # « Yohann » -> phonemes (espeak nasalise « an ») + quelques noms valides a l'oreille (conv 34).
    assert apply_lexicon("Salut Yohann.") == "Salut [[joˈann]]."
    assert LEXICON["Yohann"] == "[[joˈann]]" and LEXICON["Descartes"] == "[[dekaʁt]]"
    assert len(LEXICON) == 41                                              # 39 VALIDATED + Yohann + Descartes
    assert apply_lexicon("Nietzsche et Kant") == "[[nitʃ]] et [[kɑ̃t]]"
    assert apply_lexicon("Van Gogh") == "Van gogue"                       # cle multi-mots remplacee entiere


def test_for_synth_pipeline():
    # normalize PUIS lexique : « Yohann » -> phoneme, « Louis XIV » -> quatorze, annee nue intacte.
    got = for_synth("Bonjour Yohann, sous Louis XIV, en 1789.")
    assert got == "Bonjour [[joˈann]], sous Louis quatorze, en 1789."


# ══════════ LOGIQUE PURE : le splitter ══════════

def test_split_stream_does_not_cut_numbers():
    assert split_stream("Pi vaut 3.14 et suite") == (None, "Pi vaut 3.14 et suite")   # « . » sans blanc apres
    assert split_stream("Fin de phrase. Debut") == ("Fin de phrase.", "Debut")         # « . » + blanc -> coupe


def test_split_sentences_and_clean():
    assert split_sentences("Un. Deux ! Trois") == ["Un.", "Deux !", "Trois"]
    assert clean_for_tts("**gras** et `code`  \n suite") == "gras et code suite"        # markdown ote


# ══════════ PLOMBERIE : le TtsPlug (train, cycle, purge) ══════════

def test_v7_nominal_cycle_start_done_ordered():
    eng = FakeEngine()
    events, plug = _plug(engine=eng, output=FakeOutput())
    plug.start()
    plug.speak(1)
    plug.push(1, "Phrase une. Phrase deux. ")
    plug.push(1, "Phrase trois.")                                          # reliquat -> flush a end
    plug.end(1)
    assert _wait(lambda: _ev(events, "evt.tts.done"))
    plug.stop()
    assert _ev(events, "evt.tts.start") == [{"id": 1}]
    assert _ev(events, "evt.tts.done") == [{"id": 1, "reason": "completed"}]
    assert eng.calls == ["Phrase une.", "Phrase deux.", "Phrase trois."]   # dans l'ordre
    assert not any(t == "evt.plug.stuck" for t, _ in events)   # NIT-1 re-croisé : arrêt normal -> aucun faux stuck


def test_v7_purge_cuts_net_and_done_interrupted():
    out = FakeOutput(play_dur=0.2)                                         # lecture lente -> une enonciation JOUE
    events, plug = _plug(engine=FakeEngine(), output=out)
    plug.start()
    plug.speak(2)
    plug.push(2, "Un. Deux. Trois. Quatre. Cinq. ")
    plug.end(2)
    assert _wait(lambda: _ev(events, "evt.tts.start"))                    # elle a commence a parler
    plug.purge()
    plug.stop()
    assert out.stops >= 1                                                  # output.stop() a coupe la lecture
    assert _ev(events, "evt.tts.done") == [{"id": 2, "reason": "interrupted"}]
    assert len(out.played) < 5                                             # la purge a coupe (pas tout joue)


def test_v7_dead_engine_is_mute_never_crashes():
    events, plug = _plug(engine=FakeEngine(warm_fail=True), output=FakeOutput())
    plug.start()
    assert _wait(lambda: plug.state["engine_ok"] is False, timeout=2.0)
    plug.speak(3); plug.push(3, "Rien. "); plug.end(3)
    time.sleep(0.15)
    plug.stop()
    assert _ev(events, "evt.tts.start") == []                             # muette : aucun son, aucun start
    assert plug.state["engine_ok"] is False


def test_v7_train_gen_ahead_no_gaps():
    # b4 (LE TEST MORD) : synth quasi-instantane, lecture LENTE -> quand la 1re phrase commence a jouer, les
    # suivantes sont DEJA synthetisees (le train a de l'avance) -> trous=0 par construction (play ne rattrape
    # jamais gen). Sans le train (synth a la demande dans le play), play_q resterait a ~0.
    eng = FakeEngine(synth_delay=0.003)
    out = FakeOutput(play_dur=0.08)
    events, plug = _plug(engine=eng, output=out)
    plug.start()
    plug.speak(4)
    plug.push(4, "A. B. C. D. E. F. ")                                     # 6 phrases
    plug.end(4)
    assert _wait(lambda: len(out.played) >= 1)                            # 1re phrase commence a jouer
    time.sleep(0.02)
    ahead = plug.state["play_q"]                                           # phrases DEJA pretes en avance
    assert _wait(lambda: _ev(events, "evt.tts.done"))
    plug.stop()
    assert len(out.played) == 6
    assert ahead >= 2, f"le train n'a pas d'avance (play_q={ahead}) — risque de trous"


def test_v7_gen_queue_bounded_if_worker_stalls():
    # F-2 : si le worker gen ne draine pas (moteur bloque au warm), la file de phrases est BORNEE (drop-oldest)
    # -> pas de fuite RAM. On inonde SANS demarrer les workers (le warm ne tourne pas) -> _enqueue_drop_oldest.
    events, plug = _plug(engine=FakeEngine(), output=FakeOutput())        # PAS de start() -> workers dormants
    plug.speak(5)
    for i in range(_GEN_MAX + 100):
        plug.push(5, f"Phrase {i}. ")
    assert plug._gen_q.qsize() <= _GEN_MAX
    assert plug.state["dropped_gen"] > 0


def test_v7_enqueue_drop_oldest_pure():
    q = _queue.Queue(maxsize=2)
    assert _enqueue_drop_oldest(q, "a") is False
    assert _enqueue_drop_oldest(q, "b") is False
    assert _enqueue_drop_oldest(q, "c") is True                           # plein -> jette « a »
    assert list(q.queue) == ["b", "c"]


def test_v7_push_outside_utterance_ignored():
    eng = FakeEngine()
    events, plug = _plug(engine=eng, output=FakeOutput())
    plug.start()
    plug.push(99, "Sans speak. ")                                          # aucun speak ouvert -> ignore
    plug.speak(6)
    plug.push(7, "Mauvais id. ")                                           # id != courant -> ignore
    plug.push(6, "Bon. ")
    plug.end(6)
    assert _wait(lambda: _ev(events, "evt.tts.done"))
    plug.stop()
    assert eng.calls == ["Bon."]                                          # seul le texte de l'enonciation 6


def test_v7_empty_utterance_still_done():
    # speak+end sans texte : done emis (l'orchestrateur attend un done pour toute enonciation qu'il ouvre),
    # sans start (rien a dire -> pas de son). start/done ne sont pas forcement apparies (start = optionnel).
    events, plug = _plug(engine=FakeEngine(), output=FakeOutput())
    plug.start()
    plug.speak(8)
    plug.end(8)
    assert _wait(lambda: _ev(events, "evt.tts.done"))
    plug.stop()
    assert _ev(events, "evt.tts.done") == [{"id": 8, "reason": "completed"}]
    assert _ev(events, "evt.tts.start") == []


def test_v7_synth_error_skips_phrase_not_crash():
    # une phrase qui fait LEVER synth : elle est sautee (comptee), les autres passent, le worker survit.
    eng = FakeEngine(fail_on={"Boum."})
    events, plug = _plug(engine=eng, output=FakeOutput())
    plug.start()
    plug.speak(9)
    plug.push(9, "Avant. Boum. Apres. ")
    plug.end(9)
    assert _wait(lambda: _ev(events, "evt.tts.done"))
    plug.stop()
    assert plug.state["synth_errors"] >= 1
    assert plug.state["sentences"] == 2                                   # « Avant. » et « Apres. » (« Boum. » saute)


def test_v7_start_once_per_utterance():
    events, plug = _plug(engine=FakeEngine(), output=FakeOutput())
    plug.start()
    plug.speak(10)
    plug.push(10, "Une. Deux. Trois. ")
    plug.end(10)
    assert _wait(lambda: _ev(events, "evt.tts.done"))
    plug.stop()
    assert _ev(events, "evt.tts.start") == [{"id": 10}]                   # UNE seule fois (pas par phrase)


def test_v7_purge_resolves_all_started_not_just_playing():
    # MAJEUR croisé conv 47 (LE TEST MORD) : une purge (barge-in) interposée entre _emit_start (l'énonciation
    # entre dans _started) et _playing=N doit QUAND MÊME émettre done(interrupted) pour N. On simule la fenêtre :
    # N a émis start (il est dans _started) mais _playing est encore None. AVANT le fix, purge ne résout que
    # _playing (None) -> aucun done -> N orphelin (start sans done, l'orchestrateur bloque, _started fuit).
    # APRÈS : purge résout TOUT _started. C'est le cas d'usage même de la prise (le barge-in de V8).
    events, plug = _plug(engine=FakeEngine(), output=FakeOutput())
    plug.start()
    with plug._lock:
        plug._started.add(42)      # N=42 a émis start ; _playing encore None (la fenêtre _emit_start -> _playing)
    plug.purge()
    plug.stop()
    dones = [p for p in _ev(events, "evt.tts.done") if p["id"] == 42]
    assert dones == [{"id": 42, "reason": "interrupted"}], f"N orphelin (start sans done) : {dones}"
    assert 42 not in plug._started, "l'id reste dans _started (fuite) après la purge"


def test_v7_begin_audio_atomic_closes_orphan_window():
    # Finding 1 (RE-croisé conv 47, LE TEST MORD) : _begin_audio rend le check-epoch + l'entrée dans _started
    # ATOMIQUES (un seul lock). Un audio PÉRIMÉ (une purge est passée) retourne None et N'ENTRE PAS dans _started
    # -> aucun orphelin. L'ANCIEN code ajoutait N à _started AVANT de re-checker l'epoch -> une purge qui
    # snapshotait entre les deux laissait N orphelin (start sans done) — reproduit EMPIRIQUEMENT avant ce fix.
    events, plug = _plug(engine=FakeEngine(), output=FakeOutput())
    assert plug._begin_audio(0, 9) is True          # epoch frais -> 1er son
    assert 9 in plug._started and plug._playing == 9
    with plug._lock:
        plug._epoch = 5                             # une purge est passée (epoch bumpé)
    assert plug._begin_audio(0, 77) is None         # audio d'epoch périmé -> skip total (None)
    assert 77 not in plug._started                  # jamais d'entrée dans _started = jamais d'orphelin
    assert plug._begin_audio(5, 9) is False         # idempotence : 9 déjà démarré -> pas un 2e start


def test_v7_no_play_if_purged_during_start_emit():
    # #2 (croisé conv 47, LE TEST MORD) : si une purge s'intercale PENDANT l'emit du start (fenêtre _emit_start
    # -> re-check epoch sous lock), la phrase ne doit PAS jouer (sinon Sophia parle PAR-DESSUS l'utilisateur qui
    # vient de la couper). On déclenche la purge DANS le callback d'emit de start -> au re-check, l'epoch a changé
    # -> skip. Sans le re-check #2, le play worker aurait posé _playing puis joué la phrase.
    played = []

    class RecOut(Output):
        def play(self, audio, sr):
            played.append(len(audio))
        def stop(self):
            pass

    events = []
    holder = {"armed": True}

    def emit(t, p):
        events.append((t, dict(p)))
        if t == "evt.tts.start" and p["id"] == 7 and holder["armed"]:
            holder["armed"] = False
            holder["plug"].purge()       # purge PILE pendant l'emit du start (barge-in à l'instant précis)

    holder["plug"] = TtsPlug(emit, engine=FakeEngine(), output=RecOut())
    plug = holder["plug"]
    plug.start()
    plug.speak(7); plug.push(7, "Une phrase. "); plug.end(7)
    assert _wait(lambda: any(t == "evt.tts.done" for t, p in events))
    plug.stop()
    assert played == [], f"la phrase a joué malgré la purge pendant le start ({played})"
    assert ("evt.tts.done", {"id": 7, "reason": "interrupted"}) in events   # #1 : done quand même (via _started)


def test_v7_stop_keeps_refs_and_signals_if_worker_stuck():
    # #3 (croisé conv 47, parité base.py R#9, LE TEST MORD) : si un worker reste bloqué au join (ex. warm Piper
    # non interruptible), stop() NE nullifie PAS les refs (un start() ultérieur ne relance pas de workers DOUBLONS)
    # + signale evt.plug.stuck. Sans le fix, la ref serait nullifiée alors que le thread vit.
    block = threading.Event()

    class StuckEngine(TtsEngine):
        def warm(self):
            block.wait(timeout=10)       # le gen worker reste bloqué dans warm (comme un chargement Piper > join)
        def synth(self, text):
            return np.zeros(1, dtype=np.float32)

    events, plug = _plug(engine=StuckEngine(), output=FakeOutput())
    plug.start()
    time.sleep(0.1)                       # le gen worker entre dans warm() et bloque
    plug.stop()                           # join gen (1,5 s) expire -> stuck (le play worker, lui, sort vite)
    block.set()                           # libère le worker bloqué (nettoyage)
    assert plug._gen_thread is not None, "ref du worker nullifiée alors qu'il vit encore (doublon possible)"
    assert any(t == "evt.plug.stuck" and p.get("plug") == "tts" for t, p in events)


def test_v7_id_reuse_reemits_events():
    # defense (solo conv 47, LE TEST MORD) : un id REUTILISE (si le compteur bouclait un jour) doit re-emettre
    # start/done, pas etre etouffe par l'anti-double `_done`. speak() discard l'id de _started/_done. Sans le
    # discard, la 2e enonciation avec le meme id n'emettrait NI start NI done -> l'orchestrateur attendrait un
    # done qui ne vient jamais.
    events, plug = _plug(engine=FakeEngine(), output=FakeOutput())
    plug.start()
    plug.speak(1); plug.push(1, "Un. "); plug.end(1)
    assert _wait(lambda: len([p for p in _ev(events, "evt.tts.done") if p["id"] == 1]) == 1)
    plug.speak(1); plug.push(1, "Deux. "); plug.end(1)                    # MEME id reutilise
    assert _wait(lambda: len([p for p in _ev(events, "evt.tts.done") if p["id"] == 1]) == 2)
    plug.stop()
    assert len([p for p in _ev(events, "evt.tts.start") if p["id"] == 1]) == 2   # start RE-emis (pas etouffe)


def test_v7_stop_idempotent():
    events, plug = _plug(engine=FakeEngine(), output=FakeOutput())
    plug.start()
    plug.stop()
    plug.stop()                                                           # 2e stop -> no-op, aucun crash


# ══════════ GATE anti-auto-ecoute (V7 morceau C) : is_speaking + TRAINE ══════════
# is_speaking() = le signal que le VadPlug interroge pour ignorer le micro pendant qu'ELLE parle (+ traine du
# residu post-AEC ~10 dB). Equivalent produit du _flush_audio du banc (oreilles_live:1298/1314).

def _plug_t(tail_s, engine=None, output=None, max_speak_s=None):
    events, emit = _collect()
    kwargs = {"tail_s": tail_s}
    if max_speak_s is not None:
        kwargs["max_speak_s"] = max_speak_s
    plug = TtsPlug(emit, engine=engine if engine is not None else FakeEngine(),
                   output=output if output is not None else FakeOutput(), **kwargs)
    return events, plug


def test_v7_is_speaking_false_when_idle():
    events, plug = _plug_t(0.3)
    plug.start()
    assert plug.is_speaking() is False                                    # rien dit encore -> pas de gate
    assert plug.state["speaking"] is False                                # l'etat le reflete
    plug.stop()
    assert plug.is_speaking() is False


def test_v7_is_speaking_while_playing_then_tail_then_false():
    # LE TEST MORD : True PENDANT qu'elle parle (une enonciation en vol), True PENDANT la traine apres le done,
    # puis False une fois la traine expiree. C'est ce drapeau qui garde le VAD mute (elle ne se re-transcrit pas).
    out = FakeOutput(play_dur=0.12)
    events, plug = _plug_t(0.3, engine=FakeEngine(), output=out)
    plug.start()
    plug.speak(1)
    plug.push(1, "Une. Deux. Trois. ")
    plug.end(1)
    assert _wait(lambda: _ev(events, "evt.tts.start"))                    # elle a commence a parler
    assert plug.is_speaking() is True                                     # enonciation en vol (_started non vide)
    assert _wait(lambda: _ev(events, "evt.tts.done"))                     # elle a fini de jouer
    assert plug.is_speaking() is True, "la traine ne tient pas juste apres le done (residu non couvert)"
    assert _wait(lambda: plug.is_speaking() is False, timeout=1.5), "la traine n'expire jamais (gate colle)"
    plug.stop()


def test_v7_is_speaking_true_during_tail_after_purge():
    # apres une PURGE (barge-in / cmd.tts.stop), le residu de la derniere phrase coupee est encore dans le
    # pipeline -> la traine tient (le gate reste actif un court instant), puis retombe.
    out = FakeOutput(play_dur=0.2)
    events, plug = _plug_t(0.3, engine=FakeEngine(), output=out)
    plug.start()
    plug.speak(2)
    plug.push(2, "Un. Deux. Trois. Quatre. ")
    plug.end(2)
    assert _wait(lambda: _ev(events, "evt.tts.start"))
    plug.purge()                                                          # coupe net (done interrupted) -> arme la traine
    assert plug.is_speaking() is True, "la traine ne s'arme pas apres une purge (residu non couvert)"
    assert _wait(lambda: plug.is_speaking() is False, timeout=1.5)
    plug.stop()


def test_v7_is_speaking_capped_if_started_leaks():
    # DEFENSE EN PROFONDEUR (solo conv 47, LE TEST MORD) : si `_started` fuyait (F-B : marqueur `end` evince —
    # impossible dans le flux V7 mono-enonciation, mais on ne veut PAS dependre de « ca n'arrive pas »),
    # is_speaking ne doit pas coller a True A JAMAIS (sinon le VAD reste mute -> Sophia SOURDE definitivement).
    # Au-dela de `max_speak_s` depuis le debut de la span, fail-open. Aligne sur la deadline de playback du routeur.
    events, plug = _plug_t(0.3, max_speak_s=0.2)
    plug.start()
    with plug._lock:
        plug._started.add(999)                    # _started fuite (done jamais emis)
        plug._speaking_since = time.monotonic()   # span demarree maintenant
    assert plug.is_speaking() is True             # dans la fenetre max_speak (0,2 s)
    assert _wait(lambda: plug.is_speaking() is False, timeout=1.0), "gate colle malgre le cap (sourde a jamais)"
    plug.stop()


# ══════════ COEUR REEL — le VRAI Piper A20 ══════════

def _model_present() -> bool:
    return voice_model_path().exists()


def test_v7_piper_synth_real():
    # NON-skippable hors absence du modele : la fidelite au banc (voix A20, RTF, SR) EST l'enjeu de la regle perf.
    if not _model_present():
        pytest.skip("voix A20 absente (resources/models/voice/fr_FR-a20-e400.onnx — CF2, gitignore)")
    eng = PiperEngine()
    eng.warm()
    assert eng.sample_rate == 22050                                       # SR du modele A20 (b3 conv 47)
    t0 = time.perf_counter()
    audio = eng.synth("Bonjour Yohann, je suis là.")
    dur = len(audio) / eng.sample_rate
    rtf = (time.perf_counter() - t0) / dur if dur else 0.0
    assert audio.size > 0 and dur > 0.5                                   # une vraie phrase
    assert rtf < 0.30, f"RTF {rtf:.3f} (banc ~0,06 ; regle perf : ne pas regresser)"
    assert np.max(np.abs(audio)) > 0.05                                   # du son, pas du silence


def test_v7_piper_end_to_end_via_plug():
    # Le VRAI Piper A20 dans la prise (train + sortie fake) : speak/push/end -> start + audios non vides + done.
    if not _model_present():
        pytest.skip("voix A20 absente (CF2)")
    out = FakeOutput()
    events, plug = _plug(engine=PiperEngine(), output=out)
    plug.start()
    plug.speak(20)
    plug.push(20, "Première phrase. ")
    plug.push(20, "Deuxième phrase, un peu plus longue.")
    plug.end(20)
    assert _wait(lambda: _ev(events, "evt.tts.done"), timeout=30.0)       # inclut le chargement Piper (~4 s)
    plug.stop()
    assert _ev(events, "evt.tts.start") == [{"id": 20}]
    assert _ev(events, "evt.tts.done") == [{"id": 20, "reason": "completed"}]
    assert len(out.played) == 2 and all(n > 0 for n, _sr in out.played)   # 2 phrases, audio non vide
    assert all(sr == 22050 for _n, sr in out.played)                      # joue au SR d'A20
