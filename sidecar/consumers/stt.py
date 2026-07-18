"""Sophia — sidecar / STT streaming + portier d'eveil PAR PHRASE (plan 01, V4).

« Elle entend son nom dans une phrase et se retourne. » Le STT (faster-whisper `large-v3` int8_float16 GPU)
transcrit la parole AU FIL (local-agreement), et un PORTIER lit le transcript, distingue « Sophia » de
« Sophie » (le wake-model conv 24 a ete ecarte conv 27 : trop faible en reel) et appelle `wake.on_wake(mark)`
— le VRAI declencheur sur V3 (qui rembobine a la marque VAD, premier mot jamais ampute, F1).

Architecture (fidele au banc conv 27/32, re-partitionnee en prise sidecar) :
  - `SttPlug` = une PRISE (patron 01-F) : un WORKER UNIQUE lit le ring POST-AEC, transcrit par CADENCE
    (fenetre bornee, LocalAgreement-2), emet `evt.stt.partial` / `evt.stt.final`. Pilote par les MARQUES VAD
    (via l'emit wrappe de server.py — le `VadPlug` verrouille n'est PAS touche) : au `evt.vad.start` il rembobine
    son curseur A LA MARQUE (rETROACTIF, F1), lit exactement le segment de parole [start, stop] (jamais le
    silence de queue = hallucination Whisper), ACCUMULE les segments proches (le committe traverse une
    micro-pause -> « Dis-moi... [pause] ...Sophia » reste un seul transcript), et clot le GROUPE a un silence
    prolonge (plafond simple — la fin de tour FINE = V5).
  - le PORTIER examine le committe ACCUMULE : eveil -> `wake.on_wake(mark=<debut du groupe>)` ; cloture ->
    `wake.release()` ; filet anti-hallucination (jamais reveiller sur du vent).

CONTRATS graves par V3 (conv 42) que V4 honore :
  - R-2 : verifier l'`overrun` de CHAQUE `cursor.read()` (pas seulement `truncated` au seek) — sinon le
    premier mot est ampute EN SILENCE si le STT prend du retard et que le ring avance ;
  - R-1 : le releaser est GARANTI (le portier ferme sur cloture explicite) ; la deadline de garde sur silence
    = frontiere V9 (« pas de timer creux ; V9 DOIT porter la deadline »).

Le moteur STT vit DERRIERE une interface INJECTABLE (`SttEngine`) : prod = faster-whisper, test = moteur
scripte deterministe (la LOGIQUE de la prise + le portier se testent sans GPU ni audio reel). Import
faster-whisper/torch PARESSEUX (module importable sans eux).
"""
from __future__ import annotations

import queue
import re
import unicodedata

import numpy as np

from plugs.base import ConsumerPlug

# ── Reglages STT (banc 22, conv 32 ; re-mesures design-first conv 43 : 14 % de charge, WER 0,0 %) ────────
STT_HOP_S = 1.5          # cadence de re-transcription (banc conv 32). (Conv 44 : ne sert PLUS de garde a la lecture
#                          rapide — la garde de course "deux fils" du banc n'a pas lieu d'etre ici, mono-fil ; cf. _fast_wake_check.)
STT_WIN_CAP_S = 5.0      # fenetre de travail bornee (au-dela on rogne -> cout par appel borne)
STT_CONTEXT_S = 1.5      # audio garde a gauche du dernier mot committe (contexte au rognage)
STT_MIN_WIN_S = 1.0      # audio minimum avant le 1er appel (STREAMING/conversation)
WAKE_MIN_WIN_S = 0.4     # audio minimum pour la LECTURE RAPIDE (reveil) — SEPARE du streaming. Conv 44 (mesure a la
#                          VRAIE VOIX) : un « Bonjour Sophia » naturel fait ~0,9 s ; le seuil streaming 1,0 s le RATAIT
#                          (« fast SKIP audio trop court ») -> reveil lent 1,36 s au lieu de ~0,75 s, et INCOHERENT (la
#                          phrase oscille autour d'1 s). 0,4 s suffit largement a contenir « ...sophia » ; en-dessous =
#                          fragment -> non-match (non destructif : le groupe continue). Le vrai plancher = la transcription.
# Plafond de fin de GROUPE, DIFFERENCIE reveil/conversation (recoupe au banc conv 32, valeurs EXACTES) :
WAKE_PLAFOND_S = 0.8     # AU REVEIL (Sophia dort) : plafond COURT (banc WAKE_PLAFOND) — l'ouvreur est deja fini
#                          quand le silence demarre, rien a perdre -> reveil vif (+ la lecture rapide -> ~0,65 s).
GROUP_SILENCE_S = 3.0    # EN CONVERSATION (Sophia armee) : plafond (banc PLAFOND) = FALLBACK de la fin de tour FINE
#                          (Smart Turn, V5, conv 45) qui raccourcit ce plafond quand le tour sonne fini. turn=None -> ce
#                          plafond simple s'applique tel quel (V4 EXACT).
TURN_PREATTACK_S = 0.4   # V5 : Smart Turn recoit l'audio du tour a partir de 0,4 s AVANT la marque VAD (fidele au banc
#                          oreilles_live.py:983 `turn_i16 = recent[-0.4s:]`) — le do_normalize moyenne sur 8 s, cette
#                          pre-attaque compte. Rembobinee du ring a l'ouverture d'un groupe de conversation.
_MIN_TAIL_S = 0.3        # au finalize, ne re-transcrire que s'il reste >= 0,3 s de nouvel audio
MAX_AUDIO_S = 30.0       # F-1 (conv 44) : plafond DUR du buffer de travail d'un groupe (= fenetre ring). Garde
#                          anti-fuite pour le cas ANORMAL (VAD fige en « ca parle » : le trim n'avance pas, rien
#                          ne se transcrit). En usage NORMAL la compaction par _trim_off (TRANSPARENTE : ne jette
#                          que du DEJA-transcrit) garde _audio bien en-dessous ; cette garde absolue ne mord QUE
#                          dans l'anormal, et jette alors AUSSI de l'audio non-transcrit — mais l'invariant tenu
#                          reste « aucune parole COMMITTEE perdue » (pas de vraie phrase a preserver dans ce cas).
_CMDS_MAX = 256          # F-2 (conv 44) : borne de la file de commandes VAD. En normal le worker draine a chaque
#                          tick (file ~vide) ; si le worker MEURT (moteur KO), la file ne fuit pas (drop-oldest).


