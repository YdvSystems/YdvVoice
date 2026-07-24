"""Sophia — sidecar / couche 2 : la prise EMBED (plan 02, M1 · 02-C).

BGE-M3 dense en ONNX (moteur TRANCHÉ+PROUVÉ au banc conv 62 : stack sidecar, zéro transformers, plus rapide
que torch). La prise calcule des vecteurs à la demande (cmd.embed -> evt.embed.done) ; JAMAIS le WAL (F2),
JAMAIS le cloud (A10). Le garde d'espace + « la base est la file » + le poison-row = CÔTÉ ORCHESTRATEUR (M1).
"""

from .engine import (EmbedEngine, OnnxBgeM3Engine,
                     EMBED_MODEL, EMBED_DIM, EMBED_PREPROC_REVISION, EMBED_MAX_TOKENS)
from .plug import EmbedPlug

__all__ = ["EmbedEngine", "OnnxBgeM3Engine", "EmbedPlug",
           "EMBED_MODEL", "EMBED_DIM", "EMBED_PREPROC_REVISION", "EMBED_MAX_TOKENS"]
