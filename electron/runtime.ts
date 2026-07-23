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
import * as fs from "node:fs";
import { boot as bootCore } from "../src/orchestrator/boot/index.js";
import type { BootOutcome, BootStateSnapshot, BootAlert } from "../src/orchestrator/boot/index.js";
import { Supervisor } from "../src/orchestrator/supervisor/index.js";
import type { SupervisorOptions } from "../src/orchestrator/supervisor/index.js";
import { sweepPhantomSidecars } from "../src/orchestrator/supervisor/phantoms.js";
import { Governor, reconstructQueue } from "../src/orchestrator/governor/index.js";
import type { BackgroundTask } from "../src/orchestrator/governor/index.js";
import { ClaudeChannel, claudeInit as claudeBootInit } from "../src/orchestrator/claude/index.js";
import { WarmBrain } from "../src/orchestrator/resources/warm/index.js";
import { IpcClient } from "../src/orchestrator/ipc/index.js";
import { ConversationRouter } from "../src/orchestrator/voice/router.js";
import type { RouterHandoff } from "../src/orchestrator/voice/router.js";
import { ModelResidence } from "../src/orchestrator/voice/residence.js";
import { DuckingPolicy } from "../src/orchestrator/voice/ducking.js";
import { WindowsMixer } from "../src/orchestrator/voice/duck-mixer.js";
import { FALLBACK_PHRASES } from "../src/orchestrator/voice/fallback-phrases.js";
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
  /** COUTURE de test (conv 56) : fabrique des superviseurs. Défaut = `new Supervisor(opts)`. Le test du fix
   *  « boot sans voix » (e2e-boot-respawn) l'utilise pour rendre le 1er spawn de l'oreille DÉFAILLANT (script
   *  flaky) et PROUVER que le pipeline de voix se construit au respawn (refreshVoiceReady → ensureVoicePipeline). */
  supervisorFactory?: (role: "ears" | "mouth", opts: SupervisorOptions) => Supervisor;
}

