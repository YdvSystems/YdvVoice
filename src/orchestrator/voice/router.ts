// Le ROUTEUR de conversation (V7 morceau C, embryon V9/V10) — le FIL entre les oreilles (sidecar) et la voix.
//
// « Le tour se ferme → elle répond en streaming → sa voix A20 le prononce. » Le sidecar émet les evt.* de V0→V6
// (il fait DÉJÀ le gating d'éveil/clôture en interne : le portier appelle wake.on_wake/release) ; le routeur
// RÉAGIT à ces evt.* et pilote la bouche (cmd.tts.*) + le cerveau chaud (WarmBrain). Il traduit le patron banc
// `Coordinator._on_turn`/`_respond`/`_await` (oreilles_live.py, prouvé I-6 conv 27-34), re-partitionné par l'IPC.
//
// LECTURE des evt.* (le sidecar encode SON état dans le TYPE d'événement — le routeur est quasi SANS état « armé ») :
//   · evt.wake      → le sidecar s'est ARMÉ (un ouvreur « … Sophia ») → PRÉSENCE (salutation miroir, placeholder 03).
//   · evt.stt.final → dernier transcript figé (sert le tour ET l'appariement de l'ouvreur). Tenu à jour.
//   · evt.turn.end  → un TOUR DE CONVERSATION s'est fini (le sidecar était armé) → clôture ? au revoir : cerveau.
//   · evt.tts.done  → une énonciation a fini de jouer (débloque le GATE / la deadline F-A).
//
// GATE b2 (LE PLUS IMPORTANT — corrige une facilité, plan/01) : pendant qu'elle parle (ou réfléchit), le routeur
// IGNORE les evt.turn.end — sa voix résiduelle post-AEC déclenche le VAD (mesuré au banc, conv 29) et formerait un
// FAUX tour → elle se répondrait à elle-même. C'est l'équivalent produit du `_flush_audio()` du banc. La suppression
// COMPLÈTE du résidu (une écoute coupée à la source pendant qu'elle parle) = `cmd.listen.stop` de V9 ; le barge-in
// INTENTIONNEL (Yohann coupe, via speaker-ID) = V8. En V7 : gate best-effort (busy + queue), CONFIRMÉ LIVE au juge.
//
// Contrat onDelta/isError (B1) : onDelta = la voix d'un tour RÉUSSI (poussée à cmd.tts) ; sur AskResult.isError SANS
// rien voisé, le routeur prononce SA PROPRE phrase de secours (placeholder 03), JAMAIS via onDelta.
// Deadline done (F-A, du morceau A) : `evt.tts.done` n'est PAS garanti (moteur TTS mort) → chaque énonciation porte
// une deadline (analogue R-1 réveil) → jamais bloqué indéfiniment sur done.
//
// Module Node PUR (IPC + cerveau injectés) → testable avec un faux IPC + un faux cerveau (tests/u-router.mjs), et
// exercé en CŒUR RÉEL au juge à ta voix (E2E live). Câblé dans SophiaRuntime (morceau C) après PRÊT.
//
// Frontières/écarts tracés (§7) : routeur = EMBRYON (la grille des 20 intentions + cmd.listen.* = V9/V10) · le GATE
// V7 ne coupe pas l'écoute à la source (V9) · phrases fixes = MÉCANISME V7, CONTENU = personnalité 03 (placeholder).

import type { Envelope } from "../ipc/index.js";
import { isHallucination, isGoodnight, matchClosing, matchOpening, norm } from "./portier.js";

/** Sous-ensemble de l'IpcClient dont le routeur a besoin (injecté → testable avec un faux). */
export interface RouterIpc {
  on(evtType: string, handler: (env: Envelope) => void): void;
  request(type: string, payload?: Record<string, unknown>): Promise<unknown>;
}

/** Sous-ensemble du WarmBrain (injecté). `ask` streame via onDelta et rend un résultat (jamais ne rejette). */
export interface RouterBrain {
  ask(text: string, opts?: { onDelta?: (chunk: string) => void; signal?: AbortSignal }): Promise<{
    isError: boolean; aborted: boolean; text: string;
  }>;
  /** Optionnel : réchauffe le cerveau « au retour » (à l'éveil) → le 1er vrai tour est déjà chaud (banc prewarm,
   *  plan/05 R4 : prewarm gouverné à l'éveil, PAS au boot → aucune dépense de quota tant qu'on ne l'appelle pas). */
  prewarm?(): void | Promise<void>;
}

