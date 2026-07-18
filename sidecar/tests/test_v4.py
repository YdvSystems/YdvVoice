"""U-V4 (plan 01) — le STT STREAMING + le PORTIER d'eveil PAR PHRASE.

Deux etages, comme test_v2/test_v3 :
  - PLOMBERIE (deterministe, SANS GPU) : le portier (match_opening/closing, distingue Sophia/Sophie), le
    HypoBuffer (LocalAgreement-2), et le SttPlug avec un moteur SCRIPTE -> la logique de la prise + les
    contrats R-1 (release garanti) / R-2 (overrun au read) se testent sans faster-whisper ni audio reel ;
  - COEUR REEL (le VRAI faster-whisper) : « bonjour sophia » (asset neutre) -> transcrit -> le portier
    reveille (mark = debut du groupe) ; « bonjour sophie » -> IGNORE. Anti-facilite NIT-5 : la preuve du
    portier repose sur le VRAI moteur, pas un transcript fabrique. (Le chemin AEC complet est prouve par
    l'E2E `test-stt` ; ce pytest ecrit dans le ring pour ISOLER STT + portier.) Skip si l'asset/GPU absent.

Le SttPlug se teste via `_tick()` (une iteration deterministe, positions ring seules — parite VadPlug.process).
"""
import os
import threading
import time

import numpy as np

from audio.ring import RingBuffer
from consumers.stt import (SttPlug, SttEngine, HypoBuffer, match_opening, match_closing,
                           is_goodnight, is_hallucination, MAX_AUDIO_S, _CMDS_MAX, GROUP_SILENCE_S)

RATE = 16000


class ScriptedSttEngine(SttEngine):
    """Moteur STT scripte DETERMINISTE (sans GPU) : retourne un transcript FIXE avec des word-timestamps
    couvrant la duree de l'audio -> la LOGIQUE du SttPlug + le portier se testent sans faster-whisper.
    `fail=True` -> leve (teste le repli R3)."""

    def __init__(self, text: str = "Bonjour Sophia.", nsp: float = 0.01, fail: bool = False,
                 fail_warm: bool = False):
        self._text = text
        self._nsp = float(nsp)
        self._fail = fail
        self._fail_warm = fail_warm
        self.calls = 0

    def warm(self):
        if self._fail_warm:
            raise RuntimeError("moteur scripte : warm en echec (test worker mort)")

    def transcribe(self, audio, beam_size=5, word_ts=False):
        self.calls += 1
        if self._fail:
            raise RuntimeError("moteur scripte en echec (test repli)")
        toks = self._text.split()
        dur = max(len(audio) / RATE, 0.1)
        step = dur / max(len(toks), 1)
        words = [(t, i * step, (i + 1) * step) for i, t in enumerate(toks)] if word_ts else []
        return self._text, words, self._nsp


class PositionalSttEngine(SttEngine):
    """Moteur DETERMINISTE dont le transcript DEPEND du CONTENU audio (un mot par 0,5 s = signature de la
    tranche) -> une corruption de la fenetre par la compaction (mauvais re-index, off-by-one, echantillons
    perdus) serait DETECTEE (transcript different). Sert a PROUVER la transparence de la compaction ; le moteur
    scripte a texte FIXE ne le pourrait pas (il ignore l'audio)."""

    def warm(self):
        pass

    def transcribe(self, audio, beam_size=5, word_ts=False):
        slice_n = int(0.5 * RATE)
        words, i = [], 0
        while i + slice_n <= len(audio):
            tag = int(np.abs(np.asarray(audio[i:i + slice_n], dtype=np.float64)).sum()) % 100000   # signature CONTENU
            s = i / RATE
            words.append((f"w{tag}", s, s + 0.5))
            i += slice_n
        return " ".join(w[0] for w in words), words, 0.01


def _collect():
    events, lock = [], threading.Lock()

    def emit(etype, payload):
        with lock:
            events.append((etype, dict(payload)))
    return events, emit


class FakeWake:
    """Enregistre les appels du portier (on_wake/release) + simule l'etat `armed` (S12) du vrai WakeGate ->
    teste le cablage V4->V3 + la lecture rapide / le plafond differencie, sans le vrai WakeGate."""

    def __init__(self):
        self.wakes: list = []
        self.releases = 0
        self.armed = False                # comme le WakeGate : arme au reveil, desarme au release

    def on_wake(self, mark=None):
        if self.armed:                    # S12 : un 2e reveil pendant un tour arme = no-op (parite WakeGate)
            return None
        self.wakes.append(mark)
        self.armed = True
        return object()                   # curseur factice (le SttPlug n'utilise pas le retour en V4)

    def release(self):
        self.releases += 1
        self.armed = False


