# tests/fixtures/slow_ws_server.py — serveur WS a HANDSHAKE RETARDE (600 ms avant prepare) : simule un
# `IpcClient.connect` LENT, pendant lequel un respawn peut aboutir (e2e-v15 bloc A3 — croise conv 60,
# ROB-M1 : le respawn-PENDANT-le-build, la fenetre que le re-check de fin de build doit attraper).
# /health repond tout de suite (readiness) ; le WS reste vivant apres le handshake.
import asyncio
import sys

from aiohttp import web


async def ws(request):
    await asyncio.sleep(0.6)          # le handshake WS ne s'acheve qu'apres — l'`open` cote Node retarde d'autant
    w = web.WebSocketResponse()
    await w.prepare(request)
    async for _m in w:
        pass
    return w


async def health(_request):
    return web.json_response({"ready": True})


app = web.Application()
app.add_routes([web.get("/ws", ws), web.get("/health", health)])
web.run_app(app, host="127.0.0.1", port=int(sys.argv[1]), print=None)