/** Phrases FIXES (mécanisme V7 ; CONTENU = personnalité 03, placeholder NEUTRE — jamais la 1ʳᵉ phrase de naissance).
 *  La salutation d'éveil est un MIROIR (bonjour/bonsoir/salut → même salut ; sinon « Oui Yohann »). Le prénom est dit
 *  par Piper en phonèmes ([[joˈann]]) via le lexique de la bouche — orthographe réelle ici, phonétique côté moteur. */
export interface RouterPhrases {
  bonjour: string;
  bonsoir: string;
  salut: string;
  ack: string;      // convocation (« dis-moi Sophia ») → présence sans salut
  goodnight: string; // « bonne nuit Sophia » → elle répond bonne nuit et se rendort
  closing: string;   // clôture (« Merci Sophia, à plus tard ») → au revoir
  filler: string;    // masqueur : cerveau lent → on comble UNE fois
  secours: string;   // même le repli froid a échoué → elle le dit (jamais un silence)
}

const DEFAULT_PHRASES: RouterPhrases = {
  bonjour: "Bonjour Yohann.",
  bonsoir: "Bonsoir Yohann.",
  salut: "Salut Yohann.",
  ack: "Oui Yohann.",
  // EXACT du banc conv 32/34 (oreilles_live.py CLOSE_REPLY/GOODNIGHT_REPLY). La clôture est SANS prénom (« Avec grand
  // plaisir. », choisie à l'oreille par Yohann) — j'avais dérivé vers « …, Yohann. À bientôt. » (2 phrases → 5,3 s + bout
  // parasite au juge conv 47). On revient au banc, point.
  goodnight: "Bonne nuit Yohann. Dors bien, à demain.",
  closing: "Avec grand plaisir.",
  filler: "Donne-moi une petite minute, s'il te plaît.",
  secours: "Désolée, je n'ai pas réussi à répondre, là, tout de suite.",
};

export interface RouterOptions {
  /** Monolithe (1 canal pour tout) : `ipc`. Archi 2 process (conv 47) : `earsIpc` (evt.wake/stt/turn + cmd.listen) +
   *  `mouthIpc` (cmd.tts + evt.tts.start/done). Fournir `ipc` SEUL (les deux rôles dessus) OU `earsIpc`+`mouthIpc`. */
  ipc?: RouterIpc;
  earsIpc?: RouterIpc;
  mouthIpc?: RouterIpc;
  brain: RouterBrain;
  onLog?: (l: string) => void;
  /** Cerveau muet > ça → masqueur joué UNE fois (banc FILLER_AFTER 3 s ; perf ⛔). */
  fillerAfterMs?: number;
  /** Après la fin d'une interaction, garder le GATE fermé encore ça (la queue de sa voix quitte le ring avant de
   *  ré-écouter). NB : couvre le résidu IMMÉDIAT ; un evt.turn.end résiduel arrivant entre gateTailMs et le plafond
   *  Smart Turn (~0,8-3 s) est rattrapé par le FILTRE hallucination/longueur (onTurnEnd), pas par ce délai — la
   *  suppression complète à la source = `cmd.listen.stop` de V9 (M2 croisé conv 47 ; à confirmer live au juge). */
  gateTailMs?: number;
  /** F-A : deadline AVANT le 1er son (evt.tts.start). Pas de start dans ce délai → moteur TTS mort → on débloque le
   *  gate (jamais deaf à l'infini). Le start RE-ARME sur `playbackDeadlineMs` (M1). */
  doneDeadlineMs?: number;
  /** M1 (croisé conv 47) : deadline APRÈS evt.tts.start — borne LARGE de LECTURE. Découple le fail-safe « moteur
   *  mort » de la durée de parole : une réponse longue (> doneDeadlineMs de parole) ne rouvre PLUS le gate en plein
   *  discours (sinon sa voix résiduelle formerait un faux tour). Couvre encore une mort du moteur EN cours de lecture. */
  playbackDeadlineMs?: number;
  /** evt.wake sans evt.stt.final apparié (cas pathologique) → salutation générique après ça (jamais bloquée occupée). */
  greetFallbackMs?: number;
  phrases?: Partial<RouterPhrases>;
}

/** Salutation MIROIR (== greeting_for du banc) : « bonjour/bonsoir/salut Sophia » → même salut ; sinon « Oui Yohann ». */
function greetingFor(text: string, ph: RouterPhrases): string {
  const n = norm(text);
  if (n.includes("bonjour")) return ph.bonjour;
  if (n.includes("bonsoir")) return ph.bonsoir;
  if (n.includes("salut")) return ph.salut;
  return ph.ack;
}

