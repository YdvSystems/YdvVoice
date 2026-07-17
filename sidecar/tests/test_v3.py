"""U-V3 (plan 01) — le REVEIL RETROACTIF : `seek_to` (ring) + `WakeGate` (rembobinage a la marque VAD).

Deux etages, comme test_v2 :
  - PLOMBERIE (deterministe, marque CONTROLEE) : `seek_to` (place a une position absolue, clampe, signale la
    troncature), observation des marques VAD, S12 (2e eveil = no-op), le CAS DUR (un nouveau segment a demarre
    -> la marque FOURNIE gagne), mode generique, garde d'honnetete (marque hors fenetre) ;
  - COEUR REEL (le VRAI Silero pose la marque) : la preuve F1 « premier mot jamais ampute » — on rembobine a
    la marque du vrai moteur et l'audio recupere = le buffer depuis la marque (octet-a-octet), la marque tombe
    AU DEBUT de la parole (pas noyee dans le silence, pas au milieu = ampute). « Vraie marque » = anti-facilite
    NIT-5 : la preuve du coeur ne repose PAS sur une marque fabriquee par un moteur scripte. (Le chemin AEC
    COMPLET — source -> AEC -> ring -> VAD -> reveil -> bus -> WS — est prouve, lui, par l'E2E `test-wake` ; ce
    pytest ecrit le buffer directement dans le ring pour ISOLER la preuve « rembobinage fidele a la marque ».)
"""
import threading
import time

import numpy as np

from audio.ring import RingBuffer
from consumers.vad import VadPlug, SileroVadEngine
from consumers.wake import WakeGate


def _collect():
    """Collecteur d'evt.* thread-safe (parite test_v2)."""
    events, lock = [], threading.Lock()

    def emit(etype, payload):
        with lock:
            events.append((etype, dict(payload)))
    return events, emit


# ══════════ seek_to — le primitif de rembobinage a une position ABSOLUE ══════════

def test_seek_to_places_cursor_at_absolute_position():
    ring = RingBuffer(16000)
    ring.write(np.zeros(8000, dtype=np.int16))
    c = ring.cursor()                       # au bord d'attaque (pos 8000)
    truncated = c.seek_to(3000)
    assert c.position == 3000 and truncated == 0


def test_seek_to_clamps_out_of_window_and_reports_truncation():
    # LE TEST MORD : la marque a ete ECRASEE (hors fenetre) -> curseur clampe a oldest ET truncated = la perte
    # a gauche (jamais pretendre « premier mot intact » si faux). Sans _clamp_seek qui calcule la troncature,
    # ce test echoue.
    ring = RingBuffer(1000)
    ring.write(np.zeros(3000, dtype=np.int16))   # oldest = 3000 - 1000 = 2000 ; write_pos = 3000
    c = ring.cursor()
    truncated = c.seek_to(500)                    # 500 < oldest 2000
    assert c.position == 2000                     # clampe au plus vieux disponible
    assert truncated == 1500                      # 2000 - 500 echantillons perdus a gauche


def test_seek_to_clamps_future_to_latest_without_truncation():
    ring = RingBuffer(16000)
    ring.write(np.zeros(4000, dtype=np.int16))
    c = ring.cursor()
    truncated = c.seek_to(99999)                  # futur non ecrit (cas anormal)
    assert c.position == 4000 and truncated == 0  # clampe au present, PAS une troncature a gauche


def test_seek_to_negative_mark_is_bounded_not_inflated():
    # R-4 (croise robustesse) : une position NEGATIVE (absurde) est bornee a 0 -> truncated EXACT, jamais
    # gonfle de |pos| (avant le fix, seek_to(-5) rendait truncated=5 sur un ring frais). Reproduit au banc.
    ring = RingBuffer(16000)
    ring.write(np.zeros(4000, dtype=np.int16))    # oldest = 0
    c = ring.cursor()
    truncated = c.seek_to(-5)
    assert c.position == 0 and truncated == 0     # borne a 0, PAS truncated=5


# ══════════ WakeGate — observation des marques VAD ══════════

def test_wake_observes_only_vad_start():
    ring = RingBuffer(16000)
    _events, emit = _collect()
    w = WakeGate(ring, emit)
    w.observe("evt.vad.stop", {"pos": 100})       # une FIN de segment n'est pas une marque de debut
    assert w.state["last_mark"] is None
    w.observe("evt.vad.start", {"pos": 512})
    assert w.state["last_mark"] == 512
    w.observe("evt.vad.start", {"nope": 1})       # payload malforme -> ignore, JAMAIS d'exception (thread VAD)
    assert w.state["last_mark"] == 512


