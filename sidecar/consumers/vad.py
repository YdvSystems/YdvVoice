"""Sophia — sidecar / consommateur VAD (plan 01, V2 · A7).

« Quand quelqu'un parle-t-il dans la piece ? » sur l'audio POST-AEC. Le VAD est un CONSOMMATEUR du ring
(curseur INDEPENDANT, patron de prise 01-F / V0) : il lit l'audio nettoye, detecte les debuts/fins de
parole, et emet `evt.vad.start` / `evt.vad.stop` — la BRIQUE d'entree de V3 (reveil retroactif : rembobiner
a la marque VAD precedente) et V5 (fin de tour). Always-on, CPU, marque le tampon MEME EN VEILLE.

Moteur = **Silero VAD** (A7 grave, torch JIT — voie prouvee au banc conv 25 `07_turn.py`/`oreilles_live.py`,
recoupee a la source conv 41). L'HYSTERESE debut/fin est **REIMPLEMENTEE**, EQUIVALENTE a `VADIterator`
(prouvee par un test d'equivalence, `test_v2.py`) : cela permet UN SEUL appel modele par fenetre pour
obtenir A LA FOIS
  - la **probabilite** (confiance de parole -> payload + observabilite) — sinon il faudrait un 2e appel
    modele (mesure conv 41 : ×2,14 sur le CPU du VAD), et
  - l'**index EXACT** de la frontiere (avec `speech_pad`) -> marque PRECISE pour V3 (« premier mot jamais
    ampute » ; l'index padded de VADIterator, sinon jete, remet le debut ~30 ms avant la fenetre).
La logique copie `silero_vad/utils_vad.py:528-549` a l'identique (threshold 0.5 · neg_threshold=threshold-0.15
· min_silence 150 ms · speech_pad 30 ms · fenetres de 512 @ 16 kHz). Entree = float32 [-1,1] depuis l'int16
du ring (÷32768, mesure `oreilles_live:974`).

Le moteur vit DERRIERE une interface INJECTABLE (`VadEngine`) : prod = Silero, test = moteur scripte
deterministe (couture `evt.speaker` V6/V8) -> la LOGIQUE de la prise se teste sans torch ni audio reel, et
le backend reste swappable (l'ONNX `onnx=True` = un swap, plan/01 §7). Import torch/silero PARESSEUX.
"""
from __future__ import annotations

import numpy as np

from plugs.base import ConsumerPlug

FRAME = 512            # Silero @ 16 kHz veut des blocs de 512 (banc conv 25 + design-first conv 41)
THRESHOLD = 0.5        # seuil de parole (banc conv 25 ; fosse enorme fins>0.9 / pauses<0.05 -> marge large)
NEG_MARGIN = 0.15      # neg_threshold = threshold - 0.15 (hysterese VADIterator, utils_vad.py:538)
MIN_SILENCE_MS = 150   # silence avant de declarer une FIN (banc conv 25)
SPEECH_PAD_MS = 30     # padding des frontieres (defaut VADIterator, utils_vad.py:496)


class VadEngine:
    """Contrat moteur VAD (injectable). `feed(window)` -> None | (kind, idx, prob) :
      - kind : 'start' | 'end' ;
      - idx  : index de la frontiere en ECHANTILLONS depuis le dernier reset() (le moteur compte ce qu'on
        lui nourrit) -> la prise le mappe sur une position ring ;
      - prob : probabilite de parole a cette fenetre (0..1).
    `reset()` remet l'etat a zero (a une discontinuite) ; `warm()` (optionnel) pre-charge le moteur."""

    def feed(self, window: np.ndarray):   # a surcharger
        raise NotImplementedError

    def reset(self) -> None:              # a surcharger
        raise NotImplementedError

    def warm(self) -> None:               # defaut : rien (un moteur sans chargement)
        pass


