"""U-V8 (plan 01) — BARGE-IN module par le locuteur (« la couper quand on lui parle »).

Le barge-in DECIDE dans le routeur (tests/u-router.mjs, V8-A..D : Yohann coupe / son residu ne coupe pas / phrase
fixe protegee / repos). Le SIDECAR fournit DEUX choses, testees ICI (deterministe, sans GPU) :

  1) le GATE 3 etats (resume/arm/mute) — les predicats `_vad_gate`/`_stt_gate` de server.py + leur EFFET sur les
     VRAIES prises :
       - `arm` (sa pensee developpee) : le VAD TOURNE (il nourrit V6 -> barge-in) MAIS le STT est GATE (jamais
         d'auto-transcription de son residu post-AEC) ;
       - `mute` (phrase fixe) : tout gate (pas de barge-in : on ne coupe pas sa salutation) ;
       - `resume` (ecoute normale) : VAD + STT actifs.
  2) la CAPTURE RETROACTIVE — une marque de barge injectee (== `cmd.listen.resume {from}` -> `stt.on_vad` start)
     ouvre un groupe A CETTE MARQUE et transcrit la phrase interruptrice (l'AEC ayant annule SA voix -> propre).

Le coeur reel (VRAI ECAPA qui score Yohann par-dessus sa voix) = e2e:v6/e2e:v8 + le juge a ta voix.
"""
import numpy as np

import server                                            # V8 : les predicats de gate 3 etats (server-level)
from audio.ring import RingBuffer
from consumers.stt import SttPlug, RETRO_MAX_S
from consumers.vad import FRAME

from test_v2 import _mk, _pump                            # harnais VAD (ring + prise scriptee + _pump)
from test_v4 import ScriptedSttEngine, FakeWake, _collect, _sil, _noise, _run, _GateStub  # harnais STT

RATE = 16000


# ══════════ Le GATE 3 etats — les predicats server (le coeur V8 cote sidecar) ══════════

def test_gate_predicates_three_states():
    # LE TEST MORD : le VAD ne doit etre gate QU'EN `mute` (il TOURNE en `arm` pour nourrir V6) ; le STT est gate
    # DES qu'elle parle (`arm` OU `mute`). Repasser `_vad_gate` a l'ancien booleen `mode != "resume"` (muter le VAD
    # en arm) tuerait le barge-in : V6 ne verrait jamais Yohann -> ce test devient ROUGE.
    try:
        server._listen_mode = "resume"
        assert server._vad_gate() is False and server._stt_gate() is False   # ecoute normale : tout actif
        server._listen_mode = "arm"
        assert server._vad_gate() is False, "le VAD doit TOURNER en arm (nourrir V6 -> barge-in)"
        assert server._stt_gate() is True, "le STT doit etre GATE en arm (pas d'auto-transcription du residu)"
        server._listen_mode = "mute"
        assert server._vad_gate() is True and server._stt_gate() is True     # phrase fixe : tout gate, pas de barge-in
    finally:
        server._listen_mode = "resume"


# ══════════ arm/mute cote VAD — il nourrit V6 en `arm`, il se tait en `mute` ══════════

def test_arm_mode_vad_runs_feeding_v6():
    # EN `arm`, le VAD n'est PAS mute : il tourne et emet evt.vad.* -> le speaker V6 (piloté-VAD) est nourri, le
    # barge-in devient possible. On cable le VRAI predicat server._vad_gate. LE TEST MORD : si `arm` mutait le VAD,
    # aucun evt.vad.* -> V6 aveugle -> pas de barge-in.
    try:
        server._listen_mode = "arm"
        _ring, plug, _eng, events = _mk([None, "start", None, None, "end", None])
        plug.set_gate(server._vad_gate)
        _pump(plug, [np.full(FRAME, 1000, dtype=np.int16) for _ in range(6)])
        assert plug.state["muted"] is False, "le VAD a ete mute en arm (V6 n'aurait rien vu)"
        assert [e[0] for e in events] == ["evt.vad.start", "evt.vad.stop"], "le VAD n'a pas tourne en arm"
    finally:
        server._listen_mode = "resume"