# ══════════ Normalisation + portier d'eveil (fonctions PURES, portees du banc conv 27) ══════════

def _norm(text: str) -> str:
    """Normalise pour le portier : minuscules, ponctuation/tirets -> espaces, « sofia » -> « sophia »
    (le STT ecrit parfois « Sofia »), espaces compresses."""
    t = text.lower()
    t = re.sub(r"[.,!?;:…'’\"\-]", " ", t)
    t = re.sub(r"\bsofia\b", "sophia", t)
    return re.sub(r"\s+", " ", t).strip()


# Adresse par PHRASE (grille A32-etendu) : le STT lit « ... Sophia » ; « Sophie/Sonia » ne matchent pas. Les
# phrases sont NORMALISEES a la construction (_norm : apostrophes/tirets -> espaces), comme le transcript a
# l'usage -> « dis-moi » et « dis moi » deviennent UNE seule forme (comparaison directe fiable ensuite).
OPEN_PHRASES = [_norm(p) for p in
                ["bonjour sophia", "bonsoir sophia", "dis-moi sophia",
                 "salut sophia", "bonne nuit sophia"]]
# Cloture = son NOM + une facon de dire au revoir (« Merci Sophia, a plus tard » · « Bonne nuit Sophia »).
# Un simple « merci Sophia » en milieu de conversation ne ferme PAS (decision Yohann conv 27). NORMALISEES
# aussi (bug attrape au solo conv 44 : « a tout a l'heure »/« on s'arrete » a apostrophe ne fermaient JAMAIS,
# car _norm transforme l'apostrophe du TRANSCRIPT en espace mais PAS celle d'un marqueur brut compare tel quel).
CLOSE_MARKERS = [_norm(m) for m in
                 ["à plus tard", "a plus tard", "à bientôt", "a bientot", "à tout à l'heure",
                  "a tout a l'heure", "à demain", "a demain", "au revoir", "bonne nuit",
                  "on s'arrête", "on arrête"]]


def match_opening(transcript: str) -> bool:
    """Le transcript (committe ACCUMULE) contient-il une phrase d'eveil (... Sophia) ? Rejette Sophie/Sonia."""
    n = _norm(transcript)
    return any(p in n for p in OPEN_PHRASES)


def match_closing(transcript: str) -> bool:
    """Cloture = « sophia » + un marqueur d'au revoir (« a plus tard »/« bonne nuit »...)."""
    n = _norm(transcript)
    return "sophia" in n and any(m in n for m in CLOSE_MARKERS)


def is_goodnight(transcript: str) -> bool:
    """« bonne nuit Sophia » = eveil-cloture (elle repond bonne nuit puis se rendort)."""
    return "bonne nuit" in _norm(transcript)


# ── Filet anti-hallucination STT (banc 10_v4_filter, 11/11) : dernier rempart APRES le vad_filter.
_PHANTOMS = [
    "merci d avoir regarde", "sous titrage", "sous titres realises par",
    "amara org", "abonnez vous", "merci a tous et a bientot", "merci de votre attention",
]


def _norm_halluc(text: str) -> str:
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")   # ote les accents
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def is_hallucination(text: str, no_speech_prob: float | None = None) -> tuple[bool, str]:
    """(rejeter?, raison). True = fantome Whisper / vide / no_speech eleve -> NE PAS reveiller sur du vent."""
    n = _norm_halluc(text)
    if len(n) == 0:
        return True, "vide"
    for p in _PHANTOMS:
        if p in n:
            return True, f"fantome « {p} »"
    if no_speech_prob is not None and no_speech_prob > 0.80:
        return True, f"no_speech {no_speech_prob:.2f}"
    return False, ""


# ══════════ LocalAgreement-2 (HypoBuffer) — PUR, porte du banc 22 (conv 32), WER 0,0 % ══════════

