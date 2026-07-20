"""U-V11 (plan 01) — RESIDENCE DES MODELES cote sidecar : la politique (parse/resolve), la mesure VRAM, le
repli CPU (load_with_fallback), et la remontee evt.model.loaded/unloaded de la prise STT.

Le CONTRAT complet (cmd.model.policy enregistree + /debug, evt.model.* emit->bus->WS) est prouve en coeur reel
par l'E2E `e2e-v11`. Ici : la LOGIQUE, deterministe, sans GPU (moteurs scriptes).
"""
import threading
import time

import numpy as np
import pytest

from audio.models import load_with_fallback, parse_policy, resolve_stt_device, vram_snapshot
from audio.ring import RingBuffer
from consumers.stt import SttEngine, SttPlug

RATE = 16000


def _collect():
    events, lock = [], threading.Lock()

    def emit(etype, payload):
        with lock:
            events.append((etype, dict(payload)))
    return events, emit


def _ring_at(write_samples: int) -> RingBuffer:
    ring = RingBuffer(RATE * 120)
    ring.write(np.zeros(write_samples, dtype=np.int16))
    return ring


def _wait(pred, timeout: float = 2.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.01)
    return pred()


# ══════════ La POLITIQUE (parse_policy / resolve_stt_device) — fonctions PURES ══════════

def test_parse_policy_normalise():
    assert parse_policy({"group": "veille", "layers": {"jeu": True}}) == \
        {"group": "veille", "layers": {"secours": False, "jeu": True}}
    assert parse_policy({"group": "conversation", "layers": {"secours": True, "jeu": True}}) == \
        {"group": "conversation", "layers": {"secours": True, "jeu": True}}


def test_parse_policy_defauts_surs():
    # group absent/invalide -> « conversation » (le set COMPLET : jamais sous-provisionner par accident)
    assert parse_policy({})["group"] == "conversation"
    assert parse_policy({"group": "bidon"})["group"] == "conversation"
    assert parse_policy(None)["group"] == "conversation"
    # layers absents/malformes -> False
    assert parse_policy({"layers": "pasundict"})["layers"] == {"secours": False, "jeu": False}


def test_resolve_stt_device():
    assert resolve_stt_device({"layers": {"jeu": True}}) == "cpu"     # JEU : le GPU va au jeu (05 §2.2)
    assert resolve_stt_device({"layers": {"jeu": False}}) == "cuda"
    assert resolve_stt_device({}) == "cuda"                            # defaut : cuda


# ══════════ La mesure VRAM (sonde d'observabilite, best-effort) ══════════

def test_vram_snapshot_never_raises():
    v = vram_snapshot()                          # None sans CUDA (CI/CPU) ; un entier Mo avec CUDA
    assert v is None or (isinstance(v, int) and v >= 0)


# ══════════ Le repli CPU (load_with_fallback) — le durcissement « refus VRAM -> degrade, jamais de crash » ══════════

def test_load_with_fallback_cuda_ok():
    obj, dev, degraded = load_with_fallback(lambda d: ("model", d), "cuda")
    assert dev == "cuda" and degraded is False and obj == ("model", "cuda")


def test_load_with_fallback_cuda_refuse_repli_cpu():
    def _load(dev):
        if dev == "cuda":
            raise RuntimeError("CUDA out of memory")   # le GPU refuse d'allouer (sature / absent)
        return "cpu-model"
    obj, dev, degraded = load_with_fallback(_load, "cuda")
    assert dev == "cpu" and degraded is True and obj == "cpu-model"   # -> repli CPU, marque DEGRADE


def test_load_with_fallback_les_deux_echouent_releve():
    def _load(dev):
        raise RuntimeError(f"echec {dev}")           # ni GPU ni CPU (ex. modele absent)
    with pytest.raises(RuntimeError):                 # re-leve -> l'appelant degrade honnetement (worker : unloaded)
        load_with_fallback(_load, "cuda")


def test_load_with_fallback_cpu_demande_pas_de_boucle():
    def _load(dev):
        raise ValueError("cpu ko")                    # device demande = cpu -> PAS de repli (pas de boucle infinie)
    with pytest.raises(ValueError):
        load_with_fallback(_load, "cpu")


# ══════════ La remontee de residence de la prise STT (evt.model.loaded / unloaded) ══════════

class _OkEngine(SttEngine):
    """Moteur scripte : `warm()` pose un load_info donne (pas de GPU). transcribe muet (ring vide)."""
    def __init__(self, load_info):
        self._li = load_info

    def warm(self):
        self.load_info = self._li

    def transcribe(self, audio, beam_size=5, word_ts=False):
        return "", [], 1.0


