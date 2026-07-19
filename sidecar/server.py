#!/usr/bin/env python
"""Sophia — sidecar (socle T2/T3) : le canal IPC.

Heberge, sur UN port (127.0.0.1 uniquement) :
  - REST : GET /health (vivant + pret) · GET /debug (sonder le socle sans client WS, curl)
  - WebSocket : /ws (le canal cmd/evt)
L'orchestrateur Node est le CLIENT.

Protocole : enveloppe {type, id, ts, payload}.
  - familles : cmd.* (orchestrateur -> sidecar) / evt.* (sidecar -> orchestrateur) ;
  - evt.* est EXTENSIBLE : un nouveau type d'evenement ne change PAS le protocole ;
  - correlation : une reponse evt.* reprend le MEME id que le cmd.* qu'elle reference.

Invariants (socle) :
  - localhost-only (bind 127.0.0.1) ;
  - l'AUDIO ne traverse JAMAIS ce canal (JSON de controle uniquement ; l'audio reste dans le
    chemin audio interne du sidecar, plan 01) ;
  - ecrivain unique = l'orchestrateur : ce sidecar ne tient aucune poignee de stockage (F2).
"""
import asyncio
import errno
import itertools
import json
import os
import sys
import time

from aiohttp import WSMsgType, web

from bus import EventBus     # V2 : pont thread-de-fond (prises) -> boucle -> WS (evenements evt.*)

HOST = "127.0.0.1"          # localhost-only (invariant socle)
DEFAULT_PORT = 8770
PROTOCOL_VERSION = 1
TEST_HOOKS = os.environ.get("SIDECAR_TEST_HOOKS") == "1"  # hooks de test JAMAIS actifs en prod

CMD_TYPES = ["cmd.shutdown", "cmd.enroll.push",
             "cmd.tts.speak", "cmd.tts.push", "cmd.tts.end", "cmd.tts.stop",
             "cmd.listen.mute", "cmd.listen.resume"]  # cmd.listen.* = gate anti-auto-ecoute CROSS-PROCESS (V7 archi 2 process)
EVT_TYPES = ["evt.health", "evt.ack", "evt.error", "evt.vad.start", "evt.vad.stop",
             "evt.wake", "evt.stt.partial", "evt.stt.final", "evt.turn.end", "evt.turn.eval", "evt.speaker",
             "evt.tts.start", "evt.tts.done",
             "evt.plug.overrun", "evt.plug.stuck"]  # (evt.turn.end = V5 ; evt.speaker = V6 ; evt.tts.* = V7 la bouche)

_ids = itertools.count(1)
_t0 = time.monotonic()
_state = {"frozen": False}  # hook de TEST (fige-mais-vivant), pilote par /debug/freeze

# ── Chemin audio (plan 01, V0->V1) — OPT-IN via SIDECAR_AUDIO=1 ──────────────────────────────────────
# Les tests socle NE l'activent PAS -> aucun micro ouvert, aucun import numpy/scipy/pyaudiowpatch/pyaec (le
# sidecar socle reste leger et rapide). L'audio est RAM sidecar (ring buffer) : il ne traverse JAMAIS le
# canal (invariant socle). Import PARESSEUX (au demarrage seulement si demande).
#   "1"         = PROD  : micro + loopback -> AEC SpeexDSP -> ring POST-AEC (V1) + VAD (V2) + reveil (V3) + STT (V4)
#   "test"      = E2E-V0 : chemin V0 (capture unique micro -> ring), source synthetique MONO (contrat V0 fige)
#   "test-aec"  = E2E-V1 : chemin V1 AEC (near+ref -> annulation -> ring), source synthetique DUPLEX
#   "test-vad"  = E2E-V2 : chemin V0 + prise VAD (source parole synthetique -> ring -> VAD -> bus -> WS)
#   "test-wake" = E2E-V3 : test-vad + le reveil (WakeGate) ; l'eveil s'injecte par /debug/wake (TEST_HOOKS)
#   "test-stt"  = E2E-V4 : test-wake + le STT (SttPlug) + portier ; la source joue « bonjour sophia » (WAV
#                          neutre) -> le VRAI faster-whisper transcrit -> le portier reveille (SANS injection)
#   "test-turn" = E2E-V5 : test-stt + la fin de tour FINE (SttPlug avec un TurnDetector Smart Turn REEL) ->
#                          apres l'eveil, un tour de conversation emet evt.turn.end (ordre stt.final->turn.end)
#   "test-speaker"= E2E-V6 : chemin AEC + VAD + speaker-ID (SpeakerPlug, VRAI ECAPA) ; la source rejoue une
#                          voix (SOPHIA_STT_WAV -> raw_far de Yohann, held-out) -> evt.speaker {locuteur, score}
#   "test-tts"  = E2E-V7 : LA BOUCHE SEULE (TtsPlug, VRAI Piper A20) ; PAS de micro/ring (le TTS est un
#                          PRODUCTEUR de son, il ne lit pas le ring) -> l'orchestrateur pousse cmd.tts.* -> evt.tts.*
AUDIO_ON = os.environ.get("SIDECAR_AUDIO") in (
    "1", "test", "test-aec", "test-vad", "test-wake", "test-stt", "test-turn", "test-speaker", "test-tts")
