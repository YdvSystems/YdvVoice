# -*- coding: utf-8 -*-
"""U-V13 (plan 01) — la PHRASE DE SECOURS (« jamais de silence », F7/S11/B2). Trois étages, comme test_v7 :

  - LOGIQUE PURE (`FallbackGuard`, déterministe, SANS thread ni audio) : la machine d'épisode — turn.end
    + 0 client → joue UNE fois · le wake SEUL ne joue JAMAIS (S11 : `_gate_check` peut émettre evt.wake en
    plein milieu d'une phrase qui continue) · l'appariement wake↔final du MÊME mark joue (les DEUX ordres,
    vérifiés à la source stt.py) · la parole AMBIANTE (final sans wake) ne joue jamais · client présent →
    jamais · reset à la (re)connexion → un NOUVEL épisode rejoue · fail-quiet (clients() qui lève → silence).
  - PLOMBERIE (`FallbackVoice` + moteur & sortie FAKES) : precache (cache rempli · le moteur transitoire est
    LIBÉRÉ = B2 réinterprété · IDEMPOTENT sur les mêmes textes [double envoi boot → un seul travail] · textes
    changés → re-synthèse · une phrase ratée n'empêche pas les autres · warm KO → l'ancien cache reste) ·
    lecture (en ENTIER via Output.play bloquant · thread one-shot → l'appelant [thread STT] n'est jamais
    bloqué · cache vide → silence honnête · evt.fallback.played émis) · stop (coupe une lecture en vol).
  - le COEUR RÉEL (vrai Piper + vrai STT + vraie déconnexion WS) = E2E-V13 (tests/e2e/e2e-v13.mjs, I-4).

RE-CROISÉ conv 58 (les corrections se re-auditent) : consommation ATOMIQUE d'ÉPOQUE (`try_consume` — un
seul gagnant sous course [ROB2-1] · un reset dans la fenêtre décision→lancement jette le candidat périmé
[ROB2-3] · un start() qui lève REND l'épisode [ROB2-4]) · la garde de génération du chemin EXCEPT (un
zombie qui LÈVE ne nettoie pas le vol frais [ROB2-2]).
"""
import threading
import time
import weakref

import numpy as np
import pytest

from test_v4 import _collect
from tts.engine import TtsEngine
from tts.fallback import PRIMARY_PHRASE, FallbackGuard, FallbackVoice
from tts.plug import Output


# ══════════ Fakes ══════════

class FakeSynthEngine(TtsEngine):
    """Moteur de PRÉ-SYNTHÈSE scripté : audio déterministe (∝ texte). `warm_fail` → filet indisponible ;
    `fail_on` → une phrase donnée rate (les autres continuent) ; `synth_delay` → pré-synthèse lente (SOLO-1)."""

    sample_rate = 16000

    def __init__(self, warm_fail=False, fail_on=None, synth_delay=0.0):
        self.calls = []
        self.warm_fail = warm_fail
        self.fail_on = set(fail_on or ())
        self.synth_delay = synth_delay

    def warm(self):
        if self.warm_fail:
            raise RuntimeError("Piper absent (test)")

    def synth(self, text):
        self.calls.append(text)
        if text in self.fail_on:
            raise RuntimeError("synth en echec (test)")
        if self.synth_delay:
            time.sleep(self.synth_delay)
        return np.ones(max(1, len(text) * 10), dtype=np.float32) * 0.1


class FakeOut(Output):
    """Sortie scriptée : enregistre (taille, sr) de ce qui joue « en entier », compte les stop()."""

    def __init__(self, play_dur=0.0):
        self.played = []
        self.stops = 0
        self.play_dur = play_dur
        self._lock = threading.Lock()

    def play(self, audio, sr):
        if self.play_dur:
            time.sleep(self.play_dur)
        with self._lock:
            self.played.append((int(len(audio)), int(sr)))

    def stop(self):
        self.stops += 1


