# -*- coding: utf-8 -*-
"""Sophia — sidecar / TTS : le moteur de voix, derrière un contrat INJECTABLE (plan 01, V7 · 01-F).

`TtsEngine` = le contrat (synth d'une phrase → audio) ; le moteur concret vit derrière et ne fuit jamais
dans le protocole (changer de moteur = config + respawn, mêmes `evt.tts.*`, V15). prod = `PiperEngine`
(voix A20 CPU, fine-tune conv 33-34) ; test = moteur scripté déterministe (la logique de la prise se teste
sans Piper ni audio réel — parité `SttEngine`/`SpeakerEngine`).

FIDÈLE au banc `bancs/aec/bouche_piper.Mouth` (règle perf, prouvé b3 conv 47 : RTF 0,035-0,043 < banc 0,06,
SR 22050) : `for_synth` (normalize+lexique) → `_generate` (concatène les chunks Piper) → `_polish` (fondu
anti-clic 12 ms in / 60 ms out + 100 ms de release). Import Piper PARESSEUX (module importable sans lui —
tests de logique pure). Moteur A20 = ÉCART A9/A20 tracé `01` §7 (pas Kokoro ; le timbre porte le caractère).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from tts.text import for_synth

# Voix de Sophia (fine-tune A20 sur Piper, conv 33-34). Vendorisée offline `resources/models/voice/`
# (gitignoré, conv 39). speaker 0 = « sophia » (archi multi de la base conservée). Bascule e390 = 1 ligne.
DEFAULT_VOICE = "fr_FR-a20-e400"
DEFAULT_SPEAKER = 0
A20_SAMPLE_RATE = 22050          # SR du modèle A20 (confirmé b3 conv 47) — défaut avant chargement


def voice_model_path(voice: str = DEFAULT_VOICE) -> Path:
    """Chemin du `.onnx` A20, ancré sur l'emplacement du module (robuste au cwd) : racine repo = parents[2]."""
    return Path(__file__).resolve().parents[2] / "resources" / "models" / "voice" / f"{voice}.onnx"


class TtsEngine:
    """Contrat moteur TTS (injectable). `synth(text)` → audio float32 mono @ `sample_rate` (déjà monté) ;
    `warm()` pré-charge le modèle (LÈVE si absent → l'appelant dégrade honnêtement)."""

    sample_rate: int = A20_SAMPLE_RATE

    def synth(self, text: str) -> np.ndarray:
        raise NotImplementedError

    def warm(self) -> None:
        pass


class PiperEngine(TtsEngine):
    """Voix A20 CPU (Piper). Charge le `.onnx` une fois (`warm`), synthétise + monte une phrase. Le GPU
    reste au STT (RTF ~0,04, CPU — sa bouche ne vole rien à ses oreilles). Import Piper paresseux."""

    def __init__(self, voice: str = DEFAULT_VOICE, speaker: int = DEFAULT_SPEAKER):
        self._voice_name = voice
        self._speaker = speaker
        self._voice = None
        self._syn = None
        self.sample_rate = A20_SAMPLE_RATE   # affiné au warm (config.sample_rate réel)

    def warm(self) -> None:
        if self._voice is not None:
            return
        from piper import PiperVoice                      # paresseux (module importable sans piper)
        from piper.config import SynthesisConfig
        model = voice_model_path(self._voice_name)
        if not model.exists():
            raise FileNotFoundError(f"voix A20 absente : {model}")
        self._voice = PiperVoice.load(str(model))         # CPU (rapide, libère le GPU)
        self._syn = SynthesisConfig(speaker_id=self._speaker)
        self.sample_rate = int(self._voice.config.sample_rate)
        # WARMUP (parité bouche_piper + warmup STT conv 44) : une synthèse jetable sort la latence de
        # première inférence du chemin de mesure (le 1er vrai « bonjour » ne la paie pas). Best-effort.
        try:
            self._generate("Bonjour.")
        except Exception:
            pass

    def _generate(self, text: str) -> np.ndarray:
        """Piper streame par morceaux (AudioChunk) ; on concatène le flottant brut → une phrase entière."""
        chunks = [np.asarray(ch.audio_float_array, dtype=np.float32).flatten()
                  for ch in self._voice.synthesize(text, syn_config=self._syn)]
        if not chunks:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(chunks) if len(chunks) > 1 else chunks[0]

    def _polish(self, audio: np.ndarray) -> np.ndarray:
        """Montage léger (fidèle banc) : fondu d'entrée (anti-clic) + fondu de sortie + court release."""
        a = audio.astype(np.float32).copy()
        fi, fo = int(0.012 * self.sample_rate), int(0.060 * self.sample_rate)   # 12 ms in · 60 ms out
        if len(a) > fi + fo:
            a[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
            a[-fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
        tail = np.zeros(int(0.10 * self.sample_rate), dtype=np.float32)         # 100 ms de release
        return np.concatenate([a, tail])

    def synth(self, text: str) -> np.ndarray:
        """Texte (brut) → audio float32 mono @ sample_rate (monté). Pipeline AVANT Piper : `for_synth`
        (normalize chiffres/dates → mots, puis lexique noms → phonétique)."""
        self.warm()
        return self._polish(self._generate(for_synth(text)))