RING_SECONDS = 30                       # fenetre du ring (rembobinage pre-wake + marge) ; ~1 Mo a 16 kHz
_audio = {"ring": None, "capture": None, "vad": None, "wake": None, "stt": None, "speaker": None, "tts": None}
# V7 archi 2 process : gate anti-auto-ecoute PILOTE PAR LE ROUTEUR (cmd.listen.mute/resume). En role « ears », le
# VAD + STT le consultent (au lieu de tts.is_speaking, qui vit dans l'AUTRE process « mouth ») : quand la bouche parle,
# le routeur mute les oreilles -> pas d'auto-transcription. Booleen simple (lecture/ecriture atomiques sous le GIL).
_listen_muted = False


def _vad_threshold() -> float:
    """Seuil VAD (calibration §6). Defaut 0.5 (banc conv 25) ; surchargeable au spawn par SOPHIA_VAD_THRESHOLD."""
    try:
        return float(os.environ.get("SOPHIA_VAD_THRESHOLD", "0.5"))
    except (TypeError, ValueError):
        return 0.5


def _make_emit(bus: EventBus):
    """Adapte le contrat de prise `emit(type, payload)` (plugs/base) au bus : construit l'enveloppe socle
    (id/ts) et la publie de facon THREAD-SAFE (la prise VAD tourne dans son propre thread -> l'envoi WS,
    lui, est sur la boucle ; le bus fait le pont)."""
    def emit(mtype: str, payload: dict) -> None:
        bus.publish_threadsafe(_envelope(mtype, payload))
    return emit


def _observing_emit(bus: EventBus, *observers):
    """Emit du VAD (V3/V4) : publie sur le bus PUIS fait suivre la marque aux OBSERVATEURS (V3 `wake.observe`,
    V4 `stt.on_vad`). Ils CONSOMMENT le vocabulaire `evt.*` (que la marque `pos`) -> AUCUNE modification du
    VadPlug verrouille. Chaque observer tourne dans le thread de la prise VAD (comme l'emit) ; un observer qui
    leve ne casse JAMAIS la boucle de la prise (parite `_safe_emit`)."""
    base = _make_emit(bus)
    def emit(mtype: str, payload: dict) -> None:
        base(mtype, payload)
        for obs in observers:
            try:
                obs(mtype, payload)
            except Exception:
                pass
    return emit