export class SophiaRuntime {
  private session: BootOutcome | null = null;
  private governor: Governor | null = null;
  private channel: ClaudeChannel | null = null;
  private warm: WarmBrain | null = null;
  private earsIpc: IpcClient | null = null;         // V7 — connexion IPC runtime → sidecar OREILLES (evt.wake/stt/turn + cmd.listen)
  private mouthIpc: IpcClient | null = null;        // V7 — connexion IPC runtime → sidecar BOUCHE (cmd.tts + evt.tts.start/done)
  private router: ConversationRouter | null = null; // V7 (morceau C) — le fil oreilles↔voix (evt.* → cmd.tts + cerveau)
  private residence: ModelResidence | null = null;  // V11 — la résidence des modèles (états V9 ⊕ calques → cmd.model.policy)
  private ducking: DuckingPolicy | null = null;     // V12 — le ducking (les médias baissent le temps de la conversation)
  private duckMixer: WindowsMixer | null = null;    // V12 — le levier (sessions WASAPI par app, helper persistant)
  private buildingPipeline = false;                 // conv 55 — garde d'idempotence : un seul build du pipeline à la fois (le build est async, refreshVoiceReady sync)
  private stopping = false;                          // conv 55 — arrêt en cours : ne pas (re)construire le pipeline après un stopVoice
  private pipelineRetryTimer: ReturnType<typeof setTimeout> | null = null; // M-4 (croisé conv 56) — retry d'un build raté SANS respawn (sinon plus jamais d'onReady → « faux vert » à vie)
  private earsPortWired = 0;                        // V15 — le port des OREILLES au moment du câblage du pipeline (≠ port courant = un respawn est passé)
  private mouthPortWired = 0;                       // V15 — idem BOUCHE (chaque spawn tire un port neuf → le port est un témoin du respawn)
  private earsPidWired = 0;                         // V15 (solo S1) — le PID est le témoin SÛR : un port éphémère PEUT être réattribué à
  private mouthPidWired = 0;                        //   l'identique (rarissime mais réel) ; un PID de process neuf, jamais. On compare port OU pid.
  private pendingHandoff: RouterHandoff | null = null; // V15 — l'état de conversation capturé au teardown, ré-exécuté par le rebuild (consommé au build réussi)
  private readonly audioEnabled: boolean;           // conv 56 — retenu pour gater le balayage fantômes (prod seulement)
  private readonly repoToken: string;               // conv 56 — jeton d'identité du repo (basename appRoot) pour le balayage
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
    this.audioEnabled = audioEnabled;
    this.repoToken = path.basename(appRoot); // jeton du balayage fantômes — même dérivation que le juge (survit à un renommage)
    const makeSupervisor = opts.supervisorFactory ?? ((_role: "ears" | "mouth", o: SupervisorOptions) => new Supervisor(o));
    // DEUX superviseurs de la MÊME classe (INCHANGÉE) : un par rôle, pidfiles DISTINCTS (sinon ils se battraient sur le même
    // fichier — chacun réécrasant la trace de l'autre). L'audio réel n'est allumé que si `audioEnabled` (le rôle est TOUJOURS
    // posé : inerte sans audio → le smoke prouve la structure, la prod ajoute l'audio).
    const makeSup = (role: "ears" | "mouth", pidfile: string): Supervisor => makeSupervisor(role, {
      python: path.join(appRoot, ".venv-sidecar", "Scripts", "python.exe"),
      script: "sidecar/server.py",
      cwd: appRoot,
      pidfile,
      // conv 55 : timeout de readiness ALIGNÉ sur le juge (60 s, PAS le défaut 8 s). L'oreille charge lourd (large-v3 +
      // ECAPA + Smart-Turn + AEC/VAD, synchrone avant que /health réponde) et les 2 sidecars bootent EN PARALLÈLE (double
      // charge CUDA) → 8 s est trop court → l'oreille est tuée+respawnée (`echec spawn-echoue`). Le juge met 60 s pour
      // EXACTEMENT ça (scripts/juge.mjs) ; l'app l'avait oublié → boot « sans voix ». 60 s = le boot finit largement avant.
      readinessTimeoutMs: 60000,
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
      // ⑩ V7/V11 : couper la résidence + le routeur de conversation + ses DEUX connexions IPC (lues au quit ; n'existent
      // qu'APRÈS le boot). La résidence n'a ni thread ni timer (elle cesse juste d'émettre) ; ses abonnements meurent
      // avec le socket fermé ci-après.
      stopVoice: () => {
        this.stopping = true;
        if (this.pipelineRetryTimer) { clearTimeout(this.pipelineRetryTimer); this.pipelineRetryTimer = null; } // M-4 : aucun re-build après l'arrêt
        // V12 : le ducking restaure les médias AVANT de mourir (jamais un Spotify laissé baissé). La chaîne du mixer
        // finit pendant la suite de l'arrêt T6 (fire-and-forget) ; le pire cas (exit avant la fin du restore) est
        // couvert par le WRITE-AHEAD → filet boot au prochain démarrage.
        try { this.residence?.stop(); this.router?.stop(); this.ducking?.stop(); } finally {
          this.earsIpc?.close(); this.mouthIpc?.close();
          const dm = this.duckMixer; this.duckMixer = null; this.ducking = null;
          if (dm) void dm.stop();
        }
      },
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
      // V15 (conv 60) — RECONNEXION MID-SESSION (la frontière V9/55-56 refermée) : un pipeline branché sur un
      // PORT PÉRIMÉ = un sidecar a RESPAWNÉ pendant la session (chaque spawn tire un port neuf — sondé conv 60 :
      // le routeur pointait le mort à vie, 0 client WS sur le frais, politique jamais re-descendue, voyant vert).
      // → teardown ciblé (énonciations en vol closes = échec terminal §4.8) + rebuild + resync S10 + état
      // d'écoute RÉ-EXÉCUTÉ (écart C-c acté conv 60).
      if (this.router && this.pipelineIsStale()) {
        this.teardownStalePipeline();
      }
      // conv 55 (fix « boot sans voix ») : construire le pipeline de voix S'IL ne l'est pas — il ne s'est PAS construit au
      // boot si un sidecar était encore en RESTARTING à cet instant (un `spawn-echoue` puis respawn). Avant, seul le voyant
      // était éteint ici (faux vert : router=null à vie → silence). `ensureVoicePipeline` est idempotent (ne fait rien si
      // déjà construit).
      void this.ensureVoicePipeline();
    }
  }

