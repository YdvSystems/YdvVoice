// Canal Claude Code (socle T8) — traduit technique/00 §4.1 (Phase 4 « init du canal Claude ») + A1/A36.
//
// Le « téléphone » de Sophia vers son cerveau. Deux vérités gravées à la source (JOURNAL A1/A36, banc conv 38) :
//   · `claude -p` est REQUEST-SCOPED (pas un démon) — un tour = UNE invocation. Le process persistant/keep-warm
//     est un repli MESURÉ de `plan/05` R4, PAS le socle. Ici : la machinerie d'invocation + le cycle de vie du fil.
//   · OAuth Max TOUJOURS (A1) : jamais `--bare` (bascule clé API), `ANTHROPIC_API_KEY` scrubbé de l'env du child.
//
// Contrat CLI MESURÉ à la source (bancs/claude/CONTRAT-MESURE.md, claude 2.1.161) :
//   invocation : `claude.exe -p --output-format stream-json --verbose (--session-id <uuid> | --resume <uuid>) "<prompt>"`
//   · `--verbose` OBLIGATOIRE avec stream-json ; stdin FERMÉ (sinon attente 3 s) ; prompt = dernier argument.
//   · `--session-id <uuid>` → JE contrôle l'id (déterministe) ; le fichier de session = <~/.claude/projects>/<slug>/<uuid>.jsonl.
//   · `--resume <id-inexistant>` → ERREUR (« No conversation found ») → `isResumable` vérifie l'existence du fichier AVANT.
//   · événements : `system/init` (session_id, apiKeySource:"none"=OAuth) · `assistant` (blocs text) · `rate_limit_event`
//     (throttle → onThrottle) · `result` (is_error/result/ttft_ms = fin de tour).
//
// Module Node PUR (aucune API Electron ; patron Governor/Supervisor/shutdown : capacités injectées) → testable hors
// Electron (faux-claude) et prouvé en cœur réel (E2E-7 : crash → --resume → continuité).

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { setSynchronous } from "../db/durability.js";
import { AuditLog } from "../audit/index.js";
import type { SophiaPaths } from "../paths.js";

/** Le contenu structuré émis par `rate_limit_event` — la classification fine (SECOURS quota) est à `plan/05` R5. */
export interface ThrottleInfo {
  status?: string;         // "allowed" | ... (throttlé quand ≠ "allowed")
  rateLimitType?: string;  // "five_hour" (fenêtre Max)
  [k: string]: unknown;
}

/** Erreur d'invocation remontée (jamais silencieuse — le boot/l'app survivent ; le détecteur `05` classe).
 *  `a1` = un provider NON-OAuth (clé/Bedrock/Vertex) a été détecté à l'init → tour abandonné avant toute dépense (A1). */
export interface ClaudeError {
  kind: "spawn" | "timeout" | "abort" | "no-result" | "invocation" | "a1";
  detail: string; // technique (jamais de verbatim conversationnel — AF-10)
}

/** Le résultat d'une invocation TERMINÉE (succès OU erreur d'invocation). Une invocation qui ne se termine pas
 *  (spawn KO / timeout / annulation) REJETTE ; celle qui rend un `result` RÉSOUT (l'appelant lit `isError`). */
export interface InvokeResult {
  text: string;
  isError: boolean;
  sessionId: string;
  ttftMs: number | null;
  errorDetail?: string;
  /** Le `--resume` a échoué car le fil est introuvable (« No conversation found », mesuré) — signal DÉCOUPLÉ de
   *  l'ordre des lignes de stderr (F3 re-croisé conv 38), consommé par le repli m4 dans `invoke`. L'appelant lit `isError`. */
  resumeMissing?: boolean;
}

export interface InvokeOptions {
  /** Reprendre le fil durable courant (--resume) plutôt qu'en ouvrir un neuf. Défaut TRUE (conversation continue). */
  resume?: boolean;
  /** DURABLE (défaut = la CONVERSATION) : le fil devient `claude_session_id` (persisté, repris aux tours suivants).
   *  Éphémère (`durable:false` = une invocation AUTONOME micro/deep/rêverie de `02`/`03`/`04`) : fil FRAIS, JAMAIS
   *  persisté → n'écrase PAS le fil de conversation (AF-7 : rêverie ‖ conversation coexistent) ; l'appelant purge
   *  son `sessionId` (rendu dans le résultat) après extraction. */
  durable?: boolean;
  /** Persona/cadre injecté (`--append-system-prompt`) — AVAL `99`/`03` ; inutilisé au socle. */
  systemPrompt?: string;
  /** Modèle (`--model <alias>`) — AVAL `05` (politique de modèles) ; défaut = défaut CLI. */
  model?: string;
  /** cwd de l'invocation : contrôle le contexte (CLAUDE.md/hooks + slug du fichier de session) — AVAL. Défaut = cwd du process. */
  cwd?: string;
  /** Streaming des blocs de texte au fil de l'eau (le fin token-par-token via `--include-partial-messages` = V7). */
  onDelta?: (chunk: string) => void;
  /** Timeout dur (kill du child) — un `claude` figé ne bloque jamais. Défaut = `defaultTimeoutMs`. */
  timeoutMs?: number;
  /** Annulation coopérative (préemption gouverneur / arrêt) — kill du child. */
  signal?: AbortSignal;
}

