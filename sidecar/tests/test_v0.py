"""U-V0 (plan 01) — chemin audio : capture unique + ring buffer rembobinable + patron de prise.

Deterministe, SANS peripherique (le smoke micro reel = etage 3, non-CI). On prouve :
  - conversion unique 16 kHz mono (mono/stereo/reechantillonnage) ;
  - ring buffer : lecture, curseurs INDEPENDANTS, rembobinage (rend une phrase passee) ;
  - un consommateur LENT/mort ne bloque aucun autre (overrun = drop-oldest, signale), l'ecrivain jamais bloque ;
  - concurrence SPMC : 1 ecrivain + N lecteurs, sequence coherente (monotone), aucun blocage ;
  - patron de prise : le contrat consomme le ring et emet des evt.* normalises.
"""
import threading
import time

import numpy as np
import pytest

from audio.ring import RingBuffer
from audio.capture import to_16k_mono, AudioCapture, WasapiMicSource
from plugs.base import ConsumerPlug


class _FakeSource:
    """Source injectable (sans peripherique) : expose on_raw pour pousser des blocs a la main + compte les start."""

    def __init__(self, on_raw, on_overflow):
        self.on_raw = on_raw
        self.starts = 0
        self.stops = 0

    def start(self):
        self.starts += 1

    def stop(self):
        self.stops += 1


def _drain(ring, target, timeout=1.0):
    """Attend que le thread de conversion ait ecrit >= target echantillons dans le ring (borne)."""
    t0 = time.time()
    while ring.write_pos() < target and time.time() - t0 < timeout:
        time.sleep(0.005)


# ── Conversion 16 kHz mono (fonction pure) ──────────────────────────────────
def test_convert_mono_16k_passthrough():
    x = np.arange(320, dtype=np.int16)
    out = to_16k_mono(x, 16000, 1)
    assert out.dtype == np.int16
    assert len(out) == 320
    assert np.array_equal(out, x)


def test_convert_stereo_to_mono():
    # 2 canaux entrelaces : gauche=1000, droite=2000 -> mono = 1500
    inter = np.empty(200, dtype=np.int16)
    inter[0::2] = 1000
    inter[1::2] = 2000
    out = to_16k_mono(inter, 16000, 2)
    assert len(out) == 100
    assert np.all(out == 1500)


def test_convert_stereo_truncates_partial_block():
    # bloc stereo de longueur IMPAIRE (WASAPI incomplet) -> tronque au multiple, jamais de crash
    inter = np.array([100, 200, 300, 400, 500], dtype=np.int16)  # 2 paires + 1 orphelin
    out = to_16k_mono(inter, 16000, 2)
    assert len(out) == 2
    assert out[0] == 150 and out[1] == 350  # (100+200)/2, (300+400)/2 ; l'orphelin 500 est ignore


def test_convert_empty_block():
    out = to_16k_mono(np.empty(0, dtype=np.int16), 48000, 2)
    assert out.dtype == np.int16 and len(out) == 0


def test_convert_resample_48k_to_16k():
    # 48 kHz -> 16 kHz : longueur divisee par ~3, dtype int16, pas de crash sur un signal reel
    t = np.linspace(0, 1, 48000, endpoint=False)
    sig = (np.sin(2 * np.pi * 220 * t) * 10000).astype(np.int16)
    out = to_16k_mono(sig, 48000, 1)
    assert out.dtype == np.int16
    assert abs(len(out) - 16000) <= 2  # ~16000 echantillons


# ── Ring buffer : lecture, curseurs independants, rembobinage ───────────────
def test_ring_basic_read():
    r = RingBuffer(1000)
    c = r.cursor()  # au bord d'attaque
    r.write(np.arange(50, dtype=np.int16))
    data, overrun = c.read(1000)
    assert overrun == 0
    assert np.array_equal(data, np.arange(50, dtype=np.int16))


def test_ring_independent_cursors():
    r = RingBuffer(1000)
    a, b = r.cursor(), r.cursor()
    r.write(np.arange(100, dtype=np.int16))
    da, _ = a.read(100)
    assert len(da) == 100
    # b n'a rien lu -> il voit encore les 100 echantillons (curseurs INDEPENDANTS)
    assert b.available() == 100
    db, _ = b.read(100)
    assert np.array_equal(da, db)


def test_ring_rewind_returns_past():
    r = RingBuffer(1000)
    c = r.cursor()
    r.write(np.arange(50, dtype=np.int16))
    first, _ = c.read(50)
    assert np.array_equal(first, np.arange(50, dtype=np.int16))
    assert c.available() == 0
    c.rewind(30)                     # rembobinage pre-wake (F1)
    again, _ = c.read(30)
    assert np.array_equal(again, np.arange(20, 50, dtype=np.int16))  # rend la "phrase" passee


