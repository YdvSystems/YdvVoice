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
// FAUX tour → elle se répondrait à elle-même. C'est l'équivalent produit du `_flush_audio()` du banc.
//
// BARGE-IN (V8, conv 49 — « la couper quand on lui parle ») : pendant sa PENSÉE développée, le routeur ARME les oreilles
// (cmd.listen.arm : VAD + speaker V6 vivants, STT gaté). Sur `evt.speaker` locuteur=Yohann (≥ 0,22, seuil appliqué par le
// sidecar), il COUPE la VOIX (cmd.tts.stop) — mais le cerveau FINIT sa génération EN FOND (option B, Yohann conv 49 :
// préserver le contexte, sinon amnésie à chaque coupe ; revisité plan/02) — et rembobine le STT à la marque du barge
// (cmd.listen.resume {from} → sa phrase interruptrice, l'AEC ayant annulé SA voix). Son résidu score sous 0,22 → "inconnu"
// → JAMAIS de coupe (F2). Les
// phrases FIXES (salutation/clôture) ne s'arment PAS (cmd.listen.mute) → jamais coupées (fidèle `allow_bargein=False` du banc).
// Le mot « Sophia » pendant la TTS + replay/volume = différés (V9/V10, §7). En V7 : gate best-effort (busy + queue), juge OK.
//
// Contrat onDelta/isError (B1) : onDelta = la voix d'un tour RÉUSSI (poussée à cmd.tts) ; sur AskResult.isError SANS
// rien voisé, le routeur prononce SA PROPRE phrase de secours (placeholder 03), JAMAIS via onDelta.
// Deadline done (F-A, du morceau A) : `evt.tts.done` n'est PAS garanti (moteur TTS mort) → chaque énonciation porte
// une deadline (analogue R-1 réveil) → jamais bloqué indéfiniment sur done.
//
// Module Node PUR (IPC + cerveau injectés) → testable avec un faux IPC + un faux cerveau (tests/u-router.mjs), et
// exercé en CŒUR RÉEL au juge à ta voix (E2E live). Câblé dans SophiaRuntime (morceau C) après PRÊT.
//
// Frontières/écarts tracés (§7) : routeur = EMBRYON (la grille des 20 intentions = V9/V10) · phrases fixes = MÉCANISME
// V7, CONTENU = personnalité 03 (placeholder) · V8 : barge-in décidé DANS le routeur (le plan disait « interne au sidecar » ;
// ici, le chef d'orchestre local — hop IPC négligeable devant l'accumulation 0,75 s du speaker) · « Sophia » pendant la TTS
// + replay + volume = différés (V9/V10) · capture post-barge = injection rétroactive à la marque (edge « silence après » = §7).