def _start_audio(bus: EventBus) -> None:
    """PROD (V1+V2) : micro + loopback -> AEC -> ring 16 kHz POST-AEC, PUIS la prise VAD (Silero) qui emet
    `evt.vad.*` via le bus. Non-fatal : sans peripherique, le sidecar VIT sans oreilles (degrade, jamais un
    crash) ; sans loopback, il vit « sans reference » (AEC en passthrough). La prise VAD est un CONSOMMATEUR
    du ring (curseur independant) : elle ne bloque jamais la capture (SPMC, V0)."""
    if not AUDIO_ON:
        return
    mode = os.environ.get("SIDECAR_AUDIO")
    # V7 archi 2 process (conv 47) : la voix retrouve sa PROPRE voie, comme le banc conv 34. SIDECAR_ROLE aiguille UN
    # process en « ears » (ecoute : AEC+VAD+reveil+STT+fin de tour, SANS tts ni V6) OU « mouth » (la bouche seule :
    # Piper + sortie audio ISOLEE -> jamais affamee par les modeles d'ecoute). Sans role -> monolithe (inchange, tests OK).
    role = os.environ.get("SIDECAR_ROLE")
    if role == "mouth":
        _start_tts_only(bus, audible=True)
        return
    if role == "ears":
        _start_ears(bus)
        return
    if mode == "test-tts":
        _start_tts_only(bus)   # V7 (la bouche SEULE) : producteur, pas de micro/ring ; idempotent sur sa cle
        return
    if _audio.get("capture") is not None:
        return   # Fid#4 : idempotent — jamais un 2e micro/2e ecrivain (invariant capture unique / SPMC)
    try:
        from audio import RingBuffer   # lazy : numpy/scipy/soxr/pyaudiowpatch/pyaec seulement si demande
        ring = RingBuffer(RING_SECONDS * 16000)
        vad = None
        wake = None
        stt = None
        speaker = None
        tts = None
        if mode == "test":
            from audio import AudioCapture
            from audio.test_source import SyntheticToneSource   # E2E-V0 : micro synthetique 48 kHz (jamais en prod)
            cap = AudioCapture(ring, source_factory=lambda a, b: SyntheticToneSource(a, b))
        elif mode == "test-aec":
            from audio import AecCapture, EchoCanceller
            from audio.test_source import SyntheticDuplexSource   # E2E-V1 : near(echo+voix)+ref(far-end) (jamais en prod)
            cap = AecCapture(ring, EchoCanceller(), source_factory=lambda n, r, o: SyntheticDuplexSource(n, r, o))
        elif mode in ("test-vad", "test-wake", "test-stt", "test-turn", "test-speaker"):
            from audio import AecCapture, EchoCanceller
            from consumers import VadPlug, SileroVadEngine
            if mode == "test-speaker":                           # E2E-V6 : AEC + VAD + speaker-ID (VRAI ECAPA)
                from audio.test_source import WavLoopSource
                from consumers import SpeakerPlug
                cap = AecCapture(ring, EchoCanceller(),
                                 source_factory=lambda n, r, o: WavLoopSource(n, r, o))   # POST-AEC, voix rejouee (SOPHIA_STT_WAV=raw_far)
                speaker = SpeakerPlug(ring, _make_emit(bus))     # V6 : « qui parle ? » -> evt.speaker
                vad = VadPlug(ring, _observing_emit(bus, speaker.on_vad),
                              engine=SileroVadEngine(threshold=_vad_threshold()))          # VAD -> speaker (fan-out)
            elif mode in ("test-stt", "test-turn"):              # E2E-V4/V5 : la source joue « bonjour sophia » (WAV neutre)
                from audio.test_source import WavLoopSource
                from consumers import WakeGate, SttPlug
                cap = AecCapture(ring, EchoCanceller(),
                                 source_factory=lambda n, r, o: WavLoopSource(n, r, o))       # POST-AEC, fidele prod
                wake = WakeGate(ring, _make_emit(bus))
                turn = None
                if mode == "test-turn":                          # E2E-V5 : la fin de tour FINE avec le VRAI Smart Turn
                    from consumers import TurnDetector, SmartTurnEngine
                    turn = TurnDetector(SmartTurnEngine())
                stt = SttPlug(ring, _make_emit(bus), wake=wake, turn=turn)  # VRAI faster-whisper -> portier -> on_wake (+ V5 fin de tour)
                vad = VadPlug(ring, _observing_emit(bus, wake.observe, stt.on_vad),
                              engine=SileroVadEngine(threshold=_vad_threshold()))
            else:                                                # E2E-V2/V3 : parole synthetique (formants)
                from audio.test_source import SyntheticSpeechSource
                cap = AecCapture(ring, EchoCanceller(),
                                 source_factory=lambda n, r, o: SyntheticSpeechSource(n, r, o))   # POST-AEC, fidele prod
                if mode == "test-wake":                          # E2E-V3 : + le reveil (VAD -> emit wrappe -> wake)
                    from consumers import WakeGate
                    wake = WakeGate(ring, _make_emit(bus))
                    vad = VadPlug(ring, _observing_emit(bus, wake.observe),
                                  engine=SileroVadEngine(threshold=_vad_threshold()))
                else:                                            # E2E-V2 : V2 seul (e2e-v2 INTACT, pas de wake)
                    vad = VadPlug(ring, _make_emit(bus), engine=SileroVadEngine(threshold=_vad_threshold()))
        else:
            from audio import AecCapture, EchoCanceller
            from consumers import (VadPlug, SileroVadEngine, WakeGate, SttPlug, TurnDetector,
                                   SmartTurnEngine, SpeakerPlug)
            from tts import TtsPlug     # V7 : la bouche (producteur de son ; pas de curseur ring)
            cap = AecCapture(ring, EchoCanceller())   # PROD : WasapiDuplexSource (micro + loopback) + AEC
            wake = WakeGate(ring, _make_emit(bus))    # V3 : le reveil retroactif (rembobine a la marque VAD)
            stt = SttPlug(ring, _make_emit(bus), wake=wake,
                          turn=TurnDetector(SmartTurnEngine()))   # V4 STT+portier + V5 fin de tour FINE (Smart Turn)
            speaker = SpeakerPlug(ring, _make_emit(bus))   # V6 : « qui parle ? » -> evt.speaker (sert V8 barge-in + V14 affect)
            tts = TtsPlug(_make_emit(bus))   # V7 : la BOUCHE ; cmd.tts.* la pilotent -> evt.tts.* (voix A20 Piper)
            vad = VadPlug(ring, _observing_emit(bus, wake.observe, stt.on_vad, speaker.on_vad),
                          engine=SileroVadEngine(threshold=_vad_threshold()))          # ring POST-AEC ; VAD -> wake+stt+speaker
            vad.set_gate(tts.is_speaking)    # V7 morceau C : GATE anti-auto-ecoute — le VAD IGNORE le micro pendant
            #                                  que SA voix joue (+ traine) -> elle ne se re-transcrit pas (fidele au
            #                                  _flush_audio du banc oreilles_live:1298/1314). PROD seul (E2E sans TTS).
            stt.set_gate(tts.is_speaking)    # V7 morceau C (fidelite #1 croise) : le STT abandonne un groupe DEJA
            #                                  ouvert quand SA voix joue (Yohann a parle pendant la latence cerveau) ->
            #                                  aucun groupe n'enjambe sa voix (le VAD gate ne couvre que les NOUVEAUX).
        cap.start()
        _audio["ring"], _audio["capture"] = ring, cap
        if vad is not None:
            vad.start()               # thread dedie ; Silero se charge PARESSEUSEMENT au 1er audio (le ring 30 s
            _audio["vad"] = vad        # absorbe les ~2 s ; un echec de chargement -> vad.state.engine_errors, jamais silencieux)
        if wake is not None:
            _audio["wake"] = wake      # V3 : pas de thread (reagit aux marques VAD + au signal d'eveil) ; sonde /debug
        if stt is not None:
            stt.start()               # V4 : worker dedie ; faster-whisper se charge au demarrage du worker (~7 s,
            _audio["stt"] = stt        # NON bloquant pour le boot) ; un echec -> stt.state.engine_errors, jamais silencieux
        if speaker is not None:
            speaker.start()           # V6 : worker dedie ; ECAPA (CPU) se charge au demarrage (~1 s, NON bloquant) ;
            _audio["speaker"] = speaker  # un echec (modele/ancre absent) -> V6 inerte (worker sort), jamais un crash
        if tts is not None:
            tts.start()               # V7 : threads gen/play ; Piper se charge au demarrage (~qq s, NON bloquant) ;
            _audio["tts"] = tts        # un echec de chargement -> bouche muette (engine_ok False), jamais un crash
        label = {"test": "V0 (micro)", "test-aec": "V1 (AEC)", "test-vad": "V2 (AEC + VAD)",
                 "test-wake": "V3 (AEC + VAD + reveil)", "test-stt": "V4 (AEC + VAD + reveil + STT)",
                 "test-turn": "V5 (AEC + VAD + reveil + STT + fin de tour)",
                 "test-speaker": "V6 (AEC + VAD + speaker-ID)"}.get(
                     mode, "V1+V2+V3+V4+V5+V6 (AEC + VAD + reveil + STT + fin de tour + speaker-ID)")
        vad_note = f" + VAD Silero seuil {_vad_threshold()} (chargement paresseux)" if vad is not None else ""
        wake_note = " + reveil retroactif (V3)" if wake is not None else ""
        stt_note = " + STT faster-whisper large-v3 + portier (V4, chargement ~7 s)" if stt is not None else ""
        turn_note = " + fin de tour Smart Turn (V5)" if stt is not None and getattr(stt, "_turn", None) is not None else ""
        spk_note = " + speaker-ID ECAPA CPU (V6, chargement ~1 s)" if speaker is not None else ""
        tts_note = " + voix A20 Piper (V7 la bouche, chargement ~qq s)" if tts is not None else ""
        print(f"[sidecar] audio {label} : ring {RING_SECONDS}s @ 16 kHz{vad_note}{wake_note}{stt_note}{turn_note}{spk_note}{tts_note}", flush=True)
    except Exception as e:
        print(f"[sidecar] audio indisponible ({type(e).__name__}: {e}) — vivant sans oreilles", flush=True)


