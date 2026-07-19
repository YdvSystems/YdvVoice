"""U-V5 (plan 01) — la FIN DE TOUR FINE (Smart Turn v3.2).

Trois etages, comme test_v4 :
  - LOGIQUE PURE (deterministe, SANS ONNX) : `hold_reason` (gardes A/B) + `effective_plafond` (hierarchie
    des plafonds : grace de fin / grace courte / fallback) — la decision de fin de tour se teste sans le modele.
  - PLOMBERIE (SttPlug + moteur turn SCRIPTE + VAD scripte) : elle FINIT vif quand Smart Turn est confiant
    (apres ENDGRACE), elle NE COUPE PAS sur une hesitation (prob basse), une REPRISE annule la grace, un tour
    court+confiant use la grace courte, un mot suspendu retient, un moteur qui CRASHE tombe au plafond
    fallback, l'ordre `stt.final` PRECEDE `turn.end`, et `turn.end` n'est emis QU'EN CONVERSATION (pas a
    l'ouvreur d'eveil). `turn=None` -> le SttPlug est EXACTEMENT V4 (les tests V4 le prouvent aussi).
  - COEUR REEL (le VRAI SmartTurnEngine) : la proba egale la REFERENCE du banc (transformers FE + ONNX,
    conv 25) BIT-a-bit -> le preprocessing (pad-gauche / do_normalize / proba directe sans sigmoide) est EXACT.
    NON-SKIPPABLE hors absence du modele vendorise (la fidelite est l'enjeu meme de la regle perf).

Le SttPlug se teste via `_tick()` (une iteration deterministe, positions ring seules — parite test_v4).
"""
import os

import numpy as np
import pytest

from audio.ring import RingBuffer
from consumers.stt import SttPlug, GROUP_SILENCE_S, TURN_PREATTACK_S
from consumers.turn import (TurnEngine, TurnDetector, SmartTurnEngine, effective_plafond, hold_reason,
                            TURN_THR, MIN_SPEECH_END, HELD_PLAFOND, HELD_CONF, ENDGRACE, PLAFOND, WIN,
                            _MODEL_DIR)
from test_v4 import ScriptedSttEngine, FakeWake, _collect, _sil, _noise, _run

RATE = 16000


class ScriptedTurnEngine(TurnEngine):
    """Moteur de fin de tour SCRIPTE : rend une proba FIXE (ou une liste, un element par appel) -> teste la
    LOGIQUE du SttPlug (graces, plafonds, ordering) sans ONNX ni audio reel. `fail=True` -> leve (fallback)."""

    def __init__(self, prob=0.9, fail=False):
        self._prob = prob
        self._fail = fail
        self.calls = 0

    def predict(self, audio):
        self.calls += 1
        if self._fail:
            raise RuntimeError("moteur turn scripte en echec (test fallback)")
        if isinstance(self._prob, (list, tuple)):
            return float(self._prob[min(self.calls - 1, len(self._prob) - 1)])
        return float(self._prob)

    def warm(self):
        pass


def _conv_plug(prob=0.9, text="je veux un cafe", fail=False, armed=True):
    """SttPlug en CONVERSATION (FakeWake arme) avec un moteur STT + un moteur turn scriptes."""
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake()
    wake.armed = armed
    det = TurnDetector(engine=ScriptedTurnEngine(prob, fail=fail))
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine(text), turn=det)
    return ring, events, wake, det, plug


def _one_turn(plug, ring, parle_s, tail_s, seed=1):
    """Ecrit [sil | parole | sil] et poste les marques VAD d'UN tour ; retourne (seg_start, seg_stop)."""
    ring.write(_sil(0.3))
    s = ring.write_pos()
    ring.write(_noise(parle_s, seed=seed))
    e = ring.write_pos()
    ring.write(_sil(tail_s))
    plug.on_vad("evt.vad.start", {"pos": s})
    plug.on_vad("evt.vad.stop", {"pos": e})
    return s, e


# ══════════ Logique PURE : gardes A/B + hierarchie des plafonds ══════════

