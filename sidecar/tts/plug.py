# -*- coding: utf-8 -*-
"""Sophia — sidecar / TTS : la prise `tts` (plan 01, V7). LA BOUCHE.

« Elle parle pendant que le cerveau génère encore. » L'orchestrateur pousse le texte de la réponse AU FIL
(`cmd.tts.push`) ; le sidecar accumule, DÉCOUPE en phrases (prosodie juste), synthétise (Piper A20) et JOUE
dès la 1re phrase prête — via un TRAIN d'avance (la phrase N+1 se synthétise pendant que N joue → `trous=0`,
le résultat central de conv 31, MESURÉ b4). Émet `evt.tts.start` (1er son) / `evt.tts.done` (fin).

PATRON = PRODUCTEUR de son (≠ `ConsumerPlug` qui LIT le ring). Deux threads workers (fidèle le train
`_gen_worker`→`_play_worker` de `bancs/aec/bouche_piper.Server`) :
  gen_q --(_gen_worker: synth Piper)--> play_q --(_play_worker: sortie audio)--> HP
Le son sort par le rendu système partagé → capté par le loopback → ANNULÉ par l'AEC (V1, invariant F2) →
elle ne s'entend pas (résidu → speaker « inconnu », V6 ; le gate « ne pas se répondre » = orchestrateur, V9).

Contrat (doc `01` §2.2, cmd/evt gravés) :
  cmd.tts.speak(id) ouvre · cmd.tts.push(id, text) pousse le texte au fil · cmd.tts.end(id) clôt ·
  cmd.tts.stop purge (une seule énonciation joue) · evt.tts.start(id) / evt.tts.done(id, reason).
Moteur ET sortie INJECTABLES (la logique — train, découpe, purge, cycle start/done — se teste sans Piper
ni audio réel ; l'E2E-V7 exerce le VRAI Piper A20). replay (V8) / cache secours (V13) = plus tard.

FRONTIÈRES V9/aval gravées (croisé conv 47 — des CONTRATS, pas des bugs de V7) :
  - F-A : `evt.tts.done` n'est PAS garanti pour TOUTE énonciation. Moteur mort (Piper absent, warm a levé →
    worker sorti) → une énonciation ouverte ne reçoit NI start NI done (bouche muette, dégradation VOULUE).
    L'aval (le routeur V9 / morceau C) DOIT porter une DEADLINE de complétion (analogue au contrat R-1 du
    réveil V3) → il ne bloque JAMAIS indéfiniment sur `evt.tts.done`.
  - F-B : le marqueur `end` d'une énonciation est enfilé EN DERNIER dans play_q → un débordement au sein d'UNE
    énonciation évince ses PHRASES (en tête), jamais son `end` (en queue). L'éviction du `end` (donc du done)
    exige un débordement SOUTENU inter-énonciations (les phrases de N+1 chassent le `end` de N pendant que le
    play worker est calé) OU un play worker définitivement bloqué (qui relève alors de F-A). Corner rare, RAM
    bornée, signalé par `dropped_play`, couvert par la même deadline d'aval (F-A).
"""
from __future__ import annotations

import os
import queue
import threading
import time
import wave
from collections import deque
from pathlib import Path

import numpy as np

from tts.engine import PiperEngine, TtsEngine
from tts.split import clean_for_tts, split_sentences, split_stream

