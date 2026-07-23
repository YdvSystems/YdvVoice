"""Sophia — sidecar / le CAPTEUR/VERROU D'AFFECT (plan 01, V14 · 01-H · A16/A17 amont).

« Lire l'etat affectif de Yohann dans SA voix — jamais une etiquette, jamais un tiers, muet dans le
doute. » V14 est un observateur du vocabulaire `evt.*` (patron V3/V13 — les prises verrouillees ne sont
PAS touchees) + un lecteur du ring POST-AEC (curseur independant, patron 01-F) : a CHAQUE `evt.turn.end`
(un tour de CONVERSATION fini, V5), il relit l'audio du tour ecoule et emet `evt.affect {valence,
energie, confiance}` ATTACHE au tour (meme `mark` que `evt.stt.final`/`evt.turn.end`).

LES REGLES GRAVEES (technique/01 §2.4), tenues A LA SOURCE :
  - SIGNAL DOUX : dimensions continues (valence, energie) + confiance. JAMAIS d'etiquette categorielle
    (« COLERE 73 % » interdit) — le payload ne contient QUE des nombres. Les seuils et l'USAGE (colorer
    humeur/lien) = doc `03` ; ici le capteur seul.
  - VERROUILLE SUR L'ANCRE VOCALE (A29/V6) : n'evalue que si le locuteur du tour est YOHANN. Le verrou
    (`AffectLock`) apparie les verdicts `evt.speaker` (par segment VAD, cadence banc v8) a la fenetre du
    tour : par SEGMENT, le DERNIER verdict fait foi (le plus informe — la trajectoire du banc converge a
    CAP 3 s = le point EER 0 %) ; un segment dont le dernier verdict est « inconnu » FERME le tour (un
    tiers a pu parler) ; AUCUN verdict (tour < 0,75 s de parole, V6 muet/absent) = FERME (pas de preuve =
    pas de lecture). Vaut aussi en tablee (plan/04 Q7, back-ref FC-9) : seul « yohann » ouvre.
  - MUET DANS LE DOUTE : verrou ferme, tour trop court (< AFFECT_MIN_S), overrun (audio troue, R-2),
    fenetre AMPUTEE (le `truncated` du seek est LU — garde d'honnetete V3), moteur qui LEVE, sortie non
    finie (NaN/inf), confiance basse -> RIEN n'est emis (l'aval gere l'absence ; un echec n'est JAMAIS
    un faux verdict — parite gardes honnetes V6).
  - UNE PREUVE FERMANTE N'EST JAMAIS JETABLE (croise conv 59, M1/M2 — le fix racine unifie) : les
    verdicts ne transitent PAS par une file bornee (drop-oldest aurait pu jeter un « inconnu » en
    gardant le « yohann » -> faux OUVERT) — ils sont appliques au VERROU a l'ARRIVEE (thread-safe) ;
    l'eviction de la borne du verrou pose un PLANCHER DE PREUVE PERDUE -> toute decision dont la
    fenetre le chevauche est FERMEE (`evidence_lost`) ; la file (turn.end SEULS, bornee 8) peut perdre
    un DECLENCHEUR (un affect perdu, compte) mais jamais une preuve. + GRACE DE DECISION (0,5 s) : un
    turn.end attend que les verdicts en vol d'un worker V6 a la traine atterrissent (m3).
  - UNE evaluation par tour, a `evt.turn.end` — pas d'analyse continue. Dans le produit, `turn.end`
    n'existe qu'en CONVERSATION (`_armed_at_open`, V5) -> pas d'affect sur l'ouvreur d'eveil ni en
    veille (fidele a l'esprit « attache au tour », trace §7).
  - OFF PAR DEFAUT : monte par `SOPHIA_AFFECT=1` (server.py) — rien ne consomme `evt.affect` avant le
    doc `03` ; `evt.*` est extensible (l'activation ne change pas le protocole).

MOTEUR (banc conv 59, decision tracee §7) : **audEERING w2v2-L-robust-12-ft-emotion-msp-dim, export ONNX
OFFICIEL** (zenodo 10.5281/zenodo.6221127 ; sha256 au MANIFEST) — sortie NATIVE [arousal, dominance,
valence] continue ~[0,1] = le signal doux gravé, SANS mapping invente. Fidelite PROUVEE au banc contre la
reference publiee (zeros 1 s -> [0.5461, 0.6062, 0.4043], max|diff| = 1e-5) ; la normalisation est DANS le
graphe (brut == normalise, diff 0,0 mesure) -> l'entree = le signal brut float32 16 kHz. ZERO dependance
nouvelle (onnxruntime 1.27.0 deja present ; patron Smart Turn V5). `emotion2vec` (le defaut nomme au
gravé) ECARTE SUR PIECES : sortie CATEGORIELLE 9 classes (le signal continu exigerait un mapping invente
— contre « zero chiffre invente ») + deps funasr/modelscope (le mur V5) + licence floue — patron « AEC3
non retenu » conv 23. Licence du retenu : CC-BY-NC-SA 4.0 -> usage PERSO non commercial OK (precedent A8
openWakeWord) ; a revoir si commercialisation. Modele en anglais (MSP-Podcast) : les dimensions
prosodiques transferent, et le gravé impose de toute facon la LIGNE DE BASE PERSONNELLE de Yohann (jamais
un bareme generique seul) — collectee au juge, seuils §6.

CONFIANCE (concue au banc conv 59 — MESUREE, jamais inventee) : l'AUTO-COHERENCE de deux lectures de la
meme fin de tour (fenetre entiere vs sa derniere moitie). Deux lectures qui divergent = lecture instable
(les fenetres courtes divergent, mesure : raw_soft 2 s -> A 0,62 vs 8 s -> 0,32) -> confiance basse ->
muet. `conf = max(0, 1 - 2*max|adv_full - adv_half|)` ; sur sa voix neutre a 8 s : mediane 0,86, p75 0,77
-> seuil d'emission defaut 0,70 (conservateur, `SOPHIA_AFFECT_CONF_MIN`, calibration §6).

COUT (banc conv 59, i5-9600KF) : chargement 0,93 s (LAZY, dans le worker — jamais le boot) · warmup 83 ms ·
RAM ~800 Mo (paye seulement si active) · couple d'evals 8 s + 4 s ~1,4 s a intra_op=2 (defaut BORNE : ne
rafle jamais les 6 coeurs pendant le TTFT cerveau + la synthese Piper — lecon contention `murmure` conv 56 ;
`SOPHIA_AFFECT_THREADS`, patron `SOPHIA_TURN_THREADS`). L'eval tourne en FOND (worker dedie) : personne ne
l'attend, le chemin critique de la voix n'est pas touche (⛔ perf produit >= banc — jitter=0 prouve a l'E2E).

Import onnxruntime PARESSEUX (module importable sans lui, parite turn.py/speaker.py).
"""
from __future__ import annotations

