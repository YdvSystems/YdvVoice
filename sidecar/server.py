#!/usr/bin/env python
"""Sophia — sidecar (socle T2/T3) : le canal IPC.

Heberge, sur UN port (127.0.0.1 uniquement) :
  - REST : GET /health (vivant + pret) · GET /debug (sonder le socle sans client WS, curl)
  - WebSocket : /ws (le canal cmd/evt)
L'orchestrateur Node est le CLIENT.

Protocole : enveloppe {type, id, ts, payload}.
  - familles : cmd.* (orchestrateur -> sidecar) / evt.* (sidecar -> orchestrateur) ;
  - evt.* est EXTENSIBLE : un nouveau type d'evenement ne change PAS le protocole ;
  - correlation : une reponse evt.* reprend le MEME id que le cmd.* qu'elle reference.

Invariants (socle) :
  - localhost-only (bind 127.0.0.1) ;
  - l'AUDIO ne traverse JAMAIS ce canal (JSON de controle uniquement ; l'audio reste dans le
    chemin audio interne du sidecar, plan 01) ;
  - ecrivain unique = l'orchestrateur : ce sidecar ne tient aucune poignee de stockage (F2).
"""
import asyncio
import errno
import itertools
import json
import os
import sys
import time

from aiohttp import WSMsgType, web

HOST = "127.0.0.1"          # localhost-only (invariant socle)
DEFAULT_PORT = 8770
PROTOCOL_VERSION = 1
TEST_HOOKS = os.environ.get("SIDECAR_TEST_HOOKS") == "1"  # hooks de test JAMAIS actifs en prod

CMD_TYPES = ["cmd.shutdown", "cmd.enroll.push"]     # + cmd.listen.*, cmd.tts.*, cmd.model.* (plan 01)
EVT_TYPES = ["evt.health", "evt.ack", "evt.error"]  # + evt.wake, evt.vad.*, evt.stt.*, ...     (plan 01)

_ids = itertools.count(1)
_t0 = time.monotonic()
_state = {"frozen": False}  # hook de TEST (fige-mais-vivant), pilote par /debug/freeze


def _now_ms() -> float:
    return round(time.monotonic() * 1000, 3)  # emission monotone (ms)


def _envelope(mtype: str, payload: dict, corr=None) -> dict:
    return {
        "type": mtype,
        "id": corr if corr is not None else f"s{next(_ids)}",  # correlation : reprend l'id du cmd
        "ts": _now_ms(),
        "payload": payload,
    }


async def health(_request: web.Request) -> web.Response:
    if TEST_HOOKS and _state["frozen"]:  # hook de TEST (jamais en prod) : cesse de repondre (fige-mais-vivant)
        await asyncio.Event().wait()     # ne se resout jamais -> le battement du superviseur manque
    return web.json_response({"ok": True, "ready": True, "role": "sidecar", "stage": "T3"})


async def debug(request: web.Request) -> web.Response:
    app = request.app
    return web.json_response({
        "ok": True,
        "protocol_version": PROTOCOL_VERSION,
        "host": HOST,
        "port": app["port"],
        "uptime_s": round(time.monotonic() - _t0, 1),
        "ws_connections": app["ws_count"],
        "families": {"cmd": CMD_TYPES, "evt": EVT_TYPES},
        "audio_on_channel": False,  # invariant : l'audio ne traverse jamais l'IPC
    })


async def debug_freeze(_request: web.Request) -> web.Response:
    """Hook de TEST (registre seulement si SIDECAR_TEST_HOOKS=1) : fige ce sidecar."""
    _state["frozen"] = True
    return web.json_response({"frozen": True})


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    request.app["ws_count"] += 1
    await ws.send_json(_envelope("evt.health", {"ready": True, "role": "sidecar", "stage": "T3"}))
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                env = json.loads(msg.data)
            except (ValueError, TypeError):
                await ws.send_json(_envelope("evt.error", {"reason": "json invalide"}))
                continue
            mtype = env.get("type", "")
            cid = env.get("id")
            if not isinstance(mtype, str) or not mtype.startswith("cmd."):
                await ws.send_json(_envelope("evt.error", {"reason": "cmd.* attendu", "got": mtype}, corr=cid))
                continue
            if mtype == "cmd.shutdown":
                payload = {"ok": True, "for": mtype, "note": "arret gracieux = T6"}
            elif mtype == "cmd.enroll.push":
                payload = {"ok": True, "for": mtype, "note": "reserve (F2, empreintes)"}
            else:
                payload = {"ok": True, "for": mtype}
            await ws.send_json(_envelope("evt.ack", payload, corr=cid))
    finally:
        request.app["ws_count"] -= 1
    return ws


def main() -> None:
    # Hook de TEST : sortie immediate (exerce le disjoncteur du superviseur). Isole du prod (F6).
    if TEST_HOOKS and os.environ.get("SIDECAR_CRASH") == "1":
        sys.exit(1)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    # argv[2] (optionnel) = jeton d'identite passe par le superviseur : present dans la LIGNE DE
    # COMMANDE pour que le nettoyage d'orphelins distingue CE sidecar d'un PID recycle (M2, garde
    # anti-recyclage). Non utilise fonctionnellement ici -- c'est un marqueur d'identite.
    app = web.Application()
    app["port"] = port
    app["ws_count"] = 0
    routes = [
        web.get("/health", health),
        web.get("/debug", debug),
        web.get("/ws", ws_handler),
    ]
    if TEST_HOOKS:
        routes.append(web.get("/debug/freeze", debug_freeze))
    app.add_routes(routes)
    print(f"[sidecar] IPC http://{HOST}:{port} (health,debug) + ws://{HOST}:{port}/ws", flush=True)
    try:
        web.run_app(app, host=HOST, port=port, print=None)
    except OSError as e:
        # Port vole entre le choix du superviseur (getFreePort) et ce bind (fenetre TOCTOU) : UNIQUEMENT
        # si l'adresse est deja utilisee (EADDRINUSE / WSAEADDRINUSE 10048). Code de sortie DISTINCT (3)
        # -> le superviseur ne retry-TOCTOU que sur ce cas (m11, #8) ; toute AUTRE OSError (permission...)
        # est un vrai echec -> exit 1 (pas de rafale de retries inutiles).
        addr_in_use = e.errno == errno.EADDRINUSE or getattr(e, "winerror", None) == 10048
        if addr_in_use:
            print(f"[sidecar] bind {HOST}:{port} deja utilise -> exit 3 (TOCTOU)", flush=True)
            sys.exit(3)
        print(f"[sidecar] erreur de demarrage ({e}) -> exit 1", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
