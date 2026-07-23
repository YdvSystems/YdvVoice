"""U-V15 (plan 01) — RESPAWN RESYNC + CONFORMITE DES PRISES (S10 · 01-F §2.3, conv 60).

Trois etages :
  - SELECTION PAR CONFIG AU SPAWN + REPLI CLOUD->LOCAL (`make_stt_engine` / `FailoverSttEngine` /
    `CloudStubSttEngine`) : « changer de moteur = config + respawn » ; « echec du provider cloud -> retour
    AUTOMATIQUE au local + notification honnete » (le canal V11 `evt.model.loaded {degraded, reason}` —
    zero type nouveau) ; « aucune cle requise pour demarrer » (le stub ne lit RIEN).
  - LA PRISE STT sous failover (bout-en-bout, moteurs scriptes) : la notification part au canal V11 ET la
    prise TRANSCRIT ensuite (le retour au local FONCTIONNE — pas juste un flag pose).
  - LA SUITE DE CONFORMITE PAR CONTRAT (§2.3 : « memes tests pour toute implementation d'un role ») — la
    MATRICE des prises a moteur INJECTABLE (stt · turn · speaker · affect, la prise affect V14 COMPRISE,
    exigence du Fait-quand V15). Deux proprietes par contrat, quel que soit le moteur derriere :
      (a) GARDES HONNETES : un moteur qui LEVE ne produit JAMAIS un faux verdict — compte, l'objet VIT ;
      (b) EVENEMENTS NORMALISES : le payload a EXACTEMENT les champs du contrat (« le moteur ne fuit
          jamais dans le protocole »).
    Traces, pas re-testes ici : `vad` (aucune alternative gravee — « — » au §2.3 ; contrat U-V2) · `tts`
    (moteur/sortie injectables — U-V7/E2E-V7) · `wake` (sans moteur depuis conv 27, portier V4).

L'ack `cmd.enroll.push` (jalon S10, ecart A-b conv 60) + l'ordre S10 complet + le rebuild mid-session =
`e2e-v15` (coeur reel) + les tests Node du runtime/routeur.
"""
import numpy as np
import pytest

from audio.ring import RingBuffer
from consumers.affect import AffectDetector, AffectEngine
from consumers.speaker import SpeakerDetector, SpeakerEngine, SpeakerPlug
from consumers.stt import (CloudStubSttEngine, FailoverSttEngine, FasterWhisperEngine, SttEngine, SttPlug,
                           make_stt_engine)
from consumers.turn import PLAFOND, TurnDetector, TurnEngine
from test_v4 import FakeWake, ScriptedSttEngine, _collect, _noise, _sil
from test_v11 import _wait

RATE = 16000


# ══════════ Selection par config au spawn (make_stt_engine — §2.3) ══════════

def test_v15_selection_env_absent_blanc_ou_local_donne_faster_whisper(monkeypatch):
    # Env absent / blanc / "local" -> le defaut prouve (ZERO changement de comportement). Le blanc = non-regle
    # (patron n7/N-5 : jamais une valeur vide qui desarme quelque chose en silence).
    monkeypatch.delenv("SOPHIA_STT_ENGINE", raising=False)
    assert type(make_stt_engine()) is FasterWhisperEngine
    monkeypatch.setenv("SOPHIA_STT_ENGINE", "local")
    assert type(make_stt_engine()) is FasterWhisperEngine
    monkeypatch.setenv("SOPHIA_STT_ENGINE", "  ")
    assert type(make_stt_engine()) is FasterWhisperEngine


def test_v15_selection_cloud_stub_donne_failover(monkeypatch):
    monkeypatch.setenv("SOPHIA_STT_ENGINE", "cloud-stub")
    assert type(make_stt_engine()) is FailoverSttEngine


def test_v15_selection_inconnue_defaut_local_jamais_un_crash(monkeypatch):
    # Une valeur inconnue au spawn -> defaut local, DIT (print) — jamais un sidecar qui refuse de naitre.
    monkeypatch.setenv("SOPHIA_STT_ENGINE", "deepgram-pas-encore-ecrit")
    assert type(make_stt_engine()) is FasterWhisperEngine


# ══════════ CloudStubSttEngine + FailoverSttEngine (le repli cloud->local, §2.3) ══════════

