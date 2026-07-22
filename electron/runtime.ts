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
      // conv 55 (fix « boot sans voix ») : construire le pipeline de voix S'IL ne l'est pas — il ne s'est PAS construit au
      // boot si un sidecar était encore en RESTARTING à cet instant (un `spawn-echoue` puis respawn). Avant, seul le voyant
      // était éteint ici (faux vert : router=null à vie → silence). `ensureVoicePipeline` est idempotent (ne fait rien si
      // déjà construit) → mid-session (le routeur existe déjà, sidecar qui flappe = frontière V9) : inchangé.
      void this.ensureVoicePipeline();
    }
  }

  /** conv 55 — Construit le pipeline de voix (2 canaux IPC + résidence V11 + routeur V7 + start) DÈS que les 2 sidecars sont
   *  READY, que ce soit AU BOOT ou après un RESPAWN (via refreshVoiceReady). IDEMPOTENT (une seule construction) et sûr à
   *  l'arrêt. Corrige le one-shot d'origine qui laissait `router=null` à vie si un sidecar avait hoqueté au démarrage.
   *  NON-FATAL : un échec de connexion (course) est loggé, le reste du runtime vit ; ré-essayé au prochain onReady.
   *  La RECONNEXION sur crash d'un sidecar EN COURS de conversation (routeur vivant pointant un socket mort) = frontière V9 (§7) ;
   *  le RESYNC ordonné du respawn (policy → enroll → tts.cache, S10) = V15 (§7 V13 conv 58 — même trace, deux facettes). */
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
      const earsIpc = new IpcClient();
      await earsIpc.connect(this.earsSupervisor.port);
      // Ré-évaluer APRÈS l'await : un arrêt a pu démarrer entre-temps → ne pas laisser un socket ouvert ni brancher un routeur.
      if (this.stopping || this.session?.kind !== "PRIMARY") { try { earsIpc.close(); } catch { /* */ } return; }
      this.earsIpc = earsIpc; // assigné DÈS la connexion → si `mouthIpc.connect` rejette, le `catch` ferme ce socket (pas de fuite half-open).
      const mouthIpc = new IpcClient();
      await mouthIpc.connect(this.mouthSupervisor.port);
      if (this.stopping || this.session?.kind !== "PRIMARY") { try { earsIpc.close(); } catch { /* */ } try { mouthIpc.close(); } catch { /* */ } this.earsIpc = null; return; }
      this.mouthIpc = mouthIpc;
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
      residence.start();   // V11 : politique INITIALE (groupe veille) + abonnement evt.model.* (le resync ORDONNÉ de S10 = V15, §7)
      // V13 : (re)descendre les phrases de secours par le canal durable — idempotent côté sidecar (le boot
      // nominal l'a déjà fait en phase 5) ; couvre le boot-sans-voix dont le pipeline se construit au respawn.
      void this.sendFallbackCache("pipeline");
      // V12 — le DUCKING, gaté `audioEnabled` (jamais smoke/tests : on ne touche pas aux volumes de la machine
      // d'un harnais de test — patron du balayage fantômes). ADDITIF : abonnements evt.* À CÔTÉ du routeur
      // (IpcClient.on = multi-abonnés) + fan-out onVoiceState ci-dessus — le routeur n'est PAS touché.
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
      log("routeur de conversation + résidence des modèles branchés (le fil oreilles↔voix, 2 process — V7/V11)"
        + (this.audioEnabled ? " + ducking V12" : ""));
    } catch (e) {
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

  /** V13 — descend les phrases de secours aux OREILLES (`cmd.tts.cache`, technique/01 §4.7). Gaté `audioEnabled`
   *  (un harnais sans audio n'a rien à pré-synthétiser — patron ducking V12). IDEMPOTENT côté sidecar (mêmes
   *  textes → pas de re-synthèse) → appelé DEUX fois au boot nominal sans double travail : (a) du hook
   *  `sidecarPostReady` (phase 5, AVANT PRÊT — le pipeline n'existe pas encore → connexion ÉPHÉMÈRE) ; (b) de
   *  `ensureVoicePipeline` (canal durable — couvre AUSSI le boot-sans-voix dont le pipeline se construit au
   *  respawn, cas où (a) n'a jamais tourné). Le resync ORDONNÉ complet au respawn (S10 : policy → enroll →
   *  tts.cache) = V15 (§7, même trace que la résidence). Jamais fatal : sans filet, Sophia vit — on le DIT. */
  private async sendFallbackCache(origin: string): Promise<void> {
    if (!this.audioEnabled) return;
    const log = (l: string): void => { try { this.display.onLog?.(l); } catch { /* jamais fatal */ } };
    // ROB-M3 (croisé conv 58) : LIRE l'ack — le sidecar acke `ok:false` quand le filet n'est PAS monté
    // (oreilles « vivant sans oreilles » : micro absent) ou qu'un precache différent est en vol. Un log
    // « descendues » sur un ok:false serait un MENSONGE (« sans filet, Sophia vit — on le DIT » : dit VRAI).
    const settle = (ack: unknown): void => {
      const p = (ack as { payload?: { ok?: unknown; note?: unknown } } | null)?.payload;
      if (p?.ok === true) log(`phrases de secours descendues aux oreilles (${origin}) — pré-synthèse en fond (V13)`);
      else log(`phrases de secours NON posées (${origin}) : ${String(p?.note ?? "ack inattendu")} — le filet V13 attendra le prochain envoi`);
    };
    if (this.earsIpc) {
      try {
        settle(await this.earsIpc.request("cmd.tts.cache", { phrases: FALLBACK_PHRASES }));
      } catch (e) {
        log(`phrases de secours NON descendues (${origin}) : ${(e as Error).message} — le filet V13 attendra le prochain envoi`);
      }
      return;
    }
    const ipc = new IpcClient();
    try {
      // SOLO-2 (conv 58) : `connect` n'a PAS de timeout propre (un handshake WS qui pend suspendrait le BOOT
      // avant PRÊT — le hook phase 5 est awaité). Borne dure : au-delà, on abandonne (le filet manquera, DIT),
      // le boot continue. `request`, lui, est déjà borné (requestTimeoutMs 3 s).
      let timer: ReturnType<typeof setTimeout> | null = null;
      const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("connexion IPC > 5 s")), 5000); });
      try {
        await Promise.race([ipc.connect(this.earsSupervisor.port), deadline]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      settle(await ipc.request("cmd.tts.cache", { phrases: FALLBACK_PHRASES }));
    } catch (e) {
      log(`phrases de secours NON descendues (${origin}) : ${(e as Error).message} — le filet V13 attendra le prochain envoi`);
    } finally {
      try { ipc.close(); } catch { /* un close qui trébuche n'affecte rien */ }
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
        // Phase 5 — V13 (F7/B2) : la pré-synthèse des phrases de secours, APRÈS la readiness des sidecars et
        // AVANT PRÊT (le hook gravé du boot, plan/00 T5 ph.5 — jamais défini jusqu'ici). Connexion IPC
        // ÉPHÉMÈRE aux oreilles → cmd.tts.cache {phrases} → ack (la synthèse court en fond côté sidecar, la
        // « courte fenêtre sans filet » avant sa fin est assumée par le gravé §4.7). L'échec est déjà gardé
        // par le boot (log `postReady`, jamais fatal). enroll/prewarm (01/05) s'ajouteront ici (V15).
        sidecarPostReady: () => this.sendFallbackCache("boot phase 5"),
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
