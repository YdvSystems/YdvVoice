"""U-M1 (plan 02) — la PRISE EMBED (BGE-M3 dense ONNX, CPU). Trois étages, parité test_v14 :

  - PLOMBERIE (`EmbedPlug` + moteur SCRIPTÉ, déterministe, SANS ONNX) : le contrat cmd->evt.embed.done
    (vecteurs + identité d'espace, corrélé par cid), la file de PRIORITÉ (interactive DEVANT background),
    items vides -> count 0, échec moteur -> `error` (jamais un crash, worker survit), stop() join.
  - CŒUR RÉEL (le VRAI `OnnxBgeM3Engine`, modèle vendorisé) : identité d'espace, dimension 1024, vecteurs
    L2-normalisés, RÉFÉRENCE VERROUILLÉE (banc conv 62 : « Bonjour Sophia, comment vas-tu ? » -> ref8 à 1e-3),
    déterminisme (Δ=0), et la SÉMANTIQUE (une requête retrouve le bon souvenir mieux qu'un distracteur).
    Skip SEULEMENT si le modèle gitignoré manque (CF2), parité test_v6/test_v14.
"""
import threading

import numpy as np
import pytest

from embed import EmbedEngine, EmbedPlug, OnnxBgeM3Engine, EMBED_DIM, EMBED_MODEL, EMBED_PREPROC_REVISION
from embed.engine import _MODEL_DIR
import os

_MODEL_OK = os.path.isfile(os.path.join(_MODEL_DIR, "model.onnx"))
_skip_no_model = pytest.mark.skipif(not _MODEL_OK, reason="modèle embed vendorisé absent (gitignoré, CF2)")

# Référence VERROUILLÉE (banc conv 62, onnx_check) : 8 premières dims de l'embed de la phrase de contrôle.
REF_TEXT = "Bonjour Sophia, comment vas-tu ?"
REF8 = np.array([-0.02176, 0.0121, -0.03518, -0.03476, -0.00452, -0.04834, -0.01707, 0.028])


class ScriptedEmbedEngine(EmbedEngine):
    """Moteur SCRIPTÉ : rend un vecteur déterministe par texte (SANS ONNX). `fail=True` -> lève.
    `hold` (Event) : si fourni, `embed` attend qu'il soit posé (pour tester l'ORDRE de la file). `started`
    (Event) : posé à l'entrée d'embed (le test sait que le worker a bien DÉQUEUÉ le 1er job)."""

    def __init__(self, dim=8, fail=False, hold=None, started=None):
        self._dim = dim
        self._fail = fail
        self._hold = hold
        self._started = started
        self.calls = 0

    @property
    def space(self):
        return {"model": "scripted", "dimension": self._dim, "preproc_revision": "t"}

    def embed(self, texts):
        if self._started is not None:
            self._started.set()
        if self._hold is not None:
            self._hold.wait(timeout=2.0)
        self.calls += 1
        if self._fail:
            raise RuntimeError("moteur scripté en échec")
        # vecteur déterministe : longueur du texte modulo -> reproductible, non nul
        return np.asarray([[float((len(t) + i) % 7) for i in range(self._dim)] for t in texts], dtype=np.float32)


def _collect_emit():
    """emit_done thread-safe qui enregistre (cid, payload) dans l'ordre d'ARRIVÉE + un Event par cid."""
    lock = threading.Lock()
    got = []
    events = {}

    def emit_done(cid, payload):
        with lock:
            got.append((cid, payload))
            ev = events.get(cid)
        if ev is not None:
            ev.set()

    def wait(cid, timeout=2.0):
        with lock:
            ev = events.setdefault(cid, threading.Event())
            for c, _ in got:
                if c == cid:
                    ev.set()
                    break
        return ev.wait(timeout)

    return emit_done, got, wait


# ────────────────────────── PLOMBERIE (moteur scripté) ──────────────────────────

def test_contrat_evt_embed_done():
    """cmd.embed -> evt.embed.done : vecteurs + identité d'espace, corrélé par cid, count = nb d'items."""
    emit, got, wait = _collect_emit()
    plug = EmbedPlug(ScriptedEmbedEngine(dim=8), emit)
    try:
        plug.submit("c1", ["a", "bb", "ccc"], "interactive")
        assert wait("c1"), "evt.embed.done attendu"
        cid, payload = got[0]
        assert cid == "c1"
        assert payload["model"] == "scripted" and payload["dimension"] == 8 and payload["preproc_revision"] == "t"
        assert payload["count"] == 3 and len(payload["vectors"]) == 3
        assert all(len(v) == 8 for v in payload["vectors"])
    finally:
        plug.stop()


def test_items_vides():
    """items vides -> count 0, vecteurs [] (jamais un appel moteur, jamais un vecteur inventé)."""
    emit, got, wait = _collect_emit()
    eng = ScriptedEmbedEngine(dim=4)
    plug = EmbedPlug(eng, emit)
    try:
        plug.submit("v", [], "background")
        assert wait("v")
        _, payload = got[0]
        assert payload["count"] == 0 and payload["vectors"] == []
        assert eng.calls == 0
    finally:
        plug.stop()


