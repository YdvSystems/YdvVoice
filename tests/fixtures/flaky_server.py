# tests/fixtures/flaky_server.py — sidecar VOLONTAIREMENT défaillant au 1er lancement (e2e-boot-respawn, conv 56).
#
# 1er spawn : pose le marqueur (env FLAKY_MARKER) puis sort en ÉCHEC (exit 1 — jamais 3, qui serait un retry
# TOCTOU du superviseur, pas un vrai crash). Spawns SUIVANTS : délègue au VRAI sidecar/server.py (mêmes argv
# port/token, même cwd repo). Reproduit « l'oreille hoquette une fois au boot puis revit » — le scénario du bug
# « boot sans voix » de conv 55 (pipeline one-shot jamais reconstruit au respawn).
import os
import runpy
import sys

marker = os.environ.get("FLAKY_MARKER")
if marker and not os.path.exists(marker):
    with open(marker, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    sys.exit(1)

# server.py importe ses modules (`from bus import …`) relativement à SON dossier — lancé directement, c'est
# sys.path[0] ; via runpy depuis ici, il faut l'y mettre nous-mêmes.
sidecar_dir = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sidecar"))
sys.path.insert(0, sidecar_dir)
runpy.run_path(os.path.join(sidecar_dir, "server.py"), run_name="__main__")
