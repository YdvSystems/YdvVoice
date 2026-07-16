// Restauration d'un snapshot + alerte-à-la-restauration (socle T5) — traduit plan/00 T5 Phase 1.
//
// « Un snapshot n'existe pas pour dormir : il sert à RESTAURER. » C'est ici que le chemin de
// récupération rejoint le chemin de boot (technique/00 §Durabilité, garantie 6).
//
// L'ENJEU N'EST PAS MÉCANIQUE. Restaurer, c'est REMBOBINER la mémoire de Sophia — donc, peut-être,
// faire revenir un souvenir que Yohann lui avait demandé d'oublier. L'effacement est souverain : un
// contenu effacé ne ressuscite JAMAIS en douce. Comme la base restaurée ne peut pas savoir ce qui a
// été effacé APRÈS elle, le témoin vit HORS de la base : le flux d'effacements dédié, append-only,
// jamais roté (T4/F1), répliqué hors-machine indépendamment (plan/05).
//
// Trois obligations gravées par les audits, toutes réalisées ici — et toutes du même côté : DANS LE
// DOUTE, ON ALERTE. Un pass silencieux est le seul échec inacceptable.
//   · AF-1  (audit Fable)      : effacements postérieurs au snapshot -> alerte honnête.
//   · G-A   (croisé ciblé c20) : témoin absent / en retard sur le repère de crue -> alerte (fail-open débusqué).
//   · fid4  (re-croisé c34)    : .meta.json absent/illisible -> « repère absent » -> alerte.

import * as fs from "node:fs";
import * as path from "node:path";
import { integrityCheck, listSnapshotsNewestFirst } from "../db/durability.js";
import { openDatabase } from "../db/index.js";
import { ErasureStream } from "../audit/index.js";
import type { CrueMark } from "../db/durability.js";

export type RestoreAlertCode =
  | "CRUE_ABSENTE"                  // fid4
  | "TEMOIN_ABSENT"                 // G-A
  | "TEMOIN_CORROMPU"               // m10 (ErasureStream.readAll jette)
  | "TEMOIN_EN_RETARD"              // G-A
  | "EFFACEMENT_PEUT_ETRE_REVENU";  // AF-1

