"""Sophia — sidecar / chemin audio (plan 01, V0) : CAPTURE UNIQUE du micro -> conversion 16 kHz mono -> ring.

Le sidecar ouvre le micro UNE fois (capture unique, V0). Le callback temps-reel PortAudio est MINIMAL : il
copie les frames brutes dans une file, AUCUN calcul lourd sur le thread audio (R#2, croise conv 39). La
conversion (mono + reechantillonnage STREAMING A ETAT via soxr) se fait dans un thread DEDIE -> pas de
transitoire de bord a chaque frontiere de bloc, pas de FIR redessine par bloc, pas de risque de
paInputOverflow sous charge. Chaque bloc 16 kHz mono int16 est ecrit dans le RingBuffer, ou les
consommateurs le lisent avec leur propre curseur. Le loopback systeme (reference AEC) s'ajoute a V1.

Imports pyaudiowpatch/soxr PARESSEUX (au start) : `to_16k_mono` (pur) et les tests restent utilisables
sans peripherique audio.
"""
from __future__ import annotations

import queue
import threading
import time
from math import gcd
from typing import Callable

import numpy as np
from scipy.signal import resample_poly


def to_16k_mono(interleaved_i16: np.ndarray, src_rate: int, n_channels: int) -> np.ndarray:
    """Conversion PURE ONE-SHOT (un bloc COMPLET isole -> 16 kHz mono int16) : pour du one-shot (rejeu d'un
    fichier, tests). NE PAS l'appeler par bloc sur un FLUX (transitoires de bord) -> le flux passe par
    AudioCapture (soxr streaming a etat). Mono = moyenne des canaux ; reechantillonnage = resample_poly."""
    x = np.ascontiguousarray(interleaved_i16).reshape(-1).astype(np.float32)
    if n_channels > 1:
        usable = (x.shape[0] // n_channels) * n_channels   # tronque un bloc partiel -> jamais de reshape KO
        x = x[:usable].reshape(-1, n_channels).mean(axis=1)
    if int(src_rate) != 16000 and x.shape[0]:
        g = gcd(int(src_rate), 16000)
        x = resample_poly(x, 16000 // g, int(src_rate) // g)
    return np.clip(np.round(x), -32768, 32767).astype(np.int16)


def to_mono_f32(interleaved_i16: np.ndarray, n_channels: int) -> np.ndarray:
    """int16 entrelace -> float32 MONO (moyenne des canaux ; tronque un bloc partiel). Etape 1 du flux ;
    le reechantillonnage streaming (soxr) suit dans AudioCapture."""
    x = np.ascontiguousarray(interleaved_i16).reshape(-1).astype(np.float32)
    if n_channels > 1:
        usable = (x.shape[0] // n_channels) * n_channels
        x = x[:usable].reshape(-1, n_channels).mean(axis=1)
    return x


# on_raw(interleaved_i16, n_channels, src_rate, at_mono) ; on_overflow(status)
OnRaw = Callable[[np.ndarray, int, int, float], None]
OnOverflow = Callable[[int], None]


class WasapiMicSource:
    """Source = micro par defaut (WASAPI partage). Callback RT MINIMAL (copie brute + horodatage d'arrivee),
    SIGNALE les input-overflow (R#3), aucun calcul lourd. `start()` libere PyAudio si l'ouverture echoue a
    mi-chemin (R#1, le chemin « pas de micro » que la conception revendique) et refuse un second demarrage
    (R#8 : un seul ecrivain = invariant SPMC)."""

    def __init__(self, on_raw: OnRaw, on_overflow: OnOverflow | None = None,
                 device_index: int | None = None, frames_per_buffer: int = 1600):
        self._on_raw = on_raw
        self._on_overflow = on_overflow
        self._device_index = device_index
        self._frames = int(frames_per_buffer)
        self._pa = None
        self._stream = None
        self._channels = 1
        self._rate = 16000
        self._started = False

    def start(self) -> None:
        if self._started:
            return   # R#8 : jamais un second stream (un seul ecrivain)
        import pyaudiowpatch as pyaudio   # import PARESSEUX (aucun peripherique requis pour importer ce module)
        try:
            self._pa = pyaudio.PyAudio()
            if self._device_index is None:
                info = self._pa.get_default_input_device_info()
                self._device_index = int(info["index"])
            else:
                info = self._pa.get_device_info_by_index(self._device_index)
            self._channels = max(1, int(info["maxInputChannels"]) or 1)
            self._rate = int(info["defaultSampleRate"])

            def _cb(in_data, frame_count, time_info, status):
                try:
                    if status and self._on_overflow is not None:
                        self._on_overflow(int(status))   # R#3 : perte cote capture (input overflow) SIGNALEE
                    t_cap = time.monotonic()             # temps d'arrivee du bloc (ADC precis = raffinement V1)
                    block = np.frombuffer(in_data, dtype=np.int16)
                    self._on_raw(block, self._channels, self._rate, t_cap)
                except Exception:
                    pass   # un bloc fautif ne tue jamais le flux RT
                return (None, pyaudio.paContinue)

            self._stream = self._pa.open(
                format=pyaudio.paInt16, channels=self._channels, rate=self._rate,
                input=True, input_device_index=self._device_index,
                frames_per_buffer=self._frames, stream_callback=_cb,
            )
            self._stream.start_stream()
            self._started = True
        except Exception:
            self.stop()   # R#1 : liberer PyAudio (Pa_Initialize) meme si l'ouverture echoue
            raise

    @property
    def src_rate(self) -> int:
        return self._rate

    @property
    def src_channels(self) -> int:
        return self._channels

    def stop(self) -> None:
        try:
            if self._stream is not None:
                self._stream.stop_stream()
                self._stream.close()
        except Exception:
            pass
        finally:
            self._stream = None
            if self._pa is not None:
                try:
                    self._pa.terminate()
                except Exception:
                    pass
                self._pa = None
            self._started = False


class AudioCapture:
    """Relie une source (micro par defaut, ou une source injectee en test) au RingBuffer : le callback RT
    empile les blocs bruts (copie), un thread DEDIE convertit (mono + reechantillonnage streaming a etat
    soxr) et ecrit le ring. `source_factory(on_raw, on_overflow)` est injectable -> vrai micro en prod, faux
    en test (sans peripherique)."""

    def __init__(self, ring, device_index: int | None = None,
                 source_factory: Callable[[OnRaw, OnOverflow], object] | None = None,
                 queue_max: int = 64):
        self._ring = ring
        self._q: queue.Queue = queue.Queue(maxsize=int(queue_max))
        self._dropped_full = 0      # blocs bruts droppes : la file est pleine (thread de conversion en retard)
        self._src_overflow = 0      # input-overflow WASAPI signales par le driver (R#3)
        self._convert_errors = 0    # C#3 (re-croise) : erreurs de l'etage de conversion (jamais en silence)
        self._resampler = None
        self._res_rate: int | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._source = (source_factory
                        or (lambda on_raw, on_ov: WasapiMicSource(on_raw, on_ov, device_index))
                        )(self._on_raw, self._on_overflow)

    def _on_overflow(self, status: int) -> None:
        self._src_overflow += 1

    def _on_raw(self, interleaved_i16: np.ndarray, n_channels: int, src_rate: int, at_mono: float) -> None:
        # cote RT : juste empiler une COPIE (aucun calcul lourd, R#2). File pleine = conversion en retard -> drop signale.
        try:
            self._q.put_nowait((np.array(interleaved_i16, dtype=np.int16), n_channels, src_rate, at_mono))
        except queue.Full:
            self._dropped_full += 1

    def _convert_loop(self) -> None:
        import soxr   # import PARESSEUX
        while not self._stop.is_set():
            try:
                block, n_ch, src_rate, at_mono = self._q.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                mono = to_mono_f32(block, n_ch)
                if int(src_rate) != 16000:
                    if self._resampler is None or self._res_rate != int(src_rate):
                        self._resampler = soxr.ResampleStream(int(src_rate), 16000, 1, dtype="float32")
                        self._res_rate = int(src_rate)
                    out = self._resampler.resample_chunk(mono)   # STREAMING : garde l'etat -> continuite (R#2)
                else:
                    out = mono
                if out.size:
                    pcm = np.clip(np.round(out), -32768, 32767).astype(np.int16)
                    self._ring.write(pcm, at_mono=at_mono)
            except Exception:
                self._convert_errors += 1   # C#3 : ne plus echouer en SILENCE (parite avec les compteurs RT)

    @property
    def stats(self) -> dict:
        return {"dropped_full": self._dropped_full, "src_overflow": self._src_overflow,
                "convert_errors": self._convert_errors}

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return   # C#1 (re-croise) : jamais un 2e thread de conversion -> l'ECRIVAIN du ring reste unique (SPMC)
        # source d'abord : si elle leve (pas de micro), aucun thread n'est lance -> rien a nettoyer (R#1).
        self._source.start()
        self._stop.clear()
        self._thread = threading.Thread(target=self._convert_loop, name="audio-convert", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        try:
            self._source.stop()
        finally:
            self._stop.set()
            t = self._thread
            if t is not None:
                t.join(timeout=1.0)
            self._thread = None
            # C#2 (re-croise) : reinitialiser l'etat de conversion -> un start() ulterieur ne rejoue pas de
            # l'audio perime (vieux blocs en file) ni un resampler contamine (etat FIR de la session precedente).
            self._resampler = None
            self._res_rate = None
            try:
                while True:
                    self._q.get_nowait()
            except queue.Empty:
                pass
