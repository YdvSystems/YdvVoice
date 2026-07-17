"""Sophia — sidecar / le RÉVEIL RÉTROACTIF (plan 01, V3 · F1).

« Quand on l'appelle, elle ne coupe pas le premier mot. » Au signal d'éveil, V3 rembobine un curseur du
ring jusqu'à la MARQUE que V2 (le VAD) a posée au début du segment de parole (`pos`, déjà padée de 30 ms) →
la phrase ENTIÈRE, y compris avant le nom, est dans le tampon (invariant F1 : premier mot jamais amputé).

Le wake-model (conv 24) a été ÉCARTÉ (conv 27) : l'éveil se décide PAR PHRASE via le STT (qui distingue
« Sophia » de « Sophie »). V3 est donc le MÉCANISME de rembobinage ; la SOURCE du signal d'éveil est :
  - en V3 : injectée (couture de test `/debug/wake`, comme `evt.speaker` injecté pour V6/V8 avant leur source) ;
  - en V4 : le portier STT, qui FOURNIT la marque du segment qu'il a transcrit (mode nominal).

Le WakeGate n'a PAS de thread propre : il OBSERVE les marques VAD (pour `/debug` + le mode générique de V9)
et RÉAGIT au signal d'éveil. Thread-safe : `observe` tourne dans le thread de la prise VAD (via l'emit
wrappé) ; `on_wake`/`release`/`state` sur la boucle asyncio (endpoint) ou le thread du STT (V4) -> tout
l'état partagé sous lock.

INVARIANT (plan 01 §5 / socle) : l'audio ne traverse JAMAIS le canal — `evt.wake` ne porte que des POSITIONS
(la marque `pos`), l'audio reste dans le ring (RAM sidecar). Le curseur rembobiné est REMIS au consommateur
(STT V4 / test), qui le lit dans SON thread (un curseur = un thread, contrat du ring, R#9).
"""
from __future__ import annotations

import threading


