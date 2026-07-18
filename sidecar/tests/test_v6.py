"""U-V6 (plan 01) — le SPEAKER-ID « qui parle ? » (ECAPA CPU).

Trois etages, comme test_v4/test_v5 :
  - LOGIQUE PURE (deterministe, SANS ECAPA) : `cosine`, `decide` (yohann/inconnu au seuil), et surtout les
    GARDES HONNETES du `SpeakerDetector` (un echec de calcul -> None, JAMAIS un faux « inconnu » ; audio trop
    court -> None ; NaN/inf -> None). `build_centroid` (moyenne normalisee).
  - PLOMBERIE (`SpeakerPlug` + moteur SCRIPTE + marques VAD scriptees, positions ring seules via `_tick`) :
    emet `evt.speaker` au 1er score (MIN_SPEECH), a la cadence (EVAL_EVERY) plafonnee a CAP, `locuteur`/`score`
    corrects, `mark` porte, overrun R-2 reset, file bornee (F-2), un moteur qui CRASHE n'emet rien + est compte
    (jamais un faux verdict), un segment trop court n'emet rien.
  - COEUR REEL (le VRAI EcapaEngine) : le modele vendorise reproduit la SEPARATION du banc (Yohann held-out
    `raw_far` >> A20 = voix de Sophia ; EER 0 % a l'integration, conv 33-34 + barriere conv 46). NON-skippable
    hors absence du modele/ancre (la fidelite au banc EST l'enjeu de la regle perf).

Le SpeakerPlug se teste via `_tick()` (une iteration deterministe, positions ring seules — parite VadPlug/STT).
"""
import glob
import os

import numpy as np
import pytest

from audio.ring import RingBuffer
from consumers.speaker import (
    SpeakerPlug, SpeakerEngine, SpeakerDetector, EcapaEngine, build_centroid, cosine, decide, load16,
    SPEAKER_THR, MIN_SPEECH_S, MAX_WIN_S, CAP_S, EVAL_EVERY_S, MIN_SAMPLES, ANCHOR_CLIPS,
    _MODEL_DIR, _ANCHOR_DIR,
)
from test_v4 import _collect, _noise, _sil

RATE = 16000
_A20_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "a20")
E1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)   # centroide de test : le cosinus d'un vecteur = sa 1re coord


def _unit(score: float) -> np.ndarray:
    """Vecteur unitaire dont le cosinus a E1 vaut EXACTEMENT `score` -> pilote le score du moteur scripte."""
    s = float(np.clip(score, -1.0, 1.0))
    return np.array([s, (1.0 - s * s) ** 0.5, 0.0], dtype=np.float32)


class ScriptedSpeakerEngine(SpeakerEngine):
    """Moteur speaker SCRIPTE : rend un embedding dont le cosinus au centroide E1 = `score` (fixe, ou une liste
    un-par-appel) -> teste la LOGIQUE du plug/detecteur sans ECAPA. `fail=True` -> leve (garde honnete)."""

    def __init__(self, score=0.9, fail=False):
        self._score = score
        self._fail = fail
        self.calls = 0

    def embed(self, audio):
        self.calls += 1
        if self._fail:
            raise RuntimeError("moteur speaker scripte en echec (test garde honnete)")
        s = self._score[min(self.calls - 1, len(self._score) - 1)] if isinstance(self._score, (list, tuple)) else self._score
        return _unit(s)

    def warm(self):
        pass


def _spk_plug(score=0.9, fail=False, threshold=None):
    """SpeakerPlug avec un moteur scripte + le centroide E1 fige (pas d'ECAPA, pas d'ancre chargee)."""
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    det = SpeakerDetector(engine=ScriptedSpeakerEngine(score, fail=fail), centroid=E1,
                          threshold=SPEAKER_THR if threshold is None else threshold)
    plug = SpeakerPlug(ring, emit, detector=det)
    return ring, events, det, plug


def _open_seg(plug, ring, pre_sil=0.3):
    """Ecrit un pre-silence, poste evt.vad.start, ouvre le segment (seek a la marque). Retourne la marque."""
    ring.write(_sil(pre_sil))
    s = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s})
    plug._tick()                                  # draine le start -> _open_segment (seek a s), lecture 0 (rien apres s)
    return s


def _feed(plug, ring, speech_s, seed=1):
    """Ecrit `speech_s` de parole PUIS un tick (le plug lit jusqu'au present tant qu'il est in_speech)."""
    ring.write(_noise(speech_s, seed=seed))
    plug._tick()


