"""U-V14 (plan 01) — le CAPTEUR/VERROU D'AFFECT (w2v2-dim ONNX CPU, verrou V6).

Trois etages, comme test_v5/test_v6 :
  - LOGIQUE PURE (deterministe, SANS ONNX) : `confidence` (auto-coherence mesuree), `AffectLock` (le verrou
    au niveau du TOUR : dernier-verdict-par-segment, un « inconnu » ferme, aucun verdict = ferme, purge +
    borne), les GARDES HONNETES de l'`AffectDetector` (trop court / moteur KO / NaN / conf basse -> None,
    JAMAIS un faux verdict — le « muet dans le doute » du gravé tenu par le code).
  - PLOMBERIE (`AffectPlug` + moteur SCRIPTE + evenements INJECTES — la couture U-V14 gravee : `evt.speaker`
    injecte -> le verrou se teste DETERMINISTE, independamment d'ECAPA) : emission nominale, verrou ferme,
    payload STRUCTUREL (les cles exactes du gravé, nombres seuls — JAMAIS d'etiquette), file bornee (F-2),
    overrun R-2 -> muet, payload malforme jamais fatal, garde `_tick`, warm KO -> inerte honnete.
  - COEUR REEL (le VRAI `W2v2DimEngine`, modele vendorise) : la REFERENCE PUBLIEE reproduite (zeros 1 s ->
    [0.5461, 0.6062, 0.4043], banc conv 59 : max|diff| 1e-5), determinisme, et le pipeline entier sur la
    VRAIE voix de Yohann (raw_far held-out) -> evt.affect emis. Skip SEULEMENT si les assets gitignores
    manquent (CF2), parite test_v6.

L'AffectPlug se teste via `_tick()` (une iteration deterministe — parite VadPlug/STT/Speaker).
"""
import os

import numpy as np
import pytest

from audio.ring import RingBuffer
from consumers.affect import (
    AffectPlug, AffectEngine, AffectDetector, AffectLock, W2v2DimEngine, confidence,
    AFFECT_MIN_S, AFFECT_WIN, _MODEL_DIR,
)
from consumers.speaker import load16, _ANCHOR_DIR
from test_v4 import _collect, _noise, _sil

RATE = 16000
ADV_A = np.array([0.30, 0.40, 0.60])     # arousal, dominance, valence — un « etat » scripte
ADV_B = np.array([0.32, 0.41, 0.58])     # proche de A -> conf haute (diff max 0,02 -> conf 0,96)
ADV_FAR = np.array([0.80, 0.40, 0.10])   # loin de A -> conf basse (diff max 0,50 -> conf 0,0)


class ScriptedAffectEngine(AffectEngine):
    """Moteur affect SCRIPTE : rend `advs[i]` a l'appel i (le dernier se repete) ; `fail=True` -> leve.
    -> pilote adv_full (1er appel) et adv_half (2e appel) de l'auto-coherence, sans ONNX."""

    def __init__(self, advs=(ADV_A, ADV_B), fail=False):
        self._advs = [np.asarray(a, dtype=np.float64) for a in advs]
        self._fail = fail
        self.calls = 0

    def evaluate(self, audio):
        self.calls += 1
        if self._fail:
            raise RuntimeError("moteur affect scripte en echec (test garde honnete)")
        return self._advs[min(self.calls - 1, len(self._advs) - 1)]

    def warm(self):
        pass


def _affect_plug(advs=(ADV_A, ADV_B), fail=False, conf_min=0.0, min_s=None, grace=0.0, now=None):
    """AffectPlug avec un moteur scripte (pas d'ONNX). conf_min=0 par defaut (les tests du SEUIL le posent) ;
    grace=0 par defaut (la GRACE de decision m3 a ses tests dedies, horloge injectable)."""
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    det = AffectDetector(engine=ScriptedAffectEngine(advs, fail=fail), conf_min=conf_min,
                         min_s=(AFFECT_MIN_S if min_s is None else min_s))
    plug = AffectPlug(ring, emit, detector=det, decide_grace_s=grace, now=now)
    return ring, events, det, plug


def _turn(plug, ring, speech_s=3.0, verdicts=("yohann",), speech_ms=None, tick=True):
    """Simule un tour : pre-silence, `speech_s` de parole au ring, les verdicts V6 INJECTES (couture U-V14,
    un mark de segment par verdict, dans la fenetre), puis evt.turn.end. Retourne la marque du tour."""
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(speech_s))
    for i, loc in enumerate(verdicts):
        plug.on_event("evt.speaker", {"mark": mark + i * int(0.5 * RATE), "locuteur": loc})
    ms = speech_s * 1000 if speech_ms is None else speech_ms
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": ms})
    if tick:
        plug._tick()
    return mark


