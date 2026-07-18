"""U-V2 (plan 01) — VAD (Silero) : consommateur du ring POST-AEC qui emet evt.vad.start/stop + le BUS.

Deterministe, SANS peripherique (le smoke micro reel = etage 3). On prouve :
  - la LOGIQUE de la prise (moteur SCRIPTE injecte, independant de Silero) : hysterese start/stop, marques
    (pos = _fed_base + idx, + captured_at, + prob), fenetrage 512, normalisation int16->float32 [-1,1],
    discontinuite (overrun) -> reset moteur + cloture, robustesse d'un moteur qui leve (COMPTEE), etat expose ;
  - le MOTEUR REEL (Silero torch) : silence ne declenche jamais ; parole synthetique declenche ; ET
    l'hysterese REIMPLEMENTEE est EQUIVALENTE a VADIterator (memes decisions + memes index) -> 1 appel modele
    (prob sans doubler le CPU) SANS diverger du composant prouve au banc ;
  - le BUS : drop-oldest (fonction pure) + agregat des drops + fan-out thread-safe -> abonne ;
  - le CYCLE DE VIE concurrent NEUF de V2 : _stop_audio idempotent avec capture ET vad.
"""
import asyncio
import threading
import time

import numpy as np

from audio.ring import RingBuffer
from consumers.vad import VadPlug, VadEngine, SileroVadEngine, FRAME
from bus import EventBus, Subscription, _enqueue_drop_oldest


# ── moteur SCRIPTE injecte : rend (kind, idx, prob) d'une liste ; idx = echantillons nourris depuis reset ──
class ScriptedEngine(VadEngine):
    def __init__(self, script, prob=0.9):
        self._script = list(script)   # ex: [None, "start", None, "end"]
        self._i = 0                   # position dans le script (NE se reset PAS)
        self._fed = 0                 # echantillons nourris depuis reset (idx = debut de la fenetre courante)
        self._prob = float(prob)
        self.windows = []             # fenetres recues (pour verifier la normalisation)
        self.resets = 0

    def feed(self, window):
        self.windows.append(np.asarray(window))
        idx = self._fed
        self._fed += len(window)
        ev = self._script[self._i] if self._i < len(self._script) else None
        self._i += 1
        return (ev, idx, self._prob) if ev else None

    def reset(self):
        self.resets += 1
        self._fed = 0                 # comme le vrai moteur : compteur d'echantillons remis a 0


def _collect_emit(events, lock):
    def emit(etype, payload):
        with lock:
            events.append((etype, dict(payload)))
    return emit


def _pump(plug, blocks):
    """Ecrit chaque bloc dans le ring PUIS fait lire+process la prise (mime la boucle de la base, SANS thread
    -> deterministe). Estampille chaque bloc a `samples_ecrits/16000` -> marques ring realistes (duree de
    segment coherente ; sinon tous les blocs, ecrits en microsecondes, donneraient duration ~0)."""
    written = getattr(plug, "_test_written", 0)
    for blk in blocks:
        blk = np.asarray(blk, dtype=np.int16)
        plug._ring.write(blk, at_mono=written / 16000.0)
        written += int(blk.shape[0])
    plug._test_written = written
    while True:
        data, _overrun = plug._cursor.read(plug._hop)
        if data.size:
            plug.process(data)
        else:
            break


def _mk(script, cap=16000):
    ring = RingBuffer(cap)
    events, lock = [], threading.Lock()
    eng = ScriptedEngine(script)
    plug = VadPlug(ring, _collect_emit(events, lock), engine=eng)   # curseur cree ICI (ring vide -> pos 0)
    return ring, plug, eng, events


# ══════════ Logique de la prise (moteur scripte) ══════════

def test_vad_emits_start_then_stop_with_marks_and_prob():
    # fenetre 1 -> start, fenetre 4 -> end ; blocs de 512 -> fenetre i a la position i*512 (marque)
    script = [None, "start", None, None, "end", None]
    ring, plug, eng, events = _mk(script)
    _pump(plug, [np.full(FRAME, 1000, dtype=np.int16) for _ in range(6)])
    kinds = [e[0] for e in events]
    assert kinds == ["evt.vad.start", "evt.vad.stop"], kinds
    start = events[0][1]; stop = events[1][1]
    assert start["pos"] == 1 * FRAME               # la 2e fenetre (index 1)
    assert stop["pos"] == 4 * FRAME                # la 5e fenetre (index 4)
    assert start["captured_at"] is not None and stop["captured_at"] is not None
    assert start["prob"] == 0.9 and stop["prob"] == 0.9   # la prob est portee (NIT-4)
    assert stop["duration_ms"] is not None and stop["duration_ms"] > 0