class _LocalOk(SttEngine):
    """Moteur « local » scripte : warm pose un load_info realiste ; transcribe repond (compte)."""

    def __init__(self):
        self.warms = 0
        self.calls = 0

    def warm(self):
        self.warms += 1
        self.load_info = {"device": "cuda", "vram_mb": 1888, "degraded": False}

    def transcribe(self, audio, beam_size=5, word_ts=False):
        self.calls += 1
        return "retour local", [], 0.01


def test_v15_cloud_stub_leve_toujours_et_ne_lit_aucune_cle():
    # « aucune cle requise pour demarrer » : le stub simule un provider injoignable SANS consulter l'env
    # (structurel : sa classe ne lit rien) — warm ET transcribe levent.
    stub = CloudStubSttEngine()
    with pytest.raises(RuntimeError):
        stub.warm()
    with pytest.raises(RuntimeError):
        stub.transcribe(np.zeros(RATE, np.float32))


def test_v15_failover_primaire_ok_reste_primaire():
    primary, fallback = _LocalOk(), _LocalOk()
    eng = FailoverSttEngine(primary, fallback)
    eng.warm()
    assert primary.warms == 1 and fallback.warms == 0
    assert eng.load_info == {"device": "cuda", "vram_mb": 1888, "degraded": False}   # PAS degrade a tort
    eng.warm()
    assert primary.warms == 1                       # idempotent : le moteur actif est FIGE au chargement


def test_v15_failover_cloud_ko_retour_local_et_notification_honnete():
    # LE chemin §2.3 : le cloud echoue au warm -> RETOMBE sur le local + load_info porte degraded + reason
    # (la notification part par evt.model.loaded, canal V11 — teste bout-en-bout ci-dessous).
    fallback = _LocalOk()
    eng = FailoverSttEngine(CloudStubSttEngine(), fallback)
    eng.warm()
    assert fallback.warms == 1
    assert eng.load_info["degraded"] is True and eng.load_info["reason"] == "cloud-failed"
    assert eng.load_info["device"] == "cuda"        # les infos REELLES du local obtenu, + la cause
    text, _w, _n = eng.transcribe(np.zeros(RATE, np.float32))
    assert text == "retour local" and fallback.calls == 1   # le retour au local FONCTIONNE (delegation reelle)


def test_v15_failover_les_deux_ko_propage():
    # Le local leve AUSSI -> PROPAGE : l'appelant (_loop) degrade honnetement (evt.model.unloaded
    # {load-failed}, worker sort) — jamais un crash silencieux, jamais un moteur fantome.
    class _Dead(SttEngine):
        def warm(self):
            raise RuntimeError("local mort aussi")

    with pytest.raises(RuntimeError):
        FailoverSttEngine(CloudStubSttEngine(), _Dead()).warm()


# ══════════ La prise STT sous failover — le canal V11 bout-en-bout ══════════

def test_v15_prise_stt_failover_notifie_et_transcrit():
    # Bout-en-bout sur la PRISE (worker reel, moteurs scriptes) : cloud KO au warm -> evt.model.loaded
    # {degraded:true, reason:"cloud-failed"} (la notification honnete, canal V11) PUIS la prise transcrit
    # NORMALEMENT (un reveil « Bonjour Sophia » aboutit) — le « retour automatique au local » est VECU par
    # la prise, pas seulement flagge.
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    scripted = ScriptedSttEngine("Bonjour Sophia.")

    class _LocalScripted(SttEngine):
        def warm(self):
            self.load_info = {"device": "cuda", "vram_mb": 1888, "degraded": False}

        def transcribe(self, audio, beam_size=5, word_ts=False):
            return scripted.transcribe(audio, beam_size, word_ts)

    plug = SttPlug(ring, emit, wake=wake, engine=FailoverSttEngine(CloudStubSttEngine(), _LocalScripted()))
    plug.start()
    try:
        assert _wait(lambda: any(t == "evt.model.loaded" for t, _p in events), 5.0)
        loaded = [p for t, p in events if t == "evt.model.loaded"][0]
        assert loaded["degraded"] is True and loaded["reason"] == "cloud-failed"
        assert loaded["device"] == "cuda" and loaded["model"] == "stt"
        # ... et la prise ENTEND : un tour court -> lecture rapide -> reveil + final (le local sert).
        ring.write(_sil(0.3))
        mark = ring.write_pos()
        ring.write(_noise(1.0))
        plug.on_vad("evt.vad.start", {"pos": mark})
        plug.on_vad("evt.vad.stop", {"pos": ring.write_pos()})
        assert _wait(lambda: any(t == "evt.stt.final" for t, _p in events), 5.0)
        assert wake.wakes == [mark]                 # le portier a reveille sur le transcript du LOCAL
    finally:
        plug.stop()