def _affects(events):
    return [p for t, p in events if t == "evt.affect"]


# ══════════ Logique PURE : confidence + AffectLock + gardes du detecteur ══════════

def test_confidence_math():
    assert confidence(ADV_A, ADV_A) == 1.0                          # lectures identiques -> confiance pleine
    assert abs(confidence(ADV_A, ADV_B) - (1 - 2 * 0.02)) < 1e-9    # diff max 0,02 -> 0,96
    assert confidence(ADV_A, ADV_FAR) == 0.0                        # divergence 0,5 -> clampe a 0 (jamais negatif)


def test_lock_last_verdict_per_segment_wins():
    # La trajectoire du banc emet PLUSIEURS verdicts par segment (0,75 s -> CAP 3 s) : le DERNIER (le plus
    # informe) fait foi. LE TEST MORD : un « inconnu » precoce rattrape par un « yohann » mur OUVRE.
    lock = AffectLock()
    lock.add_verdict(100, "inconnu")
    lock.add_verdict(100, "yohann")                                 # meme segment (meme mark) : dernier gagne
    assert lock.decide(100, 50000) is True


def test_lock_inconnu_segment_closes():
    # Regle STRICTE : UN segment dont le dernier verdict est « inconnu » (un tiers a pu parler) FERME le tour.
    lock = AffectLock()
    lock.add_verdict(100, "yohann")
    lock.add_verdict(8000, "inconnu")
    assert lock.decide(100, 50000) is False


def test_lock_no_verdict_is_closed():
    # Pas de preuve = pas de lecture (tour court, V6 muet/absent) — le verrou par DEFAUT est FERME.
    assert AffectLock().decide(0, 50000) is False


def test_lock_window_and_purge():
    lock = AffectLock()
    lock.add_verdict(100, "yohann")          # dans la fenetre du tour 1
    lock.add_verdict(90000, "inconnu")       # HORS fenetre (tour futur) -> n'affecte pas le tour 1
    assert lock.decide(50, 50000) is True    # l'inconnu lointain n'a pas ferme
    # purge : les verdicts <= fin decidee sont CONSOMMES -> re-decider la meme fenetre = ferme (aucune preuve)
    assert lock.decide(50, 50000) is False
    assert lock.pending == 1                 # le verdict futur (90000) est garde


def test_lock_memory_is_bounded():
    lock = AffectLock()
    for i in range(600):                     # > _MAX_VERDICTS (512)
        lock.add_verdict(i, "yohann")
    assert lock.pending <= 512               # borne : jamais une fuite, les plus recents gagnent


def test_v14_M2_evicted_proof_closes_the_turn():
    # M2 (croisé conv 59, REPRODUIT puis corrigé à la racine) : AVANT, l'éviction de la borne JETAIT la preuve
    # fermante (l'« inconnu » précoce d'un long monologue) en gardant les « yohann » récents → decide=True =
    # faux OUVERT, la règle STRICTE violée en silence. APRÈS : la preuve évincée laisse un PLANCHER — toute
    # fenêtre qui le chevauche est FERMÉE + `evidence_lost` compté. LE TEST MORD (temp-revert du plancher →
    # decide=True).
    lock = AffectLock()
    lock.add_verdict(100, "inconnu")                 # la preuve fermante, la plus ANCIENNE
    for i in range(600):                             # > borne → l'inconnu finit évincé
        lock.add_verdict(1000 + i, "yohann")
    assert lock.decide(50, 5000) is False            # fenêtre chevauche le plancher → FERMÉ (jamais un faux OUVERT)
    assert lock.evidence_lost == 1                   # et la perte est DITE (jamais en silence)


def test_lock_negative_mark_never_fakes_evidence_lost():
    # re-croisé conv 59 (NIT-1) : la sentinelle -1 faisait MENTIR `evidence_lost` sur un turn_mark négatif
    # (aberrant : -10 <= -1 → « preuve perdue » comptée sans la moindre éviction). Sentinelle None : fermé
    # par « pas de preuve », le compteur ne ment jamais. LE TEST MORD (temp-revert -1 → evidence_lost=1).
    lock = AffectLock()
    assert lock.decide(-10, 5000) is False
    assert lock.evidence_lost == 0


