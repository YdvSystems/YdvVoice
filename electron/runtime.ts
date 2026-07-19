// electron/runtime.ts — le câblage runtime PARTAGÉ entre main.ts (prod) et le smoke (test).
//
// UNE seule source de vérité pour brancher : superviseur(s) (T3) + boot (T5) + gouverneur (T7) + arrêt propre (T6, dont la
// couture ⑩ `getGovernor`). Le smoke exerce ainsi le VRAI câblage, pas une COPIE de main.ts (croisé conv 37 tour 2 : le
// smoke ne doit pas prouver un doublon — sinon une régression de main.ts passerait au vert). L'appelant fournit `appRoot`
// (app.getAppPath() en prod ; repo root en test) et les hooks d'AFFICHAGE (systray en prod ; fichier outcome en test) ;
// TOUTE la logique d'état (superviseur↔dégradations, boot, gouverneur, arrêt) vit ici — main.ts n'est plus que la VUE.
//
// ARCHI 2 PROCESS (conv 48) : la voix retrouve sa PROPRE voie, comme le banc conv 34. DEUX superviseurs de la MÊME classe
// (`Supervisor` INCHANGÉE — zéro nouvelle logique de supervision, « que ça se gère ») lancent DEUX sidecars de rôle :
// OREILLES (`SIDECAR_ROLE=ears` : AEC+VAD+réveil+STT+fin de tour, V6 en veille) et BOUCHE (`=mouth` : Piper + sortie audio
// ISOLÉE — jamais affamée par les modèles d'écoute, cause de la voix « lente/monotone » du monolithe, mesurée diag_contention
// conv 47). Le routeur relie les deux canaux (`earsIpc`/`mouthIpc`) ; le gate anti-auto-écoute est CROSS-PROCESS (`cmd.listen.*`).
// L'audio réel n'est allumé (`SIDECAR_AUDIO=1`) que si `audioEnabled` (prod = main.ts) ; le smoke garde le défaut OFF → il
// prouve la STRUCTURE 2 process (boot + arrêt des deux sidecars de rôle), l'audio 2 process étant prouvé par le juge (à ta
// voix) + les E2E-V0→V7. Le chemin de la voix (cmd.tts / evt.wake) reste un WS direct au sidecar = zéro latence ajoutée par
// la supervision (le /health périodique du Supervisor est hors du chemin audio) : ⛔ règle perf conv 44 tenue.

import type { App } from "electron";
import * as path from "node:path";
import { boot as bootCore } from "../src/orchestrator/boot/index.js";
import type { BootOutcome, BootStateSnapshot, BootAlert } from "../src/orchestrator/boot/index.js";
import { Supervisor } from "../src/orchestrator/supervisor/index.js";
import { Governor, reconstructQueue } from "../src/orchestrator/governor/index.js";
import type { BackgroundTask } from "../src/orchestrator/governor/index.js";
import { ClaudeChannel, claudeInit as claudeBootInit } from "../src/orchestrator/claude/index.js";
import { WarmBrain } from "../src/orchestrator/resources/warm/index.js";
import { IpcClient } from "../src/orchestrator/ipc/index.js";
import { ConversationRouter } from "../src/orchestrator/voice/router.js";
import { installBeforeQuit } from "./before-quit.js";
import type { SophiaPaths } from "../src/orchestrator/paths.js";

// Registre des tâches de fond. VIDE au socle : les vraies (consolidation 02, proactif/rêverie 04) s'y brancheront comme
// CLIENTS de la mécanique du gouverneur (« pas de MVP, la mécanique est complète » — plan T7). À vide, le gouverneur est
// inoffensif (rien de dû → aucune sonde d'activité, aucun travail).
const TASKS: BackgroundTask[] = [];

/** Hooks d'AFFICHAGE fournis par l'appelant (l'UI observe, jamais une 2e vérité — plan/99 O5). */
export interface RuntimeDisplay {
  onState?: (s: BootStateSnapshot) => void;
  onAlert?: (a: BootAlert) => void;
  onFocusRequested?: () => void; // une 2e instance demande à voir Sophia
  onLog?: (l: string) => void;
}

/** Options du runtime. `audioEnabled` : allumer le pipeline audio réel (SIDECAR_AUDIO=1) sur les DEUX rôles. Prod (main.ts)
 *  = true (Sophia écoute + parle) ; smoke/tests = défaut false (structure 2 process SANS micro/GPU/Piper : rapide, portable ;
 *  l'audio réel est prouvé par le juge à ta voix + les E2E-V0→V7). Le rôle `SIDECAR_ROLE` est posé dans les deux cas. */
export interface RuntimeOptions {
  audioEnabled?: boolean;
}

