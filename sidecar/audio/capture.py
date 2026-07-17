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
from math import gcd, log10
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


# on_near/on_ref(interleaved_i16, n_channels, src_rate, at_mono) ; on_overflow(status)
OnRaw2 = Callable[[np.ndarray, int, int, float], None]


class DeviceWatcher:
    """Battement periodique (thread daemon) : appelle `tick()` toutes les `interval_s`. La LOGIQUE de decision
    (faut-il re-ouvrir le loopback ?) vit dans le tick de la source ; ici, juste l'horloge. Une exception dans
    le tick ne tue jamais la surveillance. Mecanisme = POLL (mesure 0.5 : comtypes/pycaw absents -> pas
    d'IMMNotificationClient sans dependance COM ; ~2 s de latence acceptables pour un evenement rare)."""

    def __init__(self, tick: Callable[[], None], interval_s: float = 2.0):
        self._tick = tick
        self._interval = float(interval_s)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="device-watch", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self._tick()
            except Exception:
                pass   # un tick qui trebuche ne tue pas la surveillance

    def stop(self) -> None:
        self._stop.set()
        t = self._thread
        if t is not None:
            t.join(timeout=1.0)
        self._thread = None


def _loopback_needs_reinit(loopback_ok: bool, loop_active: bool) -> bool:
    """La reference (loopback) est-elle exploitable ? PUR -> testable sans peripherique. Elle ne l'est PAS si
    elle n'a pas pu s'ouvrir (loopback_ok False) OU si son flux est MORT (peripherique eteint -> is_active
    False, signal PROUVE fiable conv 40). Ouvert + actif -> False : aucune re-init en regime normal."""
    return not (loopback_ok and loop_active)


