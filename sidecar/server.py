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

# ── Chemin audio (plan 01, V0->V1) — OPT-IN via SIDECAR_AUDIO=1 ──────────────────────────────────────
# Les tests socle NE l'activent PAS -> aucun micro ouvert, aucun import numpy/scipy/pyaudiowpatch/pyaec (le
# sidecar socle reste leger et rapide). L'audio est RAM sidecar (ring buffer) : il ne traverse JAMAIS le
# canal (invariant socle). Import PARESSEUX (au demarrage seulement si demande).
#   "1"        = PROD  : micro + loopback systeme -> AEC SpeexDSP en tete -> ring POST-AEC (V1)
#   "test"     = E2E-V0 : chemin V0 (capture unique micro -> ring), source synthetique MONO (contrat V0 fige)
#   "test-aec" = E2E-V1 : chemin V1 AEC (near+ref -> annulation -> ring), source synthetique DUPLEX
AUDIO_ON = os.environ.get("SIDECAR_AUDIO") in ("1", "test", "test-aec")
RING_SECONDS = 30                       # fenetre du ring (rembobinage pre-wake + marge) ; ~1 Mo a 16 kHz
_audio = {"ring": None, "capture": None}


def _start_audio() -> None:
    """PROD (V1) : ouvre le micro + le loopback UNE fois -> AEC en tete -> ring 16 kHz POST-AEC. Non-fatal :
    sans peripherique, le sidecar VIT sans oreilles (degrade, jamais un crash — cf. superviseur socle) ; sans
    loopback, il vit « sans reference » (AEC en passthrough)."""
    if not AUDIO_ON:
        return
    if _audio.get("capture") is not None:
        return   # Fid#4 : idempotent — jamais un 2e micro/2e ecrivain (invariant capture unique / SPMC)
    mode = os.environ.get("SIDECAR_AUDIO")
    try:
        from audio import RingBuffer   # lazy : numpy/scipy/soxr/pyaudiowpatch/pyaec seulement si demande
        ring = RingBuffer(RING_SECONDS * 16000)
        if mode == "test":
            from audio import AudioCapture
            from audio.test_source import SyntheticToneSource   # E2E-V0 : micro synthetique 48 kHz (jamais en prod)
            cap = AudioCapture(ring, source_factory=lambda a, b: SyntheticToneSource(a, b))
        elif mode == "test-aec":
            from audio import AecCapture, EchoCanceller
            from audio.test_source import SyntheticDuplexSource   # E2E-V1 : near(echo+voix)+ref(far-end) (jamais en prod)
            cap = AecCapture(ring, EchoCanceller(), source_factory=lambda n, r, o: SyntheticDuplexSource(n, r, o))
        else:
            from audio import AecCapture, EchoCanceller
            cap = AecCapture(ring, EchoCanceller())   # PROD : WasapiDuplexSource (micro + loopback) + AEC
        cap.start()
        _audio["ring"], _audio["capture"] = ring, cap
        label = "V0 (micro)" if mode == "test" else "V1 (micro + loopback -> AEC)"
        print(f"[sidecar] audio {label} : ring {RING_SECONDS}s @ 16 kHz POST-AEC", flush=True)
    except Exception as e:
        print(f"[sidecar] audio indisponible ({type(e).__name__}: {e}) — vivant sans oreilles", flush=True)


