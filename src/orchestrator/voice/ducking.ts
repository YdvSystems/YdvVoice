// Le DUCKING (V12 — F3, « armé par l'état ») — les médias du PC baissent quand Sophia écoute/parle,
// remontent après. JAMAIS en yo-yo (le But de V12, technique/01 §4.6).
//
// CE QUI EST GRAVÉ (technique/01 §4.6 + critère 11 · plan/01 §3 V12) :
//   · VEILLE : seul `evt.wake` duck — parler à quelqu'un d'autre dans la pièce ne touche pas YouTube.
//   · DICTÉE (S9) : DÉSARMÉ — une musique en yo-yo pendant une dictée serait pénible ; l'AEC (F2) protège déjà le STT.
//   · TABLÉE (AT10, politique doc 04) : armé par SA VOIX + SON NOM seulement (`evt.tts.start` + `evt.wake`),
//     JAMAIS le VAD ambiant (les convives se parlent entre eux). Mécanique ICI, prouvée par injection (le flag
//     `tablee` est une COUTURE inerte — rien ne le pose avant doc 04).
//   · Systématique et non désactivable dans son périmètre ; strictement ORTHOGONAL au toggle voix.
//   · Mécanisme côté ORCHESTRATEUR (mixer Windows) — supersède le « à toute parole » du cahier (M4).
//
// DÉCISION A (Yohann, conv 57 — écart tracé plan/01 §7) : duck par ÉTAT, le temps de la conversation ENTIÈRE.
// F3 disait « le volume remonte après la réponse » (par tour) — mais en conversation suivie, la remontée par tour
// PRODUIT le yo-yo que le But interdit, et Yohann commencerait chaque phrase par-dessus le son plein. Acté : la
// musique reste basse TANT QUE la conversation est ouverte (ÉCOUTE/APPROBATION) et remonte à la SORTIE de
// conversation (clôture → VEILLE · pause · garde R-1 : 30 s d'inactivité → evt.listen.timeout → VEILLE). C'est le
// comportement humain — on baisse la musique quand la conversation commence, on la remonte quand elle finit.
// `evt.vad.start` n'est plus un déclencheur de DUCK (l'état couvre) : « le VAD ambiant ne duck pas » (U-V12,
// testé — vrai en VEILLE par le gravé, en tablée par AT10, en conversation par la décision A). Il TÉMOIGNE en
// revanche de la vie pour le filet dernier-recours (RE-croisé conv 57 — témoigner ≠ ducker).
//
// Machine PURE (patron ListenState/ModelResidence) : mixer INJECTABLE (`DuckMixer` — prod = WindowsMixer,
// tests = faux), sorties DÉ-DOUBLONNÉES (jamais un duck/restore redondant), un mixer qui lève ne casse jamais la
// policy. Les délais sont configurables (tests courts). Testée seule (tests/u-ducking.mjs) ; le levier réel
// (sessions WASAPI par app, helper PowerShell persistant) vit dans duck-mixer.ts — mesuré conv 57 : duck réel
// 1,4 ms méd vu de Node, restore identique, persistance per-app Windows CONFIRMÉE (d'où le write-ahead du mixer).
//
// FILETS (patron F-A/R-1 — jamais un duck coincé, jamais une musique basse à vie) :
//   · duck posé en VEILLE/PAUSE (éveil, goodnight, future phrase proactive) SANS passage en ÉCOUTE → restore à
//     `tts.done`-en-VEILLE (le goodnight fini → la musique revient) + deadline `wakeDeadlineMs` (15 s) si même
//     le tts.done ne vient jamais.
//   · en conversation SAINE, la sortie normale = clôture/pause/garde R-1 → VEILLE → restore ; si les OREILLES
//     MEURENT (socket mort, frontière V9), plus aucun événement — le filet DERNIER-RECOURS `conversationIdleMs`
//     (600 s, témoigné par vad/tts/wake) remonte seul. (Le RE-croisé a réfuté « R-1 mordrait avant » : pendant
//     un long monologue il y a de l'ACTIVITÉ audio invisible aux événements tts — d'où le vad-témoin + 600 s.)
//   · stop() (quiesce ⑩) restaure TOUJOURS avant de mourir.

import type { ListenMode } from "./states.js";

/** Le levier (injecté) : baisser / remonter les médias. Les DEUX sont idempotents côté mixer ; la policy
 *  dé-doublonne déjà (un seul duck() par période basse, un seul restore() à la remontée). */
export interface DuckMixer {
  duck(): void;
  restore(): void;
}