def test_v14_lock_thread_safety_hammer():
    # MIN-1 (re-croisé conv 59) : LA propriété du fix M1 est « thread-safe » — et la suite ne l'exerçait
    # qu'en MONO-thread (le trou exactement là où le test ne regarde pas — conv 41/58). Deux phases :
    #   (1) CHAOS réel ~0,8 s : 2 producteurs (marks monotones, évictions FORCÉES > 512 → le sorted() du
    #       verrou itère sous mutation concurrente) + 1 décideur (fenêtres glissantes) + 1 lecteur
    #       (pending/evidence_lost, le chemin /debug) — AUCUNE exception, borne 512 jamais dépassée,
    #       aucun deadlock (joins bornés) ;
    #   (2) 400 fenêtres en PING-PONG à happens-before (Event producteur↔décideur) : zéro faux OUVERT,
    #       zéro faux FERMÉ à travers les threads.
    # LE TEST MORD (temp-revert : retirer le lock → « dictionary changed size during iteration » au chaos).
    import threading as th
    import time as _t
    lock = AffectLock()
    errors = []
    stop = th.Event()
    max_pending = {"v": 0}

    def producer(base):
        try:
            i = 0
            while not stop.is_set():
                lock.add_verdict(base + i * 2, "yohann" if i % 7 else "inconnu")
                i += 1
        except Exception as e:                                # noqa: BLE001 — le hammer collecte TOUT
            errors.append(("producer", repr(e)))

    def decider():
        try:
            w = 0
            while not stop.is_set():
                lock.decide(w, w + 5000)
                w += 3000
        except Exception as e:                                # noqa: BLE001
            errors.append(("decider", repr(e)))

    def reader():
        try:
            while not stop.is_set():
                max_pending["v"] = max(max_pending["v"], lock.pending)
                _ = lock.evidence_lost
        except Exception as e:                                # noqa: BLE001
            errors.append(("reader", repr(e)))

    threads = [th.Thread(target=producer, args=(0,), daemon=True),
               th.Thread(target=producer, args=(1,), daemon=True),
               th.Thread(target=decider, daemon=True),
               th.Thread(target=reader, daemon=True)]
    for t in threads:
        t.start()
    _t.sleep(0.8)
    stop.set()
    for t in threads:
        t.join(timeout=5.0)
        assert not t.is_alive(), "deadlock : un thread du hammer n'a pas rendu la main"
    assert errors == [], f"exceptions sous concurrence réelle : {errors}"
    assert max_pending["v"] <= 512, f"borne du verrou dépassée sous chaos : {max_pending['v']}"

    # (2) correction inter-threads a happens-before : le verdict pose PUIS la décision lit (Event ping-pong)
    lock2 = AffectLock()
    go = th.Event()
    done = th.Event()
    results = []

    def producer2():
        for i in range(400):
            m = i * 100000
            lock2.add_verdict(m, "yohann")
            if i % 2:
                lock2.add_verdict(m + 10, "inconnu")          # la preuve fermante d'une fenêtre sur deux
            go.set()
            done.wait(5.0)
            done.clear()

    def decider2():
        for i in range(400):
            go.wait(5.0)
            go.clear()
            m = i * 100000
            results.append((i, lock2.decide(m, m + 50000)))
            done.set()

    t1, t2 = th.Thread(target=producer2, daemon=True), th.Thread(target=decider2, daemon=True)
    t1.start(); t2.start()
    t1.join(10.0); t2.join(10.0)
    assert not t1.is_alive() and not t2.is_alive()
    assert len(results) == 400
    bad = [(i, ok) for i, ok in results if ok != (i % 2 == 0)]
    assert bad == [], f"faux verdicts inter-threads : {bad[:5]}"


def test_v14_pending_decisions_bounded():
    # re-croisé conv 59 (NIT-4) : la liste des décisions en grâce est EXPLICITEMENT bornée (64, drop-oldest
    # compté) — « aucun état non borné », même sous un producteur impossible en prod (débit réel turn.end
    # >= ~1-2 s, mesuré à la source stt.py). Un drop = un affect perdu, jamais une preuve.
    clock = {"t": 0.0}
    ring, events, det, plug = _affect_plug(grace=10.0, now=lambda: clock["t"])   # la grâce ne s'écoule jamais
    for i in range(200):
        plug.on_event("evt.turn.end", {"mark": i, "speech_ms": 100})
        plug._tick()
    assert plug.state["pending_decisions"] <= 64
    assert plug.state["dropped_turns"] > 0


def test_detector_too_short_is_none():
    det = AffectDetector(engine=ScriptedAffectEngine())
    assert det.evaluate_turn(np.zeros(int(AFFECT_MIN_S * RATE) - 1, np.float32)) is None
    assert det.evaluate_turn(None) is None
    assert det.too_short == 2 and det.errors == 0            # trop court n'est PAS une erreur (compte a part)