def test_mute_mode_mutes_vad():
    # EN `mute` (phrase fixe : salutation/cloture), le VAD IGNORE le micro -> tout l'aval (dont V6) est coupe : on
    # ne coupe pas sa salutation. LE TEST MORD : si `mute` laissait le VAD tourner, un evt.vad.* fuirait.
    try:
        server._listen_mode = "mute"
        _ring, plug, _eng, events = _mk(["start", "start", "start"])
        plug.set_gate(server._vad_gate)
        _pump(plug, [np.full(FRAME, 1000, dtype=np.int16) for _ in range(4)])
        assert plug.state["muted"] is True and events == [], "le VAD a fui pendant une phrase fixe (mute)"
    finally:
        server._listen_mode = "resume"


# ══════════ arm/resume cote STT — gate en `arm` (pas d'auto-transcription), actif en `resume` ══════════

def test_arm_mode_stt_gated_no_self_transcription():
    # EN `arm`, le STT est GATE : un groupe ouvert est ABANDONNE (fidele au _flush_audio du banc) -> jamais son
    # residu post-AEC transcrit en tour parasite. On cable le VRAI predicat server._stt_gate + on met le mode `arm`.
    # LE TEST MORD : si `arm` laissait le STT tourner, un final (« residu parasite ») serait emis.
    try:
        ring = RingBuffer(30 * RATE)
        events, emit = _collect()
        wake = FakeWake(); wake.armed = True                 # conversation en cours (elle dit sa pensee)
        plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("residu parasite."))
        plug.set_gate(server._stt_gate)
        server._listen_mode = "arm"
        ring.write(_sil(0.3)); s1 = ring.write_pos()
        ring.write(_noise(0.8)); e1 = ring.write_pos()
        plug.on_vad("evt.vad.start", {"pos": s1})
        plug.on_vad("evt.vad.stop", {"pos": e1})
        _run(plug)
        assert plug._aborts >= 1, "le groupe n'a pas ete abandonne en arm (STT non gate)"
        assert [p for t, p in events if t == "evt.stt.final"] == [], "un residu parasite a ete transcrit en arm"
    finally:
        server._listen_mode = "resume"


def test_resume_mode_stt_transcribes_normally():
    # EN `resume` (ecoute normale, retour au repos apres une coupe/une phrase), le STT n'est PAS gate : un groupe
    # est transcrit normalement. Complement de l'arm ci-dessus (meme predicat server._stt_gate, mode resume).
    try:
        server._listen_mode = "resume"
        ring = RingBuffer(30 * RATE)
        events, emit = _collect()
        wake = FakeWake(); wake.armed = True
        plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("une reponse claire."))
        plug.set_gate(server._stt_gate)
        ring.write(_sil(0.3)); s = ring.write_pos()
        ring.write(_noise(0.8)); e = ring.write_pos()
        ring.write(_sil(3.4))                                # >= GROUP_SILENCE 3,0 (armee) -> finalise
        plug.on_vad("evt.vad.start", {"pos": s})
        plug.on_vad("evt.vad.stop", {"pos": e})
        _run(plug)
        assert plug._aborts == 0, "un groupe a ete abandonne en resume (STT gate a tort)"
        finals = [p for t, p in events if t == "evt.stt.final"]
        assert len(finals) == 1 and finals[0]["mark"] == s
    finally:
        server._listen_mode = "resume"


# ══════════ La CAPTURE RETROACTIVE — la phrase interruptrice de Yohann n'est pas perdue ══════════

