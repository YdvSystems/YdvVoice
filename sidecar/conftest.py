"""Rend le dossier `sidecar/` importable pour pytest (from audio.ring import ..., from plugs.base import ...),
comme quand le superviseur lance `python sidecar/server.py` (sys.path[0] = sidecar/)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