def _speakers(events):
    return [p for t, p in events if t == "evt.speaker"]


# ══════════ Logique PURE : cosinus, decision, gardes honnetes ══════════

def test_cosine_and_decide():
    assert abs(cosine(_unit(0.5), E1) - 0.5) < 1e-6
    assert abs(cosine(E1, E1) - 1.0) < 1e-6
    assert cosine(_unit(-0.3), E1) < 0                       # une voix tres differente -> cosinus NEGATIF
    assert decide(0.5) == "yohann" and decide(0.1) == "inconnu"
    assert decide(0.3, threshold=0.5) == "inconnu" and decide(0.6, threshold=0.5) == "yohann"


def _write_wav(path, seconds=0.5, rate=16000):
    import wave
    w = wave.open(str(path), "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
    w.writeframes(np.zeros(int(seconds * rate), dtype=np.int16).tobytes())
    w.close()


def test_build_centroid_normalized_mean(tmp_path):
    # build_centroid = moyenne NORMALISEE des embeddings (v6_service EXACT). On isole la MATH avec un moteur
    # scripte (un vecteur different par clip) ; load16 doit ouvrir de VRAIS WAV (le moteur ignore leur contenu).
    for f in ("a.wav", "b.wav"):
        _write_wav(tmp_path / f)
    eng = ScriptedSpeakerEngine(score=[0.6, 0.8])           # 2 embeddings distincts
    c = build_centroid(eng, [str(tmp_path / "a.wav"), str(tmp_path / "b.wav")])
    assert abs(np.linalg.norm(c) - 1.0) < 1e-6              # NORMALISE
    assert eng.calls == 2                                    # un embed par clip


def test_build_centroid_raises_if_no_clip():
    with pytest.raises(FileNotFoundError):
        build_centroid(ScriptedSpeakerEngine(), ["/nexiste/pas_a.wav", "/nexiste/pas_b.wav"])


def test_detector_verdicts_at_threshold():
    det = SpeakerDetector(engine=ScriptedSpeakerEngine(0.5), centroid=E1, threshold=0.22)
    assert det.evaluate(np.zeros(RATE, np.float32)) == ("yohann", pytest.approx(0.5))
    det2 = SpeakerDetector(engine=ScriptedSpeakerEngine(0.10), centroid=E1, threshold=0.22)
    loc, sc = det2.evaluate(np.zeros(RATE, np.float32))
    assert loc == "inconnu" and abs(sc - 0.10) < 1e-6       # vrai score bas = vraie voix differente (PAS un echec)


def test_detector_too_short_is_none_not_a_verdict():
    det = SpeakerDetector(engine=ScriptedSpeakerEngine(0.9), centroid=E1)
    assert det.evaluate(np.zeros(MIN_SAMPLES - 1, np.float32)) is None   # < 0,4 s -> pas de verdict
    assert det.evaluate(None) is None
    assert det.errors == 0                                  # pas assez d'audio n'est PAS une erreur


def test_detector_engine_crash_is_none_never_fake_inconnu():
    # LE TEST MORD (crible facilite H) : un echec de calcul ne doit JAMAIS etre etiquete « inconnu » (ce qui
    # tromperait V8/V14). evaluate -> None + erreur comptee. Avant le fix, on aurait retourne ("inconnu", ...).
    det = SpeakerDetector(engine=ScriptedSpeakerEngine(fail=True), centroid=E1)
    assert det.evaluate(np.zeros(RATE, np.float32)) is None
    assert det.errors == 1 and det.last_locuteur is None    # aucun verdict pose


def test_detector_non_finite_is_none():
    class NanEng(SpeakerEngine):
        def embed(self, a):
            return np.array([float("nan"), 0.0, 0.0], dtype=np.float32)
        def warm(self):
            pass
    det = SpeakerDetector(engine=NanEng(), centroid=E1)
    assert det.evaluate(np.zeros(RATE, np.float32)) is None and det.errors == 1


# ══════════ Plomberie : le SpeakerPlug (positions ring seules) ══════════

def test_v6_emits_at_min_speech():
    # 1er score des que MIN_SPEECH (0,75 s) de parole est accumulee. LE TEST MORD : avec 0,5 s (< MIN_SPEECH),
    # AUCUN evt.speaker ; a 0,8 s, un evt.speaker parait.
    ring, events, det, plug = _spk_plug(score=0.9)
    s = _open_seg(plug, ring)
    _feed(plug, ring, 0.5)                                  # 0,5 s < MIN_SPEECH -> pas encore de verdict
    assert _speakers(events) == []
    _feed(plug, ring, 0.4)                                  # total 0,9 s >= MIN_SPEECH -> 1er score
    sp = _speakers(events)
    assert len(sp) == 1
    assert sp[0]["locuteur"] == "yohann" and abs(sp[0]["score"] - 0.9) < 1e-3
    assert sp[0]["mark"] == s and sp[0]["speech_ms"] >= 750


def test_v6_cadence_and_cap():
    # re-score tous les EVAL_EVERY (0,5 s), PLAFONNE a CAP (3,0 s). On nourrit par tranches -> une eval par palier
    # jusqu'a CAP, PUIS plus aucune (meme si on continue a parler). LE TEST MORD : sans le plafond CAP, les evals
    # continueraient indefiniment.
    ring, events, det, plug = _spk_plug(score=0.8)
    _open_seg(plug, ring)
    for _ in range(8):                                      # 8 x 0,5 s = 4 s de parole (> CAP 3 s)
        _feed(plug, ring, 0.5)
    n = len(_speakers(events))
    # evals aux accum ~0,75..3,25 (<= CAP + le franchissement) ; jamais indefiniment
    assert 4 <= n <= 6, f"cadence/CAP : {n} evals (attendu ~5-6, plafonne a CAP)"
    assert plug.state["evals"] == n


def test_v6_big_read_past_cap_still_emits_one_verdict():
    # solo conv 46 (LE TEST MORD) : si l'audio arrive en UN gros bloc qui SAUTE au-dela de CAP (backlog : worker
    # lent puis gros read), on veut QUAND MEME un verdict. Avant le fix (garde `accum<=CAP`), 0 evt.speaker.
    ring, events, det, plug = _spk_plug(score=0.9)
    _open_seg(plug, ring)
    ring.write(_noise(5.0))                                # 5 s d'un coup (> CAP 3 s), un seul read
    plug._tick()
    sp = _speakers(events)
    assert len(sp) >= 1 and sp[0]["locuteur"] == "yohann"  # au moins UN verdict (avant le fix : aucun)


def test_v6_locuteur_inconnu_for_other_voice():
    ring, events, det, plug = _spk_plug(score=0.05)         # une voix tres differente (cosinus 0,05 < seuil 0,22)
    _open_seg(plug, ring)
    _feed(plug, ring, 1.0)
    sp = _speakers(events)
    assert len(sp) >= 1 and sp[0]["locuteur"] == "inconnu" and sp[0]["score"] < SPEAKER_THR


def test_v6_short_segment_no_verdict():
    # un segment ENTIER < MIN_SPEECH -> aucun evt.speaker (meme apres la cloture du segment).
    ring, events, det, plug = _spk_plug(score=0.9)
    s = _open_seg(plug, ring)
    ring.write(_noise(0.5))                                 # 0,5 s de parole
    e = ring.write_pos()
    plug.on_vad("evt.vad.stop", {"pos": e})
    ring.write(_sil(0.3))
    for _ in range(10):
        plug._tick()
    assert _speakers(events) == []                          # trop court -> pas de verdict
    assert plug.state["active"] is False                    # segment clos proprement


def test_v6_overrun_resets_segment():
    # R-2 : un overrun (le ring distance le curseur) rompt le segment -> il se clot (pas de verdict sur un audio
    # troue), le prochain segment rouvre proprement. LE TEST MORD : _overruns incremente + segment inactif.
    ring = RingBuffer(RATE)                                 # petit ring : 1 s
    events, emit = _collect()
    det = SpeakerDetector(engine=ScriptedSpeakerEngine(0.9), centroid=E1)
    plug = SpeakerPlug(ring, emit, detector=det)
    ring.write(_sil(0.2))
    s = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s})
    plug._tick()                                            # ouvre a s
    ring.write(_noise(0.3))
    plug._tick()                                            # lit un peu
    ring.write(_noise(1.5))                                 # oldest depasse la marque -> overrun au prochain read
    plug.on_vad("evt.vad.stop", {"pos": ring.write_pos()})
    plug._tick()                                            # overrun detecte -> _on_overrun -> clot
    assert plug.state["overruns"] >= 1 and plug.state["active"] is False