def test_hold_reason_guards():
    assert hold_reason(0.6, "cafe") == "trop court"          # (A) parole < MIN_SPEECH_END
    assert hold_reason(2.0, "mais") is not None              # (B) mot suspendu
    assert hold_reason(2.0, "le") is not None
    assert hold_reason(2.0, "cafe") is None                  # assez long + mot terminal -> laisse finir
    assert hold_reason(2.0, "") is None                      # pas de committe (best-effort) -> laisse finir


def test_effective_plafond_all_branches():
    # pas confiant -> attend (fallback 3 s)
    assert effective_plafond(0.2, 3.0, "cafe")[0] == PLAFOND
    # confiant, rien ne retient -> grace de fin (ENDGRACE)
    assert effective_plafond(0.95, 3.0, "cafe")[0] == ENDGRACE
    # confiant MAIS court + tres confiant (> HELD_CONF) -> grace courte
    assert effective_plafond(0.9, 0.6, "")[0] == HELD_PLAFOND
    # confiant MAIS court PEU confiant (<= HELD_CONF) -> retenu, reste 3 s
    assert effective_plafond(0.6, 0.6, "")[0] == PLAFOND
    # confiant MAIS mot suspendu -> retenu, reste 3 s
    assert effective_plafond(0.95, 3.0, "mais")[0] == PLAFOND


def test_effective_plafond_respects_threshold_param():
    # un seuil injecte (calibration §6) change la frontiere confiant/pas-confiant
    assert effective_plafond(0.4, 3.0, "cafe", threshold=0.3)[0] == ENDGRACE   # 0.4 > 0.3 -> confiant
    assert effective_plafond(0.4, 3.0, "cafe", threshold=0.5)[0] == PLAFOND    # 0.4 <= 0.5 -> attend


# ══════════ Plomberie : la fin de tour dans le SttPlug ══════════

def test_v5_confident_ends_after_endgrace_and_emits_turn_end():
    # Smart Turn CONFIANT (0.95) sur un tour de 2 s -> plafond raccourci a ENDGRACE (0.7 s) -> une queue de
    # 1,0 s (> 0,7) finalise. LE TEST MORD : avec turn=None (V4), le plafond serait GROUP_SILENCE (3,0 s) et
    # 1,0 s NE finaliserait PAS -> c'est bien V5 qui rend la fin VIVE (jumeau temoin ci-dessous).
    ring, events, wake, det, plug = _conv_plug(prob=0.95, text="je veux un cafe")
    s, e = _one_turn(plug, ring, parle_s=2.0, tail_s=1.0)
    _run(plug, ticks=60)
    types = [t for t, _ in events]
    finals = [p for t, p in events if t == "evt.stt.final"]
    ends = [p for t, p in events if t == "evt.turn.end"]
    assert len(finals) == 1 and len(ends) == 1                       # a FINI (vif) grace a V5
    assert "smart-turn" in ends[0]["reason"]                         # raison = Smart Turn (pas fallback)
    assert ends[0]["mark"] == s and abs(ends[0]["prob"] - 0.95) < 1e-6
    assert types.index("evt.stt.final") < types.index("evt.turn.end")   # ORDRE grave : stt.final PRECEDE turn.end
    assert plug.state["turns_ended"] == 1

    # jumeau TEMOIN (turn=None -> V4) : meme queue 1,0 s -> le plafond 3,0 s ne finalise PAS (V4 attend)
    ring2 = RingBuffer(30 * RATE)
    ev2, emit2 = _collect()
    w2 = FakeWake(); w2.armed = True
    p2 = SttPlug(ring2, emit2, wake=w2, engine=ScriptedSttEngine("je veux un cafe"))   # turn=None
    _one_turn(p2, ring2, parle_s=2.0, tail_s=1.0)
    _run(p2, ticks=60)
    assert [p for t, p in ev2 if t == "evt.stt.final"] == []          # V4 : PAS fini (plafond 3 s pas atteint)