import math
import os
import queue
import threading
import time

import numpy as np

from plugs.base import ConsumerPlug

RATE = 16000


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


# ── Constantes du banc conv 59 (mesurees sur SES clips — voir docstring) ─────────────────────────────
AFFECT_WIN_S = 8.0       # fenetre d'analyse = les 8 dernieres s de l'EMPAN du tour (micro-pauses comprises —
#                          meme semantique que `parle`/V5 ; parite _turn_win. Banc : fenetres courtes instables)
AFFECT_MIN_S = 2.0       # sous 2 s d'empan, pas de lecture fiable (banc : 2-4 s divergent) -> muet
AFFECT_CONF_MIN = _envf("SOPHIA_AFFECT_CONF_MIN", 0.70)   # seuil d'emission (§6 ; banc : mediane 0,86 a 8 s)
AFFECT_DECIDE_GRACE_S = 0.5   # croise conv 59 (m3) : grace AVANT la decision d'un tour — les verdicts en vol
#                               d'un worker V6 a la traine (ECAPA sous contention) atterrissent au verrou avant
#                               que le tour ne soit juge. Personne n'attend l'affect (fond) -> gratuite.
AFFECT_WIN = int(AFFECT_WIN_S * RATE)

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # sidecar/consumers -> racine
_MODEL_DIR = os.path.join(_ROOT, "resources", "models", "affect")


