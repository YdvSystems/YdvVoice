"""Sophia — sidecar / chemin audio : SOURCE SYNTHETIQUE (hook de TEST, jamais en prod).

Simule un micro sans peripherique : un thread genere des blocs (sinus) a `rate`/`channels`, a cadence
reelle, et les livre via `on_raw` -> exerce le VRAI chemin de capture (source -> file -> conversion soxr
-> ring) dans le vrai sidecar, de facon DETERMINISTE (E2E coeur reel V0). Active seulement par
`SIDECAR_AUDIO=test` cote server.py (isole du prod, comme SIDECAR_TEST_HOOKS).
"""
from __future__ import annotations

import threading
import time
from typing import Callable

import numpy as np


class SyntheticToneSource:
    """Meme contrat que WasapiMicSource (start/stop ; livre a on_raw(interleaved_i16, n_channels, rate, at_mono))."""

    def __init__(self, on_raw: Callable, on_overflow: Callable | None = None,
                 rate: int = 48000, channels: int = 1, block_ms: int = 20):
        self._on_raw = on_raw
        self._rate = int(rate)                    # 48 kHz : le cas courant d'un micro -> exerce le resample 48k->16k
        self._channels = int(channels)
        self._block = int(self._rate * block_ms / 1000)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._phase = 0

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="synth-mic", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        period = self._block / self._rate
        while not self._stop.is_set():
            t0 = time.monotonic()
            idx = np.arange(self._phase, self._phase + self._block)
            self._phase += self._block
            tone = (np.sin(2 * np.pi * 440 * idx / self._rate) * 8000).astype(np.int16)
            block = np.repeat(tone, self._channels) if self._channels > 1 else tone
            try:
                self._on_raw(block, self._channels, self._rate, time.monotonic())
            except Exception:
                pass
            dt = period - (time.monotonic() - t0)
            if dt > 0:
                self._stop.wait(dt)

    def stop(self) -> None:
        self._stop.set()
        t = self._thread
        if t is not None:
            t.join(timeout=1.0)
        self._thread = None


class SyntheticDuplexSource:
    """Meme contrat que WasapiDuplexSource (start/stop ; on_near + on_ref), SANS peripherique -> exerce le
    VRAI chemin AEC produit (deux sources -> soxr -> appariement -> AEC -> ring) de facon DETERMINISTE
    (E2E-V1 coeur reel). ref = far-end (bruit large bande fort) ; near = ECHO(far-end) + voix (bruit large
    bande independant, plus faible) -> apres AEC, l'echo doit s'effondrer (ERLE eleve) et la voix rester.
    Active seulement par SIDECAR_AUDIO=test cote server.py (isole du prod)."""

    def __init__(self, on_near: Callable, on_ref: Callable, on_overflow: Callable | None = None,
                 rate: int = 48000, block_ms: int = 20):
        self._on_near = on_near
        self._on_ref = on_ref
        self._rate = int(rate)                    # 48 kHz : exerce le resample 48k->16k des DEUX flux
        self._block = int(self._rate * block_ms / 1000)
        self.loopback_ok = True
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # pre-genere ~5 s de far-end + echo + voix (bouclees) — deterministe
        rng = np.random.default_rng(20260717)
        n = self._rate * 5
        far = (rng.standard_normal(n) * 6000).astype(np.float64)
        d = int(0.010 * self._rate)               # echo : delai ~10 ms + attenuation (0.5)
        echo = np.zeros(n, dtype=np.float64); echo[d:] = far[:n - d] * 0.5
        voice = rng.standard_normal(n) * 1000.0   # voix decorrelee, DISCRETE (echo domine -> ERLE net a l'E2E)
        self._ref = np.clip(far, -32768, 32767).astype(np.int16)
        self._near = np.clip(echo + voice, -32768, 32767).astype(np.int16)
        self._pos = 0

    def loopback_active(self) -> bool:
        return self.loopback_ok   # la source synthetique « livre » toujours la ref quand elle tourne

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="synth-duplex", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        period = self._block / self._rate
        n = len(self._ref)
        while not self._stop.is_set():
            t0 = time.monotonic()
            a, b = self._pos, self._pos + self._block
            if b <= n:
                near_blk, ref_blk = self._near[a:b], self._ref[a:b]
            else:                                  # boucle
                near_blk = np.concatenate([self._near[a:], self._near[:b - n]])
                ref_blk = np.concatenate([self._ref[a:], self._ref[:b - n]])
            self._pos = b % n
            now = time.monotonic()
            try:
                self._on_ref(ref_blk, 1, self._rate, now)
                self._on_near(near_blk, 1, self._rate, now)
            except Exception:
                pass
            dt = period - (time.monotonic() - t0)
            if dt > 0:
                self._stop.wait(dt)

    def stop(self) -> None:
        self._stop.set()
        t = self._thread
        if t is not None:
            t.join(timeout=1.0)
        self._thread = None
        self.loopback_ok = False


