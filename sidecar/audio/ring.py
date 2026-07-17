"""Sophia — sidecar / chemin audio (plan 01, V0) : le RING BUFFER central.

UN flux audio, rembobinable, partage par plusieurs consommateurs a curseurs INDEPENDANTS.

Patron SPMC (single-producer, multi-consumer) :
  - UN ecrivain = la capture (le sidecar ouvre le micro une fois, V0) ;
  - N lecteurs = les consommateurs (VAD, wake, STT, fin de tour, speaker, affect...) ;
  - un lecteur LENT ou MORT ne bloque JAMAIS l'ecrivain ni les autres : il perd les donnees trop
    vieilles (overrun = drop-oldest, SIGNALE) au lieu de faire du back-pressure.

Invariants (plan 01 §5 / socle) :
  - RAM sidecar UNIQUEMENT : jamais le WAL, jamais l'IPC (l'audio ne traverse pas le canal) ;
  - sidecar SANS etat durable : le ring se reconstruit a chaque respawn (V15) ;
  - int16 mono a la cadence d'entree (16 kHz apres conversion, V0).

Positions LOGIQUES monotones = un compteur d'echantillons depuis le debut, jamais de wrap (entier
Python illimite) ; l'indexation PHYSIQUE dans le tampon circulaire = pos % capacite. Le rembobinage
(fenetre pre-wake, F1) = reculer un curseur dans la fenetre encore disponible.
"""
from __future__ import annotations

import threading
import time
from collections import deque

import numpy as np


class RingBuffer:
    """Tampon circulaire audio int16, thread-safe, SPMC. Ecrivain unique via write() ; lecteurs via cursor()."""

    def __init__(self, capacity_samples: int, sample_rate: int = 16000):
        cap = int(capacity_samples)   # borne AVANT la garde (R#7 : RingBuffer(0.5) ne doit pas passer puis cap=0)
        if cap <= 0:
            raise ValueError("capacity_samples doit etre > 0")
        self._buf = np.zeros(cap, dtype=np.int16)
        self._cap = cap
        self._rate = int(sample_rate)
        self._write_pos = 0            # compteur LOGIQUE monotone (echantillons ecrits depuis le debut)
        # Horodatage M2 DETERMINISTE : marques (position_debut_bloc, mono_s de capture) posees a chaque write,
        # bornees a la fenetre. time_at(pos) interpole depuis la marque encadrante -> valeur FIXE pour un pos
        # fixe (ne bouge PLUS au write suivant, R#5), ancree sur le temps de CAPTURE du bloc (pas le wall-clock courant).
        self._marks: deque[tuple[int, float]] = deque()
        self._lock = threading.Lock()

    @property
    def sample_rate(self) -> int:
        return self._rate

    @property
    def capacity(self) -> int:
        return self._cap

    def write(self, frame: np.ndarray, at_mono: float | None = None) -> None:
        """Ecrit un bloc int16 mono a la tete. `at_mono` = temps monotone de capture (defaut = maintenant)."""
        if frame.dtype != np.int16:
            frame = frame.astype(np.int16)
        frame = np.ascontiguousarray(frame.reshape(-1))
        n = int(frame.shape[0])
        if n == 0:
            return
        with self._lock:
            # Si le bloc depasse la capacite, ne garder que la QUEUE (les cap plus recents) ; dans tous les
            # cas ALIGNER l'ecriture sur la position LOGIQUE (physique = (write_pos + offset) % cap) pour
            # rester coherent avec _read (indexation pos % cap). Un gros bloc ecrit a l'index 0 casserait
            # cet alignement -> lecture dans le desordre (bug attrape par U-V0 overrun).
            tail = frame if n <= self._cap else frame[-self._cap:]
            m = int(tail.shape[0])
            start = (self._write_pos + (n - m)) % self._cap
            end = start + m
            if end <= self._cap:
                self._buf[start:end] = tail
            else:  # wrap
                k = self._cap - start
                self._buf[start:] = tail[:k]
                self._buf[: m - k] = tail[k:]
            mono = time.monotonic() if at_mono is None else at_mono
            self._marks.append((self._write_pos, mono))   # marque = temps de capture du DEBUT de ce bloc
            self._write_pos += n
            # purge : retirer les marques entierement hors fenetre (garder celle qui couvre `oldest`)
            oldest = self._write_pos - self._cap
            while len(self._marks) >= 2 and self._marks[1][0] <= oldest:
                self._marks.popleft()

    def write_pos(self) -> int:
        with self._lock:
            return self._write_pos

    def cursor(self, at_latest: bool = True) -> "RingCursor":
        """Cree un lecteur. at_latest=True -> au bord d'attaque (ne lit que le FUTUR) ; False -> au plus vieux dispo."""
        with self._lock:
            pos = self._write_pos if at_latest else max(0, self._write_pos - self._cap)
        return RingCursor(self, pos)

    def time_at(self, pos: int) -> float | None:
        """Temps de capture (MILLISECONDES monotone) de l'echantillon a la position LOGIQUE `pos` — horodatage
        M2 / captured_at. DETERMINISTE : interpole depuis la marque du bloc (une valeur FIXE pour un pos fixe,
        elle ne bouge plus au write suivant, R#5) ; en MS, aligne sur le `ts` d'enveloppe (socle `_now_ms`).
        None si rien n'a encore ete ecrit."""
        with self._lock:
            if not self._marks:
                return None
            mono = None
            for mpos, mmono in reversed(self._marks):   # la marque la plus recente avec mpos <= pos
                if mpos <= pos:
                    mono = mmono + (pos - mpos) / self._rate
                    break
            if mono is None:                            # pos anterieur a toutes les marques -> la plus vieille
                # best-effort pour un curseur EN RETARD non-lu (extrapole en arriere sous cadence uniforme ;
                # peut deriver a travers une coupure de capture). Le chemin reel borne les curseurs a `oldest`
                # au read -> `captured_at` n'est appele que sur des positions lisibles (jamais cette branche).
                mpos, mmono = self._marks[0]
                mono = mmono + (pos - mpos) / self._rate
            return mono * 1000.0

    # ── acces reserve aux curseurs (tout sous lock : l'ecrivain peut ecraser la zone pendant qu'on lit) ──
    def _read(self, read_pos: int, max_n: int):
        with self._lock:
            oldest = max(0, self._write_pos - self._cap)
            overrun = 0
            if read_pos < oldest:            # ce lecteur a ete DISTANCE -> saute au plus vieux dispo (drop-oldest)
                overrun = oldest - read_pos
                read_pos = oldest
            avail = self._write_pos - read_pos
            n = min(int(max_n), avail)
            if n <= 0:
                return read_pos, np.empty(0, dtype=np.int16), overrun
            start = read_pos % self._cap
            end = start + n
            if end <= self._cap:
                out = self._buf[start:end].copy()      # copie sous lock : immunise contre l'ecrasement concurrent
            else:
                k = self._cap - start
                out = np.concatenate([self._buf[start:], self._buf[: n - k]])
            return read_pos + n, out, overrun

    def _clamp_rewind(self, pos: int, n: int) -> int:
        with self._lock:
            oldest = max(0, self._write_pos - self._cap)
            return max(oldest, min(pos, self._write_pos) - int(n))

    def _clamp_seek(self, pos: int) -> tuple[int, int]:
        # Position LOGIQUE absolue `pos` bornee a [oldest, write_pos]. Retourne (clamped, truncated_left) :
        # truncated_left = echantillons perdus A GAUCHE parce que `pos` est sorti de la fenetre (< oldest) — la
        # marque n'est plus rembobinable en entier (V3 : garde d'honnetete, « premier mot ampute »). 0 si intact.
        # `pos > write_pos` (futur non ecrit, cas anormal) -> clamped au present, pas une troncature a gauche.
        # `pos < 0` n'a AUCUN sens (les positions logiques sont >= 0) : borne a 0 -> truncated exact (jamais
        # surcompte) au lieu de gonfler `oldest - pos` d'une entree absurde (garde de robustesse du primitif ;
        # une vraie marque VAD est toujours >= 0, mais V4/le hook de test peuvent passer n'importe quel int).
        pos = max(0, int(pos))
        with self._lock:
            oldest = max(0, self._write_pos - self._cap)
            clamped = max(oldest, min(pos, self._write_pos))
            truncated = oldest - pos if pos < oldest else 0
            return clamped, truncated

    def _latest(self) -> int:
        with self._lock:
            return self._write_pos

    def _available(self, read_pos: int) -> int:
        with self._lock:
            oldest = max(0, self._write_pos - self._cap)
            return self._write_pos - max(read_pos, oldest)


