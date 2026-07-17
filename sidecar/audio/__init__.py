"""Chemin audio du sidecar (plan 01) : capture unique -> conversion 16 kHz mono -> ring buffer rembobinable.
V0 (conv 39) : micro -> ring. V1 (conv 40) : AEC en tete (near=micro, ref=loopback) -> ring POST-AEC."""
from .ring import RingBuffer, RingCursor
from .capture import (
    AudioCapture, WasapiMicSource, to_16k_mono, to_mono_f32,
    WasapiDuplexSource, AecCapture,
)
from .aec import EchoCanceller

__all__ = [
    "RingBuffer", "RingCursor", "AudioCapture", "WasapiMicSource", "to_16k_mono", "to_mono_f32",
    "WasapiDuplexSource", "AecCapture", "EchoCanceller",
]