export class SophiaRuntime {
  private session: BootOutcome | null = null;
  private governor: Governor | null = null;
  private channel: ClaudeChannel | null = null;
  private warm: WarmBrain | null = null;
  private earsIpc: IpcClient | null = null;         // V7 — connexion IPC runtime → sidecar OREILLES (evt.wake/stt/turn + cmd.listen)
  private mouthIpc: IpcClient | null = null;        // V7 — connexion IPC runtime → sidecar BOUCHE (cmd.tts + evt.tts.start/done)
  private router: ConversationRouter | null = null; // V7 (morceau C) — le fil oreilles↔voix (evt.* → cmd.tts + cerveau)
  readonly earsSupervisor: Supervisor;              // T3 — OREILLES (AEC+VAD+réveil+STT+fin de tour, V6 en veille)
  readonly mouthSupervisor: Supervisor;             // T3 — BOUCHE (Piper + sortie audio isolée)

  constructor(
    app: App,
    private readonly paths: SophiaPaths,
    appRoot: string,
    private readonly display: RuntimeDisplay = {},
    opts: RuntimeOptions = {},
  ) {
    const audioEnabled = opts.audioEnabled ?? false;
    // DEUX superviseurs de la MÊME classe (INCHANGÉE) : un par rôle, pidfiles DISTINCTS (sinon ils se battraient sur le même
    // fichier — chacun réécrasant la trace de l'autre). L'audio réel n'est allumé que si `audioEnabled` (le rôle est TOUJOURS
    // posé : inerte sans audio → le smoke prouve la structure, la prod ajoute l'audio).
    const makeSup = (role: "ears" | "mouth", pidfile: string): Supervisor => new Supervisor({
      python: path.join(appRoot, ".venv-sidecar", "Scripts", "python.exe"),
      script: "sidecar/server.py",
      cwd: appRoot,
      pidfile,
      // V8 : le rôle OREILLES allume V6 (speaker-ID, `SOPHIA_SPEAKER=1`) → le barge-in modulé (« qui parle par-dessus
      // sa voix ? »). Dormant depuis conv 47 (il alimentait V8/V14 non construits) ; requis maintenant. La BOUCHE n'en a
      // pas besoin. Le rôle est TOUJOURS posé ; l'audio réel (SIDECAR_AUDIO) + V6 ne s'allument qu'avec `audioEnabled` (prod).
      extraEnv: audioEnabled
        ? (role === "ears"
            ? { SIDECAR_ROLE: role, SIDECAR_AUDIO: "1", SOPHIA_SPEAKER: "1" }
            : { SIDECAR_ROLE: role, SIDECAR_AUDIO: "1" })
        : { SIDECAR_ROLE: role },
      onLog: display.onLog,
      // (Re)devenu READY : ne lever SANS_VOIX que si les DEUX rôles sont prêts (voir refreshVoiceReady). Au 1er boot,
      // onReady précède l'affectation de session → no-op (pas de trou). R2, croisé conv 35.
      onReady: () => this.refreshVoiceReady(),
      // Disjoncteur (l'un OU l'autre) ouvert APRÈS le boot : la voix tombe (elle n'entend plus OU ne parle plus). On le dit
      // à la SEULE source d'état (jamais un état local ici → jamais deux vérités, O5). Pendant le boot, c'est le retour
      // `false` de sidecarStart qui porte la dégradation.
      onDegraded: () => this.markVoiceLost(),
    });
    this.earsSupervisor = makeSup("ears", paths.sidecarPidfileEars);
    this.mouthSupervisor = makeSup("mouth", paths.sidecarPidfileMouth);

    // LE câblage d'arrêt (T6) — un seul endroit : `getGovernor`/`getChannel` (coutures ⑩/⑩bis) ne peuvent plus être
    // oubliés dans un point d'entrée (leçon conv 37 : le smoke exerce ce VRAI chemin, pas une copie). L'arrêt propre
    // fan-out sur les DEUX sidecars (before-quit.ts).
    installBeforeQuit(app, {
      getSession: () => this.session, getGovernor: () => this.governor, getChannel: () => this.channel,
      getWarm: () => this.warm,
      // ⑩ V7 : couper le routeur de conversation + ses DEUX connexions IPC (lues au quit ; n'existent qu'APRÈS le boot).
      stopVoice: () => { try { this.router?.stop(); } finally { this.earsIpc?.close(); this.mouthIpc?.close(); } },
      sidecars: [this.earsSupervisor, this.mouthSupervisor], paths,
    });
  }

  getSession(): BootOutcome | null { return this.session; }
  getGovernor(): Governor | null { return this.governor; }
  getChannel(): ClaudeChannel | null { return this.channel; }
  getWarm(): WarmBrain | null { return this.warm; }