# ══════════ CONFORMITE (a) — gardes honnetes : un moteur KO ne produit JAMAIS un faux verdict ══════════

def _stt_ko_honnete() -> bool:
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine(fail=True))
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(1.0))
    plug.on_vad("evt.vad.start", {"pos": mark})
    plug.on_vad("evt.vad.stop", {"pos": ring.write_pos()})
    for _ in range(10):
        plug._tick()
    finals = [p for t, p in events if t == "evt.stt.final"]
    # compte + AUCUN reveil sur du vent + aucun final invente (re-croise N3 : la clause « state is not
    # None », toujours vraie, retiree — le libelle ne sur-promet plus)
    return plug.state["engine_errors"] >= 1 and wake.wakes == [] and finals == []


def _turn_ko_honnete() -> bool:
    class _KoTurn(TurnEngine):
        def predict(self, audio):
            raise RuntimeError("moteur turn KO (conformite)")

    det = TurnDetector(engine=_KoTurn())
    plaf, _reason, _prob = det.evaluate(np.zeros(2 * RATE, np.float32), 2.0, "fini")
    # un moteur KO -> FALLBACK plafond (la degradation douce gravee §4.3), compte — jamais une fin inventee
    return det.errors >= 1 and plaf == PLAFOND


def _speaker_ko_honnete() -> bool:
    class _KoSpk(SpeakerEngine):
        def embed(self, audio):
            raise RuntimeError("moteur speaker KO (conformite)")

    det = SpeakerDetector(engine=_KoSpk(), centroid=np.array([1.0, 0.0, 0.0, 0.0], np.float32))
    v = det.evaluate(np.zeros(RATE, np.float32))
    # None (« pas de verdict ») ≠ « inconnu » : l'aval n'est JAMAIS trompe par un crash etiquete
    return v is None and det.errors >= 1


def _affect_ko_honnete() -> bool:
    class _KoAff(AffectEngine):
        def evaluate(self, audio):
            raise RuntimeError("moteur affect KO (conformite)")

    det = AffectDetector(engine=_KoAff(), conf_min=0.0)
    v = det.evaluate_turn(np.zeros(4 * RATE, np.float32))
    return v is None and det.errors >= 1            # muet + compte — jamais une lecture inventee


@pytest.mark.parametrize("role,check", [
    ("stt", _stt_ko_honnete),
    ("turn", _turn_ko_honnete),
    ("speaker", _speaker_ko_honnete),
    ("affect", _affect_ko_honnete),
])
def test_v15_conformite_moteur_ko_jamais_un_faux_verdict(role, check):
    assert check(), f"contrat « {role} » : un moteur KO a produit un faux verdict ou tue la prise"


# ══════════ CONFORMITE (b) — evenements normalises : les champs EXACTS du contrat ══════════

STT_FINAL_KEYS = {"text", "mark", "captured_at", "no_speech_prob"}
TURN_END_KEYS = {"mark", "captured_at", "reason", "prob", "speech_ms"}
SPEAKER_KEYS = {"locuteur", "score", "mark", "captured_at", "speech_ms"}
AFFECT_KEYS = {"valence", "energie", "confiance", "mark", "captured_at", "speech_ms"}