import type { Envelope } from "../ipc/index.js";
import { isHallucination, isGoodnight, matchClosing, matchOpening, norm } from "./portier.js";
import { ListenState } from "./states.js";
import type { ListenMode } from "./states.js";

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
  /** V9 — la machine des états d'écoute (VEILLE/ÉCOUTE/PAUSE), POSSÉDÉE par l'orchestrateur (B1). Le routeur la
   *  pilote (réveil → ÉCOUTE ; clôture → VEILLE) et, sur transition, envoie `cmd.listen.start`/`stop` aux oreilles
   *  + garde le WarmBrain chaud en PAUSE. AXE DISTINCT du gate d'énonciation `listenMode` (V8, resume/arm/mute). */
  private readonly states: ListenState;

  private uttSeq = 0;
  /** LE GATE (b2 + un-tour-à-la-fois) : une interaction est en cours (accept → énonciations finies → queue). */
  private busy = false;
  /** V8 archi 2 process : l'état d'écoute qu'on a demandé aux oreilles (cmd.listen.*). `mute` = phrase fixe (tout gaté,
   *  pas de barge-in) ; `arm` = sa pensée développée (VAD+V6 vivants → barge-in possible, STT gaté) ; `resume` = écoute
   *  normale. Posé à chaque evt.tts.start selon le type d'énonciation ; remis à `resume` au repos / à la coupure. */
  private listenMode: "resume" | "arm" | "mute" = "resume";
  /** V8 : un barge-in peut-il couper MAINTENANT ? Vrai pendant que sa PENSÉE DÉVELOPPÉE joue (arm) ; faux sur les phrases
   *  fixes (salutation/clôture ne se coupent pas) et hors interaction. Une seule coupe par pensée (remis faux à la coupe). */
  private bargeArmed = false;
  /** V8 : l'id de l'énonciation INTERRUPTIBLE (la pensée développée de `respond`) — evt.tts.start dessus → `arm` + barge armé ;
   *  toute autre énonciation (salutation/clôture/masqueur/secours) → `mute`. Nul hors d'une réponse développée. */
  private armedUttId: number | null = null;
  /** Abandon (kill) du tour de cerveau — sur QUIESCE/arrêt seulement (stop()). PAS sur un barge-in (option B, décision
   *  Yohann conv 49) : le barge NE tue PAS le cerveau, sinon amnésie de la conversation à chaque coupe (le vrai fix =
   *  re-feed durable, plan/02). Le WarmBrain honore `signal` (kill du process persistant). Nul hors d'un `respond`. */
  private thoughtAbort: AbortController | null = null;
  /** V8 option B (Yohann conv 49) : « couper la pensée en cours » SANS tuer le cerveau. Posé par `respond` (per-tour) ;
   *  `bargeIn` l'appelle → respond rend tout de suite (course) + les deltas restants sont jetés, MAIS le cerveau FINIT sa
   *  génération EN FOND → son contexte de conversation reste INTACT (corrigé/revisité au plan/02). Nul hors d'un `respond`. */
  private bargeCurrentThought: (() => void) | null = null;
  /** V8 : une coupe vient d'avoir lieu → le prochain `scheduleIdle` n'attend PAS la traîne (sa voix est CUPÉE, pas de
   *  résidu à laisser passer) → `busy` se lève tout de suite, prêt pour la suite de Yohann (déjà captée en rétroactif). */
  private bargeInProgress = false;
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
    // V9 : la machine d'états d'écoute. Sur CHAQUE transition, elle notifie `onListenEnter` → cmd.listen.start/stop.
    this.states = new ListenState({ onEnter: (m, p) => this.onListenEnter(m, p), onLog: opts.onLog });
  }

  /** V9 — l'état d'écoute courant (VEILLE/ÉCOUTE/PAUSE) — LECTURE SEULE, pour les futurs voyants/transcript (O5). */
  get listenState(): ListenMode { return this.states.current; }

  /** V9 — mappe une transition d'état d'écoute vers la commande sidecar (B1) : ÉCOUTE → `cmd.listen.start`
   *  (arme + repousse la garde R-1) ; VEILLE/PAUSE → `cmd.listen.stop` (release → coupe l'écoute des tours à la
   *  source). PAUSE garde le WarmBrain CHAUD (aucune quiesce ici : le cerveau persistant vit → le fil est gardé ;
   *  la vraie distinction fil-frais/fil-gardé attend plan/02). Idempotent avec l'auto-arm/release du portier
   *  (le sidecar faisait déjà ça en interne — l'ajout est ADDITIF : il rend l'état EXPLICITE + arme la garde R-1). */
  private onListenEnter(mode: ListenMode, _prev: ListenMode): void {
    if (mode === "ecoute") this.send("cmd.listen.start", {});
    else if (mode === "veille" || mode === "pause") this.send("cmd.listen.stop", {});
    // dictee/approbation = V10 (crochets inertes) : aucune commande ici.
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
    this.ears.on("evt.speaker", (e) => this.onSpeaker(e)); // V8 : « qui parle ? » → barge-in (Yohann coupe pendant sa pensée)
    this.ears.on("evt.listen.timeout", (e) => this.onListenTimeout(e)); // V9 : la garde R-1 a rendormi le sidecar → synchroniser
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
    this.bargeArmed = false; this.armedUttId = null;
    try { this.thoughtAbort?.abort(); } catch { /* */ }
    for (const id of [...this.inFlight.keys()]) this.settleUtterance(id); // résout les awaits (ne bloque pas l'arrêt)
    try { void Promise.resolve(this.mouth.request("cmd.tts.stop", {})).catch(() => { /* */ }); } catch { /* */ }
    // Ne jamais laisser les oreilles gatées (mute/arm) à l'arrêt (sinon Sophia sourde au prochain démarrage du routeur).
    if (this.listenMode !== "resume") { this.listenMode = "resume"; try { void Promise.resolve(this.ears.request("cmd.listen.resume", {})).catch(() => { /* */ }); } catch { /* */ } }
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

  /** V9 (ROB-B croisé conv 50) : la deadline de garde R-1 du sidecar a relâché l'écoute (retour VEILLE sur une
   *  inactivité prolongée — ni Yohann ni Sophia n'ont parlé depuis guard_s). L'orchestrateur SYNCHRONISE son
   *  ListenState → sinon la vue dérivée (voyants/transcript, O5) afficherait ÉCOUTE alors que Sophia est retombée
   *  en VEILLE. Le sidecar est DÉJÀ en VEILLE → `states.close()` (→ cmd.listen.stop) est idempotent (release no-op) ;
   *  jamais un état qui ment. La garde ne mord qu'en attente NON-busy (cf. `_guard_tick` sidecar) → pas de conflit. */
  private onListenTimeout(_env: Envelope): void {
    if (this.stopped) return;
    // NIT (re-croisé conv 50) : `close()` collapse aussi PAUSE→VEILLE si jamais atteint. INATTEIGNABLE aujourd'hui
    // (entrer en PAUSE envoie `cmd.listen.stop` → `wake.release()` → `_armed=False` → `check_guard` sort tôt et
    // n'émet jamais en pause) et sans effet (VEILLE ne quiesce pas encore le WarmBrain) → à revoir quand PAUSE gagne
    // sa vraie sémantique « fil gardé vs fil frais » (plan/02).
    if (this.states.current !== "veille") {
      this.log("garde R-1 : le sidecar s'est rendormi sur inactivité → synchronisation de l'état d'écoute (VEILLE)");
      this.states.close();
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

  /** V8 : « qui parle ? » (evt.speaker du sidecar). Barge-in SEULEMENT pendant sa pensée développée (bargeArmed). Le sidecar
   *  a déjà appliqué le seuil 0,22 → locuteur "yohann" (≥ seuil) ou "inconnu". Son propre résidu post-AEC score sous 0,22 →
   *  "inconnu" → JAMAIS de coupe (invariant F2). Une voix inconnue soutenue = politique tablée (04, pas ici). */
  private onSpeaker(env: Envelope): void {
    if (this.stopped) return;
    if (!this.bargeArmed) return;               // jamais sur salutation/clôture/repos — seulement sa pensée
    if (env.payload?.locuteur !== "yohann") return;
    const raw = env.payload?.mark;
    const mark = typeof raw === "number" ? raw : undefined;
    this.bargeIn(mark);
  }

  /** V8 : Yohann coupe. Abandonne la génération (réponse partielle VOULUE), purge la bouche, règle les énonciations en vol,
   *  puis rembobine le STT à la marque du barge pour capturer sa phrase interruptrice (l'AEC a annulé SA voix → propre).
   *  Une coupe par pensée (idempotent). Fidèle au banc `_await` (mouth.stop + `_bargein_done`, oreilles_live:1294). */
  private bargeIn(mark?: number): void {
    if (!this.bargeArmed) return;               // idempotent (une coupe par pensée)
    this.bargeArmed = false;
    this.log("barge-in : Yohann parle par-dessus → je coupe (le cerveau finit en fond, contexte préservé — option B, plan/02)");
    // Option B (Yohann conv 49) : NE PAS tuer le cerveau (préserver le contexte de la conversation). On coupe la pensée
    // EN COURS (respond rend tout de suite + deltas jetés) mais le process persistant FINIT en fond → pas d'amnésie.
    this.bargeCurrentThought?.();
    this.send("cmd.tts.stop", {});              // la bouche purge (elle s'arrête net)
    for (const id of [...this.inFlight.keys()]) this.settleUtterance(id); // done ne viendra pas (purge) → débloque respond
    this.bargeInProgress = true;                // scheduleIdle : traîne 0 (sa voix est cut → prêt tout de suite pour sa suite)
    // capture RÉTROACTIVE de la suite : resume {from: marque} → le STT rembobine et transcrit la phrase interruptrice.
    this.listenMode = "resume";
    this.send("cmd.listen.resume", mark != null ? { from: mark } : {});
  }

  private onTtsStart(env: Envelope): void {
    const raw = env.payload?.id;
    const id = typeof raw === "number" ? raw : Number(raw);
    // Sa voix DÉMARRE (1er son). V8 : la PENSÉE DÉVELOPPÉE (armedUttId) est INTERRUPTIBLE → `arm` (VAD+V6 écoutent Yohann
    // par-dessus, STT gaté) ; toute AUTRE énonciation (salutation/clôture/masqueur/secours) → `mute` (tout gaté, pas de
    // barge-in : on ne coupe pas sa salutation). Le STT reste gaté dans les deux (anti-auto-écoute = _flush_audio du banc).
    if (Number.isFinite(id) && id === this.armedUttId) { this.setListenMode("arm"); this.bargeArmed = true; }
    else this.setListenMode("mute");
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
  /** PRÉSENCE au réveil (le sidecar a DÉJÀ validé l'éveil + s'est armé). Placeholder 03. V9 : la salutation
   *  confirme l'ÉCOUTE (states.wake → cmd.listen.start), l'éveil-clôture retourne en VEILLE (states.close). */
  private async handleOpener(text: string): Promise<void> {
    if (text && (isHallucination(text) || !matchOpening(text))) {
      // le final apparié n'est pas un ouvreur (edge) — elle S'EST tout de même éveillée → présence générique.
      await this.playFixed(this.ph.ack); this.states.wake(); return;
    }
    if (isGoodnight(text)) { await this.playFixed(this.ph.goodnight); this.states.close(); return; } // éveil-clôture → VEILLE
    await this.playFixed(greetingFor(text, this.ph)); this.states.wake(); // salutation miroir, reste à l'ÉCOUTE
  }

  /** Un tour de CONVERSATION fini : clôture → au revoir ; sinon → le cerveau (streaming → voix). */
  private async handleTurn(text: string): Promise<void> {
    // MINEUR-3 (croisé conv 47) : clôture = `matchClosing` SEUL (== branche active de `_on_turn` du banc). PAS
    // `|| isGoodnight` : un « bonne nuit » NU (sans « sophia ») ne ferme PAS — le sidecar reste armé dessus (ni
    // match_opening ni match_closing → pas de release) → sinon elle dirait au revoir en RESTANT écoutée (incohérent).
    // « bonne nuit sophia » EST déjà capté par matchClosing (« sophia » + marqueur « bonne nuit ») → cohérent des 2 côtés.
    if (matchClosing(text)) { await this.playFixed(this.ph.closing); this.states.close(); return; } // au revoir → VEILLE
    await this.respond(text); // conversation : reste en ÉCOUTE (states déjà « ecoute » — pas de transition)
  }

  /** Elle répond EN STREAMING : chaque delta du cerveau part à la bouche DÈS qu'il est écrit (== _respond du banc).
   *  Masqueur si le cerveau tarde ; secours si tout échoue (contrat B1). */
  private async respond(text: string): Promise<void> {
    let uid: number | null = null;       // énonciation de la réponse — ouverte LAZY (au 1er delta → id < filler si masqué)
    let fillerId: number | null = null;
    let barged = false;                  // V8 option B : Yohann a coupé cette pensée → jeter les deltas restants (le cerveau finit en fond)
    // masqueur (perf ⛔) : cerveau muet > fillerAfter → énonciation SÉPARÉE (joue AVANT la réponse dans le train du
    // sidecar — ordre d'ARRIVÉE des phrases, pas des ids). Non compté comme réponse.
    const fillerTimer = setTimeout(() => {
      if (uid != null || this.stopped) return; // réponse déjà ouverte / arrêt → pas de masqueur
      fillerId = ++this.uttSeq;
      this.beginUtterance(fillerId); this.pushDelta(fillerId, this.ph.filler); this.endUtterance(fillerId);
      this.log("masqueur joué (cerveau lent)");
    }, this.fillerAfterMs);

    // AbortController = QUIESCE/arrêt seulement (kill du cerveau à l'extinction). Le barge, lui, NE tue PAS le cerveau
    // (option B, décision Yohann conv 49 — préserver le contexte, sinon amnésie à chaque coupe ; corrigé au plan/02).
    // Sur un barge, `bargeCurrentThought` (per-tour) fait DEUX choses : (a) `barged=true` → les deltas restants sont
    // jetés (la bouche est coupée) ; (b) résout la course → respond rend TOUT DE SUITE (busy se lève pour la suite de
    // Yohann) pendant que le cerveau FINIT SA GÉNÉRATION EN FOND (son contexte de conversation reste intact).
    const ac = new AbortController();
    this.thoughtAbort = ac;
    const bargePromise = new Promise<{ barged: true }>((resolve) => {
      this.bargeCurrentThought = () => { barged = true; resolve({ barged: true }); };
    });
    let result: { isError: boolean; aborted: boolean; text: string };
    try {
      const asked = this.brain.ask(text, {
        signal: ac.signal,   // quiesce/arrêt seulement (jamais le barge)
        onDelta: (piece) => {
          if (this.stopped || !piece || barged) return;   // post-barge : jeté (la bouche est coupée ; le cerveau continue en fond)
          // 1er delta : ouvre l'énonciation de la pensée + la marque INTERRUPTIBLE (evt.tts.start dessus → arm + barge armé).
          if (uid == null) { clearTimeout(fillerTimer); uid = ++this.uttSeq; this.armedUttId = uid; this.beginUtterance(uid); }
          this.pushDelta(uid, piece);
        },
      });
      asked.catch(() => { /* le cerveau finit en fond après un barge ; WarmBrain ne rejette jamais (défense) */ });
      const raced = await Promise.race([asked, bargePromise]);
      result = "barged" in raced ? { isError: false, aborted: true, text: "" } : raced;
    } finally {
      clearTimeout(fillerTimer);
      this.bargeCurrentThought = null;
      if (this.thoughtAbort === ac) this.thoughtAbort = null;
    }

    // Coupée (barge, option B) ou quiescée (arrêt) → les énonciations sont DÉJÀ réglées (bargeIn/stop) et les oreilles en
    // resume (capture rétroactive) → ne rien envoyer de plus (jamais un cmd.tts.end sur une énonciation purgée). Sur un
    // barge, le cerveau finit en fond (contexte préservé) → on ne l'attend PAS ici (la suite de Yohann prime). `barged` en
    // PLUS de `result.aborted` (re-croisé R-2, conv 49) : si le cerveau GAGNE la course au moment EXACT du barge (`asked`
    // résout avant `bargePromise`), `result.aborted` est faux mais l'énonciation est déjà purgée → `barged` ferme ce cas.
    if (result.aborted || barged || this.stopped) return;

    if (uid != null) {
      this.endUtterance(uid);
      await this.awaitDone(uid);
    } else if (!this.stopped) {
      // rien voisé + pas d'abort → SECOURS dit par le routeur (03), JAMAIS via onDelta (contrat B1).
      await this.playFixed(this.ph.secours);
    }
    if (fillerId != null) await this.awaitDone(fillerId); // le masqueur a joué AVANT → déjà réglé en pratique
  }

  /** V8 : pose l'état d'écoute des oreilles (cmd.listen.*), seulement s'il change (jamais une commande redondante). Le
   *  barge-in pose `resume {from}` directement (avec la marque) → ce helper, lui, n'envoie jamais de `from`. */
  private setListenMode(mode: "resume" | "arm" | "mute"): void {
    if (this.listenMode === mode) return;
    this.listenMode = mode;
    this.send(mode === "arm" ? "cmd.listen.arm" : mode === "mute" ? "cmd.listen.mute" : "cmd.listen.resume", {});
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
    // V8 : la pensée interruptible se règle (done / deadline / barge) → plus de barge-in possible dessus.
    if (id === this.armedUttId) { this.armedUttId = null; this.bargeArmed = false; }
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
    // Traîne 0 après un barge-in (sa voix est CUPÉE → aucun résidu à laisser passer, prêt tout de suite pour la suite de
    // Yohann, déjà captée en rétroactif) ; sinon la traîne normale couvre le résidu post-AEC de sa fin de phrase.
    const tail = this.bargeInProgress ? 0 : this.gateTailMs;
    this.bargeInProgress = false;
    this.idleTimer = setTimeout(() => {
      this.busy = false; this.idleTimer = null;
      // Retour au repos : sa voix + la traîne sont passées → réveiller les oreilles (cross-process). gateTailMs couvre le
      // résidu post-AEC encore dans le ring (== la traîne _tail_s de la bouche). Un barge-in a déjà remis `resume` (avec la
      // marque) → setListenMode est alors un no-op. Le monolithe l'ignore (gate local).
      this.setListenMode("resume");
    }, tail);
  }
}