  /** V15 (solo S1) — le pipeline câblé pointe-t-il un sidecar PÉRIMÉ ? Témoins : le PORT (chaque spawn en
   *  tire un neuf) OU le PID (le témoin SÛR — un port éphémère peut être réattribué à l'identique, un PID de
   *  process neuf jamais). Comparés aux valeurs mémorisées au câblage. */
  private pipelineIsStale(): boolean {
    return this.earsPortWired !== this.earsSupervisor.port || this.mouthPortWired !== this.mouthSupervisor.port
      || this.earsPidWired !== this.earsSupervisor.pid || this.mouthPidWired !== this.mouthSupervisor.pid;
  }

  /** V15 — teardown CIBLÉ d'un pipeline sur port périmé (un sidecar a respawné mid-session). Capture d'abord
   *  l'état de conversation (handoff — l'orchestrateur le POSSÈDE, B1) puis démonte : `router.stop()` CLÔT les
   *  énonciations en vol (leurs `evt.tts.done` n'arriveront jamais — échec terminal §4.8, JAMAIS re-énoncées ;
   *  la purge `cmd.tts.stop` part best-effort vers une bouche peut-être vivante) ; les sockets périmés sont
   *  fermés (close PROPRE → un sidecar survivant lit un départ volontaire, jamais une panne V13) ; le ducking
   *  restaure les médias (la fenêtre morte est SANS conversation — les volumes remontent, honnête ; le rebuild
   *  re-duck si l'ÉCOUTE est ré-exécutée). Le WarmBrain n'est PAS touché (le contexte du cerveau survit). */
  private teardownStalePipeline(): void {
    if (this.stopping) return;
    const log = (l: string): void => { try { this.display.onLog?.(l); } catch { /* jamais fatal */ } };
    const h = this.router?.exportHandoff() ?? null;
    this.pendingHandoff = h;
    log(`respawn d'un sidecar détecté (port périmé) → re-branchement du fil + resync S10`
      + (h && h.listen !== "veille" ? ` — état « ${h.listen} » à ré-exécuter` : ""));
    try { this.residence?.stop(); this.router?.stop(); this.ducking?.stop(); } finally {
      try { this.earsIpc?.close(); } catch { /* */ }
      try { this.mouthIpc?.close(); } catch { /* */ }
      const dm = this.duckMixer; this.duckMixer = null; this.ducking = null;
      if (dm) void dm.stop();
      this.earsIpc = null; this.mouthIpc = null; this.router = null; this.residence = null;
    }
  }