def test_ring_rewind_clamped_to_window():
    r = RingBuffer(100)              # fenetre de 100 echantillons
    c = r.cursor()
    r.write(np.arange(100, 300, dtype=np.int16))  # 200 ecrits -> plus vieux dispo = pos 100 (valeur 200)
    c.seek_latest()
    c.rewind(10_000)                 # rembobinage demesure -> borne au plus vieux dispo
    data, _ = c.read(1000)
    assert len(data) == 100
    assert data[0] == 200            # exactement le plus vieux encore en fenetre


# ── Consommateur lent/mort : overrun = drop-oldest, l'ecrivain jamais bloque ─
def test_ring_slow_consumer_overrun_drops_oldest():
    r = RingBuffer(100)
    slow = r.cursor()                # cree AVANT l'ecriture (pos 0)
    r.write(np.arange(250, dtype=np.int16))  # 250 > capacite 100 -> le lent est distance
    data, overrun = slow.read(1000)
    assert overrun == 150            # 250 - 100 : les 150 plus vieux ont ete sautes
    assert len(data) == 100
    assert data[0] == 150            # ne restent que les 100 plus recents (150..249)
    assert data[-1] == 249


def test_ring_writer_never_blocks_on_dead_consumer():
    r = RingBuffer(100)
    _dead = r.cursor()               # un consommateur qui ne lira JAMAIS
    # l'ecrivain ecrit bien plus que la capacite : il ne doit jamais bloquer ni lever
    for _ in range(1000):
        r.write(np.ones(160, dtype=np.int16))
    assert r.write_pos() == 1000 * 160  # tout a ete ecrit, aucun blocage


# ── Concurrence SPMC : 1 ecrivain + 3 lecteurs, coherence + aucun blocage ────
def test_ring_concurrent_spmc_coherent():
    r = RingBuffer(4096)
    n_blocks = 400                   # valeurs 0..399 (< 32768, pas de wrap int16)
    done = threading.Event()
    errors = []

    def writer():
        for k in range(n_blocks):
            r.write(np.full(160, k, dtype=np.int16))
            time.sleep(0.0002)
        done.set()

    def reader():
        c = r.cursor()
        last = -1
        try:
            while not done.is_set() or c.available() > 0:
                data, _ = c.read(512)
                for v in data:
                    # invariant SPMC : un lecteur ne voit JAMAIS une valeur plus ancienne apres une plus recente
                    assert v >= last, f"regression {v} < {last}"
                    last = int(v)
                if not data.size:
                    time.sleep(0.0003)
        except AssertionError as e:
            errors.append(str(e))

    ths = [threading.Thread(target=reader) for _ in range(3)]
    w = threading.Thread(target=writer)
    for t in ths:
        t.start()
    w.start()
    w.join(timeout=10)
    for t in ths:
        t.join(timeout=10)
    assert done.is_set(), "l'ecrivain n'a pas fini -> il a ete bloque"
    assert not errors, f"incoherence de lecture concurrente : {errors}"


# ── Patron de prise : le contrat consomme le ring et emet des evt.* normalises ─
def test_consumer_plug_contract():
    r = RingBuffer(2000)
    events = []
    lock = threading.Lock()
    seen = {"n": 0}

    def emit(etype, payload):
        with lock:
            events.append((etype, payload))

    class CountPlug(ConsumerPlug):
        def process(self, data):
            with lock:
                seen["n"] += len(data)

    plug = CountPlug("test", r, emit, hop_samples=160)
    plug.start()
    for k in range(20):
        r.write(np.full(160, k % 100, dtype=np.int16))
        time.sleep(0.002)
    time.sleep(0.05)
    plug.stop()
    # le moteur (ici un compteur) a bien recu de l'audio via le contrat, dans son thread dedie
    assert seen["n"] > 0


# ══════════ Robustesse — corrections du croisé 2 agents (conv 39) ══════════

def test_ring_capacity_fractional_guard():
    # R#7 : la garde `> 0` doit voir la valeur APRES int() (RingBuffer(0.5) -> cap 0 -> refuse, jamais ZeroDivision)
    with pytest.raises(ValueError):
        RingBuffer(0.5)


def test_ring_capacity_one():
    # R#6 : capacite degeneree = 1 -> ne garde que le plus recent, aucun crash
    r = RingBuffer(1)
    r.write(np.array([5, 6, 7], dtype=np.int16))
    d, _ = r.cursor(at_latest=False).read(10)
    assert list(d) == [7]