/** Capacité INJECTABLE : lance une invocation `claude` et rend le ChildProcess (stdout/stderr en `pipe`, stdin fermé).
 *  Défaut = résout `claude.exe` + spawn Node. Test = faux-claude (script node émettant du stream-json). */
export type SpawnClaude = (args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;

export interface ClaudeChannelOptions {
  db: DatabaseSync;                 // fichier de vérité (écrivain unique = l'orchestrateur, F2)
  paths: SophiaPaths;               // pour l'audit (AF-10 : événements, jamais de contenu)
  spawnClaude?: SpawnClaude;        // COUTURE (faux-claude en test) ; défaut = claude.exe réel
  projectsDir?: string;             // COUTURE : ~/.claude/projects (test = répertoire jetable)
  onLog?: (line: string) => void;
  onError?: (e: ClaudeError) => void;      // remontée d'erreur (jamais silencieux) → détecteur `05`
  /** Chaque `rate_limit_event` (Y COMPRIS `status:"allowed"` = non throttlé) → détecteur `05` / `governor.notifyThrottle`.
   *  T8 REMONTE, `05` CLASSE : le canal ne filtre pas le callback (un futur `05` peut vouloir voir "allowed" pour
   *  relâcher un backoff) ; le consommateur teste `status !== "allowed"` (le log/audit de Sophia, eux, sont gardés). */
  onThrottle?: (info: ThrottleInfo) => void;
  defaultTimeoutMs?: number;        // timeout d'invocation (calibration §6 ; défaut prudent)
  now?: () => number;               // horloge injectable (audit déterministe en test)
}

const DEFAULT_TIMEOUT_MS = 120_000; // 2 min : un tour cloud (TTFT ~qq s + génération) tient large ; calibration §6.

/** Emplacement par défaut des fichiers de session du CLI (`~/.claude/projects`). Redirection vers `G:\Sophia\sessions\` = `plan/05` R0. */
export function defaultProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Résout le binaire NATIF `claude.exe` (jamais le shim `.cmd`/`.ps1` → zéro shell/quoting, banc conv 38).
 * Ordre : override d'env explicite → chemin npm-global standard → échec CLAIR (jamais un repli silencieux vers un
 * shim qui exigerait un shell). L'échec est honnête : sans binaire, le canal ne peut pas parler — dit, pas masqué.
 */
export function resolveClaudeExe(): string {
  const override = process.env.SOPHIA_CLAUDE_EXE;
  if (override) return override;
  const appdata = process.env.APPDATA;
  if (appdata) {
    const p = path.join(appdata, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("claude.exe introuvable (ni SOPHIA_CLAUDE_EXE, ni %APPDATA%\\npm\\...\\bin\\claude.exe) — canal Claude indisponible");
}

const STDERR_CAP = 16_384; // N2 : borne le stderr gardé en mémoire (seul firstLine/200c est utilisé) — un claude bavard ne gonfle pas.

/**
 * Env du child — A1 « OAuth Max, JAMAIS de dépense nouvelle » (M1 croisé conv 38). Ce scrub est la garantie PRIMAIRE :
 * on retire (a) les auth par CLÉ/jeton (bascule API payante) ET (b) les variables qui ROUTENT `claude` vers un provider
 * PAYANT (Bedrock/Vertex/proxy métré) héritées du profil — sans ça, une variable métier qui traîne
 * (`CLAUDE_CODE_USE_BEDROCK`…) ferait partir Sophia sur du payant EN SILENCE. La denylist couvre les routes CONNUES
 * (l'ensemble des chemins payants documentés du CLI). La détection POSITIVE `apiKeySource==="none"` à l'init (invoke)
 * est un SECOND FILET best-effort qui COMPLÈTE ce scrub, pas l'inverse : elle attrape une auth par CLÉ inattendue ayant
 * échappé à la liste, mais ne « voit » pas tout (un provider comme Bedrock/Vertex peut légitimement rapporter
 * `apiKeySource==="none"` — sa fermeture RESTE le scrub (b), pas cette sonde) ; et si l'init n'émettait plus le champ,
 * on ne s'auto-coupe pas (fail-open — le scrub porte la garantie). Le multi-provider DÉLIBÉRÉ (fork) = `05` R5, qui
 * pose son propre env par-dessus — jamais le défaut socle.
 */
// EXPORTÉ (source UNIQUE de la denylist A1) : réutilisé par `resources/warm` (WarmBrain V7, cerveau chaud nu) —
// une seule liste autoritaire, un nouveau chemin payant ajouté ICI protège TOUS les spawns claude (T8 + WarmBrain).
export const A1_SCRUB = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",              // auth par clé/jeton statique → API payante
  "ANTHROPIC_CUSTOM_HEADERS",                               // en-têtes custom (peut porter x-api-key/Authorization → payant) — F4 audit conv 38
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",       // routage provider cloud payant (AWS/GCP)
  "ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_BASE_URL", // proxy/gateway métré
];
/** Env du child SCRUBBÉ de toute route payante (A1) — la garantie PRIMAIRE « OAuth Max, jamais de dépense nouvelle ».
 *  Exporté pour que WarmBrain (V7) pose EXACTEMENT le même scrub que le canal T8 (aucune divergence possible). */
export function scrubbedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of A1_SCRUB) delete env[k];
  return env;
}