  /** onReady d'un sidecar : lever un SANS_VOIX posé, SEULEMENT si les DEUX rôles sont READY (sinon la voix reste incomplète —
   *  elle n'entend pas OU ne parle pas → ne pas mentir en levant sur un seul). Via la SEULE source d'état → l'UI suit par
   *  onState. Au 1er boot, onReady précède l'affectation de session → no-op (pas de trou). R2, croisé conv 35. */
  private refreshVoiceReady(): void {
    if (this.session?.kind !== "PRIMARY") return;
    if (this.earsSupervisor.currentState === "READY" && this.mouthSupervisor.currentState === "READY") {
      this.session.runtime.clearDegradation("SANS_VOIX");
    }
  }

  /** onDegraded d'un sidecar (disjoncteur ouvert APRÈS le boot) : la voix tombe. On le dit à la SEULE source d'état (jamais
   *  un état local ici → jamais deux vérités, O5). L'alerte ne se re-dit pas si SANS_VOIX est déjà posé (l'autre rôle
   *  était déjà tombé) → pas de double notification. */
  private markVoiceLost(): void {
    if (this.session?.kind !== "PRIMARY") return;
    const already = this.session.runtime.current().degraded.includes("SANS_VOIX");
    this.session.runtime.markDegraded("SANS_VOIX");
    if (!already) this.session.runtime.alert({ code: "VOIX_PERDUE", message: "J'ai perdu mes oreilles et ma voix — je suis toujours là, mais tu vas devoir m'écrire." });
  }