class RingCursor:
    """Lecteur INDEPENDANT sur un RingBuffer. Chaque consommateur a le sien ; ils n'interferent pas.
    ATTENTION (R#9) : un curseur = UN thread. `_pos` est lu/ecrit sans lock -> ne PAS partager un curseur
    entre threads (le RingBuffer, lui, est thread-safe ; c'est le curseur qui est mono-thread par contrat)."""

    def __init__(self, ring: RingBuffer, pos: int):
        self._ring = ring
        self._pos = pos

    @property
    def position(self) -> int:
        return self._pos

    def available(self) -> int:
        """Echantillons lisibles maintenant (bornes a la fenetre encore disponible)."""
        return self._ring._available(self._pos)

    def read(self, max_n: int):
        """Lit jusqu'a `max_n` echantillons depuis la position courante. Retourne (data int16, overrun).
        `overrun` > 0 = nb d'echantillons SAUTES parce que ce lecteur avait ete distance (drop-oldest)."""
        self._pos, data, overrun = self._ring._read(self._pos, max_n)
        return data, overrun

    def rewind(self, n: int) -> None:
        """Recule de `n` echantillons (rembobinage pre-wake, F1), borne au plus vieux echantillon disponible."""
        self._pos = self._ring._clamp_rewind(self._pos, n)

    def rewind_seconds(self, seconds: float) -> None:
        self.rewind(int(seconds * self._ring.sample_rate))

    def seek_latest(self) -> None:
        """Se replace au bord d'attaque (abandonne le retard accumule : ne lira que le futur)."""
        self._pos = self._ring._latest()

    def seek_to(self, pos: int) -> int:
        """Place le curseur a la position LOGIQUE ABSOLUE `pos` (la marque VAD que V3 rembobine), bornee a
        [oldest, write_pos] — symetrique de seek_latest(). Retourne le nb d'echantillons TRONQUES a gauche :
        > 0 si la marque est sortie de la fenetre (rembobinage incomplet -> premier mot ampute) ; 0 si intact.
        Garde d'honnetete V3 : l'appelant ne pretend « premier mot intact » que si le retour est 0."""
        self._pos, truncated = self._ring._clamp_seek(pos)
        return truncated

    def captured_at(self) -> float | None:
        """Temps de capture (ms monotone, deterministe) de l'echantillon a la position courante (M2 / captured_at)."""
        return self._ring.time_at(self._pos)
