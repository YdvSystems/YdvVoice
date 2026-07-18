"""Sophia — sidecar / la FIN DE TOUR FINE (plan 01, V5 · A6).

« Quand Yohann a-t-il VRAIMENT fini de parler ? » Smart Turn v3.2 lit l'INTONATION (la waveform, PAS le
texte) -> vif quand la phrase sonne finie, JAMAIS coupe sur un « euh... » suspendu ou une pause de reflexion
(l'invariant SACRE de Yohann : « qu'elle me laisse parler tant que je veux, meme avec des pauses »). Deux
etages (A6 / technique-01 §4.3) : le VAD Silero (V2) = garde-fou (silence + plafond) ; Smart Turn = le
cerveau (intonation). En V4, le « groupe » se fermait sur un plafond de silence SIMPLE (3,0 s) — grossier.
V5 apporte le VIF : Smart Turn decide, le plafond 3,0 s reste le FALLBACK (et tient meme si Smart Turn crashe).

Le MOTEUR (Smart Turn ONNX) vit DERRIERE une interface INJECTABLE (`TurnEngine`) : prod = `SmartTurnEngine`
(onnxruntime CPU ; preprocessing WhisperFeatureExtractor REPRODUIT avec `torch.stft` + la matrice mel
vendorisee — PROUVE BIT-IDENTIQUE au banc conv 25, design-first conv 45, max|diff proba|=0,0 ; zero dep
`transformers` au runtime) ; test = moteur scripte deterministe. La LOGIQUE DE DECISION (gardes, graces,
hierarchie de plafonds) est PURE (testable sans ONNX ni audio) -> parite avec le portier de `stt.py`.

Reproduit EXACTEMENT `bancs/aec/oreilles_live.py` (l'integration validee A L'OREILLE de Yohann, conv 32-34) —
valeurs ET logique (regle perf : le produit ne doit JAMAIS etre moins performant que le banc). Ce module ne
DECIDE pas la fin de tour tout seul : il FOURNIT (au `SttPlug`, qui possede la machine a etats du groupe = le
tour) le plafond effectif a appliquer, et le `SttPlug` emet `evt.stt.final` PUIS `evt.turn.end` (ordre grave).

Frontiere gravee (plan 01 §4.3) : fin de tour ACOUSTIQUE (Smart Turn = intonation). La garde B (mot suspendu)
lit le committe = le SEUL franchissement acoustique->semantique, valide par Yohann conv 32 (§7). Import
torch/onnxruntime PARESSEUX (module importable sans eux, parite `SileroVadEngine`/`FasterWhisperEngine`).
"""
from __future__ import annotations

import math
import os

import numpy as np

RATE = 16000
WIN = 8 * RATE                       # fenetre Smart Turn = 8 s (banc 07_turn / oreilles_live)


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


# ── Constantes EXACTES du banc `oreilles_live.py` (conv 32-34) — regle perf produit >= banc ──────────────
TURN_THR = _envf("SOPHIA_TURN_THR", 0.5)   # seuil « tour fini » (fosse enorme fins>0,93 / pauses<0,01 ;
#                                            calibrable 0,3-0,7 a TA voix, plan 01 §6)
MIN_SPEECH_END = 1.2       # garde A : Smart Turn ne peut pas FINIR sous ca (au-dessus des vrais tours courts
#                            ~1,5 s, au-dessus des faux positifs sur debuts courts « Mais... » 0,4 s -> 0,70)
HELD_PLAFOND = 0.8         # grace COURTE : un tour court RETENU mais Smart Turn CONFIANT (> HELD_CONF) finit
#                            apres 0,8 s au lieu du plafond 3 s (ne traine pas)
HELD_CONF = 0.85          # confiance au-dessus de laquelle un tour court retenu = vraie fin courte
ENDGRACE = _envf("SOPHIA_ENDGRACE", 0.7)   # grace de FIN (conv 34) : Smart Turn confiant -> NE PAS couper a
#                            l'instant, laisser ENDGRACE s pour enchainer une phrase (~10 coupures evitees en
#                            conversation reelle, +0,7 s invisible apres une longue reflexion). 0 = OFF (fin
#                            immediate). Valide A L'OREILLE de Yohann. Honore l'invariant « laisse-moi parler ».
PLAFOND = 3.0             # plafond FALLBACK (= GROUP_SILENCE_S de stt.py) : silence trop long -> fin forcee.
#                            Tient meme si Smart Turn crashe (degradation douce, plan 01 §4.3).