def test_v6_engine_crash_never_kills_loop_and_no_verdict():
    # un moteur qui CRASHE a l'embed : la boucle continue, AUCUN evt.speaker emis (None), l'erreur est comptee
    # (jamais en silence, jamais un faux « inconnu »).
    ring, events, det, plug = _spk_plug(fail=True)
    _open_seg(plug, ring)
    _feed(plug, ring, 1.0)
    _feed(plug, ring, 0.6)
    assert _speakers(events) == []                          # aucun verdict (crash -> None -> n'emet rien)
    assert plug.state["engine_errors"] >= 1                 # compte, jamais silencieux
    assert plug.state["active"] is True                     # la boucle vit (segment toujours ouvert)


def test_v6_cmds_queue_is_bounded():
    # F-2 : la file de commandes VAD est BORNEE (drop-oldest) -> un worker mort ne la fait pas fuir. On inonde
    # `on_vad` (le worker ne tourne pas) -> les plus anciennes sont jetees + comptees.
    ring, events, det, plug = _spk_plug(score=0.9)
    for i in range(600):                                    # > maxsize 256
        plug.on_vad("evt.vad.start", {"pos": i})
    assert plug.state["dropped_cmds"] > 0
    assert plug._cmds.qsize() <= 256


def test_v6_ignores_malformed_vad_payload():
    ring, events, det, plug = _spk_plug(score=0.9)
    plug.on_vad("evt.vad.start", {})                        # pas de 'pos' -> ignore, jamais une exception
    plug.on_vad("evt.autre", {"pos": 1})                    # pas un evt.vad.* -> ignore
    plug.on_vad("evt.vad.start", {"pos": "x"})              # pos non entier -> ignore
    assert plug._cmds.qsize() == 0


