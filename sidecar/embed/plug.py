"""Sophia — sidecar / la PRISE EMBED (plan 02, M1 · 02-C). Contrat WS cmd.embed -> evt.embed.done.

Prise pilotée-COMMANDE (≠ prises audio 01 pilotées-ring) : l'orchestrateur pousse `cmd.embed`
(items[], priorité interactive|background), la prise calcule (moteur derrière le contrat) et rend
`evt.embed.done` (vecteurs + identité d'espace), CORRÉLÉ par l'id du cmd.

DEUX RYTHMES (technique/02 §2.2) : le CHAUD (embed de la requête, priorité `interactive`) BAT le FROID
(faits/résumés en batch, `background`). Réalisé par une **file de PRIORITÉ** sur un worker dédié : un job
interactif (rang 0) passe DEVANT tout job de fond (rang 1) déjà en attente. Le worker (thread) ne bloque
JAMAIS la boucle asyncio du serveur (l'inférence ONNX est synchrone/CPU -> hors event loop, patron affect).

F2 : la prise ne touche jamais le WAL — elle calcule, l'orchestrateur écrit (le garde d'espace + « la base
est la file » + le poison-row vivent CÔTÉ ORCHESTRATEUR, M1). Un embed en échec -> `evt.embed.done` porte
`error` (compteurs jamais menteurs) ; l'orchestrateur dead-letter (embed_failures) — jamais la prise.
"""

import itertools
import queue
import threading

_RANK = {"interactive": 0, "background": 1}   # chaud (0) DEVANT froid (1)


class EmbedPlug:
    """Worker unique + file de priorité. `submit(cid, items, priority)` enfile ; le worker embed et émet
    `evt.embed.done` via `emit_done(cid, payload)`. `stop()` join court (SOLO-1)."""

    def __init__(self, engine, emit_done, on_log=None):
        self._engine = engine
        self._emit_done = emit_done          # (cid, payload) -> publie evt.embed.done corr=cid (threadsafe)
        self._log = on_log or (lambda _l: None)
        self._q: "queue.PriorityQueue" = queue.PriorityQueue()
        self._seq = itertools.count()        # départage FIFO à priorité égale + JAMAIS comparer les jobs
        self._stop = threading.Event()
        self._submitted = 0
        self._done = 0
        self._errors = 0
        self._t = threading.Thread(target=self._run, name="embed", daemon=True)
        self._t.start()

    def submit(self, cid, items, priority: str = "background") -> None:
        """Enfile un job. `items` = liste de textes ; `priority` interactive|background (défaut fond)."""
        rank = _RANK.get(priority, 1)
        self._submitted += 1
        self._q.put((rank, next(self._seq), (cid, list(items or []))))

    def _run(self) -> None:
        try:
            self._engine.warm()              # charge le modèle hors du 1er vrai embed (le worker est né -> on chauffe)
        except Exception as e:
            self._log(f"embed warm échec ({type(e).__name__}) — prise inerte, dégradation honnête")
        while not self._stop.is_set():
            try:
                _rank, _seq, job = self._q.get(timeout=0.2)
            except queue.Empty:
                continue
            if job is None:                  # sentinelle : DÉBLOQUE un get() en attente au stop (les jobs restant en
                break                        #   file sont abandonnés quand `while not _stop` échoue — perte assumée,
            #                                    « la base est la file » les recalcule ; pas un traitement « en tête »)
            cid, items = job
            space = self._engine.space
            try:
                if not items:
                    payload = {**space, "count": 0, "vectors": []}
                else:
                    vecs = self._engine.embed(items)
                    payload = {**space, "count": int(vecs.shape[0]),
                               "vectors": [[float(x) for x in v] for v in vecs]}
                self._done += 1
            except Exception as e:
                # Échec moteur/contenu : l'orchestrateur dead-letter (poison-row). Jamais un crash de prise ;
                # jamais un vecteur inventé. evt.embed.done porte `error` + 0 vecteur (garde honnête).
                self._errors += 1
                payload = {**space, "error": type(e).__name__, "count": 0, "vectors": []}
                self._log(f"embed job en échec ({type(e).__name__})")
            try:
                self._emit_done(cid, payload)
            except Exception:
                pass                         # l'émission ratée (WS fermé) ne tue jamais le worker

    def state(self) -> dict:
        return {"submitted": self._submitted, "done": self._done, "errors": self._errors,
                "queued": self._q.qsize(), "space": self._engine.space}

    def stop(self, join_s: float = 0.3) -> None:
        self._stop.set()
        try:
            self._q.put((0, next(self._seq), None))   # débloque le get immédiatement
        except Exception:
            pass
        self._t.join(timeout=join_s)