def _noise(seconds: float, seed: int = 0) -> np.ndarray:
    return (np.random.default_rng(seed).standard_normal(int(seconds * RATE)) * 3000).astype(np.int16)


def _sil(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * RATE), dtype=np.int16)


def _run(plug: SttPlug, ticks: int = 40) -> None:
    for _ in range(ticks):
        plug._tick()


class _GateStub:
    """Gate anti-auto-ecoute pilotable (V7 morceau C) : `value` True = SA voix joue -> le STT abandonne un groupe ouvert."""
    def __init__(self, value=False):
        self.value = value
    def __call__(self):
        return self.value


# ══════════ Portier (PUR) — distingue Sophia / Sophie ══════════

def test_portier_opening_distinguishes_sophia_from_sophie():
    assert match_opening("Bonjour Sophia.") is True
    assert match_opening("Dis-moi, Sophia, quelle heure est-il ?") is True
    assert match_opening("Salut Sophia !") is True
    assert match_opening("Bonjour Sophie.") is False          # NEGATIF : « sophie » ne reveille pas
    assert match_opening("Sonia est la.") is False
    assert match_opening("On parle de la Sophia de Constantinople.") is False   # « sophia » seul, hors phrase


def test_portier_opening_across_micro_pause_needs_accumulation():
    # « Dis-moi » seul ne reveille pas ; « Sophia » seul non plus ; le committe ACCUMULE, si : la facilite #1
    # du crible (sinon un eveil dit avec une micro-pause serait rate).
    assert match_opening("Dis-moi") is False
    assert match_opening("Sophia") is False
    assert match_opening("Dis-moi Sophia") is True


def test_portier_closing_and_goodnight():
    assert match_closing("Merci Sophia, a plus tard.") is True
    assert match_closing("Bonne nuit Sophia.") is True
    assert match_closing("Merci Sophia.") is False            # « merci » seul ne ferme pas (Yohann conv 27)
    assert match_closing("A plus tard.") is False             # sans le nom, ne ferme pas
    # Conv 44 (bug SOLO) : marqueurs a APOSTROPHE. _norm transforme l'apostrophe du transcript en espace ; sans
    # normaliser AUSSI les marqueurs, « a tout a l'heure » / « on s'arrete » ne fermaient JAMAIS. LE TEST MORD
    # (avant le fix : match_closing -> False sur ces deux phrases).
    assert match_closing("Merci Sophia, à tout à l'heure.") is True
    assert match_closing("Sophia, on s'arrête là.") is True
    assert is_goodnight("Bonne nuit Sophia.") is True
    assert is_goodnight("Bonjour Sophia.") is False


def test_portier_hallucination_filter():
    assert is_hallucination("")[0] is True
    assert is_hallucination("Sous-titrage Amara.org")[0] is True
    assert is_hallucination("Bonjour Sophia.")[0] is False
    assert is_hallucination("Bonjour Sophia.", no_speech_prob=0.9)[0] is True    # no_speech eleve


# ══════════ HypoBuffer (PUR) — LocalAgreement-2 ══════════

def test_hypo_commits_common_prefix_of_two_hypotheses():
    h = HypoBuffer()
    h.process([("bonjour", 0.0, 0.4), ("sofia", 0.4, 0.9)])   # 1re hypothese -> buffer, rien committe
    assert h.text_committed() == ""
    h.process([("bonjour", 0.0, 0.4), ("sophia", 0.4, 0.9)])  # 2e : « bonjour » confirme (accord) ; « sofia »!=« sophia »
    assert h.text_committed() == "bonjour"


def test_hypo_transient_hallucination_never_commits():
    # un mot qui apparait dans UNE seule hypothese (transitoire) n'est jamais committe (l'accord l'exige).
    h = HypoBuffer()
    h.process([("euh", 0.0, 0.3)])
    h.process([("bonjour", 0.0, 0.4)])                        # « euh » a disparu -> jamais committe
    h.process([("bonjour", 0.0, 0.4)])
    assert "euh" not in h.text_committed()
    assert h.text_committed() == "bonjour"