class WasapiDuplexSource:
    """Source V1 : near = micro par defaut · ref = LOOPBACK systeme entier (tout ce que le PC joue).

    UNE instance PyAudio (micro + loopback). Callbacks RT MINIMAUX (copie brute + horodatage, R#2). SIGNALE
    les input-overflow (R#3). R#1 : libere PyAudio si l'ouverture echoue. R#8 : refuse un 2e demarrage (un
    seul ecrivain SPMC). Loopback OPTIONNEL : s'il n'ouvre pas -> `loopback_ok=False`, on_ref jamais appele
    -> AEC en passthrough (« sans reference »). Le micro, lui, est vital (son echec au demarrage propage).

    DEVICE-CHANGE / RECUPERATION (V1.c, corrige apres mesures live conv 40) : quand le loopback MEURT (tu
    eteins ta Focusrite -> is_active False, signal PROUVE fiable), le `DeviceWatcher` (~2 s) declenche
    `_reinit_audio` : terminate COMPLET de PyAudio + fraiche -> enumeration A JOUR -> re-ouvre micro+loopback
    sur la sortie COURANTE -> la reference RECUPERE (ex. sur la TV). Un micro-trou de ~100 ms a cet instant
    (rare, tu le declenches). **Pourquoi tout re-init** : l'enumeration PortAudio reste FIGEE tant qu'UNE
    PyAudio vit (mesure conv 40 : une PyAudio fraiche est AVEUGLE aux changements ; un poll par nom ne voit
    rien) -> seul un terminate COMPLET puis re-init voit le nouveau peripherique. Backoff quand la re-init
    echoue (aucune sortie dispo) : on ne glitch pas le micro en boucle.

    PERIMETRE (croise conv 40, honnete) : on encaisse la MORT du loopback (peripherique ETEINT -> is_active
    False, cas courant « eteindre la Focusrite » -> recupere sur la sortie courante). Le switch de sortie par
    defaut « a chaud » (une NOUVELLE sortie devient defaut alors que l'ancienne reste ALLUMEE : ex. brancher un
    casque) laisse une reference PERIMEE non detectee -> ce cas EXIGE le COM (IMMNotificationClient, mesure
    conv 40 : capricieux) et reste au BACKLOG §7 (Sophia n'est pas prevue au casque). IMMNotificationClient
    (les 2 sens instantanes, sans micro-trou) = upgrade §7."""

    def __init__(self, on_near: OnRaw2, on_ref: OnRaw2, on_overflow: OnOverflow | None = None,
                 mic_index: int | None = None, frames_ms: int = 10, watch_interval_s: float = 2.0):
        self._on_near = on_near
        self._on_ref = on_ref
        self._on_overflow = on_overflow
        self._mic_index = mic_index
        self._frames_ms = int(frames_ms)
        self._watch_interval = float(watch_interval_s)
        self._pa = None
        self._mic_stream = None
        self._loop_stream = None
        self._started = False
        self._lock = threading.Lock()      # serialise start/stop/re-init
        self._watcher: DeviceWatcher | None = None
        self._backoff = 0                  # ticks a attendre avant la prochaine re-init (borne le glitch micro)
        self._fails = 0                    # echecs consecutifs de re-init -> escalade du backoff
        self.reopens = 0                   # re-init REUSSIES (reference recuperee) — observabilite
        self.reopen_attempts = 0
        self.loopback_ok = False
        self._loop_active_cached = False   # M-C : etat is_active() EN CACHE (bool atomique), rafraichi SOUS lock
        self.mic_rate = 16000
        self.mic_channels = 1
        self.loop_rate = 16000
        self.loop_channels = 1

    def _open_streams(self) -> None:
        """Ouvre le micro (VITAL, leve si absent) + le loopback (OPTIONNEL) sur self._pa (deja cree, FRAIS ->
        enumeration a jour). Extrait pour etre re-appele au device-change (_reinit_audio)."""
        import pyaudiowpatch as pyaudio
        wasapi = self._pa.get_host_api_info_by_type(pyaudio.paWASAPI)
        if self._mic_index is None:
            mic = self._pa.get_device_info_by_index(int(wasapi["defaultInputDevice"]))
        else:
            mic = self._pa.get_device_info_by_index(self._mic_index)
        self.mic_channels = max(1, int(mic["maxInputChannels"]) or 1)
        self.mic_rate = int(mic["defaultSampleRate"])

        def _mic_cb(in_data, frame_count, time_info, status):
            try:
                if status and self._on_overflow is not None:
                    self._on_overflow(int(status))          # R#3 : perte cote capture signalee
                block = np.frombuffer(in_data, dtype=np.int16)
                self._on_near(block, self.mic_channels, self.mic_rate, time.monotonic())
            except Exception:
                pass   # un bloc fautif ne tue jamais le flux RT
            return (None, pyaudio.paContinue)

        self._mic_stream = self._pa.open(
            format=pyaudio.paInt16, channels=self.mic_channels, rate=self.mic_rate,
            input=True, input_device_index=int(mic["index"]),
            frames_per_buffer=max(1, int(self.mic_rate * self._frames_ms / 1000)),
            stream_callback=_mic_cb,
        )
        self._mic_stream.start_stream()

        try:
            loop = self._pa.get_default_wasapi_loopback()   # loopback de la sortie COURANTE
            self.loop_channels = max(1, int(loop["maxInputChannels"]) or 1)
            self.loop_rate = int(loop["defaultSampleRate"])

            def _loop_cb(in_data, frame_count, time_info, status):
                try:
                    block = np.frombuffer(in_data, dtype=np.int16)
                    self._on_ref(block, self.loop_channels, self.loop_rate, time.monotonic())
                except Exception:
                    pass
                return (None, pyaudio.paContinue)

            self._loop_stream = self._pa.open(
                format=pyaudio.paInt16, channels=self.loop_channels, rate=self.loop_rate,
                input=True, input_device_index=int(loop["index"]),
                frames_per_buffer=max(1, int(self.loop_rate * self._frames_ms / 1000)),
                stream_callback=_loop_cb,
            )
            self._loop_stream.start_stream()
            self.loopback_ok = True
            self._loop_active_cached = True    # M-C : loopback ouvert+demarre -> actif (cache pose SOUS lock)
        except Exception:
            s = self._loop_stream              # #6 : si open() a reussi mais start_stream() a leve, FERMER le
            if s is not None:                  # stream deja ouvert (sinon fuite jusqu'au prochain terminate())
                try:
                    s.close()
                except Exception:
                    pass
            self._loop_stream = None   # micro-seul : AEC en passthrough (degrade, jamais fatal)
            self.loopback_ok = False
            self._loop_active_cached = False

    def _close_streams(self) -> None:
        """Ferme micro + loopback ET terminate PyAudio -> PortAudio DEINITIALISE (condition pour qu'un re-init
        ulterieur re-enumere, conv 40). Appele SOUS lock (start/stop/_reinit_audio)."""
        self._loop_active_cached = False   # M-C : streams sur le point d'etre fermes -> plus actif (sous lock)
        for attr in ("_mic_stream", "_loop_stream"):
            s = getattr(self, attr, None)
            if s is not None:
                try:
                    s.stop_stream()
                    s.close()
                except Exception:
                    pass
                setattr(self, attr, None)
        if self._pa is not None:
            try:
                self._pa.terminate()
            except Exception:
                pass
            self._pa = None

    def loopback_active(self) -> bool:
        """Le flux loopback est-il ACTIF ? Lit un BOOLEEN mis en CACHE sous lock (M-C, croise conv 40) : JAMAIS
        d'appel C `is_active()` hors lock. Sinon use-after-free — `close()` (re-init/stop, sous lock) libere le
        stream C mais pyaudiowpatch NE remet PAS le pointeur a None et `is_active()` n'a AUCUNE garde -> un
        appel concurrent (depuis /debug, hors lock) ferait `Pa_IsStreamActive(pointeur_libere)` -> segfault que
        le try/except Python ne rattrape pas. True = peripherique present (meme idle, silence-actif) ; False =
        eteint/absent. Rafraichi a chaque tick (~2 s) + a l'ouverture/fermeture ; cette fraicheur suffit pour la
        degradation (observabilite). Lecture d'un bool = atomique (GIL) -> sans lock, sans danger."""
        return self._loop_active_cached

    def _probe_loop_active(self) -> bool:
        """Appel C `is_active()` — A N'APPELER QUE SOUS self._lock (le seul endroit sur : _watch_tick), sinon
        use-after-free (M-C, voir loopback_active). Best-effort : toute anomalie -> False."""
        try:
            return bool(self._loop_stream is not None and self._loop_stream.is_active())
        except Exception:
            return False

    def _reinit_audio(self) -> None:
        """Terminate COMPLET de PyAudio + fraiche -> enumeration A JOUR -> re-ouvre micro+loopback sur la
        sortie COURANTE. SEUL moyen de voir un nouveau peripherique (l'enum PortAudio est figee tant qu'une
        PyAudio vit, conv 40). Coute un micro-trou de ~100 ms (rare : device-change que Yohann declenche)."""
        import pyaudiowpatch as pyaudio
        self._close_streams()
        self._pa = pyaudio.PyAudio()   # FRAIS -> Pa_Initialize re-enumere la sortie courante
        self._open_streams()

    def _watch_tick(self) -> None:
        """Battement : si la reference (loopback) est morte/absente -> re-init (recuperation), avec backoff
        pour ne pas glitcher le micro en boucle si aucune sortie n'est dispo. Ne fait RIEN si tout va bien."""
        with self._lock:
            if not self._started:
                return
            active = self._probe_loop_active()   # M-C : le SEUL appel C is_active(), SOUS lock -> rafraichit le cache
            self._loop_active_cached = active
            if not _loopback_needs_reinit(self.loopback_ok, active):
                self._backoff = 0
                self._fails = 0
                return                    # loopback vivant -> rien a faire (pas de churn en regime normal)
            if self._backoff > 0:
                self._backoff -= 1
                return                    # on attend (backoff)
            self.reopen_attempts += 1
            reinit_raised = False
            try:
                self._reinit_audio()
            except Exception:
                self.loopback_ok = False   # re-init a LEVE : le micro (vital) n'a pas pu rouvrir
                reinit_raised = True
            active = self._probe_loop_active()   # M-C : re-sonde SOUS lock apres re-init + rafraichit le cache
            self._loop_active_cached = active
            if self.loopback_ok and active:
                self.reopens += 1         # recupere !
                self._backoff = 0
                self._fails = 0
            elif reinit_raised:
                # M-A2 (re-croise conv 40) : la re-init a LEVE -> le micro VITAL est FERME (_close_streams l'a
                # ferme, _open_streams a leve AVANT de le rouvrir : ex. Focusrite combo entree+sortie eteinte).
                # ENTENDRE PRIME : on retente AGRESSIVEMENT (aucun backoff) -> recuperation en ~1 tick des le
                # retour du peripherique, sinon Sophia resterait sourde jusqu'a ~5 min. Aucun glitch a craindre
                # ici (pas de micro vivant a proteger). Le backoff long (branche suivante) ne vaut QUE pour
                # « micro ROUVERT, loopback OPTIONNEL absent » (la, chaque re-init reouvre un micro VIVANT).
                self._fails = 0
                self._backoff = 0
            else:
                # SOLO-1 (audit conv 40) : micro ROUVERT (re-init OK) mais loopback (OPTIONNEL) toujours absent.
                # Chaque tentative REOUVRE le micro VITAL (~100 ms de trou : l'enum PortAudio figee impose une
                # re-init COMPLETE). Un backoff lineaire cap 8 (~18 s) glitcherait le micro indefiniment sur une
                # machine SANS sortie (boot avant peripherique, sans-tete). Backoff EXPONENTIEL borne haut (~5
                # min) : 1re tentative prompte, absence DURABLE -> tentatives vite espacees. Reset a la posture
                # agressive des que le loopback redevient sain (branche du haut).
                self._fails += 1
                self._backoff = min(2 ** min(self._fails, 8), 150)   # 150 ticks de 2 s ~ 5 min (exposant borne)

    def start(self) -> None:
        import pyaudiowpatch as pyaudio   # import PARESSEUX
        with self._lock:
            if self._started:
                return   # R#8 : jamais un second demarrage (un seul ecrivain)
            try:
                self._pa = pyaudio.PyAudio()
                self._open_streams()      # le micro (vital) leve si absent
                self._started = True
            except Exception:
                self._close_streams()     # R#1 : liberer flux + PyAudio meme si l'ouverture echoue
                raise
        # surveillance HORS lock (le watcher rappelle _watch_tick qui reprend le lock)
        if self._watch_interval > 0:
            self._watcher = DeviceWatcher(self._watch_tick, self._watch_interval)
            self._watcher.start()

    def stop(self) -> None:
        w = self._watcher
        if w is not None:
            w.stop()          # arreter la surveillance AVANT de fermer (pas de re-init concurrente)
            self._watcher = None
        with self._lock:
            self._close_streams()
            self._started = False
            self.loopback_ok = False


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