def _start_tts_only(bus: EventBus, audible: bool | None = None) -> None:
    """V7 — la BOUCHE SEULE (TtsPlug, VRAI Piper A20), SANS micro ni ring (le TTS est un PRODUCTEUR de son, il ne
    consomme pas le ring). Sert DEUX cas : le mode `test-tts` (E2E-V7, sortie silencieuse par defaut) ET le ROLE
    `mouth` de l'archi 2 process (conv 47, `audible=True` -> la voix sort vraiment, isolee du process oreilles).
    L'orchestrateur pousse `cmd.tts.*` -> la voix -> `evt.tts.*`. Idempotent sur sa cle ; non-fatal (sans Piper -> muet)."""
    if _audio.get("tts") is not None:
        return
    try:
        from tts import NullOutput, TtsPlug
        # E2E headless = sortie SILENCIEUSE (prouve cmd.tts -> synth -> evt.tts SANS jouer de son) ; audible -> vrai son
        # (juge a ta VOIX / role `mouth` prod). Le playback capte par le loopback -> annule par l'AEC des oreilles (F2).
        if audible is None:
            audible = os.environ.get("SOPHIA_TTS_AUDIBLE") == "1"
        tts = TtsPlug(_make_emit(bus), output=None if audible else NullOutput())
        tts.start()
        _audio["tts"] = tts
        note = "audible (SdOutput)" if audible else "silencieuse (E2E headless)"
        print(f"[sidecar] audio V7 (bouche seule) : TtsPlug voix A20 Piper, sortie {note} — cmd.tts.* -> evt.tts.*", flush=True)
    except Exception as e:
        print(f"[sidecar] TTS (V7) indisponible ({type(e).__name__}: {e}) — vivant sans voix", flush=True)


