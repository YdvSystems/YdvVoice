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

import os
import threading


def _guard_s_default() -> float:
    """Deadline de garde R-1 (contrat grave conv 42) : duree d'INACTIVITE au-dela de laquelle un `_armed`
    reste-a-tort s'auto-relache (retour VEILLE) -> Sophia jamais coincee SOURDE. Defaut 30 s (calibration
    §6) ; jamais atteint en usage normal (toute ACTIVITE repousse la garde : parole de Yohann [groupe STT
    actif, via `_guard_tick`] ou d'elle, et l'orchestrateur confirme/clot bien avant). Surchargeable au spawn
    par SOPHIA_WAKE_GUARD_S (les tests la mettent basse)."""
    try:
        return float(os.environ.get("SOPHIA_WAKE_GUARD_S", "30"))
    except (TypeError, ValueError):
        return 30.0


class WakeGate:
    """Le réveil rétroactif (V3). `ring` pour rembobiner ; `emit(type, payload)` pour publier `evt.wake`."""

    def __init__(self, ring, emit, guard_s: float | None = None):
        self._ring = ring
        self._emit = emit
        self._lock = threading.Lock()
        self._rate = int(getattr(ring, "sample_rate", 16000))
        # dernière marque VAD observée : sert /debug + le mode générique de V9 (mark=None). Le NOMINAL, lui,
        # rembobine à la marque FOURNIE par le déclencheur (le bon segment même si un nouveau a démarré depuis).
        self._last_mark: int | None = None
        # S12 : « seule auto-transition sidecar = le tour de réveil » -> un tour ouvert bloque un 2e éveil auto.
        self._armed = False
        # V9 (deadline de garde R-1) : position ring de la DERNIERE activite (reveil / vad.start / confirmation
        # orchestrateur). `check_guard` (appele par le worker STT) auto-relache si le silence depuis depasse
        # `_guard_s`. None = pas de garde active (pas arme).
        self._guard_s = float(guard_s) if guard_s is not None else _guard_s_default()
        self._last_activity_pos: int | None = None
        self._guard_releases = 0     # nb d'auto-release par la garde R-1 (observabilite : un aval defaillant est visible)
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
            if self._armed:
                # activite en conversation -> repousse la deadline de garde R-1 (la garde ne mord que sur un
                # SILENCE prolonge, jamais tant que Yohann parle). write_pos() = le present (prend le lock du
                # RING, distinct de celui-ci -> pas de deadlock).
                self._last_activity_pos = self._ring.write_pos()

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
            self._last_activity_pos = self._ring.write_pos()   # V9 : arme la garde R-1 (compte le silence DES le reveil)
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

        CONTRAT V4/V9 (frontière tracée) : le releaser DOIT être garanti. V9 l'HONORE de DEUX façons (défense
        en profondeur) : (1) l'orchestrateur commande le release explicitement (`cmd.listen.stop` -> ici) sur
        clôture/pause (B1) ; (2) le FILET `check_guard` auto-relâche si l'aval oublie (un `release()` oublié
        laisserait `_armed` à True et rendrait Sophia SOURDE — tout `on_wake` suivant = no-op S12)."""
        with self._lock:
            self._armed = False

    def arm_external(self) -> None:
        """V9 (B1) : l'ORCHESTRATEUR confirme/ouvre l'écoute (`cmd.listen.start`). ARME (ÉCOUTE) — idempotent si
        déjà armé (le sidecar s'est auto-armé au tour de réveil ; ici l'orchestrateur CONFIRME) — et REPOUSSE la
        deadline de garde R-1 (l'aval a pris la main -> pas d'auto-release transitoire). Sert aussi la reprise
        depuis PAUSE (le sidecar était en VEILLE -> ré-arme). Le rembobinage RÉTROACTIF du STT (« effet rétroactif
        depuis la dernière marque », B1) est fait par le serveur via `stt.retro_capture` -> ici, l'état seul."""
        with self._lock:
            self._armed = True
            self._last_activity_pos = self._ring.write_pos()

    def touch_guard(self) -> None:
        """V9 : REPOUSSE la deadline de garde R-1 sans changer l'etat. Appele par le worker STT quand SA voix joue
        (Sophia parle : masqueur / salutation / reponse / cloture). Ces instants sont de l'ACTIVITE de conversation,
        PAS du silence — meme si le VAD ne pose AUCUNE marque (l'AEC annule sa voix -> pas de vad.start). Sans ca,
        une LONGUE reponse (> guard_s de parole) relacherait la garde PENDANT qu'elle parle -> VEILLE a tort ensuite.
        No-op si pas armee (rien a garder)."""
        with self._lock:
            if self._armed:
                self._last_activity_pos = self._ring.write_pos()

    def check_guard(self, now_pos: int) -> bool:
        """FILET de sûreté R-1 (contrat gravé conv 42) — appelé périodiquement par le worker STT (qui tourne en
        continu, y compris en silence). Si Sophia est ARMÉE (ÉCOUTE) mais qu'AUCUNE activité (réveil / parole /
        confirmation orchestrateur) n'a eu lieu depuis `_guard_s`, on AUTO-RELÂCHE (retour VEILLE) — sinon un
        `release()` oublié par l'aval rendrait Sophia SOURDE (un nouveau « Bonjour Sophia » = no-op S12). En
        usage NORMAL la garde ne mord JAMAIS : `_last_activity_pos` est repoussé par TOUTE activité — un `vad.start`
        (parole discontinue, via `observe`) OU la parole CONTINUE de Yohann / la voix de Sophia (via `touch_guard`,
        piloté par `_guard_tick` du worker STT — voir stt.py) —, et l'orchestrateur confirme/clôt bien avant
        `_guard_s`. C'est un filet pour le cas de bug/abandon.
        Retourne True si a relâché. Release INLINE (le lock n'est pas réentrant -> ne pas rappeler `release()`).

        Quand elle relâche, elle EMET `evt.listen.timeout` -> l'orchestrateur SYNCHRONISE son ListenState (retour
        VEILLE). Sans cet emit, l'auto-release serait SILENCIEUX et la vue derivee (voyants/transcript, O5) mentirait :
        elle afficherait ECOUTE alors que Sophia est retombee en VEILLE (ROB-B/FID-1, croise conv 50). Emit HORS lock
        (parite on_wake) ; appelant UNIQUE = le worker STT -> pas de double-emit (compteur == emits, hammer-teste
        re-croise conv 50). Un `arm_external` concurrent entre release et emit donnerait un timeout parasite, mais
        c'est inatteignable (arm_external ne vient que d'un `cmd.listen.start` = nouveau reveil = parole fraiche ->
        `observe` aurait repousse la garde, qui n'expirerait pas) et auto-corrige (un nouveau « Sophia » re-reveille)."""
        released = False
        with self._lock:
            if not self._armed or self._last_activity_pos is None:
                return False
            if int(now_pos) - int(self._last_activity_pos) < int(self._guard_s * self._rate):
                return False
            self._armed = False            # release INLINE (le lock n'est pas réentrant -> ne pas rappeler release())
            self._guard_releases += 1
            released = True
        if released:                       # emit HORS lock (parite on_wake) -> jamais le bus sous le lock du WakeGate
            self._safe_emit("evt.listen.timeout", {"reason": "inactivite"})
        return released

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
    def armed(self) -> bool:
        """Sophia est-elle EN tour de reveil (armee) ? Lecture seule — sert au portier STT (V4) a decider la
        lecture rapide + le plafond differencie reveil/conversation (banc conv 32). N'altere rien (S12 intact)."""
        with self._lock:
            return self._armed

    @property
    def state(self) -> dict:
        with self._lock:
            return {
                "armed": self._armed,
                "wakes": self._wakes,
                "ignored": self._ignored,
                "last_mark": self._last_mark,
                "last_wake": dict(self._last_wake) if self._last_wake else None,
                # V9 (deadline de garde R-1) : combien de fois l'aval a oublie un release (0 en usage sain) + le delai.
                "guard_s": self._guard_s,
                "guard_releases": self._guard_releases,
                "last_activity_pos": self._last_activity_pos,
            }
