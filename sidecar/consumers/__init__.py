"""Consommateurs du ring (plan 01) : prises d'analyse qui lisent l'audio POST-AEC via un curseur
independant et emettent des evt.* normalises. V2 (conv 41) : le VAD (Silero). V3 (conv 42) : le reveil
retroactif (WakeGate) — rembobine a la marque VAD, premier mot jamais ampute."""
from .vad import VadPlug, VadEngine, SileroVadEngine, FRAME, THRESHOLD, MIN_SILENCE_MS
from .wake import WakeGate

__all__ = ["VadPlug", "VadEngine", "SileroVadEngine", "FRAME", "THRESHOLD", "MIN_SILENCE_MS", "WakeGate"]