export interface DuckingOptions {
  mixer: DuckMixer;
  /** COUTURE tablée (doc 04, AT10) — rien ne le pose aujourd'hui (inerte). En tablée : régime ÉVÉNEMENTIEL
   *  (sa voix + son nom duck, hystérésis courte après sa voix), les états V9 n'y duck pas. */
  tablee?: boolean;
  /** Filet : duck posé HORS conversation (veille/pause) sans suite → restore après ça. Défaut 15 s. */
  wakeDeadlineMs?: number;
  /** Tablée : remontée après sa voix (hystérésis courte anti-yo-yo entre ses phrases). Défaut 2 s. */
  tableeReleaseMs?: number;
  /** Dyadique : remontée DIFFÉRÉE après une voix finie en VEILLE/PAUSE (SOLO-1 conv 57) : au réveil, le
   *  `tts.done` du salut arrive AVANT la transition vers ÉCOUTE (le routeur attend `awaitDone` PUIS
   *  `states.wake()`) — un restore immédiat ferait un BLIP de remontée entre le salut et la conversation.
   *  Différé court : l'ÉCOUTE qui suit l'annule (aucun blip) ; le goodnight (aucune transition) remonte
   *  après ce délai (imperceptible). Défaut 700 ms. */
  veilleReleaseMs?: number;
  /** m6 (croisé conv 57, recalibré au RE-croisé) — filet « conversation MORTE », DERNIER RECOURS : si les
   *  OREILLES meurent en pleine conversation duckée (socket mort, frontière V9), plus AUCUN événement
   *  n'arrive, l'état reste ÉCOUTE → sans ceci les médias resteraient bas jusqu'au quit. Ré-armé à CHAQUE
   *  signe de vie — Y COMPRIS `vad.start` (RE-croisé MAJEUR : `evt.tts.start` n'est émis qu'UNE fois par
   *  énonciation → une tirade de plusieurs minutes = zéro événement tts intermédiaire ; et pendant un long
   *  monologue de Yohann, seule SA parole vit — le vad TÉMOIGNE de la vie SANS ducker, le contrat U-V12
   *  « le VAD ambiant ne duck pas » tient). Défaut 600 s = au-delà de TOUTE énonciation ou monologue
   *  physiquement possible (le gate du routeur borne à 120 s de génération ; l'audio le plus long observé
   *  ~85 s) → zéro faux positif ; oreilles mortes = restore en ≤ 10 min au pire (dernier recours, pas une
   *  réactivité). */
  conversationIdleMs?: number;
  onLog?: (l: string) => void;
}

/** La politique de ducking (V12). Possédée par l'orchestrateur ; branchée à côté du routeur (fan-out
 *  onVoiceState, patron V11) + abonnée aux evt.* (wake/tts) — le routeur n'est PAS touché. */
export class DuckingPolicy {
  private readonly mixer: DuckMixer;
  private readonly tablee: boolean;
  private readonly wakeDeadlineMs: number;
  private readonly tableeReleaseMs: number;
  private readonly veilleReleaseMs: number;
  private readonly conversationIdleMs: number;
  private readonly onLog?: (l: string) => void;

  private mode: ListenMode = "veille"; // suit ListenState (le routeur démarre en VEILLE)
  private ducked = false;              // dernier INTENT émis au mixer (dé-doublonnage)
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;   // filet duck-hors-conversation
  private tableeTimer: ReturnType<typeof setTimeout> | null = null; // release tablée post-tts
  private releaseTimer: ReturnType<typeof setTimeout> | null = null; // restore DIFFÉRÉ veille/pause (SOLO-1)
  private idleTimer: ReturnType<typeof setTimeout> | null = null;   // filet conversation MORTE (m6)
  private stopped = false;

  constructor(opts: DuckingOptions) {
    this.mixer = opts.mixer;
    this.tablee = opts.tablee ?? false;
    this.wakeDeadlineMs = opts.wakeDeadlineMs ?? 15000;
    this.tableeReleaseMs = opts.tableeReleaseMs ?? 2000;
    this.veilleReleaseMs = opts.veilleReleaseMs ?? 700;
    this.conversationIdleMs = opts.conversationIdleMs ?? 600000; // RE-croisé : 180 s mordait une tirade > 3 min
    this.onLog = opts.onLog;
  }

  /** L'intent courant — LECTURE SEULE (vue dérivée O5 : /debug, futurs voyants, tests). */
  get isDucked(): boolean {
    return this.ducked;
  }

  // ── entrées (événements + état) ────────────────────────────────────────────────