def test_v5_hesitation_never_cuts():
    # Smart Turn PAS confiant (0.2) = une hesitation/pause -> plafond reste au FALLBACK (3,0 s). Une queue de
    # 1,5 s (< 3,0) NE coupe PAS : elle le laisse continuer (l'invariant SACRE de Yohann). LE TEST MORD :
    # turn_plaf doit RESTER 3,0 (si V5 finalisait a tort sur 0.2, stt.final apparaitrait).
    ring, events, wake, det, plug = _conv_plug(prob=0.2)
    _one_turn(plug, ring, parle_s=2.0, tail_s=1.5)
    _run(plug, ticks=60)
    assert [p for t, p in events if t == "evt.stt.final"] == []       # n'a PAS coupe
    assert plug._turn_plaf == GROUP_SILENCE_S                         # plafond reste le fallback (elle attend)


def test_v5_hesitation_then_plafond_fallback_still_ends():
    # meme hesitation (0.2) MAIS une queue de 3,2 s (> PLAFOND 3,0) -> le FALLBACK ferme quand meme le tour
    # (le plafond tient meme si Smart Turn n'est jamais confiant, plan 01 §4.3).
    ring, events, wake, det, plug = _conv_plug(prob=0.2)
    _one_turn(plug, ring, parle_s=2.0, tail_s=3.2)
    _run(plug, ticks=120)
    ends = [p for t, p in events if t == "evt.turn.end"]
    assert len(ends) == 1 and ends[0]["reason"] == "plafond"         # ferme au fallback


def test_v5_resumption_cancels_grace():
    # REPRISE de parole = annule la grace. Apres un 1er stop confiant (grace posee), un nouveau vad.start
    # remet le plafond au fallback (3,0). LE TEST MORD : sans le reset dans _drain_cmds, une grace courte
    # perimee pourrait finaliser un tour que Yohann n'a PAS fini.
    ring, events, wake, det, plug = _conv_plug(prob=0.9)
    ring.write(_sil(0.3))
    s1 = ring.write_pos()
    ring.write(_noise(0.6, seed=1))          # court -> parle 0,6 < MIN_SPEECH_END, prob 0.9 > HELD_CONF -> grace COURTE
    e1 = ring.write_pos()
    ring.write(_sil(0.2))                     # gap COURT (< HELD_PLAFOND 0,8) : le tour ne se ferme pas encore
    plug.on_vad("evt.vad.start", {"pos": s1})
    plug.on_vad("evt.vad.stop", {"pos": e1})
    _run(plug, ticks=10)
    assert plug._turn_plaf == HELD_PLAFOND                            # grace courte POSEE (0,8)
    s2 = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s2})                         # REPRISE
    plug._tick()                                                     # draine le start
    assert plug._turn_plaf == GROUP_SILENCE_S                         # grace ANNULEE -> retour au fallback
    assert [p for t, p in events if t == "evt.stt.final"] == []       # rien finalise (il continue)


def test_v5_short_confident_uses_held_plafond():
    # tour COURT (0,7 s < MIN_SPEECH_END) MAIS Smart Turn TRES confiant (0.9 > HELD_CONF) = vraie fin courte
    # -> grace COURTE (0,8 s), pas le fallback 3 s (ne traine pas).
    ring, events, wake, det, plug = _conv_plug(prob=0.9)
    _one_turn(plug, ring, parle_s=0.7, tail_s=1.0)                    # tail 1,0 > HELD 0,8 -> finalise
    _run(plug, ticks=60)
    ends = [p for t, p in events if t == "evt.turn.end"]
    assert len(ends) == 1 and "grace courte" in ends[0]["reason"]


def test_v5_hanging_word_retains_wiring():
    # Garde B (franchissement acoustique->semantique valide conv 32) : le SttPlug LIT le dernier mot COMMITTE et
    # le passe au detecteur. Confiant (0.95) + committe finissant sur « mais » (suspendu) -> RETENU (fallback
    # 3 s). On SEED le committe (le commit lui-meme = V4, deja teste ; ici on isole le CABLAGE de la garde B,
    # deterministe — le committe reel est best-effort/timing-dependant comme le banc). LE TEST MORD : le jumeau
    # terminal « cafe » donne la grace de fin (0,7).
    ring, events, wake, det, plug = _conv_plug(prob=0.95)
    plug._open_group(100)
    plug._seg_stop = 100 + int(2.0 * RATE)                           # parle 2 s (> MIN_SPEECH_END)
    plug._hypo.committed = [("je", 0.0, 0.5), ("pense", 0.5, 1.0), ("mais", 1.0, 1.5)]
    plug._turn_check()
    assert plug._turn_plaf == PLAFOND and "retenu" in plug._last_turn_reason   # « mais » suspendu -> RETENU

    ring2, ev2, w2, d2, p2 = _conv_plug(prob=0.95)                    # jumeau TEMOIN : mot TERMINAL
    p2._open_group(100)
    p2._seg_stop = 100 + int(2.0 * RATE)
    p2._hypo.committed = [("je", 0.0, 0.5), ("veux", 0.5, 1.0), ("cafe", 1.0, 1.5)]
    p2._turn_check()
    assert p2._turn_plaf == ENDGRACE                                 # « cafe » terminal -> grace de fin (0,7)