def test_v6_reprise_continues_same_segment():
    # croisé conv 46 (NIT-4) : reprise = un vad.start pendant un segment ACTIF (ex. stop+start draines dans le
    # meme _tick sous charge) -> le segment CONTINUE d'accumuler, il ne se rouvre pas a zero ni ne se ferme.
    ring, events, det, plug = _spk_plug(score=0.9)
    _open_seg(plug, ring)
    ring.write(_noise(0.5)); e = ring.write_pos()
    plug.on_vad("evt.vad.stop", {"pos": e})
    plug.on_vad("evt.vad.start", {"pos": e})               # reprise (draine avec le stop)
    plug._tick()
    assert plug.state["active"] is True                    # TOUJOURS actif (reprise, pas de cloture)
    _feed(plug, ring, 0.5)                                  # continue -> total ~1 s >= MIN_SPEECH
    assert len(_speakers(events)) >= 1                     # a fini par emettre (accumulation continue)


def test_v6_open_segment_mark_is_clamped_position():
    # croisé conv 46 (NIT-2, LE TEST MORD) : si la marque a scrolle HORS du ring, `_mark` = la position CLAMPEE
    # (ou le scoring commence vraiment), pas le `pos` brut perime. Avant le fix : _mark = pos (100), pointant un
    # audio absent -> evt.speaker.mark/captured_at faux. Apres : _mark = oldest (la vraie tete de fenetre).
    ring = RingBuffer(RATE)                                # 1 s de fenetre
    events, emit = _collect()
    plug = SpeakerPlug(ring, emit, detector=SpeakerDetector(engine=ScriptedSpeakerEngine(0.9), centroid=E1))
    ring.write(_noise(1.5))                                # write_pos = 24000, oldest = 8000
    plug._open_segment(100)                                # 100 << oldest (8000)
    assert plug._mark == plug._cursor.position             # marque = clampee, PAS le pos perime
    assert plug._mark != 100 and plug._mark >= ring.write_pos() - ring.capacity


def test_v6_lone_stop_without_start_no_crash():
    # croisé conv 46 (NIT-4) : un vad.stop SANS vad.start (etat de bord) -> ignore proprement, aucun crash,
    # aucun verdict, aucun segment ouvert.
    ring, events, det, plug = _spk_plug(score=0.9)
    plug.on_vad("evt.vad.stop", {"pos": 1000})
    for _ in range(5):
        plug._tick()
    assert _speakers(events) == [] and plug.state["active"] is False