  /** Transition d'état d'écoute (V9, fan-out du routeur — patron V11). Régime dyadique : le duck SUIT l'état
   *  (décision A). En tablée : seuls DICTÉE (désarmé, S9) et la sortie de tablée comptent — les états ne duck pas. */
  onVoiceState(mode: ListenMode): void {
    if (this.stopped) return;
    this.mode = mode;
    if (mode === "dictee") {
      // S9 : désarmé — entrer en dictée pendant un duck → restore, et plus rien ne duck tant qu'on y est.
      // NIT-e (re-croisé conv 57) : TOUS les timers éteints (release/idle compris — leurs callbacks étaient
      // gardés par mode, l'asymétrie était bénigne mais sale).
      this.clearWakeTimer();
      this.clearTableeTimer();
      this.clearReleaseTimer();
      this.clearIdleTimer();
      this.restoreOff("dictée (désarmé, S9)");
      return;
    }
    if (this.tablee) return; // tablée : régime événementiel pur (AT10) — les états V9 n'y duck jamais
    if (mode === "ecoute" || mode === "approbation") {
      // conversation OUVERTE → les médias restent bas tout du long (décision A). Le duck d'éveil devient permanent.
      // SOLO-1 : un restore DIFFÉRÉ en attente (le tts.done du salut est passé en VEILLE) est ANNULÉ → aucun blip.
      this.clearWakeTimer();
      this.clearReleaseTimer();
      this.duckOn(`conversation (${mode})`);
      this.armIdleTimer(); // m6 : le filet « conversation morte » s'arme (ré-armé à chaque signe de vie)
    } else {
      // veille | pause → SORTIE de conversation (clôture, pause, garde R-1) → remontée. PAUSE ≡ VEILLE (doc §4.1).
      this.clearWakeTimer();
      this.clearReleaseTimer();
      this.clearIdleTimer();
      this.restoreOff(`sortie de conversation (${mode})`);
    }
  }

  /** `evt.wake` — le nom détecté. VEILLE : LE déclencheur gravé (F3). Tablée : son nom duck (AT10). */
  onWake(): void {
    if (this.stopped || this.mode === "dictee") return;
    this.clearTableeTimer();
    this.clearReleaseTimer(); // un nouvel éveil annule un restore différé en attente
    this.touchIdle();         // m6 : signe de vie
    this.duckOn("wake");
    // hors conversation (veille/pause — l'éveil, ou son nom en tablée) : armer le filet. Si l'ÉCOUTE suit
    // (dyadique), onVoiceState le désarme ; sinon (éveil-clôture « bonne nuit » : l'état RESTE veille, aucun
    // onEnter — le no-op de ListenState) c'est tts.done-en-veille qui restaure, et cette deadline est le filet.
    if (this.tablee || this.mode === "veille" || this.mode === "pause") this.armWakeTimer();
  }

  /** `evt.tts.start` — sa voix démarre. Duck (sauf dictée) : en conversation c'est déjà bas (no-op dé-doublonné) ;
   *  en VEILLE (goodnight d'éveil-clôture, future phrase proactive/secours) ça duck + filet ; en tablée c'est
   *  L'UN DES DEUX SEULS déclencheurs (AT10). */
  onTtsStart(): void {
    if (this.stopped || this.mode === "dictee") return;
    this.clearTableeTimer(); // tablée : elle re-parle pendant la fenêtre de release → pas de yo-yo entre ses phrases
    this.clearReleaseTimer(); // sa voix repart → un restore différé en attente est annulé
    this.touchIdle();         // m6 : signe de vie
    this.duckOn("tts.start");
    if (this.tablee) {
      // tablée : sa voix EST la suite attendue du wake → le filet d'éveil se désarme (sinon il mordrait en pleine
      // tirade > deadline). La remontée naturelle = tts.done → hystérésis. Un tts.done PERDU (moteur mort) laisserait
      // le duck posé — trou assumé du régime INERTE, à durcir à doc 04 quand la tablée devient réelle (§7).
      this.clearWakeTimer();
    } else if (this.mode === "veille" || this.mode === "pause") {
      this.armWakeTimer();
    }
  }

  /** `evt.tts.done` — sa voix finit. Tablée : armer la remontée (hystérésis courte). Dyadique : HORS conversation
   *  (veille/pause), le duck d'éveil/clôture a fini son office → remontée DIFFÉRÉE (SOLO-1 conv 57) : au réveil,
   *  ce done arrive AVANT la transition vers ÉCOUTE (le routeur attend `awaitDone` puis `states.wake()`) — un
   *  restore immédiat ferait un BLIP remonte-redescend entre le salut et la conversation. Le différé court est
   *  annulé par l'ÉCOUTE qui suit ; le goodnight (« bonne nuit Sophia » à froid : l'état ne bouge JAMAIS —
   *  veille → veille est un no-op sans notification) remonte après le délai. */
  onTtsDone(): void {
    if (this.stopped) return;
    this.touchIdle(); // m6 : signe de vie
    if (this.tablee) {
      if (this.ducked) this.armTableeTimer();
      return;
    }
    if ((this.mode === "veille" || this.mode === "pause") && this.ducked) {
      this.armReleaseTimer();
    }
  }