# ══════════ Logique PURE (testable sans ONNX ni audio — parite turn.py) ══════════

def confidence(adv_full: np.ndarray, adv_half: np.ndarray) -> float:
    """L'auto-coherence MESUREE (banc conv 59) : la meme fin de tour lue sur la fenetre entiere et sur sa
    derniere moitie. Divergence = lecture instable -> confiance basse (le « muet dans le doute » du gravé
    a un chiffre honnete : mesure, pas invente). 1 - 2*max|diff|, clampe [0,1]."""
    d = float(np.max(np.abs(np.asarray(adv_full, dtype=np.float64) - np.asarray(adv_half, dtype=np.float64))))
    return max(0.0, min(1.0, 1.0 - 2.0 * d))


class AffectLock:
    """Le VERROU locuteur (A29) au niveau du TOUR — logique pure sur positions ring, THREAD-SAFE (croise
    conv 59, M1 : les verdicts sont appliques a l'ARRIVEE depuis le thread du worker V6, la decision vient
    du worker affect -> etat sous lock, patron WakeGate/FallbackGuard).

    Recoit les verdicts `evt.speaker {mark, locuteur}` (par segment VAD ; la trajectoire du banc emet
    PLUSIEURS verdicts par segment, du 1er a 0,75 s au CAP 3 s) et decide, a `evt.turn.end {mark,
    speech_ms}`, si l'affect PEUT lire ce tour :
      - par SEGMENT (une `mark`), le DERNIER verdict fait foi (le plus informe — c'est au CAP que le banc
        prouve l'EER 0 % ; un « inconnu » precoce sur 0,75 s de parole est rattrape par le verdict mur) ;
      - fenetre du tour = [mark_tour, mark_tour + speech_ms] (les segments du tour y tombent : le 1er
        partage la marque du groupe STT — meme evt.vad.start — les suivants sont les micro-pauses) ;
      - OUVERT ssi >= 1 segment « yohann » ET AUCUN segment « inconnu » dans la fenetre (regle STRICTE :
        un tiers qui parle dans le tour ferme tout) ; AUCUN verdict -> FERME (pas de preuve = pas de
        lecture — tour court, V6 muet ou absent).
    Les verdicts consommes (mark <= fin du tour decide) sont purges ; la memoire est BORNEE (_MAX_VERDICTS
    = 512 : ~25+ min d'un MEME tour avant d'evincer — au-dela de tout monologue reel).

    UNE PREUVE EVINCEE N'EST JAMAIS OUBLIEE (croise conv 59, M2 — reproduit : 127 verdicts recents
    evincaient l'« inconnu » precoce d'un monologue -> faux OUVERT) : l'eviction pose un PLANCHER
    (`_evicted_up_to` = la plus haute marque evincee) ; toute decision dont la fenetre CHEVAUCHE le
    plancher (turn_mark <= plancher) est FERMEE (`evidence_lost` compte) — « preuve perdue » degrade en
    MUET, jamais en « pas de preuve vue »."""

    _MAX_VERDICTS = 512

    def __init__(self):
        self._lock = threading.Lock()
        self._verdicts: dict[int, str] = {}   # mark segment -> DERNIER locuteur vu
        self._evicted_up_to: int | None = None   # M2 : plus haute marque EVINCEE (preuve perdue) ; None = aucune
        #                                          (re-croise NIT-1 : une sentinelle -1 aurait fait MENTIR
        #                                          `evidence_lost` sur un turn_mark negatif — jamais un compteur menteur)
        self._evidence_lost = 0               # decisions FERMEES pour preuve perdue (jamais en silence)

    def add_verdict(self, mark: int, locuteur: str) -> None:
        with self._lock:
            self._verdicts[int(mark)] = str(locuteur)
            if len(self._verdicts) > self._MAX_VERDICTS:
                for k in sorted(self._verdicts)[: len(self._verdicts) - self._MAX_VERDICTS]:
                    self._evicted_up_to = k if self._evicted_up_to is None else max(self._evicted_up_to, k)
                    del self._verdicts[k]     # borne : on garde les plus RECENTS (marks croissants) ; la preuve
                    #                           perdue laisse un PLANCHER (M2)

    def decide(self, turn_mark: int, end_pos: int) -> bool:
        """True = le verrou S'OUVRE pour ce tour. Consomme (purge) tous les verdicts jusqu'a `end_pos`.
        FERME si la fenetre chevauche le plancher d'eviction (une preuve du tour a PU etre jetee — M2)."""
        with self._lock:
            in_window = [l for m, l in self._verdicts.items() if turn_mark <= m <= end_pos]
            for m in [m for m in self._verdicts if m <= end_pos]:
                del self._verdicts[m]         # consommes (ou anterieurs au tour) : jamais reutilises
            if self._evicted_up_to is not None and turn_mark <= self._evicted_up_to:
                self._evidence_lost += 1      # une preuve de CETTE fenetre a pu etre evincee -> muet honnete
                return False
            if not in_window:
                return False                  # pas de preuve = pas de lecture (muet honnete)
            return all(l == "yohann" for l in in_window)

    @property
    def pending(self) -> int:
        with self._lock:
            return len(self._verdicts)

    @property
    def evidence_lost(self) -> int:
        with self._lock:
            return self._evidence_lost