def test_priorite_interactive_devant_background():
    """La file de PRIORITÉ : un job INTERACTIVE passe DEVANT un background DÉJÀ EN ATTENTE (chaud bat froid)."""
    hold = threading.Event()
    started = threading.Event()
    emit, got, wait = _collect_emit()
    plug = EmbedPlug(ScriptedEmbedEngine(dim=4, hold=hold, started=started), emit)
    try:
        plug.submit("A", ["x"], "background")     # le worker déquéue A et se bloque sur `hold`
        assert started.wait(1.0), "le worker doit avoir démarré A"
        plug.submit("B", ["y"], "background")     # B et C s'empilent PENDANT que A tient le worker
        plug.submit("C", ["z"], "interactive")
        hold.set()                                 # débloque -> A finit, puis la file : C (rang 0) AVANT B (rang 1)
        assert wait("B")
        order = [cid for cid, _ in got]
        assert order == ["A", "C", "B"], f"attendu A,C,B (interactive devant background), obtenu {order}"
    finally:
        hold.set()
        plug.stop()


def test_echec_moteur_error_jamais_crash():
    """Échec moteur -> evt.embed.done porte `error` + 0 vecteur (l'orchestrateur dead-letter) ; le worker
    SURVIT (un job suivant réussit)."""
    emit, got, wait = _collect_emit()
    eng = ScriptedEmbedEngine(dim=4, fail=True)
    plug = EmbedPlug(eng, emit)
    try:
        plug.submit("bad", ["poison"], "background")
        assert wait("bad")
        _, payload = got[0]
        assert payload.get("error") and payload["count"] == 0 and payload["vectors"] == []
        assert plug.state()["errors"] == 1
        # le worker n'est pas mort : on bascule sur un moteur sain via un NOUVEAU plug (le moteur scripté fail est figé)
    finally:
        plug.stop()


def test_stop_idempotent_join():
    """stop() joint le worker (pas de hang) et est idempotent."""
    plug = EmbedPlug(ScriptedEmbedEngine(), lambda c, p: None)
    plug.stop()
    plug.stop()   # 2e appel -> no-op, jamais d'exception


# ────────────────────────── CŒUR RÉEL (BGE-M3 ONNX vendorisé) ──────────────────────────

@pytest.fixture(scope="module")
def real_engine():
    eng = OnnxBgeM3Engine()
    eng.warm()
    return eng


@_skip_no_model
def test_reel_identite_espace(real_engine):
    """L'identité d'espace = le seed embed_space_meta (schema-02) : bge-m3 / 1024 / v1."""
    assert real_engine.space == {"model": EMBED_MODEL, "dimension": EMBED_DIM, "preproc_revision": EMBED_PREPROC_REVISION}
    assert real_engine.space["model"] == "bge-m3" and real_engine.space["dimension"] == 1024


@_skip_no_model
def test_reel_dimension_norme_reference(real_engine):
    """Dimension 1024, L2-normalisé, et la RÉFÉRENCE verrouillée (banc conv 62) à 1e-3."""
    v = real_engine.embed([REF_TEXT])
    assert v.shape == (1, 1024)
    assert abs(float(np.linalg.norm(v[0])) - 1.0) < 1e-4
    assert np.max(np.abs(v[0, :8] - REF8)) < 1e-3, "l'embed de contrôle a dérivé de la référence banc"


@_skip_no_model
def test_reel_determinisme(real_engine):
    """Même entrée -> même vecteur (Δ = 0)."""
    a = real_engine.embed([REF_TEXT])[0]
    b = real_engine.embed([REF_TEXT])[0]
    assert float(np.max(np.abs(a - b))) == 0.0


@_skip_no_model
def test_reel_semantique(real_engine):
    """La jambe sémantique MARCHE : une requête paraphrasée est plus proche du BON souvenir que d'un distracteur."""
    q = real_engine.embed(["À quel jeu vidéo Yohann a-t-il joué ?"])[0]
    relevant = real_engine.embed(["Yohann a joué au jeu The Witcher 3 et l'a adoré."])[0]
    distractor = real_engine.embed(["George R. R. Martin vient de la télévision."])[0]
    assert float(q @ relevant) > float(q @ distractor) + 0.05


@_skip_no_model
def test_reel_batch_coherent(real_engine):
    """Le batch (padding + masque) ne change PAS le vecteur d'un item vs son embed isolé (masque correct)."""
    solo = real_engine.embed([REF_TEXT])[0]
    batched = real_engine.embed([REF_TEXT, "Un texte beaucoup plus long pour forcer un padding différent dans le batch."])[0]
    assert float(np.max(np.abs(solo - batched))) < 1e-4


@_skip_no_model
def test_reel_prise_bout_en_bout(real_engine):
    """La prise complète avec le VRAI moteur : cmd.embed -> evt.embed.done avec 1024-dim normalisés."""
    emit, got, wait = _collect_emit()
    plug = EmbedPlug(real_engine, emit)
    try:
        plug.submit("r1", ["Bonjour", "The Witcher"], "interactive")
        assert wait("r1", timeout=10.0)
        _, payload = got[0]
        assert payload["model"] == "bge-m3" and payload["dimension"] == 1024 and payload["count"] == 2
        assert all(len(v) == 1024 for v in payload["vectors"])
        assert abs(float(np.linalg.norm(payload["vectors"][0])) - 1.0) < 1e-4
    finally:
        plug.stop()