  /** conv 55 — Construit le pipeline de voix (2 canaux IPC + résidence V11 + routeur V7 + start) DÈS que les 2 sidecars sont
   *  READY, que ce soit AU BOOT, après un RESPAWN (via refreshVoiceReady), ou au REBUILD mid-session (V15 : le
   *  teardown d'un pipeline sur port périmé a remis `router=null` → ce chemin UNIQUE reconstruit + ré-exécute
   *  l'état transféré [pendingHandoff] + resynchronise S10 — la frontière V9/55-56 « routeur sur socket mort »
   *  est REFERMÉE, conv 60). IDEMPOTENT (une seule construction) et sûr à l'arrêt. Corrige le one-shot d'origine
   *  qui laissait `router=null` à vie si un sidecar avait hoqueté au démarrage.
   *  NON-FATAL : un échec de connexion (course) est loggé, le reste du runtime vit ; ré-essayé au prochain onReady. */
  private async ensureVoicePipeline(): Promise<void> {
    if (this.session?.kind !== "PRIMARY" || this.stopping) return;
    if (this.router || this.buildingPipeline) return;                   // déjà branché / build déjà en vol
    if (this.earsSupervisor.currentState !== "READY" || this.mouthSupervisor.currentState !== "READY") return;
    const warm = this.warm;
    if (!warm) return;                                                  // WarmBrain construit dans run() avant tout appel ; garde défensive
    // M-5 (croisé conv 56) : logger GARDÉ dans cette méthode — un onLog qui lève ne doit ni démonter un pipeline qui
    // vient de marcher (le throw post-start tomberait dans le catch → sockets fermés) ni produire une rejection non
    // gérée (refreshVoiceReady appelle en `void`). Même patron que phantoms.ts / router.ts (N2 conv 47).
    const log = (l: string): void => { try { this.display.onLog?.(l); } catch { /* un logger qui lève ne casse jamais la voix */ } };
    if (this.pipelineRetryTimer) { clearTimeout(this.pipelineRetryTimer); this.pipelineRetryTimer = null; } // un build part → le retry en attente est obsolète
    this.buildingPipeline = true;
    try {
      // V15 (croisé conv 60, ROB-M1 — REPRODUIT 10/10) : les témoins port+pid sont CAPTURÉS AVANT chaque
      // await et les connects composent CES valeurs — jamais une relecture du superviseur APRÈS coup. La
      // 1ʳᵉ version relisait le superviseur après les connects : un respawn abouti PENDANT `await connect`
      // (son onReady skippé par `buildingPipeline`) posait les témoins NEUFS sur un socket branché à
      // l'ANCIEN port → `pipelineIsStale()` aveugle À VIE (surdité, voyant vert — la classe de bug que V15
      // referme). Avec les valeurs COMPOSÉES, le re-check de fin de build compare « composé » vs
      // « courant » → il VIT (et couvre exactement ce scénario).
      const earsPort = this.earsSupervisor.port, earsPid = this.earsSupervisor.pid;
      const earsIpc = new IpcClient();
      await earsIpc.connect(earsPort);
      // Ré-évaluer APRÈS l'await : un arrêt a pu démarrer entre-temps → ne pas laisser un socket ouvert ni brancher un routeur.
      if (this.stopping || this.session?.kind !== "PRIMARY") { try { earsIpc.close(); } catch { /* */ } return; }
      this.earsIpc = earsIpc; // assigné DÈS la connexion → si `mouthIpc.connect` rejette, le `catch` ferme ce socket (pas de fuite half-open).
      const mouthPort = this.mouthSupervisor.port, mouthPid = this.mouthSupervisor.pid;
      const mouthIpc = new IpcClient();
      await mouthIpc.connect(mouthPort);
      if (this.stopping || this.session?.kind !== "PRIMARY") { try { earsIpc.close(); } catch { /* */ } try { mouthIpc.close(); } catch { /* */ } this.earsIpc = null; return; }
      this.mouthIpc = mouthIpc;
      // Les témoins mémorisés = les valeurs RÉELLEMENT COMPOSÉES (ROB-M1 ci-dessus ; pid = témoin sûr, solo S1).
      this.earsPortWired = earsPort;
      this.mouthPortWired = mouthPort;
      this.earsPidWired = earsPid;
      this.mouthPidWired = mouthPid;
      // V11 — la RÉSIDENCE des modèles (aux OREILLES). Créée AVANT le routeur (qui la notifie) ; `start()` APRÈS `router.start()`.
      const residence = new ModelResidence({ ears: earsIpc, governor: this.governor, onLog: this.display.onLog });
      this.residence = residence;
      this.router = new ConversationRouter({
        earsIpc, mouthIpc, brain: warm, onLog: this.display.onLog,
        // V11 + V12 : FAN-OUT des transitions d'état V9 — la résidence en dérive le groupe voix, le ducking en
        // dérive « conversation ouverte = médias bas » (décision A). `this.ducking` lu à l'appel (créé plus bas).
        onVoiceState: (m) => { residence.onVoiceState(m); this.ducking?.onVoiceState(m); },
        // ARCHIVE (conv 53) : chaque tour (les 2 voix) → conversations.jsonl dans le home. Au bord, passif, jamais fatal.
        onExchange: (e) => { try { fs.appendFileSync(path.join(this.paths.home, "conversations.jsonl"), JSON.stringify(e) + "\n"); } catch { /* jamais fatal */ } },
      });
      this.router.start();
      // V12 — le DUCKING, gaté `audioEnabled` (jamais smoke/tests : on ne touche pas aux volumes de la machine
      // d'un harnais de test — patron du balayage fantômes). ADDITIF : abonnements evt.* À CÔTÉ du routeur
      // (IpcClient.on = multi-abonnés) + fan-out onVoiceState ci-dessus — le routeur n'est PAS touché.
      // V15 : créé AVANT la ré-exécution d'état (resumeAfterRespawn) — le fan-out onVoiceState doit VOIR la
      // transition ÉCOUTE du rebuild (sinon les médias resteraient pleins sur la conversation reprise).
      if (this.audioEnabled) {
        const duckMixer = new WindowsMixer({
          home: this.paths.home,
          // les DEUX sidecars de Sophia : JAMAIS baissés — la BOUCHE (sa voix) ET les OREILLES (leur loopback
          // WASAPI tient une session de rendu ACTIVE — mesuré conv 57). PIDs relus à CHAQUE opération (ils
          // changent au respawn) ; le helper étend chaque PID à son ARBRE (le python.exe du venv est un
          // LAUNCHER — la session audio appartient à son ENFANT, mesuré au juge conv 57). Le mixer exclut
          // aussi process.pid (nous) de lui-même.
          // m5 (croisé conv 57) : `pid` n'est mis à jour qu'à READY → pendant un respawn, exclure AUSSI
          // `lastSpawnedPid` (le sidecar frais, dont la session audio s'ouvre au warmup AVANT READY).
          excludePids: () => [
            this.earsSupervisor.pid, this.earsSupervisor.lastSpawnedPid,
            this.mouthSupervisor.pid, this.mouthSupervisor.lastSpawnedPid,
          ],
          onLog: this.display.onLog,
        });
        const ducking = new DuckingPolicy({ mixer: duckMixer, onLog: this.display.onLog });
        duckMixer.start(); // écrit le helper + FILET BOOT (un duck-restore.json d'un crash → restauré d'abord)
        earsIpc.on("evt.wake", () => ducking.onWake());
        earsIpc.on("evt.vad.start", () => ducking.onVadStart()); // no-op PROUVÉ (U-V12) — le contrat est câblé
        mouthIpc.on("evt.tts.start", () => ducking.onTtsStart());
        mouthIpc.on("evt.tts.done", () => ducking.onTtsDone());
        this.duckMixer = duckMixer;
        this.ducking = ducking;
      }
      // V15 — le REBUILD ré-exécute l'état d'écoute d'avant le crash (écart C-c acté conv 60, B1 : l'état
      // appartient à l'orchestrateur). AVANT residence.start() : la transition ÉCOUTE fait émettre à la
      // résidence NEUVE la politique COURANTE (`conversation`) — l'étape 1 de S10, la PREMIÈRE émission du
      // pipeline neuf (start() ne double pas ensuite, dé-doublonnage).
      const handoff = this.pendingHandoff;
      if (handoff) this.router.resumeAfterRespawn(handoff);
      residence.start();   // V11 : abonnement evt.model.* + politique courante si rien n'est encore parti (S10 étape 1)
      this.pendingHandoff = null; // consommé — un échec AVANT ce point le garde pour le retry M-4 (rebuild ré-essayé avec l'état)
      // V13/V15 — le resync des OREILLES, ordre S10 STRICT (étapes 2-3) : cmd.enroll.push (jalon d'ordre
      // honnête, écart A-b conv 60) PUIS cmd.tts.cache (idempotent côté sidecar — le boot nominal l'a déjà
      // fait en phase 5 ; couvre le boot-sans-voix ET le rebuild mid-session, où le sidecar frais n'a RIEN).
      void this.sendEarsResync(handoff ? "rebuild" : "pipeline");
      // V15 — la phrase de RETOUR (écart C-c) : la conversation était OUVERTE au crash → elle dit le raté et
      // rend la main (texte = domaine Yohann, phrases.recovery). Jamais en PAUSE (se taire est le respect de
      // la pause) ni en VEILLE (resync silencieux). Gatée audioEnabled (une notification VOCALE n'a pas de
      // sens dans un harnais sans bouche — patron ducking/cache).
      if (handoff && (handoff.listen === "ecoute" || handoff.listen === "approbation") && this.audioEnabled) {
        this.router.announceRecovery();
      }
      log("routeur de conversation + résidence des modèles branchés (le fil oreilles↔voix, 2 process — V7/V11)"
        + (this.audioEnabled ? " + ducking V12" : "") + (handoff ? " [rebuild post-respawn V15]" : ""));
      // V15 (solo S2, rendu VIVANT par ROB-M1) : un sidecar a pu crasher+respawner PENDANT ce build
      // (fenêtre réelle : le connect a réussi sur le port d'AVANT le crash, et l'onReady du respawn est
      // déjà passé — skippé car `buildingPipeline` → PLUS AUCUN déclencheur ne reviendrait) → re-vérifier
      // la FRAÎCHEUR en fin de build : les témoins étant les valeurs COMPOSÉES (capturées avant les
      // awaits), « composé ≠ courant » détecte ce respawn — la 1ʳᵉ version (témoins relus après les
      // connects) rendait ce re-check MORT (croisé conv 60, reproduit). Périmé → teardown (l'état
      // re-capturé repart en handoff) + retry court — jamais un pipeline câblé au mort, voyant vert.
      if (!this.stopping && this.pipelineIsStale()) {
        log("un sidecar a respawné PENDANT le câblage → re-branchement immédiat");
        this.teardownStalePipeline();
        this.pipelineRetryTimer = setTimeout(() => { this.pipelineRetryTimer = null; void this.ensureVoicePipeline(); }, 100);
      }
    } catch (e) {
      // ROB2-NIT-1 (re-croisé conv 60) : un routeur construit puis abandonné par ce catch est QUIESCÉ (timers,
      // énonciations settled) AVANT la fermeture des sockets — inerte aujourd'hui (la section post-connects est
      // SYNCHRONE : aucun événement traité, aucun timer posé), défense pour demain (un getter injecté qui lève).
      try { this.router?.stop(); } catch { /* jamais fatal */ }
      // earsIpc peut être ouvert+assigné alors que mouthIpc a échoué → on ferme ce qui est ouvert (pas de fuite).
      try { this.earsIpc?.close(); } catch { /* */ }
      try { this.mouthIpc?.close(); } catch { /* */ }
      // V12 : symétrie de rollback (rien ne throw après la création du ducking aujourd'hui — défense pour demain).
      try { this.ducking?.stop(); } catch { /* */ }
      { const dm = this.duckMixer; this.duckMixer = null; this.ducking = null; if (dm) void dm.stop(); }
      this.earsIpc = null; this.mouthIpc = null; this.router = null; this.residence = null;
      log(`routeur de conversation NON branché (${(e as Error).message}) — vivante sans boucle de dialogue (nouvel essai dans 5 s)`);
      // M-4 (croisé conv 56) : si les DEUX sidecars restent READY (échec de connexion transitoire — rejet WS, port
      // éphémère), AUCUN onReady ne reviendra jamais → sans ceci, `router=null` à vie avec le voyant au vert = la
      // classe de bug que le fix conv 55 devait tuer, sous une autre porte. Retry borné (5 s), idempotent (les gardes
      // en tête re-filtrent), annulé à l'arrêt (stopVoice) et dès qu'un build repart. Un respawn (onReady) reste le
      // déclencheur nominal ; ce timer ne couvre que « échec avec sidecars sains ».
      if (!this.stopping) {
        this.pipelineRetryTimer = setTimeout(() => { this.pipelineRetryTimer = null; void this.ensureVoicePipeline(); }, 5000);
      }
    } finally {
      this.buildingPipeline = false;
    }
  }