def test_hypo_shift_preserves_committed_text_and_dedups():
    # F-1 : le shift (compaction) NE PERD JAMAIS un mot committe (le contexte) ET garde le dedup coherent dans
    # le nouveau referentiel. C'est la GARANTIE « elle a tout le contexte de ce que je dis » (Yohann conv 44).
    h = HypoBuffer()
    h.process([("bonjour", 0.0, 0.4), ("sophia", 0.4, 0.9)])
    h.process([("bonjour", 0.0, 0.4), ("sophia", 0.4, 0.9)])   # « bonjour sophia » committe (accord)
    assert h.text_committed() == "bonjour sophia"
    before = h.text_committed()
    h.shift(-0.5)                                              # compaction : l'origine glisse de 0,5 s
    assert h.text_committed() == before                       # TEXTE committe INTACT (aucun mot perdu)
    assert abs(h.last_t - (0.9 - 0.5)) < 1e-9                  # last_t a glisse (referentiel coherent)
    # le dedup marche encore dans le NOUVEAU referentiel : une hypothese qui reprend « sophia » ne le double pas
    h.process([("sophia", 0.4 - 0.5, 0.9 - 0.5), ("quelle", 0.9 - 0.5, 1.3 - 0.5)])
    h.process([("sophia", 0.4 - 0.5, 0.9 - 0.5), ("quelle", 0.9 - 0.5, 1.3 - 0.5)])
    assert h.text_committed() == "bonjour sophia quelle"      # « sophia » NON double, « quelle » ajoute


# ══════════ SttPlug (moteur SCRIPTE) — structure, portier, R-1, R-2, replis ══════════

def test_stt_fast_wake_is_vif_on_short_opener():
    # LECTURE RAPIDE (banc conv 32 A) : « Bonjour Sophia » (court) reveille au vad-stop, avec un silence de
    # queue de 0,3 s SEULEMENT — BIEN PLUS court que WAKE_PLAFOND (0,8 s). Donc le reveil ne peut PAS venir du
    # plafond : c'est la lecture rapide (perf du banc ~0,65 s, pas ~2,6 s). LE TEST MORD (sans lecture rapide,
    # sil 0,3 < 0,8 -> pas de finalize -> aucun reveil).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophia."))
    ring.write(_sil(0.3))
    seg_start = ring.write_pos()
    ring.write(_noise(1.0))
    seg_stop = ring.write_pos()
    ring.write(_sil(0.3))                                     # queue COURTE (< WAKE_PLAFOND 0,8) : seule la lecture rapide peut reveiller
    plug.on_vad("evt.vad.start", {"pos": seg_start})
    plug.on_vad("evt.vad.stop", {"pos": seg_stop})
    _run(plug)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert len(finals) == 1 and "sophia" in finals[0]["text"].lower()
    assert finals[0]["mark"] == seg_start
    assert wake.wakes == [seg_start]                          # reveil VIF (lecture rapide) avec la marque du groupe
    assert wake.releases == 0


def test_stt_fast_wake_on_natural_short_phrase_below_1s_conv44():
    # Conv 44 (cause TROUVEE a l'instrumentation A LA VRAIE VOIX) : un « Bonjour Sophia » NATUREL fait ~0,9 s. Le
    # seuil de lecture rapide valait STT_MIN_WIN_S (1,0 s, celui du STREAMING) -> il RATAIT la phrase de 0,93 s
    # (« fast SKIP audio trop court ») -> reveil LENT (~1,36 s) et INCOHERENT (la phrase oscille autour d'1 s). Fix :
    # seuil DEDIE WAKE_MIN_WIN_S (0,4 s). Ici une phrase de 0,7 s (< l'ancien 1,0 s, > 0,4) reveille VIF. LE TEST
    # MORD : queue 0,3 s < WAKE_PLAFOND 0,8 -> sans lecture rapide, le plafond ne finalise pas -> aucun reveil
    # (ancien code, seuil 1,0 : wake.wakes == []).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophia."))
    ring.write(_sil(0.3))
    seg_start = ring.write_pos()
    ring.write(_noise(0.7))                                   # COURT : 0,7 s < l'ancien seuil 1,0 s (mais > WAKE_MIN 0,4)
    seg_stop = ring.write_pos()
    ring.write(_sil(0.3))                                     # queue COURTE (< WAKE_PLAFOND 0,8) : le plafond ne reveille pas
    plug.on_vad("evt.vad.start", {"pos": seg_start})
    plug.on_vad("evt.vad.stop", {"pos": seg_stop})
    _run(plug)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert len(finals) >= 1 and "sophia" in finals[-1]["text"].lower()
    assert wake.wakes == [seg_start]                          # reveil VIF sur une phrase < 1 s (fix conv 44 ; ancien : [])
    assert wake.releases == 0


