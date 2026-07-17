"""U-V1 (plan 01) — AEC en tete de chaine : near (micro) + ref (loopback) -> annulation -> ring POST-AEC.

Deterministe, SANS peripherique (le SpeexDSP est du CPU pur -> testable en vrai ; le smoke micro+loopback
reel = etage 3, non-CI). On prouve :
  - EchoCanceller (SpeexDSP, preprocess OFF) : annule l'echo ; preserve la voix en double-parole ;
    passthrough quand la ref est muette (chemin degrade « sans reference ») ;
  - AecCapture : deux sources -> appariement 160-trames -> AEC -> ring ; reste conserve entre blocs ;
    ref starvation -> zeros (jamais de blocage) ; captured_at herite du near ; ecrivain UNIQUE ;
    idempotence du start ; stop reinitialise l'etat ; erreurs de conversion comptees ; loopback optionnel.
"""
import threading
import time

import numpy as np
import pytest

from audio.ring import RingBuffer
from audio.aec import EchoCanceller, FRAME, TAIL
from audio.capture import AecCapture, DeviceWatcher, _loopback_needs_reinit


rng = np.random.default_rng(20260717)


def _rms(x):
    x = np.asarray(x, dtype=np.float64)
    return float(np.sqrt(np.mean(x ** 2))) if x.size else 0.0


def _best_corr(a, b, maxlag=400):
    """Correlation normalisee MAX sur +/-maxlag -> ROBUSTE au delai/phase (l'AEC introduit un petit retard
    de traitement ; une projection a delai zero est fragile — surtout, ne JAMAIS tester sur un ton pur, que
    le filtre adaptatif SpeexDSP traite comme de l'echo periodique previsible ; la vraie voix est large bande)."""
    a = np.asarray(a, np.float64); b = np.asarray(b, np.float64)
    m = min(len(a), len(b))
    a = a[:m] - a[:m].mean(); b = b[:m] - b[:m].mean()
    if a.std() < 1 or b.std() < 1:
        return 0.0
    best = 0.0
    for lag in range(-maxlag, maxlag + 1, 4):
        x, y = (a[lag:], b[:m - lag]) if lag >= 0 else (a[:m + lag], b[-lag:])
        if len(x) > 1000:
            best = max(best, abs(np.dot(x, y)) / (np.linalg.norm(x) * np.linalg.norm(y) + 1e-9))
    return best


def _echo_path(farend):
    """Chemin d'echo synthetique : delai ~10 ms (conv 22) + attenuation + reverb courte."""
    ir = np.zeros(int(0.05 * 16000), dtype=np.float64)
    ir[0] = 0.6; ir[int(0.010 * 16000)] = 0.4; ir[int(0.03 * 16000)] = 0.15
    e = np.convolve(np.asarray(farend, dtype=np.float64), ir)[:len(farend)]
    return np.clip(e, -32768, 32767).astype(np.int16)