  /** V13/V15 — le RESYNC des OREILLES, ordre S10 STRICT (technique/01 §4.8, étapes 2-3) :
   *    2. `cmd.enroll.push` — JALON D'ORDRE HONNÊTE (écart A-b acté conv 60) : rien n'est poussé (l'ancre est
   *       VENDORISÉE au sidecar, le centroïde se construit au runtime dans la même instance ECAPA — cohérence
   *       V6 ; l'enrôlement réel = doc 04) ; le sidecar répond l'ÉTAT RÉEL de son ancre, l'ack est LU et DIT.
   *    3. `cmd.tts.cache` — les phrases de secours (idempotent : mêmes textes → pas de re-synthèse).
   *  L'étape 1 (la politique) part par la RÉSIDENCE (émetteur unique S7) AVANT cet appel sur le chemin durable
   *  (`ensureVoicePipeline`) ; au boot phase 5 (connexion ÉPHÉMÈRE, la résidence n'existe pas encore avant
   *  PRÊT), la séquence est enroll → cache et la politique suit à PRÊT — écart d'ordre BÉNIN au boot (set GPU
   *  invariant), tracé §7 ; l'ordre STRICT complet vaut au respawn/rebuild, là où S10 le grave.
   *  Chaque étape est bornée et gérée ; l'ordre d'ÉMISSION est garanti (await séquentiel sur le même WS).
   *  PAS gaté `audioEnabled` (écart vs le gate V13 conv 58, tracé §7) : le resync S10 est de la STRUCTURE
   *  (messages WS locaux, AUCUN effet machine — contrairement au ducking/phantoms/phrase de retour, qui
   *  restent gatés) ; un sidecar sans audio répond des acks HONNÊTES (« non montée », speaker « absent »)
   *  → les harnais structure exercent le VRAI chemin S10 du runtime. Jamais fatal : sans filet/ancre,
   *  Sophia vit — on le DIT (ROB-M3 croisé conv 58 : l'ack est LU, jamais un log menteur). */
  private async sendEarsResync(origin: string): Promise<void> {
    const log = (l: string): void => { try { this.display.onLog?.(l); } catch { /* jamais fatal */ } };
    const settleCache = (ack: unknown): void => {
      const p = (ack as { payload?: { ok?: unknown; note?: unknown } } | null)?.payload;
      if (p?.ok === true) log(`phrases de secours descendues aux oreilles (${origin}) — pré-synthèse en fond (V13)`);
      else log(`phrases de secours NON posées (${origin}) : ${String(p?.note ?? "ack inattendu")} — le filet V13 attendra le prochain envoi`);
    };
    const settleEnroll = (ack: unknown): void => {
      const p = (ack as { payload?: { ok?: unknown; anchor?: unknown; speaker?: unknown; note?: unknown } } | null)?.payload;
      if (p?.ok === true) log(`empreintes (enroll S10) : ${String(p?.anchor ?? "?")} — speaker ${String(p?.speaker ?? "?")} (${origin})`);
      else log(`empreintes (enroll S10) NON confirmées (${origin}) : ${String(p?.note ?? "ack inattendu")}`);
    };
    const viaDurable = this.earsIpc != null;
    const ipc = this.earsIpc ?? new IpcClient();
    try {
      if (!viaDurable) {
        // SOLO-2 (conv 58) : `connect` n'a PAS de timeout propre (un handshake WS qui pend suspendrait le BOOT
        // avant PRÊT — le hook phase 5 est awaité). Borne dure : au-delà, on abandonne (le resync manquera,
        // DIT), le boot continue. `request`, lui, est déjà borné (requestTimeoutMs 3 s).
        let timer: ReturnType<typeof setTimeout> | null = null;
        const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("connexion IPC > 5 s")), 5000); });
        try {
          await Promise.race([ipc.connect(this.earsSupervisor.port), deadline]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      // S10 étape 2 — l'enroll (jalon d'ordre). Un échec n'empêche PAS l'étape 3 (chaque étape gérée) ; l'ordre
      // d'émission enroll-AVANT-cache reste tenu (await séquentiel).
      try {
        settleEnroll(await ipc.request("cmd.enroll.push", {}));
      } catch (e) {
        log(`empreintes (enroll S10) NON confirmées (${origin}) : ${(e as Error).message}`);
      }
      // S10 étape 3 — les phrases de secours.
      try {
        settleCache(await ipc.request("cmd.tts.cache", { phrases: FALLBACK_PHRASES }));
      } catch (e) {
        log(`phrases de secours NON descendues (${origin}) : ${(e as Error).message} — le filet V13 attendra le prochain envoi`);
      }
    } catch (e) {
      log(`resync oreilles NON fait (${origin}) : ${(e as Error).message}`);
    } finally {
      if (!viaDurable) { try { ipc.close(); } catch { /* un close qui trébuche n'affecte rien */ } }
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
        // conv 56 — BALAYAGE FANTÔMES d'abord (prod/audio seulement ; smoke/tests : hermétique, jamais tuer les sidecars
        // d'un autre harnais). Un cycle de dev interrompu laisse des pythons CUDA mourants (mort différée ~15 s+) qui
        // contendent avec la session fraîche (la soirée « rame à mort » conv 55) — l'app n'avait AUCUN balayage (le juge
        // oui). AVANT le spawn (les nôtres n'existent pas encore → tout server.py du repo est étranger) ; un juge vivant
        // → on ne touche à rien ; jamais fatal (voir phantoms.ts).
        sidecarStart: async () => {
          if (this.audioEnabled) await sweepPhantomSidecars({ repoToken: this.repoToken, onLog: this.display.onLog });
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
        // Phase 5 — V13/V15 (F7/B2 + S10) : le resync des oreilles APRÈS la readiness des sidecars et AVANT
        // PRÊT (le hook gravé du boot, plan/00 T5 ph.5). Connexion IPC ÉPHÉMÈRE → cmd.enroll.push (jalon S10,
        // écart A-b conv 60) puis cmd.tts.cache {phrases} → acks LUS (la synthèse court en fond côté sidecar,
        // la « courte fenêtre sans filet » avant sa fin est assumée par le gravé §4.7). La POLITIQUE, elle,
        // part à PRÊT via la résidence (émetteur unique S7 — écart d'ordre bénin au boot, tracé §7 ; l'ordre
        // S10 STRICT vaut au respawn/rebuild). L'échec est gardé par le boot (log `postReady`, jamais fatal).
        // Le prewarm gouverné (05) s'ajoutera ici.
        sidecarPostReady: () => this.sendEarsResync("boot phase 5"),
        // Phases 1-3 (02/03) : définis plus tard.
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
        // V11 : un calque posé/retiré (SECOURS/JEU, par doc 05) → la résidence des modèles ré-émet sa politique. La
        // closure lit `this.residence` À L'APPEL (elle est câblée plus bas, après la connexion IPC) — inerte au socle.
        onMode: () => this.residence?.onGovernorMode(),
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
      // V7 (morceau C) — le FIL oreilles↔voix (2 canaux IPC) + la résidence des modèles V11, SEULEMENT si les DEUX sidecars
      // sont PRÊTS. conv 55 : délégué à `ensureVoicePipeline` (idempotent + résilient). Si un sidecar est encore RESTARTING
      // ici (un `spawn-echoue` au boot puis respawn), le pipeline ne se construit PAS maintenant mais se construira au
      // respawn (onReady → refreshVoiceReady → ensureVoicePipeline), au lieu de rester `null` à vie = le bug « boot sans
      // voix » (voyant au vert mais aucun routeur). Non-fatal ; le dégradé partiel ears-seul/mouth-seul reste frontière V9 (§7).
      await this.ensureVoicePipeline();
    }
    return outcome;
  }
}