def test_ring_captured_at_deterministic_and_ms():
    # Fid#2 / R#5 : captured_at DETERMINISTE (meme pos -> meme valeur apres un write) ET en MILLISECONDES
    r = RingBuffer(16000 * 5)
    r.write(np.zeros(160, dtype=np.int16), at_mono=100.0)   # 1er bloc, marque a t=100 s (pos 0)
    t1 = r.time_at(150)                                     # un echantillon du 1er bloc
    r.write(np.zeros(160, dtype=np.int16), at_mono=101.0)   # un 2e write plus tard
    t2 = r.time_at(150)                                     # MEME pos
    assert t1 == t2                                         # deterministe (ne bouge PLUS)
    assert abs(t1 - (100.0 + 150 / 16000) * 1000) < 0.01    # en MS, ancre sur la capture du bloc


def test_capture_unique_via_injected_source_reaches_ring():
    # Fid#1 : la CAPTURE UNIQUE (1re clause du Fait-quand V0) via le seam source_factory : start() une fois,
    # et un bloc traverse capture -> conversion -> ring.
    r = RingBuffer(16000 * 2)
    src_holder = {}

    def factory(on_raw, on_ov):
        s = _FakeSource(on_raw, on_ov)
        src_holder["s"] = s
        return s

    cap = AudioCapture(r, source_factory=factory)
    cap.start()
    assert src_holder["s"].starts == 1                     # capture UNIQUE : le micro est ouvert une seule fois
    src_holder["s"].on_raw(np.full(320, 1000, dtype=np.int16), 1, 16000, 5.0)  # deja a 16 k -> pas de resample
    _drain(r, 320)
    cap.stop()
    assert r.write_pos() == 320                            # le bloc a bien traverse jusqu'au ring
    assert src_holder["s"].stops == 1


def test_capture_resample_streaming_matches_oneshot():
    # R#2 : le reechantillonnage STREAMING (soxr, par blocs) doit egaler le one-shot -> aucune discontinuite
    # de bord (contraste : le resample par-bloc de scipy divergeait de ~1745 sur ampl. 10000, recoupe conv 39).
    import soxr
    r = RingBuffer(16000 * 3)
    src_holder = {}
    cap = AudioCapture(r, source_factory=lambda a, b: src_holder.setdefault("s", _FakeSource(a, b)))
    cap.start()
    sr = 44100
    t = np.arange(sr) / sr
    sig16 = (np.sin(2 * np.pi * 440 * t) * 10000).astype(np.int16)
    blk = int(0.033 * sr)
    for i in range(0, len(sig16), blk):
        src_holder["s"].on_raw(sig16[i:i + blk], 1, sr, 0.0)
    _drain(r, 15000, timeout=2.0)
    cap.stop()
    got, _ = r.cursor(at_latest=False).read(10 ** 7)
    ref = soxr.resample(sig16.astype(np.float32), sr, 16000)   # meme moteur, one-shot = reference de continuite
    n = min(len(got), len(ref))
    assert n > 10000
    d = np.abs(got[200:n].astype(np.float32) - ref[200:n])
    assert d.mean() < 50, f"streaming != one-shot (moy={d.mean()}) -> discontinuite"


def test_wasapi_source_frees_pyaudio_on_failed_start():
    # R#1 : si start() echoue a mi-chemin (device invalide), PyAudio est LIBERE (pas de Pa_Initialize orphelin)
    src = WasapiMicSource(lambda *a: None, device_index=999999)
    with pytest.raises(Exception):
        src.start()
    assert src._pa is None
    assert src._started is False


def test_wasapi_source_refuses_double_start():
    # R#8 : un 2e start() ne doit JAMAIS ouvrir un 2e stream (un seul ecrivain, invariant SPMC)
    src = WasapiMicSource(lambda *a: None)
    src._started = True                # simule un stream deja actif
    src.start()                        # garde -> retour immediat, aucun import/ouverture
    assert src._stream is None


def test_consumer_plug_survives_process_exception():
    # R#6 / Fid#5 : un moteur qui LEVE a chaque bloc ne tue pas la boucle de la prise (ni les autres)
    r = RingBuffer(4000)
    seen = {"n": 0}
    lock = threading.Lock()

    class Boom(ConsumerPlug):
        def process(self, data):
            with lock:
                seen["n"] += 1
            raise RuntimeError("moteur casse")

    p = Boom("boom", r, lambda *a: None, hop_samples=160)
    p.start()
    for k in range(10):
        r.write(np.full(160, k, dtype=np.int16))
        time.sleep(0.003)
    time.sleep(0.05)
    p.stop()
    assert seen["n"] > 1                # la boucle a survecu a l'exception et a rappele process