def _listen_gate() -> bool:
    """Gate anti-auto-ecoute du role `ears` (V7 archi 2 process) : True quand la bouche (AUTRE process) parle -> le
    VAD/STT ignorent le micro (pas d'auto-transcription de son residu post-AEC). Pose par le ROUTEUR via
    cmd.listen.mute/resume (il sait quand elle parle, via evt.tts.start/done de la bouche). Remplace `tts.is_speaking`
    du monolithe (in-process, plus disponible ici). Lecture d'un booleen module (atomique sous le GIL)."""
    return _listen_muted


def _start_ears(bus: EventBus) -> None:
    """V7 archi 2 process (conv 47) : le process « OREILLES » — AEC + VAD + reveil + STT + fin de tour, SANS la bouche
    (la voix vit dans le process « mouth », isolee -> jamais affamee par ces modeles, cause de la voix « lente/monotone »
    du monolithe, mesuree diag_contention). V6 (speaker) OFF par defaut (SOPHIA_SPEAKER=1 pour le rallumer) : il
    alimente V8/V14 non construits -> 119 ms/eval de CPU en moins, en continu. Le gate anti-auto-ecoute est pilote par
    cmd.listen.* (le routeur), pas par tts.is_speaking (autre process). Non-fatal (parite _start_audio)."""
    if _audio.get("capture") is not None:
        return
    try:
        from audio import AecCapture, EchoCanceller, RingBuffer
        from consumers import (SileroVadEngine, SmartTurnEngine, SttPlug, TurnDetector, VadPlug, WakeGate)
        ring = RingBuffer(RING_SECONDS * 16000)
        cap = AecCapture(ring, EchoCanceller())
        wake = WakeGate(ring, _make_emit(bus))
        stt = SttPlug(ring, _make_emit(bus), wake=wake, turn=TurnDetector(SmartTurnEngine()))
        observers = [wake.observe, stt.on_vad]
        speaker = None
        if os.environ.get("SOPHIA_SPEAKER") == "1":       # V6 rallumable a la demande (defaut OFF -> allege les oreilles)
            from consumers import SpeakerPlug
            speaker = SpeakerPlug(ring, _make_emit(bus))
            observers.append(speaker.on_vad)
        vad = VadPlug(ring, _observing_emit(bus, *observers), engine=SileroVadEngine(threshold=_vad_threshold()))
        vad.set_gate(_listen_gate)     # gate anti-auto-ecoute pilote par cmd.listen.* (le routeur ; cross-process)
        stt.set_gate(_listen_gate)
        cap.start()
        _audio["ring"], _audio["capture"] = ring, cap
        vad.start(); _audio["vad"] = vad
        _audio["wake"] = wake
        stt.start(); _audio["stt"] = stt
        if speaker is not None:
            speaker.start(); _audio["speaker"] = speaker
        spk_note = " + speaker-ID V6" if speaker is not None else " (V6 en veille)"
        print(f"[sidecar] audio OREILLES (V7 archi 2 process) : AEC + VAD + reveil (V3) + STT (V4) + fin de tour (V5)"
              f"{spk_note} — gate anti-auto-ecoute par cmd.listen.*", flush=True)
    except Exception as e:
        print(f"[sidecar] oreilles indisponibles ({type(e).__name__}: {e}) — vivant sans oreilles", flush=True)


def _stop_audio() -> None:
    """Libere le micro (release-and-wait T6 : AVANT l'ack de cmd.shutdown). Idempotent, y compris SOUS
    concurrence (S#1 re-croise) : on annule la ref AVANT le stop() bloquant -> un 2e appel (2e cmd.shutdown,
    ou _on_cleanup) voit None et ne relance PAS un terminate() concurrent sur le meme handle PyAudio."""
    cap = _audio.pop("capture", None)   # ATOMIQUE (GIL) : get-and-clear -> un seul appelant obtient la capture
    vad = _audio.pop("vad", None)       # idem VAD (chaque pop atomique -> chaque ressource arretee au + une fois)
    wake = _audio.pop("wake", None)     # idem reveil V3 (pop atomique separe -> arrete au + une fois)
    stt = _audio.pop("stt", None)       # idem STT V4 (pop atomique separe -> worker arrete au + une fois)
    speaker = _audio.pop("speaker", None)  # idem speaker V6 (pop atomique separe -> worker arrete au + une fois)
    tts = _audio.pop("tts", None)       # idem bouche V7 (pop atomique separe -> workers gen/play + sortie audio liberes)
    _audio.pop("ring", None)            # (un get()+set() garderait une fenetre de race entre les deux threads)
    if wake is not None:
        try:
            wake.stop()                 # reveil (V3) : pas de thread -> simple retour en VEILLE (release)
        except Exception:
            pass
    if stt is not None:
        try:
            stt.stop()                  # V4 : arrete le worker STT (consommateur) avant la capture (producteur)
        except Exception:
            pass
    if speaker is not None:
        try:
            speaker.stop()              # V6 : arrete le worker speaker (consommateur) avant la capture (producteur)
        except Exception:
            pass
    if vad is not None:
        try:
            vad.stop()                  # arrete le CONSOMMATEUR (VAD) avant le producteur (capture)
        except Exception:
            pass
    if cap is not None:
        try:
            cap.stop()
        except Exception:
            pass
    if tts is not None:
        try:
            tts.stop()                  # V7 : la bouche (Piper CPU + sortie audio) EN DERNIER (#7 croise conv 47) —
            #                             le budget graceful (2 s, T6) sert d'abord le release des consommateurs GPU
            #                             (micro/CUDA, V1->V15) ; le TTS n'a pas de CUDA a liberer gracieusement. Ses
            #                             workers sont daemon (SIGKILL T6 couvre un join long) ; output.stop() debloque
            #                             la lecture + sentinelles debloquent gen/play -> arret rapide en pratique.
        except Exception:
            pass


