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
import { isHallucination, isGoodnight, matchClosing, matchOpening, matchPause, norm } from "./portier.js";
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
  presence: string;  // V10-partiel (conv 51) : reprise après pause (« tu es là Sophia ? ») → « Oui, je suis là. »
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
  filler: "Donne-moi une petite minute.",
  secours: "Désolée, je n'ai pas réussi à répondre, là, tout de suite.",
  presence: "Oui, je suis là.",
};

export interface RouterOptions {
  /** Monolithe (1 canal pour tout) : `ipc`. Archi 2 process (conv 47) : `earsIpc` (evt.wake/stt/turn + cmd.listen) +
   *  `mouthIpc` (cmd.tts + evt.tts.start/done). Fournir `ipc` SEUL (les deux rôles dessus) OU `earsIpc`+`mouthIpc`. */
  ipc?: RouterIpc;
  earsIpc?: RouterIpc;
  mouthIpc?: RouterIpc;
  brain: RouterBrain;
  onLog?: (l: string) => void;
  /** Cerveau muet > ça → masqueur (« Donne-moi une petite minute ») joué UNE fois. 3 s (= banc FILLER_AFTER ;
   *  calé à l'oreille par Yohann conv 52 : le hmm à 1,5 s comble le petit blanc, la phrase ne part que sur les
   *  tours vraiment lents). perf ⛔ : le hmm devant + la phrase à 3 s → jamais moins bien que le banc. */
  fillerAfterMs?: number;
  /** V10 (conv 52) — cerveau muet > ça → « hmm » de réflexion joué UNE fois (clip vendorisé, AVANT le masqueur).
   *  Comble un blanc qui SE SENT ; le masqueur (phrase longue) reste pour les tours vraiment lents. Défaut 1,4 s
   *  (conv 56, calé à l'oreille de Yohann : avec la réflexion coupée la médiane réponse→son est ~1,9 s → un seuil
   *  bas déclenchait sur QUASI tous les tours = tic ; à 1,4 s, seuls les tours réellement traînants le reçoivent).
   *  Défaut = variable `SOPHIA_HMM_AFTER_MS` (réglable à l'oreille), sinon 1400. */
  hmmAfterMs?: number;
  /** V10 — nom du clip « hmm » vendorisé (resources/clips/<name>.wav). Défaut « hmm » (prise 1, sobre ; alt « hmm-alt »). */
  hmmClip?: string;
  /** conv 55 — PROBABILITÉ que le hmm joue quand il pourrait (tour par tour, indépendant). 1 = toujours (systématique) ;
   *  0,6 = ~3 fois sur 5, ALÉATOIRE (anti-tic : un humain ne fait pas « hmm » à CHAQUE réponse ; l'imprévisible sonne
   *  naturel + les tours sans hmm sont plus vifs). Défaut = variable `SOPHIA_HMM_PROB` (réglable à l'oreille), sinon 0,6. */
  hmmProbability?: number;
  /** conv 55 — source d'aléa (COUTURE, patron `now`) : injectée déterministe dans les tests du routeur. Défaut Math.random. */
  random?: () => number;
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
  /** M-6 (croisé conv 56) : deadline F-A DÉDIÉE aux CLIPS (hmm). Un clip ABSENT côté sidecar (WAV non vendorisé sur
   *  un clone frais — no-op silencieux, jamais de evt.tts.start) gèlerait sinon le gate `doneDeadlineMs` (30 s) à
   *  CHAQUE hmm tiré. Un clip existant démarre en ~centaines de ms (rien ne joue quand le hmm part) → 5 s = marge
   *  large qui borne le cas absent à un blanc court au lieu d'une surdité. */
  clipDeadlineMs?: number;
  /** evt.wake sans evt.stt.final apparié (cas pathologique) → salutation générique après ça (jamais bloquée occupée). */
  greetFallbackMs?: number;
  /** V10-partiel (conv 51) : à la REPRISE d'une pause, attente MAX que le cerveau ait fini d'écrire sa pensée en fond
   *  (option B) avant de reprendre. Sur un vrai appel (pause longue) il a fini depuis longtemps → 0 attente ; ce délai
   *  ne mord que sur une reprise TRÈS rapide (< la durée de génération). Au-delà, elle reprend ce qui est écrit. */
  resumeWaitMs?: number;
  /** V10-partiel (conv 51) : cadence de parole d'A20 (chars/s) pour ESTIMER, au barge, où elle en était À VOIX HAUTE
   *  (temps parlé × cadence) → point de reprise « début de la phrase coupée ». Défaut ~11 c/s = DÉLIBÉRÉMENT CONSERVATEUR
   *  (F1 croisé conv 51) : sous-estimer → la reprise penche vers RE-DIRE un peu plutôt que SAUTER du contenu jamais
   *  entendu (le débit FR réel est plus haut ; l'estimation basse est l'erreur SÛRE). À calibrer au juge à ta voix. */
  speechCharsPerSec?: number;
  /** Horloge (injectable pour les tests) — `Date.now` par défaut. Sert à mesurer le temps de parole écoulé (reprise). */
  now?: () => number;
  /** V11 — notifié à CHAQUE transition d'état d'écoute (le routeur possède ListenState) → la RÉSIDENCE des modèles
   *  en dérive le groupe voix (`cmd.model.policy`). Additif, à côté des `cmd.listen.*` ; un callback qui lève ne
   *  casse jamais le routeur. */
  onVoiceState?: (mode: ListenMode) => void;
  /** ARCHIVE (conv 53) — notifié à la FIN de CHAQUE tour de dialogue, avec le texte COMPLET des DEUX voix
   *  (`user` = ta phrase du tour, `sophia` = sa réponse entière — même après un barge, le cerveau finit en
   *  fond → texte complet). Un simple JOURNAL d'échanges (l'écriture fichier se fait AU BORD). ADDITIF et
   *  PASSIF : un callback qui lève ne casse jamais le routeur ni la voix. N'EST PAS la mémoire — `plan/02` la
   *  bâtit (table `conversations`, re-feed) ; il pourra LIRE ce journal comme source, mais n'en dépend pas. */
  onExchange?: (e: { ts: number; user: string; sophia: string }) => void;
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

/** V10-partiel (conv 51) — index du DÉBUT de la phrase qui contient la position `pos` (le point de coupe) : juste
 *  après le dernier terminateur de phrase (.!?…, éventuel guillemet fermant) + espace, à ou avant `pos`. La reprise
 *  repart de là → elle RE-DIT la phrase sur laquelle elle a été coupée (voulu : « début de la phrase coupée »), puis
 *  continue. 0 si aucune frontière avant `pos` (phrase unique → tout re-dire). Robuste à un `pos` hors bornes. */
function sentenceStartBefore(text: string, pos: number): number {
  const end = Math.max(0, Math.min(pos, text.length));
  let start = 0;
  const re = /[.!?…]+["'»)\]]?\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const after = m.index + m[0].length;
    if (after <= end) start = after;
    else break;
  }
  return start;
}

interface UttState { resolve: () => void; promise: Promise<void>; timer: ReturnType<typeof setTimeout>; }

/** V10-partiel (conv 51) — une PENSÉE développée en cours de génération. `text` = accumulé AU FIL (TOUS les deltas,
 *  même après un barge : le cerveau finit en fond, option B). `done` = le cerveau a fini d'écrire. `whenDone` = résolue
 *  à la fin (la reprise l'attend brièvement si tu reviens très vite). NB : le point de reprise n'est PAS « ce qui a été
 *  poussé » (le cerveau streame BIEN plus vite qu'elle ne parle → il a déjà quasi tout poussé alors qu'elle n'a dit que
 *  2-3 phrases) ; c'est une ESTIMATION de ce qu'elle a dit À VOIX HAUTE = temps de parole écoulé × sa cadence (bargeIn). */
interface Thought { text: string; done: boolean; whenDone: Promise<void>; }

/** conv 55 — proba du hmm depuis `SOPHIA_HMM_PROB` (clampée [0,1]), défaut 0,6 (~3/5). Aléatoire = anti-tic.
 *  N-5 (croisé conv 56) : `trim()` — une valeur BLANCHE (`" "`) vaudrait `Number(" ")===0` = « jamais de hmm »
 *  en silence ; le blanc = non-réglé = défaut. */
function envHmmProb(): number {
  const raw = process.env.SOPHIA_HMM_PROB;
  if (raw == null || raw.trim() === "") return 0.6;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.6;
}

/** conv 56 — seuil du hmm depuis `SOPHIA_HMM_AFTER_MS` (entier ≥ 0), défaut 1400 ms. Le seuil décide SI un blanc
 *  mérite un hmm (au-delà de ~1 s, un silence se sent) ; la probabilité décide s'il OSE (anti-tic). Deux curseurs,
 *  deux rôles — tous deux réglables à l'oreille sans retoucher le code. */
function envHmmAfterMs(): number {
  const raw = process.env.SOPHIA_HMM_AFTER_MS;
  if (raw == null || raw.trim() === "") return 1400; // N-5 conv 56 : blanc = non-réglé (Number(" ")===0 aurait remis le tic à 0 ms)
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1400;
}

export class ConversationRouter {
  private readonly ears: RouterIpc;   // evt.wake/stt/turn (écoute) + cmd.listen.* (gate anti-auto-écoute cross-process)
  private readonly mouth: RouterIpc;  // cmd.tts.* (la voix) + evt.tts.start/done. Monolithe → ears === mouth (1 canal).
  private readonly brain: RouterBrain;
  private readonly onLog?: (l: string) => void;
  private readonly ph: RouterPhrases;
  private readonly fillerAfterMs: number;
  private readonly hmmAfterMs: number;   // V10 (conv 52) : « hmm » de réflexion (clip), AVANT le masqueur
  private readonly hmmClip: string;      // V10 : nom du clip vendorisé (resources/clips/<name>.wav)
  private readonly hmmProbability: number; // conv 55 : proba que le hmm joue (aléatoire tour par tour, anti-tic)
  private readonly random: () => number;   // conv 55 : source d'aléa injectable (tests déterministes)
  private readonly gateTailMs: number;
  private readonly doneDeadlineMs: number;
  private readonly playbackDeadlineMs: number;
  private readonly clipDeadlineMs: number;   // M-6 conv 56 : deadline courte des clips (hmm) — un clip absent ne gèle pas le gate 30 s
  private readonly greetFallbackMs: number;
  private readonly resumeWaitMs: number;
  private readonly speechCharsPerSec: number;
  private readonly now: () => number;
  private readonly onVoiceStateCb?: (mode: ListenMode) => void;   // V11 : notifie la résidence des modèles
  private readonly onExchange?: (e: { ts: number; user: string; sophia: string }) => void;   // conv 53 : archive des échanges
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
  /** V10-partiel (conv 51) : la PENSÉE développée EN COURS (nul hors d'un `respond`). Un barge peut la mettre de côté. */
  private thought: Thought | null = null;
  /** V10-partiel (conv 51) : heure (this.now) du 1er son de la pensée en cours (evt.tts.start sur armedUttId). Sert à
   *  ESTIMER, au barge, où elle en était À VOIX HAUTE (temps parlé × cadence). Nul hors d'une pensée qui a commencé à jouer. */
  private thoughtSpokenAt: number | null = null;
  /** V10-partiel (conv 51) : une pensée MISE DE CÔTÉ par un barge. Au tour SUIVANT : « attends s'il te plaît » → TENUE
   *  (pause, sommeil name-only) jusqu'à la reprise « tu es là Sophia ? » ; toute autre phrase → JETÉE (barge d'aujourd'hui,
   *  elle répond à la nouvelle question). `cutAt` = ESTIMATION (chars) de ce qu'elle avait dit à voix haute → reprise au
   *  DÉBUT de la phrase coupée. Le `thought` référencé continue de se remplir en fond (option B) → texte complet prêt. */
  private heldThought: { thought: Thought; cutAt: number } | null = null;
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
    this.fillerAfterMs = opts.fillerAfterMs ?? 4000;   // conv 52 : phrase longue à 4 s (le hmm 2 s finit ~3,35 s → ~0,65 s de blanc avant ; tâtonné à l'oreille)
    this.hmmAfterMs = opts.hmmAfterMs ?? envHmmAfterMs();   // conv 56 : défaut 1,4 s. Le 0,35 s de conv 55 déclenchait sur QUASI tous les tours (médiane réponse→son ~1,9 s > 0,35 s) → ×0,6 = un hmm sur ~1 tour sur 3 = tic (Yohann à l'oreille, conv 56). À 1,4 s, seuls les tours réellement traînants passent le seuil → le hmm redevient occasionnel ET utile (il comble un blanc qui SE SENT, ~sous la médiane mais au-dessus du silence naturel d'une conversation). Réglable SOPHIA_HMM_AFTER_MS.
    this.hmmClip = opts.hmmClip ?? "hmm";
    this.hmmProbability = opts.hmmProbability ?? envHmmProb();   // conv 55 : hmm aléatoire (anti-tic), réglable SOPHIA_HMM_PROB
    this.random = opts.random ?? Math.random;
    this.gateTailMs = opts.gateTailMs ?? 800;
    this.doneDeadlineMs = opts.doneDeadlineMs ?? 30000;
    this.playbackDeadlineMs = opts.playbackDeadlineMs ?? 120000;
    this.clipDeadlineMs = opts.clipDeadlineMs ?? 5000;   // M-6 conv 56
    this.greetFallbackMs = opts.greetFallbackMs ?? 1500;
    this.resumeWaitMs = opts.resumeWaitMs ?? 4000;
    this.speechCharsPerSec = opts.speechCharsPerSec ?? 11; // conservateur (F1) : sous-estimer → re-dire, jamais sauter
    this.now = opts.now ?? (() => Date.now());
    this.onVoiceStateCb = opts.onVoiceState;   // V11 : la résidence des modèles dérive le groupe voix des transitions
    this.onExchange = opts.onExchange;   // conv 53 : archive des échanges (au bord ; jamais dans le cœur de la voix)
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
    // V10-partiel (conv 51) : une pensée GARDÉE (heldThought) ne survit PAS à un retour VEILLE (clôture / garde R-1 qui
    // rendort sur inactivité) — sinon un « bonjour Sophia » frais déclencherait une REPRISE au lieu d'une salutation.
    // SEULE une PAUSE la tient (états ecoute→PAUSE, jamais veille). VEILLE = repart à neuf.
    if (mode === "veille") this.heldThought = null;
    // dictee/approbation = V10 (crochets inertes) : aucune commande ici.
    // V11 : notifier la RÉSIDENCE des modèles de la transition (elle en dérive le groupe voix → cmd.model.policy).
    // Après le cmd.listen.* pour que la politique suive l'armement. Un callback qui lève ne casse jamais le routeur.
    try { this.onVoiceStateCb?.(mode); } catch (e) { this.log(`résidence onVoiceState : ${(e as Error)?.message ?? String(e)}`); }
  }