interface UttState { resolve: () => void; promise: Promise<void>; timer: ReturnType<typeof setTimeout>; }

export class ConversationRouter {
  private readonly ears: RouterIpc;   // evt.wake/stt/turn (écoute) + cmd.listen.* (gate anti-auto-écoute cross-process)
  private readonly mouth: RouterIpc;  // cmd.tts.* (la voix) + evt.tts.start/done. Monolithe → ears === mouth (1 canal).
  private readonly brain: RouterBrain;
  private readonly onLog?: (l: string) => void;
  private readonly ph: RouterPhrases;
  private readonly fillerAfterMs: number;
  private readonly gateTailMs: number;
  private readonly doneDeadlineMs: number;
  private readonly playbackDeadlineMs: number;
  private readonly greetFallbackMs: number;

  private uttSeq = 0;
  /** LE GATE (b2 + un-tour-à-la-fois) : une interaction est en cours (accept → énonciations finies → queue). */
  private busy = false;
  /** Archi 2 process : les oreilles sont-elles mutées (sa voix joue) ? Posé au 1er evt.tts.start, levé au retour au repos
   *  (busy→false, après la traîne gateTailMs). = le `_flush_audio` du banc, piloté cross-process via cmd.listen.mute/resume. */
  private earsMuted = false;
  /** Énonciations en vol : id → resolver de son evt.tts.done (+ deadline F-A). */
  private readonly inFlight = new Map<number, UttState>();
  /** Dernier evt.stt.final vu (transcript + no_speech_prob du tour ; `consumed` = déjà UTILISÉ — par une salutation
   *  d'ouvreur OU par un tour → JAMAIS ré-apparié avec un éveil FUTUR, MAJEUR-1 croisé conv 47). */
  private lastFinal: { text: string; nsp?: number; consumed: boolean } | null = null;
  private pendingGreet = false;
  private pendingGreetTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private started = false;

  constructor(opts: RouterOptions) {
    // Archi 2 process (conv 47) : oreilles et bouche sur des canaux SÉPARÉS ; monolithe : un seul `ipc` pour les deux.
    const ears = opts.earsIpc ?? opts.ipc;
    const mouth = opts.mouthIpc ?? opts.ipc;
    if (!ears || !mouth) throw new Error("ConversationRouter : fournir `ipc` OU `earsIpc`+`mouthIpc`");
    this.ears = ears;
    this.mouth = mouth;
    this.brain = opts.brain;
    this.onLog = opts.onLog;
    this.ph = { ...DEFAULT_PHRASES, ...(opts.phrases ?? {}) };
    this.fillerAfterMs = opts.fillerAfterMs ?? 3000;
    this.gateTailMs = opts.gateTailMs ?? 800;
    this.doneDeadlineMs = opts.doneDeadlineMs ?? 30000;
    this.playbackDeadlineMs = opts.playbackDeadlineMs ?? 120000;
    this.greetFallbackMs = opts.greetFallbackMs ?? 1500;
  }

  // N2 (croisé conv 47) : un logger injecté qui lève ne doit JAMAIS ré-émerger en rejection flottante depuis un
  // handler .catch (runInteraction/send). console.log/systray ne lèvent pas ; défense bon marché.
  private log(l: string): void { try { this.onLog?.(l); } catch { /* un logger qui lève ne casse jamais le routeur */ } }

  /** Abonne les evt.* du sidecar. À appeler une fois l'IpcClient connecté (après sidecar READY). Idempotent
   *  (SOLO-2 : un 2e appel double-abonnerait les evt.* → double traitement). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.ears.on("evt.wake", (e) => this.onWake(e));
    this.ears.on("evt.stt.final", (e) => this.onFinal(e));
    this.ears.on("evt.turn.end", (e) => this.onTurnEnd(e));
    this.mouth.on("evt.tts.start", (e) => this.onTtsStart(e)); // M1 : le 1er son CONFIRME le moteur vivant → re-arme la deadline
    this.mouth.on("evt.tts.done", (e) => this.onTtsDone(e));
  }

  /** Lance le traitement d'une interaction en GARANTISSANT que le GATE se rouvre (scheduleIdle) — même si le handler
   *  lève (SOLO-1). Le WarmBrain ne rejette JAMAIS par contrat ; ceci est le filet contre un cerveau injecté hors
   *  contrat (jamais de rejection non gérée, jamais un GATE resté fermé → Sophia sourde pour toujours). */
  private runInteraction(p: Promise<void>): void {
    void p
      .catch((e) => this.log(`routeur (interaction) : ${(e as Error)?.message ?? String(e)}`))
      .finally(() => this.scheduleIdle());
  }