def test_detector_engine_crash_is_none_never_fake_verdict():
    # LE TEST MORD (gardes honnetes, parite V6) : un moteur KO -> None + compte, JAMAIS un verdict invente.
    det = AffectDetector(engine=ScriptedAffectEngine(fail=True))
    assert det.evaluate_turn(np.zeros(4 * RATE, np.float32)) is None
    assert det.errors == 1


def test_detector_non_finite_or_bad_shape_is_none():
    det = AffectDetector(engine=ScriptedAffectEngine(advs=(np.array([np.nan, 0.4, 0.5]),)))
    assert det.evaluate_turn(np.zeros(4 * RATE, np.float32)) is None and det.errors == 1
    det2 = AffectDetector(engine=ScriptedAffectEngine(advs=(np.array([0.4, 0.5]),)))   # forme (2,) != (3,)
    assert det2.evaluate_turn(np.zeros(4 * RATE, np.float32)) is None and det2.errors == 1


def test_detector_low_conf_is_none():
    # L'auto-coherence (banc conv 59) : deux lectures divergentes = instable -> muet + compte. LE TEST MORD :
    # sans le seuil, ADV_FAR (conf 0,0) emettrait quand meme.
    det = AffectDetector(engine=ScriptedAffectEngine(advs=(ADV_A, ADV_FAR)), conf_min=0.70)
    assert det.evaluate_turn(np.zeros(4 * RATE, np.float32)) is None
    assert det.low_conf == 1 and det.errors == 0


def test_detector_payload_soft_signal_mapping():
    # Le dict rendu = le vocabulaire du gravé : energie = AROUSAL (dim 0), valence = dim 2, confiance mesuree.
    # La dominance (dim 1) n'est JAMAIS dans le verdict (hors gravé — /debug seul).
    det = AffectDetector(engine=ScriptedAffectEngine(advs=(ADV_A, ADV_A)), conf_min=0.5)
    v = det.evaluate_turn(np.zeros(4 * RATE, np.float32))
    assert v == {"valence": 0.6, "energie": 0.3, "confiance": 1.0}
    assert det.last_adv == [0.3, 0.4, 0.6]                   # /debug : les 3 dims brutes (dominance visible ICI)


# ══════════ Plomberie : l'AffectPlug (evenements injectes — la couture U-V14) ══════════

def test_v14_nominal_emits_affect():
    ring, events, det, plug = _affect_plug()
    mark = _turn(plug, ring, speech_s=3.0, verdicts=("yohann",))
    af = _affects(events)
    assert len(af) == 1
    p = af[0]
    assert p["mark"] == mark and p["speech_ms"] == 3000.0
    assert p["valence"] == 0.6 and p["energie"] == 0.3        # ADV_A : arousal->energie, valence->valence
    assert 0.9 < p["confiance"] <= 1.0                        # ADV_A vs ADV_B -> 0,96
    assert plug.state["emits"] == 1 and plug.state["turns_seen"] == 1


def test_v14_payload_is_soft_signal_only():
    # « JAMAIS d'etiquette categorielle » — test STRUCTUREL : les cles EXACTES du gravé, valeurs NUMERIQUES
    # seules (aucune chaine « colere/joie/... » ne peut exister dans le payload). LE TEST MORD : ajouter une
    # etiquette au payload casse ce test.
    ring, events, det, plug = _affect_plug()
    _turn(plug, ring)
    p = _affects(events)[0]
    assert set(p.keys()) == {"valence", "energie", "confiance", "mark", "captured_at", "speech_ms"}
    assert all(isinstance(v, (int, float)) for v in p.values()), f"payload non numerique : {p}"


def test_v14_lock_denied_unknown_in_turn():
    # Un segment « inconnu » DANS le tour (un tiers a pu parler) -> verrou ferme -> AUCUNE emission.
    ring, events, det, plug = _affect_plug()
    _turn(plug, ring, verdicts=("yohann", "inconnu"))
    assert _affects(events) == [] and plug.state["lock_denied"] == 1


def test_v14_lock_denied_no_verdict():
    # AUCUN verdict V6 dans le tour (tour court / V6 muet) -> pas de preuve -> muet honnete.
    ring, events, det, plug = _affect_plug()
    _turn(plug, ring, verdicts=())
    assert _affects(events) == [] and plug.state["lock_denied"] == 1


