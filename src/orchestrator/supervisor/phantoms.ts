// Balayage CONVERGENT des sidecars FANTÔMES (conv 56) — le mécanisme du juge (scripts/juge.mjs, conv 52) porté
// dans le PRODUIT, côté app.
//
// POURQUOI : un python qui tient CUDA + micro WASAPI voit son TerminateProcess DIFFÉRÉ par le driver (~15 s,
// parfois plus sous charge) → un cycle de dev interrompu (juge tué brutalement, boots ratés répétés — la soirée
// conv 55 « l'app rame à mort ») laisse des sidecars MOURANTS qui tiennent la VRAM et contendent avec la session
// suivante. L'app Electron a un Job Object (SES sidecars meurent avec elle) — mais elle PARTAGE la machine avec le
// juge (script node NU, pas de Job Object) et les cycles interrompus : au boot, elle balaie ce qui traîne.
//
// POLITIQUE (fail-safe, jamais fatale — l'app démarre TOUJOURS, au pire comme avant) :
//   · un JUGE VIVANT → on ne balaie RIEN (ses sidecars sont légitimes ; symétrique du refus du juge quand l'app
//     tourne). L'app démarre quand même — les deux se battront pour le GPU, mais on ne tue jamais un innocent.
//   · sinon : tout `python server.py` portant le jeton du repo + tout WarmBrain (`claude.exe` signature persona)
//     est un ORPHELIN par construction (l'app n'a pas encore spawné les siens ; le juge est absent) → kill
//     CONVERGENT (census → kill → délai, jusqu'à 0 — la mort CUDA différée fait survivre un kill unique).
//   · PowerShell indisponible → best-effort, on n'empêche pas le boot.
//
// ⚠ Les SIGNATURES de recensement (cmdline) sont le miroir de celles du juge (scripts/juge.mjs `census()`) —
// les tenir EN PHASE si l'une évolue (jeton repo = basename du dossier, persona = extrait du VOICE_SYSPROMPT).
//
// Module Node pur ; `ops` injectable (couture, patron du socle) → la politique de convergence est testée
// déterministe SANS PowerShell ni vrais process (tests/u-phantoms.mjs).

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/** Recensement par CLASSE (PIDs). `juges` = scripts/juge.mjs vivants ; `warm` = process cerveau (persona) ;
 *  `sidecars` = python server.py du repo. Null = PowerShell indisponible (best-effort). */
export interface PhantomCensus {
  juges: number[];
  warm: number[];
  sidecars: number[];
}

/** Couture d'exécution (injectable pour les tests ; défaut = PowerShell réel). */
export interface PhantomOps {
  census(): Promise<PhantomCensus | null>;
  kill(pids: number[]): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface SweepOptions {
  /** Jeton d'identité du repo (basename du dossier, ex. « YdvVoice ») — présent dans la cmdline des sidecars. */
  repoToken: string;
  onLog?: (l: string) => void;
  /** Passes de convergence (défaut 24 ; chaque passe = kill PS + délai 750 ms + census PS → pire cas réel
   *  ~1-2 min si des survivants s'accrochent, N-1 croisé conv 56 — le cas nominal « 0 fantôme » = 1 census ~1-2 s). */
  tries?: number;
  delayMs?: number;
  ops?: PhantomOps;
}

export interface SweepResult {
  outcome: "clean" | "swept" | "skipped-juge" | "no-powershell" | "survivors";
  /** PIDs distincts sur lesquels un kill a été tenté. */
  killed: number[];
  /** PIDs encore vivants à l'épuisement du budget (outcome "survivors"). */
  survivors: number[];
}

/** M-3 (croisé conv 56) : DEADLINE obligatoire — un PowerShell/WMI figé (dépôt corrompu, panne Windows connue) ne
 *  doit JAMAIS suspendre le boot pour toujours (« l'app démarre TOUJOURS »). Au timeout : kill + null → la route
 *  « no-powershell » (best-effort) reprend. Tout le projet porte des deadlines (F-A, R-1, waitReady) — celle-ci aussi. */
function psRun(cmd: string, timeoutMs = 15000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      let buf = "";
      let done = false;
      const finish = (v: string | null): void => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true });
      const timer = setTimeout(() => { try { ps.kill(); } catch { /* */ } finish(null); }, timeoutMs);
      ps.stdout.on("data", (d: Buffer) => { buf += String(d); });
      ps.stderr?.on("data", () => { /* drain (borne pipe 64 Ko) — le diagnostic vit dans le log du sweep */ });
      ps.on("close", () => finish(buf));
      ps.on("error", () => finish(null));
    } catch {
      resolve(null);
    }
  });
}