def test_v5_turn_diag_emits_eval_only_when_enabled(monkeypatch):
    # Diagnostic conv 48 (endpointing) : quand SOPHIA_TURN_DIAG=1, `_turn_check` emet `evt.turn.eval` a CHAQUE
    # evaluation (le score de CHAQUE pause, pas seulement la fin qui finalise) -> sert la calibration a la voix
    # (juge --endpointing). OFF par defaut : ZERO emission, ZERO impact prod. LE TEST MORD des deux cotes.
    import consumers.stt as stt_mod

    # OFF (defaut, env non pose) : aucune emission evt.turn.eval, decision INCHANGEE
    ring, events, wake, det, plug = _conv_plug(prob=0.9)
    plug._open_group(100)
    plug._seg_stop = 100 + int(2.0 * RATE)                           # parle 2 s (> MIN_SPEECH_END)
    plug._turn_check()
    assert [t for t, _ in events if t == "evt.turn.eval"] == []      # OFF -> rien emis
    assert plug._turn_plaf == ENDGRACE                               # la DECISION est la meme (grace de fin)

    # ON (SOPHIA_TURN_DIAG=1) : une emission par evaluation, avec le score + le contexte de decision
    monkeypatch.setattr(stt_mod, "_TURN_DIAG", True)
    ring2, ev2, w2, d2, p2 = _conv_plug(prob=0.9)
    p2._open_group(100)
    p2._seg_stop = 100 + int(2.0 * RATE)
    p2._turn_check()
    evals = [p for t, p in ev2 if t == "evt.turn.eval"]
    assert len(evals) == 1                                           # ON -> une emission
    assert evals[0]["prob"] == 0.9 and evals[0]["parle"] == 2.0      # le score Smart Turn + la duree du tour
    assert "reason" in evals[0] and "plaf" in evals[0]              # le contexte de la decision (calibration)
    assert p2._turn_plaf == ENDGRACE                                # la DECISION reste la meme (le diag n'influe pas)


def test_v5_engine_crash_falls_back_to_plafond():
    # un moteur Smart Turn qui CRASHE ne tue pas la boucle : le tour tombe au plafond FALLBACK (3 s) + l'erreur
    # est COMPTEE (parite _engine_errors). Le tour finit quand meme (degradation douce).
    ring, events, wake, det, plug = _conv_plug(fail=True)
    _one_turn(plug, ring, parle_s=2.0, tail_s=3.2)
    _run(plug, ticks=120)
    ends = [p for t, p in events if t == "evt.turn.end"]
    assert len(ends) == 1 and "fallback" in ends[0]["reason"]
    assert det.errors >= 1 and plug.state["turn_errors"] >= 1


def test_v5_turn_end_only_in_conversation_not_opener():
    # l'OUVREUR d'eveil (« bonjour sophia », Sophia DORT) -> reveil (evt.wake) mais AUCUN evt.turn.end : le tour
    # d'ouverture est signale par V3, pas par V5. LE TEST MORD : un tour de CONVERSATION (arme) emet turn.end.
    ring, events, wake, det, plug = _conv_plug(prob=0.95, text="bonjour sophia", armed=False)   # DORT
    s, _ = _one_turn(plug, ring, parle_s=1.0, tail_s=1.0)
    _run(plug, ticks=60)
    assert wake.wakes == [s]                                          # a reveille (portier/lecture rapide)
    assert [p for t, p in events if t == "evt.turn.end"] == []        # mais PAS de turn.end (ouvreur)
    assert plug.state["turns_ended"] == 0