# ══════════ WakeGate — rembobinage nominal (marque FOURNIE) ══════════

def test_wake_rewinds_to_provided_mark_and_emits():
    ring = RingBuffer(16000)
    ring.write((np.arange(8000) % 100).astype(np.int16))   # audio deterministe connu
    events, emit = _collect()
    w = WakeGate(ring, emit)
    cur = w.on_wake(mark=2000)
    assert cur is not None and cur.position == 2000
    assert [t for t, _ in events] == ["evt.wake"]
    assert events[0][1]["pos"] == 2000 and events[0][1]["truncated"] == 0
    assert events[0][1]["captured_at"] is not None
    # rembobinage FIDELE : l'audio depuis le curseur == le buffer depuis la marque
    data, _ov = cur.read(500)
    assert np.array_equal(data, (np.arange(2000, 2500) % 100).astype(np.int16))


def test_wake_nominal_uses_provided_mark_not_latest():
    # CAS DUR (facilite #2 corrigee) : un NOUVEAU segment VAD a demarre entre la fin de la phrase et le signal
    # d'eveil -> la marque FOURNIE par le declencheur (le bon segment) gagne, PAS « la derniere suivie ».
    ring = RingBuffer(16000)
    ring.write(np.zeros(9000, dtype=np.int16))
    events, emit = _collect()
    w = WakeGate(ring, emit)
    w.observe("evt.vad.start", {"pos": 1000})     # segment d'eveil
    w.observe("evt.vad.start", {"pos": 8000})     # NOUVEAU segment (Yohann enchaine)
    cur = w.on_wake(mark=1000)                     # le portier (STT V4) fournit la marque du BON segment
    assert cur.position == 1000                    # pas 8000
    assert events[0][1]["pos"] == 1000


# ══════════ WakeGate — S12 (auto-transition unique) ══════════

def test_wake_s12_second_wake_noop_until_release():
    ring = RingBuffer(16000)
    ring.write(np.zeros(4000, dtype=np.int16))
    events, emit = _collect()
    w = WakeGate(ring, emit)
    assert w.on_wake(mark=1000) is not None
    assert w.on_wake(mark=2000) is None           # tour de reveil deja ouvert -> no-op (S12)
    assert w.state["ignored"] == 1
    assert [t for t, _ in events] == ["evt.wake"]  # UN seul evt.wake
    w.release()                                    # l'orchestrateur (V9) / le test rouvre
    assert w.on_wake(mark=3000) is not None
    assert w.state["wakes"] == 2 and w.state["armed"] is True


# ══════════ WakeGate — mode generique + honnetete ══════════

def test_wake_generic_mode_and_honest_when_no_mark():
    ring = RingBuffer(16000)
    ring.write(np.zeros(5000, dtype=np.int16))
    events, emit = _collect()
    w = WakeGate(ring, emit)
    assert w.on_wake() is None                     # mark=None ET aucune marque suivie -> honnete (pas de fausse marque)
    assert events == []
    w.observe("evt.vad.start", {"pos": 1500})
    cur = w.on_wake()                              # mode generique (V9) -> derniere marque suivie
    assert cur.position == 1500


def test_wake_out_of_window_reports_truncated_in_event():
    # garde d'honnetete de bout en bout : marque hors fenetre -> evt.wake porte truncated>0 (l'orchestrateur SAIT)
    ring = RingBuffer(1000)
    ring.write(np.zeros(3000, dtype=np.int16))     # oldest = 2000
    events, emit = _collect()
    w = WakeGate(ring, emit)
    cur = w.on_wake(mark=500)                       # 500 < oldest -> tronque
    assert cur.position == 2000
    assert events[0][1]["truncated"] == 1500


def test_wake_emit_failure_never_breaks():
    # un emit qui LEVE (bus arrete au teardown) ne casse jamais le reveil (parite VadPlug._safe_emit)
    ring = RingBuffer(16000)
    ring.write(np.zeros(4000, dtype=np.int16))

    def boom(_t, _p):
        raise RuntimeError("bus arrete")
    w = WakeGate(ring, boom)
    cur = w.on_wake(mark=1000)                       # ne doit PAS lever
    assert cur is not None and w.state["wakes"] == 1


# ══════════ COEUR REEL — le VRAI Silero pose la marque -> PREMIER MOT INTACT (F1, parite prod) ══════════

