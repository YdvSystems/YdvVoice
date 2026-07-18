"""Consommateurs du ring (plan 01) : prises d'analyse qui lisent l'audio POST-AEC via un curseur
independant et emettent des evt.* normalises. V2 (conv 41) : le VAD (Silero). V3 (conv 42) : le reveil
retroactif (WakeGate) — rembobine a la marque VAD, premier mot jamais ampute. V4 (conv 43) : le STT
streaming (SttPlug, faster-whisper) + le portier d'eveil PAR PHRASE (le VRAI declencheur sur V3)."""
from .vad import VadPlug, VadEngine, SileroVadEngine, FRAME, THRESHOLD, MIN_SILENCE_MS
from .wake import WakeGate
from .stt import (SttPlug, SttEngine, FasterWhisperEngine, HypoBuffer,
                  match_opening, match_closing, is_goodnight, is_hallucination)

__all__ = ["VadPlug", "VadEngine", "SileroVadEngine", "FRAME", "THRESHOLD", "MIN_SILENCE_MS", "WakeGate",
           "SttPlug", "SttEngine", "FasterWhisperEngine", "HypoBuffer",
           "match_opening", "match_closing", "is_goodnight", "is_hallucination"]
