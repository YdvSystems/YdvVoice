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
