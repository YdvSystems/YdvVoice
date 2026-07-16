// Durabilité & récupération (socle T4) — traduit technique/00 §Durabilité (les 6 garanties).
//
// Snapshots atomiques (VACUUM INTO -> fsync -> renommage atomique, rotation garder N), avec un
// « repère de crue » (dernier effacement connu) pour l'alerte-à-la-restauration de T5. Contrôles
// d'intégrité (quick_check au boot, integrity_check au dimanche). Réglage `synchronous`
// (FULL autour des écritures d'identité, NORMAL pour le trafic fréquent).

import type { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

// (L'ordre des snapshots vient d'une SÉQUENCE MONOTONE dérivée du disque — seqOf/nextSeq, m7 —
//  jamais de l'horloge : un recul NTP ne peut donc pas fausser le tri ni la rotation.)

export function setSynchronous(db: DatabaseSync, mode: "FULL" | "NORMAL"): void {
  db.exec(`PRAGMA synchronous = ${mode};`);
}

/**
 * Porte d'intégrité. Retourne TOUJOURS un verdict — ne jette jamais (T5 en dépend pour choisir sa
 * branche de récupération ; une exception ici ferait tomber le boot au lieu de restaurer).
 *
 * MESURÉ au banc (conv 35), contre l'attente : sur une corruption RÉELLE (pages écrasées), le PRAGMA
 * ne « retourne » pas des lignes d'erreur — il JETTE (« database disk image is malformed »). La v1 de
 * cette fonction (.all() nu) propageait donc l'exception. Le cas « lignes d'erreur retournées » existe
 * aussi (corruption d'index détectable sans malformation) -> les DEUX sont traités.
 */
export function integrityCheck(db: DatabaseSync, mode: "quick" | "full"): { ok: boolean; detail: string } {
  const pragma = mode === "quick" ? "quick_check" : "integrity_check";
  try {
    const rows = db.prepare(`PRAGMA ${pragma}`).all() as Array<Record<string, unknown>>;
    const detail = rows.map((r) => String(Object.values(r)[0])).join("; ");
    return { ok: detail === "ok", detail };
  } catch (e) {
    return { ok: false, detail: (e as Error).message }; // « malformed », « file is not a database »...
  }
}

/** Repère de crue : le dernier effacement connu au moment du snapshot (source = le flux d'effacements). */
export interface CrueMark {
  id: number;
  ts: number;
}

/** Numéro de séquence encodé dans un nom `snapshot-<seq>.sqlite`, ou -1 si le nom ne correspond pas. */
function seqOf(filename: string): number {
  const m = filename.match(/^snapshot-(\d+)\.sqlite$/);
  return m ? parseInt(m[1], 10) : -1;
}

/** Snapshots triés par SÉQUENCE numérique croissante (pas lexicale) : robuste à toute largeur. */
function listSnapshots(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => seqOf(f) >= 0).sort((a, b) => seqOf(a) - seqOf(b));
}

/**
 * Prochaine séquence = (max des séquences présentes sur le disque) + 1. MONOTONE indépendamment de
 * l'horloge (m7) : un recul NTP/manuel ne peut plus faire trier un snapshot récent AVANT un ancien,
 * ni faire effacer le plus frais à la rotation. Le timestamp ne sert qu'à titre informatif (meta).
 */
function nextSeq(dir: string): number {
  let max = -1;
  try {
    for (const f of fs.readdirSync(dir)) { const s = seqOf(f); if (s > max) max = s; }
  } catch { /* dossier absent -> première séquence */ }
  return max + 1;
}

function cleanStaleTemps(dir: string): void {
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(".snapshot-") && f.endsWith(".tmp")) {
      try { fs.rmSync(path.join(dir, f)); } catch { /* */ }
    }
  }
}

function rotateSnapshots(dir: string, keepN: number): void {
  const snaps = listSnapshots(dir); // ordre par SÉQUENCE croissante = du plus ancien au plus récent
  for (const s of snaps.slice(0, Math.max(0, snaps.length - keepN))) {
    try { fs.rmSync(path.join(dir, s)); } catch { /* */ }
    try { fs.rmSync(path.join(dir, `${s}.meta.json`)); } catch { /* */ }
  }
}

/**
 * Snapshot atomique de la base. Un snapshot n'existe pas pour dormir : il sert à RESTAURER (T5).
 * Le renommage est le point de commit : une coupure *pendant* laisse le snapshot précédent intact.
 */
export function createSnapshot(db: DatabaseSync, snapshotDir: string, keepN: number, crue: CrueMark | null): string {
  // N4 : VACUUM INTO ne peut PAS tourner dans une transaction ouverte (SQLite le refuse) et bloque la
  // connexion le temps de la copie -> l'ordonnanceur (T5/T7) doit l'appeler HORS transaction. Garde
  // explicite : échec clair et précoce plutôt qu'une erreur SQLite cryptique en pleine copie.
  if (db.isTransaction) {
    throw new Error("createSnapshot : une transaction est ouverte -> VACUUM INTO impossible (appeler hors transaction, N4)");
  }
  fs.mkdirSync(snapshotDir, { recursive: true });
  cleanStaleTemps(snapshotDir); // un temp résiduel d'un crash ne remplace jamais un bon snapshot
  const seqNum = nextSeq(snapshotDir);
  const seq = String(seqNum).padStart(10, "0");
  const tmp = path.join(snapshotDir, `.snapshot-${seq}.tmp`);
  const final = path.join(snapshotDir, `snapshot-${seq}.sqlite`);

  const target = tmp.replace(/\\/g, "/").replace(/'/g, "''"); // chemin en slashs, apostrophes échappées
  db.exec(`VACUUM INTO '${target}'`); // copie cohérente et compacte (pas une copie brute)

  const fd = fs.openSync(tmp, "r+");
  fs.fsyncSync(fd); // durable AVANT le renommage
  fs.closeSync(fd);
  fs.renameSync(tmp, final); // renommage atomique = le commit

  // Le repère de crue est AUXILIAIRE : le point de commit du snapshot est le rename ci-dessus.
  // Il est écrit APRÈS, en fichier séparé -> un crash entre le rename et cette écriture laisse un
  // snapshot valide SANS repère. C'est SÛR par le fail-safe de T5 (couture plan/05 G-A) : un snapshot
  // dont le .meta.json est absent/illisible DOIT être traité comme « repère absent » -> ALERTE-à-la-
  // restauration, jamais un pass silencieux. On fsync le meta pour le durcir une fois écrit.
  const metaPath = `${final}.meta.json`;
  fs.writeFileSync(metaPath, JSON.stringify({ crue, ts: Date.now(), seq: seqNum }));
  const mfd = fs.openSync(metaPath, "r+");
  fs.fsyncSync(mfd);
  fs.closeSync(mfd);

  rotateSnapshots(snapshotDir, keepN);
  return final;
}

/** Le plus récent snapshot complet (le point de départ d'une restauration en T5), ou null. */
export function latestSnapshot(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const snaps = listSnapshots(dir);
  return snaps.length ? path.join(dir, snaps[snaps.length - 1]) : null;
}

/**
 * Tous les snapshots, du PLUS RÉCENT au plus ancien (ordre par séquence monotone, m7).
 * T5 en a besoin pour trouver le dernier **bon** : le plus récent peut être lui-même illisible
 * (secteur mort), et un snapshot plus ancien vaut infiniment mieux qu'aucune mémoire.
 */
export function listSnapshotsNewestFirst(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return listSnapshots(dir).reverse().map((f) => path.join(dir, f));
}