def test_consumer_plug_signals_overrun_as_evt():
    # Fid#5 : un consommateur distance SIGNALE evt.plug.overrun (dans la famille evt.*)
    r = RingBuffer(100)
    events = []
    lock = threading.Lock()

    def emit(t, p):
        with lock:
            events.append((t, p))

    p = ConsumerPlug("t", r, emit, hop_samples=200)   # curseur cree ICI (pos 0)
    r.write(np.ones(250, dtype=np.int16))             # 250 > cap 100 -> le curseur du plug sera distance
    p.start()
    time.sleep(0.05)
    p.stop()
    over = [e for e in events if e[0] == "evt.plug.overrun"]
    assert over and over[0][1]["dropped"] > 0


# ══════════ Robustesse — corrections du RE-CROISÉ (conv 39) ══════════

def test_capture_start_refuses_second_writer():
    # C#1 : un 2e start() sans stop() ne cree PAS un 2e thread ecrivain (le refactor a deplace l'ecrivain
    # vers le thread de conversion -> l'invariant SPMC « un seul ecrivain » se garde ICI, pas au stream).
    r = RingBuffer(16000)
    holder = {}
    cap = AudioCapture(r, source_factory=lambda a, b: holder.setdefault("s", _FakeSource(a, b)))
    cap.start()
    cap.start()   # 2e start sans stop
    n = sum(1 for t in threading.enumerate() if t.name == "audio-convert" and t.is_alive())
    cap.stop()
    assert n == 1


def test_capture_stop_resets_conversion_state():
    # C#2 : stop() reinitialise le resampler + vide la file -> pas d'audio perime rejoue au restart
    r = RingBuffer(16000 * 3)
    holder = {}
    cap = AudioCapture(r, source_factory=lambda a, b: holder.setdefault("s", _FakeSource(a, b)))
    cap.start()
    sr = 44100
    blk = int(0.033 * sr)
    for _ in range(10):
        holder["s"].on_raw(np.zeros(blk, dtype=np.int16), 1, sr, 0.0)   # cree le resampler soxr
    time.sleep(0.15)
    cap.stop()
    assert cap._resampler is None and cap._res_rate is None and cap._q.qsize() == 0


def test_capture_conversion_errors_counted():
    # C#3 : une erreur de l'etage de conversion est COMPTEE (jamais en silence, parite avec le chemin RT)
    class BadRing:
        sample_rate = 16000

        def write(self, pcm, at_mono=None):
            raise RuntimeError("write casse")

    holder = {}
    cap = AudioCapture(BadRing(), source_factory=lambda a, b: holder.setdefault("s", _FakeSource(a, b)))
    cap.start()
    holder["s"].on_raw(np.zeros(100, dtype=np.int16), 1, 16000, 0.0)   # 16k -> pas de resample -> ring.write leve
    time.sleep(0.1)
    cap.stop()
    assert cap.stats["convert_errors"] >= 1


def test_consumer_plug_stop_bounded_and_signals_stuck():
    # NIT re-croise : un moteur bloque dans process() -> stop() BORNE (ne gele pas) + evt.plug.stuck signale
    r = RingBuffer(4000)
    events = []
    lock = threading.Lock()
    gate = threading.Event()

    def emit(t, p):
        with lock:
            events.append((t, p))

    class Stuck(ConsumerPlug):
        def process(self, data):
            gate.wait()   # bloque jusqu'a ce qu'on relache (simule une inference figee)

    p = Stuck("stuck", r, emit, hop_samples=160)
    p.start()
    r.write(np.zeros(160, dtype=np.int16))   # declenche process -> bloque
    time.sleep(0.05)
    t0 = time.time()
    p.stop()                                 # join borne (1 s) -> ne doit pas geler
    elapsed = time.time() - t0
    gate.set()                               # relache le thread (nettoyage)
    assert elapsed < 2.0
    assert any(e[0] == "evt.plug.stuck" for e in events)


def test_stop_audio_idempotent_under_concurrency():
    # S#1 : deux _stop_audio concurrents -> UN SEUL cap.stop() (dict.pop atomique, pas de terminate concurrent)
    import server

    calls = {"n": 0}
    lock = threading.Lock()

    class SlowCap:
        def stop(self):
            with lock:
                calls["n"] += 1
            time.sleep(0.1)   # simule un terminate() lent

    server._audio["ring"] = object()
    server._audio["capture"] = SlowCap()
    ths = [threading.Thread(target=server._stop_audio) for _ in range(2)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    assert calls["n"] == 1
    assert server._audio.get("capture") is None
