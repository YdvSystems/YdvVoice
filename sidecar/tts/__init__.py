# -*- coding: utf-8 -*-
"""Sophia — sidecar / TTS (plan 01, V7) : la BOUCHE. Voix A20 CPU (Piper), découpe en phrases, train
gen→play (trous=0), sortie audio. Contrat `cmd.tts.*` → `evt.tts.*` (doc `01` §2.2)."""
from tts.engine import PiperEngine, TtsEngine, voice_model_path
from tts.plug import NullOutput, Output, SdOutput, TtsPlug
from tts.split import clean_for_tts, split_sentences, split_stream
from tts.text import LEXICON, apply_lexicon, for_synth, normalize

__all__ = [
    "TtsPlug", "Output", "SdOutput", "NullOutput",
    "TtsEngine", "PiperEngine", "voice_model_path",
    "split_sentences", "split_stream", "clean_for_tts",
    "normalize", "apply_lexicon", "for_synth", "LEXICON",
]