def _stop_audio() -> None:
    """Libere le micro (release-and-wait T6 : AVANT l'ack de cmd.shutdown). Idempotent, y compris SOUS
    concurrence (S#1 re-croise) : on annule la ref AVANT le stop() bloquant -> un 2e appel (2e cmd.shutdown,
    ou _on_cleanup) voit None et ne relance PAS un terminate() concurrent sur le meme handle PyAudio."""
    cap = _audio.pop("capture", None)   # ATOMIQUE (GIL) : get-and-clear -> un seul appelant obtient la capture
    _audio.pop("ring", None)            # (un get()+set() garderait une fenetre de race entre les deux threads)
    if cap is not None:
        try:
            cap.stop()
        except Exception:
            pass


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
    # S#2 (re-croise) : figer les refs UNE fois. `_stop_audio` tourne dans un executor (autre thread) et met
    # `_audio["ring"]/["capture"]` a None ; un check-then-use `_audio.get("ring") ... _audio["ring"].x` planterait
    # (None.write_pos()) si le thread bascule entre la garde et l'acces. La ref locale reste valide.
    ring = _audio.get("ring")
    cap = _audio.get("capture")
    return web.json_response({
        "ok": True,
        "protocol_version": PROTOCOL_VERSION,
        "host": HOST,
        "port": app["port"],
        "uptime_s": round(time.monotonic() - _t0, 1),
        "ws_connections": app["ws_count"],
        "families": {"cmd": CMD_TYPES, "evt": EVT_TYPES},
        "audio_on_channel": False,  # invariant : l'audio ne traverse jamais l'IPC
        "audio": {                  # V0 : etat du chemin audio (RAM sidecar) — sonde du micro/ring
            "enabled": cap is not None,
            "captured_samples": ring.write_pos() if ring is not None else 0,
            "rate": 16000,
            "stats": cap.stats if cap is not None else {},  # R#3 : pertes capture visibles
        },
    })


async def debug_freeze(_request: web.Request) -> web.Response:
    """Hook de TEST (registre seulement si SIDECAR_TEST_HOOKS=1) : fige ce sidecar."""
    _state["frozen"] = True
    return web.json_response({"frozen": True})


async def graceful_release() -> None:
    """T6 — libération COOPÉRATIVE, exécutée AVANT l'ack de cmd.shutdown (release-and-wait, lettre de
    plan/00 T6) : on libère les ressources, on NE SORT PAS ; l'orchestrateur termine ensuite le process
    (SIGTERM->SIGKILL).

    POURQUOI ICI et pas dans un handler de signal : sur Windows, SIGTERM = TerminateProcess, non catchable
    (mesuré au banc t6) -> un handler de signal ne tournerait JAMAIS. La libération GPU gracieuse ne peut
    donc se faire que par ce chemin coopératif (cmd.shutdown), avant le kill forceful.

    V0 : libère le MICRO (premier contenu réel de cette fonction) ; le release du contexte CUDA + le flush
    des modèles/latents s'ajouteront ICI en V1->V15, même fonction, sans changer le protocole ni l'orchestrateur.
    """
    # R#4 : `_stop_audio` fait des appels C bloquants (stop_stream/close/terminate) ; si un driver WASAPI
    # hangue sur terminate(), les exécuter SUR la boucle asyncio la gèlerait (plus de /health, plus d'ack).
    # On les sort dans un executor, borné : la boucle reste vivante ; le filet T6 (SIGKILL) couvre un hang réel.
    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(loop.run_in_executor(None, _stop_audio), timeout=2.0)
        print("[sidecar] cmd.shutdown : graceful_release (V0 : micro libéré ; CUDA/flush viendront en V1->V15)", flush=True)
    except asyncio.TimeoutError:
        print("[sidecar] graceful_release : libération audio > 2 s (driver figé ?) -> on continue (T6 couvre)", flush=True)


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
                await graceful_release()  # T6 : libere CUDA + flush AVANT d'acquitter (release-and-wait)
                payload = {"ok": True, "for": mtype, "note": "ressources liberees, pret a etre termine"}
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

    async def _on_startup(_a: web.Application) -> None:
        _start_audio()   # V0 : ouvre le micro (si SIDECAR_AUDIO=1) une fois le serveur prêt

    async def _on_cleanup(_a: web.Application) -> None:
        _stop_audio()    # filet best-effort (arrêt propre de la boucle ; le vrai release T6 passe par cmd.shutdown)

    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
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
