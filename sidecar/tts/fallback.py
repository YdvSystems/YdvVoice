# -*- coding: utf-8 -*-
"""Sophia — sidecar / TTS : la PHRASE DE SECOURS (plan 01, V13 · F7/S11/B2). « Jamais de silence. »

Si le CANAL de l'orchestrateur tombe (WS coupé ANORMALEMENT — crash de la boucle Node, socket cassé)
pendant que Yohann lui parle, les OREILLES le DISENT — une fois par épisode de panne, en entier, puis
silence (technique/01 §4.7). Symétrique du DÉGRADÉ_SANS_VOIX du socle : ici c'est la voix qui survit
sans cerveau, honnêtement.

PORTÉE HONNÊTE (FID-M2/M4 croisé conv 58, tracée §7) — le filet couvre « le canal coupé, les oreilles
vivantes » ; il NE couvre PAS :
  - la mort du PROCESS Electron : le Job Object du socle (conv 35, VOULU) emporte les sidecars avec lui
    → personne ne peut plus parler (le voyant systray disparaît aussi = le signal) ;
  - l'orchestrateur GELÉ (process vivant, WS ouvert mais muet) : indétectable sans heartbeat descendant
    (le protocole n'en a pas — frontière) ;
  - une déconnexion PROPRE (close frame — arrêt T6, `IpcClient.close()`) : un départ VOLONTAIRE n'est
    jamais une panne → l'épisode est consommé (`episode_consume`), aucune phrase pendant que Yohann
    quitte l'app. Seule la coupure ANORMALE (close_code ∉ {0, 1000, 1005} — 1006 mort du process, None,
    codes applicatifs) laisse l'épisode jouable (codes MESURÉS au banc : `close()` nominal → 0, PAS 1005).
Le « voyant systray » de S11 : IMPOSSIBLE pendant l'épisode (le voyant EST l'orchestrateur parti) — la
phrase l'a dit une fois ; au retour de l'app, le boot repart propre (relecture d'épisode = chantier UI
différé, tracé §7).

DEUX ÉCARTS DE CONCEPTION ACTÉS (décision A conv 58, patron V11/V12 — tracés plan/01 §7) :
  - B2 réinterprété : le gravé disait « charge Kokoro → synthétise → décharge » (frontière VRAM). La
    bouche du produit est Piper A20 CPU → l'« autorisation transitoire » = un moteur Piper chargé EN RAM
    le temps de la pré-synthèse, puis LIBÉRÉ (l'esprit de B2 — une autorisation qui se referme, aucune
    résidence ajoutée — est tenu ; la frontière VRAM n'est pas concernée).
  - « le sidecar, seul, joue » a été écrit au temps du MONOLITHE ; le produit = 2 process (conv 47). La
    DÉTECTION (le serveur WS voit ses clients) et le DÉCLENCHEUR (la fin du tour) ne sont observables que
    dans les OREILLES → le filet ENTIER y vit : cmd.tts.cache y pré-synthétise (Piper transitoire) et y
    garde le cache RAM ; en épisode, les oreilles JOUENT le WAV elles-mêmes (sortie sounddevice — la
    cohabitation avec pyaudiowpatch est prouvée b1 conv 47 ; le loopback capte → l'AEC annule (F2) → pas
    d'auto-écoute). Jouer un WAV pré-rendu ≈ 0 CPU → la contention qui a motivé les 2 process (la SYNTHÈSE
    sous charge, diag_contention conv 47) ne s'applique pas ; en épisode il n'y a AUCUNE conversation.

RÈGLES S11 (gravées §4.7, tenues À LA SOURCE) :
  - déclencheur UNIQUE = la fin du tour, JAMAIS le wake seul : `_gate_check` (stt.py) peut émettre
    `evt.wake` en PLEIN MILIEU d'une phrase qui continue (« Bonjour Sophia, dis-moi... ») → le réveil ne
    déclenche qu'à l'APPARIEMENT wake↔final du MÊME mark (les deux ordres existent : lecture rapide et
    portier-au-fil émettent wake AVANT final ; le portier-au-finalize émet final AVANT wake — vérifiés à
    la source stt.py conv 58) — l'appariement garantit un déclenchement POST-clôture du groupe dans tous
    les chemins. En conversation, `evt.turn.end` (émis à la finalisation, jamais mid-phrase) suffit seul.
  - la parole AMBIANTE en veille (evt.stt.final SANS wake — Yohann parle à quelqu'un d'autre) ne
    déclenche JAMAIS : elle n'est pas sollicitée, elle se tait.
  - EXEMPTE DE BARGE-IN par construction : la lecture vit HORS du circuit tts/purge (un thread one-shot
    → `Output.play` bloquant joue EN ENTIER ; rien dans les oreilles ne route une coupure).
  - UNE FOIS par épisode : le flag ferme aussi la boucle « résidu post-AEC → tour fantôme → re-phrase »
    par construction. L'épisode se CLÔT à la connexion d'un client WS (`episode_reset`, ws_handler).

Moteur (pré-synthèse) ET sortie (lecture) INJECTABLES (patron 01-F : la logique se teste sans Piper ni
audio réel ; l'E2E-V13 exerce le VRAI Piper). `for_synth` (lexique/prononciation) est appliqué par le
moteur lui-même (PiperEngine.synth) → la phrase de secours a la MÊME prononciation que sa voix normale.
"""
from __future__ import annotations