def test_v5_preattack_04s_conversation_only():
    # Fidelite banc (conv 45, « coller au banc ») : Smart Turn recoit l'audio du tour a partir de 0,4 s AVANT
    # la marque VAD (banc oreilles_live.py:983 `turn_i16 = recent[-0.4s:]` ; le do_normalize moyenne sur 8 s ->
    # ces 0,4 s comptent). SCOPE conversation : le REVEIL (lecture rapide, guard retiree conv 44, latence /2)
    # n'est PAS touche -> pre-attaque VIDE. LE TEST MORD : sans _read_preattack, la conversation demarre a 0.
    ring, events, wake, det, plug = _conv_plug(prob=0.9)      # armed=True (conversation)
    ring.write(_noise(1.0))                                  # 1 s AVANT la marque (dispo dans le ring)
    s = ring.write_pos()
    plug._open_group(s)                                      # ouvre SANS lire -> mesure la pre-attaque SEULE
    assert abs(len(plug._turn_audio) / RATE - TURN_PREATTACK_S) < 0.01   # 0,4 s (fidele banc)

    ring2, ev2, w2, d2, p2 = _conv_plug(prob=0.9, armed=False)   # REVEIL (non arme)
    ring2.write(_noise(1.0))
    s2 = ring2.write_pos()
    p2._open_group(s2)
    assert len(p2._turn_audio) == 0                          # reveil : AUCUNE pre-attaque (INTACT, conv 44)


def test_v5_turn_check_gated_on_group_role_not_current_armed():
    # Croisé conv 45 (M2) : `_turn_check` est garde sur le ROLE du groupe (`_armed_at_open`), PAS sur l'arme
    # COURANT (`_armed_view`) — comme le feed audio et l'emission de turn.end. Un ouvreur d'eveil qui s'arme EN
    # COURS de groupe (chemin lent) ne doit PLUS faire tourner Smart Turn sur un `_turn_audio` VIDE. LE TEST MORD :
    # avec l'ancienne garde `_armed_view`, le moteur turn serait appele (calls==1) sur du vide.
    ring, events, wake, det, plug = _conv_plug(prob=0.9, text="je veux un cafe", armed=False)   # DORT
    ring.write(_sil(0.3)); s = ring.write_pos()
    ring.write(_noise(1.0)); e = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s})
    plug._tick()                                            # ouvre le groupe : _armed_at_open = False (dort)
    assert plug._armed_at_open is False and len(plug._turn_audio) == 0   # ouvreur -> pas de feed audio du tour
    wake.armed = True                                       # reveil EN COURS de groupe (comme _gate_check -> on_wake)
    plug.on_vad("evt.vad.stop", {"pos": e})
    calls_before = det._engine.calls
    _run(plug, ticks=5)                                     # draine le stop -> wake_check_pending -> (PAS de) turn_check
    assert det._engine.calls == calls_before               # Smart Turn n'a PAS tourne (garde _armed_at_open, pas de vide)
    assert plug._last_turn_prob is None                    # aucune decision (jamais sur du vide)
    assert [p for t, p in events if t == "evt.turn.end"] == []   # ouvreur -> jamais de turn.end


def test_v5_non_finite_prob_degrades_to_fallback():
    # Croisé conv 45 : le contrat `predict -> [0,1]` est garde a la FRONTIERE. Un moteur injecte NON conforme
    # (NaN/inf) degrade au fallback plafond au lieu d'empoisonner le JSON d'evt.turn.end. LE TEST MORD : sans la
    # garde `isfinite`, prob=NaN passerait dans effective_plafond ET dans le payload (round(NaN) -> NaN JSON).
    for bad in (float("nan"), float("inf"), float("-inf")):
        det = TurnDetector(engine=ScriptedTurnEngine(bad))
        plaf, reason, prob = det.evaluate(np.zeros(RATE, np.float32), 2.0, "")
        assert plaf == PLAFOND and "fallback" in reason and prob is None   # degrade, JAMAIS un NaN qui remonte
        assert det.errors >= 1