  /** `evt.vad.start` — quelqu'un parle dans la pièce. NE DUCK JAMAIS (entrée testée no-op de duck, U-V12) :
   *  en VEILLE le gravé l'interdit (F3) · en tablée AT10 l'interdit (les convives se parlent entre eux) ·
   *  en conversation l'état couvre déjà (décision A — le vad n'apporte rien AU DUCK).
   *  RE-croisé conv 57 (MAJEUR du filet m6) : il TÉMOIGNE de la vie pour le filet dernier-recours —
   *  pendant un long monologue de Yohann, c'est le SEUL battement (aucun tts/wake) ; témoigner ≠ ducker,
   *  le contrat U-V12 tient (prouvé par injection, u-ducking D : jamais un duck ; F3 : repousse le filet). */
  onVadStart(): void {
    if (this.stopped) return;
    this.touchIdle(); // signe de vie SEULEMENT — jamais un duck (voir u-ducking D)
  }

  /** Arrêt (quiesce ⑩, stopVoice) : restaurer TOUJOURS avant de mourir — jamais un média laissé baissé. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearWakeTimer();
    this.clearTableeTimer();
    this.clearReleaseTimer();
    this.clearIdleTimer();
    if (this.ducked) {
      this.ducked = false;
      try {
        this.mixer.restore();
      } catch (e) {
        this.log(`ducking stop/restore : ${(e as Error)?.message ?? String(e)}`);
      }
    }
  }

  // ── sorties dé-doublonnées ─────────────────────────────────────────────────────

  private duckOn(reason: string): void {
    if (this.ducked) return; // dé-doublonnage : jamais une commande redondante (patron residence.emit)
    this.ducked = true;
    this.log(`ducking : médias BAS [${reason}]`);
    try {
      this.mixer.duck();
    } catch (e) {
      this.log(`ducking mixer.duck : ${(e as Error)?.message ?? String(e)}`);
    }
  }

  private restoreOff(reason: string): void {
    if (!this.ducked) return;
    this.ducked = false;
    this.log(`ducking : médias RESTAURÉS [${reason}]`);
    try {
      this.mixer.restore();
    } catch (e) {
      this.log(`ducking mixer.restore : ${(e as Error)?.message ?? String(e)}`);
    }
  }

  // ── timers (filets) ────────────────────────────────────────────────────────────

  private armWakeTimer(): void {
    this.clearWakeTimer();
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      // toujours hors conversation (dyadique) ou tablée sans suite → jamais un duck coincé (patron F-A/R-1).
      if (this.ducked && (this.tablee || this.mode === "veille" || this.mode === "pause")) {
        this.restoreOff("filet deadline (duck sans suite)");
      }
    }, this.wakeDeadlineMs);
  }

  private clearWakeTimer(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  private armTableeTimer(): void {
    this.clearTableeTimer();
    this.tableeTimer = setTimeout(() => {
      this.tableeTimer = null;
      if (this.ducked) this.restoreOff("tablée : fin de sa voix (hystérésis)");
    }, this.tableeReleaseMs);
  }

  private clearTableeTimer(): void {
    if (this.tableeTimer) {
      clearTimeout(this.tableeTimer);
      this.tableeTimer = null;
    }
  }

  /** SOLO-1 : le restore DIFFÉRÉ de veille/pause (voir onTtsDone). Le filet wakeDeadline reste au-dessus. */
  private armReleaseTimer(): void {
    this.clearReleaseTimer();
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      if (this.ducked && !this.tablee && (this.mode === "veille" || this.mode === "pause")) {
        this.clearWakeTimer();
        this.restoreOff("fin de voix hors conversation (différé)");
      }
    }, this.veilleReleaseMs);
  }

  private clearReleaseTimer(): void {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }

  /** m6 — filet « conversation MORTE » : armé en conversation, ré-armé à chaque signe de vie (touchIdle).
   *  À l'échéance, TOUJOURS en conversation et ducké → les oreilles sont mortes (aucun événement depuis
   *  conversationIdleMs ; la garde R-1 aurait ramené VEILLE bien avant en usage sain) → restore + log.
   *  L'état V9 peut rester ÉCOUTE (la vue peut mentir, frontière V9) mais les médias remontent. */
  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.ducked && !this.tablee && (this.mode === "ecoute" || this.mode === "approbation")) {
        this.restoreOff("filet conversation morte (aucun événement — oreilles perdues ?)");
      }
    }, this.conversationIdleMs);
  }

  private touchIdle(): void {
    if (!this.tablee && (this.mode === "ecoute" || this.mode === "approbation")) this.armIdleTimer();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // un logger injecté qui lève ne casse jamais la policy (parité routeur/states/residence).
  private log(l: string): void {
    try {
      this.onLog?.(l);
    } catch {
      /* un logger qui lève ne casse jamais le ducking */
    }
  }
}