def test_v14_early_inconnu_then_yohann_same_segment_emits():
    # La trajectoire reelle : verdict precoce « inconnu » (0,75 s de parole) rattrape par « yohann » au CAP —
    # MEME mark -> le dernier fait foi -> le verrou S'OUVRE (sans cette resolution par segment, l'affect serait
    # quasi toujours muet sur les vrais tours).
    ring, events, det, plug = _affect_plug()
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(3.0))
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "inconnu"})
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 3000})
    plug._tick()
    assert len(_affects(events)) == 1


def test_v14_too_short_turn_is_muted():
    ring, events, det, plug = _affect_plug()
    _turn(plug, ring, speech_s=1.0)                           # 1 s < AFFECT_MIN_S (2 s)
    assert _affects(events) == [] and plug.state["too_short"] == 1


def test_v14_no_speech_ms_is_muted():
    # turn.end sans speech_ms (tour sans _seg_stop, trace §7) -> pas de fenetre -> muet + compte.
    ring, events, det, plug = _affect_plug()
    _turn(plug, ring, speech_ms="absent")                     # non numerique == absent
    assert _affects(events) == [] and plug.state["no_span"] == 1


def test_v14_low_conf_is_muted_end_to_end():
    ring, events, det, plug = _affect_plug(advs=(ADV_A, ADV_FAR), conf_min=0.70)
    _turn(plug, ring)
    assert _affects(events) == [] and plug.state["low_conf"] == 1


def test_v14_engine_crash_never_kills_and_no_emit():
    ring, events, det, plug = _affect_plug(fail=True)
    _turn(plug, ring)
    assert _affects(events) == [] and plug.state["engine_errors"] == 1
    _turn(plug, ring, verdicts=("yohann",))                   # la prise VIT (un 2e tour est traite)
    assert plug.state["turns_seen"] == 2


def test_v14_window_scrolled_out_is_muted():
    # La fenetre du tour a ENTIEREMENT quitte le ring (le seek clampe a oldest, au-dela de la fin du tour)
    # -> aucune lecture fiable -> muet + compte `window_truncated` (la garde d'honnetete V3 LUE — depuis le
    # fix m4, la troncature du seek attrape aussi ce cas TOTAL, avant meme le calcul de span).
    ring = RingBuffer(2 * RATE)                               # petit ring : 2 s
    events, emit = _collect()
    plug = AffectPlug(ring, emit, detector=AffectDetector(engine=ScriptedAffectEngine(), conf_min=0.0),
                      decide_grace_s=0)
    mark = ring.write_pos()
    ring.write(_noise(2.0))
    ring.write(_noise(3.0))                                   # le ring scrolle LOIN au-dela de la fenetre du tour
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 2000})
    plug._tick()
    assert _affects(events) == [] and plug.state["window_truncated"] >= 1


def test_v14_read_overrun_is_muted():
    # R-2 : l'overrun AU READ (l'ecrivain a double le curseur entre le seek et le read — la course reelle que
    # le contrat V3 impose de verifier). Inatteignable deterministe par le chemin public (le seek clampe
    # d'abord) -> on teste la GARDE au contact : un read qui rapporte un overrun -> muet + compte, JAMAIS une
    # evaluation sur un audio troue. LE TEST MORD : sans la garde, le moteur scripte emettrait.
    ring, events, det, plug = _affect_plug()
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(3.0))
    real_read = plug._cursor.read
    plug._cursor.read = lambda n: (real_read(n)[0], 1234)     # meme audio, mais le ring SIGNALE un trou
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 3000})
    plug._tick()
    assert _affects(events) == [] and plug.state["overruns"] == 1


def test_v14_malformed_payloads_never_raise():
    ring, events, det, plug = _affect_plug()
    plug.on_event("evt.speaker", {})                          # pas de mark
    plug.on_event("evt.speaker", {"mark": "x", "locuteur": "yohann"})
    plug.on_event("evt.speaker", {"mark": 5, "locuteur": None})
    plug.on_event("evt.turn.end", {})                         # pas de mark
    plug.on_event("evt.turn.end", None)                       # payload None
    plug.on_event("evt.autre", {"mark": 1})                   # type inconnu -> ignore
    plug._tick()
    assert _affects(events) == [] and plug.state["turns_seen"] == 0
    assert plug.state["pending_verdicts"] == 0                # aucun verdict malformé n'a atteint le verrou