def _nw(word: str) -> str:
    """Un mot normalise (minuscule, sans accent ni ponctuation) — pour comparer l'accord des mots."""
    t = unicodedata.normalize("NFD", word.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    parts = "".join(c if c.isalnum() else " " for c in t).split()
    return parts[0] if parts else ""


class HypoBuffer:
    """LocalAgreement-2 (Machacek et al., whisper_streaming) : committe le prefixe commun entre la
    transcription COURANTE et la PRECEDENTE -> un mot n'est fige que s'il apparait dans 2 hypotheses
    consecutives (etouffe les hallucinations transitoires) ; dedup n-gram au raccord. Horodatages ABSOLUS
    (s depuis le debut du groupe). Copie fidele du banc (prouvee WER 0,0 % vs one-shot)."""

    def __init__(self):
        self.committed: list[tuple[str, float, float]] = []
        self.buffer: list[tuple[str, float, float]] = []     # hypothese precedente non confirmee
        self.last_t = 0.0                                     # fin du dernier mot committe (s)

    def process(self, words_abs: list[tuple[str, float, float]]) -> list:
        new = [w for w in words_abs if w[2] > self.last_t - 0.1]
        if self.committed and new and abs(new[0][1] - self.last_t) < 1.0:   # dedup n-gram au raccord
            cn, nn = len(self.committed), len(new)
            for i in range(min(cn, nn, 5), 0, -1):
                if [_nw(self.committed[-i + k][0]) for k in range(i)] == [_nw(new[k][0]) for k in range(i)]:
                    new = new[i:]
                    break
        commit = []
        while new and self.buffer and _nw(new[0][0]) == _nw(self.buffer[0][0]):
            commit.append(new[0]); new.pop(0); self.buffer.pop(0)
        self.buffer = new
        if commit:
            self.committed.extend(commit)
            self.last_t = commit[-1][2]
        return commit

    def text_committed(self) -> str:
        return " ".join(w[0] for w in self.committed).strip()

    def text_final(self) -> str:
        """Committe + le reliquat non confirme (a la fin d'un groupe, on prend ce qu'on a)."""
        return " ".join(w[0] for w in (self.committed + self.buffer)).strip()

    def shift(self, dt: float) -> None:
        """Glisse le referentiel temporel de `dt` s (compaction de _audio cote SttPlug, F-1). `last_t` et le
        `buffer` (hypothese en cours, timestamps ABSOLUS depuis le debut du groupe) suivent le nouveau debut de
        _audio. Le COMMITTE n'est JAMAIS touche : aucun mot deja transcrit n'est perdu (seul l'audio-octets deja
        transcrit est jete). Ses timestamps restent dans le referentiel d'origine du groupe (non utilises au
        dedup, qui ne compare que les MOTS) -> le TEXTE (le contexte de ce que dit Yohann) est integralement
        preserve. dt < 0 (on recule l'origine) ; last_t borne a >= 0."""
        self.last_t = max(0.0, self.last_t + dt)
        # un mot du buffer (non confirme) dont l'audio passe SOUS le nouveau debut (end <= 0) est jete : n'arrive
        # que dans le cas anormal (garde absolue) ou il n'y a pas de vraie parole ; le committe reste INTACT.
        self.buffer = [(w, s + dt, e + dt) for (w, s, e) in self.buffer if e + dt > 0.0]


# ══════════ Moteur STT injectable ══════════

class SttEngine:
    """Contrat moteur STT (injectable). `transcribe(audio_f32, beam_size, word_ts) -> (text, words, nsp)`
    ou `words` = liste de (mot, start_s, end_s) relatifs au debut de `audio_f32` (si word_ts) ; `warm()`
    pre-charge le modele. prod = faster-whisper (large-v3 cuda) ; test = moteur scripte deterministe."""

    def transcribe(self, audio: np.ndarray, beam_size: int = 5, word_ts: bool = False):
        raise NotImplementedError

    def warm(self) -> None:
        pass


class FasterWhisperEngine(SttEngine):
    """faster-whisper `large-v3` int8_float16 GPU (recette banc conv 25/32, prouvee design-first conv 43 :
    torch 2.13.0+cu126 / faster-whisper 1.2.1 / ct2 4.8.1 ; RTF 0,05 ; « ronronnent » capte). FRANCAIS FORCE,
    temperature 0, condition_on_previous_text False (garde anti-hallu, banc 06_stt). Import PARESSEUX ; le fix
    DLL torch/lib (ct2 charge cuDNN/cuBLAS/cudart depuis la) est applique au chargement."""

    def __init__(self, model_name: str = "large-v3", device: str = "cuda", compute_type: str = "int8_float16"):
        self._name = model_name
        self._device = device
        self._compute = compute_type
        self._model = None

    def warm(self) -> None:
        if self._model is not None:
            return
        import os
        import torch                                   # fix DLL Windows : ct2 lit cuDNN/cuBLAS/cudart de torch/lib
        _tl = os.path.join(os.path.dirname(torch.__file__), "lib")
        if os.path.isdir(_tl):
            os.add_dll_directory(_tl)
        from faster_whisper import WhisperModel
        self._model = WhisperModel(self._name, device=self._device, compute_type=self._compute)
        # WARMUP (conv 44) : une inference JETABLE compile les noyaux CUDA (ct2/cuDNN) DES MAINTENANT — au demarrage
        # du worker, hors chemin critique — pour que le PREMIER vrai reveil ne paie PAS la compilation. Mesure conv 43 :
        # 1re inference 556 ms vs a chaud ~425 ms (~110 ms de compile). PARITE BANC : mesure_v4_designfirst.py fait un
        # warmup avant de mesurer ; sans lui, le produit serait plus lent que le banc au 1er reveil (interdit, cf.
        # perf-produit-egal-banc). 1 s de bruit tres faible a 16 kHz (le taux attendu par faster-whisper ; exerce
        # encodeur + decodeur beam-1 comme un vrai signal ; deterministe, seed fixe). Best-effort : un warmup KO ne
        # doit JAMAIS empecher le modele de servir (il compilerait au 1er vrai appel, exactement comme avant ce warmup).
        try:
            _dummy = (np.random.default_rng(0).standard_normal(16000) * 0.01).astype(np.float32)
            list(self._model.transcribe(_dummy, language="fr", beam_size=1, temperature=0.0,
                                        condition_on_previous_text=False)[0])
        except Exception:
            pass

    def transcribe(self, audio: np.ndarray, beam_size: int = 5, word_ts: bool = False):
        self.warm()
        segs, _ = self._model.transcribe(audio, language="fr", beam_size=beam_size, temperature=0.0,
                                         condition_on_previous_text=False, word_timestamps=word_ts)
        text, words, nsp = "", [], 1.0
        for s in segs:
            text += s.text
            nsp = min(nsp, s.no_speech_prob)
            if word_ts and s.words:
                for w in s.words:
                    words.append((w.word.strip(), float(w.start), float(w.end)))
        return text.strip(), words, nsp


# ══════════ La prise STT (worker pilote-VAD) ══════════

class SttPlug(ConsumerPlug):
    """STT streamed + portier (V4). Un WORKER UNIQUE (le thread de la prise) est le seul a toucher le curseur
    ring ET le moteur (pas de course ct2, R#9). Pilote par les marques VAD (`on_vad`, file thread-safe) : au
    start il rembobine son curseur a la marque (F1), lit le segment [start, stop] (borne -> pas de silence de
    queue), ACCUMULE les segments d'un groupe, transcrit par cadence (local-agreement), emet evt.stt.partial ;
    a un silence prolonge il FINALISE (evt.stt.final). Le portier examine le committe accumule -> on_wake /
    release. R-2 : l'`overrun` de chaque read est verifie."""

    def __init__(self, ring, emit, wake=None, engine: SttEngine | None = None, turn=None):
        super().__init__("stt", ring, emit, hop_samples=1600)   # hop non utilise (lecture par blocs variables)
        self._rate = int(ring.sample_rate)
        self._wake = wake
        self._engine = engine if engine is not None else FasterWhisperEngine()
        self._turn = turn              # V5 : detecteur de fin de tour (TurnDetector) ; None -> comportement V4 EXACT
        self._gate = None              # V7 morceau C : gate anti-auto-ecoute (Callable[[],bool]|None) ; None -> V4 EXACT
        self._cmds: queue.Queue = queue.Queue(maxsize=_CMDS_MAX)   # commandes VAD (start/stop, pos) — thread-safe, BORNEE (F-2)
        # etat de groupe/segment (touche UNIQUEMENT par le worker, sauf _cmds)
        self._active = False           # un groupe de parole est en cours
        self._reading = False          # segment ouvert (in_speech) -> on lit jusqu'au present ; sinon jusqu'a _seg_stop
        self._mark: int | None = None  # position ring du DEBUT du groupe (la marque pour on_wake, F1)
        self._seg_stop: int | None = None
        self._audio = np.zeros(0, dtype=np.float32)             # buffer de travail (segments concatenes, sans silence)
        self._hypo = HypoBuffer()
        self._trim_off = 0
        self._last_call_end = 0
        self._min_nsp = 1.0
        self._woke = False             # on_wake deja appele pour CE groupe (une fois)
        self._wake_check_pending = False   # un vad-stop vient d'arriver -> tenter la LECTURE RAPIDE (reveil vif)
        # V5 (fin de tour FINE) — actifs SEULEMENT si `turn` est fourni ET le groupe a ouvert EN CONVERSATION
        self._armed_at_open = False    # ce groupe a-t-il ouvert ARME (conversation) ? -> vrai tour vs ouvreur d'eveil
        self._turn_win = 8 * self._rate                        # Smart Turn ne regarde que les dernieres 8 s (banc)
        self._turn_audio = np.zeros(0, dtype=np.float32)       # audio CONTINU du tour (== turn_i16 du banc)
        self._turn_plaf = GROUP_SILENCE_S                      # plafond effectif en conversation (V5 le raccourcit ;
        #                                                        reste GROUP_SILENCE_S si turn=None -> V4 EXACT)
        self._last_turn_reason: str | None = None
        self._last_turn_prob: float | None = None
        # observabilite / debug
        self._groups = 0
        self._partials = 0
        self._finals = 0
        self._overruns = 0
        self._engine_errors = 0
        self._compactions = 0          # F-1 : nb de compactions du buffer de travail (observabilite)
        self._dropped_cmds = 0         # F-2 : nb de commandes VAD jetees (worker mort/cale) — observabilite
        self._turns_ended = 0          # V5 : nb d'evt.turn.end emis (tours de conversation finalises)
        self._aborts = 0               # V7 : groupes ABANDONNES parce que SA voix jouait (overlap droppe, fidele banc)
        self._gate_errors = 0          # V7 : gate qui a leve (fail-open) — COMPTE, jamais avale (standard maison)
        self._last_fast_ms = 0.0       # latence de la derniere lecture rapide (transcription one-shot) — observabilite
        self._warm = False             # V7 juge (conv 47) : le worker a fini de CHARGER + chauffer (faster-whisper +
        #                                Smart Turn) -> temoin HONNETE de « pret a transcrire ». Le banc de preuve (juge a
        #                                ta voix) ne donne le GO (bips) que dessus (fini l'attente au doigt mouille : le 1er
        #                                « Bonjour Sophia » ne tape plus un STT en pleine compilation CUDA). Observabilite
        #                                PURE : aucun chemin de decision ne le lit -> ZERO changement de comportement.
        self.last_final: str | None = None

    def warm(self) -> None:
        """Pre-charge le moteur (faster-whisper/CUDA). LEVE si absent -> l'appelant degrade honnetement."""
        self._engine.warm()

    def set_gate(self, gate) -> None:
        """Cable le GATE anti-auto-ecoute (V7 morceau C). `gate()` -> True quand SA propre voix joue (le TtsPlug
        parle + traine). Tant que c'est True, un GROUPE d'ecoute OUVERT est ABANDONNE (`_abort_group`) : au banc,
        la parole superposee pendant qu'elle repondait etait DROPPEE (`_flush_audio`, oreilles_live:1298) -> ici on
        ne laisse pas un groupe enjamber sa voix (sinon il relirait son residu post-AEC ~10 dB -> tour parasite).
        Complement du gate VAD (qui bloque les NOUVEAUX groupes) : celui-ci ferme les groupes DEJA ouverts (Yohann
        a parle pendant qu'elle reflechissait). None = pas de gate (V4 EXACT). Cable en PROD (server._start_audio)."""
        self._gate = gate

    def _gate_speaking(self) -> bool:
        """True si SA voix joue (gate anti-auto-ecoute). Fail-open : un gate qui leve -> False (COMPTE, jamais
        avale ; on ne casse pas l'ecoute sur un bug de gate — parite VadPlug)."""
        if self._gate is None:
            return False
        try:
            return bool(self._gate())
        except Exception:
            self._gate_errors += 1
            return False

    # ── entree des marques VAD (thread de la prise VAD, via l'emit wrappe) : POSTE, ne bloque jamais ──────
    def on_vad(self, mtype: str, payload: dict) -> None:
        """Robuste : un payload malforme ne leve JAMAIS (parite WakeGate.observe / _safe_emit). Seuls
        evt.vad.start/stop portent une marque. La file est BORNEE (F-2) : si le worker ne draine plus (moteur
        mort/cale), on jette la commande la plus ANCIENNE au lieu de fuir sans fin (le VAD, lui, continue)."""
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
                self._dropped_cmds += 1   # inatteignable en producteur unique ; compte par surete (2e producteur eventuel)

    def _drain_cmds(self) -> None:
        while True:
            try:
                cmd, pos = self._cmds.get_nowait()
            except queue.Empty:
                break
            if cmd == "start":
                if not self._active:
                    self._open_group(pos)                       # nouveau groupe -> rembobine a la marque (F1)
                # reprise (meme groupe) : PAS de seek-en-avant -> on lit EN CONTINU depuis la position courante.
                # Le silence INTERNE court (< GROUP_SILENCE) est lu (faster-whisper gere les pauses internes) ; un
                # seek-en-avant SAUTERAIT le segment precedent pas encore lu si les marques arrivent en backlog.
                self._reading = True
                self._seg_stop = None
                self._turn_plaf = GROUP_SILENCE_S               # V5 : reprise de parole -> ANNULE toute grace en cours
                #                                                  (la fin de tour sera re-evaluee au prochain vad-stop)
            else:  # stop
                self._seg_stop = pos                            # le segment courant finit ICI (borne de lecture)
                self._reading = False
                self._wake_check_pending = True                 # segment fini -> LECTURE RAPIDE apres le read (reveil vif)

    def _open_group(self, pos: int) -> None:
        self._active = True
        self._mark = pos
        self._cursor.seek_to(pos)                               # rembobinage RETROACTIF a la marque VAD (F1)
        self._audio = np.zeros(0, dtype=np.float32)
        self._hypo = HypoBuffer()
        self._trim_off = 0
        self._last_call_end = 0
        self._min_nsp = 1.0
        self._woke = False
        self._armed_at_open = self._armed_view()               # V5 : conversation (arme) vs ouvreur d'eveil (fige le role du groupe)
        self._turn_audio = self._read_preattack(pos)           # V5 : audio du tour = 0,4 s AVANT la marque (fidele banc)
        self._turn_plaf = GROUP_SILENCE_S                      # V5 : plafond par defaut (fallback) au (re)debut d'un groupe
        self._last_turn_reason = None
        self._last_turn_prob = None
        self._groups += 1

    def _read_preattack(self, pos: int) -> np.ndarray:
        """V5 : l'audio du tour commence 0,4 s AVANT la marque VAD (fidele au banc `recent[-0.4s:]`,
        oreilles_live.py:983 — le do_normalize moyenne sur 8 s, cette pre-attaque compte). Rembobine un curseur
        TEMPORAIRE du ring (n'affecte PAS le curseur du worker) et lit cette tranche. Vide hors conversation
        (turn=None ou ouvreur d'eveil, `_armed_at_open` False) ou si le ring ne la contient plus (bornee a oldest)."""
        if self._turn is None or not self._armed_at_open:
            return np.zeros(0, dtype=np.float32)
        pre = int(TURN_PREATTACK_S * self._rate)
        c = self._ring.cursor()                                # curseur JETABLE (le worker garde le sien intact, R#9)
        c.seek_to(max(0, int(pos) - pre))
        # S-12 (audit solo a fond) : lire EXACTEMENT jusqu'a la marque, JAMAIS au-dela. Si `pos-pre` est tombe
        # sous `oldest` (marque tres ancienne, ~overrun), le seek clampe a oldest ; lire `pre` deborderait alors
        # la marque et DOUBLONNERAIT l'audio que le worker relit depuis la marque -> intonation corrompue.
        n = int(pos) - c.position
        if n <= 0:
            return np.zeros(0, dtype=np.float32)
        data, _overrun = c.read(n)
        if data.size:
            return data.astype(np.float32) / 32768.0           # <= 0,4 s -> jamais besoin du cap 8 s
        return np.zeros(0, dtype=np.float32)

    def _compact(self) -> None:
        """F-1 : borne la memoire du buffer de travail sur un groupe LONG (Yohann parle longtemps, ou le VAD
        se fige). L'audio AVANT `_trim_off` est DEJA transcrit (derriere la fenetre de travail) et ne sera
        jamais relu -> on le jette. Le TEXTE committe (le contexte de ce que dit Yohann) est INTACT ; seuls les
        reperes glissent (`_trim_off`/`_last_call_end` + le referentiel du HypoBuffer). Le CONTENU de la fenetre
        `[_trim_off, fin]` est INCHANGE (memes echantillons, re-indexes) -> compaction TRANSPARENTE (meme
        transcript, meme instant ; transparence conditionnee a un moteur STATELESS : condition_on_previous_text
        False -> jeter de l'audio ne change pas le conditionnement du decodeur). Garde absolue pour le cas
        ANORMAL (VAD fige : le trim n'avance pas, rien ne
        se transcrit) -> jamais de fuite sans borne (on garde la derniere fenetre, aucune parole COMMITTEE
        perdue). N'affecte JAMAIS le reveil : un groupe d'eveil est court (< 2 s), jamais compacte."""
        k = self._trim_off
        if k < int(STT_WIN_CAP_S * self._rate):                 # pas assez d'audio deja-transcrit derriere la fenetre
            if len(self._audio) <= int(MAX_AUDIO_S * self._rate):
                return
            k = len(self._audio) - int(STT_WIN_CAP_S * self._rate)   # garde absolue (cas anormal)
        if k <= 0:
            return
        self._audio = self._audio[k:]
        self._trim_off = max(0, self._trim_off - k)
        self._last_call_end = max(0, self._last_call_end - k)
        self._hypo.shift(-k / self._rate)                       # glisse buffer + last_t ; committe (texte) INTACT
        self._compactions += 1

    def _discard_cmds(self) -> None:
        while True:
            try:
                self._cmds.get_nowait()
            except queue.Empty:
                break

    def _loop(self) -> None:
        # Charge le moteur (bloquant ~7 s au boot) DANS ce thread -> ne bloque PAS le serveur (/health repond).
        # Un echec de chargement degrade HONNETEMENT (le sidecar vit sans STT, comme sans micro), jamais un
        # worker mort en silence. (Le prewarm au wake = V11 ; ici, chargement au demarrage du worker.)
        try:
            self._engine.warm()
        except Exception:
            self._engine_errors += 1
            return
        if self._turn is not None:
            try:
                self._turn.warm()                               # V5 : pre-charge Smart Turn (parite warmup STT conv 44)
            except Exception:                                   # best-effort : un echec -> fin de tour au plafond
                pass                                            #   fallback (degradation douce), jamais un crash
        # Repartir PROPRE apres le chargement : jeter les marques accumulees pendant le warm + curseur au present
        # (sinon le worker traiterait un backlog de segments perimes -> groupes melanges). En prod le warm finit
        # avant que Yohann parle ; en test la source BOUCLE -> le prochain « bonjour sophia » est capte propre.
        self._discard_cmds()
        self._cursor.seek_latest()
        self._warm = True                                       # V7 juge : worker CHAUD (modeles charges + chauffes,
        #                                                         backlog jete, curseur au present) -> temoin /debug HONNETE
        while not self._stop.is_set():
            if not self._tick():
                self._stop.wait(0.01)                           # rien a faire -> courte attente (pas de busy-loop)

    def _tick(self) -> bool:
        """UNE iteration : draine les marques VAD, lit l'audio du segment (borne, R-2), transcrit par cadence
        OU finalise a un silence prolonge. Retourne True si un traitement a eu lieu. SEPARE de _loop -> la
        prise se teste DETERMINISTE sans thread ni wall-clock (positions ring seules ; parite VadPlug.process)."""
        self._drain_cmds()
        # V7 morceau C — GATE anti-auto-ecoute : SA voix joue alors qu'un groupe est OUVERT (Yohann a parle pendant
        # qu'elle reflechissait, la latence cerveau) -> on ABANDONNE le groupe (fidele au banc qui DROPPAIT la parole
        # superposee, _flush_audio oreilles_live:1298) : sinon il enjamberait sa voix et relirait son residu post-AEC
        # -> tour parasite. A la reprise (elle a fini), un vad.start FRAIS ouvrira un groupe propre (seek_to la marque
        # post-residu). L'overlap INTENTIONNEL (barge-in) = V8. `_gate_speaking()` n'est consulte QUE si _active
        # (court-circuit `and`) -> aucun cout en veille ; fail-open (bug de gate -> on n'aborte pas, on ecoute).
        if self._active and self._gate_speaking():
            self._abort_group()
            return False
        if not self._active:
            return False
        # lire l'audio du segment : jusqu'au present si in_speech, sinon borne a _seg_stop (jamais au-dela
        # -> pas de silence de queue a halluciner ; parite « feed pendant in_speech » du banc).
        limit = self._ring.write_pos() if self._reading or self._seg_stop is None else self._seg_stop
        n = int(limit) - self._cursor.position
        did = False
        if n > 0:
            data, overrun = self._cursor.read(n)                # R-2 : l'overrun est VERIFIE a chaque read
            if overrun:
                self._on_overrun()
                return True
            if data.size:
                f = data.astype(np.float32) / 32768.0
                self._audio = np.concatenate([self._audio, f])
                self._compact()                                 # F-1 : borne la memoire (jette l'audio DEJA transcrit)
                if self._turn is not None and self._armed_at_open:   # V5 : audio CONTINU du tour (dernieres 8 s ; == turn_i16)
                    self._turn_audio = np.concatenate([self._turn_audio, f])[-self._turn_win:]
                did = True
        # LECTURE RAPIDE (banc conv 32 A) : au vad-stop, si Sophia DORT + tour court -> reveil VIF sans attendre
        # le silence de groupe (~0,65 s comme le banc). Non destructif : pas de match -> le groupe continue.
        if self._wake_check_pending:
            self._wake_check_pending = False
            if self._fast_wake_check():                         # WAKE (Sophia dort) : lecture rapide — INCHANGE (no-op si arme)
                return True                                     # a reveille + clos le groupe (vif)
            if self._turn is not None and self._armed_at_open:  # CONVERSATION (V5) : garde sur le ROLE du groupe (comme le
                self._turn_check()                              #   feed audio + l'emission) -> jamais Smart Turn sur du VIDE
                #   (croisé conv 45 : un ouvreur qui s'arme en cours ne faisait plus tourner Smart Turn sur du vide)
        avail = len(self._audio)
        if (avail - self._last_call_end) >= STT_HOP_S * self._rate and \
           (avail - self._trim_off) >= STT_MIN_WIN_S * self._rate:
            self._step(avail)                                   # transcription partielle au fil
            return True
        # plafond de fin de groupe DIFFERENCIE : COURT au reveil (Sophia dort) ; en conversation, V5 (Smart Turn)
        # a fixe `_turn_plaf` (grace de fin 0,7 / grace courte 0,8 / fallback 3,0). turn=None -> reste
        # GROUP_SILENCE_S (V4 EXACT). C'est ici que la fin de tour FINE remplace le plafond simple de V4.
        plaf = WAKE_PLAFOND_S if not self._armed_view() else self._turn_plaf
        if (not self._reading and self._seg_stop is not None
                and self._ring.write_pos() - self._seg_stop >= plaf * self._rate):
            self._finalize()                                    # silence prolonge apres le segment -> fin de groupe
            return True
        return did

    def _step(self, avail: int) -> None:
        win = self._audio[self._trim_off:avail]
        try:
            _text, words, nsp = self._engine.transcribe(win, beam_size=1, word_ts=True)   # partiels : beam 1
        except Exception:
            self._engine_errors += 1
            self._stop.wait(0.005)                              # repit si l'echec persiste (parite VadPlug)
            return
        self._min_nsp = min(self._min_nsp, nsp)
        self._last_call_end = avail
        off = self._trim_off / self._rate
        self._hypo.process([(w, s + off, e + off) for (w, s, e) in words])
        if (avail - self._trim_off) / self._rate > STT_WIN_CAP_S and self._hypo.last_t - STT_CONTEXT_S > off:
            self._trim_off = int((self._hypo.last_t - STT_CONTEXT_S) * self._rate)   # rogne : borne la fenetre
        committed = self._hypo.text_committed()
        if committed:                                          # ne pas emettre un partiel VIDE (bruit inutile au
            self._partials += 1                                # debut d'un groupe, avant tout accord LocalAgreement)
            self._safe_emit("evt.stt.partial", {"text": committed, "mark": int(self._mark)})
            self._gate_check(committed)                        # portier au fil (committe STABLE -> pas de faux)

    def _finalize(self) -> None:
        # UN dernier pas sur la FENETRE DE TRAVAIL entiere (beam 1 — jamais un fragment isole, leçon conv 32 :
        # « ronronnent » -> « rouronnent »). Le committe (deja juste) est preserve ; process dedup le raccord.
        avail = len(self._audio)
        if avail - self._last_call_end >= int(_MIN_TAIL_S * self._rate) and \
           avail - self._trim_off >= int(_MIN_TAIL_S * self._rate):
            win = self._audio[self._trim_off:avail]
            try:
                _text, words, nsp = self._engine.transcribe(win, beam_size=1, word_ts=True)
                self._min_nsp = min(self._min_nsp, nsp)
                off = self._trim_off / self._rate
                self._hypo.process([(w, s + off, e + off) for (w, s, e) in words])
            except Exception:
                self._engine_errors += 1
        final_text = self._hypo.text_final()
        self._emit_final(final_text, self._min_nsp)
        self._emit_turn_end()                                   # V5 : evt.turn.end APRES stt.final (ordre grave), en conversation
        self._gate_check(final_text)
        self._active = False                                    # groupe clos -> pret pour le prochain vad.start
        self._reading = False
        self._seg_stop = None

    def _emit_final(self, text: str, nsp: float) -> None:
        self._finals += 1
        self.last_final = text
        self._safe_emit("evt.stt.final",
                        {"text": text, "mark": int(self._mark),
                         "captured_at": self._ring.time_at(int(self._mark)),
                         "no_speech_prob": round(float(nsp), 3)})

    def _turn_check(self) -> None:
        """V5 (fin de tour FINE) : a CHAQUE candidat de silence (un vad-stop, EN CONVERSATION), Smart Turn evalue
        l'intonation du tour et fixe le PLAFOND effectif (`_turn_plaf` : grace de fin 0,7 / grace courte 0,8 /
        fallback 3,0). Ne finalise PAS lui-meme -> le plafond loop finalise quand le silence l'atteint ; une
        reprise de parole (vad.start) annule la grace (reset dans _drain_cmds). Reproduit `oreilles_live.py`
        (conv 32-34, valide a l'oreille). `parle` = duree audio du tour (deterministe, positions ring) ;
        `last_word` = dernier mot committe normalise (garde B, best-effort — vide si pas encore committe)."""
        if self._turn is None or self._mark is None or self._seg_stop is None:
            return
        parle = max(0.0, (self._seg_stop - self._mark) / self._rate)   # S-1 : garde non-negatif (marque re-ancree apres un overrun)
        committed = self._hypo.committed
        last_word = _nw(committed[-1][0]) if committed else ""
        _plaf, reason, prob = self._turn.evaluate(self._turn_audio, parle, last_word)
        self._turn_plaf = _plaf
        self._last_turn_reason = reason
        self._last_turn_prob = prob

    def _emit_turn_end(self) -> None:
        """V5 : emet `evt.turn.end` APRES `evt.stt.final` (ordre grave) — il le REFERENCE par la meme `mark` et
        porte les horodatages du tour (M2). SEULEMENT pour un tour de CONVERSATION (arme a l'ouverture) :
        l'ouvreur d'eveil (`_armed_at_open` False) est signale par `evt.wake` (V3), pas ici. Emetteur UNIQUE de
        turn.end (le chemin finalize du SttPlug = la machine a etats unique du tour, plan 01 §4.3)."""
        if self._turn is None or not self._armed_at_open or self._mark is None:
            return
        speech_ms = (round(max(0.0, (self._seg_stop - self._mark) / self._rate) * 1000, 1)   # S-1 : non-negatif
                     if self._seg_stop is not None else None)
        self._turns_ended += 1
        self._safe_emit("evt.turn.end", {
            "mark": int(self._mark),
            "captured_at": self._ring.time_at(int(self._mark)),
            "reason": self._last_turn_reason or "plafond",
            "prob": round(self._last_turn_prob, 3) if self._last_turn_prob is not None else None,
            "speech_ms": speech_ms,
        })

    def _armed_view(self) -> bool:
        """Sophia est-elle armee (EN tour de reveil) ? Lit l'etat du WakeGate (source de verite, S12). Le
        FakeWake de test expose aussi `armed`. Faux si pas de wake (tests bruts)."""
        return bool(getattr(self._wake, "armed", False))

    def _fast_wake_check(self) -> bool:
        """LECTURE RAPIDE au vad-stop (banc conv 32 A) : Sophia DORT -> transcription one-shot IMMEDIATE du tampon
        (beam 1, comme le finalize) -> reveil TOUT DE SUITE si « ...sophia », sans attendre WAKE_PLAFOND + finalize.

        ECART BANC (conv 44) : le banc gardait « parle < STT_HOP » (la lecture rapide ne tirait que pour un ouvreur
        COURT) car sa lecture rapide et son streaming etaient DEUX FILS -> ct2 concurrent interdit
        (oreilles_live.py:473,490,1028). ICI la prise est MONO-FIL (jamais deux appels ct2 en meme temps ; `on_vad`
        n'empile que des commandes) -> garde `last_call_end` retiree : la lecture rapide peut tirer meme si le
        streaming a deja tourne. NON DESTRUCTIF : pas de match -> False, le groupe continue (le plafond bridge
        « Dis-moi... Sophia »). Retourne True si a reveille + clos le groupe avec ce texte (pas de 2e STT)."""
        if self._wake is None or self._mark is None:
            return False
        if self._woke or self._armed_view():                               # deja reveille CE groupe / deja armee (conversation)
            return False
        if len(self._audio) < int(WAKE_MIN_WIN_S * self._rate):            # trop court pour «...sophia» (< 0,4 s ; conv 44)
            return False
        import time as _t
        _t0 = _t.perf_counter()
        try:
            text, _w, nsp = self._engine.transcribe(self._audio, beam_size=1, word_ts=False)
        except Exception:
            self._engine_errors += 1
            return False
        self._last_fast_ms = round((_t.perf_counter() - _t0) * 1000, 1)     # latence de la lecture rapide (observabilite)
        if is_hallucination(text, nsp)[0] or not match_opening(text):       # « bonne nuit sophia » matche opening
            return False                                                    #   (eveil-cloture gere ci-dessous)
        self._woke = True
        self._wake.on_wake(mark=int(self._mark))                            # LE VRAI DECLENCHEUR sur V3 (evt.wake, VIF)
        if is_goodnight(text):
            self._wake.release()                                            # eveil-cloture : elle se rendort
        self._emit_final(text, nsp)                                         # transcript = la lecture rapide (pas de 2e STT)
        self._active = False
        self._reading = False
        self._seg_stop = None
        return True

    def _gate_check(self, text: str) -> None:
        """Le portier (R-1). Eveil -> on_wake(mark) UNE fois ; « bonne nuit Sophia » = eveil-cloture (on_wake
        puis release) ; cloture d'une conversation -> release (idempotent). Filet anti-hallu d'abord."""
        if self._wake is None or self._mark is None:
            return
        if is_hallucination(text)[0]:
            return
        if match_opening(text):
            if not self._woke:
                self._woke = True
                self._wake.on_wake(mark=int(self._mark))        # LE VRAI DECLENCHEUR sur V3 (evt.wake)
                if is_goodnight(text):
                    self._wake.release()                        # eveil-cloture : elle se rendort
        elif match_closing(text):
            self._wake.release()                                # cloture d'une conversation active (R-1)

    def _on_overrun(self) -> None:
        # R-2 : l'audio a SAUTE (drop-oldest) -> le contexte local-agreement est rompu et le DEBUT du groupe
        # est perdu (plus de « premier mot intact »). On reset le contexte et on RE-ANCRE la marque au curseur
        # courant (honnete : apres le trou) ; le portier pourra re-reveiller si « sophia » apparait apres.
        self._overruns += 1
        self._audio = np.zeros(0, dtype=np.float32)
        self._hypo = HypoBuffer()
        self._trim_off = 0
        self._last_call_end = 0
        self._min_nsp = 1.0
        self._mark = self._cursor.position
        self._woke = False
        # V5 (S-1, audit solo conv 45) : le trou rompt AUSSI le tour -> repartir PROPRE. Sans ca, `_turn_audio`
        # garderait l'audio d'AVANT le trou (Smart Turn sur du perime) et `parle=(_seg_stop-_mark)` pourrait
        # devenir NEGATIF (l'ancien _seg_stop < la marque re-ancree). Fin de tour re-evaluee apres le trou.
        self._turn_audio = np.zeros(0, dtype=np.float32)
        self._turn_plaf = GROUP_SILENCE_S
        self._last_turn_reason = None
        self._last_turn_prob = None

    def _abort_group(self) -> None:
        """V7 morceau C : SA voix joue alors qu'un groupe d'ecoute est ouvert -> on JETTE le groupe (retour IDLE),
        fidele au banc qui droppait la parole superposee pendant qu'elle repondait (_flush_audio, oreilles_live:
        1298). PAS d'evt.stt.final ni de portier (le groupe est ABANDONNE, pas fini : ne rien reveiller/fermer sur
        un fragment enjambant sa voix). A la reprise, un vad.start FRAIS ouvrira un groupe propre a la marque
        post-residu. Ramene EXACTEMENT a l'etat repos (memes champs que la fin de _finalize + le reset de contexte),
        et jette les marques VAD en backlog de la periode mutee. L'overlap INTENTIONNEL de Yohann (barge-in) = V8.

        FRONTIERE d'aval (parite R-1 / F-A / F-B, re-croise conv 47) : si le groupe avait DEJA emis des
        `evt.stt.partial` (Yohann a parle >= STT_MIN_WIN pendant la latence cerveau), l'abandon les laisse
        ORPHELINS (aucun `evt.stt.final`/`evt.turn.end` ne suit). C'est VOULU (l'overlap est droppe, fidele au banc)
        -> l'aval (routeur V9) ne DOIT JAMAIS traiter un `evt.stt.partial` comme un engagement : un partiel est
        PROVISOIRE jusqu'au final, et un abort (comme un overrun) peut l'abandonner."""
        self._aborts += 1
        self._active = False
        self._reading = False
        self._seg_stop = None
        self._audio = np.zeros(0, dtype=np.float32)
        self._hypo = HypoBuffer()
        self._trim_off = 0
        self._last_call_end = 0
        self._min_nsp = 1.0
        self._woke = False
        self._wake_check_pending = False
        self._turn_audio = np.zeros(0, dtype=np.float32)
        self._turn_plaf = GROUP_SILENCE_S
        self._last_turn_reason = None
        self._last_turn_prob = None
        self._discard_cmds()               # jette les marques VAD en backlog (rien a traiter au reveil du mute)

    def _safe_emit(self, etype: str, payload: dict) -> None:
        try:
            self._emit(etype, payload)
        except Exception:
            pass   # un emit qui echoue (bus arrete...) ne tue jamais la boucle de la prise (parite VadPlug)

    @property
    def state(self) -> dict:
        return {
            "active": self._active,
            "warm": self._warm,                 # V7 juge (conv 47) : worker chaud (modeles charges+chauffes) — temoin du bip
            "groups": self._groups,
            "partials": self._partials,
            "finals": self._finals,
            "overruns": self._overruns,
            "engine_errors": self._engine_errors,
            "compactions": self._compactions,
            "dropped_cmds": self._dropped_cmds,
            "aborts": self._aborts,             # V7 : groupes abandonnes (SA voix jouait) — gate anti-auto-ecoute
            "gate_errors": self._gate_errors,   # V7 : gate qui a leve (fail-open) — jamais en silence
            "last_fast_ms": self._last_fast_ms,
            "last_final": self.last_final,
            # V5 (fin de tour fine) — inertes si turn=None
            "turn_enabled": self._turn is not None,
            "turns_ended": self._turns_ended,
            "turn_errors": self._turn.errors if self._turn is not None else 0,
            "last_turn_prob": self._last_turn_prob,
            "last_turn_reason": self._last_turn_reason,
        }