import threading
import time

import numpy as np

from tts.plug import Output, SdOutput

# Le nom de la phrase jouée en épisode de panne (convention du payload cmd.tts.cache : l'orchestrateur
# envoie [{name, text}] — le CONTENU est le sien, domaine personnalité/03 ; le sidecar ne connaît que des
# clés). Absente du cache → on joue la PREMIÈRE entrée (ordre d'envoi) ; cache vide → silence honnête.
PRIMARY_PHRASE = "secours"


class FallbackGuard:
    """La machine d'ÉPISODE (logique PURE, testable sans thread ni audio). Décide « jouer MAINTENANT ? »
    à partir du vocabulaire `evt.*` observé + du nombre de clients WS (`clients`, callable injecté).

    Fail-quiet : si `clients()` LÈVE, on répond « ne pas jouer » (compté) — parler à tort PAR-DESSUS une
    conversation normale (client présent qu'on n'a pas su lire) serait pire que rater une phrase de
    secours. Thread-safe : `on_event` arrive du thread STT (emit wrappé), `episode_reset`/`episode_consume`
    de la boucle asyncio → état sous lock (patron WakeGate).

    Edges tracés (bénins, même famille) : `evt.wake.pos` = la position du curseur APRÈS clamp (wake.py)
    → en cas de troncature (marque hors fenêtre 30 s — rarissime), pos ≠ mark → pas d'appariement → pas
    de phrase sur CE tour (le suivant la jouera) ; un OVERRUN (stt.py `_on_overrun` ré-ancre `_mark` et
    remet `_woke`) casse pareillement la paire en cours → même issue. Jamais un faux déclenchement."""

    def __init__(self, clients):
        self._clients = clients
        self._lock = threading.Lock()
        self._played = False          # une fois par épisode (S11)
        self._epoch = 1               # re-croisé conv 58 (ROB2-3) : l'ÉPOQUE de l'épisode — tourne à chaque
        #                               reset (reconnexion) → un candidat/consommation PÉRIMÉ (décidé dans
        #                               l'épisode d'avant) ne touche JAMAIS l'épisode neuf. Démarre à 1
        #                               (jamais falsy — `on_event` rend l'époque ou None).
        self._wake_pos: int | None = None    # dernier evt.wake vu (pos) — moitié de la paire du réveil
        self._final_mark: int | None = None  # dernier evt.stt.final vu (mark) — l'autre moitié
        self._clients_errors = 0      # clients() qui lève (fail-quiet) — compté, jamais avalé

    def episode_reset(self) -> None:
        """Un client WS s'est (re)connecté → l'épisode de panne est CLOS. Le prochain épisode rejouera la
        phrase (une fois). Les moitiés de paire en cours n'ont plus d'objet (le client traite). L'ÉPOQUE
        tourne (ROB2-3) : un `try_consume` tardif d'un candidat de l'ANCIEN épisode sera jeté."""
        with self._lock:
            self._played = False
            self._epoch += 1
            self._wake_pos = None
            self._final_mark = None

    def episode_consume(self) -> None:
        """ROB-M4 (croisé conv 58) : une déconnexion WS PROPRE (close frame — `IpcClient.close()`, l'arrêt
        T6, une connexion éphémère) n'est JAMAIS une panne : l'orchestrateur a choisi de partir. On marque
        l'épisode consommé → aucune phrase de secours pendant un arrêt VOLONTAIRE (le filet mentirait :
        « mon cerveau ne répond pas » pendant que Yohann quitte l'app). Un CRASH réel n'envoie pas de close
        frame (close_code 1006) → l'épisode reste jouable. La prochaine connexion refait `episode_reset`."""
        with self._lock:
            self._played = True

    def try_consume(self, epoch: int) -> bool:
        """ROB-M2 + re-croisé conv 58 (ROB2-1/ROB2-3) : la CONSOMMATION de l'épisode (« une fois ») est un
        TEST-AND-SET ATOMIQUE au LANCEMENT réel de la lecture — appelée par `FallbackVoice._play_fallback`
        quand le play part vraiment, avec l'ÉPOQUE capturée à la DÉCISION (`on_event`). Sous le lock :
        deux candidats simultanés → UN seul gagne (« une fois » tenu par le CODE, plus par la convention
        « émetteur unique = le worker STT ») ; un `episode_reset` (reconnexion) tombé dans la fenêtre
        décision→lancement → l'époque a tourné → le candidat PÉRIMÉ est jeté (l'épisode NEUF reste vierge,
        sa phrase ne lui est jamais volée). Un candidat qui n'aboutit PAS (cache vide §4.7, lecture en vol,
        stop) n'appelle pas ceci → ne consomme RIEN (le prochain tour re-candidate)."""
        with self._lock:
            if self._played or epoch != self._epoch:
                return False
            self._played = True
            return True

    def unconsume(self, epoch: int) -> None:
        """re-croisé conv 58 (ROB2-4) : le lancement a échoué APRÈS la consommation (`Thread.start` qui
        lève — épuisement de threads OS, process en agonie) → l'épisode est RENDU (rien n'a joué, le
        prochain tour re-candidate) — sauf si l'époque a tourné entre-temps (l'épisode neuf est déjà
        vierge, on n'y touche pas)."""
        with self._lock:
            if epoch == self._epoch:
                self._played = False

    def on_event(self, mtype: str, payload: dict) -> int | None:
        """Observe le vocabulaire `evt.*` (emit wrappé — les prises verrouillées ne sont PAS touchées,
        patron V3). Retourne l'ÉPOQUE de l'épisode = « CANDIDAT : la phrase de secours peut jouer
        maintenant » (None sinon) — la consommation (« une fois par épisode ») se fait au LANCEMENT réel
        (`try_consume(epoch)`, atomique), pas ici ; l'époque rendue ancre le candidat à SON épisode.
        Robuste : un payload malformé ne lève JAMAIS (parité WakeGate.observe)."""
        if mtype == "evt.turn.end":
            # Un tour de CONVERSATION s'est fini. Émis par `_finalize` (stt.py) — post-clôture du groupe
            # dans le chemin nominal ; UNE exception tracée (FID-M3 croisé conv 58) : le filet RETRO_MAX
            # d'un groupe rétroactif (post-barge) peut finaliser à mark+8s EN PLEINE parole — confluence
            # rarissime (barge → coupure WS → monologue > 8 s), message court et vrai → assumé, tracé §7.
            with self._lock:
                return self._maybe_play_locked()
        if mtype == "evt.wake":
            pos = self._int_of(payload, "pos")
            if pos is None:
                return None
            with self._lock:
                self._wake_pos = pos
                return self._check_pair_locked()
        if mtype == "evt.stt.final":
            mark = self._int_of(payload, "mark")
            if mark is None:
                return None
            with self._lock:
                self._final_mark = mark
                return self._check_pair_locked()
        return None

    @staticmethod
    def _int_of(payload: dict, key: str) -> int | None:
        try:
            v = payload[key]
            if isinstance(v, bool):
                return None
            return int(v)
        except (KeyError, TypeError, ValueError):
            return None

    def _check_pair_locked(self) -> int | None:
        """L'APPARIEMENT du réveil (S11) : wake ET final du MÊME mark vus (n'importe quel ordre) = le TOUR
        de réveil est CLOS → candidat. La paire est CONSOMMÉE (client présent ou pas) : un vieux wake ne
        s'apparie jamais avec un final futur d'un autre groupe."""
        if self._wake_pos is None or self._final_mark is None or self._wake_pos != self._final_mark:
            return None
        self._wake_pos = None
        self._final_mark = None
        return self._maybe_play_locked()

    def _maybe_play_locked(self) -> int | None:
        """Sous lock. CANDIDAT (→ l'époque courante) si : pas encore joué CET épisode ET aucun client WS
        (l'orchestrateur est parti — « le serveur voit ses clients », technique/01 §2.2). NE consomme PAS
        (`try_consume(epoch)` le fait au lancement réel — ROB-M2 : un candidat sans lancement ne tue
        jamais l'épisode ; l'époque rendue ancre le candidat à SON épisode, ROB2-3)."""
        if self._played:
            return None
        try:
            if int(self._clients()) > 0:
                return None
        except Exception:
            self._clients_errors += 1
            return None               # fail-quiet : dans le doute, ne PAS parler par-dessus (voir docstring)
        return self._epoch

    @property
    def state(self) -> dict:
        with self._lock:
            return {
                "played_this_episode": self._played,
                "episode_epoch": self._epoch,       # ROB2-3 : tourne à chaque reset — visible au /debug
                "wake_pos": self._wake_pos,
                "final_mark": self._final_mark,
                "clients_errors": self._clients_errors,
            }


