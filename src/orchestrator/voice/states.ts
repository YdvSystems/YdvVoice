// La MACHINE DES ÉTATS D'ÉCOUTE (V9) — « qui écoute quoi, décidé par l'orchestrateur » (B1, technique/01 §4.1).
//
// En V7/V8, l'état d'écoute était décidé DANS le sidecar : le portier STT s'arme sur le nom (on_wake) et se
// désarme sur la clôture (release). Le doc grave l'inverse (B1 : « l'état d'écoute est décidé par l'orchestrateur,
// exécuté par le sidecar ; la seule auto-transition d'ARMEMENT autoritaire du sidecar est le tour de réveil » — le
// portier garde un release LOCAL sur clôture pour choisir son plafond réveil/conversation, idempotent avec
// cmd.listen.stop, conception V7 actée « zéro changement sidecar pour la clôture », voir portier.ts). V9 rend ça explicite :
// une petite machine, POSSÉDÉE par l'orchestrateur, que le routeur pilote (réveil → ÉCOUTE ; clôture → VEILLE ;
// pause → PAUSE) et qui NOTIFIE ses transitions (le routeur y branche `cmd.listen.start`/`stop` + le WarmBrain).
//
// Les cinq états (F5, technique/01 §4.1) :
//   · VEILLE       — elle dort ; seul « Sophia » (porté par une phrase) la réveille (le sidecar écoute pour ça).
//   · ÉCOUTE       — en conversation ; tout transcript compte, le nom n'est plus requis.
//   · PAUSE        — suspendue mais le fil reste CHAUD (le WarmBrain vit ; « reviens Sophia » reprend). Côté
//                    sidecar == VEILLE (« PAUSE comme VEILLE », doc §4.1 : seul le nom rappelle) ; la différence
//                    est ICI (l'orchestrateur ne rafraîchit pas le fil). NB colonne V9 : le WarmBrain garde TOUJOURS
//                    son contexte tant qu'il vit → VEILLE et PAUSE sont, côté cerveau, identiques pour l'instant ;
//                    la vraie distinction « fil frais (VEILLE) vs fil gardé (PAUSE) » attend plan/02 (re-feed durable).
//   · DICTÉE       — CROCHET (V10) : injection au curseur de l'app au focus, grille en liste blanche (S9).
//   · APPROBATION  — CROCHET (V10) : sous-état d'ÉCOUTE, fenêtre « oui/non/vas-y/ok/go/fonce » (S8).
// DICTÉE et APPROBATION sont présents dans le TYPE (les voyants/transcript à venir les afficheront) mais leurs
// TRANSITIONS vivent en V10 (leur déclencheur est parlé — la grille des 20 intentions). Ici : la colonne
// VEILLE/ÉCOUTE/PAUSE seulement.
//
// Machine PURE (aucune dépendance IPC/cerveau) → testable seule (tests/u-states.mjs). Le mapping état → commande
// sidecar (`cmd.listen.start`/`stop`) et la garde du WarmBrain vivent dans le ROUTEUR (qui consomme `onEnter`).
// Le sidecar, lui, porte le FILET de sûreté (deadline de garde R-1, wake.py) : même si l'orchestrateur oublie une
// transition, un `_armed` resté vrai s'auto-relâche → Sophia n'est jamais coincée sourde (contrat gravé conv 42).

export type ListenMode = "veille" | "ecoute" | "pause" | "dictee" | "approbation";

export interface ListenStateOptions {
  /** Notifié à CHAQUE changement d'état (jamais sur un no-op). Le routeur y branche `cmd.listen.start`/`stop`
   *  + la garde du WarmBrain. Un callback qui lève ne casse jamais la machine (défense, parité routeur). */
  onEnter?: (mode: ListenMode, prev: ListenMode) => void;
  onLog?: (l: string) => void;
}

/** La machine des états d'écoute (V9). Possédée par l'orchestrateur (B1). Démarre en VEILLE. */
export class ListenState {
  private mode: ListenMode = "veille";
  private readonly onEnterCb?: (mode: ListenMode, prev: ListenMode) => void;
  private readonly onLog?: (l: string) => void;

  constructor(opts: ListenStateOptions = {}) {
    this.onEnterCb = opts.onEnter;
    this.onLog = opts.onLog;
  }

  /** L'état courant — LECTURE SEULE (vue dérivée : les voyants systray + le futur transcript le reflètent, O5). */
  get current(): ListenMode {
    return this.mode;
  }

  // ── transitions de la colonne (VEILLE ↔ ÉCOUTE ↔ PAUSE) ──────────────────────────────────────────────
  /** Réveil confirmé (le sidecar s'est auto-armé au tour de réveil, B1 ; l'orchestrateur CONFIRME l'écoute)
   *  OU reprise depuis PAUSE. VEILLE|PAUSE → ÉCOUTE. No-op si déjà en ÉCOUTE. */
  wake(): void {
    this.to("ecoute");
  }

  /** Clôture (« merci Sophia, à plus tard » / « bonne nuit Sophia ») — depuis n'importe quel état → VEILLE.
   *  C'est ici que se coupe l'écoute des tours à la source (le routeur envoie `cmd.listen.stop`). */
  close(): void {
    this.to("veille");
  }

  /** Suspension (« merci Sophia » — déclencheur parlé en V10) : ÉCOUTE → PAUSE. Le fil reste chaud. No-op
   *  hors ÉCOUTE (on ne met pas en pause une veille). */
  pause(): void {
    if (this.mode !== "ecoute") {
      this.onLog?.(`états : pause ignorée (état ${this.mode}, pas ÉCOUTE)`);
      return;
    }
    this.to("pause");
  }

  /** Reprise (« reviens Sophia » — déclencheur parlé en V10) : PAUSE → ÉCOUTE (rétroactif côté sidecar). No-op
   *  hors PAUSE. */
  resume(): void {
    if (this.mode !== "pause") {
      this.onLog?.(`états : reprise ignorée (état ${this.mode}, pas PAUSE)`);
      return;
    }
    this.to("ecoute");
  }

  private to(mode: ListenMode): void {
    if (mode === this.mode) return; // no-op : pas de re-notification (idempotent)
    const prev = this.mode;
    this.mode = mode;
    try {
      this.onEnterCb?.(mode, prev);
    } catch (e) {
      // un consommateur qui lève (envoi cmd.listen raté...) ne fige jamais la machine (parité routeur).
      this.onLog?.(`états : onEnter a levé (${(e as Error)?.message ?? String(e)})`);
    }
  }
}