def test_vad_hysteresis_ignores_redundant_events():
    # deux "start" de suite -> un seul evt.vad.start ; "end" sans parole ouverte -> ignore
    script = ["end", "start", "start", "end", "end"]
    ring, plug, eng, events = _mk(script)
    _pump(plug, [np.full(FRAME, 800, dtype=np.int16) for _ in range(5)])
    kinds = [e[0] for e in events]
    assert kinds == ["evt.vad.start", "evt.vad.stop"], kinds   # 1 start, 1 stop, malgre les doublons


def test_vad_normalizes_int16_to_float_unit_range():
    # le ring produit de l'int16 ; le moteur DOIT recevoir du float32 dans [-1,1] (16384 -> ~0,5)
    ring, plug, eng, events = _mk([None, None])
    _pump(plug, [np.full(FRAME, 16384, dtype=np.int16)])
    assert eng.windows, "le moteur n'a recu aucune fenetre"
    w = eng.windows[0]
    assert w.dtype == np.float32
    assert abs(float(w[0]) - 0.5) < 1e-3            # 16384/32768 = 0,5
    assert float(np.max(np.abs(w))) <= 1.0


def test_vad_windows_are_exactly_512():
    ring, plug, eng, events = _mk([None] * 10)
    # ecrit des blocs NON alignes sur 512 -> la prise doit tout de meme fenetrer par 512 (tampon interne)
    _pump(plug, [np.full(300, 500, dtype=np.int16) for _ in range(10)])   # 3000 ech -> 5 fenetres de 512 (+ reste)
    assert eng.windows, "aucune fenetre"
    assert all(w.shape[0] == FRAME for w in eng.windows), [w.shape[0] for w in eng.windows]
    assert len(eng.windows) == 3000 // FRAME        # 5 fenetres pleines, le reste attend


def test_vad_discontinuity_resets_engine_and_closes_segment():
    # overrun (curseur distance) pendant la parole -> re-synchro : reset moteur + cloture du segment (rompu)
    script = ["start"] + [None] * 20                 # start a la 1re fenetre, puis rien
    ring, plug, eng, events = _mk(script, cap=1024)   # petite fenetre -> facile a distancer
    _pump(plug, [np.full(FRAME, 1000, dtype=np.int16)])          # 1 fenetre -> start (in_speech)
    assert [e[0] for e in events] == ["evt.vad.start"]
    assert plug._in_speech is True
    # ecrit 4*512 d'un coup (> capacite 1024) -> le curseur du plug (a 512) est distance
    _pump(plug, [np.full(FRAME * 4, 1000, dtype=np.int16)])
    assert eng.resets >= 1, "le moteur n'a pas ete reset a la discontinuite"
    assert any(e[0] == "evt.vad.stop" for e in events), "le segment n'a pas ete clos a la discontinuite"
    assert plug._in_speech is False
    assert plug._resyncs >= 1


def test_vad_engine_exception_is_counted_not_swallowed():
    # MINEUR-3 : un moteur qui LEVE ne tue pas la boucle ET est COMPTE (jamais avale en silence)
    class Boom(VadEngine):
        def __init__(self): self.n = 0
        def feed(self, w): self.n += 1; raise RuntimeError("moteur casse")
        def reset(self): pass

    ring = RingBuffer(4000)
    eng = Boom()
    plug = VadPlug(ring, lambda *a: None, engine=eng)
    _pump(plug, [np.full(FRAME, 700, dtype=np.int16) for _ in range(4)])
    assert eng.n == 4, "toutes les fenetres n'ont pas ete tentees"
    assert plug.state["engine_errors"] == 4, "les erreurs moteur ne sont pas comptees (MINEUR-3)"