class SileroVadEngine(VadEngine):
    """Silero (torch JIT) + hysterese REIMPLEMENTEE, equivalente a VADIterator (prouvee par test). UN SEUL
    appel modele par fenetre -> prob + index. Mono-thread par contrat (la boucle de la prise l'appelle).
    Import torch/silero PARESSEUX (module importable sans eux, parite pyaec)."""

    def __init__(self, threshold: float = THRESHOLD, min_silence_ms: int = MIN_SILENCE_MS,
                 speech_pad_ms: int = SPEECH_PAD_MS, sample_rate: int = 16000):
        self.threshold = float(threshold)
        self.neg_threshold = self.threshold - NEG_MARGIN
        self._rate = int(sample_rate)
        self._min_silence = int(sample_rate * min_silence_ms / 1000)   # en echantillons
        self._pad = int(sample_rate * speech_pad_ms / 1000)
        self._model = None
        # etat d'hysterese (== VADIterator)
        self._triggered = False
        self._temp_end = 0
        self._current = 0     # echantillons nourris DEPUIS reset (== VADIterator.current_sample)

    def warm(self) -> None:
        """Force le chargement du modele (torch/silero). LEVE si Silero est absent -> l'appelant degrade
        HONNETEMENT (log + capture sans VAD) plutot que d'annoncer un VAD qui mourrait en silence."""
        if self._model is None:
            from silero_vad import load_silero_vad   # import PARESSEUX (torch charge ici)
            self._model = load_silero_vad()           # defaut = torch JIT (voie banc conv 25)

    def _prob(self, window: np.ndarray) -> float:
        """UN appel modele -> probabilite de parole (0..1). Accepte le numpy float32 (converti en tensor)."""
        import torch
        self.warm()
        x = window if hasattr(window, "dim") else torch.from_numpy(np.ascontiguousarray(window, dtype=np.float32))
        return float(self._model(x, self._rate).item())

    def feed(self, window: np.ndarray):
        n = int(len(window))
        self._current += n          # AVANT l'inference (comme VADIterator l.526->528) : le compteur suit ce
        p = self._prob(window)      # qu'on nourrit MEME si _prob leve -> l'index reste aligne au flux (robustesse)
        return self._decide(p, n)

    def _decide(self, p: float, n: int):
        """L'hysterese PURE (la prob est deja calculee) — COPIE FIDELE de VADIterator.__call__ (utils_vad.py:
        530-549). Separee de l'inference -> testable avec des prob INJECTEES (zone grise, reset de temp_end...)."""
        if p >= self.threshold and self._temp_end:
            self._temp_end = 0
        if p >= self.threshold and not self._triggered:
            self._triggered = True
            start = max(0, self._current - self._pad - n)   # index padded (30 ms avant la fenetre)
            return ("start", int(start), p)
        if p < self.neg_threshold and self._triggered:
            if not self._temp_end:
                self._temp_end = self._current
            if self._current - self._temp_end >= self._min_silence:
                end = self._temp_end + self._pad - n
                self._temp_end = 0
                self._triggered = False
                return ("end", int(end), p)
        return None

    def reset(self) -> None:
        # Finding A (re-croise conv 41) : reinitialiser AUSSI l'etat RNN du modele (comme VADIterator.reset_states
        # -> self.model.reset_states, utils_vad.py:501). Sinon, apres une discontinuite (overrun), les 1res
        # fenetres du nouvel audio sont jugees avec l'etat/contexte d'AVANT le trou -> decisions biaisees (start
        # fantome OU manque : delta de prob jusqu'a 0,47 sur parole faible post-reset, reproduit conv 41).
        if self._model is not None:
            self._model.reset_states()
        self._triggered = False
        self._temp_end = 0
        self._current = 0