def test_stt_fast_wake_fires_even_after_streaming_conv44():
    # Conv 44 : un « Bonjour Sophia » LONG (>= STT_HOP 1,5 s) fait tourner le STREAMING (_step) AVANT le vad-stop
    # (last_call_end != 0). L'ANCIENNE garde `last_call_end != 0` sautait alors la lecture rapide. Le fix (prise
    # MONO-FIL -> pas de course ct2 -> garde retiree) fait tirer la lecture rapide MEME si le streaming a deja
    # tourne. LE TEST MORD : queue 0,3 s < WAKE_PLAFOND 0,8 -> sans lecture rapide, le plafond ne finalise pas ->
    # aucun reveil (l'ancien code : wake.wakes == []). NB : la vivacite EN TEMPS REEL (endormie) se juge a la voix
    # (course _step vs lecture rapide, hors portee du deterministe) — voir les mesures conv 44 (§7).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophia."))
    ring.write(_sil(0.3))
    seg_start = ring.write_pos()
    ring.write(_noise(1.8))                                   # LONG (>= STT_HOP) : le streaming tourne AVANT le stop
    seg_stop = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": seg_start})
    _run(plug, ticks=3)                                       # reading=True : lit + _step -> last_call_end != 0
    assert plug._last_call_end != 0                           # precondition : le streaming A tourne
    ring.write(_sil(0.3))                                     # queue COURTE (< WAKE_PLAFOND 0,8) : le plafond ne reveille pas
    plug.on_vad("evt.vad.stop", {"pos": seg_stop})
    _run(plug)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert len(finals) >= 1 and "sophia" in finals[-1]["text"].lower()
    assert wake.wakes == [seg_start]                          # la lecture rapide tire malgre le streaming (fix conv 44)
    assert wake.releases == 0


def test_stt_does_not_wake_on_sophie():
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophie."))
    ring.write(_sil(0.3))
    s = ring.write_pos()
    ring.write(_noise(1.0))
    e = ring.write_pos()
    ring.write(_sil(1.6))
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    _run(plug)
    assert [p for t, p in events if t == "evt.stt.final"]     # un final a bien ete emis
    assert wake.wakes == []                                   # mais AUCUN reveil (« sophie » rejete)


def test_stt_group_accumulates_across_pause_single_final():
    # « Dis-moi » [micro-pause] « Sophia » = 2 segments VAD, UN SEUL groupe (mark = debut du 1er segment) ->
    # un seul evt.stt.final « Dis-moi Sophia » -> reveil. (Crible #1 : le portier lit le committe ACCUMULE.)
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Dis-moi Sophia."))
    ring.write(_sil(0.3))
    s1 = ring.write_pos()
    ring.write(_noise(0.6, seed=1))
    e1 = ring.write_pos()
    ring.write(_sil(0.3))                                     # micro-pause (< GROUP_SILENCE -> meme groupe)
    s2 = ring.write_pos()
    ring.write(_noise(0.6, seed=2))
    e2 = ring.write_pos()
    ring.write(_sil(1.6))                                     # silence long -> fin de groupe
    for cmd, pos in [("evt.vad.start", s1), ("evt.vad.stop", e1),
                     ("evt.vad.start", s2), ("evt.vad.stop", e2)]:
        plug.on_vad(cmd, {"pos": pos})
    _run(plug)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert len(finals) == 1                                   # UN seul groupe (pas deux finals)
    assert finals[0]["mark"] == s1                            # mark = debut du 1er segment (« dis-moi » intact)
    assert wake.wakes == [s1]


def test_stt_closing_releases_r1():
    # R-1 : le portier FERME sur cloture explicite (« merci sophia, a plus tard ») -> release garanti.
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Merci Sophia, a plus tard."))
    ring.write(_sil(0.3))
    s = ring.write_pos()
    ring.write(_noise(1.0))
    e = ring.write_pos()
    ring.write(_sil(1.6))
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    _run(plug)
    assert wake.releases >= 1                                 # cloture -> release (R-1)
    assert wake.wakes == []                                   # une cloture n'est pas un eveil


def test_stt_goodnight_wakes_then_releases():
    # « bonne nuit Sophia » = eveil-cloture : on_wake (emet evt.wake) PUIS release (elle se rendort).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonne nuit Sophia."))
    ring.write(_sil(0.3))
    s = ring.write_pos()
    ring.write(_noise(1.0))
    e = ring.write_pos()
    ring.write(_sil(1.6))
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    _run(plug)
    assert wake.wakes == [s] and wake.releases >= 1