def test_v15_conformite_stt_et_turn_payloads_normalises():
    # Deux implementations qui ne sont PAS les moteurs reels (STT scripte + turn scripte confiant) -> les
    # evenements ont EXACTEMENT la forme du contrat. « Changer de moteur = memes evenements en sortie. »
    class _ConfTurn(TurnEngine):
        def predict(self, audio):
            return 0.99                             # confiant -> ENDGRACE (le plafond court finalise vite)

    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    wake.armed = True                               # groupe de CONVERSATION (turn.end ne sort qu'arme, V5)
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("Une phrase de conversation complete."),
                   turn=TurnDetector(engine=_ConfTurn()))
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(2.0))
    plug.on_vad("evt.vad.start", {"pos": mark})
    plug.on_vad("evt.vad.stop", {"pos": ring.write_pos()})
    for _ in range(10):
        plug._tick()
    ring.write(_sil(1.2))                           # le silence s'ecoule au ring (> grace 0,7 s) -> finalize
    for _ in range(10):
        plug._tick()
    finals = [p for t, p in events if t == "evt.stt.final"]
    turns = [p for t, p in events if t == "evt.turn.end"]
    assert finals, "aucun evt.stt.final (le groupe n'a pas finalise)"
    assert set(finals[0].keys()) == STT_FINAL_KEYS, f"payload stt.final hors contrat : {finals[0].keys()}"
    assert turns, "aucun evt.turn.end (conversation armee, turn fourni)"
    assert set(turns[0].keys()) == TURN_END_KEYS, f"payload turn.end hors contrat : {turns[0].keys()}"
    assert turns[0]["mark"] == mark                 # turn.end REFERENCE le final (meme mark — ordre grave)


def test_v15_conformite_speaker_payload_normalise():
    class _ConstSpk(SpeakerEngine):
        def embed(self, audio):
            return np.array([1.0, 0.0, 0.0, 0.0], np.float64)   # cosinus 1.0 contre le centroide -> « yohann »

    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    det = SpeakerDetector(engine=_ConstSpk(), centroid=np.array([1.0, 0.0, 0.0, 0.0], np.float32))
    plug = SpeakerPlug(ring, emit, detector=det)
    ring.write(_sil(0.3))
    mark = ring.write_pos()
    ring.write(_noise(1.2))                         # >= MIN_SPEECH_S (0,75) -> un point de trajectoire
    plug.on_vad("evt.vad.start", {"pos": mark})
    plug.on_vad("evt.vad.stop", {"pos": ring.write_pos()})
    for _ in range(10):
        plug._tick()
    spk = [p for t, p in events if t == "evt.speaker"]
    assert spk, "aucun evt.speaker (segment >= MIN_SPEECH attendu)"
    assert set(spk[0].keys()) == SPEAKER_KEYS, f"payload speaker hors contrat : {spk[0].keys()}"
    assert spk[0]["locuteur"] == "yohann" and isinstance(spk[0]["score"], float)


def test_v15_conformite_affect_payload_normalise():
    # La prise affect V14 COMPRISE (Fait-quand V15) : moteur scripte (pas le w2v2 reel) -> payload =
    # les cles EXACTES du gravé, valeurs NUMERIQUES seules (jamais d'etiquette — quel que soit le moteur).
    from test_v14 import _affect_plug, _affects, _turn
    ring, events, _det, plug = _affect_plug()
    _turn(plug, ring)
    p = _affects(events)[0]
    assert set(p.keys()) == AFFECT_KEYS, f"payload affect hors contrat : {p.keys()}"
    assert all(isinstance(v, (int, float)) for v in p.values()), f"payload non numerique : {p}"


def test_v15_conformite_model_loaded_payload_normalise():
    # re-croise conv 60 (N6) : la matrice couvre AUSSI `evt.model.loaded` — precisement l'evenement que V15
    # ETEND (`reason`). Contrat : {model, device, vram_mb, degraded} + `reason` SEULEMENT si un repli a une
    # cause (jamais un champ null de bruit). Prouve sur les DEUX chemins (normal / failover).
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    plug = SttPlug(ring, emit, wake=FakeWake(), engine=_LocalOk())
    plug.start()
    try:
        assert _wait(lambda: any(t == "evt.model.loaded" for t, _p in events), 5.0)
        p = [q for t, q in events if t == "evt.model.loaded"][0]
        assert set(p.keys()) == {"model", "device", "vram_mb", "degraded"}, f"payload hors contrat : {p.keys()}"
    finally:
        plug.stop()
    ring2 = RingBuffer(30 * RATE)
    events2, emit2 = _collect()
    plug2 = SttPlug(ring2, emit2, wake=FakeWake(), engine=FailoverSttEngine(CloudStubSttEngine(), _LocalOk()))
    plug2.start()
    try:
        assert _wait(lambda: any(t == "evt.model.loaded" for t, _p in events2), 5.0)
        p2 = [q for t, q in events2 if t == "evt.model.loaded"][0]
        assert set(p2.keys()) == {"model", "device", "vram_mb", "degraded", "reason"}, f"payload hors contrat : {p2.keys()}"
        assert p2["reason"] == "cloud-failed"
    finally:
        plug2.stop()


