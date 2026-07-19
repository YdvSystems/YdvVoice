// Les chemins de la maison de Sophia (socle T5).
//
// Tout dérive de SOPHIA_HOME. En dev, un HOME jetable sous le repo (plan/00 §2 : « au socle, on peut
// travailler sur un SOPHIA_HOME jetable ; le G:\ de production suit »). La MAISON de production
// (G:\Sophia, disque dédié, chiffré) est une décision de RESSOURCES = plan/05 R0 — pas gravée ici.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** Remonte jusqu'au dossier contenant package.json (racine du repo). */
export function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`racine du repo introuvable (aucun package.json au-dessus de ${start})`);
}

export interface SophiaPaths {
  home: string;
  db: string;
  snapshots: string;
  audit: string;
  /** Flux d'effacements DÉDIÉ, jamais roté (T4/F1) — le témoin de l'alerte-à-la-restauration. */
  erasures: string;
  /** Sentinel DURABLE des alertes-de-restauration non acquittées : re-surfacé à chaque réveil tant
   *  que Yohann n'a pas répondu (une coupure ne doit pas avaler l'alerte AF-1/G-A — MAJEUR conv 35). */
  restorePending: string;
  /** Marqueur de NAISSANCE (`.born`) : écrit une fois au premier boot, PREUVE POSITIVE qu'elle a déjà
   *  vécu. Sa présence interdit une fausse renaissance vierge ; répliqué hors-machine (plan/05), il
   *  survit à la perte conjointe de la base ET des snapshots (MAJEUR 4e tour re-croisé conv 35). */
  born: string;
  sidecarPidfile: string;
  /** Archi 2 process (conv 48) : un pidfile PAR sidecar de rôle — sinon les deux superviseurs se
   *  battraient sur le même fichier (chacun réécrasant la trace de l'autre). Le `sidecarPidfile` mono reste
   *  pour l'E2E-T5 (boot-worker, un seul superviseur). Le reaper d'orphelins (T3) est PAR superviseur. */
  sidecarPidfileEars: string;
  sidecarPidfileMouth: string;
  /** Lockfile AUXILIAIRE (<pid> <nom d'image>) : sert UNIQUEMENT à sonder un primaire figé. */
  instanceLock: string;
  /** Named pipe d'instance unique — l'OS est l'arbitre (T5 Phase 0). */
  instancePipe: string;
}

/**
 * Le nom du pipe est dérivé du HOME, pas fixe. Deux Sophia sur deux maisons différentes (banc jetable
 * vs production) ne se bloquent PAS l'une l'autre : l'unicité protège UN fichier de vérité (l'invariant
 * de technique/00 §5 = une seule instance par base), pas la machine. Un nom global figé rendrait tout
 * banc impossible dès que la vraie Sophia tourne.
 */
function pipeNameFor(home: string): string {
  const h = createHash("sha256").update(path.resolve(home).toLowerCase()).digest("hex").slice(0, 16);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\sophia-${h}`
    : path.join(os.tmpdir(), `sophia-${h}.sock`); // POSIX : socket unix (le socle vise Windows)
}

export function resolvePaths(home?: string): SophiaPaths {
  const root = home ?? process.env.SOPHIA_HOME ?? path.join(findRepoRoot(__dirname), ".sophia-home-dev");
  const abs = path.resolve(root);
  return {
    home: abs,
    db: path.join(abs, "db", "sophia.sqlite"),
    snapshots: path.join(abs, "snapshots"),
    audit: path.join(abs, "audit.jsonl"),
    erasures: path.join(abs, "erasures.log"),
    restorePending: path.join(abs, "restore-pending.json"),
    born: path.join(abs, ".born"),
    sidecarPidfile: path.join(abs, "sidecar.pid"),
    sidecarPidfileEars: path.join(abs, "sidecar-ears.pid"),
    sidecarPidfileMouth: path.join(abs, "sidecar-mouth.pid"),
    instanceLock: path.join(abs, "instance.lock"),
    instancePipe: pipeNameFor(abs),
  };
}