def test_vad_state_exposes_marks_and_no_errors():
    ring, plug, eng, events = _mk([None, "start", "end"])
    _pump(plug, [np.full(FRAME, 900, dtype=np.int16) for _ in range(3)])
    st = plug.state
    assert st["segments"] == 1
    assert st["in_speech"] is False
    assert st["last_start_pos"] == FRAME and st["last_stop_pos"] == 2 * FRAME
    assert st["engine_errors"] == 0


# ══════════ Moteur REEL (Silero torch) — smoke deterministe + EQUIVALENCE ══════════

def test_silero_engine_silence_never_fires():
    # le VRAI Silero sur du SILENCE -> aucun start (invariant F2-adjacent : un flux muet/media ne fait pas de
    # faux vad.start ; mesure design-first : silence proba ~0,009). Deterministe.
    eng = SileroVadEngine()
    starts = sum(1 for _ in range(60) if (r := eng.feed(np.zeros(FRAME, dtype=np.float32))) and r[0] == "start")
    assert starts == 0


def test_silero_engine_fires_on_synthetic_speech():
    # le VRAI Silero sur la parole synthetique (prouvee design-first) -> au moins un start. Signal = le buffer
    # deterministe (near) de la source duplex.
    from audio.test_source import SyntheticSpeechSource
    buf = SyntheticSpeechSource(lambda *a: None, lambda *a: None)._buf.astype(np.float32) / 32768.0
    eng = SileroVadEngine()
    starts = sum(1 for i in range(len(buf) // FRAME)
                 if (r := eng.feed(buf[i * FRAME:(i + 1) * FRAME])) and r[0] == "start")
    assert starts >= 1, f"Silero n'a pas detecte la parole synthetique (starts={starts})"


def test_silero_engine_equivalent_to_vaditerator():
    # PREUVE : l'hysterese REIMPLEMENTEE (1 appel modele -> prob + index) rend EXACTEMENT les memes decisions
    # (start/end + index) que VADIterator, sur le meme flux. -> reimplementer n'a PAS diverge du composant
    # prouve au banc conv 25 (le prix de « prob sans doubler le CPU »).
    # NB : le modele Silero est A ETAT (RNN) -> on NE peut PAS partager l'instance dans la meme boucle (chaque
    # fenetre avancerait l'etat DEUX fois). On exerce VADIterator sur toute la sequence, on RESET l'etat du
    # modele (reset_states -> self.model.reset_states, utils_vad.py:501), puis on rejoue mon engin sur la MEME
    # sequence : etat frais, sequence de prob identique (modele deterministe) -> seule l'hysterese est comparee.
    from silero_vad import load_silero_vad, VADIterator
    from audio.test_source import SyntheticSpeechSource
    buf = SyntheticSpeechSource(lambda *a: None, lambda *a: None)._buf.astype(np.float32) / 32768.0
    windows = [buf[i * FRAME:(i + 1) * FRAME] for i in range(len(buf) // FRAME)]
    model = load_silero_vad()
    ref = VADIterator(model, threshold=0.5, sampling_rate=16000, min_silence_duration_ms=150)
    ref_events = [ref(w) for w in windows]           # run 1 : VADIterator seul avance l'etat du modele
    model.reset_states()                             # RESET l'etat RNN (sinon double-avance) -> sequence propre
    eng = SileroVadEngine(threshold=0.5, min_silence_ms=150)
    eng._model = model                               # reutilise le modele (etat remis a zero)
    my_events = [eng.feed(w) for w in windows]       # run 2 : mon engin seul, meme sequence, etat frais

    fired = 0
    for i, (ev_ref, res) in enumerate(zip(ref_events, my_events)):
        if ev_ref is None:
            assert res is None, f"fenetre {i}: mien={res}, VADIterator=None"
        else:
            kind = "start" if "start" in ev_ref else "end"
            assert res is not None and res[0] == kind, f"fenetre {i}: mien={res}, ref={ev_ref}"
            assert res[1] == ev_ref[kind], f"fenetre {i}: index mien={res[1]} != ref VADIterator={ev_ref[kind]}"
            fired += 1
    assert fired >= 2, f"le flux n'a pas exerce start+end (fired={fired})"


def test_reset_clears_model_rnn_state():
    # Finding A (re-croise) : reset() doit remettre l'etat RNN du modele a zero (comme VADIterator.reset_states
    # -> self.model.reset_states). PREUVE DIRECTE : apres un etat installe puis reset, la prob sur une fenetre
    # de sonde == celle d'un moteur FRAIS. Sans le correctif, l'etat d'avant le trou biaise la prob (reproduit
    # conv 41 : delta jusqu'a 0,47) -> ce test MORD.
    from audio.test_source import SyntheticSpeechSource
    buf = SyntheticSpeechSource(lambda *a: None, lambda *a: None)._buf.astype(np.float32) / 32768.0
    windows = [buf[i * FRAME:(i + 1) * FRAME] for i in range(len(buf) // FRAME)]
    probe = windows[80]
    a = SileroVadEngine(); a.warm()
    for w in windows[:60]:                            # installe un etat RNN
        a.feed(w)
    a.reset()                                         # <-- doit effacer l'etat RNN (le correctif)
    pa = a._prob(probe)
    b = SileroVadEngine(); b.warm()                   # moteur FRAIS
    pb = b._prob(probe)
    assert abs(pa - pb) < 1e-6, f"reset() n'a pas efface l'etat RNN : prob apres reset {pa} != frais {pb}"


# ══════════ Hysterese PURE (prob injectees) — couvre les branches que le modele n'exerce pas ══════════

def _decide_seq(eng, probs, n=FRAME):
    """Nourrit une SEQUENCE de prob a l'hysterese PURE (sans modele), comme feed (current += n avant _decide)."""
    out = []
    for p in probs:
        eng._current += n
        out.append(eng._decide(p, n))
    return out


def test_hysteresis_greyzone_and_temp_end_reset():
    # zone grise (neg_threshold 0.35 <= p < threshold 0.5) : ni start ni set de temp_end ; et la parole qui
    # REVIENT (p >= 0.5) AVANT min_silence annule le end pendant (temp_end remis a 0) -> un seul start/end.
    eng = SileroVadEngine(threshold=0.5, min_silence_ms=150)   # min_silence = 2400 ech ~ 4,7 fenetres
    # start · gris (0.4 -> rien) · bas (temp_end pose) · HAUT (temp_end annule) · bas x6 (>min_silence -> end)
    seq = [0.9, 0.4, 0.2, 0.9, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]
    kinds = [r[0] for r in _decide_seq(eng, seq) if r]
    assert kinds == ["start", "end"], kinds           # le end pendant a bien ete annule par le retour de parole


def test_hysteresis_reset_clears_hysteresis_state():
    # reset() efface l'etat d'hysterese -> une parole ulterieure REDECLENCHE un start (triggered efface)
    eng = SileroVadEngine(threshold=0.5)              # modele non charge -> reset ne touche que l'hysterese
    a = _decide_seq(eng, [0.9])
    eng.reset()
    b = _decide_seq(eng, [0.9])
    assert a[0] and a[0][0] == "start" and b[0] and b[0][0] == "start"


def test_hysteresis_start_index_carries_pad():
    # N4 (re-croise) : assertion DIRECTE que l'index de start porte le speech_pad (480 ech = 30 ms AVANT la fenetre)
    eng = SileroVadEngine(threshold=0.5)              # pad = 480
    out = _decide_seq(eng, [0.1, 0.1, 0.1, 0.9])      # fenetre 3 declenche : current=2048 -> start=2048-480-512
    assert out[3] and out[3][0] == "start"
    assert out[3][1] == 3 * FRAME - 480, out[3][1]    # debut de fenetre 3 MOINS le pad


# ══════════ Le BUS ══════════

def test_enqueue_drop_oldest_pure():
    from collections import deque
    q = deque()
    assert _enqueue_drop_oldest(q, "a", 2) == 0 and list(q) == ["a"]
    assert _enqueue_drop_oldest(q, "b", 2) == 0 and list(q) == ["a", "b"]
    assert _enqueue_drop_oldest(q, "c", 2) == 1 and list(q) == ["b", "c"]   # plein -> jette "a"
    assert _enqueue_drop_oldest(q, "d", 2) == 1 and list(q) == ["c", "d"]


def test_subscription_drop_oldest_counts():
    async def go():
        sub = Subscription(maxlen=2)
        assert sub.offer({"n": 1}) == 0 and sub.offer({"n": 2}) == 0 and sub.offer({"n": 3}) == 1
        assert sub.dropped == 1
        a = await sub.get(); b = await sub.get()
        return a["n"], b["n"]
    assert asyncio.run(go()) == (2, 3)                                   # ne restent que les 2 plus recents


def test_event_bus_dropped_total_aggregates():
    # MINEUR-2 (F) : le « + signal » du drop-oldest -> le bus AGREGE les drops (visible dans /debug)
    async def go():
        bus = EventBus(asyncio.get_running_loop(), per_sub_max=2)
        s = bus.subscribe()
        for k in range(5):
            bus._fanout({"type": "evt.vad.start", "id": k})   # 5 offerts, file de 2 -> 3 jetes
        assert bus.dropped_total == 3 and s.dropped == 3
    asyncio.run(go())


def test_event_bus_fanout_threadsafe():
    # publish_threadsafe (depuis un AUTRE thread) -> les 2 abonnes recoivent l'evenement sur la boucle
    async def go():
        bus = EventBus(asyncio.get_running_loop())
        s1, s2 = bus.subscribe(), bus.subscribe()
        assert bus.subscriber_count == 2
        threading.Thread(target=lambda: bus.publish_threadsafe({"type": "evt.vad.start", "id": "x"})).start()
        e1 = await asyncio.wait_for(s1.get(), timeout=2.0)
        e2 = await asyncio.wait_for(s2.get(), timeout=2.0)
        assert e1["type"] == "evt.vad.start" and e2["type"] == "evt.vad.start"
        bus.unsubscribe(s1); bus.unsubscribe(s2)
        assert bus.subscriber_count == 0
    asyncio.run(go())


def test_event_bus_publish_after_loop_closed_is_silent():
    # la boucle est fermee (teardown) -> publish_threadsafe ne leve pas (l'event est perdu, sans consequence)
    loop = asyncio.new_event_loop()
    bus = EventBus(loop)
    loop.close()
    bus.publish_threadsafe({"type": "evt.vad.stop", "id": "y"})   # ne doit PAS lever


# ══════════ Cycle de vie concurrent NEUF de V2 (MINEUR-2 R) ══════════

def test_stop_audio_idempotent_with_vad_under_concurrency():
    # deux/trois _stop_audio concurrents avec capture ET vad -> chaque ressource stop() EXACTEMENT une fois
    # (pops atomiques separes ; parite avec S#1 de V0, etendue au VAD).
    import server

    calls = {"cap": 0, "vad": 0}
    lock = threading.Lock()

    class Slow:
        def __init__(self, key): self.key = key
        def stop(self):
            with lock:
                calls[self.key] += 1
            time.sleep(0.05)

    server._audio["ring"] = object()
    server._audio["capture"] = Slow("cap")
    server._audio["vad"] = Slow("vad")
    ths = [threading.Thread(target=server._stop_audio) for _ in range(3)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    assert calls["cap"] == 1 and calls["vad"] == 1
    assert server._audio.get("capture") is None and server._audio.get("vad") is None


# ══════════ GATE anti-auto-ecoute (V7 morceau C) — le VAD IGNORE le micro pendant qu'ELLE parle ══════════
# Fidelite au banc oreilles_live:1298/1314 (_flush_audio pendant _await + a la fin) + 1083 (reset_states).
# Le VAD est le SEUL emetteur de evt.vad.* -> muter le VAD coupe tout l'aval (STT/speaker piloves-VAD).

class GateStub:
    """Gate pilotable : `value` True = SA voix joue (le VAD doit ignorer le micro)."""
    def __init__(self, value=False):
        self.value = value
    def __call__(self):
        return self.value


def test_vad_gate_defaults_off():
    # sans set_gate : comportement V2 INCHANGE (aucun mute, ecoute normale) — non-regression par construction.
    ring, plug, eng, events = _mk([None, "start", "end"])
    _pump(plug, [np.full(FRAME, 900, dtype=np.int16) for _ in range(3)])
    assert plug.state["muted"] is False and plug.state["mutes"] == 0
    assert [e[0] for e in events] == ["evt.vad.start", "evt.vad.stop"]


def test_vad_gate_mutes_while_speaking():
    # gate True -> le VAD IGNORE le micro : moteur JAMAIS nourri, AUCUN evt, muted=True, une seule fenetre de mute.
    ring, plug, eng, events = _mk(["start", "start", "start"])   # le moteur DIRAIT start... mais il n'est pas appele
    gate = GateStub(value=True)
    plug.set_gate(gate)
    _pump(plug, [np.full(FRAME, 1000, dtype=np.int16) for _ in range(4)])
    assert events == [], "un evt a fui pendant que SA voix jouait"
    assert eng.windows == [], "le moteur a ete nourri pendant le mute (le micro n'a pas ete ignore)"
    assert plug.state["muted"] is True
    assert plug.state["mutes"] == 1, "le mute doit compter UNE fenetre (entree unique), pas une par trame"


def test_vad_gate_resume_seeks_latest_and_resets():
    # LE TEST MORD `seek_latest` : a la reprise on ecrit un backlog de 2 fenetres AVANT de pumper. La 1re est la
    # trame de transition (jetee par le return de _resume_from_mute). SANS seek_latest, le curseur resterait au
    # bord de la 1re -> la 2e serait lue et NOURRIE au moteur (le residu de sa voix). AVEC seek_latest, le curseur
    # saute a la tete -> AUCUNE des deux n'est vue. (Prouve par TEMP-REVERT : retirer seek_latest fait passer
    # eng.windows de [] a 1 -> ce test devient ROUGE.) + reset moteur (reset_states l.1083).
    ring, plug, eng, events = _mk(["start", "end"], cap=16000)
    gate = GateStub()
    # 1) MUTE : SA voix joue -> on ecrit son residu (6 fenetres), il doit etre DROPPE (jamais feed)
    gate.value = True
    plug.set_gate(gate)
    _pump(plug, [np.full(FRAME, 5000, dtype=np.int16) for _ in range(6)])
    assert eng.windows == [] and events == [] and eng.resets == 0
    # 2) REPRISE : gate False + 2 fenetres de backlog -> seek_latest doit SAUTER les deux (residu) + reset moteur
    gate.value = False
    _pump(plug, [np.full(FRAME, 5000, dtype=np.int16) for _ in range(2)])
    assert eng.resets == 1, "le moteur n'a pas ete reset a la reprise"
    assert eng.windows == [], "seek_latest n'a pas saute le backlog : une fenetre de residu a ete nourrie au moteur"
    assert plug.state["muted"] is False
    # 3) parole NEUVE (ecrite APRES la reprise) -> traitee normalement, SANS le residu (saute par seek_latest)
    _pump(plug, [np.full(FRAME, 1000, dtype=np.int16) for _ in range(3)])
    assert [e[0] for e in events] == ["evt.vad.start", "evt.vad.stop"]
    assert len(eng.windows) == 3, f"le moteur a vu le residu (attendu 3 fenetres neuves) : {len(eng.windows)}"


def test_vad_gate_mute_closes_open_segment():
    # cas DEFENSIF : un segment ouvert quand SA voix demarre -> le mute le CLOT (pas de start orphelin en aval).
    ring, plug, eng, events = _mk(["start", None, None])
    gate = GateStub()
    plug.set_gate(gate)
    _pump(plug, [np.full(FRAME, 1000, dtype=np.int16)])          # parole en cours -> start ouvert
    assert plug._in_speech is True and [e[0] for e in events] == ["evt.vad.start"]
    gate.value = True                                            # SA voix demarre pendant un segment ouvert
    _pump(plug, [np.full(FRAME, 1000, dtype=np.int16)])
    assert plug._in_speech is False, "le segment ouvert n'a pas ete clos au mute"
    assert [e[0] for e in events] == ["evt.vad.start", "evt.vad.stop"]
    assert plug.state["muted"] is True


def test_vad_gate_failopen_on_exception():
    # un gate qui LEVE -> fail-open : on ECOUTE (jamais rendre Sophia sourde sur un bug de gate).
    ring, plug, eng, events = _mk([None, "start", "end"])
    def boom():
        raise RuntimeError("gate casse")
    plug.set_gate(boom)
    _pump(plug, [np.full(FRAME, 900, dtype=np.int16) for _ in range(3)])
    assert plug.state["muted"] is False, "un gate en echec a rendu le VAD sourd (doit fail-open)"
    assert [e[0] for e in events] == ["evt.vad.start", "evt.vad.stop"]
    assert plug.state["gate_errors"] >= 1, "le gate qui leve n'est pas COMPTE (standard maison : jamais en silence)"