# ══════════ Moteur affect injectable ══════════

class AffectEngine:
    """Contrat moteur affect (injectable). `evaluate(audio_f32) -> np.ndarray [arousal, dominance, valence]`
    (continues ~[0,1]). `warm()` pre-charge. prod = `W2v2DimEngine` (ONNX vendorise) ; test = scripte."""

    def evaluate(self, audio: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def warm(self) -> None:
        pass


class W2v2DimEngine(AffectEngine):
    """audEERING w2v2-L-robust-12 emotion-msp-dim (ONNX officiel zenodo, vendorise
    `resources/models/affect/model.onnx` — OFFLINE, jamais de reseau au runtime, plan 05). Sortie `logits`
    = [arousal, dominance, valence]. Entree = signal BRUT float32 16 kHz (la normalisation est DANS le
    graphe — prouve au banc conv 59 : brut == normalise, diff 0,0 ; la reference publiee reproduite a
    1e-5). Threads BORNES par defaut a intra_op=2 (contention : l'eval tombe pendant le TTFT cerveau + la
    synthese Piper — on laisse 4 coeurs libres ; `SOPHIA_AFFECT_THREADS`, 0 = defaut onnxruntime).
    Import onnxruntime PARESSEUX."""

    def __init__(self, model_path: str | None = None, threads: int | None = None):
        self._model_path = model_path or os.path.join(_MODEL_DIR, "model.onnx")
        # n7 (croise conv 59, patron N-5 conv 56) : une variable BLANCHE (" ") = NON-REGLEE -> defaut borne 2
        # (int("" or 0)=0 aurait silencieusement desarme la borne anti-contention -> TOUS les coeurs pendant
        # le TTFT cerveau + la synthese Piper). "0" EXPLICITE reste « defaut onnxruntime » (documente).
        raw = os.environ.get("SOPHIA_AFFECT_THREADS")
        if raw is None or raw.strip() == "":
            env_threads = 2
        else:
            try:
                env_threads = int(raw)
            except (TypeError, ValueError):
                env_threads = 2                # valeur mal formee -> defaut borne (jamais un crash au spawn)
        self._threads = threads if threads is not None else env_threads
        self._sess = None

    def warm(self) -> None:
        """Charge l'ONNX puis une inference JETABLE (compile les noyaux -> le 1er vrai tour ne paie pas
        l'init ; banc : chargement 0,93 s + warmup 83 ms). Sentinel `_sess` pose EN DERNIER (patron
        SmartTurnEngine S-7 : un echec laisse _sess=None -> retry propre, jamais un etat mi-charge).
        LEVE si le modele est absent -> l'appelant degrade honnetement (V14 inerte, jamais un crash)."""
        if self._sess is not None:
            return
        import onnxruntime
        so = onnxruntime.SessionOptions()
        if self._threads:
            so.intra_op_num_threads = int(self._threads)
            so.inter_op_num_threads = 1
        sess = onnxruntime.InferenceSession(self._model_path, so, providers=["CPUExecutionProvider"])
        self._sess = sess                      # sentinel EN DERNIER
        try:
            self.evaluate(np.zeros(RATE, dtype=np.float32))   # warmup (1 s) — re-entre warm -> early-return
        except Exception:
            pass

    def evaluate(self, audio: np.ndarray) -> np.ndarray:
        """[arousal, dominance, valence] pour l'audio 16 kHz (brut — voir docstring)."""
        self.warm()
        x = np.ascontiguousarray(audio, dtype=np.float32)[None, :]
        out = self._sess.run(["logits"], {"signal": x})[0]
        return np.asarray(out, dtype=np.float32).reshape(-1)


# ══════════ Le detecteur (moteur + gardes honnetes — parite SpeakerDetector/TurnDetector) ══════════

class AffectDetector:
    """Assemble le moteur (injectable) et les gardes. `evaluate_turn(audio) -> dict | None`.

    GARDES HONNETES (le « muet dans le doute » du gravé, tenu par le code) — un echec/doute n'est JAMAIS
    un faux verdict, il ne retourne RIEN :
      - audio < AFFECT_MIN_S            -> None (`too_short`) — les fenetres courtes divergent (banc) ;
      - le moteur LEVE (ONNX absent/KO) -> None + `errors` (jamais un crash ; le tour continue) ;
      - sortie non finie (NaN/inf)      -> None + `errors` (contrat garde a la frontiere injectable) ;
      - auto-coherence < CONF_MIN       -> None + `low_conf` (lecture instable — mesure, pas invente).
    Le dict rendu = le PAYLOAD gravé (nombres seuls) : {valence, energie, confiance} + `_adv` interne
    (arousal/dominance/valence bruts, pour /debug — la dominance n'est PAS emise : hors gravé)."""

    def __init__(self, engine: AffectEngine | None = None, conf_min: float | None = None,
                 min_s: float = AFFECT_MIN_S, win_samples: int = AFFECT_WIN):
        self._engine = engine if engine is not None else W2v2DimEngine()
        self._conf_min = float(conf_min) if conf_min is not None else AFFECT_CONF_MIN
        self._min_samples = int(float(min_s) * RATE)
        self._win = int(win_samples)
        self._errors = 0
        self._too_short = 0
        self._low_conf = 0
        self._last_adv: list | None = None
        self._last_conf: float | None = None

    def warm(self) -> None:
        self._engine.warm()

    def evaluate_turn(self, audio: np.ndarray):
        """dict {valence, energie, confiance} ou None (muet). Voir GARDES HONNETES ci-dessus."""
        if audio is None or len(audio) < self._min_samples:
            self._too_short += 1
            return None
        win = np.ascontiguousarray(audio[-self._win:], dtype=np.float32)
        try:
            adv_full = np.asarray(self._engine.evaluate(win), dtype=np.float64).reshape(-1)
            adv_half = np.asarray(self._engine.evaluate(win[-(len(win) // 2):]), dtype=np.float64).reshape(-1)
        except Exception:
            self._errors += 1                  # moteur KO -> PAS un verdict (jamais un crash)
            return None
        if (adv_full.shape != (3,) or adv_half.shape != (3,)
                or not np.all(np.isfinite(adv_full)) or not np.all(np.isfinite(adv_half))):
            self._errors += 1                  # contrat a la frontiere injectable (forme/NaN/inf)
            return None
        conf = confidence(adv_full, adv_half)
        self._last_adv = [round(float(v), 3) for v in adv_full]   # /debug (dominance visible ICI seulement)
        self._last_conf = round(conf, 3)
        if conf < self._conf_min:
            self._low_conf += 1                # lecture instable -> muet (compte, jamais avale)
            return None
        return {
            "valence": round(float(adv_full[2]), 3),
            "energie": round(float(adv_full[0]), 3),    # energie = arousal (le vocabulaire du gravé)
            "confiance": round(conf, 3),
        }

    @property
    def errors(self) -> int:
        return self._errors

    @property
    def too_short(self) -> int:
        return self._too_short

    @property
    def low_conf(self) -> int:
        return self._low_conf

    @property
    def last_adv(self) -> list | None:
        return self._last_adv

    @property
    def last_conf(self) -> float | None:
        return self._last_conf

    @property
    def conf_min(self) -> float:
        return self._conf_min


# ══════════ La prise affect (observateur d'evt.* + lecteur du ring — worker dedie) ══════════

class AffectPlug(ConsumerPlug):
    """Prise affect (V14). Un WORKER UNIQUE (le thread de la prise) traite les evenements observes
    (`on_event`, file thread-safe BORNEE, patron F-2) : les verdicts `evt.speaker` nourrissent le VERROU
    (`AffectLock`) ; un `evt.turn.end` declenche LA decision — verrou ouvert -> relire l'audio du tour au
    ring (curseur independant, `seek_to` borne a la fenetre, **R-2 overrun verifie -> muet**) -> moteur
    (couple d'evals ~1,4 s, EN FOND — personne ne l'attend) -> `evt.affect` OU silence (gardes honnetes).

    Le worker charge le moteur PARESSEUSEMENT (~0,9 s + ~800 Mo RAM — payes seulement si la prise est
    montee, `SOPHIA_AFFECT=1`) ; un echec de chargement -> `warm_failed` visible /debug, prise INERTE
    (jamais un crash — parite SpeakerPlug). Pendant une eval, la file accumule (bornee, drop-oldest) : un
    turn.end perdu = un affect perdu, jamais une fuite ni un blocage (l'affect est best-effort par design).

    EDGES traces (§7) : `speech_ms` absent du turn.end (tour sans `_seg_stop`) -> pas de fenetre -> muet
    (`no_span`) · les verdicts « inconnu » du residu post-AEC pendant `arm` (sa voix a elle) tombent dans
    la fenetre d'un tour RETROACTIF post-barge -> verrou ferme -> muet (conservateur, jamais faux)."""

    def __init__(self, ring, emit, detector: AffectDetector | None = None,
                 decide_grace_s: float | None = None, now=None):
        super().__init__("affect", ring, emit, hop_samples=1600)   # hop non utilise (lecture par fenetres)
        self._rate = int(ring.sample_rate)
        self._det = detector if detector is not None else AffectDetector()
        self._lock = AffectLock()
        # M1 (croise conv 59) : la file ne porte QUE les turn.end (les DECLENCHEURS — rares, 1/tour) ; les
        # verdicts (les PREUVES) vont DIRECTEMENT au verrou a l'arrivee (thread-safe) -> un drop ne peut
        # perdre qu'un affect (compte), JAMAIS une preuve fermante. Borne 8 = plusieurs tours d'avance.
        self._turns: queue.Queue = queue.Queue(maxsize=8)
        self._grace = AFFECT_DECIDE_GRACE_S if decide_grace_s is None else float(decide_grace_s)
        self._now = now if now is not None else time.monotonic     # horloge injectable (tests deterministes)
        self._pending_turns: list[tuple[int, object, float]] = []  # (mark, speech_ms, ready_t) — grace m3
        self._warm_failed = False
        self._tick_errors = 0
        # observabilite (jamais d'echec avale — standard maison)
        self._turns_seen = 0
        self._lock_denied = 0
        self._no_span = 0
        self._overruns = 0
        self._window_truncated = 0    # m4 : fenetres AMPUTEES (truncated du seek) -> muet, jamais en silence
        self._dropped_turns = 0
        self._emits = 0
        self._last_emit: dict | None = None

    def warm(self) -> None:
        """Pre-charge le moteur. LEVE si absent -> l'appelant degrade honnetement (V14 inerte)."""
        self._det.warm()

    # ── entree des evenements (threads des prises STT/speaker, via l'emit wrappe) : jamais bloquant ──────
    def on_event(self, mtype: str, payload: dict) -> None:
        """Observe `evt.speaker` (verdicts -> VERROU, appliques A L'ARRIVEE — M1 : une preuve fermante
        n'attend jamais dans une file jetable) + `evt.turn.end` (declencheurs -> file bornee : un drop =
        un affect perdu, compte, jamais une preuve). Robuste : un payload malforme ne leve JAMAIS
        (parite WakeGate.observe / FallbackGuard.on_event)."""
        if mtype == "evt.speaker":
            mark = self._int_of(payload, "mark")
            locuteur = payload.get("locuteur") if isinstance(payload, dict) else None
            if mark is None or not isinstance(locuteur, str):
                return
            self._lock.add_verdict(mark, locuteur)   # M1 : direct au verrou (thread-safe), jamais droppable
            return
        if mtype != "evt.turn.end":
            return
        mark = self._int_of(payload, "mark")
        if mark is None:
            return
        speech_ms = payload.get("speech_ms") if isinstance(payload, dict) else None
        if isinstance(speech_ms, bool):
            speech_ms = None              # n6 : bool n'est pas une duree (parite _int_of) -> traite absent
        try:
            self._turns.put_nowait((mark, speech_ms))
        except queue.Full:
            try:
                self._turns.get_nowait()  # drop-oldest : le plus VIEUX declencheur saute (un affect perdu)
                self._dropped_turns += 1
            except queue.Empty:
                pass
            try:
                self._turns.put_nowait((mark, speech_ms))
            except queue.Full:
                self._dropped_turns += 1

    @staticmethod
    def _int_of(payload, key: str) -> int | None:
        try:
            v = payload[key]
            if isinstance(v, bool):
                return None
            return int(v)
        except (KeyError, TypeError, ValueError):
            return None

    def _loop(self) -> None:
        # Charge le moteur (bloquant ~0,9 s) DANS ce thread -> ne bloque ni le serveur ni les autres prises.
        # TOUT le setup sous la garde (lecon re-croise conv 46 : ZERO mort silencieuse dans _loop).
        try:
            self._det.warm()
        except Exception:
            self._warm_failed = True           # visible /debug — V14 inerte, jamais un crash (parite V6)
            return
        while not self._stop.is_set():
            try:
                progressed = self._tick()
            except Exception:                  # defense en profondeur (garde _tick, patron V6 NIT-1) : une
                self._tick_errors += 1         #   future op non gardee ne tue JAMAIS le worker en silence
                self._stop.wait(0.01)
                continue
            if not progressed:
                self._stop.wait(0.01)          # rien a faire -> courte attente (pas de busy-loop)

    def _tick(self) -> bool:
        """UNE iteration : draine les turn.end vers les DECISIONS EN ATTENTE (grace m3 : chaque tour attend
        `_grace` s que les verdicts en vol d'un worker V6 a la traine atterrissent au verrou), puis juge
        ceux dont la grace est ecoulee. SEPARE de _loop -> testable DETERMINISTE sans thread (horloge
        injectable ; parite SpeakerPlug._tick)."""
        did = False
        while True:
            try:
                mark, speech_ms = self._turns.get_nowait()
            except queue.Empty:
                break
            did = True
            self._pending_turns.append((mark, speech_ms, self._now() + self._grace))
            if len(self._pending_turns) > 64:      # re-croise NIT-4 : borne EXPLICITE (« aucun etat non borne »).
                self._pending_turns.pop(0)         #   En pratique auto-limite (debit turn.end >= ~1-2 s, mesure) ;
                self._dropped_turns += 1           #   un drop = un affect perdu, compte — jamais une preuve.
        while self._pending_turns and self._pending_turns[0][2] <= self._now():
            mark, speech_ms, _ready = self._pending_turns.pop(0)
            self._on_turn_end(mark, speech_ms)
            did = True
        return did

    def _on_turn_end(self, turn_mark: int, speech_ms) -> None:
        """LA decision du tour : verrou -> fenetre -> lecture ring (R-2) -> moteur -> emission ou silence."""
        self._turns_seen += 1
        try:
            ms = float(speech_ms)
            if not math.isfinite(ms) or ms <= 0:
                raise ValueError
        except (TypeError, ValueError):
            self._no_span += 1                 # pas de duree de parole -> pas de fenetre -> muet (trace §7)
            return
        end_pos = int(turn_mark) + int(ms * self._rate / 1000.0)
        if not self._lock.decide(int(turn_mark), end_pos):
            self._lock_denied += 1             # verrou ferme (tiers/inconnu/aucune preuve/preuve perdue) -> muet
            return
        start = max(int(turn_mark), end_pos - AFFECT_WIN)
        truncated = self._cursor.seek_to(start)   # curseur independant (SPMC) ; clamp [oldest, write_pos]
        if truncated:
            # m4 (croise conv 59, reproduit) : la fenetre a PARTIELLEMENT quitte le ring (worker tres en
            # retard) -> le seek clampe a oldest et on lirait un audio AMPUTE en l'emettant comme entier.
            # La garde d'honnetete V3 est LUE : fenetre amputee = muet + compte (jamais en silence).
            self._window_truncated += 1
            return
        n = end_pos - self._cursor.position
        if n <= 0:
            self._no_span += 1                 # fenetre hors ring / dans le futur -> muet honnete
            return
        data, overrun = self._cursor.read(n)   # R-2 : l'overrun est VERIFIE au read
        if overrun:
            self._overruns += 1                # audio troue (l'ecrivain a double le curseur) -> muet
            return
        if not data.size:
            self._no_span += 1                 # n5 : rien a lire SANS trou (speech_ms au-dela du present) -> muet
            return
        audio = data.astype(np.float32) / 32768.0
        verdict = self._det.evaluate_turn(audio)   # gardes honnetes (too_short/erreur/NaN/low_conf -> None)
        if verdict is None:
            return
        payload = {
            **verdict,                         # valence, energie, confiance (nombres seuls — jamais d'etiquette)
            "mark": int(turn_mark),
            "captured_at": self._ring.time_at(int(turn_mark)),
            "speech_ms": round(ms, 1),
        }
        self._emits += 1
        self._last_emit = payload
        self._safe_emit("evt.affect", payload)

    def _safe_emit(self, etype: str, payload: dict) -> None:
        try:
            self._emit(etype, payload)
        except Exception:
            pass   # un emit qui echoue (bus arrete...) ne tue jamais la boucle (parite VadPlug/STT/V6)

    def stop(self) -> None:
        """Arret (T6) — SOLO-1 conv 59 : join COURT (0,3 s, pas le 1 s de la base). Une eval ONNX en vol dure
        ~1,4 s et ne tient NI le micro NI CUDA — l'attendre eroderait le budget graceful 2 s qui doit d'abord
        servir la capture/CUDA (la classe ROB-M5 conv 58). Thread daemon (le SIGKILL T6 couvre) ; un worker
        encore vivant est SIGNALE (`evt.plug.stuck`) et `_thread` reste non-None -> jamais un 2e worker sur le
        MEME curseur (parite base R#9)."""
        self._stop.set()
        t = self._thread
        if t is not None:
            t.join(timeout=0.3)
            if t.is_alive():
                try:
                    self._emit("evt.plug.stuck", {"plug": self.name})
                except Exception:
                    pass
                return
        self._thread = None

    @property
    def state(self) -> dict:
        return {
            "turns_seen": self._turns_seen,
            "emits": self._emits,
            "lock_denied": self._lock_denied,
            "too_short": self._det.too_short,
            "low_conf": self._det.low_conf,
            "no_span": self._no_span,
            "overruns": self._overruns,
            "window_truncated": self._window_truncated,   # m4 : fenetres amputees -> muettes
            "dropped_turns": self._dropped_turns,         # M1 : declencheurs perdus (jamais une preuve)
            "evidence_lost": self._lock.evidence_lost,    # M2 : decisions fermees pour preuve evincee
            "pending_decisions": len(self._pending_turns),  # m3 : tours en grace de decision
            "engine_errors": self._det.errors,
            "warm_failed": self._warm_failed,
            "tick_errors": self._tick_errors,
            "pending_verdicts": self._lock.pending,
            "conf_min": self._det.conf_min,
            "last_adv": self._det.last_adv,      # [arousal, dominance, valence] bruts — /debug SEUL (la
            #                                      dominance n'est jamais emise : hors gravé)
            "last_conf": self._det.last_conf,
            "last_emit": dict(self._last_emit) if self._last_emit else None,
        }