def test_v14_m3_decision_grace_lets_late_verdict_land():
    # m3 (croisé conv 59, REPRODUIT puis corrigé) : le verdict MUR (celui du CAP — le plus informé, EER 0 %
    # au banc) peut arriver APRÈS le turn.end (worker V6 à la traîne sous contention). AVANT : la décision se
    # prenait sur le verdict PRÉCOCE → lecture d'un tour que le verdict mûr aurait fermé. APRÈS : chaque tour
    # attend une GRÂCE (0,5 s, horloge injectable) avant d'être jugé → le retardataire atterrit au verrou.
    # LE TEST MORD (temp-revert de la grâce → décision immédiate sur le « yohann » précoce → émission).
    clock = {"t": 0.0}
    ring, events, det, plug = _affect_plug(grace=0.5, now=lambda: clock["t"])
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(3.0))
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})    # le verdict PRÉCOCE (0,75 s de parole)
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 3000})
    plug._tick()
    assert _affects(events) == [] and plug.state["pending_decisions"] == 1   # la grâce RETIENT la décision
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "inconnu"})   # le verdict MUR, retardataire
    clock["t"] = 0.6                                                      # la grâce s'écoule
    plug._tick()
    assert _affects(events) == [] and plug.state["lock_denied"] == 1      # le verdict mûr a fait foi → FERMÉ


def test_v14_truncated_window_is_muted():
    # m4 (croisé conv 59, REPRODUIT puis corrigé) : fenêtre PARTIELLEMENT sortie du ring (worker très en
    # retard) — AVANT, le `truncated` du seek était JETÉ → émission sur un audio AMPUTÉ présenté comme entier.
    # APRÈS : la garde d'honnêteté V3 est LUE → muet + compté. LE TEST MORD (temp-revert → émission).
    ring = RingBuffer(10 * RATE)                              # 10 s de fenêtre
    events, emit = _collect()
    plug = AffectPlug(ring, emit, detector=AffectDetector(engine=ScriptedAffectEngine(), conf_min=0.0),
                      decide_grace_s=0)
    mark = ring.write_pos()
    ring.write(_noise(9.0))                                   # un tour de 9 s
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 9000})
    ring.write(_noise(8.0))                                   # le ring avance AVANT le tick → fenêtre amputée
    plug._tick()
    assert _affects(events) == [] and plug.state["window_truncated"] == 1


def test_v14_future_window_is_no_span_not_overrun():
    # n5 (croisé conv 59) : une fenêtre entièrement DANS LE FUTUR (speech_ms aberrant) n'est pas un « trou »
    # (aucun overrun réel) → comptée `no_span`, jamais une étiquette mensongère. Muette dans les deux cas.
    ring, events, det, plug = _affect_plug()
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(2.5))
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 1e9})
    plug._tick()
    assert _affects(events) == []
    assert plug.state["no_span"] == 1 and plug.state["overruns"] == 0


def test_v14_bool_speech_ms_rejected():
    # n6 (croisé conv 59) : `speech_ms=True` passait la garde numérique (float(True)=1.0) — asymétrie avec
    # `_int_of` qui rejette les bool. APRÈS : bool = absent → no_span, le verrou n'est même pas consulté.
    ring, events, det, plug = _affect_plug()
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(3.0))
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": True})
    plug._tick()
    assert plug.state["no_span"] == 1 and plug.state["lock_denied"] == 0


def test_v14_blank_threads_env_defaults_bounded(monkeypatch):
    # n7 (croisé conv 59, patron N-5 conv 56) : une variable BLANCHE = non-réglée → défaut BORNÉ 2 (avant :
    # int("" or 0)=0 → défaut onnxruntime = TOUS les cœurs, la borne anti-contention désarmée en silence).
    monkeypatch.setenv("SOPHIA_AFFECT_THREADS", "")
    assert W2v2DimEngine()._threads == 2                      # VIDE (le cas n7 exact : int(""or 0)=0 avant) → borné
    monkeypatch.setenv("SOPHIA_AFFECT_THREADS", "  ")
    assert W2v2DimEngine()._threads == 2                      # blanc = non-réglé → borné
    monkeypatch.setenv("SOPHIA_AFFECT_THREADS", "0")
    assert W2v2DimEngine()._threads == 0                      # 0 EXPLICITE = défaut onnxruntime (documenté)
    monkeypatch.setenv("SOPHIA_AFFECT_THREADS", "abc")
    assert W2v2DimEngine()._threads == 2                      # mal formé → borné (jamais un crash au spawn)
    monkeypatch.delenv("SOPHIA_AFFECT_THREADS")
    assert W2v2DimEngine()._threads == 2