export interface RestoreAlert {
  code: RestoreAlertCode | "SENTINEL_ILLISIBLE";
  /** Formulé pour être DIT à Yohann (systray + voix) — jamais un code d'erreur nu. */
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Le SENTINEL DURABLE des alertes non acquittées (MAJEUR conv 35).
//
// Le trou que ceci ferme : `checkErasureCoverage` produit l'alerte AF-1/G-A, mais si elle n'existait
// qu'en mémoire (systray du process courant), une coupure ENTRE le commit de la restauration et le
// surfaçage de l'alerte la perdrait — et au réveil suivant la base est SAINE, donc la branche de
// restauration (seul endroit qui vérifie la couverture) est sautée : l'effacement ressusciterait en
// SILENCE. On rend donc l'alerte durable AVANT le commit, et on la re-surface à CHAQUE réveil tant que
// Yohann ne l'a pas acquittée. « Dans le doute, on alerte » doit survivre à une coupure, comme le témoin.
// ─────────────────────────────────────────────────────────────────────────────

/** Lit les alertes en attente d'un réveil antérieur. Un sentinel ILLISIBLE alerte (jamais un silence). */
export function readRestorePending(sentinelPath: string): RestoreAlert[] {
  if (!fs.existsSync(sentinelPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(sentinelPath, "utf8")) as unknown;
    // On exige la FORME complète, pas seulement un JSON parseable : un `{}`, `{alerts:null}` ou un
    // `{alerts:[1,2]}` (JSON valide mais mal formé) ne doit PAS se lire en [] = silence (re-croisé conv 35).
    const alerts = (parsed && typeof parsed === "object" && Array.isArray((parsed as { alerts?: unknown }).alerts))
      ? (parsed as { alerts: unknown[] }).alerts
      : null;
    if (alerts && alerts.every((a) => a !== null && typeof a === "object"
      && typeof (a as RestoreAlert).code === "string" && typeof (a as RestoreAlert).message === "string")) {
      return alerts as RestoreAlert[];
    }
    throw new Error("sentinel mal formé"); // -> SENTINEL_ILLISIBLE (jamais un silence)
  } catch {
    // Illisible OU mal formé : on ne sait pas ce qu'il contenait -> on alerte quand même (acquittable via ack).
    return [{ code: "SENTINEL_ILLISIBLE", message: "Une restauration récente n'a pas été confirmée et je n'arrive plus à relire ce que j'avais à te signaler : dis-moi ce que je devais oublier, par précaution." }];
  }
}

/** Ajoute des alertes au sentinel (fusion par code : une alerte par type de doute), durable (fsync). */
export function writeRestorePending(sentinelPath: string, newAlerts: RestoreAlert[]): void {
  if (newAlerts.length === 0) return;
  const byCode = new Map<string, RestoreAlert>();
  for (const a of readRestorePending(sentinelPath)) byCode.set(a.code, a); // garde les anciennes non acquittées
  for (const a of newAlerts) byCode.set(a.code, a);                        // le message le plus récent gagne
  fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
  const tmp = `${sentinelPath}.tmp`;
  try { fs.rmSync(tmp, { force: true }); } catch { /* */ } // un .tmp d'un crash précédent ne traîne pas
  fs.writeFileSync(tmp, JSON.stringify({ alerts: [...byCode.values()] }));
  const fd = fs.openSync(tmp, "r+");
  fs.fsyncSync(fd); // durable AVANT le rename : l'alerte survit à une coupure post-écriture
  fs.closeSync(fd);
  fs.renameSync(tmp, sentinelPath); // rename atomique = le point de commit de l'alerte
}

/** Efface le sentinel — geste d'ACQUITTEMENT (une couche aval l'appelle quand Yohann a répondu). */
export function acknowledgeRestorePending(sentinelPath: string): void {
  try { fs.rmSync(sentinelPath, { force: true }); } catch { /* absent */ }
}

/**
 * Vérifie la couverture d'effacements d'un snapshot restauré. Retourne les alertes à porter à Yohann.
 * Un tableau VIDE est le seul silence légitime — et il exige un témoin lisible ET à jour.
 */
export function checkErasureCoverage(snapshotPath: string, erasureLogPath: string): RestoreAlert[] {
  const alerts: RestoreAlert[] = [];

  // 1) Le repère de crue (fid4). Écrit APRÈS le rename atomique du snapshot -> un crash entre les deux
  //    laisse un snapshot VALIDE sans repère. Ce n'est pas une raison de passer : c'est une raison d'alerter.
  let crue: CrueMark | null = null;
  let crueLisible = false;
  try {
    const meta = JSON.parse(fs.readFileSync(`${snapshotPath}.meta.json`, "utf8")) as { crue?: CrueMark | null };
    crueLisible = true;
    crue = meta.crue ?? null; // `crue:null` LISIBLE = « aucun effacement n'avait jamais eu lieu » : légitime,
    // et TRÈS différent d'un meta absent. Ne pas confondre les deux est tout l'objet de `crueLisible`.
  } catch {
    alerts.push({
      code: "CRUE_ABSENTE",
      message: "Je viens de restaurer une sauvegarde, mais je n'ai pas retrouvé son repère : je ne peux pas te garantir qu'aucun souvenir effacé n'est revenu. Redis-moi ce que je devais oublier.",
    });
  }

  // 2) Le témoin lui-même. Absent = le cas du restore-catastrophe où le réplica hors-machine n'a pas
  //    été remis à son chemin local AVANT le boot (plan/05 R0, versant RESTORE). Sans ce fail-safe, un
  //    témoin absent se lirait « zéro effacement trouvé » = pass silencieux = résurrection silencieuse.
  //
  //    FAIL-SAFE ASSUMÉ (et non un oubli) : on alerte MÊME si la crue dit « aucun effacement n'avait
  //    jamais eu lieu ». Un fichier absent a deux causes INDISTINGUABLES — jamais créé (bénin) ou perdu
  //    au restore (grave) — et les coûts ne se comparent pas : une phrase inquiète pour rien, lors d'un
  //    événement déjà exceptionnel, contre un souvenir que Yohann voulait mort qui revient en silence.
  //    Un témoin PRÉSENT ET VIDE, lui, prouve qu'il est en place et n'a rien à dire -> silence légitime.
  if (!fs.existsSync(erasureLogPath)) {
    alerts.push({
      code: "TEMOIN_ABSENT",
      message: "Je viens de restaurer une sauvegarde et je ne retrouve pas la trace de ce que tu m'as demandé d'oublier : des souvenirs effacés sont peut-être revenus. Redis-moi ce que je devais oublier.",
    });
    return alerts; // rien de plus à comparer : le doute est déjà porté
  }

  let records;
  try {
    records = new ErasureStream(erasureLogPath).readAll(); // jette si une ligne INTERNE est illisible (m10)
  } catch (e) {
    alerts.push({
      code: "TEMOIN_CORROMPU",
      message: `Je viens de restaurer une sauvegarde et la trace de mes effacements est abîmée (${(e as Error).message}) : je ne peux pas te garantir qu'aucun souvenir effacé n'est revenu. Redis-moi ce que je devais oublier.`,
    });
    return alerts;
  }

  // 3) Confrontation témoin <-> repère.
  if (crueLisible && crue) {
    const maxId = records.reduce((m, r) => Math.max(m, r.id), -1);
    if (maxId < crue.id) {
      // Le témoin ne porte même pas les effacements que la base connaissait DÉJÀ au snapshot : il est
      // en retard (réplica ancien, restauration partielle) -> son silence sur la suite ne vaut rien.
      alerts.push({
        code: "TEMOIN_EN_RETARD",
        message: "Je viens de restaurer une sauvegarde et ma trace des effacements est plus ancienne qu'elle : elle ne peut pas me dire ce que j'ai oublié depuis. Redis-moi ce que je devais oublier.",
      });
      return alerts;
    }
    if (!records.some((r) => r.id === crue.id)) {
      // Le repère existe mais son enregistrement manque au témoin -> trou. Même conclusion : le témoin
      // n'est pas fiable, donc son « rien après » n'est pas une preuve.
      alerts.push({
        code: "TEMOIN_EN_RETARD",
        message: "Je viens de restaurer une sauvegarde et ma trace des effacements a un trou : je ne peux pas te garantir qu'aucun souvenir effacé n'est revenu. Redis-moi ce que je devais oublier.",
      });
      return alerts;
    }
  }

  // 4) AF-1 — des effacements POSTÉRIEURS au snapshot restauré : leur contenu est peut-être revenu.
  //    (crue absente/nulle -> tout enregistrement du témoin est postérieur par construction.)
  const seuil = crueLisible && crue ? crue.id : -1;
  const posterieurs = records.filter((r) => r.id > seuil);
  if (posterieurs.length > 0) {
    alerts.push({
      code: "EFFACEMENT_PEUT_ETRE_REVENU",
      message: `Je viens de restaurer une sauvegarde antérieure à ${posterieurs.length} effacement(s) que tu m'avais demandé(s) : un souvenir que je devais oublier est peut-être revenu. Redis-moi quoi oublier.`,
    });
  }
  return alerts;
}

export interface RestoreResult {
  restored: boolean;
  snapshotUsed: string | null;
  archivedTo: string | null;
  alerts: RestoreAlert[];
  detail: string;
  /** Snapshots plus récents écartés parce qu'illisibles (à DIRE : on a perdu plus que le strict minimum). */
  skipped: number;
}

/** Combien d'archives de bases douteuses garder (elles ne sont JAMAIS détruites à la restauration, mais
 *  sur « des années » avec un disque mourant elles croîtraient sans borne). Rotation par index, m7. */
const KEEP_CORRUPT_ARCHIVES = 10;

function rotateCorruptArchives(dbPath: string, keep: number, log?: (l: string) => void): void {
  const dir = path.dirname(dbPath);
  const base = `${path.basename(dbPath)}.corrupt-`;
  let idxs: number[] = [];
  try {
    idxs = fs.readdirSync(dir)
      .map((f) => (f.startsWith(base) && !f.slice(base.length).includes("-") ? parseInt(f.slice(base.length), 10) : NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b); // du plus ancien au plus récent (index monotone)
  } catch { return; }
  const survivants = new Set(idxs.slice(Math.max(0, idxs.length - keep))); // les `keep` plus récents à garder
  for (const i of idxs.slice(0, Math.max(0, idxs.length - keep))) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(`${dbPath}.corrupt-${i}${suffix}`, { force: true }); } catch { /* */ }
    }
    log?.(`archive de base douteuse .corrupt-${i} purgée (rotation garder ${keep})`);
  }
  // NIT re-croisé conv 35 : purger AUSSI les `-wal`/`-shm` d'archive ORPHELINS (index dont le fichier
  // principal `.corrupt-N` n'existe pas et n'est pas dans les survivants) — sinon un `-wal` traînant
  // déplacé vers un slot d'archive quand aucune base principale n'y était s'accumulerait sans borne.
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp(`^${base.replace(/[.\\]/g, "\\$&")}(\\d+)(?:-wal|-shm)$`));
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      if (survivants.has(idx)) continue;                                   // rattaché à une archive gardée
      if (fs.existsSync(`${dbPath}.corrupt-${idx}`)) continue;             // le principal existe -> pas orphelin
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* */ }
    }
  } catch { /* dossier absent */ }
}