def _now_ms() -> float:
    return round(time.monotonic() * 1000, 3)  # emission monotone (ms)


def _envelope(mtype: str, payload: dict, corr=None) -> dict:
    return {
        "type": mtype,
        "id": corr if corr is not None else f"s{next(_ids)}",  # correlation : reprend l'id du cmd
        "ts": _now_ms(),
        "payload": payload,
    }


async def health(_request: web.Request) -> web.Response:
    if TEST_HOOKS and _state["frozen"]:  # hook de TEST (jamais en prod) : cesse de repondre (fige-mais-vivant)
        await asyncio.Event().wait()     # ne se resout jamais -> le battement du superviseur manque
    return web.json_response({"ok": True, "ready": True, "role": "sidecar", "stage": "T3"})


async def debug(request: web.Request) -> web.Response:
    app = request.app
    # S#2 (re-croise) : figer les refs UNE fois. `_stop_audio` tourne dans un executor (autre thread) et met
    # `_audio["ring"]/["capture"]` a None ; un check-then-use `_audio.get("ring") ... _audio["ring"].x` planterait
    # (None.write_pos()) si le thread bascule entre la garde et l'acces. La ref locale reste valide.
    ring = _audio.get("ring")
    cap = _audio.get("capture")
    vad = _audio.get("vad")
    wake = _audio.get("wake")       # V3 : ref figee (comme S#2) -> pas de check-then-use si un teardown la nullifie
    stt = _audio.get("stt")         # V4 : ref figee (comme S#2)
    speaker = _audio.get("speaker") # V6 : ref figee (comme S#2)
    tts = _audio.get("tts")         # V7 : ref figee (comme S#2)
    bus = app.get("bus")            # V2 : figer la ref (comme S#2) -> pas de check-then-use si un teardown la nullifie
    return web.json_response({
        "ok": True,
        "protocol_version": PROTOCOL_VERSION,
        "host": HOST,
        "port": app["port"],
        "uptime_s": round(time.monotonic() - _t0, 1),
        "ws_connections": app["ws_count"],
        "families": {"cmd": CMD_TYPES, "evt": EVT_TYPES},
        "bus": {                    # V2 : pont evt.* (« + signal » du drop-oldest — un client lent devient visible)
            "subscribers": bus.subscriber_count if bus is not None else 0,
            "dropped": bus.dropped_total if bus is not None else 0,
        },
        "audio_on_channel": False,  # invariant : l'audio ne traverse jamais l'IPC
        "audio": {                  # V0 : etat du chemin audio (RAM sidecar) — sonde du micro/ring
            "enabled": cap is not None,
            "captured_samples": ring.write_pos() if ring is not None else 0,
            "rate": 16000,
            "stats": cap.stats if cap is not None else {},  # R#3 : pertes capture visibles
            "vad": vad.state if vad is not None else {},    # V2 : etat de la prise VAD (marques, segments)
            "wake": wake.state if wake is not None else {}, # V3 : etat du reveil (derniere marque, dernier reveil)
            "stt": stt.state if stt is not None else {},    # V4 : etat du STT (groupes, partiels, finals, dernier transcript)
            "speaker": speaker.state if speaker is not None else {},  # V6 : etat du speaker-ID (segments, evals, dernier verdict)
            "tts": tts.state if tts is not None else {},    # V7 : etat de la bouche (enonciations, phrases, files, dernier texte)
        },
    })


async def debug_freeze(_request: web.Request) -> web.Response:
    """Hook de TEST (registre seulement si SIDECAR_TEST_HOOKS=1) : fige ce sidecar."""
    _state["frozen"] = True
    return web.json_response({"frozen": True})