  // N2 (croisé conv 47) : un logger injecté qui lève ne doit JAMAIS ré-émerger en rejection flottante depuis un
  // handler .catch (runInteraction/send). console.log/systray ne lèvent pas ; défense bon marché.
  private log(l: string): void { try { this.onLog?.(l); } catch { /* un logger qui lève ne casse jamais le routeur */ } }

  /** ARCHIVE (conv 53) : journalise un tour de dialogue complet (les DEUX voix). PASSIF, jamais fatal, jamais
   *  dans le chemin de la voix. Ignore un tour sans réponse voisée (secours / abort sans texte). */
  private logExchange(user: string, sophia: string): void {
    if (!sophia) return;
    try { this.onExchange?.({ ts: this.now(), user, sophia }); } catch { /* un archiveur qui lève ne casse jamais le routeur */ }
  }

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
    this.bargeArmed = false; this.armedUttId = null; this.thoughtSpokenAt = null;
    this.heldThought = null; this.thought = null;   // V10-partiel : une pause en cours ne survit pas à l'arrêt (quiesce)
    try { this.thoughtAbort?.abort(); } catch { /* */ }
    for (const id of [...this.inFlight.keys()]) this.settleUtterance(id); // résout les awaits (ne bloque pas l'arrêt)
    try { void Promise.resolve(this.mouth.request("cmd.tts.stop", {})).catch(() => { /* */ }); } catch { /* */ }
    // Ne jamais laisser les oreilles gatées (mute/arm) à l'arrêt (sinon Sophia sourde au prochain démarrage du routeur).
    if (this.listenMode !== "resume") { this.listenMode = "resume"; try { void Promise.resolve(this.ears.request("cmd.listen.resume", {})).catch(() => { /* */ }); } catch { /* */ } }
  }

  // ── réception des evt.* ────────────────────────────────────────────────────────
  private onWake(_env: Envelope): void {
    if (this.stopped) return;
    // V10-partiel (conv 51) : réveil PENDANT une PAUSE tenue → REPRISE (« tu es là Sophia ? » → « Oui, je suis là » +
    // reprise au début de la phrase coupée), PAS une salutation. La reprise n'est légitime QUE depuis une vraie PAUSE
    // (states=pause) — le SEUL état où le sidecar est name-only AVEC une pensée gardée. Le sidecar s'est réveillé de son
    // sommeil name-only sur l'ouvreur ; on reprend le fil au lieu de saluer.
    if (this.heldThought && this.states.current === "pause") {
      if (this.busy) { this.log("réveil (reprise) ignoré (occupée)"); return; }
      if (this.lastFinal) this.lastFinal.consumed = true; // ce final ne servira jamais d'ouvreur à une salutation
      this.busy = true;
      this.runInteraction(this.resumeHeld());
      return;
    }
    // MINEUR (re-croisé conv 51) : un `heldThought` encore posé HORS pause est PÉRIMÉ — un barge dont la phrase
    // interruptrice fut inaudible (toux/hallucination) laisse heldThought non désambiguïsé en ÉCOUTE (onTurnEnd sort au
    // filtre hallucination AVANT le bloc held). Sur un réveil FRAIS, ne JAMAIS reprendre une pensée abandonnée → on la
    // jette et on salue. (En prod, name-only exige pause/clôture/R-1 ; les 2 derniers effacent déjà heldThought → cas
    // inatteignable, mais défense en profondeur : « resume ⟺ PAUSE », invariant explicite.)
    if (this.heldThought) this.heldThought = null;
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
    // V10-partiel (MINEUR-2 croisé conv 51) : en PAUSE (sommeil), tout evt.turn.end est un RÉSIDU (le sidecar n'a pas
    // encore traité `cmd.listen.stop`, ou une parole traînait par-dessus « attends ») → l'IGNORER. Sinon il CASSERAIT
    // la pause qu'on vient de demander (heldThought jeté + respond sur le résidu → pensée gardée perdue). VEILLE n'est
    // pas gardée ici (le sidecar name-only n'émet pas de tour ; et le résidu de clôture reste couvert par busy/traîne).
    if (this.states.current === "pause") { this.log("evt.turn.end ignoré (PAUSE : sommeil, tout est résidu)"); return; }
    // GATE b2 : occupée (elle parle / réfléchit) → IGNORER (résidu de sa voix → faux tour). Un-tour-à-la-fois.
    if (this.busy) { this.log("evt.turn.end ignoré (GATE : occupée)"); return; }
    const text = this.lastFinal?.text ?? "";
    const nsp = this.lastFinal?.nsp;
    // MAJEUR-1 : ce final est UTILISÉ par ce tour → il ne doit JAMAIS servir d'ouvreur à un éveil futur (le marquer
    // consommé même si le tour est ensuite ignoré — il a été vu). M2 : passer nsp au filtre (fidèle au banc _on_turn).
    if (this.lastFinal) this.lastFinal.consumed = true;
    if (norm(text).length < 3 || isHallucination(text, nsp)) { this.log(`tour ignoré (rien de clair) : « ${text} »`); return; }
    // V10-partiel (conv 51) : au tour SUIVANT un barge, « attends s'il te plaît » → SUSPENSION (garde la pensée,
    // sommeil name-only) ; toute AUTRE phrase → la pensée coupée est JETÉE → elle répond à ta nouvelle question
    // (le barge d'aujourd'hui, INCHANGÉ). `heldThought` n'est posé QUE par un barge → aucune interférence hors barge.
    if (this.heldThought) {
      if (matchPause(text)) { this.busy = true; this.runInteraction(this.handlePause()); return; }
      this.heldThought = null; // nouvelle question → on jette la pensée coupée (comportement barge actuel)
    }
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
    // V10-partiel (conv 51) : mettre la pensée coupée DE CÔTÉ. Le tour SUIVANT dira si c'est « attends s'il te plaît »
    // (→ pause : on la tient) ou une nouvelle question (→ on la jette, barge d'aujourd'hui). Le cerveau la finit en fond.
    // `cutAt` = ESTIMATION de ce qu'elle a dit À VOIX HAUTE (temps de parole écoulé × cadence) → reprise au DÉBUT de la
    // phrase coupée. PAS « ce qui a été poussé » : le cerveau streame BIEN plus vite qu'elle ne parle (il a déjà quasi
    // tout poussé) → s'y fier sauterait tout le milieu. 0 si le 1er son n'a pas encore joué (rien dit → tout reprendre).
    if (this.thought) {
      const spokenMs = this.thoughtSpokenAt != null ? Math.max(0, this.now() - this.thoughtSpokenAt) : 0;
      const cutAt = Math.round(spokenMs * this.speechCharsPerSec / 1000);
      this.heldThought = { thought: this.thought, cutAt };
    }
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
    if (Number.isFinite(id) && id === this.armedUttId) { this.setListenMode("arm"); this.bargeArmed = true; this.thoughtSpokenAt = this.now(); }
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
    let hmmId: number | null = null;     // V10 (conv 52) : « hmm » de réflexion (clip), AVANT le masqueur
    let barged = false;                  // V8 option B : Yohann a coupé cette pensée → jeter les deltas restants (le cerveau finit en fond)
    // V10-partiel (conv 51) : la PENSÉE développée. `text` accumule TOUS les deltas (même après un barge : le cerveau
    // finit en fond, option B) → une pause peut la reprendre au complet. `whenDone` = résolue quand le cerveau a fini
    // d'écrire (la reprise l'attend brièvement). Le point de reprise, lui, est TEMPOREL (cutAt calculé dans bargeIn :
    // temps de parole × cadence) — PAS « ce qui a été poussé » (le cerveau streame bien plus vite qu'elle ne parle).
    let resolveDone!: () => void;
    const thought: Thought = { text: "", done: false, whenDone: new Promise<void>((r) => { resolveDone = r; }) };
    this.thought = thought;
    this.thoughtSpokenAt = null; // (re)parle : l'heure du 1er son sera posée par onTtsStart (pour estimer le point de reprise)
    // masqueur (perf ⛔) : cerveau muet > fillerAfter → énonciation SÉPARÉE (joue AVANT la réponse dans le train du
    // sidecar — ordre d'ARRIVÉE des phrases, pas des ids). Non compté comme réponse.
    const fillerTimer = setTimeout(() => {
      if (uid != null || this.stopped) return; // réponse déjà ouverte / arrêt → pas de masqueur
      fillerId = ++this.uttSeq;
      this.beginUtterance(fillerId); this.pushDelta(fillerId, this.ph.filler); this.endUtterance(fillerId);
      this.log("masqueur joué (cerveau lent)");
    }, this.fillerAfterMs);
    // V10 (conv 52) : « hmm » de réflexion — clip caché joué AVANT le masqueur (comble le petit blanc précoce, choix
    // Yohann conv 33/52). Énonciation MUTE (id != armedUttId → onTtsStart pose `mute`, pas de barge-in dessus),
    // ordonnée dans le train de la bouche → joue avant la réponse. La phrase longue (2,5 s) reste inchangée.
    const hmmTimer = setTimeout(() => {
      if (uid != null || this.stopped) return; // réponse déjà ouverte / arrêt → pas de hmm
      // conv 55 : hmm ALÉATOIRE (anti-tic) — tirage INDÉPENDANT tour par tour ; sauté ⇒ elle répond direct (plus vif).
      if (this.random() >= this.hmmProbability) { this.log("hmm sauté (aléatoire)"); return; }
      hmmId = ++this.uttSeq;
      this.playClip(hmmId, this.hmmClip);
      this.log("hmm joué (réflexion)");
    }, this.hmmAfterMs);

    // AbortController = QUIESCE/arrêt seulement (kill du cerveau à l'extinction). Le barge, lui, NE tue PAS le cerveau
    // (option B, décision Yohann conv 49 — préserver le contexte, sinon amnésie à chaque coupe ; corrigé au plan/02).
    // Sur un barge, `bargeCurrentThought` (per-tour) fait DEUX choses : (a) `barged=true` → les deltas restants ne sont
    // plus POUSSÉS à la bouche (coupée) mais TOUJOURS ACCUMULÉS dans `thought.text` (reprise) ; (b) résout la course →
    // respond rend TOUT DE SUITE (busy se lève pour la suite de Yohann) pendant que le cerveau FINIT SA GÉNÉRATION EN FOND.
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
          if (this.stopped || !piece) return;
          thought.text += piece;             // ACCUMULE toujours (même post-barge : le cerveau finit en fond, option B)
          if (barged) return;                // post-barge : la bouche est coupée → ne pas pousser (mais le texte est gardé)
          // 1er delta : ouvre l'énonciation de la pensée + la marque INTERRUPTIBLE (evt.tts.start dessus → arm + barge armé).
          if (uid == null) { clearTimeout(fillerTimer); clearTimeout(hmmTimer); uid = ++this.uttSeq; this.armedUttId = uid; this.beginUtterance(uid); }
          this.pushDelta(uid, piece);
        },
      });
      // Le cerveau finit en fond après un barge (option B) → à la résolution on fige le texte AUTORITAIRE + `done` (la
      // reprise attend `whenDone` brièvement). WarmBrain ne rejette jamais par contrat (le .catch est une défense).
      asked
        .then((res) => { if (res && typeof res.text === "string" && res.text.length > thought.text.length) thought.text = res.text; })
        .catch(() => { /* jamais fatal */ })
        .finally(() => { thought.done = true; resolveDone(); this.logExchange(text, thought.text); });
      const raced = await Promise.race([asked, bargePromise]);
      result = "barged" in raced ? { isError: false, aborted: true, text: "" } : raced;
    } finally {
      clearTimeout(fillerTimer);
      clearTimeout(hmmTimer);
      this.bargeCurrentThought = null;
      if (this.thoughtAbort === ac) this.thoughtAbort = null;
      // MAJEUR-1 (croisé conv 51) : NE PAS nullifier `this.thought` ICI. Le cerveau streame BIEN plus vite qu'elle ne
      // parle → `asked` résout (donc ce finally s'exécute) alors qu'elle PARLE ENCORE la longue pensée (bloquée plus bas
      // sur awaitDone). La nullifier ici la rendait invisible à un barge PENDANT la lecture → pas de heldThought → pause
      // perdue (le cas le PLUS courant pour une longue réponse). `this.thought` reste vivant jusqu'à ce que l'énonciation
      // ARMÉE se règle (settleUtterance : done / deadline / barge — comme le fait déjà resumeHeld pour la reprise).
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
    if (hmmId != null) await this.awaitDone(hmmId);       // le hmm a joué AVANT → déjà réglé en pratique
    if (fillerId != null) await this.awaitDone(fillerId); // le masqueur a joué AVANT → déjà réglé en pratique
    // MAJEUR-1 filet : chemin SANS énonciation armée (secours / rien voisé) où settleUtterance ne nullifie pas `this.thought`.
    if (this.thought === thought) this.thought = null;
  }

  /** V10-partiel (conv 51) — SUSPENSION (« attends s'il te plaît », juste après un barge). La pensée coupée est déjà
   *  DE CÔTÉ (heldThought, posé par bargeIn) ; ici on met Sophia en SOMMEIL : states.pause() → onListenEnter(pause) →
   *  cmd.listen.stop → le sidecar repasse name-only (seul « … Sophia » la réveille). Le WarmBrain reste CHAUD (le fil
   *  est gardé), le cerveau finit sa pensée en fond. Aucune voix, aucun cerveau ici. Attente INDÉTERMINÉE (pas de timeout). */
  private async handlePause(): Promise<void> {
    this.log("pause : « attends s'il te plaît » → je garde ma pensée et je me mets en sommeil (name-only) jusqu'à « tu es là ? »");
    // MINEUR-3 (croisé conv 51) : pas de traîne après une pause (sa voix a DÉJÀ été coupée par le barge → aucun résidu à
    // laisser passer). Le gate `busy` retombe TOUT DE SUITE → un « tu es là Sophia ? » rapide n'est pas ignoré (occupée).
    this.bargeInProgress = true;
    this.states.pause(); // ÉCOUTE → PAUSE (no-op + log hors ÉCOUTE ; la pensée reste gardée quoi qu'il arrive)
  }

  /** V10-partiel (conv 51) — REPRISE (« tu es là Sophia ? » pendant une pause). « Oui, je suis là » puis elle reprend
   *  au DÉBUT de la phrase coupée et va au bout de sa pensée (le texte, fini en fond, est prêt). La pensée reprise est
   *  INTERRUPTIBLE (re-barge / re-pause possibles). Sur une reprise TRÈS rapide (cerveau pas encore fini) : attente
   *  brève puis reprise de ce qui est écrit (le reste au-delà est perdu — edge rare, tracé §7 ; nul sur un vrai appel). */
  private async resumeHeld(): Promise<void> {
    const held = this.heldThought;
    this.heldThought = null;
    if (!held) return;
    this.log("reprise : « tu es là ? » → « Oui, je suis là » + je reprends au début de la phrase coupée"); // symétrie avec la pause → observable
    this.states.resume(); // PAUSE → ÉCOUTE → cmd.listen.start (ré-arme les oreilles ; idempotent avec l'auto-arm du portier)
    await this.playFixed(this.ph.presence); // « Oui, je suis là. » (phrase FIXE → mute, jamais coupée)
    if (this.stopped) return;
    // attendre brièvement que le cerveau ait fini d'écrire en fond (sur un vrai appel : fini depuis longtemps → ~0 attente).
    await Promise.race([held.thought.whenDone, this.delay(this.resumeWaitMs)]);
    const full = held.thought.text;
    const from = sentenceStartBefore(full, held.cutAt);
    // F4 (croisé conv 51) : ôte l'espace ET un guillemet/parenthèse FERMANT résiduel en tête (typo FR « . » » où la
    // frontière tombe avant le »), sinon Piper prononcerait un caractère parasite au début de la reprise.
    const remainder = full.slice(from).replace(/^[\s»)\]]+/, "");
    if (this.stopped || !remainder) return; // rien à reprendre (pensée vide / déjà tout dit)
    const uid = ++this.uttSeq;
    this.armedUttId = uid; // pensée développée → interruptible (evt.tts.start dessus → arm + barge armé)
    // la reprise est elle-même une pensée développée → re-barge / RE-PAUSE possibles (le téléphone re-sonne). `this.thought`
    // pointe le remainder DÉJÀ complet → un re-barge le remet de côté (heldThought) avec un nouveau cutAt temporel.
    const resumedThought: Thought = { text: remainder, done: true, whenDone: Promise.resolve() };
    this.thought = resumedThought;
    this.beginUtterance(uid);
    this.pushDelta(uid, remainder);
    this.endUtterance(uid);
    await this.awaitDone(uid);
    if (this.thought === resumedThought) this.thought = null;
  }

  /** Petite temporisation (utilisée par la reprise). Le timer orphelin d'une race gagnée par `whenDone` est inoffensif. */
  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
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

  /** V10 (conv 52) — joue un CLIP vendorisé (hmm de réflexion) comme une énonciation. Registre inFlight (deadline F-A
   *  + done) IDENTIQUE à beginUtterance, mais la commande est `cmd.tts.clip` (la bouche joue un WAV — Piper ne fait pas
   *  de hmm naturel) qui émet lui-même start/done (audio + end enfilés côté sidecar). onTtsStart (id != armedUttId) →
   *  `mute`. Un nom inconnu côté sidecar = no-op → la deadline débloque le gate — COURTE pour les clips (M-6 conv 56 :
   *  30 s de gate par hmm sur un clone sans WAV vendorisés = un tiers des tours lents gelés ; 5 s borne le dégât). */
  private playClip(id: number, name: string): void {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    const timer = setTimeout(() => {
      this.log(`evt.tts.start absent (clip ${id}, deadline clip) → déblocage du gate`);
      this.settleUtterance(id);
    }, this.clipDeadlineMs);
    this.inFlight.set(id, { resolve, promise, timer });
    this.send("cmd.tts.clip", { id, name });
  }

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
    // V10-partiel MAJEUR-1 : c'est ICI qu'on lâche `this.thought` (fin de LECTURE), pas dans le finally de respond (fin de
    // GÉNÉRATION, trop tôt). bargeIn lit `this.thought` AVANT d'appeler settleUtterance → un barge pendant la lecture le voit.
    if (id === this.armedUttId) { this.armedUttId = null; this.bargeArmed = false; this.thoughtSpokenAt = null; this.thought = null; }
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