# Mots qui ne TERMINENT jamais une phrase (garde B, semantique — franchissement valide conv 32, §7). Compares
# au dernier mot committe NORMALISE par `stt._nw` (minuscule, accents OTES) : les entrees accentuees ci-dessous
# (« a », « tres »...) sont donc INERTES sous _nw (« tres »->« tres » != « très ») — FIDELE au banc (meme
# comportement valide) ; les fonctionnels non-accentues (le, la, et, mais, de, que, dans, pour...) mordent.
HANGING = {
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "l",
    "et", "ou", "mais", "donc", "or", "ni", "car", "que", "qu", "si", "comme", "quand",
    "à", "au", "aux", "dans", "sur", "sous", "pour", "par", "avec", "sans", "vers", "chez", "entre",
    "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "votre", "leur",
    "ce", "cet", "cette", "ces", "quel", "quelle", "très", "plus", "moins", "trop", "aussi",
}


# ══════════ Logique de decision PURE (banc oreilles_live._hold_endpoint + hierarchie de plafonds) ══════════

def hold_reason(parle: float, last_word: str) -> str | None:
    """Smart Turn a dit FIN (prob > seuil) — faut-il RETENIR (faux positif) ? Retourne la raison, ou None si on
    laisse finir. (A) parole trop courte (debut de phrase, faux positif ; le transcript V4 pas encore pret) ;
    (B best-effort) le committe se termine sur un mot SUSPENDU (« mais », « le »... — ne peut clore une phrase).
    Le plafond reste le backstop si vraiment fini. `last_word` = deja normalise par le SttPlug (`_nw`)."""
    if parle < MIN_SPEECH_END:                      # (A) garde ACOUSTIQUE
        return "trop court"
    if last_word and last_word in HANGING:          # (B) garde semantique (franchissement valide conv 32)
        return f"mot suspendu « {last_word} »"
    return None


def effective_plafond(prob: float, parle: float, last_word: str,
                      threshold: float = TURN_THR) -> tuple[float, str]:
    """La DECISION de fin de tour (PURE, copie de la logique validee `oreilles_live.py:1000-1055`). Retourne
    (plafond_effectif_s, raison). En CONVERSATION (le seul appelant, `SttPlug` arme), on ne finalise JAMAIS a
    l'instant sur Smart Turn — on RACCOURCIT le plafond de silence (le SttPlug finalise quand le silence
    l'atteint ; une reprise de parole l'annule) :
      - prob > seuil, rien ne retient  -> CONFIANT : grace de FIN (ENDGRACE, 0,7 s pour enchainer) ;
      - prob > seuil, court MAIS tres confiant (> HELD_CONF) -> vraie fin courte : grace COURTE (0,8 s) ;
      - prob > seuil mais RETENU (faux positif) -> reste au plafond fallback (3 s) ;
      - prob <= seuil -> pas confiant, on ATTEND : plafond fallback (3 s).
    ENDGRACE=0 (OFF) -> plafond 0 -> le SttPlug finalise au prochain tick (fin immediate, parite banc)."""
    if prob <= threshold:
        return PLAFOND, "plafond"                            # pas confiant -> attend (fallback 3 s)
    hold = hold_reason(parle, last_word)
    if hold is None:
        return ENDGRACE, f"smart-turn {prob:.2f}"            # confiant, rien ne retient -> grace de fin
    if hold == "trop court" and prob > HELD_CONF:
        return HELD_PLAFOND, f"grace courte {prob:.2f}"      # court MAIS tres confiant -> vraie fin courte
    return PLAFOND, f"retenu ({hold})"                       # faux positif retenu -> reste 3 s