def test_v5_preattack_never_reads_past_mark():
    # S-12 (audit solo a fond conv 45) : la pre-attaque lit EXACTEMENT jusqu'a la marque, jamais AU-DELA — meme
    # si la marque est pres du plus-vieux echantillon (petit ring / marque ancienne). Sinon elle doublonnerait
    # l'audio que le worker relit depuis la marque -> intonation corrompue. LE TEST MORD : sans le fix, elle lit
    # 0,4 s (pre) depuis oldest et DEBORDE la marque ; avec le fix, elle s'arrete a la marque (pos - oldest).
    ring = RingBuffer(RATE)                                  # 1 s de fenetre
    events, emit = _collect()
    wake = FakeWake(); wake.armed = True
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("x"),
                   turn=TurnDetector(engine=ScriptedTurnEngine(0.9)))
    ring.write(_noise(1.5))                                  # 24000 ech -> oldest = 24000-16000 = 8000
    oldest = ring.write_pos() - RATE
    pos = oldest + int(0.1 * RATE)                           # marque a 0,1 s de l'oldest -> pos-0,4s << oldest
    plug._armed_at_open = True
    pre = plug._read_preattack(pos)
    assert len(pre) == pos - oldest                          # EXACTEMENT [oldest, pos) = 0,1 s (jamais au-dela)
    assert len(pre) < int(TURN_PREATTACK_S * RATE)           # borne a pos-oldest, PAS 0,4 s (sans le fix : 0,4 s)


def test_v5_overrun_resets_turn_state():
    # S-1 (audit solo conv 45) : un overrun (le ring distance le curseur -> contexte rompu) RESET l'etat V5
    # (turn_audio + plafond). Sans ca, Smart Turn tournerait sur de l'audio PERIME et `parle` pourrait devenir
    # NEGATIF (ancien _seg_stop < marque re-ancree). LE TEST MORD : apres l'overrun, _turn_audio est VIDE et
    # _turn_plaf est revenu au fallback (avant le fix, ils gardaient l'etat d'avant le trou).
    ring = RingBuffer(RATE)                                  # petit ring : 1 s de fenetre
    events, emit = _collect()
    wake = FakeWake(); wake.armed = True                     # conversation
    det = TurnDetector(engine=ScriptedTurnEngine(0.9))
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("cafe"), turn=det)
    ring.write(_sil(0.3))
    s = ring.write_pos()
    plug.on_vad("evt.vad.start", {"pos": s})
    plug._tick()                                             # ouvre le groupe (armed_at_open True), seek a la marque
    ring.write(_noise(0.6))
    plug._tick()                                             # lit -> _turn_audio se remplit
    assert len(plug._turn_audio) > 0                         # precondition : audio de tour accumule
    plug._turn_plaf = HELD_PLAFOND                           # simule une grace en cours (a annuler par l'overrun)
    ring.write(_noise(1.25))                                 # oldest passe AU-DELA de la marque -> overrun au read
    plug.on_vad("evt.vad.stop", {"pos": ring.write_pos()})
    plug._tick()                                             # lit -> overrun detecte -> _on_overrun
    assert plug._overruns >= 1
    assert len(plug._turn_audio) == 0                        # S-1 : turn_audio RESET (pas de perime)
    assert plug._turn_plaf == GROUP_SILENCE_S                # S-1 : plafond revenu au fallback


def test_v5_smart_turn_partial_warm_leaves_sess_none():
    # S-7 (audit solo conv 45) : si le chargement de la mel (ou du modele) echoue, warm() ne doit PAS laisser
    # _sess set (etat MI-CHARGE -> le prochain warm early-return -> predict crashe sur _mel=None). Un mel_path
    # bidon -> warm LEVE et _sess reste None (retry PROPRE). LE TEST MORD : avant le fix, _sess etait set.
    eng = SmartTurnEngine(mel_path=os.path.join(_MODEL_DIR, "nexistepas__.npy"))
    with pytest.raises(Exception):
        eng.warm()
    assert eng._sess is None                                 # pas d'etat mi-charge -> retry propre