def test_stt_overrun_detected_at_read_r2():
    # R-2 : si le ring avance au point que la marque sort de la fenetre PENDANT la lecture, le read signale
    # overrun -> le STT le TRAITE (reset du contexte). LE TEST MORD : sans la verif `if overrun`, le compteur
    # reste a 0 (reproduit le contrat grave conv 42 : truncated=0 au reveil puis overrun au read).
    ring = RingBuffer(RATE)                                   # petit : 1 s de fenetre
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophia."))
    ring.write(_sil(0.5))
    seg_start = ring.write_pos()                              # 8000
    plug.on_vad("evt.vad.start", {"pos": seg_start})
    plug._tick()                                              # ouvre le groupe, seek a la marque (curseur = 8000)
    ring.write(_noise(1.25))                                  # 20000 ech : oldest passe AU-DELA de la marque 8000
    plug.on_vad("evt.vad.stop", {"pos": ring.write_pos()})
    assert plug._overruns == 0
    plug._tick()                                              # lit -> le curseur (8000) est distance -> overrun
    assert plug._overruns >= 1                                # R-2 : l'overrun EST detecte et traite


def test_stt_engine_failure_never_crashes_and_is_counted():
    # un moteur qui LEVE ne tue pas la boucle et est COMPTE (parite VadPlug._engine_errors, repli R3).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("x", fail=True))
    ring.write(_sil(0.3))
    s = ring.write_pos()
    ring.write(_noise(1.0))
    e = ring.write_pos()
    ring.write(_sil(1.6))
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    _run(plug)
    assert plug._engine_errors >= 1                           # comptee, jamais avalee
    assert wake.wakes == []                                   # rien de fiable -> pas de reveil


def test_stt_wake_release_wake_cycle_replays_r1():
    # cycle eveil -> cloture -> eveil : apres une cloture (release), un nouvel « bonjour sophia » reveille a
    # nouveau (R-1 : le releaser garanti evite que Sophia reste SOURDE).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()

    def one(engine_text, seed, tail=1.6):
        plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine(engine_text))
        ring.write(_sil(0.3))
        s = ring.write_pos()
        ring.write(_noise(1.0, seed=seed))
        e = ring.write_pos()
        ring.write(_sil(tail))
        plug.on_vad("evt.vad.start", {"pos": s})
        plug.on_vad("evt.vad.stop", {"pos": e})
        _run(plug, ticks=60)
        return s

    s1 = one("Bonjour Sophia.", 1)                           # dort -> lecture rapide (reveil vif)
    one("Merci Sophia, a plus tard.", 2, tail=3.4)           # ARMEE -> finalize au plafond conversation (3,0 s)
    s3 = one("Bonjour Sophia.", 3)                           # dort a nouveau (apres release) -> reveil
    assert wake.wakes == [s1, s3]                             # DEUX reveils (le 2e apres release) — jamais sourde
    assert wake.releases >= 1


def test_stt_long_group_bounds_audio_memory_f1():
    # F-1 : un groupe qui ne se ferme jamais (start SANS stop -> _reading reste True, ex. VAD fige, ou parole
    # tres longue) ne fait PAS fuir _audio sans borne. LE TEST MORD : sans compaction, _audio croit lineairement
    # (repro croise : 0,96 MB sur 30 s ; ici 60 s ecrites -> ~3,84 MB). Le texte committe reste PRESERVE.
    ring = RingBuffer(90 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    wake.armed = True                                        # ARMEE (conversation) : plafond 3 s, jamais atteint sans stop
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophia."))
    ring.write(_sil(0.3))
    s = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s})                 # start SANS stop -> groupe jamais ferme
    for _ in range(60):
        ring.write(_noise(1.0))
        plug._tick()
    assert plug._active and plug._reading                    # le groupe est bien reste OUVERT (reproduit la fuite)
    assert len(plug._audio) <= int((MAX_AUDIO_S + 1) * RATE)  # _audio BORNE (~30 s), PAS 60 s
    assert plug._compactions >= 1                            # la compaction a tourne (garde absolue)
    partials = [p for t, p in events if t == "evt.stt.partial"]
    assert partials and "sophia" in partials[-1]["text"].lower()   # texte committe PRESERVE malgre la compaction