# ══════════ Moteur Smart Turn injectable ══════════

class TurnEngine:
    """Contrat moteur fin de tour (injectable). `predict(audio_f32) -> proba (0..1)` que le tour est FINI (sur
    l'intonation des dernieres 8 s). `warm()` pre-charge. prod = SmartTurnEngine (ONNX) ; test = scripte."""

    def predict(self, audio: np.ndarray) -> float:
        raise NotImplementedError

    def warm(self) -> None:
        pass


_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # sidecar/consumers -> racine
_MODEL_DIR = os.path.join(_ROOT, "resources", "models", "smart-turn")


class SmartTurnEngine(TurnEngine):
    """Smart Turn v3.2-cpu (onnxruntime CPU, ~8 Mo, ~40 ms). Le preprocessing = `WhisperFeatureExtractor(
    chunk_length=8, do_normalize=True)` REPRODUIT avec `torch.stft` + `torch.hann_window(400)` + la matrice mel
    VENDORISEE (design-first conv 45 : PROUVE bit-identique au banc, max|diff proba|=0,0). Sortie ONNX = une
    PROBA (sigmoide integree — PAS de sigmoide a rajouter, conv 25). Modele + mel charges depuis
    `resources/models/smart-turn/` (OFFLINE, JAMAIS de reseau au runtime, plan 05). Threads onnxruntime = defaut
    (fidele au banc) ; `SOPHIA_TURN_THREADS` borne l'intra-op si un jitter V0-V3 apparaissait (verifie a l'E2E).
    Import onnxruntime/torch PARESSEUX."""

    def __init__(self, model_path: str | None = None, mel_path: str | None = None,
                 threads: int | None = None):
        self._model_path = model_path or os.path.join(_MODEL_DIR, "smart-turn-v3.2-cpu.onnx")
        self._mel_path = mel_path or os.path.join(_MODEL_DIR, "mel_filters_80.npy")
        try:
            env_threads = int(os.environ.get("SOPHIA_TURN_THREADS", "0") or 0)   # 0/absent -> defaut onnxruntime
        except (TypeError, ValueError):
            env_threads = 0                                                      # valeur mal formee -> defaut (jamais un crash au spawn)
        self._threads = threads if threads is not None else (env_threads or None)
        self._sess = None
        self._mel = None
        self._window = None

    def warm(self) -> None:
        """Charge l'ONNX + la mel + la fenetre de Hann, PUIS une inference JETABLE (compile torch.stft +
        onnxruntime -> le 1er vrai tour ne paie pas l'init, mesuree ~63 ms). LEVE si le modele est absent ->
        l'appelant degrade honnetement (fin de tour au plafond fallback, jamais un crash)."""
        if self._sess is not None:
            return
        import onnxruntime
        import torch
        so = onnxruntime.SessionOptions()
        if self._threads:
            so.intra_op_num_threads = int(self._threads)
            so.inter_op_num_threads = 1
        # Charger dans des LOCALS ; n'assigner `self._sess` (le SENTINEL de warm) qu'EN DERNIER, une fois la mel
        # ET la fenetre pretes -> un echec de chargement (modele/mel absent/corrompu) laisse _sess=None (retry
        # PROPRE), jamais un etat MI-CHARGE (sess set mais _mel=None -> le prochain warm early-return -> crash predict).
        sess = onnxruntime.InferenceSession(self._model_path, so, providers=["CPUExecutionProvider"])
        mel = torch.from_numpy(np.load(self._mel_path)).to(torch.float32)   # (201,80) -> f32 (== _torch_extract)
        window = torch.hann_window(400)
        self._mel, self._window, self._sess = mel, window, sess            # _sess (le sentinel) EN DERNIER
        try:
            self.predict(np.zeros(WIN, dtype=np.float32))    # warmup : compile torch.stft + onnxruntime (re-entre warm -> early-return)
        except Exception:
            pass

    def predict(self, audio: np.ndarray) -> float:
        """Proba « tour fini » (0..1) pour l'audio 16 kHz (dernieres 8 s). Reproduit EXACTEMENT le banc :
        troncature/pad-a-GAUCHE 8 s -> do_normalize (zero_mean_unit_var) -> torch.stft(400,160,hann) ->
        |.|^2 -> mel.T @ -> log10 clamp -> max-8 -> (x+4)/4 -> ONNX -> proba directe."""
        self.warm()
        import torch
        a = audio[-WIN:] if len(audio) >= WIN else np.pad(audio, (WIN - len(audio), 0))
        a = np.ascontiguousarray(a, dtype=np.float32)
        a = (a - a.mean()) / np.sqrt(a.var() + 1e-7)                     # do_normalize (plein 128000, incl. pad)
        wav = torch.from_numpy(a)
        stft = torch.stft(wav, 400, 160, window=self._window, return_complex=True)   # (201, 801)
        mag = stft[..., :-1].abs() ** 2                                 # (201, 800) — drop la derniere trame
        mel_spec = self._mel.T @ mag                                    # (80, 800)
        log_spec = torch.clamp(mel_spec, min=1e-10).log10()
        log_spec = torch.maximum(log_spec, log_spec.max() - 8.0)
        log_spec = (log_spec + 4.0) / 4.0
        feats = log_spec.numpy()[None, :, :].astype(np.float32)         # (1, 80, 800)
        out = self._sess.run(None, {"input_features": feats})[0]
        return float(np.asarray(out).ravel()[0])                        # PROBA directe (sigmoide integree, conv 25)