def _run_canceller(near_i16, ref_i16, pre=False):
    ec = EchoCanceller(enable_preprocess=pre)
    m = (min(len(near_i16), len(ref_i16)) // FRAME) * FRAME
    out = np.empty(m, dtype=np.int16)
    for s in range(0, m, FRAME):
        out[s:s + FRAME] = ec.process(near_i16[s:s + FRAME], ref_i16[s:s + FRAME])
    return out


class _FakeDuplex:
    """Source duplex injectable (sans peripherique) : on pousse near/ref a la main + compte les start/stop.
    `loopback_ok` simule la presence (ou non) du loopback."""

    def __init__(self, on_near, on_ref, on_overflow, loopback_ok=True):
        self.on_near = on_near
        self.on_ref = on_ref
        self.on_overflow = on_overflow
        self.loopback_ok = loopback_ok
        self.starts = 0
        self.stops = 0

    def loopback_active(self):
        return self.loopback_ok   # fake : « actif » = loopback present

    def start(self):
        self.starts += 1

    def stop(self):
        self.stops += 1


def _factory(holder, loopback_ok=True):
    def make(on_near, on_ref, on_overflow):
        s = _FakeDuplex(on_near, on_ref, on_overflow, loopback_ok=loopback_ok)
        holder["s"] = s
        return s
    return make


def _wait_writes(ring, target, timeout=2.0):
    t0 = time.time()
    while ring.write_pos() < target and time.time() - t0 < timeout:
        time.sleep(0.005)


# ── EchoCanceller (SpeexDSP reel) ───────────────────────────────────────────
def test_canceller_cancels_echo():
    # near = echo pur du far-end, ref = far-end -> apres convergence, le nettoye s'effondre (ERLE eleve)
    farend = (rng.standard_normal(16000 * 5) * 6000).astype(np.int16)
    near = _echo_path(farend)
    out = _run_canceller(near, farend)
    half = len(out) // 2
    erle = 20 * np.log10((_rms(near[:len(out)][half:]) + 1e-9) / (_rms(out[half:]) + 1e-9))
    assert erle > 15.0, f"ERLE trop faible ({erle:.1f} dB) — l'echo n'est pas annule"


def test_canceller_preserves_voice_in_doubletalk():
    # near = echo + voix ; apres AEC, la voix RESTE (correlee), l'echo PART (le cas dur, conv 23).
    # Voix = bruit large bande INDEPENDANT du far-end (proxy realiste — jamais un ton pur, cf. _best_corr).
    farend = (rng.standard_normal(16000 * 5) * 6000).astype(np.int16)
    echo = _echo_path(farend)
    voice = (rng.standard_normal(16000 * 5) * 3500).astype(np.int16)   # voix ≠ far-end (decorrelee)
    near = np.clip(echo.astype(np.int32) + voice.astype(np.int32), -32768, 32767).astype(np.int16)
    out = _run_canceller(near, farend)
    half = len(out) // 2
    c_voice = _best_corr(out[half:], voice[:len(out)][half:])
    c_echo = _best_corr(out[half:], echo[:len(out)][half:])
    assert c_voice > 0.5, f"voix perdue en double-parole (corr={c_voice:.2f})"
    assert c_voice > c_echo, f"l'echo domine encore la voix (voix={c_voice:.2f} echo={c_echo:.2f})"


def test_canceller_passthrough_on_silent_ref():
    # ref = zeros (rien ne joue) -> l'AEC laisse passer le proche ~intact (chemin degrade « sans reference »).
    # Proche = bruit large bande (proxy voix reelle ; un ton pur serait attenue par le filtre adaptatif —
    # mesure : bruit ratio ~0,97 vs ton pur ~0,36, la vraie voix passe).
    near = (rng.standard_normal(16000 * 2) * 4000).astype(np.int16)
    ref = np.zeros_like(near)
    out = _run_canceller(near, ref)
    ratio = _rms(out) / (_rms(near[:len(out)]) + 1e-9)
    corr = _best_corr(out, near[:len(out)])
    assert ratio > 0.85 and corr > 0.85, f"le proche est abime sur ref muette (ratio={ratio:.2f} corr={corr:.2f})"


def test_canceller_rejects_wrong_frame_length():
    # #5 (croise conv 40) : une trame != FRAME serait un OOB C dans pyaec (il prend len(rec), pas le 160
    # configure). On REFUSE net -> une erreur Python (comptee en amont), jamais un OOB C silencieux.
    ec = EchoCanceller()
    with pytest.raises(ValueError):
        ec.process(np.zeros(100, dtype=np.int16), np.zeros(100, dtype=np.int16))     # egales mais != FRAME
    with pytest.raises(ValueError):
        ec.process(np.zeros(FRAME, dtype=np.int16), np.zeros(FRAME - 1, dtype=np.int16))  # longueurs differentes
    # la bonne longueur passe (contrat respecte)
    out = ec.process(np.zeros(FRAME, dtype=np.int16), np.zeros(FRAME, dtype=np.int16))
    assert out.shape[0] == FRAME


# ── AecCapture : appariement, ring POST-AEC, robustesse ─────────────────────
def _push_16k(src, arr, role="both"):
    """Pousse un bloc int16 deja a 16 kHz mono (pas de resample) en near et/ou ref."""
    if role in ("both", "near"):
        src.on_near(np.asarray(arr, dtype=np.int16), 1, 16000, 0.0)
    if role in ("both", "ref"):
        src.on_ref(np.asarray(arr, dtype=np.int16), 1, 16000, 0.0)


def test_aec_capture_pairs_and_writes_cleaned():
    r = RingBuffer(16000 * 3)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder))
    cap.start()
    assert holder["s"].starts == 1
    farend = (rng.standard_normal(16000) * 6000).astype(np.int16)
    near = _echo_path(farend)
    # pousse near (echo) et ref (far-end) par blocs de 320 (2 trames)
    for i in range(0, 16000 - 320, 320):
        holder["s"].on_near(near[i:i + 320], 1, 16000, 0.0)
        holder["s"].on_ref(farend[i:i + 320], 1, 16000, 0.0)
    _wait_writes(r, 8000)
    cap.stop()
    st = cap.stats
    assert st["aec_frames"] > 0 and st["ref_frames"] > 0
    assert r.write_pos() > 0
    assert holder["s"].stops == 1