function defaultSpawnClaude(): SpawnClaude {
  return (args, opts) => nodeSpawn(resolveClaudeExe(), args, {
    cwd: opts.cwd,
    env: opts.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], // stdin FERMÉ (évite l'attente 3 s mesurée au banc)
  });
}

/** Le rapport de `claudeInit` : le boot sait s'il pourra reprendre le fil ou démarrer frais (+ filet A13 de `02`). */
export interface ClaudeBootReport {
  hasThread: boolean;   // un fil durable est enregistré
  resumable: boolean;   // ...et il est reprenable (non taché + fichier présent)
}

/**
 * Hook boot Phase 4 (technique/00 §4.1 « init du canal Claude ») — LECTURE PURE, aucun spawn (comme `reconstructQueue`).
 * Lit le fil durable (`session_state.claude_session_id`) et dit s'il est reprenable. Un fil TACHÉ (`secours_tainted`,
 * posé par `plan/05` R5) ou dont le fichier a disparu → NON reprenable → au 1ᵉʳ tour le canal ouvrira un fil frais
 * (le filet A13 = résumé + N derniers échanges est réalisé par `02` M6). FAIL-SAFE : ne fait JAMAIS tomber le boot
 * (une base douteuse au boot ferait remonter l'exception à `boot()` → BLOCKED au lieu de vivre — patron `reconstructQueue`).
 */
export function claudeInit(db: DatabaseSync, projectsDir: string = defaultProjectsDir()): ClaudeBootReport {
  try {
    const row = db.prepare("SELECT claude_session_id, secours_tainted FROM session_state WHERE id=1").get() as
      | { claude_session_id: string | null; secours_tainted: number }
      | undefined;
    const id = row?.claude_session_id ?? null;
    if (!id) return { hasThread: false, resumable: false };
    if (row?.secours_tainted === 1) return { hasThread: true, resumable: false }; // fil troué par un épisode SECOURS
    return { hasThread: true, resumable: findSessionFile(projectsDir, id) !== null };
  } catch {
    return { hasThread: false, resumable: false }; // base douteuse : on ne devine pas, on ne tombe pas
  }
}

/** Trouve le fichier de session `<id>.jsonl` sous chaque sous-dossier de `<projectsDir>` (l'uuid est unique → au plus un match). Aucune
 *  hypothèse sur l'algo de slug du cwd : on cherche par id. Retourne le chemin, ou null. Fail-safe (répertoire absent). */
function findSessionFile(projectsDir: string, id: string): string | null {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(projectsDir, { withFileTypes: true }); }
  catch { return null; } // ~/.claude/projects absent (jamais invoqué encore) → pas de fichier
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(projectsDir, e.name, `${id}.jsonl`);
    try { if (fs.existsSync(p)) return p; } catch { /* volume qui vacille : ce n'est pas ce fichier */ }
  }
  return null;
}

export class ClaudeChannel {
  private readonly db: DatabaseSync;
  private readonly audit: AuditLog;
  private readonly spawnClaude: SpawnClaude;
  private readonly projectsDir: string;
  private readonly onLog?: (l: string) => void;
  private readonly onError?: (e: ClaudeError) => void;
  private readonly onThrottle?: (info: ThrottleInfo) => void;
  private readonly defaultTimeoutMs: number;
  private readonly nowFn: () => number;

