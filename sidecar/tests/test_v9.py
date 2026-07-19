"""U-V9 (plan 01) — ETATS D'ECOUTE cote sidecar : la DEADLINE DE GARDE R-1 + `arm_external` du WakeGate.

V9 pose l'etat d'ecoute MACRO (VEILLE/ECOUTE) cote orchestrateur (ListenState, teste par u-states/u-router). Le
sidecar, lui, porte le FILET de surete R-1 (contrat grave conv 42) : si l'aval oublie un release, `_armed` resterait
a True et rendrait Sophia SOURDE (tout on_wake suivant = no-op S12). `check_guard` (appele par le worker STT en
continu) auto-relache sur un SILENCE prolonge. `arm_external` = la confirmation orchestrateur (cmd.listen.start).

On teste la LOGIQUE de la garde sur le WakeGate directement (deterministe, positions ring controlees). Le chemin
COMPLET (cmd.listen.start/stop via WS -> arm_external/release ; check_guard cable dans le vrai worker STT) est prouve
par l'E2E `e2e-v9` (coeur reel).
"""
import threading
import time

import numpy as np

from audio.ring import RingBuffer
from consumers.stt import SttEngine, SttPlug
from consumers.wake import WakeGate

RATE = 16000


def _collect():
    events, lock = [], threading.Lock()

    def emit(etype, payload):
        with lock:
            events.append((etype, dict(payload)))
    return events, emit


def _ring_at(write_samples: int) -> RingBuffer:
    """Un ring assez grand pour ne jamais overrun, avec `write_samples` deja ecrits (write_pos = write_samples)."""
    ring = RingBuffer(RATE * 120)
    ring.write(np.zeros(write_samples, dtype=np.int16))
    return ring


# ══════════ La deadline de garde R-1 — `check_guard` MORD sur un silence prolonge ══════════