class VadPlug(ConsumerPlug):
    """Prise VAD : consomme le ring (int16) via son curseur independant, fenetre en blocs de FRAME, normalise
    en float32 [-1,1] (le ring est en int16 ; Silero veut du float32 — `oreilles_live:974`), fait tourner le
    moteur (injecte), et emet `evt.vad.start` {pos, captured_at, prob} / `evt.vad.stop` {pos, captured_at,
    duration_ms, prob}. `pos` = la MARQUE que V3 rembobinera (position ring PRECISE = `_fed_base + idx`, ou
    `idx` porte le speech_pad du moteur).

    Robustesse : un moteur qui LEVE ne tue pas la boucle et est COMPTE (`_engine_errors`, parite avec
    `AecCapture.convert_errors` — jamais en silence) ; l'arret est borne (`evt.plug.stuck`, herite) ; a une
    DISCONTINUITE (overrun -> curseur distance), la prise re-synchronise, reset le moteur et clot le segment
    (audio rompu). La discontinuite est detectee par l'ecart de position que la prise suit deja -> AUCUNE
    modification de la base."""

    def __init__(self, ring, emit, engine: VadEngine | None = None, hop_samples: int = FRAME):
        super().__init__("vad", ring, emit, hop_samples=hop_samples)
        self._engine = engine if engine is not None else SileroVadEngine()
        self._buf = np.zeros(0, dtype=np.float32)   # reliquat < FRAME, pas encore fenetre
        self._buf_pos = 0                           # position LOGIQUE (ring) du 1er echantillon de _buf
        self._expected = None                       # position attendue du prochain bloc (detection de saut)
        self._fed_base = None                       # position ring du 1er echantillon nourri au moteur DEPUIS reset
        self._in_speech = False
        self._seg_start_pos = None
        self._seg_start_ms = None
        # observabilite / marques (V3 + /debug)
        self.last_start_pos = None
        self.last_stop_pos = None
        self._segments = 0                          # segments COMPLETS (start->stop)
        self._resyncs = 0                           # discontinuites (overruns) traitees
        self._engine_errors = 0                     # MINEUR-3 : erreurs moteur COMPTEES (jamais en silence)
        # V7 morceau C — GATE anti-auto-ecoute (fidele au _flush_audio du banc oreilles_live:1298/1314) :
        self._gate = None                           # Callable[[], bool] | None : True = SA voix joue -> ignorer le micro
        self._muted = False                         # etat courant du gate (on droppe le micro)
        self._mutes = 0                             # nb de fenetres de mute (observabilite / juge)
        self._gate_errors = 0                       # gate qui LEVE (fail-open) : COMPTE, jamais avale (standard maison)

    def warm(self) -> None:
        """Pre-charge le moteur (torch/silero). LEVE si absent -> l'appelant degrade honnetement."""
        self._engine.warm()

    def set_gate(self, gate) -> None:
        """Cable le GATE anti-auto-ecoute (V7 morceau C). `gate()` -> True quand SA propre voix joue (le TtsPlug
        parle + traine `is_speaking`). Tant que c'est True, la prise IGNORE le micro (elle jette `data` sans
        lancer le moteur) -> elle ne traite pas son residu post-AEC ~10 dB, donc pas d'auto-tour, pas d'auto-
        reponse. A la reprise elle repart au PRESENT (seek_latest = le `_flush_audio` de fin d'`_await`,
        oreilles_live:1314) + reset moteur (== reset_states, oreilles_live:1083). None = pas de gate (E2E V2/V3,
        comportement V2 INCHANGE). Cable en PROD seulement (server._start_audio, apres le TtsPlug)."""
        self._gate = gate

    def process(self, data: np.ndarray) -> None:
        # V7 morceau C — GATE anti-auto-ecoute : pendant que SA voix joue (+ traine), on IGNORE le micro (on
        # jette `data`), comme le banc dont la boucle unique est bloquee dans `_await` et flushe (oreilles_live:
        # 1298). A la reprise, on repart au PRESENT (seek_latest = le `_flush_audio` de fin d'`_await`, l.1314) +
        # reset moteur -> le residu ~10 dB post-AEC de SA propre voix ne forme JAMAIS de faux tour.
        try:
            gating = self._gate() if self._gate is not None else False
        except Exception:
            self._gate_errors += 1   # COMPTE (jamais avale) : un gate qui leve a repetition = visible dans /debug
            gating = False   # gate en echec -> on ECOUTE (fail-open : jamais rendre Sophia sourde sur un bug de gate)
        if gating:
            self._enter_mute()
            return
        if self._muted:
            self._resume_from_mute()
            return           # on jette la trame de transition ; le prochain read repart de la tete (seek_latest)
        # position du DEBUT de `data` : le curseur pointe le bord d'attaque (apres le read) -> data occupe
        # [position - len(data), position). Si ce debut n'est pas la ou on l'attendait, le curseur a SAUTE
        # (overrun, drop-oldest) -> discontinuite : audio rompu.
        start_of_data = self._cursor.position - int(data.shape[0])
        if self._expected is not None and start_of_data != self._expected:
            self._on_discontinuity()
        self._expected = self._cursor.position

        f = data.astype(np.float32) / 32768.0       # int16 -> float32 [-1, 1] (Silero)
        if self._buf.size == 0:
            self._buf_pos = start_of_data            # (re-)ancre la position du tampon sur la capture reelle
        self._buf = np.concatenate([self._buf, f])

        while self._buf.size >= FRAME:               # consomme toutes les fenetres pleines
            win = self._buf[:FRAME]
            win_pos = self._buf_pos
            self._buf = self._buf[FRAME:]
            self._buf_pos += FRAME
            self._step(win, win_pos)

    def _step(self, win: np.ndarray, win_pos: int) -> None:
        if self._fed_base is None:
            self._fed_base = win_pos                 # ancre : cette fenetre = echantillon 0 du flux nourri au moteur
        try:
            res = self._engine.feed(win)
        except Exception:
            self._engine_errors += 1                 # MINEUR-3 : comptee, jamais avalee ; la boucle continue
            self._stop.wait(0.005)                   # N2 : petit repit si l'echec persiste (parite AecCapture)
            return
        if res is None:
            return
        kind, idx, prob = res
        pos = self._fed_base + int(idx)              # marque PRECISE (l'index porte le speech_pad)
        if kind == "start" and not self._in_speech:
            self._in_speech = True
            self._seg_start_pos = pos
            self._seg_start_ms = self._ring.time_at(pos)
            self.last_start_pos = pos
            self._safe_emit("evt.vad.start",
                            {"pos": int(pos), "captured_at": self._seg_start_ms, "prob": round(float(prob), 3)})
        elif kind == "end" and self._in_speech:
            self._close_segment(pos, prob)

    def _close_segment(self, end_pos: int, prob: float | None = None) -> None:
        self._in_speech = False
        self.last_stop_pos = end_pos
        self._segments += 1
        end_ms = self._ring.time_at(end_pos)
        dur_ms = (round(end_ms - self._seg_start_ms, 1)
                  if end_ms is not None and self._seg_start_ms is not None else None)
        payload = {"pos": int(end_pos), "captured_at": end_ms, "duration_ms": dur_ms}
        if prob is not None:
            payload["prob"] = round(float(prob), 3)
        self._safe_emit("evt.vad.stop", payload)
        self._seg_start_pos = None
        self._seg_start_ms = None

    def _on_discontinuity(self) -> None:
        # le curseur a ete distance (overrun) -> l'audio a saute : on ne peut plus faire confiance a l'etat
        # du moteur ni au segment en cours. On clot le segment (rompu) a la derniere position connue, on jette
        # le tampon, on reset le moteur ET on re-ancre `_fed_base` (le compteur du moteur repart de 0). La base
        # a deja emis `evt.plug.overrun`.
        self._resyncs += 1
        if self._in_speech:
            self._close_segment(self._expected if self._expected is not None else self._buf_pos)
        self._buf = np.zeros(0, dtype=np.float32)
        self._fed_base = None
        self._engine.reset()

    def _enter_mute(self) -> None:
        """Entre dans le mute (SA voix joue) : on jette le tampon en cours. Si un segment etait ouvert (cas
        DEFENSIF — ne devrait pas arriver en V7 : le tour est clos AVANT qu'elle reponde ; le barge-in = V8), on
        le CLOT proprement a la derniere position bufferisee -> l'aval n'a pas de start orphelin. Le curseur
        continue d'avancer via les read de la base (les trames sont lues puis jetees) ; la reprise fera de toute
        facon un seek_latest de securite. Idempotent : appele a chaque fenetre muette, ne compte qu'a l'entree."""
        if self._muted:
            return
        self._muted = True
        self._mutes += 1
        if self._in_speech:
            self._close_segment(self._buf_pos)
        self._buf = np.zeros(0, dtype=np.float32)

    def _resume_from_mute(self) -> None:
        """Sort du mute (SA voix + traine finies) : repart au PRESENT. seek_latest = le `_flush_audio` de fin
        d'`_await` du banc (oreilles_live:1314 — abandonne le backlog = son residu accumule pendant qu'elle
        parlait) ; reset du moteur = `reset_states` (oreilles_live:1083 — l'etat RNN Silero, comme
        `_on_discontinuity`). `_expected=None` -> aucune FAUSSE discontinuite au 1er bloc post-reprise. Aucun
        segment n'est laisse ouvert."""
        self._muted = False
        self._cursor.seek_latest()          # abandonne le backlog (son residu) -> ne lira que le futur
        self._buf = np.zeros(0, dtype=np.float32)
        self._fed_base = None
        self._expected = None               # pas de fausse discontinuite au 1er bloc post-reprise
        self._engine.reset()

    def _safe_emit(self, etype: str, payload: dict) -> None:
        try:
            self._emit(etype, payload)
        except Exception:
            pass   # un emit qui echoue (bus arrete...) ne tue jamais la boucle de la prise

    @property
    def state(self) -> dict:
        return {
            "in_speech": self._in_speech,
            "segments": self._segments,
            "last_start_pos": self.last_start_pos,
            "last_stop_pos": self.last_stop_pos,
            "resyncs": self._resyncs,
            "engine_errors": self._engine_errors,
            "muted": self._muted,           # V7 : gate anti-auto-ecoute actif ? (SA voix joue)
            "mutes": self._mutes,           # V7 : nb de fenetres de mute (observabilite / juge)
            "gate_errors": self._gate_errors,   # V7 : gate qui a leve (fail-open) — jamais en silence
            "threshold": getattr(self._engine, "threshold", None),
        }
