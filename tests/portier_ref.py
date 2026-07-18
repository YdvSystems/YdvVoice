# Référence de PARITÉ du portier (V7 morceau C) — expose les fonctions PURES du VRAI portier sidecar
# (`sidecar/consumers/stt.py`) pour que `tests/u-portier-parity.mjs` prouve que la grille TS
# (`src/orchestrator/voice/portier.ts`) rend un verdict IDENTIQUE (« testée identique au portier », plan/01).
#
# Import DIRECT du module (importlib) — SANS passer par `consumers/__init__.py` qui tire le lourd
# (torch/onnxruntime/speechbrain). stt.py au niveau module n'importe que queue/re/unicodedata/numpy/plugs.base
# (léger). Lit des transcripts JSON-encodés (un par ligne, stdin) → écrit un verdict JSON par ligne (stdout).
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "sidecar"))  # pour `from plugs.base import ConsumerPlug` dans stt.py

spec = importlib.util.spec_from_file_location("stt_portier_ref", os.path.join(ROOT, "sidecar", "consumers", "stt.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

for line in sys.stdin:
    line = line.rstrip("\n")
    if not line:
        continue
    t = json.loads(line)  # transcript (string), JSON-encodé → unicode/newlines sûrs
    out = {
        "norm": mod._norm(t),
        "opening": bool(mod.match_opening(t)),
        "closing": bool(mod.match_closing(t)),
        "goodnight": bool(mod.is_goodnight(t)),
        "halluc": bool(mod.is_hallucination(t)[0]),
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()
