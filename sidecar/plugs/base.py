"""Sophia — sidecar / patron de PRISE (plan 01, 01-F / V0).

Chaque ROLE du pipeline (wake, vad, stt, turn, speaker, affect, tts...) = un CONTRAT : des operations
et des EVENEMENTS NORMALISES. Le MOTEUR concret (silero, livekit, faster-whisper, piper, ECAPA...) vit
DERRIERE ce contrat et ne fuit JAMAIS dans le protocole ; on le choisit par config au spawn (V15 :
changer de moteur = config + respawn, memes evenements en sortie).

V0 pose l'abstraction (contrat + boucle de consommation) ; les moteurs la peuplent a partir de V1.
"""
from __future__ import annotations

import threading
from typing import Callable

import numpy as np

# Emet un evenement NORMALISE vers le canal (evt.*). Le contenu = le vocabulaire du plan (evt.vad.start,
# evt.wake, ...) ; l'audio, lui, ne passe JAMAIS par la (invariant socle) — il reste dans le ring.
Emit = Callable[[str, dict], None]


class Plug:
    """Contrat de base d'un role. `name` = le role ; start()/stop() = cycle de vie. Le moteur est derriere."""

    name: str = "plug"

    def start(self) -> None:  # a surcharger
        raise NotImplementedError

    def stop(self) -> None:  # a surcharger
        raise NotImplementedError


class ConsumerPlug(Plug):
    """Prise d'ANALYSE : consomme le ring via un curseur INDEPENDANT dans un thread dedie, emet des evt.*
    normalises. Un consommateur lent/mort ne bloque pas les autres : son curseur SAUTE les donnees trop
    vieilles (overrun signale via `plug.overrun`), jamais de back-pressure sur la capture (SPMC, V0)."""

    def __init__(self, name: str, ring, emit: Emit, hop_samples: int = 160):
        self.name = name
        self._ring = ring
        self._cursor = ring.cursor()      # au bord d'attaque : ne consomme que le futur (rembobinage explicite si besoin)
        self._emit = emit
        self._hop = int(hop_samples)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    @property
    def cursor(self):
        return self._cursor

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name=f"plug-{self.name}", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.is_set():
            data, overrun = self._cursor.read(self._hop)
            if overrun:
                # SIGNALE (jamais silencieux) : ce consommateur a ete distance -> il a saute `overrun` echantillons.
                # Nom dans la famille `evt.*` (le contrat, cf. typedef Emit) -> se ponte tel quel au canal WS (V1+).
                try:
                    self._emit("evt.plug.overrun", {"plug": self.name, "dropped": int(overrun)})
                except Exception:
                    pass
            if data.size:
                try:
                    self.process(data)
                except Exception:  # un moteur qui trebuche sur un bloc ne tue pas sa boucle (ni les autres prises)
                    pass
            else:
                self._stop.wait(0.005)  # rien a lire : courte attente (pas de busy-loop) ; reveille par stop()

    def process(self, data: np.ndarray) -> None:
        """Le MOTEUR concret (V1+) surcharge ceci : il analyse `data` (int16 mono 16 kHz) et emet ses
        evt.* via self._emit. Base = no-op (V0 : le contrat existe, le moteur viendra)."""
        pass

    def stop(self) -> None:
        self._stop.set()
        t = self._thread
        if t is not None:
            t.join(timeout=1.0)
            if t.is_alive():
                # Le moteur est bloque dans process() > 1 s (ex. une inference figee) : on NE bloque PAS l'arret
                # indefiniment. Le thread est daemon (il meurt avec le process). On SIGNALE (jamais silencieux) et
                # on garde `_thread` non-None -> un start() ulterieur ne relance PAS un 2e thread sur le MEME
                # curseur (R#9 : le curseur n'est pas thread-safe, un seul thread doit le lire).
                try:
                    self._emit("evt.plug.stuck", {"plug": self.name})
                except Exception:
                    pass
                return
        self._thread = None