  /** Le fil durable courant (miroir mémoire de `session_state.claude_session_id`). null = pas de fil → prochain tour frais. */
  private currentId: string | null = null;
  /** Génération du fil de conversation : incrémentée par `rotate()` (nouvelle conversation / invalidation M8). Un tour
   *  DURABLE dont la génération a changé pendant son vol ne persiste PAS son fil (il serait périmé) → ferme la course
   *  rotation↔persist (m2 croisé conv 38 : un fil « invalidé » ne peut plus être ressuscité par un tour frais en vol). */
  private generation = 0;
  /** Les invocations `claude` en vol → `stopChannel` les tue à l'arrêt (⑩bis). La valeur MARQUE la cause « abort » de CE
   *  tour AVANT le kill (N1 : un tour tué à l'arrêt est classé « abort », jamais « crash »/no-result → pas de faux signal 05). */
  private readonly active = new Map<ChildProcess, { markAborted: () => void }>();

  constructor(opts: ClaudeChannelOptions) {
    this.db = opts.db;
    this.audit = new AuditLog(opts.paths.audit);
    this.spawnClaude = opts.spawnClaude ?? defaultSpawnClaude();
    this.projectsDir = opts.projectsDir ?? defaultProjectsDir();
    this.onLog = opts.onLog;
    this.onError = opts.onError;
    this.onThrottle = opts.onThrottle;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nowFn = opts.now ?? (() => Date.now());
    // Lit le fil durable à reprendre (fail-safe). Aucun spawn ici : le 1ᵉʳ spawn = au 1ᵉʳ tour (request-scoped).
    try {
      const row = this.db.prepare("SELECT claude_session_id FROM session_state WHERE id=1").get() as
        | { claude_session_id: string | null } | undefined;
      this.currentId = row?.claude_session_id ?? null;
    } catch { this.currentId = null; }
  }

  private log(l: string): void { this.onLog?.(l); }
  private now(): number { return this.nowFn(); }
  get sessionId(): string | null { return this.currentId; }

  /** Le fil `id` est-il reprenable ? id présent ET non taché (`secours_tainted`, `05`) ET fichier de session présent
   *  (mesuré : un `--resume` d'un fichier absent ERREURE). FAIL-SAFE : au moindre doute (lecture KO) → NON reprenable. */
  isResumable(id: string | null = this.currentId): boolean {
    if (!id) return false;
    try {
      const row = this.db.prepare("SELECT secours_tainted FROM session_state WHERE id=1").get() as
        | { secours_tainted: number } | undefined;
      if (row?.secours_tainted === 1) return false; // fil troué → jamais reprendre (05 R5 / AT2)
    } catch { return false; } // dans le doute, fil frais (jamais un --resume douteux)
    return findSessionFile(this.projectsDir, id) !== null;
  }

  /**
   * UNE invocation `claude -p` (request-scoped), AVEC un repli de reprise (m4 croisé conv 38) : si un `--resume` échoue
   * parce que le fichier du fil a disparu APRÈS le check (TOCTOU : rotate/M8 concurrent, ou coupure d'écriture côté
   * claude — le contrat mesuré dit « --resume d'un fichier absent ERREURE »), on refait UNE SEULE invocation en session
   * FRAÎCHE (le contexte du filet A13 = résumé + N derniers échanges est réinjecté par `02` M6). RÉSOUT avec le `result`
   * (succès ou erreur applicative) ; REJETTE si l'invocation ne se termine pas (spawn KO / timeout / annulation / provider
   * non-OAuth A1). Ne fait JAMAIS tomber l'appelant (erreurs remontées via onError).
   */
  async invoke(prompt: string, opts: InvokeOptions = {}): Promise<InvokeResult> {
    const wantResume = (opts.durable ?? true) && (opts.resume ?? true);
    const r = await this.invokeOnce(prompt, opts);
    // m4 (TOCTOU) : le --resume a échoué parce que le fichier du fil a disparu APRÈS le check d'existence (rotate/M8
    // concurrent, ou coupure côté claude) → UNE reprise en session fraîche. `resumeMissing` est calculé sur le stderr
    // COMPLET (F3) → découplé de l'ordre des lignes. Le repli ouvre un fil frais (resume:false) → jamais de boucle.
    if (wantResume && r.resumeMissing) {
      this.log("canal Claude : --resume a échoué (fil disparu après le check) → reprise en session fraîche (une fois)");
      return this.invokeOnce(prompt, { ...opts, resume: false });
    }
    return r;
  }