class WakeGate:
    """Le réveil rétroactif (V3). `ring` pour rembobiner ; `emit(type, payload)` pour publier `evt.wake`."""

    def __init__(self, ring, emit):
        self._ring = ring
        self._emit = emit
        self._lock = threading.Lock()
        # dernière marque VAD observée : sert /debug + le mode générique de V9 (mark=None). Le NOMINAL, lui,
        # rembobine à la marque FOURNIE par le déclencheur (le bon segment même si un nouveau a démarré depuis).
        self._last_mark: int | None = None
        # S12 : « seule auto-transition sidecar = le tour de réveil » -> un tour ouvert bloque un 2e éveil auto.
        self._armed = False
        # dernier réveil, en VALEURS figées (pas de curseur vivant gardé -> pas de course sur /debug).
        self._last_wake: dict | None = None
        self._wakes = 0
        self._ignored = 0     # 2e éveil pendant un tour ouvert (S12) — observable

    # ── observation des marques VAD (thread de la prise VAD, via l'emit wrappé de server.py) ──────────────
    def observe(self, mtype: str, payload: dict) -> None:
        """Suit la dernière marque VAD en consommant le VOCABULAIRE `evt.*` (ne touche PAS le VadPlug
        verrouillé). Robuste : un `mtype`/`payload` inattendu ne lève JAMAIS (ne casse pas la boucle de la
        prise, parité `_safe_emit`). Seul `evt.vad.start` porte le début de segment (la marque de V3)."""
        if mtype != "evt.vad.start":
            return
        try:
            pos = int(payload["pos"])
        except (KeyError, TypeError, ValueError):
            return   # payload malformé -> on ignore, jamais d'exception qui remonterait dans le thread VAD
        with self._lock:
            self._last_mark = pos

    # ── le réveil (endpoint de test /debug/wake en V3 ; portier STT en V4) ───────────────────────────────
    def on_wake(self, mark: int | None = None):
        """Signal d'éveil. `mark` = position du début du segment d'éveil, FOURNIE par le déclencheur (mode
        NOMINAL : vise le bon segment même si un nouveau segment VAD a démarré depuis). `mark=None` = mode
        GÉNÉRIQUE (dernière marque suivie) — réservé au `cmd.listen.start` rétroactif de V9.

        Rembobine un curseur du ring à la marque, émet `evt.wake {pos, captured_at, truncated}` (positions
        seules — l'audio ne traverse pas le canal), et RETOURNE le curseur rétroactif (le STT V4 / le test le
        lit dans son thread). S12 : un 2e éveil pendant un tour ARMÉ = no-op -> retourne None."""
        with self._lock:
            if self._armed:
                self._ignored += 1          # tour de réveil déjà ouvert -> pas de 2e auto-transition (S12)
                return None
            m = self._last_mark if mark is None else int(mark)
            if m is None:
                return None                 # aucune parole récente à rembobiner -> honnête (pas de fausse marque)
            self._armed = True              # sous lock AVANT de rembobiner -> un éveil concurrent voit ARMÉ (S12)
        # hors du lock du WakeGate : `cursor()`/`seek_to()`/`time_at()` prennent le lock du RING (thread-safe,
        # aucun risque de deadlock) et ne lèvent pas -> `_armed` ne peut pas rester bloqué à True par une exception.
        cur = self._ring.cursor()
        truncated = cur.seek_to(m)          # borné à [oldest, write_pos] ; truncated>0 = marque hors fenêtre (F1)
        # `truncated` est un INSTANTANÉ au réveil (la marque était-elle dans la fenêtre À CET instant). Le ring
        # est vivant : si le consommateur (STT V4) tarde à drainer ce curseur et que la capture avance assez pour
        # que la marque sorte des 30 s, la perte réelle surviendra AU READ -> le curseur la signale par `overrun`.
        # CONTRAT V4 : vérifier `overrun` au read EN PLUS de `truncated` au réveil (marge énorme en pratique :
        # marque typiquement 1-3 s en arrière / fenêtre 30 s -> ne mord que sous surcharge ou STT calé).
        wake = {"pos": int(cur.position), "captured_at": self._ring.time_at(cur.position), "truncated": int(truncated)}
        with self._lock:
            self._last_wake = wake
            self._wakes += 1
        self._safe_emit("evt.wake", dict(wake))
        return cur

    def release(self) -> None:
        """Ferme le tour de réveil (retour en VEILLE). Appelé par `cmd.listen` (V9) / le test (V3). Le délai
        de garde de l'écoute transitoire viendra avec V4/V9 ; ici, release EXPLICITE (pas de timer creux :
        rien à piloter sans le STT — bâtir un timer maintenant serait de la sur-ingénierie, crible facilité #5).

        CONTRAT V4/V9 (frontière tracée) : le releaser DOIT être garanti — un `release()` oublié laisse `_armed`
        à True et rend Sophia SOURDE (tout `on_wake` suivant = no-op). En V3 il n'existe aucun filet (le seul
        appelant est le hook de test, qui release). Quand V9 câblera l'écoute transitoire, il DOIT porter la
        deadline de garde (timer -> release automatique) — sinon un bug d'aval mute le réveil sans le dire."""
        with self._lock:
            self._armed = False

    def stop(self) -> None:
        """Cycle de vie (parité capture/vad dans `_stop_audio`). Pas de thread ni de ressource -> simple
        retour en VEILLE."""
        self.release()

    def _safe_emit(self, etype: str, payload: dict) -> None:
        try:
            self._emit(etype, payload)
        except Exception:
            pass   # un emit qui échoue (bus arrêté au teardown...) ne casse jamais le réveil (parité VadPlug)

    @property
    def state(self) -> dict:
        with self._lock:
            return {
                "armed": self._armed,
                "wakes": self._wakes,
                "ignored": self._ignored,
                "last_mark": self._last_mark,
                "last_wake": dict(self._last_wake) if self._last_wake else None,
            }