def test_stt_emits_model_loaded_at_start_and_unloaded_at_stop():
    ring = _ring_at(RATE)
    events, emit = _collect()
    plug = SttPlug(ring, emit, engine=_OkEngine({"device": "cuda", "vram_mb": 2100, "degraded": False}))
    plug.start()
    try:
        assert _wait(lambda: any(t == "evt.model.loaded" for t, _ in events)), "evt.model.loaded jamais emis"
        loaded = [p for t, p in events if t == "evt.model.loaded"]
        assert loaded[0] == {"model": "stt", "device": "cuda", "vram_mb": 2100, "degraded": False}
    finally:
        plug.stop()
    unloaded = [p for t, p in events if t == "evt.model.unloaded"]
    assert unloaded and unloaded[-1]["reason"] == "stop"   # l'arret annonce la sortie de residence


def test_stt_reports_degraded_on_cpu_fallback():
    # Le repli CPU (moteur qui replie via load_with_fallback) est REMONTE degrade=True -> le gouverneur/voyant le savent.
    class _FallbackEngine(SttEngine):
        def warm(self):
            def _load(dev):
                if dev == "cuda":
                    raise RuntimeError("cuda refuse")
                return object()
            _m, device, degraded = load_with_fallback(_load, "cuda")
            self.load_info = {"device": device, "vram_mb": 0, "degraded": degraded}

        def transcribe(self, audio, beam_size=5, word_ts=False):
            return "", [], 1.0

    ring = _ring_at(RATE)
    events, emit = _collect()
    plug = SttPlug(ring, emit, engine=_FallbackEngine())
    plug.start()
    try:
        assert _wait(lambda: any(t == "evt.model.loaded" for t, _ in events))
        loaded = [p for t, p in events if t == "evt.model.loaded"][0]
        assert loaded["device"] == "cpu" and loaded["degraded"] is True
    finally:
        plug.stop()


def test_stt_load_failed_emits_unloaded_and_worker_survives():
    # LE DURCISSEMENT : les DEUX devices echouent (modele absent) -> le worker NE CRASHE PAS, il compte l'erreur et
    # ANNONCE la non-residence (evt.model.unloaded reason=load-failed). Jamais une mort silencieuse.
    class _DeadEngine(SttEngine):
        def warm(self):
            raise RuntimeError("modele absent")

        def transcribe(self, audio, beam_size=5, word_ts=False):
            return "", [], 1.0

    ring = _ring_at(RATE)
    events, emit = _collect()
    plug = SttPlug(ring, emit, engine=_DeadEngine())
    plug.start()
    try:
        assert _wait(lambda: any(t == "evt.model.unloaded" for t, _ in events)), "echec de load non annonce"
        unloaded = [p for t, p in events if t == "evt.model.unloaded"]
        assert unloaded[0]["reason"] == "load-failed"
        assert plug.state["engine_errors"] >= 1          # l'erreur est COMPTEE (jamais avalee)
        assert any(t == "evt.model.loaded" for t, _ in events) is False   # jamais « loaded » sur un echec
    finally:
        plug.stop()   # idempotent : stop apres load-failed n'emet pas un 2e unloaded (model_loaded deja False)
    assert [p["reason"] for t, p in events if t == "evt.model.unloaded"] == ["load-failed"]


def test_no_model_loaded_if_stop_during_warm():
    # ROBUSTESSE (croisé conv 52) : si l'arret T6 tombe PENDANT le warm (~7 s), le worker finit son warm APRES le
    # stop() -> il ne doit PAS annoncer une residence qu'on est deja en train d'arreter (evt.model.loaded orphelin
    # post-stop + model_loaded laisse a True). LE TEST MORD : sans la garde `_stop.is_set()` dans _emit_model_loaded,
    # un evt.model.loaded est emis apres le stop.
    gate = threading.Event()

    class _SlowEngine(SttEngine):
        def warm(self):
            gate.wait(3.0)                       # bloque le worker DANS le warm jusqu'au signal (simule les ~7 s)
            self.load_info = {"device": "cuda", "vram_mb": 1, "degraded": False}

        def transcribe(self, audio, beam_size=5, word_ts=False):
            return "", [], 1.0

    ring = _ring_at(RATE)
    events, emit = _collect()
    plug = SttPlug(ring, emit, engine=_SlowEngine())
    plug.start()
    time.sleep(0.15)                             # le worker est entre dans warm (bloque sur la gate)
    plug.stop()                                  # arret PENDANT le warm (join timeout : le worker est encore bloque)
    gate.set()                                   # libere le warm -> il finit APRES le stop()
    time.sleep(0.3)                              # laisse le worker terminer warm + sortir
    assert not any(t == "evt.model.loaded" for t, _ in events), "evt.model.loaded emis APRES stop (garde _stop absente)"
    assert plug.state["model_loaded"] is False   # jamais annonce comme resident (worker qui sort)