async def debug_wake(request: web.Request) -> web.Response:
    """Hook de TEST (registre seulement si SIDECAR_TEST_HOOKS=1) : INJECTE un signal d'eveil (V3). En PROD, le
    vrai declencheur = le portier STT (V4, interne au sidecar) ; ce hook SIMULE un declencheur interne (JAMAIS
    un cmd orchestrateur). `?pos=<marque>` = la marque du segment d'eveil (le test la lit de `evt.vad.start`,
    mode NOMINAL) ; absente -> mode generique (derniere marque suivie). L'`evt.wake` remonte par le bus -> WS."""
    wake = _audio.get("wake")          # ref figee (parite S#2 : un teardown peut nullifier _audio)
    if wake is None:
        return web.json_response({"ok": False, "reason": "reveil (V3) non monte"}, status=409)
    raw = request.query.get("pos")
    try:
        mark = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return web.json_response({"ok": False, "reason": "pos invalide"}, status=400)
    cur = wake.on_wake(mark=mark)      # emet evt.wake (bus) + rend le curseur rembobine (ici on ne garde que l'etat)
    woke = cur is not None
    # `wake` = le reveil de CET appel (pas un reveil anterieur si celui-ci est un no-op S12 / sans marque)
    return web.json_response({"ok": True, "woke": woke, "wake": wake.state["last_wake"] if woke else None})


def _handle_tts(mtype: str, payload: dict) -> dict:
    """V7 — route un cmd.tts.* vers la prise TTS (la bouche). Robuste : payload malforme -> ack d'erreur
    honnete, JAMAIS un crash du WS. La bouche est un PRODUCTEUR ; ces commandes ne bloquent pas la boucle
    (speak/push/end = enqueue rapide ; stop = purge des files + arret de lecture, rapide). cmd.tts.stop n'a
    pas d'id (purge globale de l'unique enonciation qui joue)."""
    tts = _audio.get("tts")            # ref figee (parite S#2 : un teardown peut nullifier _audio)
    if tts is None:
        return {"ok": False, "for": mtype, "note": "TTS (V7) non monte"}
    try:
        if mtype == "cmd.tts.speak":
            tts.speak(int(payload["id"]))
        elif mtype == "cmd.tts.push":
            tts.push(int(payload["id"]), str(payload.get("text", "")))
        elif mtype == "cmd.tts.end":
            tts.end(int(payload["id"]))
        elif mtype == "cmd.tts.stop":
            tts.purge()
    except (KeyError, TypeError, ValueError) as e:
        return {"ok": False, "for": mtype, "note": f"payload invalide ({type(e).__name__})"}
    return {"ok": True, "for": mtype}


async def graceful_release() -> None:
    """T6 — libération COOPÉRATIVE, exécutée AVANT l'ack de cmd.shutdown (release-and-wait, lettre de
    plan/00 T6) : on libère les ressources, on NE SORT PAS ; l'orchestrateur termine ensuite le process
    (SIGTERM->SIGKILL).

    POURQUOI ICI et pas dans un handler de signal : sur Windows, SIGTERM = TerminateProcess, non catchable
    (mesuré au banc t6) -> un handler de signal ne tournerait JAMAIS. La libération GPU gracieuse ne peut
    donc se faire que par ce chemin coopératif (cmd.shutdown), avant le kill forceful.

    V0 : libère le MICRO (premier contenu réel de cette fonction) ; le release du contexte CUDA + le flush
    des modèles/latents s'ajouteront ICI en V1->V15, même fonction, sans changer le protocole ni l'orchestrateur.
    """
    # R#4 : `_stop_audio` fait des appels C bloquants (stop_stream/close/terminate) ; si un driver WASAPI
    # hangue sur terminate(), les exécuter SUR la boucle asyncio la gèlerait (plus de /health, plus d'ack).
    # On les sort dans un executor, borné : la boucle reste vivante ; le filet T6 (SIGKILL) couvre un hang réel.
    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(loop.run_in_executor(None, _stop_audio), timeout=2.0)
        print("[sidecar] cmd.shutdown : graceful_release (V0 : micro libéré ; CUDA/flush viendront en V1->V15)", flush=True)
    except asyncio.TimeoutError:
        print("[sidecar] graceful_release : libération audio > 2 s (driver figé ?) -> on continue (T6 couvre)", flush=True)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    # Un seul emetteur a la fois sur ce WS : la boucle de reception (evt.ack) ET le drain du bus (evt.vad.*)
    # ecrivent tous deux -> aiohttp INTERDIT les envois concurrents. Un verrou par connexion les serialise.
    send_lock = asyncio.Lock()

    async def send(env: dict) -> None:
        async with send_lock:
            await ws.send_json(env)

    bus = request.app.get("bus")
    sub = None
    drain_task = None
    # Incremente JUSTE avant le try -> le `finally` (decrement + desabonnement + annulation drain) s'execute
    # TOUJOURS, meme si le 1er envoi (evt.health) leve (client parti entre prepare et send) : pas de fuite de
    # ws_count ni d'abonnement orphelin. (Le socle incrementait avant le try -> le 1er send hors garde.)
    request.app["ws_count"] += 1
    try:
        await send(_envelope("evt.health", {"ready": True, "role": "sidecar", "stage": "T3"}))
        # Abonnement au bus : les evt.* pousses par les prises (VAD...) depuis LEUR thread arrivent ici et sont
        # relayes au WS. Le bus existe toujours (construit au demarrage) ; sans prise active, le drain attend.
        sub = bus.subscribe() if bus is not None else None
        if sub is not None:
            async def drain() -> None:
                try:
                    while True:
                        env = await sub.get()
                        await send(env)
                except asyncio.CancelledError:
                    raise              # annulation normale (deconnexion) -> finalise la task
                except Exception:
                    pass               # un envoi rate (WS ferme) : la boucle de reception gerera la fermeture
            drain_task = asyncio.create_task(drain())
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                env = json.loads(msg.data)
            except (ValueError, TypeError):
                await send(_envelope("evt.error", {"reason": "json invalide"}))
                continue
            mtype = env.get("type", "")
            cid = env.get("id")
            if not isinstance(mtype, str) or not mtype.startswith("cmd."):
                await send(_envelope("evt.error", {"reason": "cmd.* attendu", "got": mtype}, corr=cid))
                continue
            if mtype == "cmd.shutdown":
                await graceful_release()  # T6 : libere CUDA + flush AVANT d'acquitter (release-and-wait)
                payload = {"ok": True, "for": mtype, "note": "ressources liberees, pret a etre termine"}
            elif mtype == "cmd.enroll.push":
                payload = {"ok": True, "for": mtype, "note": "reserve (F2, empreintes)"}
            elif mtype in ("cmd.tts.speak", "cmd.tts.push", "cmd.tts.end", "cmd.tts.stop"):
                payload = _handle_tts(mtype, env.get("payload") or {})   # V7 : pilote la bouche (non-bloquant)
            elif mtype in ("cmd.listen.mute", "cmd.listen.resume"):
                # V7 archi 2 process : le routeur mute/reveille les oreilles (gate anti-auto-ecoute cross-process).
                global _listen_muted
                _listen_muted = (mtype == "cmd.listen.mute")
                payload = {"ok": True, "for": mtype, "muted": _listen_muted}
            else:
                payload = {"ok": True, "for": mtype}
            await send(_envelope("evt.ack", payload, corr=cid))
    finally:
        if drain_task is not None:
            drain_task.cancel()
            try:
                await drain_task
            except asyncio.CancelledError:
                pass
        if sub is not None and bus is not None:
            bus.unsubscribe(sub)
        request.app["ws_count"] -= 1
    return ws