def test_guard_releases_after_prolonged_silence():
    ring = _ring_at(RATE)                         # write_pos = 16000
    events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)         # garde = 1 s = 16000 ech
    w.on_wake(mark=8000)                          # arme ; _last_activity_pos = write_pos() = 16000 ; emet evt.wake
    assert w.state["armed"] is True
    # silence < garde (0,5 s) -> PAS de release, PAS d'emit
    assert w.check_guard(RATE + RATE // 2) is False
    assert w.state["armed"] is True
    assert [t for t, _ in events] == ["evt.wake"]
    # silence > garde (1,25 s) -> AUTO-RELACHE (retour VEILLE)
    assert w.check_guard(RATE + int(1.25 * RATE)) is True
    assert w.state["armed"] is False
    assert w.state["guard_releases"] == 1
    # ROB-B (croise conv 50) : l'auto-release EMET evt.listen.timeout -> l'orchestrateur synchronise son etat
    # (sinon la vue derivee O5 mentirait : ECOUTE alors que Sophia est retombee en VEILLE).
    assert [t for t, _ in events] == ["evt.wake", "evt.listen.timeout"]
    assert events[-1][1]["reason"] == "inactivite"


def test_guard_noop_when_not_armed():
    ring = _ring_at(RATE)
    _events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    # pas arme -> check_guard ne fait JAMAIS rien, meme tres tard (pas de release fantome, pas de compteur)
    assert w.check_guard(999_999_999) is False
    assert w.state["guard_releases"] == 0


def test_guard_pushed_by_vad_activity():
    # l'activite (un vad.start observe) REPOUSSE la garde : tant que Yohann parle par intervalles, elle ne mord jamais.
    ring = _ring_at(RATE)
    _events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    w.on_wake(mark=8000)                          # _last_activity_pos = 16000
    ring.write(np.zeros(RATE, dtype=np.int16))    # le ring avance (nouvelle parole) : write_pos = 32000
    w.observe("evt.vad.start", {"pos": 30000})    # activite -> _last_activity_pos = write_pos() = 32000
    # a 0,5 s APRES cette activite : 40000 - 32000 = 8000 < garde 16000 -> PAS de release (la garde a ete repoussee)
    assert w.check_guard(32000 + RATE // 2) is False
    assert w.state["armed"] is True


def test_guard_release_restores_wake_ability():
    # LE TEST MORD (contrat R-1) : sans `check_guard` qui relache, `_armed` resterait True -> un nouveau
    # « Bonjour Sophia » serait un no-op (S12) -> Sophia SOURDE. La garde relache -> le reveil re-fonctionne.
    ring = _ring_at(RATE)
    _events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    w.on_wake(mark=8000)                          # arme
    assert w.on_wake(mark=8000) is None           # aval BUGGE (jamais release) -> S12 : 2e reveil no-op = la SURDITE
    assert w.check_guard(RATE + int(1.25 * RATE)) is True   # la garde relache
    assert w.state["armed"] is False
    assert w.on_wake(mark=12000) is not None      # un nouveau reveil MARCHE (plus sourde)
    assert w.state["wakes"] == 2


def test_touch_guard_pushes_while_speaking():
    # REGRESSION evitee : quand Sophia parle une LONGUE reponse, l'AEC annule sa voix -> aucun vad.start ->
    # `observe` ne repousse pas la garde. `touch_guard` (appele par le worker quand SA voix joue) la repousse ->
    # elle ne se relache PAS pendant qu'elle parle (sinon VEILLE a tort apres une longue reponse).
    ring = _ring_at(RATE)
    _events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    w.on_wake(mark=8000)                          # _last_activity_pos = 16000
    ring.write(np.zeros(2 * RATE, dtype=np.int16))   # elle parle 2 s (le ring avance) : write_pos = 48000
    w.touch_guard()                               # SA voix joue -> repousse -> _last_activity_pos = 48000
    # a 0,5 s APRES : 48000 + 8000 - 48000 = 8000 < garde 16000 -> PAS de release (la garde a ete repoussee)
    assert w.check_guard(48000 + RATE // 2) is False
    assert w.state["armed"] is True
    # touch_guard NE change PAS l'etat (ne reveille pas, ne relache pas)
    assert w.state["wakes"] == 1


def test_guard_tick_repousse_pendant_la_parole_de_yohann():
    # ROB-A (croise conv 50) : pendant un GROUPE de parole EN COURS de Yohann (_active=True), meme sans NOUVEAU
    # vad.start (parole continue sans pause > 150 ms), la garde ne doit PAS mordre. `_guard_tick` REPOUSSE
    # (touch_guard) tant que _active OU qu'elle parle ; ne VERIFIE (check_guard) qu'en VRAI silence.
    ring = _ring_at(RATE)
    _events, emit = _collect()

    class _FW:
        def __init__(self):
            self.touch = 0
            self.check = 0

        def touch_guard(self):
            self.touch += 1

        def check_guard(self, now_pos):
            self.check += 1
            return False

    class _FE(SttEngine):
        def warm(self):
            pass

        def transcribe(self, a, beam_size=5, word_ts=False):
            return "", [], 1.0

    fw = _FW()
    plug = SttPlug(ring, emit, wake=fw, engine=_FE())
    # (a) vrai silence (aucun groupe, elle ne parle pas) -> VERIFIE la garde
    plug._active = False
    plug._guard_tick()
    assert fw.check == 1 and fw.touch == 0
    # (b) Yohann parle (groupe ouvert, meme sans nouveau vad.start) -> REPOUSSE, jamais de check pendant sa parole
    plug._active = True
    plug._guard_tick()
    plug._guard_tick()
    assert fw.touch == 2 and fw.check == 1, "la garde ne doit PAS mordre pendant une parole continue de Yohann (ROB-A)"
    # (c) SA voix joue (gate) -> REPOUSSE aussi
    plug._active = False
    plug.set_gate(lambda: True)
    plug._guard_tick()
    assert fw.touch == 3 and fw.check == 1


def test_touch_guard_noop_when_not_armed():
    ring = _ring_at(RATE)
    _events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    w.touch_guard()                               # pas armee -> no-op (rien a garder), jamais d'exception
    assert w.state["armed"] is False


# ══════════ `arm_external` — la confirmation orchestrateur (cmd.listen.start, B1) ══════════

def test_arm_external_arms_without_emitting_wake():
    ring = _ring_at(RATE)
    events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    assert w.state["armed"] is False
    w.arm_external()                              # confirmation / reprise depuis PAUSE (le sidecar etait en VEILLE)
    assert w.state["armed"] is True
    assert events == []                           # ce n'est PAS un reveil -> aucun evt.wake (juste l'etat + la garde)


def test_arm_external_pushes_guard_then_releases_on_silence():
    ring = _ring_at(RATE)
    _events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    w.arm_external()                              # _last_activity_pos = write_pos() = 16000
    assert w.check_guard(RATE + RATE // 2) is False          # < garde -> tient
    assert w.check_guard(RATE + int(1.25 * RATE)) is True    # > garde -> relache (meme filet que l'auto-reveil)
    assert w.state["armed"] is False


def test_release_and_arm_external_idempotent():
    # cmd.listen.stop (release) puis cmd.listen.start (arm_external) : idempotents, jamais d'exception, etat coherent.
    ring = _ring_at(RATE)
    _events, emit = _collect()
    w = WakeGate(ring, emit, guard_s=1.0)
    w.release(); w.release()                      # double stop -> reste VEILLE
    assert w.state["armed"] is False
    w.arm_external(); w.arm_external()            # double start (confirmation) -> reste ECOUTE (idempotent)
    assert w.state["armed"] is True


# ══════════ CABLAGE (coeur reel leger, sans GPU) — le worker STT alimente la garde R-1 ══════════

def test_stt_worker_calls_check_guard():
    """La garde R-1 n'est utile que si QUELQU'UN l'appelle : le worker STT (_loop) tourne EN CONTINU (y compris en
    silence) et appelle `check_guard` a chaque iteration. On le prouve avec un moteur STT + un WakeGate BOUCHONS
    (aucun GPU) : le vrai `_loop` doit incrementer le compteur. Sans la ligne `check_guard` dans _loop, ce test MORD."""
    ring = _ring_at(RATE)
    _events, emit = _collect()

    class _FakeEngine(SttEngine):
        def warm(self):
            pass

        def transcribe(self, audio, beam_size=5, word_ts=False):
            return "", [], 1.0

    class _FakeWake:
        def __init__(self):
            self.guard_calls = 0
            self.touch_calls = 0
            self.armed = False

        def check_guard(self, now_pos):
            self.guard_calls += 1
            return False

        def touch_guard(self):
            self.touch_calls += 1

        def observe(self, *a):
            pass

        def on_wake(self, mark=None):
            return None

        def release(self):
            pass

    # (a) SANS gate (elle n'ecoute pas qu'elle parle) -> le worker VERIFIE la garde (check_guard).
    fw = _FakeWake()
    plug = SttPlug(ring, emit, wake=fw, engine=_FakeEngine())
    plug.start()
    try:
        time.sleep(0.2)   # laisse le worker iterer plusieurs fois (idle ~100 Hz)
        assert fw.guard_calls > 0, "le worker STT n'appelle pas check_guard -> la garde R-1 serait morte en prod"
        assert fw.touch_calls == 0, "sans gate, le worker ne devrait pas croire qu'elle parle"
    finally:
        plug.stop()

    # (b) AVEC gate = « SA voix joue » -> le worker REPOUSSE la garde (touch_guard), ne la verifie pas
    #     (sinon une longue reponse relacherait a tort).
    fw2 = _FakeWake()
    plug2 = SttPlug(ring, emit, wake=fw2, engine=_FakeEngine())
    plug2.set_gate(lambda: True)   # elle parle
    plug2.start()
    try:
        time.sleep(0.2)
        assert fw2.touch_calls > 0, "quand SA voix joue, le worker doit REPOUSSER la garde (touch_guard)"
        assert fw2.guard_calls == 0, "quand elle parle, la garde ne doit PAS mordre (pas de check_guard)"
    finally:
        plug2.stop()