def test_stt_compaction_transparent_to_transcript_f1():
    # F-1 (LA garantie de Yohann : « elle a tout le contexte de ce que je dis » + « pas au detriment de la
    # conversation ») : la compaction NE CHANGE PAS le transcript. Preuve FORTE (re-croise conv 44) : un moteur
    # POSITIONNEL (transcript derive du CONTENU -> une corruption de fenetre serait DETECTEE) sur un groupe LONG,
    # compaction ACTIVE vs DESACTIVEE (no-op) -> partiels committes IDENTIQUES. Le moteur scripte a texte fixe ne
    # pourrait PAS le prouver. LE TEST MORD : un bug de re-index dans _compact/_shift ferait diverger on/off.
    def run(disable_compact):
        ring = RingBuffer(120 * RATE)
        events, emit = _collect()
        wake = FakeWake()
        wake.armed = True
        plug = SttPlug(ring, emit, wake=wake, engine=PositionalSttEngine())
        if disable_compact:
            plug._compact = lambda: None                 # jumeau TEMOIN : compaction desactivee
        ring.write(_sil(0.3))
        s = ring.write_pos()
        plug.on_vad("evt.vad.start", {"pos": s})
        for i in range(40):                              # 40 s de parole continue (groupe long -> compaction active)
            ring.write(_noise(1.0, seed=100 + i))        # audio VARIABLE -> mots distincts (corruption detectable)
            plug._tick()
        return [p["text"] for t, p in events if t == "evt.stt.partial"], plug._compactions
    on_parts, ncomp = run(False)
    off_parts, _ = run(True)
    assert ncomp >= 1                                    # la compaction a bien tourne (jumeau ACTIF)
    assert on_parts and on_parts == off_parts            # MEME transcript (partiels committes) -> TRANSPARENTE


def test_stt_cmds_queue_bounded_when_worker_dead_f2():
    # F-2 : worker MORT (warm leve, ex. pas de GPU) -> le VAD continue a poster -> la file est BORNEE
    # (drop-oldest), pas de fuite sans fin. LE TEST MORD : avec queue.Queue() sans maxsize, qsize atteindrait
    # 5000 (repro croise : 10000).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    plug = SttPlug(ring, emit, wake=FakeWake(), engine=ScriptedSttEngine(fail_warm=True))
    plug._loop()                                            # warm() leve -> le worker RETOURNE (thread mort)
    assert plug._engine_errors >= 1                         # l'echec est COMPTE (jamais avale)
    for _ in range(5000):
        plug.on_vad("evt.vad.start", {"pos": 1})
        plug.on_vad("evt.vad.stop", {"pos": 2})
    assert plug._cmds.qsize() <= _CMDS_MAX                  # file BORNEE (pas 10000)
    assert plug._dropped_cmds > 0                           # des commandes ont ete jetees (compte, observable)


# ══════════ GATE anti-auto-ecoute (V7 morceau C, fidelite #1 croise) ══════════

def test_stt_gate_aborts_open_group_so_residual_never_transcribed():
    # LE TEST MORD : Yohann parle pendant la latence cerveau -> un groupe G1 s'ouvre. Elle se met a repondre (gate)
    # -> G1 est ABANDONNE (fidele au banc qui droppait la parole superposee, _flush_audio oreilles_live:1298). Puis
    # un vad.start FRAIS ouvre un groupe PROPRE a la marque post-residu. Sans l'abandon, G1 resterait actif et, a la
    # reprise, relirait le RESIDU de sa voix ecrit pendant qu'elle parlait -> tour parasite (final avec mark=s1).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    wake.armed = True                                        # conversation (Yohann a deja reveille)
    gate = _GateStub()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("residu parasite."))
    plug.set_gate(gate)
    # 1) Yohann parle pendant la latence cerveau -> groupe G1 ouvert (start+stop)
    ring.write(_sil(0.3)); s1 = ring.write_pos()
    ring.write(_noise(0.8)); e1 = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s1})
    plug.on_vad("evt.vad.stop", {"pos": e1})
    plug._tick()                                             # ouvre G1, lit [s1, e1], attend le plafond
    assert plug._active is True
    # 2) elle se met a repondre -> gate ACTIF ; son residu s'ecrit dans le ring
    gate.value = True
    ring.write(_noise(2.0, seed=7))                          # RESIDU de sa voix pendant qu'elle parle
    plug._tick()                                             # gate actif + groupe ouvert -> ABANDON
    assert plug._aborts == 1, "le groupe ouvert n'a pas ete abandonne quand SA voix jouait"
    assert plug._active is False
    assert [p for t, p in events if t == "evt.stt.final"] == [], "un final (residu parasite) a ete emis"
    # 3) elle a fini -> gate INACTIF ; un vad.start FRAIS ouvre un groupe PROPRE a la marque post-residu
    gate.value = False
    ring.write(_sil(0.3)); s2 = ring.write_pos()
    ring.write(_noise(0.8, seed=9)); e2 = ring.write_pos()
    ring.write(_sil(3.4))                                    # >= GROUP_SILENCE 3,0 (armee) -> finalise le groupe propre
    plug.on_vad("evt.vad.start", {"pos": s2})
    plug.on_vad("evt.vad.stop", {"pos": e2})
    _run(plug)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert len(finals) == 1 and finals[0]["mark"] == s2, "le groupe propre n'a pas la marque post-residu (s2)"