def test_aec_capture_ref_starvation_uses_zeros():
    # near sans ref (loopback silencieux) -> chaque trame appariee avec des zeros, jamais de blocage
    r = RingBuffer(16000 * 2)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder, loopback_ok=False))
    cap.start()
    for _ in range(20):
        _push_16k(holder["s"], np.full(160, 500, dtype=np.int16), role="near")
    _wait_writes(r, 160 * 15)
    cap.stop()
    st = cap.stats
    assert st["ref_starved"] > 0 and st["ref_frames"] == 0
    assert st["loopback_ok"] is False
    assert r.write_pos() >= 160 * 15   # le flux a coule malgre l'absence de reference


def test_aec_capture_remainder_preserved_across_blocks():
    # 100 puis 220 echantillons (non alignes sur 160) -> 320 ecrits (le reste du 1er bloc rejoint le 2e)
    r = RingBuffer(16000)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder))
    cap.start()
    _push_16k(holder["s"], np.zeros(100, dtype=np.int16))
    time.sleep(0.05)
    assert r.write_pos() == 0                     # 100 < 160 -> rien d'ecrit encore (reste conserve)
    _push_16k(holder["s"], np.zeros(220, dtype=np.int16))
    _wait_writes(r, 320)
    cap.stop()
    assert r.write_pos() == 320                   # 100 + 220 = 320 = 2 trames, aucun echantillon perdu


def test_aec_capture_captured_at_from_near():
    # captured_at du ring herite de l'horodatage du NEAR (M2), deterministe
    r = RingBuffer(16000 * 2)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder))
    cap.start()
    holder["s"].on_near(np.zeros(320, dtype=np.int16), 1, 16000, 100.0)   # near a t=100 s
    holder["s"].on_ref(np.zeros(320, dtype=np.int16), 1, 16000, 100.0)
    _wait_writes(r, 320)
    cap.stop()
    t = r.time_at(0)
    assert t is not None and abs(t - 100.0 * 1000.0) < 1.0   # en ms, ancre sur la capture du near


def test_aec_capture_single_writer_refuses_double_start():
    # C#1 : un 2e start() sans stop() ne cree PAS un 2e thread ecrivain (invariant SPMC)
    r = RingBuffer(16000)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder))
    cap.start()
    cap.start()
    n = sum(1 for t in threading.enumerate() if t.name == "aec-convert" and t.is_alive())
    cap.stop()
    assert n == 1


def test_aec_capture_stop_resets_state():
    # C#2 : stop() reinitialise resamplers + tampons + files -> pas d'audio perime au restart
    r = RingBuffer(16000 * 2)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder))
    cap.start()
    for _ in range(5):
        _push_16k(holder["s"], np.full(320, 100, dtype=np.int16))
    time.sleep(0.1)
    cap.stop()
    assert cap._near16.size == 0 and cap._ref16.size == 0
    assert cap._near_clock is None
    assert cap._near_q.qsize() == 0 and cap._ref_q.qsize() == 0
    assert cap._near_stream._res is None and cap._ref_stream._res is None


