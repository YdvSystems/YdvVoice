"""Sophia — sidecar / BUS d'evenements (plan 01, V2).

V0/V1 ne font que REMPLIR le ring (`/debug` les sonde par polling). **V2 est le PREMIER a EMETTRE des
`evt.*`** vers l'orchestrateur, et il le fait depuis un THREAD DE FOND (la prise VAD). Or aiohttp envoie
sur la BOUCLE asyncio. Ce bus fait le pont :

  prise (thread) --publish_threadsafe--> call_soon_threadsafe --_fanout(boucle)--> file par abonne
                                                                                       (le WS draine la sienne)

Chaque abonne (un handler WS) a sa propre file BORNEE : si un client est lent, on jette le PLUS VIEUX
(drop-oldest + compteur), JAMAIS de back-pressure sur le producteur — meme philosophie que le ring SPMC
(V0). Les `evt.*` sont bas-debit (quelques par tour) -> une file de quelques centaines suffit largement.

Invariant socle : l'AUDIO ne traverse JAMAIS ce bus — uniquement des enveloppes `evt.*` JSON (le
vocabulaire du plan) ; l'audio reste dans le ring (RAM sidecar).
"""
from __future__ import annotations

import asyncio
from collections import deque

PER_SUB_MAX = 256   # profondeur de file par abonne (events bas-debit -> large marge ; borne la RAM si un WS cale)


def _enqueue_drop_oldest(q: deque, item, maxlen: int) -> int:
    """Enfile `item` dans `q` bornee a `maxlen` ; si pleine, jette le PLUS VIEUX. Retourne le nb jete (>=0).
    PUR (deque + int) -> testable SYNCHRONEMENT, sans boucle asyncio (le cœur du drop-oldest, croise-able)."""
    dropped = 0
    while len(q) >= maxlen:
        q.popleft()
        dropped += 1
    q.append(item)
    return dropped


class Subscription:
    """File d'un abonne (un handler WS). `offer()` est appele SUR la boucle (via `_fanout`) ; `get()` est
    attendu par le drain du handler. Les deux tournent sur le MEME thread (la boucle) -> pas de lock (les
    ops deque + Event ne sont jamais preemptees entre elles hors d'un `await`)."""

    def __init__(self, maxlen: int = PER_SUB_MAX):
        self._q: deque = deque()
        self._maxlen = int(maxlen)
        self._ev = asyncio.Event()
        self.dropped = 0   # nb d'events jetes (client trop lent) — observable

    def offer(self, env: dict) -> int:
        """Depose un evenement (sur la boucle). Drop-oldest si plein, puis reveille le drain. Retourne le nb
        d'events jetes (0/1) -> le bus l'agrege pour l'observabilite (« + signal » du drop-oldest)."""
        d = _enqueue_drop_oldest(self._q, env, self._maxlen)
        self.dropped += d
        self._ev.set()
        return d

    async def get(self) -> dict:
        """Attend le prochain evt.* (drain du WS). `clear()` PUIS `wait()` sans `await` entre les deux ->
        aucun reveil manque (mono-thread : `offer` ne peut pas s'intercaler la)."""
        while not self._q:
            self._ev.clear()
            await self._ev.wait()
        return self._q.popleft()


class EventBus:
    """Pont thread-de-fond -> boucle -> abonnes WS. Une instance par sidecar, construite au demarrage (elle
    capture la boucle courante). Les prises publient via `publish_threadsafe` ; les handlers WS s'abonnent."""

    def __init__(self, loop: asyncio.AbstractEventLoop, per_sub_max: int = PER_SUB_MAX):
        self._loop = loop
        self._subs: set[Subscription] = set()
        self._max = int(per_sub_max)
        self._dropped_total = 0   # events jetes CUMULES sur tous les abonnes (« + signal » du drop-oldest, /debug)

    def subscribe(self) -> Subscription:
        s = Subscription(self._max)
        self._subs.add(s)
        return s

    def unsubscribe(self, s: Subscription) -> None:
        self._subs.discard(s)

    def publish_threadsafe(self, env: dict) -> None:
        """Appelable depuis N'IMPORTE QUEL thread (la prise VAD tourne dans son propre thread). Planifie le
        fan-out sur la boucle. Si la boucle est deja arretee (teardown), on laisse tomber en silence (pas
        d'exception qui remonterait dans le thread de la prise)."""
        try:
            self._loop.call_soon_threadsafe(self._fanout, env)
        except RuntimeError:
            pass   # boucle fermee (arret en cours) -> event perdu, sans consequence

    def _fanout(self, env: dict) -> None:
        """Sur la boucle : offre l'evenement a chaque abonne. `tuple(...)` fige la vue (un unsubscribe ne
        peut pas muter le set en cours d'iteration). Agrege les drops (un client lent -> visible dans /debug)."""
        for s in tuple(self._subs):
            self._dropped_total += s.offer(env)

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)

    @property
    def dropped_total(self) -> int:
        return self._dropped_total