/**
 * Le dernier **BON** snapshot — pas le dernier tout court (plan/00 T5 : « restauration auto du dernier
 * bon snapshot »). Le plus récent peut être illisible (secteur mort, coupure pendant le VACUUM d'une
 * version antérieure du code) : on remonte alors le temps jusqu'au premier qui s'ouvre ET passe
 * l'intégrité. Un snapshot plus ancien vaut infiniment mieux qu'aucune mémoire.
 * Sonde en LECTURE SEULE : on ne mute jamais un snapshot pour le juger (m9).
 */
export function findGoodSnapshot(snapshotDir: string): { good: string | null; skipped: number } {
  let skipped = 0;
  for (const cand of listSnapshotsNewestFirst(snapshotDir)) {
    try {
      const probe = openDatabase(cand, { readOnly: true });
      try {
        if (integrityCheck(probe.raw, "quick").ok) return { good: cand, skipped };
      } finally {
        try { probe.close(); } catch { /* */ }
      }
    } catch { /* illisible : candidat suivant */ }
    skipped++;
  }
  return { good: null, skipped };
}

/**
 * Écarte les `-wal`/`-shm` résiduels de l'ancienne base (déplacés à côté de l'archive, sinon supprimés).
 * Retourne le suffixe SURVIVANT s'il a résisté au déplacement ET à la suppression (locker externe), null
 * sinon. Un survivant est fatal : SQLite le rejouerait sur la base restaurée (R1).
 */