# ══════════ Le detecteur de fin de tour (moteur + logique, utilise par le SttPlug) ══════════

class TurnDetector:
    """Assemble le moteur (injectable) et la logique PURE. Le `SttPlug` l'appelle a CHAQUE candidat de silence
    (un `evt.vad.stop` en conversation) : `evaluate(turn_audio, parle, last_word) -> (plafond_s, raison, prob)`.
    Un moteur qui LEVE (ONNX absent/KO) -> fallback plafond 3 s + compteur (jamais un crash ; le tour finit
    quand meme, plan 01 §4.3). Le detecteur ne tient AUCUNE machine a etats (le SttPlug possede le tour) ->
    pas de thread, pas de course."""

    def __init__(self, engine: TurnEngine | None = None, threshold: float | None = None):
        self._engine = engine if engine is not None else SmartTurnEngine()
        self._threshold = float(threshold) if threshold is not None else TURN_THR
        self._errors = 0
        self._last_prob: float | None = None

    def warm(self) -> None:
        self._engine.warm()

    def evaluate(self, turn_audio: np.ndarray, parle: float, last_word: str) -> tuple[float, str, float | None]:
        try:
            prob = float(self._engine.predict(turn_audio))
        except Exception:
            self._errors += 1
            return PLAFOND, "fallback (moteur KO)", None      # degradation douce : le plafond 3 s ferme le tour
        if not math.isfinite(prob):                          # croisé conv 45 : contrat `predict -> [0,1]` garde a la
            self._errors += 1                                #   FRONTIERE. Un moteur injecte non conforme (NaN/inf) ne
            return PLAFOND, "fallback (proba non finie)", None   #   doit pas empoisonner le JSON d'evt.turn.end -> fallback.
        self._last_prob = prob
        plaf, reason = effective_plafond(prob, parle, last_word, self._threshold)
        return plaf, reason, prob

    @property
    def errors(self) -> int:
        return self._errors

    @property
    def last_prob(self) -> float | None:
        return self._last_prob

    @property
    def threshold(self) -> float:
        return self._threshold