def test_aec_capture_convert_errors_counted():
    # C#3 : une erreur de l'etage AEC/ecriture est COMPTEE (jamais en silence)
    class BadRing:
        sample_rate = 16000

        def write(self, pcm, at_mono=None):
            raise RuntimeError("write casse")

    holder = {}
    cap = AecCapture(BadRing(), EchoCanceller(), source_factory=_factory(holder))
    cap.start()
    _push_16k(holder["s"], np.zeros(320, dtype=np.int16))
    time.sleep(0.1)
    cap.stop()
    assert cap.stats["convert_errors"] >= 1


# ── Degradation honnete (V1.d, corrige apres mesure live 0.4) : loopback pas ouvert = degrade ─
def test_aec_capture_degraded_when_no_loopback():
    # Le loopback EVENEMENTIEL se tait a l'idle (mesure 0.4 : ref_frames=0 sur 8 s de silence) -> « ref tarie »
    # = « rien ne joue » (NORMAL), indistinguable d'un exclusif. La seule degradation HONNETE = loopback pas
    # ouvert. loopback_ok=False -> degraded ; ref absente mais loopback_ok=True (rien ne joue) -> PAS degraded.
    r = RingBuffer(16000 * 2)
    # (a) loopback absent -> degrade
    h1 = {}
    cap1 = AecCapture(r, EchoCanceller(), source_factory=_factory(h1, loopback_ok=False))
    cap1.start()
    _push_16k(h1["s"], np.full(160, 300, dtype=np.int16), role="near")
    time.sleep(0.05)
    assert cap1.stats["degraded"] is True
    cap1.stop()
    # (b) loopback ouvert mais rien ne joue (near seul) -> PAS degrade (idle normal, pas un faux positif)
    r2 = RingBuffer(16000 * 2)
    h2 = {}
    cap2 = AecCapture(r2, EchoCanceller(), source_factory=_factory(h2, loopback_ok=True))
    cap2.start()
    for _ in range(15):
        _push_16k(h2["s"], np.full(160, 300, dtype=np.int16), role="near")
        time.sleep(0.01)
    st = cap2.stats
    cap2.stop()
    assert st["degraded"] is False and st["ref_starved"] > 0   # idle = ref absente MAIS pas « degrade »


# ── Device-change (V1.c, corrige live conv 40) : decision de RE-INIT, sans peripherique ─
def test_loopback_needs_reinit_decision():
    # fonction PURE : la reference est-elle exploitable ? Sinon -> re-init (recuperation conv 40).
    F = _loopback_needs_reinit
    assert F(True, True) is False     # ouvert + actif -> rien (aucune re-init en regime normal)
    assert F(True, False) is True     # ouvert mais MORT (peripherique eteint, is_active False) -> recuperer
    assert F(False, False) is True    # jamais ouvert / echec -> retry (backoff)
    assert F(False, True) is True     # pas ouvert -> re-init (loop_active True sans loopback_ok = degrade)


def test_device_watcher_calls_tick_periodically():
    # le nouveau DeviceWatcher = un simple battement : `tick` appele en boucle ; un tick qui LEVE ne tue pas
    calls = {"n": 0}

    def tick():
        calls["n"] += 1
        raise RuntimeError("tick casse")   # une exception ne doit pas arreter la surveillance

    w = DeviceWatcher(tick, interval_s=0.01)
    w.start()
    time.sleep(0.1)
    w.stop()
    assert calls["n"] > 3   # a battu plusieurs fois malgre les exceptions