class SyntheticSpeechSource:
    """Meme contrat que WasapiDuplexSource (start/stop ; on_near + on_ref ; loopback_ok/loopback_active),
    SANS peripherique -> exerce le VRAI chemin V1 POST-AEC (near+ref -> AEC -> ring) PUIS la prise VAD dans le
    vrai sidecar (E2E-V2 coeur reel, FIDELE A LA PROD : ring POST-AEC -> prise -> bus -> WS). near = PAROLE
    synthetique (source-filtre : impulsions glottiques + formants variables) ; ref = SILENCE (rien ne joue ->
    AEC en passthrough) -> le VRAI Silero declenche des evt.vad.start/stop de facon DETERMINISTE (le sinus/bruit
    des sources V0/V1 ne le declenche PAS).

    Amplitude 0,99 (design-first conv 41) : le passthrough SpeexDSP attenue le large-bande -> a 0,6 seuls 2/5
    seeds franchissaient l'AEC, a 0,99 -> 5/5 (mesure) -> l'E2E passe par le VRAI AEC (POST-AEC, PARITE PROD)
    au lieu de s'isoler sur le chemin V0. 16 kHz (pas 48 k : PRESERVE le declenchement mesure ; le resample
    est deja couvert par e2e:v0/v1). Active seulement par SIDECAR_AUDIO=test-vad (isole du prod)."""

    _VOWELS = ((800, 1200, 2500), (300, 2200, 3000), (350, 800, 2400), (450, 1800, 2600), (500, 900, 2500))

    def __init__(self, on_near: Callable, on_ref: Callable, on_overflow: Callable | None = None,
                 rate: int = 16000, block_ms: int = 20):
        self._on_near = on_near
        self._on_ref = on_ref
        self._rate = int(rate)
        self._block = int(self._rate * block_ms / 1000)
        self.loopback_ok = True
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._buf = self._make_buffer()   # ~4,6 s deterministe : parole / silence / parole / silence (boucle)
        self._pos = 0

    def loopback_active(self) -> bool:
        return self.loopback_ok   # la source synthetique « livre » toujours la ref (silence) quand elle tourne

    def _make_buffer(self) -> np.ndarray:
        from scipy.signal import lfilter   # V0 dep ; import local (source de test seulement)
        rate = self._rate
        rng = np.random.default_rng(20260717)   # graine fixe -> buffer DETERMINISTE

        def formant(x, f, bw):
            r = np.exp(-np.pi * bw / rate); th = 2 * np.pi * f / rate
            return lfilter([1.0 - r], [1.0, -2 * r * np.cos(th), r * r], x)

        def speech(dur):
            n = int(dur * rate)
            f0 = 120 + 20 * np.sin(2 * np.pi * 0.7 * np.arange(n) / rate)   # intonation lente
            ph = np.cumsum(f0 / rate)
            src = (np.mod(ph, 1.0) < 0.05).astype(np.float64)              # impulsions glottiques (harmoniques riches)
            src = src - src.mean() + 0.01 * rng.standard_normal(n)         # + aspiration
            vs = [self._VOWELS[int(i)] for i in rng.integers(0, len(self._VOWELS), max(1, int(dur / 0.15)))]
            seg = n // len(vs); out = np.zeros(n)
            for k, (F1, F2, F3) in enumerate(vs):                          # formants variables = dynamique spectrale
                a, b = k * seg, min(n, (k + 1) * seg); s = src[a:b]
                out[a:b] = formant(s, F1, 80) + 0.5 * formant(s, F2, 100) + 0.3 * formant(s, F3, 120)
            env = 0.6 + 0.4 * np.sin(2 * np.pi * 4 * np.arange(n) / rate)  # enveloppe syllabique ~4 Hz
            out *= env
            return out / (np.max(np.abs(out)) + 1e-9) * 0.99   # amp 0,99 -> franchit l'AEC 5/5 (conv 41)
        sil = lambda d: np.zeros(int(d * rate))
        seq = np.concatenate([speech(1.5), sil(1.0), speech(1.5), sil(0.6)])   # 2 segments -> start/stop x2
        return np.clip(np.round(seq * 32768.0), -32768, 32767).astype(np.int16)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="synth-speech", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        period = self._block / self._rate
        n = len(self._buf)
        zeros = np.zeros(self._block, dtype=np.int16)
        while not self._stop.is_set():
            t0 = time.monotonic()
            a, b = self._pos, self._pos + self._block
            blk = self._buf[a:b] if b <= n else np.concatenate([self._buf[a:], self._buf[:b - n]])
            self._pos = b % n
            now = time.monotonic()
            try:
                self._on_ref(zeros, 1, self._rate, now)     # ref = silence (rien ne joue -> AEC passthrough)
                self._on_near(blk, 1, self._rate, now)      # near = parole synthetique (declenche le VRAI Silero)
            except Exception:
                pass
            dt = period - (time.monotonic() - t0)
            if dt > 0:
                self._stop.wait(dt)

    def stop(self) -> None:
        self._stop.set()
        t = self._thread
        if t is not None:
            t.join(timeout=1.0)
        self._thread = None
        self.loopback_ok = False
