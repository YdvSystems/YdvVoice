"""Consommateurs du ring (plan 01) : prises d'analyse qui lisent l'audio POST-AEC via un curseur
independant et emettent des evt.* normalises. V2 (conv 41) : le VAD (Silero). V3 (conv 42) : le reveil
retroactif (WakeGate) — rembobine a la marque VAD, premier mot jamais ampute. V4 (conv 43) : le STT
streaming (SttPlug, faster-whisper) + le portier d'eveil PAR PHRASE (le VRAI declencheur sur V3). V5 (conv
45) : la fin de tour FINE (Smart Turn, TurnDetector) — elle laisse Yohann parler avec ses pauses sans le
couper -> evt.turn.end (branche dans le SttPlug, en conversation). V6 (conv 46) : le speaker-ID (SpeakerPlug,
ECAPA CPU) — « qui parle ? » -> evt.speaker (sert V8 barge-in module + V14 verrou d'affect)."""
from .vad import VadPlug, VadEngine, SileroVadEngine, FRAME, THRESHOLD, MIN_SILENCE_MS
from .wake import WakeGate
from .stt import (SttPlug, SttEngine, FasterWhisperEngine, HypoBuffer,
                  match_opening, match_closing, is_goodnight, is_hallucination)
from .turn import (TurnDetector, TurnEngine, SmartTurnEngine, effective_plafond, hold_reason,
                   TURN_THR, MIN_SPEECH_END, HELD_PLAFOND, HELD_CONF, ENDGRACE, PLAFOND, HANGING)
from .speaker import (SpeakerPlug, SpeakerEngine, EcapaEngine, SpeakerDetector, build_centroid,
                      cosine, decide, SPEAKER_THR, MIN_SPEECH_S, MAX_WIN_S, CAP_S, EVAL_EVERY_S,
                      MIN_SAMPLES, ANCHOR_CLIPS)

__all__ = ["VadPlug", "VadEngine", "SileroVadEngine", "FRAME", "THRESHOLD", "MIN_SILENCE_MS", "WakeGate",
           "SttPlug", "SttEngine", "FasterWhisperEngine", "HypoBuffer",
           "match_opening", "match_closing", "is_goodnight", "is_hallucination",
           "TurnDetector", "TurnEngine", "SmartTurnEngine", "effective_plafond", "hold_reason",
           "TURN_THR", "MIN_SPEECH_END", "HELD_PLAFOND", "HELD_CONF", "ENDGRACE", "PLAFOND", "HANGING",
           "SpeakerPlug", "SpeakerEngine", "EcapaEngine", "SpeakerDetector", "build_centroid",
           "cosine", "decide", "SPEAKER_THR", "MIN_SPEECH_S", "MAX_WIN_S", "CAP_S", "EVAL_EVERY_S",
           "MIN_SAMPLES", "ANCHOR_CLIPS"]
