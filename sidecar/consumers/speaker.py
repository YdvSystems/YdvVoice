"""Sophia — sidecar / speaker-ID « qui parle ? » (plan 01, V6 · A29 couche 1).

« Est-ce Yohann qui parle, ou une autre voix (dont le RESIDU de sa propre voix quand elle parle) ? » V6 est
un CONSOMMATEUR du ring POST-AEC (curseur INDEPENDANT, patron 01-F / V0) : sur chaque segment de parole que
le VAD (V2) marque, il score l'audio contre l'EMPREINTE de Yohann (centroide de sa voix) et emet
`evt.speaker {locuteur, score}`. C'est une PRECONDITION gravee de :
  - V8 (barge-in module) : la voix de Yohann coupe vite ; une inconnue attend ; SON PROPRE RESIDU ne coupe
    JAMAIS (invariant F2). L'invariant « elle ne se coupe jamais elle-meme » est garanti par l'AEC (V1/F2) :
    V6 ne voit la voix de Sophia qu'APRES l'AEC, attenuee au residu (~0,21, mesure live conv 34), jamais a
    plein niveau -> V6 n'a pas a separer une Sophia pleine (dependance reelle a V1, tracee §7).
  - V14 (verrou d'affect) : n'evaluer l'emotion que si locuteur = Yohann.

`evt.speaker` = une COUTURE INJECTABLE (le moteur ET le centroide sont injectables) -> V8/V14 se testent
DETERMINISTE, independamment du modele reel. L'echelle de confiance complete, l'enrolement des proches et la
vie sociale = doc `04` ; ICI, seulement le consommateur + son evenement (plan `01` §3 V6).

Moteur = **ECAPA-TDNN `spkrec-ecapa-voxceleb` (SpeechBrain), CPU** (banc conv 33-34 : EER 0 % a l'integration,
re-confirme sur la vraie voix A20 ; reproduit dans le venv PRODUIT conv 46, A20 moy 0,152 ≈ banc 0,165). Il
vit DERRIERE une interface INJECTABLE (`SpeakerEngine`) : prod = `EcapaEngine` (modele VENDORISE offline,
resources/models/speaker/) ; test = moteur scripte deterministe. La LOGIQUE (cosinus, decision, cadence) est
PURE (testable sans ECAPA). Import speechbrain/torch PARESSEUX (module importable sans eux, parite `turn.py`).

Fidele au banc `v6_service.py` (embedding/centroide/score) + `v8_bargein.py` (la cadence prouvee LIVE) —
valeurs ET logique (regle perf : produit >= banc). CPU force par `run_opts={"device":"cpu"}` (SCOPE au
modele — JAMAIS `CUDA_VISIBLE_DEVICES=""`, qui aveuglerait le STT GPU du meme process, conv 46).
"""
from __future__ import annotations

import math
import os
import queue
import wave

import numpy as np

from plugs.base import ConsumerPlug

RATE = 16000


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


# ── Constantes EXACTES du banc `v8_bargein.py` (la trajectoire prouvee LIVE conv 34) — regle perf >= banc ──
MIN_SPEECH_S = 0.75    # parole accumulee avant le 1er score (banc MIN_SPEECH)
MAX_WIN_S = 1.5        # fenetre glissante de score : on score les DERNIERES 1,5 s de parole (banc MAX_WIN)
CAP_S = 3.0            # au-dela, la decision est prise -> on cesse d'evaluer (banc CAP ; = point EER 0 %)
EVAL_EVERY_S = 0.5     # re-score tous les 0,5 s de parole accumulee (banc EVAL_EVERY)
MIN_SAMPLES = int(0.4 * RATE)   # sous 0,4 s de parole, PAS de score fiable -> pas de verdict (banc v6_service)

MAX_WIN = int(MAX_WIN_S * RATE)

# SEUIL : defaut 0,22 = la valeur LIVE PROUVEE du banc (conv 34 : residu post-AEC de Sophia ~0,21 / Yohann
# barge-in 0,23-0,39, 6/6 0 fausse coupe). PAS derive des clips A20 OFFLINE (plein niveau, 0,30-0,42 contre le
# centroide) : en runtime V6 ne voit la voix de Sophia qu'APRES l'AEC (V1/F2), attenuee au residu. Le VRAI
# juge = la voix de Yohann LIVE (barriere design-first conv 46 : le modele SEPARE [EER 0 % a l'integration],
# le seuil se cale a ta voix). Env-surchargeable. §6 calibration / §7.
SPEAKER_THR = _envf("SOPHIA_SPEAKER_THR", 0.22)

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # sidecar/consumers -> racine
_MODEL_DIR = os.path.join(_ROOT, "resources", "models", "speaker")
_ANCHOR_DIR = os.path.join(_ROOT, "resources", "models", "voice-anchor")
# Ancre = les 3 enregistrements PROPRES de Yohann (pres/normal/doux) -> centroide robuste (v6_service EXACT).
ANCHOR_CLIPS = ("raw_near.wav", "raw.wav", "raw_soft.wav")