def test_v14_turn_queue_bounded_but_verdicts_never_droppable():
    # M1 (croisé conv 59) : la file BORNEE (drop-oldest) ne porte plus QUE les turn.end (des declencheurs :
    # un drop = un affect perdu, compte) ; les VERDICTS (des preuves) vont DIRECT au verrou thread-safe —
    # aucune file ne peut plus les jeter (bornes par le verrou lui-meme, 512 + plancher).
    ring, events, det, plug = _affect_plug()
    for i in range(50):                                       # > maxsize 8
        plug.on_event("evt.turn.end", {"mark": i, "speech_ms": 100})
    assert plug.state["dropped_turns"] > 0
    assert plug._turns.qsize() <= 8
    for i in range(700):                                      # les verdicts, eux, ne sont JAMAIS droppes
        plug.on_event("evt.speaker", {"mark": 100000 + i, "locuteur": "yohann"})
    assert plug.state["pending_verdicts"] <= 512              # bornes par le VERROU (eviction a plancher), pas une file


def test_v14_M1_closing_proof_survives_backlog():
    # M1 (croisé conv 59, REPRODUIT puis corrigé à la racine) : AVANT, verdicts et turn.end partageaient UNE
    # file drop-oldest — un backlog (moteur lent/paging) jetait l'« inconnu » PRECOCE en gardant le « yohann »
    # et le turn.end → EMISSION sur un tour qu'un tiers avait touché (faux verdict par construction). APRÈS :
    # la preuve va DIRECT au verrou → quel que soit le backlog, le tour est FERMÉ. LE TEST MORD (temp-revert :
    # re-router les verdicts par la file → l'inconnu est évincé → émission).
    ring, events, det, plug = _affect_plug()
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(3.0))
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "inconnu"})       # la preuve FERMANTE, la 1re arrivée
    for i in range(70):                                                        # le backlog qui, AVANT, l'évinçait
        plug.on_event("evt.speaker", {"mark": mark + 200 + i, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 3000})
    plug._tick()
    assert _affects(events) == []                             # la preuve a survécu → verrou FERMÉ
    assert plug.state["lock_denied"] == 1


def test_v14_tick_exception_counted_and_loop_survives():
    # Garde `_tick` (patron V6 re-croise NIT-1) : une exception INATTENDUE est COMPTEE, la boucle SURVIT.
    ring, events, det, plug = _affect_plug()
    n = {"c": 0}
    def _boom():
        n["c"] += 1
        if n["c"] >= 3:
            plug._stop.set()
        raise RuntimeError("tick boom (test defense en profondeur)")
    plug._tick = _boom
    plug._loop()
    assert plug.state["tick_errors"] == 3


def test_v14_warm_failure_exits_worker_and_flags():
    class FailWarmDet(AffectDetector):
        def warm(self):
            raise RuntimeError("modele absent (test degradation honnete)")
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    plug = AffectPlug(ring, emit, detector=FailWarmDet(engine=ScriptedAffectEngine()))
    plug._loop()                                              # warm leve -> sort proprement
    assert plug.state["warm_failed"] is True


def test_v14_stop_short_join_with_eval_in_flight():
    # SOLO-1 (conv 59, LE TEST MORD) : une eval ONNX en vol (~1,4 s) ne tient ni micro ni CUDA -> `stop()` ne
    # l'attend PAS (join 0,3 s, pas le 1 s de la base) : le budget graceful T6 (2 s) sert d'abord la capture.
    # On bloque le moteur sur un Event (deterministe), on stoppe, on mesure : retour < 0,8 s + worker signale
    # `evt.plug.stuck` (jamais silencieux). Sans le fix (join 1 s de la base), le retour depasse ~1 s.
    import threading
    import time as _t
    in_eval = threading.Event()
    release = threading.Event()

    class BlockingEngine(AffectEngine):
        def evaluate(self, audio):
            in_eval.set()
            release.wait(5.0)                                 # bloque « l'eval en vol » jusqu'a la fin du test
            return ADV_A
        def warm(self):
            pass

    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    plug = AffectPlug(ring, emit, detector=AffectDetector(engine=BlockingEngine(), conf_min=0.0),
                      decide_grace_s=0)
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(3.0))
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 3000})
    plug.start()                                              # le VRAI worker (l'eval bloque dedans)
    assert in_eval.wait(3.0), "l'eval n'a pas demarre"
    t0 = _t.perf_counter()
    plug.stop()
    elapsed = _t.perf_counter() - t0
    release.set()                                             # libere le worker (daemon) — pas de fuite de test
    assert elapsed < 0.8, f"stop() a attendu {elapsed:.2f}s (le join court 0,3 s ne tient pas)"
    assert ("evt.plug.stuck", {"plug": "affect"}) in [(t, p) for t, p in events], "worker vivant non signale"