def test_stt_gate_none_is_v4_exact():
    # sans set_gate (modes de test/V4) : _gate_speaking() -> False -> le groupe n'est JAMAIS abandonne (V4 EXACT).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophia."))
    ring.write(_sil(0.3)); s = ring.write_pos()
    ring.write(_noise(1.0)); e = ring.write_pos()
    ring.write(_sil(1.6))
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    _run(plug)
    assert plug._aborts == 0                                 # aucun abandon (pas de gate)
    assert wake.wakes == [s]                                 # reveil normal (V4 inchange)


def test_stt_gate_failopen_on_exception():
    # NIT re-croise (leçon conv 46 : une garde sans test qui MORD ; parite VAD test_v2) : un gate qui LEVE ->
    # fail-open, le groupe SURVIT (jamais bloquer l'ecoute sur un bug de gate) + l'erreur est COMPTEE.
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()

    def boom():
        raise RuntimeError("gate casse")
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Bonjour Sophia."))
    plug.set_gate(boom)
    ring.write(_sil(0.3)); s = ring.write_pos()
    ring.write(_noise(1.0)); e = ring.write_pos()
    ring.write(_sil(1.6))
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    _run(plug)
    assert plug._aborts == 0, "un gate en echec a abandonne le groupe (doit fail-open)"
    assert plug._gate_errors >= 1, "le gate qui leve n'est pas COMPTE (standard maison : jamais en silence)"
    assert wake.wakes == [s]                                 # l'ecoute a continue normalement (reveil)


def test_stt_gate_abort_in_conversation_clears_turn_state_no_turn_end():
    # NIT re-croise : abandonner un groupe de CONVERSATION (V5, turn != None, ARME, _turn_audio accumule) ->
    # AUCUN evt.turn.end (groupe abandonne, pas fini) + l'etat de tour REMIS (pas de Smart Turn sur du perime au
    # prochain tour). Le test principal d'abandon utilise turn=None ; celui-ci couvre le chemin V5 (server.py PROD).
    class FakeTurn:
        errors = 0
        def warm(self):
            pass
        def evaluate(self, audio, parle, last_word):
            return (0.8, "held", 0.9)                        # raccourcit le plafond -> _turn_plaf change (puis reset par l'abort)

    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    wake.armed = True                                        # conversation
    gate = _GateStub()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("un tour."), turn=FakeTurn())
    plug.set_gate(gate)
    ring.write(_sil(0.3)); s = ring.write_pos()
    ring.write(_noise(1.5)); e = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    plug._tick()                                             # ouvre le groupe arme, lit, accumule _turn_audio + _turn_check
    assert plug._active and plug._armed_at_open              # groupe de CONVERSATION
    assert len(plug._turn_audio) > 0                         # _turn_audio accumule (precondition)
    gate.value = True
    plug._tick()                                             # SA voix -> ABANDON
    assert plug._aborts == 1 and plug._active is False
    assert len(plug._turn_audio) == 0                        # etat de tour REMIS (pas de Smart Turn sur du perime)
    assert plug._turn_plaf == GROUP_SILENCE_S                # plafond remis au fallback (l'abort a annule la grace)
    assert [t for t, p in events if t == "evt.turn.end"] == []   # AUCUN turn.end pour un groupe abandonne


# ══════════ COEUR REEL — le VRAI faster-whisper (skip si asset/GPU absent) ══════════

def _load_asset(name: str):
    path = os.path.join(os.path.dirname(__file__), "assets", name)
    if not os.path.exists(path):
        return None
    from scipy.io import wavfile
    sr, y = wavfile.read(path)
    if y.ndim > 1:
        y = y.mean(axis=1)
    return np.clip(y, -32768, 32767).astype(np.int16)


def _real_plug_on(y: np.ndarray):
    """Ecrit [silence | y | silence] dans un ring, fait tourner le VRAI SttPlug via _tick, retourne
    (events, wake, seg_start). Skip si faster-whisper indisponible."""
    import pytest
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake)                     # FasterWhisperEngine reel
    try:
        plug.warm()                                          # charge large-v3 (~7 s) ; LEVE si absent -> skip
    except Exception as exc:
        pytest.skip(f"faster-whisper indisponible: {exc}")
    ring.write(_sil(0.3))
    seg_start = ring.write_pos()
    ring.write(y)
    seg_stop = ring.write_pos()
    ring.write(_sil(1.6))
    plug.on_vad("evt.vad.start", {"pos": seg_start})
    plug.on_vad("evt.vad.stop", {"pos": seg_stop})
    _run(plug, ticks=60)
    return events, wake, seg_start


