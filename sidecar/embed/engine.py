"""Sophia — sidecar / le MOTEUR EMBED (plan 02, M1 · 02-C). BGE-M3 dense en ONNX.

Rôle : calculer des vecteurs denses à la demande (chemin CHAUD = embed de la requête en conversation ;
chemin FROID = faits/résumés/chronique/ingestion en batch). JAMAIS le WAL (F2 : le sidecar calcule,
l'orchestrateur écrit). JAMAIS le cloud (A10 : seule prise LOCAL-ONLY par principe — la mémoire ne quitte
pas le PC).

Moteur = **ONNX BGE-M3 dense + onnxruntime + `tokenizers`** — TRANCHÉ ET PROUVÉ AU BANC (conv 62,
bancs/embed/RESULTS.md) : la stack EXACTE du sidecar (onnxruntime 1.27.0 + tokenizers 0.23.1 déjà présents
via faster-whisper), ZÉRO `transformers` (qui downgraderait tokenizers/faster-whisper — le piège V5), ZÉRO
nouvelle dépendance, et **plus rapide que torch** (banc i5 : 77 ms/requête à 2 threads vs 154 ms torch ;
reproduit sentence-transformers à cosinus 1,000000 / max|Δ| 2,8e-07). Patron d'affect V14 / smart-turn V5.

Recette dense BGE-M3 = **CLS pooling** (`last_hidden_state[:, 0]`) + **L2-normalize** (== SentenceTransformer
'BAAI/bge-m3'). Entrées ONNX : `input_ids` + `attention_mask` (int64). Tokens spéciaux <s>(0)…</s>(2) ajoutés
par le post-processor du tokenizer.json — donc `tokenizers` seul suffit.

IDENTITÉ D'ESPACE (portée par evt.embed.done, vérifiée par le garde d'espace côté orchestrateur, M1/M9) :
model='bge-m3' · dimension=1024 · preproc_revision='v1'. Elle DOIT correspondre au seed embed_space_meta
(schema-02) ; un changement de modèle/préproc = nouvel espace = migration M9.
"""

import os

import numpy as np

# racine du dépôt = sidecar/embed/engine.py -> remonter 3 fois (embed -> sidecar -> racine) ; parité affect.
_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                          "resources", "models", "embed")

# Identité de l'espace vectoriel (== seed embed_space_meta de schema-02). Un changement ici = migration M9.
EMBED_MODEL = "bge-m3"
EMBED_DIM = 1024
EMBED_PREPROC_REVISION = "v1"

# Longueur max de tokenisation. BGE-M3 tient 8192 ; les contenus mémoire (faits/résumés/chronique) sont
# courts -> 512 large et rapide. Valeur de CALIBRATION (§6) — bornée ici pour un coût prévisible.
EMBED_MAX_TOKENS = 512

_PAD_ID = 1   # XLM-RoBERTa : <pad> = 1 (le masque d'attention neutralise le padding en batch)


def _env_threads(default: int = 2) -> int:
    # Patron N-5 (affect) : une variable BLANCHE (" ") = NON-RÉGLÉE -> défaut borné (int("" or 0)=0 aurait
    # désarmé la borne anti-contention). "0" EXPLICITE = « défaut onnxruntime » (documenté).
    raw = os.environ.get("SOPHIA_EMBED_THREADS")
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


class EmbedEngine:
    """Contrat moteur embed (injectable). `embed(texts) -> np.ndarray (N, dim)` L2-normalisés.
    prod = `OnnxBgeM3Engine` ; test = moteur scripté."""

    @property
    def space(self) -> dict:
        raise NotImplementedError

    def embed(self, texts: list[str]) -> np.ndarray:
        raise NotImplementedError

    def warm(self) -> None:
        pass


class OnnxBgeM3Engine(EmbedEngine):
    """BGE-M3 dense, ONNX vendorisé (resources/models/embed/ — OFFLINE, jamais de réseau au runtime, plan 05).
    onnxruntime CPU, intra_op BORNÉ (défaut 2 — `SOPHIA_EMBED_THREADS` ; le chemin froid tourne dans les creux,
    le chaud est une rafale brève). Import onnxruntime/tokenizers PARESSEUX. Sentinel `_sess` posé EN DERNIER
    (patron S-7 : un échec laisse l'état propre -> retry, jamais mi-chargé). LÈVE si le modèle est absent ->
    l'appelant dégrade honnêtement (prise INERTE, jamais un crash)."""

    def __init__(self, model_dir: str | None = None, threads: int | None = None,
                 max_tokens: int = EMBED_MAX_TOKENS):
        self._dir = model_dir or _MODEL_DIR
        self._threads = threads if threads is not None else _env_threads()
        self._max_tokens = int(max_tokens)
        self._sess = None
        self._tok = None
        self._in_names: set[str] = set()

    @property
    def space(self) -> dict:
        return {"model": EMBED_MODEL, "dimension": EMBED_DIM, "preproc_revision": EMBED_PREPROC_REVISION}

    def warm(self) -> None:
        """Charge le tokenizer + la session ONNX puis une inférence JETABLE (compile les noyaux -> le 1er
        vrai embed ne paie pas l'init). Sentinel EN DERNIER (échec -> _sess reste None, retry propre)."""
        if self._sess is not None:
            return
        import onnxruntime
        from tokenizers import Tokenizer

        tok = Tokenizer.from_file(os.path.join(self._dir, "tokenizer.json"))
        tok.enable_truncation(max_length=self._max_tokens)
        tok.enable_padding(pad_id=_PAD_ID, pad_token="<pad>")   # padding pour le batch (froid)

        so = onnxruntime.SessionOptions()
        if self._threads:
            so.intra_op_num_threads = int(self._threads)
            so.inter_op_num_threads = 1
        sess = onnxruntime.InferenceSession(
            os.path.join(self._dir, "model.onnx"), so, providers=["CPUExecutionProvider"])
        self._in_names = {i.name for i in sess.get_inputs()}
        self._tok = tok
        self._sess = sess                       # sentinel EN DERNIER
        try:
            self.embed(["warmup"])              # compile les noyaux ; ré-entre warm -> early-return
        except Exception:
            pass

    def embed(self, texts: list[str]) -> np.ndarray:
        """(N, 1024) L2-normalisés — CLS pooling. `texts` non vide (l'appelant garantit)."""
        self.warm()
        encs = self._tok.encode_batch(list(texts))
        ids = np.asarray([e.ids for e in encs], dtype=np.int64)
        mask = np.asarray([e.attention_mask for e in encs], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self._in_names:
            feeds["token_type_ids"] = np.zeros_like(ids)
        feeds = {k: v for k, v in feeds.items() if k in self._in_names}
        out = self._sess.run(["last_hidden_state"], feeds)[0]   # (N, seq, hidden)
        cls = out[:, 0, :].astype(np.float32)                   # CLS pooling (dense BGE-M3)
        norms = np.linalg.norm(cls, axis=1, keepdims=True)
        return cls / np.maximum(norms, 1e-12)                   # L2-normalize (jamais /0)