def test_v14_verdicts_of_next_turn_not_consumed():
    # Deux tours qui s'enchainent : les verdicts du tour 2 (marks au-dela de la fin du tour 1) SURVIVENT a la
    # decision du tour 1 -> le tour 2 s'ouvre normalement (la purge ne mange que <= fin decidee).
    ring, events, det, plug = _affect_plug()
    m1 = _turn(plug, ring, speech_s=2.5, verdicts=("yohann",))
    m2 = _turn(plug, ring, speech_s=2.5, verdicts=("yohann",))
    assert len(_affects(events)) == 2
    assert _affects(events)[0]["mark"] == m1 and _affects(events)[1]["mark"] == m2


# ══════════ COEUR REEL — le VRAI w2v2-dim reproduit la reference publiee ══════════

def _affect_model_present() -> bool:
    return os.path.exists(os.path.join(_MODEL_DIR, "model.onnx"))


def _anchor_present() -> bool:
    return os.path.exists(os.path.join(_ANCHOR_DIR, "raw_far.wav"))


def test_v14_w2v2_reproduces_published_reference():
    # NON-skippable hors absence du modele (CF2, gitignore) : la carte HF publie la sortie pour des ZEROS (1 s)
    # -> [0.5460754, 0.6062266, 0.4043067] (arousal, dominance, valence). Le banc conv 59 l'a reproduite a 1e-5 ;
    # ce test verrouille la CHAINE produit (modele vendorise + entree brute) sur cette reference — parite du
    # « prouve bit-a-bit » Smart Turn conv 45.
    if not _affect_model_present():
        pytest.skip("modele affect vendorise absent (resources/models/affect/ — CF2, gitignore)")
    eng = W2v2DimEngine()
    eng.warm()
    adv = eng.evaluate(np.zeros(RATE, dtype=np.float32))
    ref = np.array([0.5460754, 0.6062266, 0.4043067])
    assert float(np.max(np.abs(adv - ref))) < 1e-3, f"reference publiee non reproduite : {adv}"


def test_v14_w2v2_deterministic_and_bounded():
    if not (_affect_model_present() and _anchor_present()):
        pytest.skip("modele affect / ancre absents (CF2, gitignore)")
    eng = W2v2DimEngine()
    far = load16(os.path.join(_ANCHOR_DIR, "raw_far.wav"))
    win = far[len(far) // 2 - 4 * RATE: len(far) // 2 + 4 * RATE]
    a1 = eng.evaluate(win)
    a2 = eng.evaluate(win)
    assert float(np.max(np.abs(a1 - a2))) == 0.0              # determinisme (banc : 0,0)
    assert np.all(a1 > -0.5) and np.all(a1 < 1.5)             # plage ~[0,1] (marge honnete)


def test_v14_real_pipeline_on_yohann_voice():
    # Le pipeline ENTIER en coeur reel local : la VRAIE voix de Yohann (raw_far, held-out) au ring -> verdict
    # verrou (injecte — la couture U-V14 ; le VRAI ECAPA est prouve par test_v6 + l'E2E) -> VRAI moteur w2v2 ->
    # evt.affect emis, payload numerique. conf_min=0 (le SEUIL est une calibration §6, pas l'objet d'ici).
    if not (_affect_model_present() and _anchor_present()):
        pytest.skip("modele affect / ancre absents (CF2, gitignore)")
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    plug = AffectPlug(ring, emit, detector=AffectDetector(engine=W2v2DimEngine(), conf_min=0.0),
                      decide_grace_s=0)
    far = load16(os.path.join(_ANCHOR_DIR, "raw_far.wav"))
    seg = (far[int(5 * RATE):int(11 * RATE)] * 32767).astype(np.int16)   # 6 s de SA voix
    ring.write(_sil(0.2))
    mark = ring.write_pos()
    ring.write(seg)
    plug.on_event("evt.speaker", {"mark": mark, "locuteur": "yohann"})
    plug.on_event("evt.turn.end", {"mark": mark, "speech_ms": 6000})
    plug._tick()
    af = _affects(events)
    assert len(af) == 1, f"pas d'emission (state={plug.state})"
    p = af[0]
    assert 0.0 <= p["valence"] <= 1.0 and 0.0 <= p["energie"] <= 1.0 and 0.0 <= p["confiance"] <= 1.0
    assert set(p.keys()) == {"valence", "energie", "confiance", "mark", "captured_at", "speech_ms"}