  /** Lance le boot (Node pur) ; si PRIMARY, démarre la boucle d'arbitrage du gouverneur (après PRÊT). Retourne l'outcome. */
  async run(): Promise<BootOutcome> {
    const outcome = await bootCore({
      paths: this.paths,
      onState: this.display.onState,
      onAlert: this.display.onAlert,
      onLog: this.display.onLog,
      onFocusRequested: this.display.onFocusRequested,
      hooks: {
        // Phase 2 — tuer les DEUX sidecars orphelins d'un crash précédent AVANT de spawner (F1 ; chaque Supervisor re-nettoie
        // son propre pidfile au start ; garde jeton anti-recyclage par sidecar).
        reapSidecarOrphan: () => { this.earsSupervisor.orphanCleanup(); this.mouthSupervisor.orphanCleanup(); },
        // Phase 5 — les DEUX sidecars (T3), démarrés EN PARALLÈLE. Un échec ne fait pas tomber le boot : elle vit sans voix.
        // Les deux rôles sont nécessaires à la voix PLEINE (entendre ET parler) → READY seulement si les deux le sont
        // (sinon boot marque SANS_VOIX). Le dégradé partiel (ears-seul / mouth-seul) = frontière V9 (§7).
        sidecarStart: async () => {
          await Promise.all([this.earsSupervisor.start(), this.mouthSupervisor.start()]);
          return this.earsSupervisor.currentState === "READY" && this.mouthSupervisor.currentState === "READY";
        },
        // Phase 4 — le gouverneur PROGRAMME les tâches dues, n'en LANCE aucune pendant le boot (§4.1 Phase 4). La boucle
        // d'arbitrage démarre après PRÊT (ci-dessous). T7.
        governorInit: (db) => reconstructQueue(db, TASKS, () => Date.now()),
        // Phase 4 — T8 : sonde le fil durable (lecture PURE, aucun spawn) et le DIT ; le canal lui-même est construit après PRÊT.
        claudeInit: (db) => {
          const r = claudeBootInit(db);
          this.display.onLog?.(
            r.resumable ? "canal Claude : fil durable reprenable"
            : r.hasThread ? "canal Claude : fil taché/absent -> conversation fraîche au prochain tour"
            : "canal Claude : aucun fil (première conversation à venir)",
          );
        },
        // Phases 1-3 (02/03) + Phase 5 enroll/prewarm/tts.cache (01/05) : définis plus tard.
      },
    });
    if (outcome.kind === "PRIMARY") {
      this.session = outcome;
      // T7 — la boucle d'arbitrage démarre APRÈS PRÊT (Phase 6). Le gouverneur partage la connexion d'écriture UNIQUE
      // (outcome.db.raw — pas une 2e ouverture). Au socle, TASKS est vide → à vide. SANS_ECRITURE (base douteuse, aussi
      // atteignable au runtime via l'ancre 03) relu dynamiquement → aucune écriture (A15). Quiescé à l'arrêt (⑩).
      this.governor = new Governor({
        db: outcome.db.raw, paths: this.paths, tasks: TASKS,
        writesSuspended: () => outcome.runtime.current().degraded.includes("SANS_ECRITURE"),
        onLog: this.display.onLog,
      });
      this.governor.start();
      // T8 — le canal Claude, construit APRÈS PRÊT (comme le gouverneur). Request-scoped : aucun spawn ici ; le 1ᵉʳ
      // tour spawnera `claude -p (--resume|--session-id)`. Partage la connexion d'écriture UNIQUE (outcome.db.raw ;
      // `claude_session_id` = drapeau technique, écrit normalement même en SANS_ECRITURE — T6). onThrottle → le
      // gouverneur bride la « part de Sophia » sur un vrai signal 429 (la classification fine SECOURS = détecteur 05).
      this.channel = new ClaudeChannel({
        db: outcome.db.raw,
        paths: this.paths,
        onLog: this.display.onLog,
        onThrottle: (info) => { if (info.status && info.status !== "allowed") this.governor?.notifyThrottle(); },
      });
      // V7 — le CERVEAU CHAUD de dialogue (WarmBrain, plan/05 R4). Construction SANS SPAWN (le process persistant s'allume
      // paresseusement au 1ᵉʳ tour ; le prewarm gouverné « au boot / au retour » = R4-ultérieur / morceau C — pas de
      // dépense de quota au boot ici). Le canal T8 (ci-dessus) reste pour l'ACTION outillée (« un seul guichet ») ; le
      // WarmBrain sert le DIALOGUE (chat nu, streaming). Quiescé à l'arrêt (⑩, via getWarm dans installBeforeQuit).
      // Persona = placeholder ANCRE DE NOM + canal (« Tu es Sophia », décision Yohann conv 47 / finding b5) = le DÉFAUT
      // `VOICE_SYSPROMPT` du WarmBrain (aucun `sysprompt` n'est passé ici → c'est bien le défaut qui s'applique). Le vrai
      // persona I→VI (valeurs/souvenirs/tempérament) = `03` : il REMPLACERA ce placeholder via l'option `sysprompt` quand
      // il sera composé — pas encore de mécanisme d'injection par tour ici (le routeur ne fait qu'appeler `ask` ; le persona
      // est fixé au spawn du process chaud). Frontière `03`.
      const warm = new WarmBrain({
        paths: this.paths,
        onLog: this.display.onLog,
        onThrottle: () => this.governor?.notifyThrottle(),
      });
      this.warm = warm;
      // V7 (morceau C) — le FIL oreilles↔voix, DEUX CANAUX (archi 2 process). Deux IpcClients : un vers les OREILLES
      // (evt.wake/stt/turn + cmd.listen), un vers la BOUCHE (cmd.tts + evt.tts.start/done). Le routeur réagit aux evt.*
      // des oreilles et pilote la bouche + le gate cross-process (cmd.listen sur les oreilles quand la bouche parle).
      // SEULEMENT si les DEUX sidecars sont PRÊTS (sinon SANS_VOIX : elle vit sans boucle de dialogue). Non-fatal : un
      // échec de connexion (course boot) est loggé, le reste du runtime vit ; une connexion à moitié ouverte est fermée
      // (pas de fuite de socket). La RECONNEXION sur respawn d'un sidecar = frontière V9 (§7 ; le juge à ta voix tourne
      // sur des sidecars stables).
      if (this.earsSupervisor.currentState === "READY" && this.mouthSupervisor.currentState === "READY") {
        try {
          const earsIpc = new IpcClient();
          await earsIpc.connect(this.earsSupervisor.port);
          this.earsIpc = earsIpc; // assigné DÈS la connexion réussie → si `mouthIpc.connect` rejette ensuite, le `catch`
          //                         ferme bien ce socket OUVERT (sinon fuite half-open + souscription fantôme côté sidecar
          //                         ears — MINEUR croisé conv 48 ; le juge suit déjà ce patron).
          const mouthIpc = new IpcClient();
          await mouthIpc.connect(this.mouthSupervisor.port);
          this.mouthIpc = mouthIpc;
          this.router = new ConversationRouter({ earsIpc, mouthIpc, brain: warm, onLog: this.display.onLog });
          this.router.start();
          this.display.onLog?.("routeur de conversation branché (le fil oreilles↔voix, 2 process — V7)");
        } catch (e) {
          // earsIpc peut être ouvert+assigné alors que mouthIpc a échoué → on ferme ce qui est ouvert (pas de fuite).
          try { this.earsIpc?.close(); } catch { /* */ }
          try { this.mouthIpc?.close(); } catch { /* */ }
          this.earsIpc = null; this.mouthIpc = null; this.router = null;
          this.display.onLog?.(`routeur de conversation NON branché (${(e as Error).message}) — vivante sans boucle de dialogue`);
        }
      }
    }
    return outcome;
  }
}