def main() -> None:
    # Hook de TEST : sortie immediate (exerce le disjoncteur du superviseur). Isole du prod (F6).
    if TEST_HOOKS and os.environ.get("SIDECAR_CRASH") == "1":
        sys.exit(1)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    # argv[2] (optionnel) = jeton d'identite passe par le superviseur : present dans la LIGNE DE
    # COMMANDE pour que le nettoyage d'orphelins distingue CE sidecar d'un PID recycle (M2, garde
    # anti-recyclage). Non utilise fonctionnellement ici -- c'est un marqueur d'identite.
    app = web.Application()
    app["port"] = port
    app["ws_count"] = 0
    routes = [
        web.get("/health", health),
        web.get("/debug", debug),
        web.get("/ws", ws_handler),
    ]
    if TEST_HOOKS:
        routes.append(web.get("/debug/freeze", debug_freeze))
        routes.append(web.get("/debug/wake", debug_wake))   # V3 : injecte un eveil (E2E-V3) — jamais en prod
    app.add_routes(routes)

    async def _on_startup(a: web.Application) -> None:
        a["bus"] = EventBus(asyncio.get_running_loop())   # V2 : bus construit SUR la boucle (capture la loop)
        _start_audio(a["bus"])   # V0/V1 : capture ; V2 : + prise VAD (si SIDECAR_AUDIO active)

    async def _on_cleanup(_a: web.Application) -> None:
        _stop_audio()    # filet best-effort (arrêt propre de la boucle ; le vrai release T6 passe par cmd.shutdown)

    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
    print(f"[sidecar] IPC http://{HOST}:{port} (health,debug) + ws://{HOST}:{port}/ws", flush=True)
    try:
        web.run_app(app, host=HOST, port=port, print=None)
    except OSError as e:
        # Port vole entre le choix du superviseur (getFreePort) et ce bind (fenetre TOCTOU) : UNIQUEMENT
        # si l'adresse est deja utilisee (EADDRINUSE / WSAEADDRINUSE 10048). Code de sortie DISTINCT (3)
        # -> le superviseur ne retry-TOCTOU que sur ce cas (m11, #8) ; toute AUTRE OSError (permission...)
        # est un vrai echec -> exit 1 (pas de rafale de retries inutiles).
        addr_in_use = e.errno == errno.EADDRINUSE or getattr(e, "winerror", None) == 10048
        if addr_in_use:
            print(f"[sidecar] bind {HOST}:{port} deja utilise -> exit 3 (TOCTOU)", flush=True)
            sys.exit(3)
        print(f"[sidecar] erreur de demarrage ({e}) -> exit 1", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