def test_v6_tick_exception_counted_and_loop_survives():
    # re-croisé conv 46 (NIT-1, LE TEST MORD pour la garde `_tick`) : une exception INATTENDUE dans `_tick` est
    # COMPTEE (`tick_errors`) et la boucle SURVIT (jamais une mort silencieuse). Sans le try/except de `_loop`,
    # la 1re exception SORTIRAIT de `_loop` -> `plug._loop()` leverait (worker mort, non compte). On injecte
    # l'exception via `_tick` monkeypatche ; apres 3 tours on laisse la boucle sortir.
    ring, events, det, plug = _spk_plug(score=0.9)
    n = {"c": 0}
    def _boom():
        n["c"] += 1
        if n["c"] >= 3:
            plug._stop.set()                               # 3 exceptions puis on laisse la boucle sortir
        raise RuntimeError("tick boom (test defense en profondeur)")
    plug._tick = _boom
    plug._loop()                                           # warm scripte OK -> while : _tick leve 3x, TOUTES comptees
    assert plug.state["tick_errors"] == 3                  # jamais une mort silencieuse (sans la garde : RuntimeError remonte)


def test_v6_warm_failure_exits_worker_and_flags():
    # croisé conv 46 (NIT-4) : warm() qui LEVE (modele/ancre absent) -> le worker sort proprement + `warm_failed`
    # visible /debug (jamais une mort silencieuse, parite STT). LE TEST MORD : sans le drapeau, l'echec serait muet.
    class FailWarmDet(SpeakerDetector):
        def warm(self):
            raise RuntimeError("modele/ancre absent (test degradation honnete)")
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    plug = SpeakerPlug(ring, emit, detector=FailWarmDet(engine=ScriptedSpeakerEngine(0.9), centroid=E1))
    plug._loop()                                            # warm leve -> sort immediatement (retour)
    assert plug.state["warm_failed"] is True


# ══════════ COEUR REEL — le VRAI ECAPA reproduit la SEPARATION du banc ══════════

def _model_present() -> bool:
    need = ("embedding_model.ckpt", "hyperparams.yaml", "mean_var_norm_emb.ckpt")
    ok_model = all(os.path.exists(os.path.join(_MODEL_DIR, f)) for f in need)
    ok_anchor = all(os.path.exists(os.path.join(_ANCHOR_DIR, f)) for f in ANCHOR_CLIPS)
    ok_far = os.path.exists(os.path.join(_ANCHOR_DIR, "raw_far.wav"))
    ok_a20 = len(glob.glob(os.path.join(_A20_DIR, "*.wav"))) > 0
    return ok_model and ok_anchor and ok_far and ok_a20


def test_v6_ecapa_reproduces_banc_separation():
    # NON-skippable hors absence des assets : la fidelite au banc EST l'enjeu de la regle perf (produit >= banc).
    # Le VRAI ECAPA (modele vendorise) + centroide 3-clip separe Yohann held-out (raw_far) de la voix de Sophia
    # (A20) — EER 0 % a l'integration (banc conv 33-34, reproduit dans le venv produit conv 46 : A20 moy ~0,15).
    if not _model_present():
        pytest.skip("modele ECAPA vendorise / ancre / clips A20 absents (resources/models/speaker/ — CF2, gitignore)")
    det = SpeakerDetector(engine=EcapaEngine())            # centroide construit depuis l'ancre au warm
    det.warm()
    # Yohann held-out : une fenetre de ~2,5 s de raw_far (HORS centroide raw_near/raw/raw_soft -> pas de triche)
    far = load16(os.path.join(_ANCHOR_DIR, "raw_far.wav"))
    ywin = far[int(5 * RATE):int(7.5 * RATE)]
    vy = det.evaluate(ywin)
    assert vy is not None and vy[0] == "yohann" and vy[1] > det.threshold, f"Yohann held-out : {vy}"
    # A20 (voix de Sophia) : ~2,5 s (plusieurs clips concatenes ; resample 22050->16k dans load16, == banc)
    a20 = sorted(glob.glob(os.path.join(_A20_DIR, "*.wav")))
    sig = np.concatenate([load16(p) for p in a20[:8]])[:int(2.5 * RATE)]
    va = det.evaluate(sig)
    assert va is not None, "A20 : evaluate ne doit pas echouer"
    # LE CŒUR : SEPARATION nette (Yohann >> A20) = la fidelite au banc (EER 0 % a l'integration)
    assert vy[1] > va[1] + 0.15, f"separation insuffisante : Yohann {vy[1]:.3f} vs A20 {va[1]:.3f}"


def test_v6_ecapa_embedding_shape_and_norm():
    if not _model_present():
        pytest.skip("modele ECAPA vendorise absent")
    eng = EcapaEngine()
    eng.warm()
    e = eng.embed(np.zeros(RATE, dtype=np.float32))
    assert e.shape == (192,) and abs(float(np.linalg.norm(e)) - 1.0) < 1e-3   # 192-dim, L2-normalise (v6_service)