  /** Une invocation, une fois (sans le repli m4). Reprend le fil courant si `resume`+reprenable, sinon un fil FRAIS. */
  private invokeOnce(prompt: string, opts: InvokeOptions): Promise<InvokeResult> {
    const durable = opts.durable ?? true; // conversation (durable) vs invocation autonome éphémère (02/03/04, AF-7)
    const useResume = durable && (opts.resume ?? true) && this.isResumable(this.currentId);
    const sessionId = useResume ? (this.currentId as string) : randomUUID();
    const gen = this.generation; // m2 : génération au DÉBUT du tour — une rotation en vol rendra ce fil frais périmé
    const args = this.buildArgs(prompt, { sessionId, useResume, systemPrompt: opts.systemPrompt, model: opts.model });
    const cwd = opts.cwd ?? process.cwd();
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<InvokeResult>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnClaude(args, { cwd, env: scrubbedEnv(process.env) });
      } catch (e) {
        // Échec de spawn SYNCHRONE (ex. binaire introuvable via resolveClaudeExe) — remonté, jamais un crash.
        const err: ClaudeError = { kind: "spawn", detail: (e as Error).message };
        this.emitError(err);
        reject(new Error(`invoke: spawn impossible (${err.detail})`));
        return;
      }

      let settled = false;
      let seenInit = false;       // le fil a été CRÉÉ côté claude (init émis) → persistable si neuf + durable
      let resultEvt: { is_error?: boolean; result?: string; ttft_ms?: number; session_id?: string } | null = null;
      let acc = "";               // texte accumulé (repli si `result.result` absent)
      let stderr = "";
      let stdoutBuf = "";
      let killedReason: "timeout" | "abort" | "a1" | null = null;
      let a1Source = "";          // apiKeySource ≠ "none" détecté à l'init (M1) → provider payant, tour abandonné