def test_first_word_intact_with_real_silero():
    # [silence 0,5 s | PAROLE 1,5 s | silence 0,5 s] : le VRAI Silero doit poser la marque AU DEBUT de la parole,
    # et le rembobinage a cette marque doit rendre l'audio depuis le debut (premier mot jamais ampute). C'est la
    # preuve F1 sur le vrai chemin (PAS une marque fabriquee par un moteur scripte — anti-facilite NIT-5).
    from audio.test_source import SyntheticSpeechSource
    speech = SyntheticSpeechSource(lambda *a: None, lambda *a: None)._buf[: int(1.5 * 16000)]   # 1er segment de parole
    sil = np.zeros(int(0.5 * 16000), dtype=np.int16)
    buf = np.concatenate([sil, speech, sil]).astype(np.int16)
    speech_start = len(sil)                          # 8000 = debut REEL de la parole

    ring = RingBuffer(len(buf) + 16000)              # assez grand -> AUCUN overrun (la marque reste intacte)
    events, emit_collect = _collect()
    w = WakeGate(ring, emit_collect)

    def vad_emit(t, p):                              # comme l'emit wrappe de server.py : le VAD emet + le reveil suit
        emit_collect(t, p)
        w.observe(t, p)
    plug = VadPlug(ring, vad_emit, engine=SileroVadEngine(threshold=0.5))   # curseur cree ICI (ring vide -> pos 0)

    ring.write(buf, at_mono=0.0)                      # ecrire tout PUIS faire lire+process le VRAI VAD (deterministe)
    while True:
        data, _ov = plug._cursor.read(plug._hop)
        if data.size:
            plug.process(data)
        else:
            break

    starts = [p for t, p in events if t == "evt.vad.start"]
    assert starts, "le vrai Silero n'a pas detecte le debut de la parole"
    pos = w.state["last_mark"]
    assert pos == starts[-1]["pos"]                  # le reveil a bien suivi la marque du VAD (via l'emit wrappe)

    # (a) SANITE de la marque : elle tombe au DEBUT du segment de parole (pas noyee dans le silence initial,
    #     PAS au milieu = ampute). MESURE (design-first) : le vrai Silero marque pos=10784, soit +2784 ech
    #     (~174 ms) APRES le debut reel (8000) — delai de detection de Silero + speech_pad 30 ms, une propriete
    #     de V2 (audit conv 41), ACCENTUEE ici par une parole synthetique a attaque MOLLE (voyelles seules) ; en
    #     parole reelle (attaque consonantique) Silero declenche plus tot. Borne SERREE sur la mesure (marge
    #     ~45 ms) -> le test MORD si la marque derive (une amputation > ~220 ms echouerait). C'est un garde-fou
    #     de plausibilite de la marque (V2) ; la preuve F1 COTE V3 = le rembobinage fidele (b), octet-a-octet.
    assert speech_start - 1000 <= pos <= speech_start + 3500, f"marque a {pos}, debut parole a {speech_start}"

    # (b) LE COEUR DE V3 : rembobiner a la marque rend EXACTEMENT l'audio depuis la marque (octet-a-octet) ->
    #     aucun echantillon perdu PAR LE REMBOBINAGE (« premier mot jamais ampute » cote V3).
    cur = w.on_wake(mark=pos)
    assert cur.position == pos
    assert events[-1][0] == "evt.wake" and events[-1][1]["pos"] == pos and events[-1][1]["truncated"] == 0
    n = min(4000, len(buf) - pos)
    data, _ov = cur.read(n)
    assert np.array_equal(data, buf[pos:pos + n]), "l'audio rembobine ne correspond pas au buffer a la marque"

    # (c) l'audio rembobine contient bien de la PAROLE (energie), pas du silence -> le mot est bien la
    assert int(np.max(np.abs(data.astype(np.int64)))) > 1000, "l'audio rembobine est du silence -> premier mot manque"


# ══════════ Cycle de vie concurrent — _stop_audio arrete AUSSI le reveil (parite V2/vad, re-croise conv 41) ══════════

def test_stop_audio_stops_wake_under_concurrency():
    # _stop_audio doit arreter le reveil (V3) EXACTEMENT une fois sous concurrence (pop atomique separe, comme
    # capture/vad). Etend au wake le test que le re-croise conv 41 avait ajoute pour le vad.
    import server

    calls = {"cap": 0, "vad": 0, "wake": 0}
    lock = threading.Lock()

    class Slow:
        def __init__(self, key): self.key = key
        def stop(self):
            with lock:
                calls[self.key] += 1
            time.sleep(0.05)

    server._audio["ring"] = object()
    server._audio["capture"] = Slow("cap")
    server._audio["vad"] = Slow("vad")
    server._audio["wake"] = Slow("wake")
    ths = [threading.Thread(target=server._stop_audio) for _ in range(3)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    assert calls["cap"] == 1 and calls["vad"] == 1 and calls["wake"] == 1
    assert server._audio.get("wake") is None and server._audio.get("vad") is None