export function evacuateSidecarFiles(dbPath: string, archive: string): string | null {
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${dbPath}${suffix}`;
    if (fs.existsSync(side)) {
      try { fs.renameSync(side, `${archive}${suffix}`); }
      catch { try { fs.rmSync(side, { force: true }); } catch { /* */ } } // JAMAIS le laisser à côté de la base restaurée
    }
  }
  return ["-wal", "-shm"].find((s) => fs.existsSync(`${dbPath}${s}`)) ?? null;
}

/** Prochain index d'archive libre — dérivé du DISQUE, jamais de l'horloge (patron m7 de T4). */
function nextArchiveIndex(dbPath: string): number {
  const dir = path.dirname(dbPath);
  const base = `${path.basename(dbPath)}.corrupt-`;
  let max = -1;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(base)) continue;
      const n = parseInt(f.slice(base.length).split("-")[0], 10); // ...corrupt-3 / ...corrupt-3-wal
      if (Number.isFinite(n) && n > max) max = n;
    }
  } catch { /* dossier absent */ }
  return max + 1;
}

/**
 * Restaure le dernier bon snapshot par-dessus la base.
 *
 * La base douteuse est ARCHIVÉE (jamais détruite au moment de la restauration — elle peut être la seule
 * trace d'un souvenir, et détruire des données de Sophia sur une heuristique serait ce qu'on refuse
 * partout). Les archives sont CONSERVÉES mais BORNÉES à KEEP_CORRUPT_ARCHIVES (rotation, sinon un disque
 * mourant les accumulerait sans fin sur « des années ») — la purge ne touche que les plus anciennes.
 *
 * POINT CRITIQUE — les -wal/-shm de l'ancienne base sont emportés avec elle. Un -wal résiduel à côté
 * d'une base restaurée serait rejoué PAR-DESSUS elle à la première ouverture : on aurait « restauré »
 * une base pour la re-corrompre aussitôt, en silence.
 *
 * L'appelant doit avoir FERMÉ toute poignée sur dbPath.
 */
export interface RestoreOptions {
  log?: (l: string) => void;
  /** Couture de test (R1) : évacuation des -wal/-shm. Défaut = la vraie. Force un survivant en test. */
  _evacuate?: (dbPath: string, archive: string) => string | null;
}

export function restoreLatestSnapshot(
  dbPath: string,
  snapshotDir: string,
  erasureLogPath: string,
  restorePendingPath: string,
  opts: RestoreOptions = {},
): RestoreResult {
  const log = opts.log;
  const evacuate = opts._evacuate ?? evacuateSidecarFiles;
  const { good: snap, skipped } = findGoodSnapshot(snapshotDir);
  if (!snap) {
    return {
      restored: false, snapshotUsed: null, archivedTo: null, alerts: [], skipped,
      detail: skipped > 0 ? `${skipped} snapshot(s) présent(s) mais aucun n'est lisible` : "aucun snapshot disponible",
    };
  }

  const idx = nextArchiveIndex(dbPath);
  const archive = `${dbPath}.corrupt-${idx}`;
  let archivedTo: string | null = null;
  if (fs.existsSync(dbPath)) {
    fs.renameSync(dbPath, archive);
    archivedTo = archive;
  }

  // GARDE (R1, croisé conv 35) : si un -wal/-shm résiduel RÉSISTE au déplacement ET à la suppression
  // (locker externe : antivirus, indexeur Windows), on N'INSTALLE PAS par-dessus. SQLite rejouerait ce
  // WAL empoisonné sur la base restaurée -> re-corruption SILENCIEUSE. On abandonne + on le dit ; la base
  // reste absente (archivée) -> le réveil suivant re-tentera quand le locker aura lâché (auto-cicatrisant).
  const survivant = evacuate(dbPath, archive);
  if (survivant) {
    return {
      restored: false, snapshotUsed: null, archivedTo, alerts: [], skipped,
      detail: `un journal résiduel (${survivant}) est verrouillé et n'a pu être écarté — restauration abandonnée pour ne pas re-corrompre`,
    };
  }

  // L'alerte-à-la-restauration est calculée et rendue DURABLE **avant** le commit (rename) : le snapshot
  // et le témoin existent déjà, elle ne dépend pas de la base restaurée. Ainsi une coupure entre le
  // commit et le surfaçage ne l'avale pas — le sentinel la re-surfacera au réveil suivant (MAJEUR conv 35).
  const alerts = checkErasureCoverage(snap, erasureLogPath);
  writeRestorePending(restorePendingPath, alerts);

  // Copie -> fsync -> renommage atomique : une coupure ici ne laisse pas une demi-base en place.
  // (N1, limite plateforme assumée §7 : le fsync du RÉPERTOIRE n'a pas d'équivalent Node-sur-Windows.)
  const tmp = `${dbPath}.restoring`;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try { fs.rmSync(tmp, { force: true }); } catch { /* */ }
  fs.copyFileSync(snap, tmp);
  const fd = fs.openSync(tmp, "r+");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, dbPath); // LE COMMIT

  rotateCorruptArchives(dbPath, KEEP_CORRUPT_ARCHIVES, log);
  return {
    restored: true,
    snapshotUsed: snap,
    archivedTo,
    alerts,
    skipped,
    detail: `restauré depuis ${path.basename(snap)}${skipped > 0 ? ` (${skipped} snapshot(s) plus récent(s) illisible(s), écarté(s))` : ""}${archivedTo ? ` · base douteuse archivée en ${path.basename(archive)}` : ""}`,
  };
}