_GEN_MAX = 256          # borne file de phrases à synthétiser (drop-oldest si le worker meurt — parité stt._cmds)
_PLAY_MAX = 128         # borne file d'audios prêts (train d'avance d'une énonciation ; RAM bornée)
_DONE_MEMORY = 512      # garde anti-double des ids déjà « done » (ids monotones de l'orchestrateur ; borné)
# V7 morceau C — GATE anti-auto-écoute : TRAÎNE (s) après `evt.tts.done` pendant laquelle SA voix résiduelle
# (playback → loopback → AEC ~10 dB, latence pipeline ~200 ms) est ENCORE dans le ring → le VadPlug continue
# d'ignorer le micro (sinon le résidu se fait re-transcrire → elle se répond à elle-même, mesuré au juge conv 47).
# Équivalent produit du `_flush_audio` du banc (oreilles_live:1298/1314). Env-réglable (calibré au juge à ta voix).
_TTS_TAIL_S = float(os.environ.get("SOPHIA_TTS_TAIL_S", "0.30"))
# Cap de securite du gate : si `_started` fuyait (marqueur `end` evince sous debordement soutenu, F-B — impossible
# dans le flux V7 mono-enonciation, mais defense EN PROFONDEUR), is_speaking ne resterait PAS True a jamais (Sophia
# sourde definitivement). Au-dela de ce cap depuis le DEBUT de la span de parole, le gate FAIL-OPEN (elle re-ecoute).
# 300 s = LARGEMENT au-dessus de toute vraie reponse CONTINUE (meme une lecture a voix haute), pour ne JAMAIS mordre
# sur une reponse legitime (croise robustesse conv 47) ; la fuite qu'il rattrape etant impossible, un cap large ne
# coute rien. Env-reglable.
_TTS_MAX_SPEAK_S = float(os.environ.get("SOPHIA_TTS_MAX_SPEAK_S", "300.0"))


def _enqueue_drop_oldest(q: "queue.Queue", item) -> bool:
    """Enfile ; si pleine, jette le PLUS VIEUX puis réessaie. Retourne True si un drop a eu lieu. Le cas
    ANORMAL (worker mort → file jamais drainée) ne fuit pas la RAM (comme le bus V2 / stt._cmds V4)."""
    dropped = False
    while True:
        try:
            q.put_nowait(item)
            return dropped
        except queue.Full:
            try:
                q.get_nowait()
                dropped = True
            except queue.Empty:
                return dropped


class Output:
    """Contrat de SORTIE audio (injectable). `play(audio, sr)` est BLOQUANT (rend à la fin de la lecture) ;
    `stop()` interrompt une lecture en cours (purge/barge-in) ; `close()` libère (arrêt propre)."""

    def play(self, audio: np.ndarray, sr: int) -> None:
        raise NotImplementedError

    def stop(self) -> None:
        pass

    def close(self) -> None:
        pass


class SdOutput(Output):
    """Sortie via `sounddevice` (WASAPI PARTAGÉ → capté par le loopback → annulé par l'AEC, F2 ; cohabitation
    avec pyaudiowpatch prouvée b1 conv 47). Import PARESSEUX. `sd.play`+`sd.wait` = lecture bloquante ;
    `sd.stop` interrompt (coupe net à la purge). Le SR d'A20 (22050) est rééchantillonné par WASAPI partagé
    si la sortie tourne à un autre taux (mesuré b1 : sortie par défaut 44100)."""

    def play(self, audio: np.ndarray, sr: int) -> None:
        import sounddevice as sd
        sd.play(audio, sr)
        sd.wait()

    def stop(self) -> None:
        try:
            import sounddevice as sd
            sd.stop()
        except Exception:
            pass


class NullOutput(Output):
    """Sortie SILENCIEUSE : prouve le chemin `cmd.tts.* → synth Piper → evt.tts.*` SANS jouer de son (E2E
    headless, automatisable). Le JUGE à ta VOIX passe par `SdOutput` (mode prod `SIDECAR_AUDIO=1`, ou la
    bouche seule audible via `SOPHIA_TTS_AUDIBLE=1`). `play()` = no-op immédiat ; `stop()` = no-op."""

    def __init__(self):
        self.played = 0

    def play(self, audio: np.ndarray, sr: int) -> None:
        self.played += 1