def test_retroactive_capture_from_barge_mark():
    # Apres une coupe, le routeur envoie cmd.listen.resume {from: marque} -> le serveur injecte
    # `stt.on_vad("evt.vad.start", {pos: marque})`. Le STT rembobine A LA MARQUE et transcrit la phrase
    # interruptrice de Yohann (l'AEC ayant annule SA voix sur ce segment -> transcription propre). On reproduit
    # l'injection + la fin naturelle du VAD (Yohann pause). LE TEST MORD : sans l'injection, aucun groupe -> aucun
    # final avec la marque du barge -> la suite de Yohann serait perdue.
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake(); wake.armed = True                     # conversation (elle vient d'etre coupee ; toujours armee)
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("non attends plutot ceci."))
    ring.write(_sil(0.3)); barge_mark = ring.write_pos()
    ring.write(_noise(1.0)); barge_stop = ring.write_pos()   # la phrase interruptrice de Yohann
    ring.write(_sil(3.4))                                     # >= GROUP_SILENCE 3,0 (armee) -> finalise
    plug.retro_capture(barge_mark)                           # == injection serveur (resume {from}) : CHAMP DEDIE, robuste
    plug.on_vad("evt.vad.stop", {"pos": barge_stop})         # == fin naturelle du VAD (Yohann pause) -> borne le groupe
    _run(plug)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert len(finals) == 1, "aucun tour finalise apres la capture retroactive"
    assert finals[0]["mark"] == barge_mark, "le groupe ne demarre pas A LA MARQUE du barge (capture non retroactive)"
    assert "attends" in finals[0]["text"].lower(), "la phrase interruptrice de Yohann n'est pas capturee"
    assert plug._retro_captures == 1


def test_retro_survives_concurrent_abort():
    # R-1 (croisé conv 49) : la marque de barge passe par un CHAMP DEDIE (`_retro_pending`), PAS la file `_cmds` ->
    # un `_abort_group` concurrent (qui draine `_cmds` via `_discard_cmds`) ne peut PAS la jeter. On reproduit : un
    # groupe stale est ABORTE (gate = SA voix) au tick meme ou la capture retroactive est posee -> elle DOIT survivre
    # et ouvrir le groupe au resume. LE TEST MORD : router `retro_capture` par `_cmds` (l'ancienne voie on_vad) ->
    # l'abort la jette -> aucun final avec la marque du barge.
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake(); wake.armed = True
    gate = _GateStub(value=True)                             # SA voix joue -> un groupe ouvert est aborte
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("la suite de yohann."))
    plug.set_gate(gate)
    ring.write(_sil(0.3)); s1 = ring.write_pos()
    ring.write(_noise(0.6)); e1 = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s1})
    plug.on_vad("evt.vad.stop", {"pos": e1})
    barge_mark = e1
    plug.retro_capture(barge_mark)                           # champ dedie (pas _cmds) — pose AVANT l'abort
    plug._tick()                                             # gate=True : ouvre le groupe stale PUIS l'aborte (draine _cmds)
    assert plug._aborts >= 1, "le groupe stale n'a pas ete aborte (le _discard_cmds n'a pas tourne)"
    # 2) resume : la capture retroactive a SURVECU a l'abort -> audio de Yohann -> elle finalise a la marque du barge
    gate.value = False
    ring.write(_noise(1.0)); barge_stop = ring.write_pos()
    ring.write(_sil(3.4))
    plug.on_vad("evt.vad.stop", {"pos": barge_stop})
    _run(plug)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert plug._retro_captures == 1, "la capture retroactive a ete jetee par l'abort (R-1)"
    assert len(finals) == 1 and finals[0]["mark"] == barge_mark, "la suite de Yohann est perdue (R-1)"


def test_retro_finalizes_without_stop_via_safety_net():
    # R-2 (croisé conv 49) : si AUCUN vad.stop reel ne borne le groupe retroactif (Yohann s'est tu juste apres le
    # barge, ou le stop a ete jete), le FILET auto-borne (RETRO_MAX) le finalise quand meme -> jamais un groupe qui
    # lit le silence a l'infini. LE TEST MORD : on ouvre un retro SANS jamais fournir de vad.stop ; sans le filet, le
    # groupe reste `_reading` sans borne -> aucun final (le test echoue).
    ring = RingBuffer(int((RETRO_MAX_S + 3) * RATE))
    events, emit = _collect()
    wake = FakeWake(); wake.armed = True
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("interruption de yohann."))
    ring.write(_sil(0.3)); barge_mark = ring.write_pos()
    ring.write(_noise(0.8))                                  # la phrase de Yohann
    ring.write(_sil(RETRO_MAX_S + 1.0))                      # PAS de vad.stop -> SEUL le filet peut finaliser
    plug.retro_capture(barge_mark)
    _run(plug, ticks=300)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert len(finals) == 1, "le groupe retroactif n'a JAMAIS finalise sans vad.stop (R-2 : lecture du silence a l'infini)"
    assert finals[0]["mark"] == barge_mark
    assert plug._retro_captures == 1
