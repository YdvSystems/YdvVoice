"""Sophia — sidecar / chemin audio (plan 01, V1) : l'ANNULATION D'ECHO (AEC) en tete de chaine.

Le premier 🔴 du projet (M1). Sophia n'entend que les voix de la PIECE, jamais ce que le PC joue :
  near = micro (la piece + l'echo de la sortie)   ref = loopback (tout ce que le PC joue)
  cleaned = AEC(near, ref)  -> ecrit dans le ring (audio POST-AEC, technique/01 §3.2)

Consequence (invariant F2, technique/01 §5) : elle NE SE COUPE JAMAIS elle-meme, et un media qui joue
ne declenche aucun VAD/barge-in fantome. Prouve au banc conv 23 (SpeexDSP, ERLE ~30 dB, double-parole
preservee) + reproduit au venv unique conv 40 (ERLE 33 dB).

MOTEUR : SpeexDSP via `pyaec` (repli nomme du design, technique/01 §2.3 / plan §7). Derriere une INTERFACE
propre -> l'upgrade AEC neuronal (ONNX) reste un swap config+respawn (prise `aec`, non fuitee dans le
protocole). PREPROCESS OFF (`enable_preprocess=False`) : le denoise/AGC SpeexDSP distord l'entree du wake
(entraine sur voix brute -> faux reveils, decouvert I-6 ; conv 29 : le suppresseur de residu n'aidait pas).

Rate : AEC a 16 kHz (SpeexDSP sur-supprime le proche a 48 k, conv 23) -> near ET ref sont convertis a
16 kHz AVANT l'AEC (ecart de placement deja trace plan/01 §7, ici IMPLEMENTE). Trame = 160 (10 ms) ;
queue de filtre = 3200 (200 ms : la barre de son ~150 ms de latence, conv 23).

Import pyaec PARESSEUX : le module s'importe sans peripherique ni DLL chargee (tests/one-shot).
"""
from __future__ import annotations

import numpy as np

RATE = 16000
FRAME = 160        # 10 ms @ 16 kHz — pas de traitement de l'AEC
TAIL = 3200        # 200 ms de queue de filtre (barre de son ~150 ms, conv 23)


class EchoCanceller:
    """Contrat AEC : `process(near_frame, ref_frame) -> cleaned_frame`, trames de FRAME int16 mono @ 16 kHz.
    Moteur SpeexDSP derriere (interchangeable, V15). L'engin est cree PARESSEUSEMENT au 1er process (import
    pyaec differe -> le module reste importable sans la DLL). Mono-thread par contrat (un seul thread de
    conversion l'appelle — l'ecrivain unique du ring, invariant SPMC V0)."""

    def __init__(self, frame: int = FRAME, tail: int = TAIL, rate: int = RATE, enable_preprocess: bool = False):
        self._frame = int(frame)
        self._tail = int(tail)
        self._rate = int(rate)
        self._pre = bool(enable_preprocess)   # FERME a False : le preprocess distord le wake (voir en-tete)
        self._aec = None                      # cree au 1er process (import pyaec paresseux)

    @property
    def frame(self) -> int:
        return self._frame

    @property
    def tail(self) -> int:
        return self._tail   # M-B : la capture borne l'avance ref sur near a ~cette queue de filtre

    def _ensure(self) -> None:
        if self._aec is None:
            from pyaec import Aec   # import PARESSEUX (la DLL SpeexDSP n'est chargee qu'ici)
            self._aec = Aec(self._frame, self._tail, self._rate, self._pre)

    def process(self, near_frame: np.ndarray, ref_frame: np.ndarray) -> np.ndarray:
        """Annule l'echo de `ref` present dans `near` -> `cleaned` (meme longueur, int16). `ref` = zeros
        quand rien ne joue (loopback silencieux) : l'AEC laisse alors passer le proche ~intact (passthrough,
        chemin degrade « sans reference »)."""
        self._ensure()
        near = np.ascontiguousarray(near_frame, dtype=np.int16).reshape(-1)
        ref = np.ascontiguousarray(ref_frame, dtype=np.int16).reshape(-1)
        if near.shape[0] != self._frame or ref.shape[0] != self._frame:
            # #5 (croise conv 40) : pyaec prend `len(near)` comme taille de trame — PAS le 160 configure a la
            # creation. Une trame de longueur != FRAME ferait un OOB C sur l'etat Speex (dimensionne pour FRAME).
            # On REFUSE net (le contrat = trames de FRAME) : l'appelant AecCapture passe toujours exactement
            # FRAME ; cette garde ferme le contrat en dur -> une erreur Python comptee, jamais un OOB C silencieux.
            raise ValueError(f"trame AEC {near.shape[0]}/{ref.shape[0]} != FRAME attendu {self._frame}")
        # cancel_echo attend des listes Python int (binding pyaec) ; renvoie une liste -> int16.
        cleaned = self._aec.cancel_echo(near.tolist(), ref.tolist())
        return np.asarray(cleaned, dtype=np.int16)