/** Ops réelles (PowerShell). 1 appel → les PIDs par classe (snapshot pur — la POLITIQUE vit dans le sweep). */
export function realPhantomOps(repoToken: string): PhantomOps {
  return {
    async census(): Promise<PhantomCensus | null> {
      const cmd = [
        `function P($n,$l){@(Get-CimInstance Win32_Process -Filter "Name='$n'" | Where-Object { $_.CommandLine -like $l } | ForEach-Object { $_.ProcessId })}`,
        // M-2 (croisé conv 56) : `?` (-like = 1 caractère) accepte `/` ET `\` — un juge lancé `node .\scripts\juge.mjs`
        // (tab-complétion PowerShell) doit être VU, sinon l'app tuerait ses sidecars en pleine session de mesure.
        `$j=@(P 'node.exe' '*scripts?juge.mjs*')`,              // juge vivant ? (on ne touche pas à ses sidecars)
        `$w=@(P 'claude.exe' '*assistant vocal francophone*')`, // WarmBrain orphelin (signature persona — jamais Claude Code)
        `$s=@(P 'python.exe' '*${repoToken}*server.py*')`,      // sidecars du repo
        `Write-Output ("J " + ($j -join ' '))`,
        `Write-Output ("W " + ($w -join ' '))`,
        `Write-Output ("S " + ($s -join ' '))`,
      ].join("; ");
      const out = await psRun(cmd);
      if (out == null) return null;
      const pick = (tag: string): number[] => {
        const line = out.split(/\r?\n/).find((l) => l.startsWith(tag + " "));
        return line ? line.slice(2).trim().split(/\s+/).map((x) => parseInt(x, 10)).filter(Number.isFinite) : [];
      };
      return { juges: pick("J"), warm: pick("W"), sidecars: pick("S") };
    },
    async kill(pids: number[]): Promise<void> {
      if (!pids.length) return;
      await psRun(`Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`);
    },
    sleep: (ms: number) => sleep(ms),
  };
}

/** Balaye les fantômes AVANT de spawner ses propres sidecars (appelé par le hook `sidecarStart` du runtime,
 *  côté audio réel seulement). Convergent, fail-safe, JAMAIS fatal. Voir la politique en tête de fichier. */
export async function sweepPhantomSidecars(opts: SweepOptions): Promise<SweepResult> {
  const log = (l: string): void => { try { opts.onLog?.(l); } catch { /* un logger qui lève ne casse jamais le boot */ } };
  const ops = opts.ops ?? realPhantomOps(opts.repoToken);
  const tries = opts.tries ?? 24;
  const delayMs = opts.delayMs ?? 750;
  const killed = new Set<number>();
  try {
    const first = await ops.census();
    if (first == null) return { outcome: "no-powershell", killed: [], survivors: [] }; // best-effort : on ne bloque pas le boot
    if (first.juges.length) {
      log(`balayage fantômes : un juge tourne (PID ${first.juges.join(", ")}) → je ne touche à rien (ses sidecars sont légitimes)`);
      return { outcome: "skipped-juge", killed: [], survivors: [] };
    }
    let phantoms = [...first.sidecars, ...first.warm];
    if (!phantoms.length) return { outcome: "clean", killed: [], survivors: [] };
    log(`balayage fantômes : ${phantoms.length} sidecar(s)/cerveau(x) orphelin(s) détecté(s) → nettoyage convergent (mort CUDA différée)…`);
    for (let i = 0; i < tries; i++) {
      for (const p of phantoms) killed.add(p);
      await ops.kill(phantoms);
      await ops.sleep(delayMs);
      const c = await ops.census();
      if (c == null) return { outcome: "no-powershell", killed: [...killed], survivors: [] }; // PowerShell parti en route : best-effort
      // M-1 (croisé conv 56) : re-vérifier le juge À CHAQUE passe, pas seulement au census initial — un juge qui
      // DÉMARRE pendant la convergence spawne ses 2 sidecars, que la passe suivante prendrait pour des fantômes
      // (kill en rafale en pleine session de mesure). Dès qu'un juge apparaît : on s'arrête net.
      if (c.juges.length) {
        log(`balayage fantômes : un juge vient de démarrer (PID ${c.juges.join(", ")}) → j'arrête le balayage (ses sidecars sont légitimes)`);
        return { outcome: "skipped-juge", killed: [...killed], survivors: [] };
      }
      phantoms = [...c.sidecars, ...c.warm];
      if (!phantoms.length) {
        log(`balayage fantômes : propre (${killed.size} tué(s) en ${i + 1} passe(s))`);
        return { outcome: "swept", killed: [...killed], survivors: [] };
      }
    }
    log(`balayage fantômes : ${phantoms.length} survivant(s) après ${tries} passes (PID ${phantoms.join(", ")}) — je démarre quand même (contention possible)`);
    return { outcome: "survivors", killed: [...killed], survivors: phantoms };
  } catch (e) {
    log(`balayage fantômes : erreur non fatale (${(e as Error)?.message ?? String(e)}) — je démarre quand même`);
    return { outcome: "no-powershell", killed: [...killed], survivors: [] };
  }
}