def test_watch_tick_backoff_bounds_reinit_when_loopback_absent():
    # SOLO-1 (audit conv 40) : loopback DURABLEMENT absent (aucune sortie ouvrable) -> le micro VITAL ne doit
    # PAS etre reouvert en boucle (~100 ms de trou par re-init). Le backoff EXPONENTIEL espace vite les
    # tentatives ; sans lui (lineaire cap 8), le micro glitcherait toutes les ~18 s indefiniment.
    from audio.capture import WasapiDuplexSource
    src = WasapiDuplexSource(lambda *a: None, lambda *a: None)
    src._started = True
    src.loopback_ok = False                 # aucune sortie -> le loopback ne s'ouvre jamais
    src._probe_loop_active = lambda: False   # ... et son flux est inactif (M-C : la sonde C, isolee)
    calls = {"n": 0}

    def fake_reinit():
        calls["n"] += 1
        src.loopback_ok = False              # la re-init rouvre le micro (glitch) mais echoue a ouvrir le loopback

    src._reinit_audio = fake_reinit
    for _ in range(100):
        src._watch_tick()
    assert calls["n"] < 10                   # backoff exponentiel -> bien moins de 100 (lineaire cap 8 en donnerait ~12)
    assert src.reopen_attempts == calls["n"]


def test_watch_tick_recovers_and_resets_backoff():
    # SOLO-1 : des que le loopback redevient sain (device revenu), la posture agressive est RETROUVEE
    # (fails/backoff remis a 0) -> une future coupure recupere de nouveau en ~2 s.
    from audio.capture import WasapiDuplexSource
    src = WasapiDuplexSource(lambda *a: None, lambda *a: None)
    src._started = True
    src.loopback_ok = False
    src._fails = 5                           # etat « en echec repete »
    src._backoff = 0
    src._probe_loop_active = lambda: True     # apres la re-init, le loopback est actif (M-C : la sonde C)

    def fake_reinit():
        src.loopback_ok = True               # re-init reussie (sortie retrouvee)

    src._reinit_audio = fake_reinit
    src._watch_tick()
    assert src.reopens == 1
    assert src._fails == 0 and src._backoff == 0   # posture agressive retrouvee


def test_watch_tick_retries_aggressively_when_mic_down():
    # M-A2 (re-croise conv 40) : si la re-init LEVE (le micro VITAL n'a pas pu rouvrir : ex. Focusrite combo
    # entree+sortie eteinte), on retente a CHAQUE tick (entendre prime) -> recuperation en ~1 tick au retour
    # du device. Sans le fix, le backoff exponentiel de SOLO-1 s'appliquait AUSSI ici -> micro sourd ~5 min.
    from audio.capture import WasapiDuplexSource
    src = WasapiDuplexSource(lambda *a: None, lambda *a: None)
    src._started = True
    src.loopback_ok = False
    src._probe_loop_active = lambda: False

    def reinit_raises():
        raise RuntimeError("micro parti (Focusrite combo eteinte)")   # le micro VITAL est DOWN

    src._reinit_audio = reinit_raises
    for _ in range(30):
        src._watch_tick()
    assert src.reopen_attempts >= 28, f"micro DOWN retente trop peu ({src.reopen_attempts}/30) : backoff a tort (M-A2)"
    assert src._backoff == 0       # aucune attente : le micro vital doit revenir des que le device revient


def test_aec_capture_degraded_when_loopback_inactive():
    # V1.d/V1.c : loopback ouvert mais INACTIF (peripherique eteint) -> degrade (source fake -> active suit ok)
    r = RingBuffer(16000)
    h = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(h, loopback_ok=True))
    cap.start()
    _push_16k(h["s"], np.full(160, 100, dtype=np.int16), role="near")
    time.sleep(0.03)
    assert cap.stats["degraded"] is False and cap.stats["loopback_active"] is True   # present+actif
    h["s"].loopback_ok = False                                    # simule l'extinction (loopback mort)
    time.sleep(0.02)
    st = cap.stats
    cap.stop()
    assert st["degraded"] is True and st["loopback_active"] is False   # mort -> degrade honnete


def test_aec_capture_writer_never_blocks_on_full_queue():
    # File pleine (le thread de conversion ne draine pas assez vite) -> drop SIGNALE, jamais de blocage RT
    r = RingBuffer(16000)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder), queue_max=4)
    cap.start()
    # sature la file near tres vite (bien plus que queue_max) — le RT ne doit jamais lever
    for _ in range(200):
        holder["s"].on_near(np.zeros(320, dtype=np.int16), 1, 16000, 0.0)
    cap.stop()
    assert cap.stats["dropped_near"] > 0   # des blocs ont ete droppes (jamais un blocage/exception)