class _MonoStream:
    """mono + reechantillonnage STREAMING A ETAT (soxr) vers 16 kHz, pour UNE source. L'etat FIR est
    CONSERVE entre blocs -> continuite inter-blocs (le resample par-bloc de scipy est casse : transitoires
    ~17 %, conv 39). reset() a l'arret pour ne pas contaminer une session ulterieure (parite C#2 de V0)."""

    def __init__(self):
        self._res = None
        self._rate: int | None = None

    def convert(self, block_i16: np.ndarray, n_ch: int, src_rate: int) -> np.ndarray:
        import soxr   # import PARESSEUX
        mono = to_mono_f32(block_i16, n_ch)
        if int(src_rate) != 16000:
            if self._res is None or self._rate != int(src_rate):
                self._res = soxr.ResampleStream(int(src_rate), 16000, 1, dtype="float32")
                self._rate = int(src_rate)
            out = self._res.resample_chunk(mono)   # STREAMING : garde l'etat
        else:
            out = mono
        if out.size:
            return np.clip(np.round(out), -32768, 32767).astype(np.int16)
        return np.zeros(0, dtype=np.int16)

    def reset(self) -> None:
        self._res = None
        self._rate = None


class AecCapture:
    """Chemin audio V1 : deux sources (near = micro, ref = loopback) -> AEC en tete -> ring (audio POST-AEC).

    UN SEUL thread de conversion = UN SEUL ecrivain du ring (invariant SPMC, parite C#1 de V0). Les deux
    callbacks RT empilent leurs blocs bruts dans DEUX files ; le thread draine les deux, convertit chacun
    a 16 kHz mono (soxr streaming, un `_MonoStream` par source), APPARIE par trames de FRAME (160 = 10 ms),
    passe chaque paire a l'AEC, ecrit le NETTOYE au ring. Piloté par le MICRO (near) ; la ref est
    opportuniste (silencieuse -> zeros -> AEC en passthrough). Garde anti-backlog sur ref (> 1 s).

    `source_factory(on_near, on_ref, on_overflow)` est injectable (vrai duplex en prod, faux en test/E2E)."""

    def __init__(self, ring, echo_canceller, source_factory=None, queue_max: int = 64):
        self._ring = ring
        self._aec = echo_canceller
        self._frame = int(echo_canceller.frame)
        self._tail = int(echo_canceller.tail)   # M-B : borne l'avance ref sur near a ~cette queue de filtre
        self._zeros = np.zeros(self._frame, dtype=np.int16)
        self._last_ref_t = 0.0                  # monotonic de la derniere VRAIE trame ref (observabilite : depuis
                                                # quand le loopback ne livre plus ; PAS un signal de degradation —
                                                # le loopback est EVENEMENTIEL, silencieux a l'idle, mesure live 0.4)
        self._near_q: queue.Queue = queue.Queue(maxsize=int(queue_max))
        self._ref_q: queue.Queue = queue.Queue(maxsize=int(queue_max))
        self._dropped_near = 0      # blocs near droppes : file pleine (conversion en retard)
        self._dropped_ref = 0       # blocs ref droppes : file pleine
        self._src_overflow = 0      # input-overflow WASAPI (R#3)
        self._convert_errors = 0    # erreurs de l'etage conversion/AEC (C#3 : jamais en silence)
        self._aec_frames = 0        # trames passees a l'AEC
        self._ref_frames = 0        # trames appariees avec une VRAIE ref (loopback present)
        self._ref_starved = 0       # trames appariees avec des zeros (ref absente : rien ne joue OU exclusif)
        self._near_pow = 0.0        # puissance lissee (EMA) du proche  -> ERLE observable (/debug, I-1)
        self._clean_pow = 0.0       # puissance lissee (EMA) du nettoye -> ERLE = 10log10(near/clean)
        self._near_stream = _MonoStream()
        self._ref_stream = _MonoStream()
        self._near16 = np.zeros(0, dtype=np.int16)
        self._ref16 = np.zeros(0, dtype=np.int16)
        self._near_clock: float | None = None   # at_mono (s) du plus vieux echantillon non-ecrit de near16
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._source = (source_factory
                        or (lambda n, r, o: WasapiDuplexSource(n, r, o))
                        )(self._on_near, self._on_ref, self._on_overflow)

    # ── cote RT : empiler une COPIE, aucun calcul lourd (R#2) ──
    def _on_near(self, block: np.ndarray, n_ch: int, src_rate: int, at_mono: float) -> None:
        try:
            self._near_q.put_nowait((np.array(block, dtype=np.int16), n_ch, src_rate, at_mono))
        except queue.Full:
            self._dropped_near += 1

    def _on_ref(self, block: np.ndarray, n_ch: int, src_rate: int, at_mono: float) -> None:
        try:
            self._ref_q.put_nowait((np.array(block, dtype=np.int16), n_ch, src_rate, at_mono))
        except queue.Full:
            self._dropped_ref += 1

    def _on_overflow(self, status: int) -> None:
        self._src_overflow += 1

    def _drain(self) -> bool:
        did = False
        try:
            while True:
                block, n_ch, sr, at = self._near_q.get_nowait()
                conv = self._near_stream.convert(block, n_ch, sr)
                if conv.size:
                    if self._near16.size == 0:      # near16 vide -> re-ancre le clock sur la capture REELLE
                        self._near_clock = at
                    self._near16 = np.concatenate([self._near16, conv])
                did = True
        except queue.Empty:
            pass
        try:
            while True:
                block, n_ch, sr, at = self._ref_q.get_nowait()
                conv = self._ref_stream.convert(block, n_ch, sr)
                if conv.size:
                    self._ref16 = np.concatenate([self._ref16, conv])
                did = True
        except queue.Empty:
            pass
        return did

    def _convert_loop(self) -> None:
        # M-A (croise conv 40) : l'ECRIVAIN UNIQUE du ring ne doit JAMAIS mourir. Toute exception de l'etage
        # drain/conversion (soxr), d'appariement, de trim ou d'ecriture est COMPTEE et le thread CONTINUE
        # (parite avec la garde interne AEC + l'invariant C#3 de V0 ; sinon : surdite SILENCIEUSE, /health vert
        # -> pas de respawn du superviseur). Petit repit sur erreur pour ne pas spinner si elle est persistante.
        while not self._stop.is_set():
            try:
                self._process_available()
            except Exception:
                self._convert_errors += 1
                self._stop.wait(0.005)

    def _process_available(self) -> None:
        did = self._drain()
        n = self._near16.size // self._frame
        clock = self._near_clock
        ref_used = False
        for i in range(n):
            nf = self._near16[i * self._frame:(i + 1) * self._frame]
            if self._ref16.size >= self._frame:
                rf = self._ref16[:self._frame]
                self._ref16 = self._ref16[self._frame:]
                self._ref_frames += 1
                ref_used = True
            else:
                rf = self._zeros                 # ref absente -> AEC en passthrough (rien a annuler)
                self._ref_starved += 1
            try:
                cleaned = self._aec.process(nf, rf)
                self._ring.write(cleaned, at_mono=clock)   # clock=None -> ring stampe time.monotonic()
                self._aec_frames += 1
                npow = float(np.mean(nf.astype(np.float64) ** 2))       # ERLE observable (near vs clean)
                cpow = float(np.mean(cleaned.astype(np.float64) ** 2))
                self._near_pow = 0.05 * npow + 0.95 * self._near_pow
                self._clean_pow = 0.05 * cpow + 0.95 * self._clean_pow
            except Exception:
                self._convert_errors += 1        # une trame fautive comptee (granularite fine), jamais en silence
            if clock is not None:
                clock += self._frame / 16000.0
        if n:
            if ref_used:
                self._last_ref_t = time.monotonic()   # observabilite : le loopback a livre une VRAIE ref
            self._near16 = self._near16[n * self._frame:]
            self._near_clock = None if self._near16.size == 0 else clock
        # M-B (croise conv 40) : borner l'AVANCE de la ref sur le near. La ref et le near avancent d'une trame
        # par appariement ; si un evenement les DECOUPLE (micro qui cale, drops inegaux entre les 2 files, ref
        # en rafale apres un idle), la ref prend de l'avance et l'appariement naif near[maintenant]<->ref[VIEILLE]
        # casse l'annulation TANT que la ref n'est pas repartie de zero. SpeexDSP n'absorbe qu'un decalage FIXE
        # <= TAIL (200 ms) ; au-dela l'echo FUIT. Des que la ref mene de plus que la queue de filtre, on JETTE la
        # ref la plus VIEILLE et on garde ~une trame -> re-calage ref-recente <-> near-maintenant (SpeexDSP
        # re-adapte en ~qq centaines de ms). En regime normal (horloges verrouillees, conv 22) ref16 ~ 0-2 trames
        # -> ne se declenche jamais. (Remplace la garde 1 s/0,5 s qui bornait la RAM, pas l'ALIGNEMENT.)
        if self._ref16.size > self._frame + self._tail:
            self._ref16 = self._ref16[-self._frame:]
        if n == 0:
            # aucune trame produite ce cycle -> courte attente. Sur `n==0` (pas seulement « rien draine ») pour
            # ne PAS tourner a vide si SEULE la ref afflue (micro muet + media qui joue) : sans near, pas de
            # sortie possible -> attendre. `_ = did` : la ref eventuellement drainee reste en tampon.
            _ = did
            self._stop.wait(0.005)

    @property
    def stats(self) -> dict:
        erle = (10.0 * log10(self._near_pow / self._clean_pow)
                if self._near_pow > 1.0 and self._clean_pow > 1.0 else 0.0)
        now = time.monotonic()
        ref_gap = (now - self._last_ref_t) if self._last_ref_t else 0.0
        loopback_ok = bool(getattr(self._source, "loopback_ok", False))
        loopback_active = bool(getattr(self._source, "loopback_active", lambda: False)())
        # DEGRADATION HONNETE (V1.d, corrigee live conv 40) : la reference (loopback) est-elle exploitable ?
        # `loopback_active` = True quand le peripherique est PRESENT (meme idle, il livre du silence-actif) ;
        # False quand il est ETEINT/absent (mesure conv 40). Donc degrade = loopback pas ouvert OU mort. Le
        # loopback etant EVENEMENTIEL (ref_frames=0 a l'idle, mesure 0.4), on NE peut PAS distinguer un flux
        # exclusif de « rien ne joue » par le tarissement des trames -> l'exclusif reste un RESIDU ASSUME
        # (01 §6). La surveillance (WasapiDuplexSource) RECUPERE la reference quand le peripherique revient.
        degraded = not (loopback_ok and loopback_active)
        reopens = int(getattr(self._source, "reopens", 0))
        reopen_attempts = int(getattr(self._source, "reopen_attempts", 0))
        return {
            "dropped_near": self._dropped_near, "dropped_ref": self._dropped_ref,
            "src_overflow": self._src_overflow, "convert_errors": self._convert_errors,
            "aec_frames": self._aec_frames, "ref_frames": self._ref_frames,
            "ref_starved": self._ref_starved,
            "loopback_ok": loopback_ok, "loopback_active": loopback_active, "erle_db": round(erle, 1),
            "degraded": degraded, "ref_gap_s": round(ref_gap, 2),
            "reopens": reopens, "reopen_attempts": reopen_attempts,
        }

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return   # C#1 : jamais un 2e thread de conversion -> l'ecrivain du ring reste unique (SPMC)
        self._source.start()   # si le micro (vital) echoue, leve -> aucun thread lance (R#1)
        self._stop.clear()
        self._thread = threading.Thread(target=self._convert_loop, name="aec-convert", daemon=True)
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
            # C#2 : reinitialiser l'etat (resamplers + tampons + files) -> pas d'audio perime rejoue au restart
            self._near_stream.reset()
            self._ref_stream.reset()
            self._near16 = np.zeros(0, dtype=np.int16)
            self._ref16 = np.zeros(0, dtype=np.int16)
            self._near_clock = None
            self._near_pow = 0.0
            self._clean_pow = 0.0
            for q in (self._near_q, self._ref_q):
                try:
                    while True:
                        q.get_nowait()
                except queue.Empty:
                    pass