def _wait(pred, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return True
        time.sleep(0.005)
    return False


def _voice(clients, engine=None, output=None):
    events, emit = _collect()
    engines = []

    def factory():
        e = engine if engine is not None else FakeSynthEngine()
        engines.append(e)
        return e
    v = FallbackVoice(emit, clients, engine_factory=factory,
                      output=output if output is not None else FakeOut())
    return events, v, engines


def _precache_ok(v, phrases):
    r = v.precache(phrases)
    assert r["ok"] is True
    assert _wait(lambda: not v.state["pending"]), "pre-synthese jamais finie"
    return r


PHRASES = [{"name": "secours", "text": "Mon cerveau ne répond pas."}]


# ══════════ LOGIQUE PURE : FallbackGuard (la machine d'épisode) ══════════

def test_guard_turn_end_sans_client_candidat_puis_une_fois():
    """ROB-M2 : on_event rend un CANDIDAT (l'EPOQUE de l'episode — sans consommer : la consommation
    `try_consume` se fait au lancement REEL de la lecture) ; apres try_consume, plus de candidat (S11)."""
    g = FallbackGuard(lambda: 0)
    e1 = g.on_event("evt.turn.end", {})
    assert e1 is not None                                  # panne + tour fini -> candidat (epoque rendue)
    assert g.on_event("evt.turn.end", {}) == e1            # PAS consomme (lancement pas encore fait) -> re-candidate
    assert g.try_consume(e1) is True                       # le lancement reel consomme (test-and-set atomique)
    assert g.on_event("evt.turn.end", {}) is None          # S11 : UNE fois par episode
    assert g.state["played_this_episode"] is True


def test_guard_client_present_ne_joue_jamais():
    g = FallbackGuard(lambda: 1)
    assert g.on_event("evt.turn.end", {}) is None
    assert g.state["played_this_episode"] is False         # rien de consomme : l'orchestrateur traite


def test_guard_wake_seul_ne_joue_jamais():
    """S11 à la lettre : le wake peut arriver EN PLEIN MILIEU d'une phrase qui continue (`_gate_check`
    au fil du committé, stt.py) → jamais un déclenchement au wake seul."""
    g = FallbackGuard(lambda: 0)
    assert g.on_event("evt.wake", {"pos": 100}) is None
    assert g.state["played_this_episode"] is False


def test_guard_paire_wake_puis_final_joue():
    """Le chemin NOMINAL du réveil (lecture rapide / portier-au-fil) : wake PUIS final du même mark."""
    g = FallbackGuard(lambda: 0)
    assert g.on_event("evt.wake", {"pos": 100}) is None
    assert g.on_event("evt.stt.final", {"mark": 100}) is not None


def test_guard_paire_final_puis_wake_joue():
    """Le chemin portier-au-FINALIZE (stt.py `_finalize` : `_emit_final` AVANT `_gate_check`) : final
    PUIS wake du même mark — l'appariement couvre les DEUX ordres."""
    g = FallbackGuard(lambda: 0)
    assert g.on_event("evt.stt.final", {"mark": 200}) is None
    assert g.on_event("evt.wake", {"pos": 200}) is not None


def test_guard_parole_ambiante_ne_joue_jamais():
    """Yohann parle à quelqu'un d'autre dans la pièce (veille, orchestrateur mort) : des finals SANS wake
    → elle n'est pas sollicitée, elle se tait."""
    g = FallbackGuard(lambda: 0)
    for mark in (10, 20, 30):
        assert g.on_event("evt.stt.final", {"mark": mark}) is None
    assert g.state["played_this_episode"] is False


def test_guard_marks_differents_ne_s_apparient_pas():
    """Un vieux wake (pos=100) ne s'apparie JAMAIS avec le final d'un AUTRE groupe (mark=999) — pas de
    fausse « fin de tour de réveil » fabriquée à cheval sur deux groupes."""
    g = FallbackGuard(lambda: 0)
    assert g.on_event("evt.wake", {"pos": 100}) is None
    assert g.on_event("evt.stt.final", {"mark": 999}) is None
    assert g.state["played_this_episode"] is False


def test_guard_paire_consommee_meme_avec_client():
    """Client présent au moment de l'appariement → pas de lecture, ET la paire est CONSOMMÉE (un final
    futur ne ressuscite pas un vieux wake)."""
    n = {"clients": 1}
    g = FallbackGuard(lambda: n["clients"])
    g.on_event("evt.wake", {"pos": 100})
    assert g.on_event("evt.stt.final", {"mark": 100}) is None    # client la -> silence
    n["clients"] = 0
    assert g.on_event("evt.stt.final", {"mark": 100}) is None    # paire consommee -> pas de rejeu fantome
    assert g.state["wake_pos"] is None


def test_guard_reset_ouvre_un_nouvel_episode():
    g = FallbackGuard(lambda: 0)
    e1 = g.on_event("evt.turn.end", {})
    assert e1 is not None
    assert g.try_consume(e1) is True                        # lancement reel (episode consomme)
    g.episode_reset()                                       # l'orchestrateur est revenu... puis re-parti
    e2 = g.on_event("evt.turn.end", {})
    assert e2 is not None and e2 != e1                      # NOUVEL episode -> re-candidate (epoque a tourne)
    assert g.try_consume(e2) is True
    assert g.on_event("evt.turn.end", {}) is None


def test_guard_episode_consume_ferme_l_episode():
    """ROB-M4 : une deconnexion PROPRE (close frame — arret T6, IpcClient.close()) n'est JAMAIS une panne :
    `episode_consume` marque l'episode consomme SANS lecture -> aucun candidat jusqu'a la reconnexion."""
    g = FallbackGuard(lambda: 0)
    g.episode_consume()                                     # le dernier client est parti PROPREMENT
    assert g.on_event("evt.turn.end", {}) is None           # arret volontaire -> jamais « mon cerveau ne repond pas »
    g.episode_reset()                                       # reconnexion -> nouvel episode
    assert g.on_event("evt.turn.end", {}) is not None       # un futur CRASH reel re-arme le filet


def test_guard_clients_qui_leve_fail_quiet():
    """`clients()` qui LÈVE → « ne pas jouer » (parler à tort PAR-DESSUS une conversation normale serait
    pire que rater une phrase de secours) — compté, jamais avalé."""
    def boom():
        raise RuntimeError("ws_count inaccessible (test)")
    g = FallbackGuard(boom)
    assert g.on_event("evt.turn.end", {}) is None
    assert g.state["clients_errors"] == 1
    assert g.state["played_this_episode"] is False


def test_guard_payload_malforme_ne_leve_jamais():
    g = FallbackGuard(lambda: 0)
    assert g.on_event("evt.wake", {}) is None               # pos absent
    assert g.on_event("evt.wake", {"pos": "abc"}) is None   # pos invalide
    assert g.on_event("evt.stt.final", {"mark": True}) is None   # bool n'est pas une marque
    assert g.on_event("evt.autre", {"x": 1}) is None        # vocabulaire inconnu -> ignore
    assert g.state["played_this_episode"] is False


def test_guard_try_consume_atomique_un_seul_gagnant():
    """re-croisé conv 58 (ROB2-1, REPRODUIT par l'audit) : « une fois par épisode » est tenu par le CODE
    (test-and-set atomique), plus par la convention « émetteur unique = le worker STT » — N consommateurs
    simultanés du MÊME candidat → exactement UN gagne, quel que soit l'entrelacement."""
    g = FallbackGuard(lambda: 0)
    e = g.on_event("evt.turn.end", {})
    assert e is not None
    results = []
    lock = threading.Lock()
    bar = threading.Barrier(8)

    def racer():
        bar.wait()                                          # tous relâchés EXACTEMENT en même temps
        r = g.try_consume(e)
        with lock:
            results.append(r)
    ts = [threading.Thread(target=racer) for _ in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert results.count(True) == 1, f"consommation PAS atomique : {results.count(True)} gagnants (S11 perdrait « une fois »)"
    assert g.state["played_this_episode"] is True


def test_guard_reset_dans_la_fenetre_jette_le_candidat_perime():
    """re-croisé conv 58 (ROB2-3, REPRODUIT par l'audit) : une RECONNEXION (`episode_reset`) tombée dans
    la fenêtre décision→lancement → le `try_consume` TARDIF de l'ancien épisode est JETÉ (l'époque a
    tourné) : l'épisode NEUF reste vierge — un re-crash suivant a droit à SA phrase (avant le fix :
    l'épisode réel héritait played=True → filet MUET jusqu'à la prochaine reconnexion)."""
    g = FallbackGuard(lambda: 0)
    e1 = g.on_event("evt.turn.end", {})
    assert e1 is not None                                   # candidat de l'episode A (crash)
    g.episode_reset()                                       # l'orchestrateur SE RECONNECTE dans la fenetre
    assert g.try_consume(e1) is False                       # le candidat PERIME est jete
    assert g.state["played_this_episode"] is False          # l'episode B (neuf) est VIERGE
    e2 = g.on_event("evt.turn.end", {})                     # re-crash reel (1006) -> tour fini
    assert e2 is not None and e2 != e1                      # -> candidat de l'episode B (epoque neuve)
    assert g.try_consume(e2) is True                        # sa phrase joue (jamais de silence)
    # symetrie unconsume : un rendu PERIME ne touche pas non plus l'episode courant
    g.episode_reset()
    g.episode_consume()
    g.unconsume(e2)                                         # rendu d'une epoque passee -> ignore
    assert g.state["played_this_episode"] is True           # le consume (arret propre) tient


# ══════════ PLOMBERIE : FallbackVoice (precache + lecture + cycle de vie) ══════════

def test_precache_remplit_le_cache_et_libere_le_moteur():
    """B2 réinterprété : le moteur transitoire est LIBÉRÉ après la pré-synthèse (aucune résidence ajoutée).
    Prouvé par weakref : plus AUCUNE référence forte au moteur après le precache."""
    events, v, engines = _voice(lambda: 1)
    _precache_ok(v, PHRASES)
    assert v.state["cached"] == ["secours"]
    assert v.state["precaches"] == 1
    assert len(engines) == 1 and engines[0].calls == ["Mon cerveau ne répond pas."]
    ref = weakref.ref(engines[0])
    engines.clear()                                         # oter NOTRE reference de test
    import gc
    gc.collect()
    assert ref() is None, "le moteur transitoire n'a PAS ete libere (B2 : l'autorisation doit se refermer)"


def test_precache_idempotent_memes_textes():
    """Le boot nominal envoie cmd.tts.cache DEUX fois (hook phase 5 + ensureVoicePipeline) → un SEUL travail."""
    events, v, engines = _voice(lambda: 1)
    _precache_ok(v, PHRASES)
    r2 = v.precache(PHRASES)
    assert r2["ok"] is True and r2["started"] is False      # cache deja a jour -> no-op
    assert len(engines) == 1                                # AUCUN 2e moteur charge
    assert v.state["precaches"] == 1


def test_precache_textes_changes_resynthetise():
    events, v, engines = _voice(lambda: 1)
    _precache_ok(v, PHRASES)
    _precache_ok(v, [{"name": "secours", "text": "Nouveau texte."}])
    assert len(engines) == 2                                # textes changes -> vrai travail
    assert v.state["precaches"] == 2


def test_precache_une_phrase_ratee_n_empeche_pas_les_autres_et_reste_retentable():
    events, v, engines = _voice(lambda: 1, engine=FakeSynthEngine(fail_on={"KO."}))
    _precache_ok(v, [{"name": "secours", "text": "OK."}, {"name": "autre", "text": "KO."}])
    assert v.state["cached"] == ["secours"]                 # la phrase saine est en cache
    assert v.state["synth_errors"] == 1                     # l'echec est COMPTE, jamais avale
    # ROB-NIT-2 : un cache PARTIEL ne verrouille pas l'idempotence -> le meme payload se RE-TENTE
    r = v.precache([{"name": "secours", "text": "OK."}, {"name": "autre", "text": "KO."}])
    assert r["ok"] is True and r["started"] is True         # PAS « deja a jour » : la phrase ratee se retente


def test_precache_warm_ko_garde_l_ancien_cache():
    """Piper absent au 2e precache → l'ANCIEN cache reste le filet (mieux qu'un filet vidé)."""
    events, v, engines = _voice(lambda: 1)
    _precache_ok(v, PHRASES)
    calls = {"n": 0}

    def flaky_factory():
        calls["n"] += 1
        return FakeSynthEngine(warm_fail=True)
    v._engine_factory = flaky_factory                       # le 2e moteur echoue au warm
    r = v.precache([{"name": "secours", "text": "Autre."}])
    assert r["ok"] is True and r["started"] is True
    assert _wait(lambda: not v.state["pending"])
    assert calls["n"] == 1
    assert v.state["cached"] == ["secours"]                 # l'ancien filet est INTACT
    assert v.state["synth_errors"] >= 1


def test_precache_payload_invalide_ack_honnete():
    events, v, _ = _voice(lambda: 1)
    assert v.precache("pas une liste")["ok"] is False
    assert v.precache([{"name": "x"}])["ok"] is False       # text absent
    assert v.precache([])["ok"] is False                    # aucune phrase
    assert v.state["cached"] == []


def test_precache_different_pendant_un_vol_refus_honnete():
    """SOLO-1 : une pré-synthèse DIFFÉRENTE pendant qu'une est EN VOL → refus honnête (jamais deux moteurs
    en parallèle, jamais une course « le dernier thread fini gagne » sur le cache). Le MÊME payload en vol
    reste idempotent (double envoi boot)."""
    events, v, engines = _voice(lambda: 1, engine=FakeSynthEngine(synth_delay=0.3))
    r1 = v.precache(PHRASES)
    assert r1["ok"] is True and r1["started"] is True       # en vol (synth lente 0,3 s)
    r_same = v.precache(PHRASES)
    assert r_same["ok"] is True and r_same["started"] is False   # meme payload -> idempotent
    r_diff = v.precache([{"name": "secours", "text": "Autre texte."}])
    assert r_diff["ok"] is False and "en vol" in r_diff["note"]  # different -> refus honnete
    assert _wait(lambda: not v.state["pending"])
    assert v.state["cached"] == ["secours"]                 # le cache = le PREMIER (aucune course)
    assert len(engines) == 1                                # UN seul moteur a jamais tourne


def test_lecture_en_episode_joue_en_entier_et_emet():
    """Le chemin complet : precache → panne (0 client) → turn.end → la phrase joue EN ENTIER (Output.play
    reçoit l'audio complet) + evt.fallback.played émis."""
    out = FakeOut()
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    v.on_event("evt.turn.end", {})
    assert _wait(lambda: len(out.played) == 1), "la phrase de secours n'a pas joue"
    n, sr = out.played[0]
    assert n == len("Mon cerveau ne répond pas.") * 10 and sr == 16000   # l'audio COMPLET, au SR du moteur
    assert v.state["played_count"] == 1 and v.state["last_played"] == PRIMARY_PHRASE
    assert ("evt.fallback.played", {"name": "secours"}) in events


def test_lecture_ne_bloque_pas_le_thread_appelant():
    """`on_event` arrive du thread STT → la lecture (bloquante) part dans un thread ONE-SHOT : l'appelant
    rend la main tout de suite, même sur une lecture longue."""
    out = FakeOut(play_dur=0.5)
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    t0 = time.perf_counter()
    v.on_event("evt.turn.end", {})
    elapsed = time.perf_counter() - t0
    assert elapsed < 0.2, f"on_event a bloque {elapsed:.2f}s (la lecture doit etre un thread one-shot)"
    assert _wait(lambda: len(out.played) == 1)


def test_cache_vide_silence_puis_rejeu_des_le_cache_pose():
    """La fenêtre AVANT la fin de pré-synthèse (§4.7, assumée) : pas de cache → silence, jamais un crash —
    et ROB-M2 : l'épisode n'est PAS consommé à vide → dès que le cache arrive, le TOUR SUIVANT joue
    (le filet ne meurt jamais en silence sur un tour tombé dans la fenêtre)."""
    out = FakeOut()
    events, v, _ = _voice(lambda: 0, output=out)
    v.on_event("evt.turn.end", {})                          # tour dans la fenetre sans filet
    time.sleep(0.05)
    assert out.played == []
    assert v.state["played_count"] == 0
    assert v.state["played_this_episode"] is False          # ROB-M2 : episode INTACT (rien n'a ete lance)
    assert not any(t == "evt.fallback.played" for t, _ in events)
    _precache_ok(v, PHRASES)                                # la pre-synthese aboutit (tardive)
    v.on_event("evt.turn.end", {})                          # le tour SUIVANT
    assert _wait(lambda: len(out.played) == 1)              # -> la phrase joue enfin (jamais de silence durable)


def test_lecture_sans_nom_secours_joue_la_premiere():
    out = FakeOut()
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, [{"name": "panne-canal", "text": "Souci de canal."}])
    v.on_event("evt.turn.end", {})
    assert _wait(lambda: len(out.played) == 1)
    assert v.state["last_played"] == "panne-canal"


def test_une_fois_par_episode_puis_reset_rejoue():
    out = FakeOut()
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    v.on_event("evt.turn.end", {})
    assert _wait(lambda: len(out.played) == 1)
    v.on_event("evt.turn.end", {})                          # 2e tour, meme episode -> silence (S11)
    time.sleep(0.05)
    assert len(out.played) == 1
    v.episode_reset()                                       # l'orchestrateur revient... puis re-part
    v.on_event("evt.turn.end", {})
    assert _wait(lambda: len(out.played) == 2)              # nouvel episode -> rejoue (une fois)


def test_double_candidats_concurrents_une_seule_lecture():
    """re-croisé conv 58 (ROB2-1, ceinture au niveau VOICE) : DEUX threads émetteurs simultanés du même
    tour → UNE seule lecture lancée (le lancement entier — checks + consommation + start — vit sous le
    lock du voice ; la consommation atomique du guard est le verrou de fond)."""
    out = FakeOut(play_dur=0.2)
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    bar = threading.Barrier(2)

    def emitter():
        bar.wait()
        v.on_event("evt.turn.end", {})
    ts = [threading.Thread(target=emitter) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert _wait(lambda: len(out.played) == 1)
    time.sleep(0.05)
    assert len(out.played) == 1 and v.state["played_count"] == 1   # JAMAIS deux lectures dans l'episode


def test_thread_start_qui_leve_rend_l_episode(monkeypatch):
    """re-croisé conv 58 (ROB2-4/FID2-5) : un `Thread.start()` qui LÈVE (épuisement de threads OS —
    process en agonie) APRÈS la consommation → l'épisode est RENDU (`unconsume`), les compteurs ne
    mentent pas (played_count intact, play_errors compté, AUCUN evt.fallback.played) — et le tour
    suivant rejoue quand les threads reviennent."""
    import tts.fallback as fb
    out = FakeOut()
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    real_thread = fb.threading.Thread

    class BoomThread(real_thread):
        def start(self):
            raise RuntimeError("plus de threads OS (test)")
    monkeypatch.setattr(fb.threading, "Thread", BoomThread)
    v.on_event("evt.turn.end", {})                          # le lancement echoue au start()
    assert out.played == []
    assert v.state["play_errors"] == 1                      # compte, jamais avale
    assert v.state["played_count"] == 0                     # les compteurs ne mentent pas
    assert v.state["played_this_episode"] is False          # l'episode est RENDU (rien n'a joue)
    assert not any(t == "evt.fallback.played" for t, _ in events)   # pas d'evenement menteur
    monkeypatch.setattr(fb.threading, "Thread", real_thread)
    v.on_event("evt.turn.end", {})                          # les threads reviennent -> le tour suivant
    assert _wait(lambda: len(out.played) == 1)              # -> la phrase joue enfin (jamais de silence)


def test_stop_coupe_une_lecture_en_vol_et_refuse_la_suite():
    out = FakeOut(play_dur=0.4)
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    v.on_event("evt.turn.end", {})
    assert _wait(lambda: out.play_dur and v.state["played_count"] == 1)
    v.stop()                                                # arret volontaire (graceful_release)
    assert out.stops >= 1                                   # la lecture en vol est COUPEE (pas un episode a annoncer)
    v.episode_reset()
    v.on_event("evt.turn.end", {})                          # apres stop : plus JAMAIS de lecture
    time.sleep(0.05)
    assert v.state["played_count"] == 1
    r = v.precache(PHRASES)
    assert r["ok"] is False                                 # precache refuse apres stop (ack honnete)


def test_lecture_en_vol_skip_compte_episode_intact_puis_rejoue():
    """ROB-M2 (reproduit par l'audit croisé) : reconnexion + re-crash PENDANT que la lecture de l'épisode
    précédent joue encore (~3,4 s au vrai Piper) → le candidat du nouvel épisode est SKIPPÉ (compté) mais
    l'épisode n'est PAS consommé → le tour suivant (lecture finie) REJOUE. Avant le fix : épisode avalé en
    silence (played_this_episode=True, rien ne jouera, aucun compteur)."""
    out = FakeOut(play_dur=0.3)
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    v.on_event("evt.turn.end", {})                          # episode 1 -> lecture LONGUE (0,3 s) part
    assert _wait(lambda: v.state["played_count"] == 1)
    v.episode_reset()                                       # l'orchestrateur revient... et re-crashe dans la lecture
    v.on_event("evt.turn.end", {})                          # tour du NOUVEL episode PENDANT la lecture en vol
    assert _wait(lambda: v.state["play_skips"] == 1)        # skip COMPTE (jamais avale)
    assert v.state["played_this_episode"] is False          # l'episode n'est PAS consomme
    assert _wait(lambda: v.state["played_count"] == 1 and not v._play_thread.is_alive())  # la lecture 1 finit
    v.on_event("evt.turn.end", {})                          # le tour suivant
    assert _wait(lambda: len(out.played) == 2)              # -> REJOUE (le nouvel episode a sa phrase)


def test_precache_stale_relance_et_jette_le_zombie():
    """ROB-M1 (reproduit par l'audit croisé) : un warm Piper qui PEND ne tue plus le filet à vie — au-delà
    de la deadline (stale_s), le vol est déclaré MORT (compté), un NOUVEAU precache part ; et si le zombie
    se réveille plus tard, son résultat est JETÉ (garde de GÉNÉRATION — jamais un vieux cache par-dessus
    un frais)."""
    gate = threading.Event()

    class HangingEngine(TtsEngine):
        sample_rate = 16000
        def warm(self):
            gate.wait(timeout=10)                           # PEND jusqu'au signal (simule le hang driver/AV)
        def synth(self, text):
            return np.ones(7, dtype=np.float32)             # audio RECONNAISSABLE (7) si le zombie posait son cache

    engines = {"n": 0}

    def factory():
        engines["n"] += 1
        return HangingEngine() if engines["n"] == 1 else FakeSynthEngine()
    events, emit = _collect()
    v = FallbackVoice(emit, lambda: 1, engine_factory=factory, output=FakeOut(), stale_s=0.05)
    r1 = v.precache(PHRASES)
    assert r1["ok"] is True and r1["started"] is True       # vol 1 : le warm PEND
    time.sleep(0.1)                                         # la deadline stale (0,05 s) passe
    r2 = v.precache(PHRASES)                                # MEME payload : avant le fix -> ack menteur « deja en vol »
    assert r2["ok"] is True and r2["started"] is True       # le vol mort est declare STALE -> relance saine
    assert v.state["precache_stalled"] == 1                 # compte, jamais avale
    assert _wait(lambda: v.state["cached"] == ["secours"])  # le moteur SAIN a pose le filet
    good = v._cache["secours"][0].copy()
    gate.set()                                              # le zombie se reveille et finit son warm/synth
    time.sleep(0.2)
    assert np.array_equal(v._cache["secours"][0], good), \
        "le zombie a ecrase le cache frais (la garde de generation ne mord pas)"


def test_zombie_qui_leve_ne_nettoie_pas_le_vol_frais():
    """re-croisé conv 58 (ROB2-2, REPRODUIT par l'audit) : le chemin EXCEPT du worker a la MÊME garde de
    génération que la pose — un zombie (vol périmé) qui se réveille en LEVANT (warm qui timeout après le
    hang) n'efface JAMAIS la clé pendante du vol FRAIS de même clé (le cas EXACT de ROB-M1 : relance du
    même payload). Avant le fix : /debug mentait « pas de vol » + le re-envoi idempotent du boot était
    refusé « autres textes » (le trou exactement là où le test stale ne regardait pas, patron conv 41)."""
    gate = threading.Event()

    class HangingRaisingEngine(TtsEngine):
        sample_rate = 16000

        def warm(self):
            gate.wait(timeout=10)                           # PEND jusqu'au signal...
            raise RuntimeError("warm timeout au reveil (test)")   # ...puis LEVE (le zombie meurt en criant)

        def synth(self, text):
            return np.ones(7, dtype=np.float32)

    engines = {"n": 0}

    def factory():
        engines["n"] += 1
        # vol 1 = le zombie qui pendra puis levera ; vol 2 (frais) = synthese LENTE (reste en vol pendant le test)
        return HangingRaisingEngine() if engines["n"] == 1 else FakeSynthEngine(synth_delay=0.3)
    events, emit = _collect()
    v = FallbackVoice(emit, lambda: 1, engine_factory=factory, output=FakeOut(), stale_s=0.05)
    assert v.precache(PHRASES)["started"] is True           # vol 1 : le warm PEND
    time.sleep(0.1)                                         # la deadline stale (0,05 s) passe
    assert v.precache(PHRASES)["started"] is True           # relance saine (meme payload, gen+1) -> vol FRAIS en vol
    gate.set()                                              # le zombie se reveille et LEVE
    assert _wait(lambda: v.state["synth_errors"] >= 1)      # son exception est comptee...
    assert v.state["pending"] is True, \
        "le zombie qui LEVE a efface la cle pendante du vol FRAIS (garde de generation absente du chemin except)"
    r3 = v.precache(PHRASES)                                # le double envoi boot (meme payload)
    assert r3["ok"] is True and r3["started"] is False      # -> idempotent « deja en vol », JAMAIS refuse « autres textes »
    assert _wait(lambda: not v.state["pending"])            # le vol frais aboutit
    assert v.state["cached"] == ["secours"]                 # le filet est pose


def test_precache_worker_cesse_a_l_arret():
    """ROB-M5 : un stop() pendant la pré-synthèse → le worker CESSE (gardes `_stopped` en tête / entre les
    phrases / à la pose) — jamais un cache posé ni un Piper qui charge PENDANT l'arrêt T6."""
    events, v, _ = _voice(lambda: 1, engine=FakeSynthEngine(synth_delay=0.15))
    r = v.precache(PHRASES)
    assert r["started"] is True
    time.sleep(0.02)                                        # le worker est DANS la synthese
    v.stop()                                                # l'arret tombe
    assert _wait(lambda: not v._precache_thread.is_alive(), timeout=2.0)
    assert v.state["cached"] == []                          # JAMAIS pose post-arret


def test_play_worker_post_stop_ne_joue_jamais():
    """SOLO-3 : un stop() tombé ENTRE le lancement du thread de lecture et son play() → le worker vérifie
    `_stopped` AVANT de jouer (jamais une lecture qui démarre APRÈS l'arrêt). Déterministe : le worker est
    appelé directement post-stop (la race exacte, sans wall-clock)."""
    out = FakeOut()
    events, v, _ = _voice(lambda: 0, output=out)
    _precache_ok(v, PHRASES)
    v.stop()
    v._play_worker(np.ones(100, dtype=np.float32), 16000)   # la race : le thread demarre apres le stop
    assert out.played == []                                 # la lecture post-arret n'a JAMAIS demarre


def test_emit_qui_leve_ne_casse_pas_la_lecture():
    def bad_emit(etype, payload):
        raise RuntimeError("bus arrete (test)")
    out = FakeOut()
    v = FallbackVoice(bad_emit, lambda: 0, engine_factory=FakeSynthEngine, output=out)
    _precache_ok(v, PHRASES)
    v.on_event("evt.turn.end", {})
    assert _wait(lambda: len(out.played) == 1)              # la phrase joue MEME si l'emit echoue