def test_v5_disabled_when_turn_none_is_v4():
    # turn=None -> V5 inerte : le plafond conversation reste GROUP_SILENCE (V4), aucun turn.end jamais.
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake(); wake.armed = True
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("je veux un cafe"))   # turn=None
    _one_turn(plug, ring, parle_s=2.0, tail_s=3.4)                    # 3,4 > GROUP_SILENCE 3,0 -> finalise au plafond
    _run(plug, ticks=120)
    assert [p for t, p in events if t == "evt.stt.final"]             # a fini (au plafond V4)
    assert [p for t, p in events if t == "evt.turn.end"] == []        # aucun turn.end (V5 inerte)
    assert plug.state["turn_enabled"] is False


# ══════════ COEUR REEL — le VRAI Smart Turn == la reference du banc (fidelite du preprocessing) ══════════

# Golden : banc transformers WhisperFeatureExtractor(chunk_length=8, do_normalize=True) + smart-turn-v3.2-cpu.onnx
# (genere design-first conv 45). Le sidecar reproduit le preprocessing avec torch.stft + la matrice mel
# vendorisee ; la proba doit EGALER ces valeurs (prouve pad-gauche / do_normalize / proba directe EXACTS).
def _sine_2s():
    t = np.arange(int(2.0 * RATE)) / RATE
    return (0.2 * np.sin(2 * np.pi * 180 * t) * (1 + 0.5 * np.sin(2 * np.pi * 3 * t))).astype(np.float32)


_GOLDEN = [
    (lambda: (np.random.default_rng(11).standard_normal(int(0.5 * RATE)) * 0.05).astype(np.float32), 0.940313),
    (lambda: (np.random.default_rng(22).standard_normal(int(3.0 * RATE)) * 0.05).astype(np.float32), 0.897182),
    (lambda: (np.random.default_rng(33).standard_normal(int(10.0 * RATE)) * 0.05).astype(np.float32), 0.735764),
    (_sine_2s, 0.012963),
    (lambda: np.zeros(WIN, dtype=np.float32), 0.987531),
]


def _model_present() -> bool:
    return (os.path.exists(os.path.join(_MODEL_DIR, "smart-turn-v3.2-cpu.onnx"))
            and os.path.exists(os.path.join(_MODEL_DIR, "mel_filters_80.npy")))


def test_v5_smart_turn_engine_fidelity_to_banc():
    # NON-SKIPPABLE hors absence du modele vendorise : la fidelite du preprocessing EST l'enjeu de la regle
    # perf (produit >= banc). Reproduction torch.stft + mel vendorisee == transformers FE, BIT-a-bit.
    if not _model_present():
        pytest.skip("modele smart-turn vendorise absent (resources/models/smart-turn/ — CF2, gitignore)")
    eng = SmartTurnEngine()
    eng.warm()
    for make_sig, golden in _GOLDEN:
        got = eng.predict(make_sig())
        assert abs(got - golden) < 1e-4, f"fidelite rompue : {got:.6f} vs banc {golden:.6f}"


def test_v5_real_smart_turn_integration_in_conv():
    # le VRAI SmartTurnEngine dans le SttPlug (conversation) : sur un signal que Smart Turn juge FINI (bruit ->
    # proba haute, cf. golden), le tour finit et emet turn.end SANS crash (turn_errors==0). Prouve l'integration
    # du vrai moteur (comme e2e-v4 prouve le vrai faster-whisper). Skip si modele absent.
    if not _model_present():
        pytest.skip("modele smart-turn vendorise absent")
    ring = RingBuffer(30 * RATE)
    events, emit = _collect()
    wake = FakeWake(); wake.armed = True
    det = TurnDetector(SmartTurnEngine())
    det.warm()
    plug = SttPlug(ring, emit, wake=wake, engine=ScriptedSttEngine("je veux un cafe"), turn=det)
    _one_turn(plug, ring, parle_s=2.0, tail_s=1.2)                    # 2 s de bruit -> Smart Turn confiant (golden ~0.9)
    _run(plug, ticks=80)
    ends = [p for t, p in events if t == "evt.turn.end"]
    assert len(ends) == 1                                             # le vrai moteur a tranche -> turn.end
    assert det.errors == 0 and plug.state["turn_errors"] == 0         # aucun crash du vrai moteur
    assert det.last_prob is not None and det.last_prob > TURN_THR     # confiant sur ce signal (parite golden)