      // Retourne TRUE une seule fois (le premier de 'error'/'close'/timeout/abort/a1 qui règle) → jamais un double
      // reject/emitError/persist (les handlers se gardent sur ce booléen).
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        this.active.delete(child);
        return true;
      };
      // N1 : stopChannel (à l'arrêt) marque « abort » CE tour AVANT de le tuer → jamais classé « crash »/no-result.
      // F4 (re-croisé conv 38) : PREMIÈRE cause gagne (`if (!killedReason)`) — un timeout tardif n'écrase pas un « abort »
      // délibéré (ni l'inverse) → la classification remontée à `05` reste la vraie cause du kill.
      this.active.set(child, { markAborted: () => { if (!killedReason) killedReason = "abort"; } });

      const timer = setTimeout(() => { if (!killedReason) killedReason = "timeout"; try { child.kill("SIGKILL"); } catch { /* déjà parti */ } }, timeoutMs);
      const onAbort = (): void => { if (!killedReason) killedReason = "abort"; try { child.kill("SIGKILL"); } catch { /* déjà parti */ } };
      if (opts.signal) { if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener("abort", onAbort); }

      // Ménage du fil FRAIS, appelé sur TOUTE fin de tour (close ET error) — F1/F2 re-croisé + ①② audit complet conv 38.
      // La reprise (--resume) ne touche RIEN (le fil repris ne s'efface jamais). Sinon deux régimes :
      //  · DURABLE (la conversation) : persiste dès que le tour a ABOUTI (init vu + result reçu + non périmé), MÊME sous
      //    un abort/timeout TARDIF de teardown (② : ne pas jeter un 1ᵉʳ tour RÉUSSI) — mais JAMAIS un fil `a1` (non-OAuth,
      //    hygiène A1). Sinon (tué en vol sans result, crash, 'error', rotation en vol m2) → purge (jamais un durable incomplet).
      //  · ÉPHÉMÈRE (durable:false, tâche autonome 02/03/04) : JAMAIS persisté (n'écrase pas le fil de conversation, AF-7).
      //    Sur SUCCÈS, l'appelant purge via le `sessionId` rendu ; si le tour NE REND PAS de résultat exploitable (tué /
      //    crash / 'error' → invoke REJETTE, aucun sessionId rendu), LE CANAL purge (① : jumeau du durable, F-99-2 — jamais
      //    de verbatim orphelin sans recours). `purgeSessionFile` est idempotent (no-op si le fichier n'existe pas encore).
      const settleFreshThread = (cleanClose: boolean): void => {
        if (useResume) return; // le fil repris ne s'efface jamais (ni persist ni purge)
        if (durable) {
          // Persiste dès que le tour a ABOUTI (result reçu) et est current — MÊME sous un abort/timeout TARDIF de teardown
          // (② : ne pas jeter un 1ᵉʳ tour réussi). MAIS jamais un fil `a1` (`killedReason !== "a1"`, 4ᵉ tour audit) : même si
          // un provider non-OAuth rendait un result dans le même flux que l'init, l'abandon A1 reste PROPRE (fil taché purgé,
          // jamais ancré comme conversation). `cleanClose` : sur 'error' (kill échoué → process vivant → fichier d'état
          // INCERTAIN) on purge par prudence plutôt que persister un fil peut-être tronqué.
          if (cleanClose && seenInit && resultEvt !== null && killedReason !== "a1" && this.generation === gen) this.persistSessionId(sessionId);
          else { this.purgeSessionFile(sessionId); if (this.generation !== gen) this.log("canal Claude : rotation pendant le tour → fil frais périmé, purgé (jamais persisté)"); }
        } else {
          // = la condition EXACTE de resolve de invokeOnce (l'appelant reçoit alors un sessionId et purge lui-même).
          const resolved = cleanClose && killedReason === null && resultEvt !== null;
          if (!resolved) this.purgeSessionFile(sessionId);
        }
      };

      // M1 (conv 34) : un 'error' de spawn SANS listener serait LEVÉ → l'orchestrateur tomberait. Fin d'invocation en échec.
      child.on("error", (e: Error) => {
        if (!finish()) return;
        settleFreshThread(false); // F2 : si le child émet 'error' au lieu de 'close', un fil frais déjà créé est quand même purgé
        const err: ClaudeError = { kind: "spawn", detail: e.message };
        this.emitError(err);
        reject(new Error(`invoke: erreur de process (${e.message})`));
      });

      const cbs = {
        // M1 (DÉFENSE POSITIVE A1, croisé conv 38) : l'init annonce la source d'auth RÉELLE. Une valeur ≠ "none" = une
        // auth par CLÉ (ou un provider qui la déclare) → on tue le child AVANT la génération (jamais une dépense nouvelle
        // en silence, A1/A38). SECOND FILET best-effort qui COMPLÈTE le scrub d'env (la garantie primaire), pas l'inverse :
        // un routage rapportant "none" reste fermé par le scrub, un champ absent ne s'auto-coupe pas (fail-open). `!killedReason`
        // (F4) : ne pas re-classer un tour DÉJÀ tué (abort/timeout) — le child est alors déjà en cours de kill.
        onInit: (apiKeySource?: string): void => {
          seenInit = true;
          if (apiKeySource !== undefined && apiKeySource !== "none" && !killedReason) {
            killedReason = "a1"; a1Source = apiKeySource;
            try { child.kill("SIGKILL"); } catch { /* déjà parti */ }
          }
        },
        onText: (t: string): void => { acc += t; },
        onThrottle: (info: ThrottleInfo): void => this.emitThrottle(info),
        onResult: (r: Record<string, unknown>): void => { resultEvt = r as typeof resultEvt; },
      };

      child.stderr?.on("data", (d: Buffer) => { if (stderr.length < STDERR_CAP) stderr = (stderr + d.toString()).slice(0, STDERR_CAP); }); // N2 : borne DURE (≤ CAP)
      child.stdout?.on("data", (d: Buffer) => {
        stdoutBuf += d.toString();
        let idx: number;
        while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
          const line = stdoutBuf.slice(0, idx);
          stdoutBuf = stdoutBuf.slice(idx + 1);
          this.handleLine(line, opts.onDelta, cbs);
        }
      });

      child.on("close", (code) => {
        if (!finish()) return;
        if (stdoutBuf.trim()) this.handleLine(stdoutBuf, opts.onDelta, cbs); // dernière ligne non terminée (tolérant)

        // Fin du tour : range le fil frais — persiste s'il a ABOUTI, purge sinon ; durable ET éphémère (cf. settleFreshThread, ①②).
        settleFreshThread(true);

        if (killedReason === "a1") {
          const err: ClaudeError = { kind: "a1", detail: `provider non-OAuth détecté (apiKeySource=${a1Source}) — tour abandonné, jamais de dépense nouvelle (A1)` };
          this.emitError(err);
          reject(new Error(err.detail));
          return;
        }
        if (killedReason) { // "timeout" | "abort"
          const err: ClaudeError = { kind: killedReason, detail: `invocation ${killedReason} (kill)` };
          this.emitError(err);
          reject(new Error(err.detail));
          return;
        }
        if (resultEvt) {
          const isError = resultEvt.is_error === true;
          // F3 (re-croisé conv 38) : le signal de repli m4 (fil introuvable) est calculé sur le stderr COMPLET, pas sur
          // firstLine — découplé de l'ordre des lignes (un futur claude qui préfixe un avertissement ne casse pas le repli).
          const resumeMissing = useResume && isError && /no conversation found/i.test(stderr);
          // F2 (audit conv 38) : un --resume RÉCUPÉRÉ (resumeMissing → le wrapper reprend en session fraîche) n'est PAS une
          // vraie erreur d'invocation → on NE lève PAS d'alerte `05` (le wrapper la loggue comme récupération) ; une vraie
          // erreur applicative (isError sans resumeMissing) alerte normalement. L'audit garde la trace honnête (ok:false).
          if (isError && !resumeMissing) this.emitError({ kind: "invocation", detail: firstLine(stderr) || `result is_error (exit ${code})` });
          try { this.audit.append({ evt: "claude.invoke", resumed: useResume, ok: !isError, ts: this.now() }); } catch { /* l'audit ne fait jamais tomber le canal */ }
          resolve({
            text: resultEvt.result ?? acc,
            isError,
            sessionId, // TOUJOURS l'id qu'on a imposé (--session-id/--resume) → le fichier est toujours <sessionId>.jsonl (NIT 4ᵉ tour)
            ttftMs: resultEvt.ttft_ms ?? null,
            errorDetail: isError ? (firstLine(stderr) || "invocation en erreur") : undefined,
            resumeMissing: resumeMissing || undefined,
          });
          return;
        }
        // Ni result, ni kill : le process est mort sans rendre de tour (crash claude, sortie précoce).
        const err: ClaudeError = { kind: "no-result", detail: `claude terminé (exit ${code}) sans result — ${firstLine(stderr)}` };
        this.emitError(err);
        reject(new Error(err.detail));
      });
    });
  }

  /** « Nouvelle conversation » : purge le fichier du fil courant (reco (a), vie privée) puis oublie l'id → le prochain
   *  tour ouvre un fil frais. Le wrapper anti-crash (`pending_ops` + sweep) est de `02` (table absente au socle) ;
   *  ici la purge est best-effort + tracée. Utilisé aussi par `02` M8 (invalidation du fil taché) via purgeSessionFile. */
  rotate(): void {
    const old = this.currentId;
    this.generation++; // m2 : invalide tout tour DURABLE en vol → il ne pourra plus persister son fil frais (périmé)
    // m3 (croisé conv 38) : PURGE d'abord, oubli ensuite. Un crash ENTRE les deux laisse le fichier supprimé + la base
    // pointant vers un id absent → isResumable=false → tour frais, ZÉRO résidu (l'ordre inverse laissait un fichier de
    // verbatim ORPHELIN ineffaçable). Purge best-effort ; le wrapper anti-crash (pending_ops+sweep) reste de `02`.
    if (old) this.purgeSessionFile(old); // (a) purge immédiate — pas d'accumulation de verbatim rotée (dette F-99-2)
    this.persistSessionId(null);         // le fil courant est clos ; prochain tour = frais
    try { this.audit.append({ evt: "claude.rotate", ts: this.now() }); } catch { /* */ }
    this.log("canal Claude : rotation (nouvelle conversation)");
  }

  /** Supprime le fichier de session `<id>.jsonl` (best-effort, tracé). Primitive SOCLE appelée par `02` M8
   *  (« le fil Claude est invalidé » : sans ça un `--resume` réinjecterait le contenu effacé) ET par `rotate`. */
  purgeSessionFile(id: string): boolean {
    const p = findSessionFile(this.projectsDir, id);
    if (!p) return false; // rien à purger (déjà absent, ou jamais persisté)
    try {
      fs.rmSync(p, { force: true });
      this.log(`canal Claude : fichier de session purgé (${id})`);
      return true;
    } catch (e) {
      this.log(`canal Claude : purge du fichier de session ${id} échouée (${(e as Error).message})`);
      return false;
    }
  }

  /** Teardown à l'arrêt (couture T6, symétrique à `quiesceGovernor`) : tue toute invocation en vol. Léger
   *  (request-scoped : d'ordinaire rien en vol ; mais une deep/rêverie longue doit céder). Idempotent. */
  stopChannel(): void {
    const n = this.active.size;
    // N1 : marquer « abort » CE tour AVANT de le tuer → sa fin est classée « abort » (arrêt délibéré), jamais « crash »/
    // no-result (qui enverrait un faux signal au détecteur 05 en plein teardown).
    for (const [child, h] of this.active) { h.markAborted(); try { child.kill("SIGKILL"); } catch { /* déjà parti */ } }
    this.active.clear();
    // Trace (AF-10 : un compteur, jamais de contenu) : prouve au smoke que le VRAI before-quit a bien appelé stopChannel
    // (couture ⑩bis câblée via getChannel dans SophiaRuntime) — un getChannel oublié rejouerait le MAJEUR conv 37.
    try { this.audit.append({ evt: "claude.stopped", killed: n, ts: this.now() }); } catch { /* l'audit ne fait jamais tomber l'arrêt */ }
  }

  // ── privé ─────────────────────────────────────────────────────────────────
  private buildArgs(
    prompt: string,
    o: { sessionId: string; useResume: boolean; systemPrompt?: string; model?: string },
  ): string[] {
    const a = ["-p", "--output-format", "stream-json", "--verbose"]; // --verbose OBLIGATOIRE (mesuré) ; jamais --bare (A1)
    if (o.model) a.push("--model", o.model);
    if (o.systemPrompt) a.push("--append-system-prompt", o.systemPrompt); // persona = AVAL 99/03 ; couture prête
    a.push(o.useResume ? "--resume" : "--session-id", o.sessionId);
    a.push(prompt); // le prompt = DERNIER argument (mesuré)
    return a;
  }

  /** Parse UNE ligne de stream-json (tolérante : une ligne illisible est loggée + ignorée, jamais fatale). */
  private handleLine(
    line: string,
    onDelta: ((c: string) => void) | undefined,
    cbs: { onInit: (apiKeySource?: string) => void; onText: (t: string) => void; onThrottle: (i: ThrottleInfo) => void; onResult: (r: Record<string, unknown>) => void },
  ): void {
    const t = line.trim();
    if (!t) return;
    let o: Record<string, unknown>;
    try { o = JSON.parse(t) as Record<string, unknown>; }
    catch { this.log("canal Claude : ligne stream-json illisible ignorée"); return; }
    const type = o.type as string | undefined;
    if (type === "system" && o.subtype === "init") {
      cbs.onInit(typeof o.apiKeySource === "string" ? o.apiKeySource : undefined); // M1 : la source d'auth réelle (défense A1)
    } else if (type === "assistant") {
      const content = (o.message as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text" && typeof b.text === "string" && b.text.length) {
            cbs.onText(b.text);
            try { onDelta?.(b.text); } catch (e) { this.log(`onDelta: ${(e as Error).message}`); }
          }
        }
      }
    } else if (type === "rate_limit_event") {
      cbs.onThrottle((o.rate_limit_info as ThrottleInfo) ?? {});
    } else if (type === "result") {
      cbs.onResult(o);
    }
  }

  /**
   * Persiste le fil durable (`session_state.claude_session_id`) — DRAPEAU TECHNIQUE (comme `runtime_flags.running`,
   * T6) : la garde A15/SANS_ECRITURE (« ne pas toucher ses souvenirs ») ne le couvre pas → persisté normalement,
   * durable (`synchronous=FULL`). Best-effort : un échec de persistance laisse le fil en mémoire pour ce tour ; au
   * pire un crash ne pourra pas `--resume` → fil frais + filet A13 (`02`) — honnête, jamais un faux « repris ».
   *
   * Pas de garde `isTransaction` ici (contrairement à `writeCleanShutdown`/`createSnapshot`, dont l'écriture est CRITIQUE
   * et DOIT être son propre commit durable) : (a) best-effort — un toggle FULL ignoré ne serait qu'une durabilité NORMAL,
   * pas une corruption ; (b) l'écriture socle est SYNCHRONE (aucun writer n'`await` une transaction ouverte — invariant
   * ⑩/② conv 36/37), donc ce callback `close` ne s'exécute JAMAIS transaction-en-vol → le toggle FULL n'est jamais ignoré.
   * Asymétrie volontaire (NIT fidélité croisé conv 38, tracé §7).
   */
  private persistSessionId(id: string | null): void {
    this.currentId = id; // la mémoire fait foi pour la session en cours, même si la persistance échoue
    try {
      setSynchronous(this.db, "FULL");
      this.db.prepare("UPDATE session_state SET claude_session_id=?, updated_at=? WHERE id=1").run(id, this.now());
    } catch (e) {
      this.log(`canal Claude : persistance du fil échouée (${(e as Error).message}) — repris en mémoire seulement`);
    } finally {
      try { setSynchronous(this.db, "NORMAL"); } catch { /* cosmétique */ }
    }
  }

  private emitError(e: ClaudeError): void {
    this.log(`canal Claude : erreur ${e.kind} — ${e.detail}`);
    try { this.audit.append({ evt: "claude.error", kind: e.kind, ts: this.now() }); } catch { /* AF-10 : le kind, jamais le contenu */ }
    try { this.onError?.(e); } catch (err) { this.log(`onError: ${(err as Error).message}`); } // un consommateur ne fait pas tomber le canal
  }

  private emitThrottle(info: ThrottleInfo): void {
    // Log/audit GARDÉS sur ≠ "allowed" : pas de bruit "allowed" dans l'audit de Sophia (il noierait le vrai throttle).
    // Le CALLBACK, lui, reçoit TOUT (voir la doc de `onThrottle`) — T8 remonte, `05` classe. La classification fine = 05 R5.
    if (info.status && info.status !== "allowed") {
      this.log(`canal Claude : throttle (${info.status})`);
      try { this.audit.append({ evt: "claude.throttle", status: String(info.status), ts: this.now() }); } catch { /* */ }
    }
    try { this.onThrottle?.(info); } catch (err) { this.log(`onThrottle: ${(err as Error).message}`); }
  }
}

/** Première ligne non vide d'un texte (pour un détail d'erreur COURT — jamais un dump ; AF-10 : rien de conversationnel). */
function firstLine(s: string): string {
  const line = s.split("\n").map((l) => l.trim()).find((l) => l.length) ?? "";
  return line.length > 200 ? line.slice(0, 200) : line;
}