def load16(path: str) -> np.ndarray:
    """WAV int16 mono -> float32 [-1,1] via ÷32768, resample vers 16 kHz si besoin (== banc `load16` ;
    l'ancre de Yohann est deja 16 kHz -> pas de resample, mais robuste au debit pour tout clip). Import
    torchaudio PARESSEUX (seulement si un resample est necessaire)."""
    w = wave.open(path, "rb")
    try:
        ch, sr, n = w.getnchannels(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    finally:
        w.close()
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    if sr != RATE:
        import torch
        import torchaudio.functional as AF
        a = AF.resample(torch.from_numpy(np.ascontiguousarray(a)), sr, RATE).numpy()
    return np.ascontiguousarray(a, dtype=np.float32)


# ══════════ Logique PURE (testable sans ECAPA — parite `turn.py`) ══════════

def cosine(emb: np.ndarray, centroid: np.ndarray) -> float:
    """Similarite cosinus. Les deux vecteurs sont L2-normalises (emb par le moteur, centroide a la
    construction) -> le produit scalaire EST le cosinus (v6_service `emb @ CENTROID`)."""
    return float(np.dot(np.asarray(emb, dtype=np.float64), np.asarray(centroid, dtype=np.float64)))


def decide(score: float, threshold: float = SPEAKER_THR) -> str:
    """Verdict GROSSIER : « yohann » si le score depasse le seuil, sinon « inconnu » (une vraie voix
    differente). L'echelle de confiance fine + le doute social = doc `04` ; ici, le verdict binaire."""
    return "yohann" if score >= threshold else "inconnu"


# ══════════ Moteur speaker injectable ══════════

class SpeakerEngine:
    """Contrat moteur speaker-ID (injectable). `embed(audio_f32) -> vecteur L2-normalise (np.ndarray)`.
    `warm()` pre-charge. prod = `EcapaEngine` (ECAPA ONNX/torch CPU) ; test = scripte deterministe."""

    def embed(self, audio: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def warm(self) -> None:
        pass


class EcapaEngine(SpeakerEngine):
    """ECAPA-TDNN `spkrec-ecapa-voxceleb` (SpeechBrain), **CPU** (banc conv 33-34). Modele VENDORISE offline
    (`resources/models/speaker/`) charge par `run_opts={"device":"cpu"}` — CPU FORCE au niveau du modele, SANS
    `CUDA_VISIBLE_DEVICES=""` (qui aveuglerait le STT GPU du meme process ; conv 46, mesure a la source). La
    source LOCALE evite tout reseau au runtime (plan `05` : mesure conv 46, chargement 0,27 s offline, aucune
    variable HF globale -> faster-whisper protege). `embed` = copie fidele `v6_service.emb`
    (encode_batch -> reshape -> L2-normalise). Import speechbrain/torch PARESSEUX."""

    def __init__(self, model_dir: str | None = None):
        self._dir = model_dir or _MODEL_DIR
        self._enc = None

    def warm(self) -> None:
        """Charge le modele vendorise (CPU) + une inference JETABLE (compile les noyaux -> le 1er vrai score
        ne paie pas l'init, parite warmup STT/Smart Turn). LEVE si le modele est absent -> l'appelant degrade
        HONNETEMENT (pas de verdict, jamais un crash)."""
        if self._enc is not None:
            return
        from speechbrain.inference.speaker import EncoderClassifier
        enc = EncoderClassifier.from_hparams(
            source=self._dir, savedir=self._dir, run_opts={"device": "cpu"})   # CPU force, source LOCALE (offline)
        self._enc = enc
        try:
            self.embed(np.zeros(RATE, dtype=np.float32))   # warmup (1 s) : compile les noyaux CPU
        except Exception:
            pass

    def embed(self, audio: np.ndarray) -> np.ndarray:
        """Vecteur d'identite L2-normalise (192-dim) pour l'audio 16 kHz. Copie FIDELE `v6_service.emb`."""
        self.warm()
        import torch
        x = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).unsqueeze(0)
        with torch.no_grad():
            e = self._enc.encode_batch(x).reshape(-1)
        return (e / e.norm()).numpy()


def build_centroid(engine: SpeakerEngine, clip_paths) -> np.ndarray:
    """L'empreinte de Yohann = moyenne NORMALISEE des embeddings de ses clips propres (copie fidele
    `v6_service.build_centroid` : raw_near/raw/raw_soft). Construite au RUNTIME dans la MEME instance ECAPA qui
    scorera la parole -> coherence centroide<->scoring (pas de couplage a une version de modele figee dans un
    .npy). V15 (conv 60, ecart A-b) : `cmd.enroll.push` est un JALON D'ORDRE dans la sequence S10 (ack honnete,
    rien n'est pousse — l'ancre vendorisee EST la source) ; l'ENROLEMENT reel (doc 04 / premier boot) poussera
    une empreinte fraiche par la meme couture (centroide injecte)."""
    embs = []
    for p in clip_paths:
        if os.path.exists(p):
            embs.append(engine.embed(load16(p)))
    if not embs:
        raise FileNotFoundError(f"aucun clip d'ancre trouve (attendus : {clip_paths})")
    c = np.mean(embs, axis=0)
    n = np.linalg.norm(c)
    if n <= 0:
        raise ValueError("centroide degenere (norme nulle)")
    return (c / n).astype(np.float32)


# ══════════ Le detecteur (moteur + centroide + logique — parite `TurnDetector`) ══════════

class SpeakerDetector:
    """Assemble le moteur (injectable) et le centroide (injectable). Le `SpeakerPlug` l'appelle a chaque point
    d'evaluation : `evaluate(audio) -> (locuteur, score) | None`.

    GARDES HONNETES (conv 46, crible facilite) : un ECHEC de calcul n'est PAS « inconnu » -> retourne None
    (« pas de verdict »), l'appelant N'EMET RIEN, l'aval (V8/V14) gere l'absence par son defaut (jamais trompe
    par un crash etiquete « inconnu ») :
      - audio < MIN_SAMPLES (0,4 s)     -> None (pas assez pour decider, v6_service) ;
      - le moteur LEVE (ECAPA absent/KO) -> _errors++ + None (jamais un crash ; le tour continue) ;
      - score non fini (NaN/inf)         -> _errors++ + None (contrat garde a la frontiere injectable).
    Un vrai score BAS (< seuil) -> ("inconnu", score) : ca, c'est une vraie voix differente (pas un echec)."""

    def __init__(self, engine: SpeakerEngine | None = None, centroid: np.ndarray | None = None,
                 threshold: float | None = None, anchor_clips=None):
        self._engine = engine if engine is not None else EcapaEngine()
        self._centroid = None if centroid is None else np.asarray(centroid, dtype=np.float32)
        self._threshold = float(threshold) if threshold is not None else SPEAKER_THR
        self._anchor = anchor_clips if anchor_clips is not None else [os.path.join(_ANCHOR_DIR, f) for f in ANCHOR_CLIPS]
        self._errors = 0
        self._last_score: float | None = None
        self._last_locuteur: str | None = None

    def warm(self) -> None:
        """Pre-charge le moteur PUIS construit le centroide (si non injecte) dans la meme instance. LEVE si le
        modele ou l'ancre sont absents -> l'appelant degrade honnetement (V6 inerte, jamais un crash)."""
        self._engine.warm()
        if self._centroid is None:
            self._centroid = build_centroid(self._engine, self._anchor)

    def evaluate(self, audio: np.ndarray):
        """(locuteur, score) ou None (pas de verdict). Voir GARDES HONNETES ci-dessus."""
        if audio is None or len(audio) < MIN_SAMPLES:
            return None                                   # pas assez de parole pour un score fiable
        try:
            if self._centroid is None:
                self.warm()                               # 1er appel : charge moteur + centroide
            emb = self._engine.embed(audio)
            score = cosine(emb, self._centroid)
        except Exception:
            self._errors += 1                             # echec de calcul (ECAPA absent/KO) -> PAS un verdict
            return None
        if not math.isfinite(score):                      # contrat a la frontiere injectable (NaN/inf) -> pas un verdict
            self._errors += 1
            return None
        locuteur = decide(score, self._threshold)
        self._last_score = score
        self._last_locuteur = locuteur
        return locuteur, score

    @property
    def errors(self) -> int:
        return self._errors

    @property
    def last_score(self) -> float | None:
        return self._last_score

    @property
    def last_locuteur(self) -> str | None:
        return self._last_locuteur

    @property
    def threshold(self) -> float:
        return self._threshold


# ══════════ La prise speaker (consommateur pilote-VAD — patron STT, sans transcription) ══════════

class SpeakerPlug(ConsumerPlug):
    """Prise speaker-ID (V6). Un WORKER UNIQUE (le thread de la prise) lit le ring POST-AEC via son curseur
    INDEPENDANT (SPMC) et fait tourner l'ECAPA (lourd -> thread dedie, ne bloque JAMAIS le VAD/STT). Pilotee
    par les marques VAD (`on_vad`, file thread-safe bornee) : a `evt.vad.start` il rembobine son curseur a la
    marque (`seek_to`), lit le segment de parole [start, stop] (borne, R-2 overrun verifie), ACCUMULE, et a
    chaque point de la trajectoire du banc (1er a MIN_SPEECH, puis chaque EVAL_EVERY, plafonne a CAP) score
    les DERNIERES MAX_WIN de parole -> emet `evt.speaker {locuteur, score, mark, captured_at, speech_ms}`.

    Un verdict None (echec/insuffisant) -> N'EMET RIEN (l'aval gere l'absence). Robustesse : un moteur qui
    LEVE est COMPTE (jamais en silence, via SpeakerDetector) ; l'arret est borne (`evt.plug.stuck`, herite) ;
    a une DISCONTINUITE (overrun) la prise re-synchronise (audio rompu). Le buffer de travail est BORNE (les
    dernieres MAX_WIN seulement) : aucune fuite meme sur un VAD fige.

    ECART tracé (§7) : le banc `v8_bargein` gatait la parole par RMS (il testait V6 ISOLE) ; le produit lit le
    segment que **V2 (Silero)** a marque (meilleur gate, patron produit STT). Un segment = une prise VAD
    start->stop (verdict par segment ; le consommateur utilise le dernier)."""

    def __init__(self, ring, emit, detector: SpeakerDetector | None = None):
        super().__init__("speaker", ring, emit, hop_samples=1600)   # hop non utilise (lecture par blocs variables)
        self._rate = int(ring.sample_rate)
        self._det = detector if detector is not None else SpeakerDetector()
        self._cmds: queue.Queue = queue.Queue(maxsize=256)          # commandes VAD (start/stop, pos) — bornee (F-2)
        self._warm_failed = False      # solo conv 46 : chargement moteur/ancre echoue -> visible /debug (parite STT)
        self._warm = False             # V15 (croise conv 60, ROB-M2) : le warm a REUSSI (moteur + ancre charges) —
        #                                parite SttPlug._warm conv 47. Sans ce temoin, l'ack cmd.enroll.push disait
        #                                « monte » PENDANT le chargement (~1-2 s a chaque boot), y compris quand le
        #                                warm allait ECHOUER (reproduit) : trois etats reels projetes sur deux. Le
        #                                serveur repond desormais « warming » entre start() et l'issue du warm.
        self._tick_errors = 0          # croisé conv 46 : une exception INATTENDUE dans _tick est comptee (jamais muette)
        # etat de segment (touche UNIQUEMENT par le worker, sauf _cmds)
        self._active = False           # un segment de parole est en cours
        self._reading = False          # in_speech -> lit jusqu'au present ; sinon borne a _seg_stop
        self._mark: int | None = None  # position ring du DEBUT du segment (la marque de evt.speaker)
        self._seg_stop: int | None = None
        self._speech = np.zeros(0, dtype=np.float32)               # buffer BORNE : les dernieres MAX_WIN de parole
        self._accum_s = 0.0            # parole accumulee (s) DEPUIS le debut du segment (compteur, borne les evals)
        self._last_eval_s = 0.0        # accum au dernier score (cadence EVAL_EVERY)
        self._evals_seg = 0            # nb de scores DANS ce segment
        # observabilite / debug
        self._segments = 0
        self._evals = 0                # nb total de scores (points de trajectoire)
        self._emits = 0                # nb d'evt.speaker emis (verdicts non-None)
        self._overruns = 0
        self._dropped_cmds = 0
        self._last_emit: dict | None = None

    def warm(self) -> None:
        """Pre-charge le moteur + le centroide. LEVE si absent -> l'appelant degrade honnetement (V6 inerte)."""
        self._det.warm()

    # ── entree des marques VAD (thread de la prise VAD, via l'emit wrappe) : POSTE, ne bloque jamais ──────
    def on_vad(self, mtype: str, payload: dict) -> None:
        """Robuste : un payload malforme ne leve JAMAIS (parite STT `on_vad` / `_safe_emit`). Seuls
        evt.vad.start/stop portent une marque. File BORNEE (F-2) : si le worker ne draine plus (moteur mort),
        drop-oldest au lieu de fuir sans fin (le VAD, lui, continue)."""
        if mtype not in ("evt.vad.start", "evt.vad.stop"):
            return
        try:
            pos = int(payload["pos"])
        except (KeyError, TypeError, ValueError):
            return
        cmd = ("start" if mtype == "evt.vad.start" else "stop", pos)
        try:
            self._cmds.put_nowait(cmd)
        except queue.Full:
            try:
                self._cmds.get_nowait()       # drop-oldest : borne la file (un worker mort ne la videra jamais)
                self._dropped_cmds += 1
            except queue.Empty:
                pass
            try:
                self._cmds.put_nowait(cmd)
            except queue.Full:
                self._dropped_cmds += 1

    def _drain_cmds(self) -> None:
        while True:
            try:
                cmd, pos = self._cmds.get_nowait()
            except queue.Empty:
                break
            if cmd == "start":
                if not self._active:
                    self._open_segment(pos)                # nouveau segment -> rembobine a la marque
                else:
                    self._reading = True                   # reprise (meme segment) : on continue a lire en continu
                    self._seg_stop = None
            else:  # stop
                self._seg_stop = pos                       # borne de lecture du segment courant
                self._reading = False

    def _open_segment(self, pos: int) -> None:
        self._active = True
        self._reading = True
        self._seg_stop = None
        self._cursor.seek_to(pos)                          # rembobinage a la marque VAD (curseur independant, SPMC), clamp [oldest, write_pos]
        # croisé conv 46 (NIT-2) : la marque = OU le scoring COMMENCE reellement (la position CLAMPEE), pas le
        # `pos` brut. Injoignable en pratique (file bornee + worker prompt), mais si `pos` avait scrolle hors du
        # ring 30 s, `_mark=pos` aurait pointe un audio absent (evt.speaker.mark/captured_at perimes). Honnete + gratuit.
        self._mark = self._cursor.position
        self._speech = np.zeros(0, dtype=np.float32)
        self._accum_s = 0.0
        self._last_eval_s = 0.0
        self._evals_seg = 0
        self._segments += 1

    def _loop(self) -> None:
        # Charge le moteur + le centroide (bloquant ~1 s) DANS ce thread -> ne bloque PAS le serveur. Un echec
        # (modele/ancre absent) degrade HONNETEMENT (V6 inerte, comme le sidecar sans micro), jamais un worker
        # mort en silence : on SORT (le detecteur a compte l'erreur au warm si applicable).
        try:
            self._det.warm()
            # Repartir PROPRE apres le chargement : jeter les marques accumulees pendant le warm + curseur au
            # present (sinon on traiterait un backlog de segments perimes). SOUS LA MEME GARDE (re-croisé conv 46) :
            # ces 2 ops ne peuvent pas lever aujourd'hui, mais l'esprit de la garde _tick (NIT-1) = ZERO mort
            # silencieuse dans _loop -> tout le setup est protege (parite STT, un cran plus defensif).
            self._discard_cmds()
            self._cursor.seek_latest()
            self._warm = True              # V15 (ROB-M2) : temoin « warm REUSSI » (parite SttPlug._warm) — l'ack
            #                                enroll ne dit « monte » qu'a partir d'ICI (avant : « warming », honnete)
        except Exception:
            self._warm_failed = True       # visible /debug (parite STT : un chargement/setup KO n'est jamais silencieux)
            return
        while not self._stop.is_set():
            try:
                progressed = self._tick()
            except Exception:                              # croisé conv 46 (NIT-1, defense en profondeur, base ConsumerPlug) :
                self._tick_errors += 1                     #   _tick est prouve sans-lever aujourd'hui, mais V6 y ajoute du
                self._close_segment()                      #   code -> une future op non-gardee tuerait le worker EN SILENCE
                self._stop.wait(0.01)                      #   (surdite muette, la pire panne). On COMPTE + repart PROPRE.
                continue
            if not progressed:
                self._stop.wait(0.01)                      # rien a faire -> courte attente (pas de busy-loop)

    def _discard_cmds(self) -> None:
        while True:
            try:
                self._cmds.get_nowait()
            except queue.Empty:
                break

    def _tick(self) -> bool:
        """UNE iteration : draine les marques VAD, lit l'audio du segment (borne, R-2), score aux points de la
        trajectoire. SEPARE de _loop -> testable DETERMINISTE sans thread ni wall-clock (positions ring seules,
        parite VadPlug.process / SttPlug._tick)."""
        self._drain_cmds()
        if not self._active:
            return False
        limit = self._ring.write_pos() if self._reading or self._seg_stop is None else self._seg_stop
        n = int(limit) - self._cursor.position
        did = False
        if n > 0:
            data, overrun = self._cursor.read(n)           # R-2 : l'overrun est VERIFIE a chaque read
            if overrun:
                self._on_overrun()
                return True
            if data.size:
                f = data.astype(np.float32) / 32768.0
                self._accum_s += len(f) / self._rate       # compteur de parole (borne les evals)
                self._speech = np.concatenate([self._speech, f])[-MAX_WIN:]   # buffer BORNE (dernieres MAX_WIN)
                did = True
        # score aux points de la trajectoire du banc : 1er a MIN_SPEECH, puis chaque EVAL_EVERY, plafonne a CAP.
        # Le plafond CAP est garde sur `_last_eval_s <= CAP` (PAS `accum <= CAP`) : solo conv 46 — si `accum`
        # SAUTE au-dela de CAP en une lecture (backlog : worker lent puis gros bloc), on veut QUAND MEME UN
        # verdict (le banc `v8_bargein` evalue PUIS `break` ; ma 1re garde `accum<=CAP` l'aurait supprime).
        if (self._accum_s >= MIN_SPEECH_S and self._last_eval_s <= CAP_S
                and (self._evals_seg == 0 or self._accum_s - self._last_eval_s >= EVAL_EVERY_S)):
            self._do_eval()
            did = True
        # segment fini : on a lu jusqu'a la borne de stop -> clot (le prochain vad.start ouvrira un neuf).
        if (not self._reading and self._seg_stop is not None
                and self._cursor.position >= self._seg_stop):
            self._close_segment()
            return True
        return did

    def _do_eval(self) -> None:
        self._last_eval_s = self._accum_s
        self._evals_seg += 1
        self._evals += 1
        verdict = self._det.evaluate(self._speech)         # score sur les dernieres MAX_WIN de parole
        if verdict is None:
            return                                         # echec/insuffisant -> N'EMET RIEN (l'aval gere l'absence)
        locuteur, score = verdict
        speech_ms = round(self._accum_s * 1000, 1)
        payload = {
            "locuteur": locuteur,
            "score": round(float(score), 3),
            "mark": int(self._mark) if self._mark is not None else None,
            "captured_at": self._ring.time_at(int(self._mark)) if self._mark is not None else None,
            "speech_ms": speech_ms,
        }
        self._emits += 1
        self._last_emit = payload
        self._safe_emit("evt.speaker", payload)

    def _close_segment(self) -> None:
        self._active = False
        self._reading = False
        self._seg_stop = None
        self._speech = np.zeros(0, dtype=np.float32)

    def _on_overrun(self) -> None:
        # R-2 : l'audio a SAUTE (drop-oldest) -> le segment est rompu. On clot (pas de verdict fiable sur un
        # audio troue) ; le prochain vad.start rouvrira proprement. La base a deja emis `evt.plug.overrun`.
        self._overruns += 1
        self._close_segment()

    def _safe_emit(self, etype: str, payload: dict) -> None:
        try:
            self._emit(etype, payload)
        except Exception:
            pass   # un emit qui echoue (bus arrete...) ne tue jamais la boucle de la prise (parite VadPlug/STT)

    @property
    def state(self) -> dict:
        return {
            "active": self._active,
            "warm": self._warm,            # V15 (ROB-M2) : warm reussi — l'ack enroll et /debug lisent l'etat VRAI
            "segments": self._segments,
            "evals": self._evals,
            "emits": self._emits,
            "overruns": self._overruns,
            "dropped_cmds": self._dropped_cmds,
            "engine_errors": self._det.errors,
            "warm_failed": self._warm_failed,
            "tick_errors": self._tick_errors,
            "threshold": self._det.threshold,
            "last_score": self._det.last_score,
            "last_locuteur": self._det.last_locuteur,
            "last_emit": dict(self._last_emit) if self._last_emit else None,
        }