  /** Arrêt (quiesce) : coupe la voix, règle les awaits en vol, ne relance rien. Idempotent. */
  stop(): void {
    this.stopped = true;
    if (this.pendingGreetTimer) { clearTimeout(this.pendingGreetTimer); this.pendingGreetTimer = null; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    for (const id of [...this.inFlight.keys()]) this.settleUtterance(id); // résout les awaits (ne bloque pas l'arrêt)
    try { void Promise.resolve(this.mouth.request("cmd.tts.stop", {})).catch(() => { /* */ }); } catch { /* */ }
    // Ne jamais laisser les oreilles mutées à l'arrêt (sinon Sophia sourde au prochain démarrage du routeur).
    if (this.earsMuted) { this.earsMuted = false; try { void Promise.resolve(this.ears.request("cmd.listen.resume", {})).catch(() => { /* */ }); } catch { /* */ } }
  }

  // ── réception des evt.* ────────────────────────────────────────────────────────
  private onWake(_env: Envelope): void {
    if (this.stopped) return;
    if (this.busy) { this.log("evt.wake ignoré (occupée)"); return; } // ne devrait pas arriver (sidecar armé) ; garde
    this.busy = true;
    // prewarm « au retour » (banc / plan/05 R4) : réchauffe le cerveau PENDANT qu'elle salue → le 1er vrai tour
    // (après le salut) est déjà chaud (masque le cold-start). Fire-and-forget, jamais fatal ; à l'ÉVEIL seulement
    // (aucune dépense de quota au boot). Chaîné dans le WarmBrain → jamais concurrent d'un vrai tour.
    void Promise.resolve(this.brain.prewarm?.()).catch(() => { /* jamais fatal */ });
    // evt.wake ne porte PAS le transcript ; l'ordre wake↔final varie (chemin RAPIDE : wake avant final ; chemin
    // LENT : final avant wake). Appariement SANS wall-clock : un final frais non consommé → saluer ; sinon différer
    // au prochain final (arrive à ~1 tick dans le chemin rapide). Filet si aucun final n'arrive (pathologique).
    if (this.lastFinal && !this.lastFinal.consumed) {
      this.lastFinal.consumed = true;
      const text = this.lastFinal.text;
      this.runInteraction(this.handleOpener(text));
    } else {
      this.pendingGreet = true;
      this.pendingGreetTimer = setTimeout(() => {
        if (!this.pendingGreet) return;
        this.pendingGreet = false;
        this.runInteraction(this.handleOpener("")); // "" → salutation générique (« Oui Yohann »)
      }, this.greetFallbackMs);
    }
  }

  private onFinal(env: Envelope): void {
    if (this.stopped) return;
    const text = typeof env.payload?.text === "string" ? env.payload.text : "";
    const nsp = typeof env.payload?.no_speech_prob === "number" ? env.payload.no_speech_prob : undefined; // M2 : conservé pour le filtre
    // MAJEUR-1 (croisé conv 47) : un final n'est APPARIABLE avec un éveil FUTUR que s'il est FRAIS — soit hors
    // interaction (l'ouvreur, chemin lent), soit l'ouvreur attendu (pendingGreet, chemin rapide). Un final arrivé
    // pendant qu'elle parle/réfléchit (busy SANS pendingGreet) est un RÉSIDU de sa voix / un tour gaté → JAMAIS
    // l'ouvreur d'un futur éveil (sinon `onWake` le consommerait et saluerait sur un mauvais transcript).
    const consumable = !this.busy || this.pendingGreet;
    this.lastFinal = { text, nsp, consumed: !consumable };
    if (this.pendingGreet) {
      this.pendingGreet = false;
      if (this.pendingGreetTimer) { clearTimeout(this.pendingGreetTimer); this.pendingGreetTimer = null; }
      this.lastFinal.consumed = true;
      this.runInteraction(this.handleOpener(text));
    }
  }

  private onTurnEnd(_env: Envelope): void {
    if (this.stopped) return;
    // GATE b2 : occupée (elle parle / réfléchit) → IGNORER (résidu de sa voix → faux tour). Un-tour-à-la-fois.
    if (this.busy) { this.log("evt.turn.end ignoré (GATE : occupée)"); return; }
    const text = this.lastFinal?.text ?? "";
    const nsp = this.lastFinal?.nsp;
    // MAJEUR-1 : ce final est UTILISÉ par ce tour → il ne doit JAMAIS servir d'ouvreur à un éveil futur (le marquer
    // consommé même si le tour est ensuite ignoré — il a été vu). M2 : passer nsp au filtre (fidèle au banc _on_turn).
    if (this.lastFinal) this.lastFinal.consumed = true;
    if (norm(text).length < 3 || isHallucination(text, nsp)) { this.log(`tour ignoré (rien de clair) : « ${text} »`); return; }
    this.busy = true;
    this.runInteraction(this.handleTurn(text));
  }

  private onTtsStart(env: Envelope): void {
    // Sa voix DÉMARRE (1er son) → muter les oreilles (anti-auto-écoute cross-process = _flush_audio du banc). UNE fois par
    // interaction ; levé au retour au repos (scheduleIdle + traîne). Inconditionnel (sa voix joue, quel que soit l'id).
    if (!this.earsMuted) { this.earsMuted = true; this.send("cmd.listen.mute", {}); }
    const raw = env.payload?.id;
    const id = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(id)) return;
    const e = this.inFlight.get(id);
    if (!e) return;
    // M1 (croisé conv 47) : le 1er son PROUVE le moteur vivant (F-A « moteur mort » = jamais de start). On re-arme la
    // deadline sur `playbackDeadlineMs` (borne LARGE de lecture) → une réponse longue ne rouvre PLUS le gate en plein
    // discours (sinon sa voix résiduelle formerait un faux tour). Une mort du moteur EN cours (pas de done) reste
    // couverte (playbackDeadline rouvre, stall borné). `doneDeadlineMs` ne borne plus que « le son ne DÉMARRE jamais ».
    clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      this.log(`evt.tts.done absent après start (énonciation ${id}, deadline lecture) → déblocage du gate`);
      this.settleUtterance(id);
    }, this.playbackDeadlineMs);
  }

  private onTtsDone(env: Envelope): void {
    const raw = env.payload?.id;
    const id = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(id)) this.settleUtterance(id);
  }

  // ── traitement d'une interaction (== _on_turn du banc, re-partitionné) ──────────
  /** PRÉSENCE au réveil (le sidecar a DÉJÀ validé l'éveil + s'est armé). Placeholder 03. */
  private async handleOpener(text: string): Promise<void> {
    if (text && (isHallucination(text) || !matchOpening(text))) {
      // le final apparié n'est pas un ouvreur (edge) — elle S'EST tout de même éveillée → présence générique.
      await this.playFixed(this.ph.ack); return;
    }
    if (isGoodnight(text)) { await this.playFixed(this.ph.goodnight); return; } // éveil-clôture (sidecar déjà rendormi)
    await this.playFixed(greetingFor(text, this.ph)); // salutation miroir, reste à l'écoute
  }

  /** Un tour de CONVERSATION fini : clôture → au revoir ; sinon → le cerveau (streaming → voix). */
  private async handleTurn(text: string): Promise<void> {
    // MINEUR-3 (croisé conv 47) : clôture = `matchClosing` SEUL (== branche active de `_on_turn` du banc). PAS
    // `|| isGoodnight` : un « bonne nuit » NU (sans « sophia ») ne ferme PAS — le sidecar reste armé dessus (ni
    // match_opening ni match_closing → pas de release) → sinon elle dirait au revoir en RESTANT écoutée (incohérent).
    // « bonne nuit sophia » EST déjà capté par matchClosing (« sophia » + marqueur « bonne nuit ») → cohérent des 2 côtés.
    if (matchClosing(text)) { await this.playFixed(this.ph.closing); return; } // au revoir
    await this.respond(text);
  }

  /** Elle répond EN STREAMING : chaque delta du cerveau part à la bouche DÈS qu'il est écrit (== _respond du banc).
   *  Masqueur si le cerveau tarde ; secours si tout échoue (contrat B1). */
  private async respond(text: string): Promise<void> {
    let uid: number | null = null;       // énonciation de la réponse — ouverte LAZY (au 1er delta → id < filler si masqué)
    let fillerId: number | null = null;
    // masqueur (perf ⛔) : cerveau muet > fillerAfter → énonciation SÉPARÉE (joue AVANT la réponse dans le train du
    // sidecar — ordre d'ARRIVÉE des phrases, pas des ids). Non compté comme réponse.
    const fillerTimer = setTimeout(() => {
      if (uid != null || this.stopped) return; // réponse déjà ouverte / arrêt → pas de masqueur
      fillerId = ++this.uttSeq;
      this.beginUtterance(fillerId); this.pushDelta(fillerId, this.ph.filler); this.endUtterance(fillerId);
      this.log("masqueur joué (cerveau lent)");
    }, this.fillerAfterMs);

    let result: { isError: boolean; aborted: boolean; text: string };
    try {
      result = await this.brain.ask(text, {
        onDelta: (piece) => {
          if (this.stopped || !piece) return;
          if (uid == null) { clearTimeout(fillerTimer); uid = ++this.uttSeq; this.beginUtterance(uid); }
          this.pushDelta(uid, piece);
        },
      });
    } finally {
      clearTimeout(fillerTimer);
    }

    if (uid != null) {
      this.endUtterance(uid);
      await this.awaitDone(uid);
    } else if (!result.aborted && !this.stopped) {
      // rien voisé + pas d'abort volontaire → SECOURS dit par le routeur (03), JAMAIS via onDelta (contrat B1).
      await this.playFixed(this.ph.secours);
    }
    if (fillerId != null) await this.awaitDone(fillerId); // le masqueur a joué AVANT → déjà réglé en pratique
  }

  // ── pilotage de la bouche (cmd.tts.*) + cycle des énonciations ──────────────────
  /** Une phrase FIXE complète (salutation / au revoir / secours / bonne nuit) — speak → push → end → attend done. */
  private async playFixed(line: string): Promise<void> {
    const id = ++this.uttSeq;
    this.beginUtterance(id);
    this.pushDelta(id, line);
    this.endUtterance(id);
    await this.awaitDone(id);
  }

  private beginUtterance(id: number): void {
    // cmd.tts.speak + deadline F-A initiale = « le son doit DÉMARRER dans doneDeadlineMs » (moteur mort = jamais de
    // evt.tts.start). `onTtsStart` la RE-ARME sur playbackDeadlineMs (M1) → une réponse longue ne rouvre pas le gate
    // en plein discours. Le timer est armé AVANT tout await → jamais deaf à l'infini même si start/done n'arrivent pas.
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    const timer = setTimeout(() => {
      this.log(`evt.tts.start absent (énonciation ${id}, deadline F-A) → déblocage du gate`);
      this.settleUtterance(id);
    }, this.doneDeadlineMs);
    this.inFlight.set(id, { resolve, promise, timer });
    this.send("cmd.tts.speak", { id });
  }

  private pushDelta(id: number, text: string): void { this.send("cmd.tts.push", { id, text }); }
  private endUtterance(id: number): void { this.send("cmd.tts.end", { id }); }

  /** Attend l'evt.tts.done d'une énonciation (ou sa deadline F-A). Résolu d'avance si elle est déjà réglée. */
  private awaitDone(id: number): Promise<void> {
    const e = this.inFlight.get(id);
    return e ? e.promise : Promise.resolve();
  }

  private settleUtterance(id: number): void {
    const e = this.inFlight.get(id);
    if (!e) return;
    clearTimeout(e.timer);
    this.inFlight.delete(id);
    e.resolve();
  }

  /** cmd fire-and-forget (l'ordre est garanti par le WS ; un échec n'interrompt pas le tour — le gate/deadline gère).
   *  Archi 2 process : cmd.listen.* → oreilles ; cmd.tts.* (et le reste) → bouche. Monolithe → même canal. */
  private send(type: string, payload: Record<string, unknown>): void {
    const ipc = type.startsWith("cmd.listen") ? this.ears : this.mouth;
    Promise.resolve(ipc.request(type, payload)).catch((e) => this.log(`${type} : ${(e as Error)?.message ?? String(e)}`));
  }

  /** Fin d'une interaction : garde le GATE fermé encore `gateTailMs` (la queue de sa voix quitte le ring), puis libère. */
  private scheduleIdle(): void {
    if (this.stopped) return; // N1 (croisé conv 47) : après stop(), ne pas ré-armer un timer (busy neutralisé par stopped)
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.busy = false; this.idleTimer = null;
      // Retour au repos : sa voix + la traîne sont passées → réveiller les oreilles (cross-process). gateTailMs couvre
      // le résidu post-AEC encore dans le ring (== la traîne _tail_s de la bouche). Le monolithe l'ignore (gate local).
      if (this.earsMuted) { this.earsMuted = false; this.send("cmd.listen.resume", {}); }
    }, this.gateTailMs);
  }
}