class FallbackVoice:
    """La prise de SECOURS des oreilles (V13) : cache pré-synthétisé (cmd.tts.cache) + garde d'épisode +
    lecture. PAS un `ConsumerPlug` (elle ne lit pas le ring — pas de thread permanent, pas de curseur) :
    deux threads ONE-SHOT seulement (pré-synthèse ; lecture), à la demande.

      cmd.tts.cache {phrases:[{name,text}]} → thread : PiperEngine transitoire → synth (for_synth →
      lexique/prononciation) → cache RAM {name → (audio, sr)} → moteur LIBÉRÉ (B2 réinterprété).
      evt.turn.end / paire wake↔final observés (emit wrappé) + 0 client WS → thread : Output.play (en
      entier, exempte de barge-in par construction) + evt.fallback.played (observabilité, evt.* extensible).

    Idempotent : les MÊMES textes (clé = tuple trié (name,text)) ne se re-synthétisent pas — le boot
    nominal envoie cmd.tts.cache DEUX fois (hook phase 5 + ensureVoicePipeline) → un seul travail. Un
    precache EN VOL avec la même clé → no-op (la clé en vol compte). Un échec de warm laisse l'ANCIEN
    cache intact (mieux qu'un filet vidé). Erreur par phrase → comptée, les autres continuent."""

    name = "fallback"

    # ROB-M1 (croisé conv 58) : deadline d'un VOL de pré-synthèse. Le warm réel mesuré ~3,5 s → 30 s = marge
    # ×8. Au-delà, le vol est déclaré MORT (thread zombie — warm Piper qui PEND, la classe de hang que T6
    # assume pour WASAPI) : compté, la clé pendante abandonnée, un NOUVEAU precache autorisé — le filet ne
    # meurt plus À VIE sur un hang, et l'ack « déjà en vol » ne ment plus éternellement.
    STALE_S = 30.0

    def __init__(self, emit, clients, engine_factory=None, output: Output | None = None,
                 stale_s: float | None = None):
        self._emit = emit
        self._guard = FallbackGuard(clients)
        if engine_factory is None:
            def engine_factory():
                from tts.engine import PiperEngine   # import local : la logique se teste sans piper installé
                return PiperEngine()
        self._engine_factory = engine_factory
        self._output = output if output is not None else SdOutput()
        self._stale_s = float(stale_s) if stale_s is not None else self.STALE_S
        self._lock = threading.Lock()
        self._cache: dict[str, tuple[np.ndarray, int]] = {}
        self._cache_key: tuple | None = None      # clé du dernier precache RÉUSSI (idempotence)
        self._pending_key: tuple | None = None    # clé du precache EN VOL (double envoi boot → un seul travail)
        self._pending_since = 0.0                 # ROB-M1 : début (monotonic) du vol — la deadline STALE s'y mesure
        self._precache_gen = 0                    # ROB-M1 : GÉNÉRATION du vol (patron V12 SOLO-2) — un worker zombie
        #                                           ressuscité ne pose JAMAIS son vieux cache par-dessus un frais
        self._precache_thread: threading.Thread | None = None
        self._play_thread: threading.Thread | None = None
        self._stopped = False
        # observabilité (jamais d'échec avalé — standard maison)
        self._precaches = 0
        self._precache_stalled = 0                # ROB-M1 : vols déclarés morts (hang) — visible au /debug
        self._synth_errors = 0
        self._played_count = 0
        self._play_errors = 0
        self._play_skips = 0                      # ROB-M2 : candidats non lancés (lecture en vol) — jamais avalé
        self._last_played: str | None = None

    # ── pré-synthèse (cmd.tts.cache) ─────────────────────────────────────────────
    def precache(self, phrases) -> dict:
        """Lance la pré-synthèse EN FOND (thread one-shot — Piper bloque ~1-2 s : jamais sur la boucle
        asyncio ni le thread STT). Ack IMMÉDIAT (le gravé §4.7 ASSUME la courte fenêtre avant la fin de
        pré-synthèse — et depuis ROB-M2, un tour tombé dans cette fenêtre ne CONSOMME pas l'épisode : la
        phrase jouera au tour suivant, dès le cache posé). Retourne un dict d'ack honnête pour le handler."""
        items: list[tuple[str, str]] = []
        try:
            for p in phrases:
                name = str(p["name"]).strip()
                text = str(p["text"]).strip()
                if name and text:
                    items.append((name, text))
        except (KeyError, TypeError, ValueError):
            return {"ok": False, "note": "payload invalide (phrases:[{name,text}] attendu)"}
        if not items:
            return {"ok": False, "note": "aucune phrase"}
        key = tuple(sorted(items))
        with self._lock:
            if self._stopped:
                return {"ok": False, "note": "fallback arrete"}
            if key == self._cache_key:
                return {"ok": True, "started": False, "note": "cache deja a jour (idempotent)"}
            if self._precache_thread is not None and self._precache_thread.is_alive():
                age = time.monotonic() - self._pending_since
                if age < self._stale_s:
                    if key == self._pending_key:
                        return {"ok": True, "started": False,
                                "note": f"pre-synthese deja en vol (idempotent, {age:.1f}s)"}
                    # SOLO-1 (conv 58) : une pre-synthese DIFFERENTE est en vol -> refus HONNETE (jamais deux
                    # moteurs Piper en parallele — HORS vol declare STALE : la relance ROB-M1 assume une
                    # coexistence TRANSITOIRE avec un zombie qui pend, bornee a +1 moteur par stale_s [FID2-4] —,
                    # jamais une course « le dernier thread fini gagne »). Le produit n'envoie qu'une liste
                    # CONSTANTE (jamais atteint) ; l'appelant re-enverra (ensureVoicePipeline).
                    return {"ok": False, "note": f"pre-synthese en vol (autres textes, {age:.1f}s) — renvoyer plus tard"}
                # ROB-M1 : le vol a depasse la deadline -> ZOMBIE (warm qui pend). On le declare MORT (compte),
                # on abandonne sa cle, on bump la GENERATION (son resultat tardif eventuel sera JETE — garde
                # generationnelle du worker) et on autorise ce precache -> le filet ne meurt jamais A VIE.
                self._precache_stalled += 1
            self._precache_gen += 1
            gen = self._precache_gen
            self._pending_key = key
            self._pending_since = time.monotonic()
            t = threading.Thread(target=self._precache_worker, args=(items, key, gen),
                                 name="fallback-precache", daemon=True)
            self._precache_thread = t
        t.start()
        return {"ok": True, "started": True, "count": len(items)}

    def _precache_worker(self, items: list[tuple[str, str]], key: tuple, gen: int) -> None:
        """Le thread de pré-synthèse : charge un moteur TRANSITOIRE, synthétise, range, LIBÈRE (B2
        réinterprété — l'autorisation se referme : aucune résidence ajoutée, le moteur sort de portée).
        Un échec de warm (Piper absent) laisse le cache PRÉCÉDENT intact + est compté (dégradation
        honnête, jamais un crash). GARDES : `_stopped` vérifié en tête + entre les phrases + avant la pose
        (ROB-M5/NIT-1 : ne pas charger Piper ni synthétiser PENDANT l'arrêt T6) ; `gen` vérifié à la pose
        (ROB-M1 : un zombie ressuscité — vol déclaré mort puis réveillé — ne pose JAMAIS son vieux cache
        par-dessus un frais, patron garde de génération V12)."""
        engine = None
        try:
            if self._stopped:
                return                                      # arret tombe entre le lancement et ce thread (ROB-M5)
            engine = self._engine_factory()
            engine.warm()                                   # lève si Piper/modèle absent → filet indisponible, compté
            new: dict[str, tuple[np.ndarray, int]] = {}
            for name, text in items:
                if self._stopped:
                    return                                  # arret pendant la pre-synthese -> on cesse (ROB-M5)
                try:
                    audio = engine.synth(text)              # for_synth (lexique) inclus → même prononciation que sa voix
                    if getattr(audio, "size", 0) > 0:
                        new[name] = (np.asarray(audio, dtype=np.float32),
                                     int(getattr(engine, "sample_rate", 22050)))
                    else:
                        self._synth_errors += 1
                except Exception:
                    self._synth_errors += 1                 # une phrase ratée n'empêche pas les autres (parité TtsPlug)
            with self._lock:
                if self._stopped or gen != self._precache_gen:
                    return                                  # arrete OU perime (un vol plus recent a ete lance) -> JETE
                if new:                                     # au moins une phrase : le filet est posé
                    self._cache = new
                    # ROB-NIT-2 : la clé d'idempotence n'est posée que si le cache est COMPLET — un cache
                    # partiel (une phrase ratée) reste re-tentable au prochain envoi (jamais verrouillé « à jour »).
                    if len(new) == len(items):
                        self._cache_key = key
                    self._precaches += 1
                if self._pending_key == key:
                    self._pending_key = None
        except Exception:
            self._synth_errors += 1
            with self._lock:
                # re-croisé conv 58 (ROB2-2) : SYMÉTRIE avec la pose — un ZOMBIE (vol périmé, gen dépassée)
                # qui LÈVE au réveil ne nettoie JAMAIS la clé pendante du vol FRAIS de même clé (sinon le
                # double envoi boot serait refusé à tort « autres textes » + /debug mentirait « pas de vol »).
                # Seul le vol COURANT range sa clé ; celle d'un zombie appartient déjà au vol plus récent.
                if gen == self._precache_gen and self._pending_key == key:
                    self._pending_key = None                # l'ancien cache (s'il existe) reste le filet
        finally:
            del engine                                      # B2 : le moteur transitoire est LIBÉRÉ (RAM rendue)

    # ── observation des evt.* (thread STT, via l'emit wrappé de server.py) ───────
    def on_event(self, mtype: str, payload: dict) -> None:
        """Observateur du vocabulaire `evt.*` (patron V3 — les prises verrouillées ne sont PAS touchées).
        Robuste : ne lève JAMAIS (un observer qui lève est déjà avalé par _observing_emit, ceinture +
        bretelles ici). Décision (candidat + ÉPOQUE, ROB2-3) → lecture dans un thread one-shot (jamais
        bloquer le thread STT)."""
        try:
            epoch = self._guard.on_event(mtype, payload or {})
            if epoch is not None:
                self._play_fallback(epoch)
        except Exception:
            pass

    def episode_reset(self) -> None:
        """Un client WS s'est (re)connecté (ws_handler) → l'épisode est clos."""
        self._guard.episode_reset()

    def episode_consume(self) -> None:
        """Le dernier client est parti PROPREMENT (close frame — ws_handler, ROB-M4) : départ VOLONTAIRE,
        jamais une panne → l'épisode est consommé sans lecture. (Passe-plat vers le guard — son ABSENCE
        initiale, une AttributeError avalée par le try du ws_handler, a été attrapée par l'E2E ép.3 :
        la ceinture « jamais fatal » du serveur ne remplace pas un test qui MORD.)"""
        self._guard.episode_consume()

    # ── lecture (épisode de panne) ───────────────────────────────────────────────
    def _play_fallback(self, epoch: int) -> None:
        """Tente le LANCEMENT d'une lecture. ROB-M2 : la CONSOMMATION de l'épisode (`guard.try_consume`)
        n'a lieu QUE si le play part vraiment — un candidat qui n'aboutit pas (cache vide §4.7, lecture
        précédente en vol, arrêt, époque périmée) laisse l'épisode INTACT : le prochain tour re-candidate
        (jamais un épisode avalé en silence). Le skip « lecture en vol » est COMPTÉ (standard maison).
        re-croisé conv 58 (ROB2-1/2-3/2-4) : la consommation est ATOMIQUE (test-and-set d'époque sous le
        lock du guard) et le TOUT — checks, consommation, `t.start()` — sous le lock du voice : deux
        candidats simultanés → un seul lancement, PAR LE CODE. Ordre des locks : voice → guard, JAMAIS
        l'inverse (le guard n'appelle jamais le voice) → aucune inversion possible. L'emit reste HORS
        lock (parité WakeGate)."""
        with self._lock:
            if self._stopped:
                return
            if self._play_thread is not None and self._play_thread.is_alive():
                self._play_skips += 1                       # ROB-M2 : candidat non lancé — compté, épisode NON consommé
                return
            clip = self._cache.get(PRIMARY_PHRASE)
            if clip is None and self._cache:
                clip = next(iter(self._cache.values()))     # pas de « secours » nommé → la première envoyée
                name = next(iter(self._cache.keys()))
            else:
                name = PRIMARY_PHRASE
            if clip is None:
                return                                      # cache vide (fenêtre pré-synthèse §4.7) → silence assumé,
                #                                             épisode NON consommé → jouera au tour suivant si le cache arrive
            audio, sr = clip
            if not self._guard.try_consume(epoch):
                return                                      # déjà joué (l'AUTRE candidat a gagné) OU époque périmée
                #                                             (reset dans la fenêtre) → l'épisode neuf reste vierge
            t = threading.Thread(target=self._play_worker, args=(audio, sr),
                                 name="fallback-play", daemon=True)
            try:
                t.start()
            except Exception:                               # ROB2-4 : plus de threads OS (agonie) — l'épisode est
                self._play_errors += 1                      # RENDU (rien n'a joué), compté, compteurs jamais menteurs
                self._guard.unconsume(epoch)
                return
            self._play_thread = t
            self._played_count += 1
            self._last_played = name
        self._safe_emit("evt.fallback.played", {"name": name})

    def _play_worker(self, audio: np.ndarray, sr: int) -> None:
        # SOLO-3 (conv 58) : un stop() tombe ENTRE le lancement du thread et le play -> ne PAS demarrer une
        # lecture post-arret (la fenetre TOCTOU residuelle [check -> play] est couverte par output.stop() +
        # le join borne de stop() ; ce check la reduit a ~0). Lecture d'un bool sous le GIL.
        if self._stopped:
            return
        try:
            self._output.play(audio, sr)                    # BLOQUANT → la phrase joue EN ENTIER (exempte de barge-in)
        except Exception:
            self._play_errors += 1                          # une sortie qui trébuche : compté, jamais un crash

    def _safe_emit(self, etype: str, payload: dict) -> None:
        try:
            self._emit(etype, payload)
        except Exception:
            pass   # un emit qui échoue (bus arrêté au teardown…) ne casse jamais le filet (parité VadPlug)

    # ── cycle de vie ─────────────────────────────────────────────────────────────
    def stop(self) -> None:
        """Arrêt (graceful_release / teardown). Coupe une lecture en vol (l'arrêt volontaire n'est pas un
        épisode à annoncer). ROB-M5 (croisé conv 58) : le budget graceful T6 (2 s) sert d'abord le release
        du micro/CUDA → on ne JOINT PAS le thread precache (daemon, gardé `_stopped` en tête/entre les
        phrases/à la pose — il cesse seul, un warm Piper non-interruptible en vol meurt au SIGKILL T6) et le
        join du play est COURT (0,3 s — `output.stop()` l'a déjà débloqué). NIT-1 : join gardé contre le
        `RuntimeError` en défense (depuis ROB2-4, `_play_thread` n'est assigné qu'APRÈS un `start()` réussi
        → le cas créé-pas-démarré ne peut plus l'atteindre ; la garde reste, gratuite)."""
        with self._lock:
            self._stopped = True
        try:
            self._output.stop()                             # débloque un play() en cours
        except Exception:
            pass
        if self._play_thread is not None:
            try:
                self._play_thread.join(timeout=0.3)
            except RuntimeError:
                pass                                        # créé-pas-démarré (le worker vérifie _stopped en tête)
        try:
            self._output.close()
        except Exception:
            pass

    @property
    def state(self) -> dict:
        with self._lock:
            cached = sorted(self._cache.keys())
            pending = self._pending_key is not None
        return {
            "cached": cached,                               # les phrases prêtes (le filet est posé)
            "pending": pending,                             # une pré-synthèse est en vol
            "precaches": self._precaches,
            "precache_stalled": self._precache_stalled,     # ROB-M1 : vols déclarés morts (warm qui pend)
            "synth_errors": self._synth_errors,
            "played_count": self._played_count,             # total (tous épisodes) — lectures LANCÉES
            "play_errors": self._play_errors,
            "play_skips": self._play_skips,                 # ROB-M2 : candidats non lancés (lecture en vol)
            "last_played": self._last_played,
            **self._guard.state,                            # played_this_episode / paire en cours / clients_errors
        }
