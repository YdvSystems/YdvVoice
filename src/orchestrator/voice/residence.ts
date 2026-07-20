// La RÉSIDENCE DES MODÈLES côté voix (V11 — 01-E, S7) — « charger/décharger les modèles selon l'état, sans
// jamais dépasser la politique ». UN SEUL ÉMETTEUR (S7) qui replie deux axes en une politique descendue aux
// OREILLES (`cmd.model.policy`) :
//   (1) le GROUPE VOIX — VEILLE (états veille/pause) vs CONVERSATION (écoute/dictée/approbation) — dérivé des
//       états d'écoute V9 (ListenState, possédé par le routeur) ;
//   (2) les CALQUES du gouverneur — SECOURS, JEU — posés par doc 05 (ici on les LIT, on ne les détecte jamais).
// (Le 3ᵉ axe du doc — autorisations transitoires `cmd.tts.cache` — est V13, hors de cette politique.)
//
// ÉCART DE CONCEPTION ASSUMÉ (tracé §7) : 01-E imagine une résidence ALTERNÉE (VEILLE à GPU vide, Whisper↔Kokoro
// sur le GPU, prewarm Whisper au wake). Dans le PRODUIT c'est sans objet — le réveil EST le STT (le wake-model a
// été écarté conv 27) donc le STT reste résident/actif sur le GPU même en VEILLE ; la voix est Piper CPU (pas de
// Kokoro/GPU) ; le seul modèle GPU = le STT. Le set GPU est donc INVARIANT aujourd'hui. V11 pose le CONTRAT
// (politique enregistrée + remontée VRAM via evt.model.*) et le côté sidecar porte le RÉFLEXE réactif (refus VRAM
// → repli CPU). Les dynamiques PROACTIVES (swap JEU→CPU, éviction SECOURS) + leur déclencheur (les calques posés
// par 05, le cerveau de secours) arrivent avec doc 05 — « l'orchestrateur reçoit là la politique de réponse ».
//
// Module Node PUR (IPC + lecteur-de-calques injectés) → testable sans sidecar (tests/u-residence.mjs). Câblé dans
// SophiaRuntime (après PRÊT) : le routeur notifie `onVoiceState` sur transition d'état ; le gouverneur notifie
// `onGovernorMode` sur changement de calque (inerte tant que rien ne les pose — miroir des crochets V9).

import type { Envelope } from "../ipc/index.js";
import type { ListenMode } from "./states.js";

export type VoiceGroup = "veille" | "conversation";
export interface ModelLayers { secours: boolean; jeu: boolean; }
export interface ModelPolicy { group: VoiceGroup; layers: ModelLayers; }

/** Sous-ensemble de l'IpcClient (injecté → testable avec un faux). Aux OREILLES (le STT / la frontière VRAM). */
export interface ResidenceIpc {
  request(type: string, payload?: Record<string, unknown>): Promise<unknown>;
  on(evtType: string, handler: (env: Envelope) => void): void;
}

/** Le gouverneur, vu par la résidence : juste la lecture des calques (jamais la détection — B1/O5). */
export interface ResidenceGovernor {
  hasMode(layer: "SECOURS" | "JEU"): boolean;
}

export interface ResidenceOptions {
  ears: ResidenceIpc;
  governor?: ResidenceGovernor | null;
  onLog?: (l: string) => void;
}

/** Mappe un état d'écoute (V9) vers son GROUPE de résidence : VEILLE/PAUSE → veille (côté sidecar « PAUSE comme
 *  VEILLE », doc §4.1) ; ÉCOUTE/DICTÉE/APPROBATION → conversation. */
export function voiceGroupFor(mode: ListenMode): VoiceGroup {
  return mode === "veille" || mode === "pause" ? "veille" : "conversation";
}

export class ModelResidence {
  private readonly ears: ResidenceIpc;
  private readonly governor: ResidenceGovernor | null;
  private readonly onLog?: (l: string) => void;
  private group: VoiceGroup = "veille"; // le sidecar démarre en VEILLE (le réveil écoute le nom)
  private last: string | null = null;   // dernière politique ÉMISE (JSON) → dé-doublonnage (jamais de commande redondante)
  private started = false;
  private stopped = false;