def test_real_faster_whisper_wakes_on_bonjour_sophia():
    import pytest
    y = _load_asset("bonjour_sophia_16k.wav")
    if y is None:
        pytest.skip("asset bonjour_sophia_16k.wav absent (genere par gen_asset — CF2, gitignore)")
    events, wake, seg_start = _real_plug_on(y)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert finals, "aucun evt.stt.final du vrai moteur"
    assert "sophia" in finals[-1]["text"].lower(), f"transcript inattendu: {finals[-1]['text']!r}"
    assert wake.wakes == [seg_start]                          # le VRAI faster-whisper + portier reveillent


def test_real_faster_whisper_ignores_bonjour_sophie():
    import pytest
    y = _load_asset("bonjour_sophie_16k.wav")
    if y is None:
        pytest.skip("asset bonjour_sophie_16k.wav absent")
    events, wake, _ = _real_plug_on(y)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert finals, "aucun evt.stt.final du vrai moteur"
    assert "sophie" in finals[-1]["text"].lower(), f"transcript inattendu: {finals[-1]['text']!r}"
    assert wake.wakes == []                                   # le vrai moteur ecrit « sophie » -> PAS de reveil


def test_real_faster_whisper_wakes_across_two_segments_fid_m1():
    # FID-M-1 (couverture ajoutee conv 44, sur suggestion du croise) : le VRAI moteur reveille quand l'eveil est
    # marque en DEUX segments VAD (1 seul groupe accumule -> la fenetre lue par le SttPlug couvre les deux, y
    # compris l'inter-segment, contrairement au banc qui ne feedait que la parole). Audio CONTINU (on ne coupe
    # PAS un mot ni n'insere de silence : ca garblerait le transcript et testerait l'asset, pas le code) : on
    # coupe seulement les MARQUES VAD au milieu. Prouve que l'accumulation de groupe + le portier tiennent sur
    # le vrai faster-whisper a travers une frontiere de segment. (Le fail-safe sur silence INTERNE reel a ete
    # verifie empiriquement a l'audit — voir §7.) Attendu : reveil, mark = debut du 1er segment.
    import pytest
    y = _load_asset("bonjour_sophia_16k.wav")
    if y is None:
        pytest.skip("asset bonjour_sophia_16k.wav absent")
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake)                     # FasterWhisperEngine reel
    try:
        plug.warm()
    except Exception as exc:
        pytest.skip(f"faster-whisper indisponible: {exc}")
    mid = len(y) // 2
    ring.write(_sil(0.3))
    s1 = ring.write_pos()
    ring.write(y[:mid])                                       # 1re moitie (audio CONTINU avec la 2e)
    e1 = ring.write_pos()
    s2 = e1                                                   # 2e segment VAD contigu -> meme groupe, phrase intacte
    ring.write(y[mid:])                                       # 2e moitie
    e2 = ring.write_pos()
    ring.write(_sil(1.6))
    for cmd, pos in [("evt.vad.start", s1), ("evt.vad.stop", e1),
                     ("evt.vad.start", s2), ("evt.vad.stop", e2)]:
        plug.on_vad(cmd, {"pos": pos})
    _run(plug, ticks=80)
    finals = [p for t, p in events if t == "evt.stt.final"]
    assert finals, "aucun final du vrai moteur"
    assert "sophia" in finals[-1]["text"].lower(), f"transcript (2 segments): {finals[-1]['text']!r}"
    assert wake.wakes == [s1]                                 # reveil, mark = debut du 1er segment (accumulation)


# ══════════ Cycle de vie concurrent — _stop_audio arrete AUSSI le STT (parite V2/V3) ══════════

def test_stop_audio_stops_stt_under_concurrency():
    import server

    calls = {"cap": 0, "vad": 0, "wake": 0, "stt": 0}
    lock = threading.Lock()

    class Slow:
        def __init__(self, key):
            self.key = key

        def stop(self):
            with lock:
                calls[self.key] += 1
            time.sleep(0.05)

    server._audio["ring"] = object()
    server._audio["capture"] = Slow("cap")
    server._audio["vad"] = Slow("vad")
    server._audio["wake"] = Slow("wake")
    server._audio["stt"] = Slow("stt")
    ths = [threading.Thread(target=server._stop_audio) for _ in range(3)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    assert calls["cap"] == 1 and calls["vad"] == 1 and calls["wake"] == 1 and calls["stt"] == 1
    assert server._audio.get("stt") is None