class TtsPlug:
    """La prise `tts`. Reçoit les `cmd.tts.*` (appelés depuis le thread de la boucle asyncio — séquentiels),
    fait tourner deux threads workers (gen/play), émet `evt.tts.*`. L'état partagé boucle↔workers (epoch,
    started, done, playing) est sous lock ; `_cur_*` (réception d'une énonciation) n'est touché QUE par la
    boucle (un seul thread)."""

    name = "tts"

    def __init__(self, emit, engine: TtsEngine | None = None, output: Output | None = None,
                 tail_s: float | None = None, max_speak_s: float | None = None,
                 clips_dir: str | None = None):
        self._emit = emit
        self._engine = engine if engine is not None else PiperEngine()
        self._output = output if output is not None else SdOutput()
        self._tail_s = _TTS_TAIL_S if tail_s is None else float(tail_s)   # V7 morceau C : traîne du gate anti-auto-écoute
        self._max_speak_s = _TTS_MAX_SPEAK_S if max_speak_s is None else float(max_speak_s)  # cap de sécurité du gate
        self._gen_q: queue.Queue = queue.Queue(maxsize=_GEN_MAX)     # (epoch, id, kind, payload)  kind: phrase|end
        self._play_q: queue.Queue = queue.Queue(maxsize=_PLAY_MAX)   # (epoch, id, kind, payload)  kind: audio|end
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._gen_thread: threading.Thread | None = None
        self._play_thread: threading.Thread | None = None
        # état partagé (sous _lock)
        self._epoch = 0                 # incrémenté à la purge → invalide les items en vol (coupe net)
        self._started: set[int] = set() # ids ayant émis evt.tts.start
        self._done: deque = deque(maxlen=_DONE_MEMORY)   # ids ayant émis evt.tts.done (anti-double, borné)
        self._playing: int | None = None                 # id en cours de LECTURE (pour la purge)
        self._speaking_until = 0.0      # V7 morceau C : deadline monotone de la TRAÎNE post-done (gate anti-auto-écoute)
        self._speaking_since = 0.0      # V7 : début (monotone) de la span de parole courante (cap de sécurité du gate)
        self._engine_ok = False         # le moteur a chargé (sinon la bouche est muette, honnêtement)
        # réception d'une énonciation (thread de la boucle SEULEMENT)
        self._cur_id: int | None = None
        self._cur_epoch = 0
        self._cur_buf = ""
        # observabilité
        self._utterances = 0
        self._sentences = 0
        self._synth_errors = 0
        self._purges = 0
        self._dropped_gen = 0
        self._dropped_play = 0
        self._starts = 0
        self._dones = 0
        self._last_text: str | None = None
        # V10 (conv 52) — clips PRÉ-VENDORISÉS (hmm de réflexion) : joués tels quels dans le train (pas de synth ;
        # Piper ne fait pas de hmm naturel → clip XTTS/A20 vendorisé, choix Yohann conv 33/52). `name` → (audio, sr).
        self._clips: dict[str, tuple[np.ndarray, int]] = {}
        self._clips_errors = 0
        self._clips_played = 0
        self._load_clips(clips_dir)

    # ── cycle de vie ─────────────────────────────────────────────────────────────
    def start(self) -> None:
        if self._gen_thread is not None:
            return
        self._stop.clear()
        self._gen_thread = threading.Thread(target=self._gen_loop, name="tts-gen", daemon=True)
        self._play_thread = threading.Thread(target=self._play_loop, name="tts-play", daemon=True)
        self._gen_thread.start()
        self._play_thread.start()

    def stop(self) -> None:
        self._stop.set()
        try:
            self._output.stop()          # débloque un play() en cours
        except Exception:
            pass
        # sentinelles pour débloquer les get() bloquants des workers
        _enqueue_drop_oldest(self._gen_q, None)
        _enqueue_drop_oldest(self._play_q, None)
        stuck = False
        for t in (self._gen_thread, self._play_thread):
            if t is not None:
                t.join(timeout=1.5)
                if t.is_alive():
                    stuck = True         # bloqué > join (ex. warm() Piper en cours, non interruptible)
        if stuck:
            # #3 (croisé conv 47, parité base.py R#9) : un worker vit encore (chargement Piper > join). On NE
            # nullifie PAS les refs -> un start() ultérieur (garde `if self._gen_thread is not None: return`) ne
            # relance pas des workers DOUBLONS sur gen_q/play_q (double start/done + audio superposé). On NE close
            # PAS la sortie non plus (un play worker pourrait être bloqué DEDANS — NIT re-croisé conv 47) : elle
            # sera libérée au process exit (SIGKILL T6). Les threads sont daemon. On SIGNALE, jamais un doublon.
            self._safe_emit("evt.plug.stuck", {"plug": self.name})
            return
        try:
            self._output.close()
        except Exception:
            pass
        self._gen_thread = None
        self._play_thread = None

    def warm(self) -> None:
        """Pré-charge le moteur (LÈVE si absent → l'appelant dégrade honnêtement)."""
        self._engine.warm()

    # ── commandes (thread de la boucle asyncio — séquentielles entre elles) ───────
    def speak(self, utt_id: int) -> None:
        """Ouvre une énonciation `utt_id` (un tour de réponse). Fixe son epoch (une purge en cours l'invalide).
        CONTRAT : `utt_id` est attendu MONOTONE (le routeur = un compteur croissant). L'anti-double `_done`
        (borné à _DONE_MEMORY) suppose qu'un id n'est pas réutilisé dans sa fenêtre — un id réémis y serait
        étouffé (pas de start/done). On DISCARD tout de même l'id de `_started`/`_done` au speak (défense légère,
        O(1)+O(n≤512) une fois par tour) → une réutilisation ne casse rien même si le compteur boucle un jour."""
        with self._lock:
            self._started.discard(int(utt_id))
            try:
                self._done.remove(int(utt_id))
            except ValueError:
                pass
        self._cur_id = int(utt_id)
        self._cur_buf = ""
        self._cur_epoch = self._epoch          # lecture atomique (int) ; borne l'énonciation à cet epoch
        self._utterances += 1

    def push(self, utt_id: int, text: str) -> None:
        """Pousse du texte AU FIL. Accumule, découpe en phrases (split_stream), enfile chaque phrase COMPLÈTE
        (nettoyée markdown/émojis) vers le train. Robuste : un push hors énonciation courante est ignoré."""
        if self._cur_id is None or int(utt_id) != self._cur_id:
            return
        self._cur_buf += text
        while True:
            phrase, self._cur_buf = split_stream(self._cur_buf)
            if phrase is None:
                break
            self._enqueue_phrase(phrase)

    def end(self, utt_id: int) -> None:
        """Clôt l'énonciation : flush le reliquat (split_sentences → la dernière phrase sans blanc final) puis
        enfile le marqueur de fin (→ evt.tts.done quand toutes ses phrases auront joué)."""
        if self._cur_id is None or int(utt_id) != self._cur_id:
            return
        tail = self._cur_buf.strip()
        self._cur_buf = ""
        if tail:
            for s in split_sentences(tail):
                self._enqueue_phrase(s)
        drop = _enqueue_drop_oldest(self._gen_q, (self._cur_epoch, self._cur_id, "end", None))
        if drop:
            self._dropped_gen += 1
        self._cur_id = None

    def purge(self) -> None:
        """cmd.tts.stop / barge-in : coupe NET. Invalide tout (epoch++), vide les files, interrompt la lecture,
        et clôt TOUTES les énonciations DÉMARRÉES et pas encore finies (evt.tts.done interrupted). MAJEUR croisé
        conv 47 : résoudre `_started` (l'ensemble AUTORITAIRE des « start émis, pas de done »), PAS le seul
        `_playing` — sinon une purge interposée entre `_emit_start(N)` et `_playing=N` (le cas barge-in V8, le
        service même de cette prise) laisse N ORPHELIN (start sans done → l'orchestrateur bloque, `_started`
        fuit). `_playing ⊆ _started`. Le garde `_done` (dans `_emit_done`) étouffe un `completed` tardif éventuel
        (pas de double). Une énonciation qui n'a PAS émis start n'est pas dans `_started` → pas de done (jamais
        de start non plus : équilibre ; l'orchestrateur clôt les énonciations en vol sur cmd.tts.stop, doc `01` §2.2)."""
        with self._lock:
            self._epoch += 1
            started = set(self._started)   # capture sous lock : tous les « démarré, pas fini » (_playing inclus)
            self._purges += 1
        self._drain(self._gen_q)
        self._drain(self._play_q)
        try:
            self._output.stop()
        except Exception:
            pass
        self._cur_id = None
        self._cur_buf = ""
        for uid in started:
            self._emit_done(uid, "interrupted")   # #1 : done pour TOUT _started (pas le seul _playing = orphelin)

    def clip(self, utt_id: int, name: str) -> None:
        """V10 (conv 52) — joue un CLIP pré-vendorisé (hmm de réflexion) comme une énonciation dans le train.
        Déjà rendu (WAV) → enfilé DIRECTEMENT dans play_q (pas de gen/synth : Piper ne fait pas de hmm naturel).
        Ordonné comme une énonciation normale (start/done via le play worker) → il joue AVANT la réponse qui suit
        dans le train, et le gate anti-auto-écoute (is_speaking via `_started`) le couvre. Nom inconnu → no-op
        honnête (pas de son manquant qui bloque : l'aval a sa deadline F-A). `utt_id` monotone (parité speak)."""
        clip = self._clips.get(name)
        if clip is None:
            return
        audio, csr = clip
        with self._lock:
            epoch = self._epoch          # une purge concurrente bumpe l'epoch → les items ci-dessous seront périmés (skip)
        self._utterances += 1
        self._clips_played += 1
        if _enqueue_drop_oldest(self._play_q, (epoch, int(utt_id), "clip", (audio, int(csr)))):
            self._dropped_play += 1
        if _enqueue_drop_oldest(self._play_q, (epoch, int(utt_id), "end", None)):   # marqueur de fin → evt.tts.done
            self._dropped_play += 1

    # ── privé ────────────────────────────────────────────────────────────────────
    def _load_clips(self, clips_dir: str | None) -> None:
        """Charge les WAV de `resources/clips/` (nom = stem) en float32 mono @ leur SR natif. Best-effort :
        dossier absent (tests de logique pure) ou WAV illisible → ignoré (jamais fatal). Racine repo = parents[3]
        (plug.py est dans sidecar/tts/)."""
        d = Path(clips_dir) if clips_dir else Path(__file__).resolve().parents[2] / "resources" / "clips"
        if not d.is_dir():
            return
        for p in sorted(d.glob("*.wav")):
            try:
                with wave.open(str(p), "rb") as w:
                    n, sr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
                    raw = w.readframes(n)
                if sw == 2:
                    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                elif sw == 4:
                    a = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
                else:
                    self._clips_errors += 1
                    continue
                if ch > 1:
                    a = a.reshape(-1, ch).mean(axis=1)
                self._clips[p.stem] = (np.ascontiguousarray(a, dtype=np.float32), int(sr))
            except Exception:
                self._clips_errors += 1

    def _enqueue_phrase(self, phrase: str) -> None:
        s = clean_for_tts(phrase)
        if not s:
            return
        self._last_text = s
        drop = _enqueue_drop_oldest(self._gen_q, (self._cur_epoch, self._cur_id, "phrase", s))
        if drop:
            self._dropped_gen += 1

    @staticmethod
    def _drain(q: "queue.Queue") -> None:
        while True:
            try:
                q.get_nowait()
            except queue.Empty:
                return

    def _gen_loop(self) -> None:
        # Charge le moteur (bloquant ~qq s) DANS ce thread → /health répond pendant le chargement. Un échec
        # dégrade HONNÊTEMENT (bouche muette, comme le sidecar sans micro) : le worker sort, les cmd.tts
        # suivants s'accumulent dans la file BORNÉE (drop-oldest → pas de fuite), jamais un crash.
        try:
            self._engine.warm()
            self._engine_ok = True
        except Exception:
            self._synth_errors += 1
            return
        while not self._stop.is_set():
            item = self._gen_q.get()
            if item is None:
                break
            epoch, utt_id, kind, payload = item
            if epoch < self._epoch:              # périmé (purgé) — lecture atomique de _epoch
                continue
            if kind == "phrase":
                try:
                    audio = self._engine.synth(payload)   # normalize+lexique+synth+polish (Piper A20)
                except Exception:
                    self._synth_errors += 1               # une phrase ratée ne tue pas le worker (parité ConsumerPlug)
                    continue
                if epoch < self._epoch or self._stop.is_set():
                    continue                              # purgé/arrêté pendant la synthèse
                drop = _enqueue_drop_oldest(self._play_q, (epoch, utt_id, "audio", audio))
                if drop:
                    self._dropped_play += 1
                self._sentences += 1
            elif kind == "end":
                drop = _enqueue_drop_oldest(self._play_q, (epoch, utt_id, "end", None))
                if drop:
                    self._dropped_play += 1

    def _play_loop(self) -> None:
        sr = int(getattr(self._engine, "sample_rate", 22050))
        while not self._stop.is_set():
            item = self._play_q.get()
            if item is None:
                break
            epoch, utt_id, kind, payload = item
            if epoch < self._epoch:              # périmé (purgé)
                continue
            if kind == "audio":
                # Finding 1 (re-croisé conv 47) : le check d'epoch, l'entrée dans _started et la pose de _playing
                # sont ATOMIQUES (un seul lock, _begin_audio) — sinon une purge qui capture set(_started) ENTRE le
                # check d'epoch (non verrouillé, en tête de boucle) et l'add laisserait N ORPHELIN (start sans
                # done). N n'entre dans _started QUE si l'epoch est frais -> purge-AVANT = skip total (rien à
                # clôturer) ; purge-APRÈS = N est dans le snapshot de la purge -> done(interrupted). Couvre aussi
                # #2 (le play-over) : périmé -> on ne joue pas.
                first = self._begin_audio(epoch, utt_id)
                if first is None:
                    continue                      # purgé AVANT le start → ni start ni _playing (rien à clôturer)
                if first:
                    self._safe_emit("evt.tts.start", {"id": int(utt_id)})   # 1er son (émis HORS lock)
                if epoch != self._epoch:          # best-effort (#2) : une purge PENDANT le start emit → NE PAS jouer
                    continue                       # par-dessus l'utilisateur (le done vient de la purge : N est dans
                    #                                _started via _begin_audio → capturé par son snapshot). Réduit le
                    #                                résidu play→stop au strict inhérent [ici → output.play].
                try:
                    self._output.play(payload, int(getattr(self._engine, "sample_rate", sr)))
                except Exception:
                    pass                          # une sortie qui trébuche ne tue pas le worker
                # résidu play→stop inhérent (purge intercalée ICI) : output.stop() coupe la lecture en cours,
                # sinon la phrase finit — « résidu assumé » comme V1. Le done(interrupted) est déjà correct
                # (N était dans le snapshot de la purge, via _begin_audio).
                with self._lock:
                    if self._playing == utt_id:
                        self._playing = None
            elif kind == "clip":
                # V10 (conv 52) — un CLIP pré-vendorisé (hmm) : MÊME cycle qu'un "audio" (begin atomique → start →
                # play → libère _playing), mais joué à SON PROPRE SR (le clip peut différer d'A20 ; WASAPI partagé
                # rééchantillonne). Le marqueur "end" qui le suit émettra evt.tts.done (branche ci-dessous).
                caudio, csr = payload
                first = self._begin_audio(epoch, utt_id)
                if first is None:
                    continue
                if first:
                    self._safe_emit("evt.tts.start", {"id": int(utt_id)})
                if epoch != self._epoch:
                    continue
                try:
                    self._output.play(caudio, int(csr))
                except Exception:
                    pass
                with self._lock:
                    if self._playing == utt_id:
                        self._playing = None
            elif kind == "end":
                self._emit_done(utt_id, "completed")   # toutes les phrases de l'énonciation ont joué

    def _begin_audio(self, epoch: int, utt_id: int):
        """Ouvre la lecture d'un audio SOUS UN SEUL LOCK (Finding 1 re-croisé conv 47) : le check d'epoch,
        l'entrée dans `_started` et la pose de `_playing` sont ATOMIQUES — N n'entre dans `_started` QUE si
        l'epoch est frais. Ferme la fenêtre orpheline [check epoch → add] : une purge est soit AVANT (retourne
        None, N jamais démarré → rien à clôturer), soit APRÈS (N est alors dans le snapshot `set(_started)` de la
        purge → done émis). Retourne `first` (True = 1er son de l'énonciation → start à émettre ; False = déjà
        démarré, idempotent), ou None si l'audio est PÉRIMÉ (purge passée)."""
        with self._lock:
            if epoch != self._epoch:
                return None
            was_idle = not self._started           # V7 : transition repos -> parole -> (re)arme le cap de securite
            first = utt_id not in self._started and utt_id not in self._done
            if first:
                self._started.add(utt_id)
                self._starts += 1
                if was_idle:
                    self._speaking_since = time.monotonic()   # debut de la span de parole (cap de securite du gate)
            self._playing = utt_id
            return first

    def _emit_done(self, utt_id: int, reason: str) -> None:
        with self._lock:
            if utt_id in self._done:              # anti-double (completed vs interrupted en course → un seul gagne)
                return
            self._done.append(utt_id)
            self._started.discard(utt_id)
            if self._playing == utt_id:
                self._playing = None
            self._dones += 1
            self._speaking_until = time.monotonic() + self._tail_s   # V7 : arme la TRAÎNE du gate anti-auto-écoute
        self._safe_emit("evt.tts.done", {"id": int(utt_id), "reason": reason})

    def _safe_emit(self, etype: str, payload: dict) -> None:
        try:
            self._emit(etype, payload)
        except Exception:
            pass   # un emit qui échoue (bus arrêté au teardown…) ne casse jamais le train (parité VadPlug)

    # ── GATE anti-auto-écoute (V7 morceau C) ─────────────────────────────────────
    def is_speaking(self) -> bool:
        """True quand une énonciation JOUE (start émis, pas de done) OU pendant la TRAÎNE `_tail_s` après le
        dernier done. Le VadPlug l'interroge (`set_gate`) et IGNORE le micro tant que c'est True → Sophia ne se
        re-transcrit pas (son résidu post-AEC ~10 dB ne forme pas de faux tour). C'est l'équivalent produit du
        `_flush_audio` du banc (oreilles_live:1298/1314) : là-bas la boucle unique était bloquée dans `_await` ;
        ici la voix (productrice) et l'écoute (consommatrice) sont sur des threads séparés → ce drapeau les
        recouple. Lecture sous `_lock` (parité `state`) ; appelé souvent (chaque fenêtre VAD ~32 ms), coût O(1)."""
        with self._lock:
            if self._started:
                # cap de securite (F-A analog) : un `_started` qui fuirait (F-B) ne rend PAS Sophia sourde a jamais
                # -> au-dela de `_max_speak_s` depuis le debut de la span, on FAIL-OPEN (elle re-ecoute).
                return time.monotonic() - self._speaking_since < self._max_speak_s
            return time.monotonic() < self._speaking_until

    @property
    def state(self) -> dict:
        with self._lock:
            playing = self._playing
            epoch = self._epoch
            _now = time.monotonic()                                    # `speaking` == is_speaking EXACTEMENT (sans re-lock)
            if self._started:                                          # (fidelite #4 croise : meme branche que is_speaking,
                speaking = _now - self._speaking_since < self._max_speak_s   # pas de divergence gate/observabilite dans
            else:                                                      #  le cas degenere « _started fuit + cap depasse »)
                speaking = _now < self._speaking_until
        return {
            "engine_ok": self._engine_ok,
            "utterances": self._utterances,
            "sentences": self._sentences,
            "starts": self._starts,
            "dones": self._dones,
            "synth_errors": self._synth_errors,
            "purges": self._purges,
            "dropped_gen": self._dropped_gen,
            "dropped_play": self._dropped_play,
            "playing": playing,
            "speaking": speaking,           # V7 : gate anti-auto-écoute actif ? (énonciation en vol OU traîne)
            "tail_s": self._tail_s,         # V7 : durée de la traîne post-done (calibrée au juge)
            "epoch": epoch,
            "gen_q": self._gen_q.qsize(),
            "play_q": self._play_q.qsize(),
            "last_text": self._last_text,
            "clips": sorted(self._clips.keys()),   # V10 : clips vendorisés chargés (hmm…)
            "clips_played": self._clips_played,
            "clips_errors": self._clips_errors,
        }