  constructor(opts: ResidenceOptions) {
    this.ears = opts.ears;
    this.governor = opts.governor ?? null;
    this.onLog = opts.onLog;
  }

  private layers(): ModelLayers {
    const g = this.governor;
    return { secours: !!g?.hasMode("SECOURS"), jeu: !!g?.hasMode("JEU") };
  }

  private policy(): ModelPolicy {
    return { group: this.group, layers: this.layers() };
  }

  /** La politique COURANTE (LECTURE SEULE) — pour /debug, le futur voyant systray, et les tests (O5). */
  current(): ModelPolicy {
    return this.policy();
  }

  /** Démarre : s'abonne aux remontées de résidence + émet la politique INITIALE (`veille` — un sidecar frais n'en a
   *  AUCUNE). NB : ce n'est PAS le resync ORDONNÉ de S10 (politique COURANTE → empreintes → tts.cache, 01 §4.8) — la
   *  résidence redémarre en `veille`, et la reconnexion-sur-respawn en pleine conversation = frontière V15/V9 (§7). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.ears.on("evt.model.loaded", (e) => this.onModelLoaded(e));
    this.ears.on("evt.model.unloaded", (e) => this.onModelUnloaded(e));
    this.emit("initiale");
  }

  /** Arrêt (quiesce) : plus aucune émission (les abonnements meurent avec le socket fermé par stopVoice). Idempotent. */
  stop(): void {
    this.stopped = true;
  }

  /** Transition d'état d'écoute (V9, notifiée par le routeur) → recompose le groupe voix + ré-émet si changé. */
  onVoiceState(mode: ListenMode): void {
    if (this.stopped) return; // NIT-3 (croisé conv 52) : après quiesce, ne pas muter l'état (symétrie avec emit)
    this.group = voiceGroupFor(mode);
    this.emit(`état ${mode}`);
  }

  /** Changement de calque du gouverneur (SECOURS/JEU, posé par doc 05) → ré-émet si changé. INERTE aujourd'hui
   *  (rien ne pose ces calques avant 05 ; le hook existe pour honorer « un seul émetteur, trois axes »). */
  onGovernorMode(): void {
    this.emit("calque gouverneur");
  }

  /** Émet la politique courante aux OREILLES, SEULEMENT si elle a changé depuis la dernière (dé-doublonnage). */
  private emit(reason: string): void {
    if (this.stopped) return;
    const pol = this.policy();
    const key = JSON.stringify(pol);
    if (key === this.last) return; // no-op : jamais une commande redondante
    this.last = key;
    this.log(
      `résidence : cmd.model.policy (${pol.group}` +
        `${pol.layers.secours ? " +secours" : ""}${pol.layers.jeu ? " +jeu" : ""}) [${reason}]`,
    );
    // fire-and-forget : l'ordre est garanti par le WS ; un échec n'interrompt rien (la prochaine transition ré-émet).
    void Promise.resolve(this.ears.request("cmd.model.policy", pol as unknown as Record<string, unknown>)).catch((e) =>
      this.log(`cmd.model.policy : ${(e as Error)?.message ?? String(e)}`),
    );
  }

  private onModelLoaded(env: Envelope): void {
    const p = env.payload ?? {};
    this.log(
      `résidence : evt.model.loaded ${p.model} device=${p.device} vram=${p.vram_mb ?? "?"}Mo` +
        `${p.degraded ? " (DÉGRADÉ → repli CPU)" : ""}`,
    );
  }

  private onModelUnloaded(env: Envelope): void {
    const p = env.payload ?? {};
    this.log(`résidence : evt.model.unloaded ${p.model}${p.reason ? ` (${p.reason})` : ""}`);
  }

  // Un logger injecté qui lève ne doit jamais casser la résidence (parité routeur/states).
  private log(l: string): void {
    try {
      this.onLog?.(l);
    } catch {
      /* un logger qui lève ne casse jamais la résidence */
    }
  }
}