def test_v15_speaker_warm_witness_honest():
    # ROB-M2 (croise conv 60, REPRODUIT) : le SpeakerPlug expose un temoin « warm REUSSI » (parite
    # SttPlug._warm conv 47). AVANT : state n'avait que warm_failed (pose a l'ISSUE) -> l'ack enroll disait
    # « monte » PENDANT le chargement, y compris quand le warm allait ECHOUER. APRES : warm=False pendant le
    # chargement (le serveur repond « warming »), True seulement a l'issue REUSSIE, jamais True sur un echec.
    # LE TEST MORD (temp-revert du temoin -> warm absent du state / jamais pose).
    import threading
    import time as _t

    release = threading.Event()
    in_warm = threading.Event()

    class SlowDetector(SpeakerDetector):
        def __init__(self, fail=False):
            super().__init__(engine=SpeakerEngine(), centroid=np.array([1.0, 0.0], np.float32))
            self._fail = fail

        def warm(self):
            in_warm.set()
            release.wait(5.0)
            if self._fail:
                raise RuntimeError("ancre corrompue (test)")

    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    plug = SpeakerPlug(ring, emit, detector=SlowDetector())
    plug.start()
    try:
        assert in_warm.wait(3.0)
        st = plug.state
        assert st["warm"] is False and st["warm_failed"] is False   # PENDANT le warm : ni monte ni KO (« warming »)
        release.set()
        deadline = _t.time() + 3.0
        while _t.time() < deadline and not plug.state["warm"]:
            _t.sleep(0.02)
        assert plug.state["warm"] is True                           # warm REUSSI -> le temoin est pose
    finally:
        release.set()
        plug.stop()
    # l'echec du warm ne pose JAMAIS le temoin (warm_failed le dit, warm reste False)
    release.clear()
    in_warm.clear()
    ring2 = RingBuffer(30 * RATE)
    events2, emit2 = _collect()
    plug2 = SpeakerPlug(ring2, emit2, detector=SlowDetector(fail=True))
    plug2.start()
    try:
        assert in_warm.wait(3.0)
        release.set()
        deadline = _t.time() + 3.0
        while _t.time() < deadline and not plug2.state["warm_failed"]:
            _t.sleep(0.02)
        assert plug2.state["warm_failed"] is True and plug2.state["warm"] is False
    finally:
        release.set()
        plug2.stop()


def test_v15_enroll_ack_mapping_4_etats():
    # ROB2-MIN-1 (re-croise conv 60) : la branche `warm_failed` du mapping enroll n'etait exercee par AUCUN
    # test (e2e run1/2 = absent, run3 = warming->monte ; test_v6/v14/v15 = le state du PLUG, pas le mapping
    # serveur) — une regression la faisant retomber dans « warming » passait TOUT vert (mensonge par
    # omission : ancre corrompue -> « warming » a vie au lieu du KO dit). On teste la fonction REELLE du
    # serveur (`_enroll_speaker_status`, appelee par ws_handler — le cablage, lui, est prouve par e2e
    # run1-3) dans les 4 etats + la priorite du KO. LE TEST MORD (temp-revert de la branche -> FAIL).
    import server

    class _FakeSpeaker:
        def __init__(self, warm, warm_failed):
            self._st = {"warm": warm, "warm_failed": warm_failed}

        @property
        def state(self):
            return dict(self._st)

    assert server._enroll_speaker_status(None) == "absent"
    assert server._enroll_speaker_status(_FakeSpeaker(False, True)) == "warm_failed"
    assert server._enroll_speaker_status(_FakeSpeaker(False, False)) == "warming"
    assert server._enroll_speaker_status(_FakeSpeaker(True, False)) == "monte"
    # un KO n'est JAMAIS masque par un temoin pose a tort (l'ordre du mapping : warm_failed d'abord —
    # etat contradictoire impossible par monotonie, mais le mapping le dit KO si un bug l'y amenait)
    assert server._enroll_speaker_status(_FakeSpeaker(True, True)) == "warm_failed"