# ── Corrections du croise conv 40 : M-A (ecrivain increvable), M-B (re-calage ref), M-C (use-after-free) ─
def test_aec_capture_writer_survives_convert_exception():
    # M-A : une exception de l'etage conversion (soxr) NE DOIT PAS tuer l'ECRIVAIN UNIQUE du ring (sinon
    # surdite SILENCIEUSE, /health vert -> pas de respawn). Elle est comptee et le thread CONTINUE.
    r = RingBuffer(16000)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder))
    real_convert = cap._near_stream.convert
    boom = {"n": 0}

    def flaky(block, n_ch, sr):
        boom["n"] += 1
        if boom["n"] <= 2:
            raise RuntimeError("glitch conversion (soxr/rate bizarre/MemoryError)")   # les 2 premiers levent
        return real_convert(block, n_ch, sr)                                          # puis ca repart

    cap._near_stream.convert = flaky
    cap.start()
    for _ in range(6):
        holder["s"].on_near(np.full(160, 300, dtype=np.int16), 1, 16000, 0.0)
        holder["s"].on_ref(np.full(160, 300, dtype=np.int16), 1, 16000, 0.0)
        time.sleep(0.02)
    _wait_writes(r, 160, timeout=1.5)
    alive = any(t.name == "aec-convert" and t.is_alive() for t in threading.enumerate())
    st = cap.stats
    cap.stop()
    assert alive, "l'ecrivain unique est MORT sur une exception de conversion (M-A)"
    assert st["convert_errors"] >= 2, f"erreurs de conversion non comptees (M-A) : {st['convert_errors']}"
    assert r.write_pos() > 0, "le flux n'a pas repris apres l'erreur (M-A)"


def test_aec_capture_ref_backlog_bounded_to_tail():
    # M-B : micro qui CALE pendant que le media joue -> la ref prend de l'avance. L'appariement naif
    # near[maintenant]<->ref[VIEILLE] casse l'annulation. On borne l'avance ref a ~la queue de filtre (TAIL) ;
    # sans le fix, ref16 monterait a ~600 ms (9600 ech) >> TAIL (3200) et y resterait.
    r = RingBuffer(16000 * 2)
    holder = {}
    cap = AecCapture(r, EchoCanceller(), source_factory=_factory(holder))
    cap.start()
    for _ in range(60):                      # ~600 ms de ref SEULE (aucun near : le micro cale)
        holder["s"].on_ref(np.full(160, 1000, dtype=np.int16), 1, 16000, 0.0)
    time.sleep(0.2)
    back = cap._ref16.size
    cap.stop()
    assert back <= FRAME + TAIL, f"backlog ref {back} > FRAME+TAIL {FRAME + TAIL} : desync non bornee (M-B)"


def test_loopback_active_reads_cache_not_stream():
    # M-C : loopback_active() ne doit JAMAIS appeler is_active() sur le stream C (use-after-free si un close()
    # concurrent l'a libere : pyaudiowpatch ne remet pas le pointeur a None). Il lit un booleen en CACHE. On
    # pose un stream PIEGE (is_active leve) et on verifie que loopback_active() ne le touche pas.
    from audio.capture import WasapiDuplexSource
    src = WasapiDuplexSource(lambda *a: None, lambda *a: None)

    class TrapStream:
        def is_active(self):
            raise AssertionError("loopback_active() a appele is_active() sur le stream (use-after-free possible)")

    src._loop_stream = TrapStream()
    src._loop_active_cached = True
    assert src.loopback_active() is True     # lit le cache, ne touche PAS le stream piege
    src._loop_active_cached = False
    assert src.loopback_active() is False
    # et la sonde interne, elle, DOIT toucher le stream (sous lock) -> best-effort, avale l'anomalie -> False
    assert src._probe_loop_active() is False
