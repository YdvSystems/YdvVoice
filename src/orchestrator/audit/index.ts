// Journaux append-only (socle T4).
//
// - AuditLog : trace JSONL append-only, ROTÉE (taille/âge). Invariant AF-10 : ne porte JAMAIS de
//   contenu conversationnel — uniquement des traces / compteurs / événements (hors de portée de
//   l'effacement souverain ; un verbatim qui y fuirait serait un résidu ineffaçable).
// - ErasureStream : flux d'effacements DÉDIÉ, append-only, JAMAIS roté (croisé Opus conv 18, F1).
//   C'est le témoin HORS-BASE de l'alerte-à-la-restauration (T5) ; fsync avant que la transaction
//   d'effacement ne commit ; à répliquer hors-machine indépendamment (plan/05).
//
// Les deux tolèrent une dernière ligne tronquée en lecture (coupure en plein append).

import * as fs from "node:fs";
import * as path from "node:path";

function appendLine(filePath: string, obj: unknown, fsync: boolean): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Si le fichier ne finit pas par un saut de ligne (crash en plein append), en préfixer un :
  // la ligne tronquée reste isolée, le nouvel enregistrement n'est pas concaténé dessus.
  let prefix = "";
  try {
    const st = fs.statSync(filePath);
    if (st.size > 0) {
      const fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, st.size - 1);
      fs.closeSync(fd);
      if (buf[0] !== 0x0a) prefix = "\n";
    }
  } catch { /* absent */ }
  fs.appendFileSync(filePath, `${prefix}${JSON.stringify(obj)}\n`);
  if (fsync) {
    const fd = fs.openSync(filePath, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  }
}

// AF-10 : le JSONL d'audit ne porte JAMAIS de contenu conversationnel (un verbatim qui y fuirait
// serait un résidu INEFFAÇABLE — le fichier est append-only, roté, hors de portée de l'effacement
// souverain). On ne peut pas *prouver* un négatif ; on POSE une garde défensive : un enregistrement
// portant une clé de contenu conversationnel est REFUSÉ à l'écriture (échec bruyant plutôt que fuite
// silencieuse). Heuristique volontairement conservatrice (clés de verbatim, pas les descripteurs
// d'événement comme `evt`/`msg`) — défense en profondeur, pas une preuve.
const FORBIDDEN_CONTENT_KEYS = new Set(["text", "content", "verbatim", "transcript", "utterance", "prompt", "reply", "answer"]);

// Scan RÉCURSIF (m4) : un verbatim IMBRIQUÉ — le cas réaliste, ex. {evt:"turn", payload:{text:"…"}} —
// est aussi refusé, pas seulement une clé de premier niveau.
function assertNoConversationalContent(record: Record<string, unknown>): void {
  const seen = new WeakSet<object>(); // garde anti-cycle (#4) : une référence circulaire ne boucle pas
  const walk = (val: unknown): void => {
    if (val === null || typeof val !== "object") return;
    if (seen.has(val as object)) return;
    seen.add(val as object);
    if (Array.isArray(val)) { for (const v of val) walk(v); return; }
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (FORBIDDEN_CONTENT_KEYS.has(k.toLowerCase())) {
        throw new Error(`AF-10 : l'audit JSONL ne porte jamais de contenu conversationnel (clé interdite : "${k}")`);
      }
      walk(v);
    }
  };
  walk(record);
}

interface ParseResult<T> { records: T[]; internalCorrupt: number; }

/**
 * Parse un JSONL. Distingue (m10) une DERNIÈRE ligne tronquée par une coupure (sans '\n' final,
 * TOLÉRÉE) d'une ligne illisible EN MILIEU de fichier (corruption disque, SIGNALÉE via internalCorrupt).
 */
function parseJsonl<T>(raw: string): ParseResult<T> {
  const records: T[] = [];
  let internalCorrupt = 0;
  const endsWithNL = raw.endsWith("\n");
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      const isLast = i === lines.length - 1;
      if (isLast && !endsWithNL) continue; // queue tronquée = coupure en plein append -> tolérée
      internalCorrupt++;                    // ligne illisible interne -> corruption, signalée
    }
  }
  return { records, internalCorrupt };
}

function readLines<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return parseJsonl<T>(fs.readFileSync(filePath, "utf8")).records;
}

export class AuditLog {
  // Ouverture du segment courant, mesurée EN MÉMOIRE (fid1 + robustesse #1) — JAMAIS via la date de
  // création NTFS : le « file tunneling » de Windows (défaut, fenêtre 15 s) réattribue à un fichier
  // recréé sous un nom récemment libéré la date de création de l'ancien -> birthtime PIÉGÉ -> tempête
  // de rotations + perte du journal. On mesure donc l'âge sur une horloge qu'on contrôle.
  private segmentStart: number;

  constructor(
    private readonly filePath: string,
    private readonly maxBytes = 5_000_000,
    private readonly keep = 3,
    private readonly maxAgeMs = 7 * 24 * 60 * 60 * 1000, // rotation par ÂGE du segment (fid1) : défaut 7 j
  ) {
    // Segment préexistant (redémarrage) : ancré sur sa dernière écriture (mtime, NON tunnelé) — un
    // segment dormant depuis > maxAgeMs roule une fois ; un segment actif reste jeune. Sinon : maintenant.
    let start = Date.now();
    try { start = fs.statSync(filePath).mtimeMs; } catch { /* fichier neuf */ }
    this.segmentStart = start;
  }

  /** AF-10 : traces / compteurs / événements UNIQUEMENT — jamais de contenu conversationnel. */
  append(record: Record<string, unknown>): void {
    assertNoConversationalContent(record); // garde AF-10 : refuse une fuite de verbatim
    this.rotateIfNeeded();
    appendLine(this.filePath, record, false);
  }

  read(): Record<string, unknown>[] {
    return readLines<Record<string, unknown>>(this.filePath);
  }

  private rotateIfNeeded(): void {
    let st: fs.Stats;
    try { st = fs.statSync(this.filePath); } catch { return; }
    if (st.size === 0) return;
    const tooBig = st.size >= this.maxBytes;
    const tooOld = Date.now() - this.segmentStart >= this.maxAgeMs; // âge en mémoire (tunneling-proof)
    if (!tooBig && !tooOld) return; // fid1 : rotation par taille OU par âge
    for (let i = this.keep - 1; i >= 1; i--) {
      const src = `${this.filePath}.${i}`;
      if (fs.existsSync(src)) { try { fs.renameSync(src, `${this.filePath}.${i + 1}`); } catch { /* */ } }
    }
    try { fs.renameSync(this.filePath, `${this.filePath}.1`); } catch { /* */ }
    this.segmentStart = Date.now(); // nouveau segment : l'horloge d'âge repart (jamais via birthtime NTFS)
  }
}

export interface ErasureRecord {
  id: number;
  ts: number;
  counters?: Record<string, number>;
}

export class ErasureStream {
  constructor(private readonly filePath: string) {} // JAMAIS roté : le témoin ne perd aucun enregistrement

  append(record: ErasureRecord): void {
    assertNoConversationalContent(record as unknown as Record<string, unknown>); // fid6 : même invariant AF-10
    appendLine(this.filePath, record, true); // fsync : durable AVANT le commit d'effacement
  }

  readAll(): ErasureRecord[] {
    if (!fs.existsSync(this.filePath)) return [];
    const { records, internalCorrupt } = parseJsonl<ErasureRecord>(fs.readFileSync(this.filePath, "utf8"));
    if (internalCorrupt > 0) {
      // Le témoin d'effacements DOIT être complet (rôle : prouver à T5 la couverture des effacements).
      // Une ligne illisible EN MILIEU (pas la queue tronquée) = témoin non fiable -> ERREUR remontée
      // (T5 en fait une ALERTE), JAMAIS un sous-rapport silencieux (m10).
      throw new Error(`ErasureStream : ${internalCorrupt} ligne(s) illisible(s) en interne -> témoin d'effacements non fiable`);
    }
    return records;
  }

  /**
   * Dernier enregistrement, BEST-EFFORT (#7) : un appel courant (ex. construire le repère de crue d'un
   * snapshot) ne doit PAS planter sur une corruption interne. La détection stricte du témoin (readAll
   * qui jette) reste réservée au chemin de VÉRIFICATION T5 — c'est là que la corruption doit alerter.
   */
  last(): ErasureRecord | null {
    if (!fs.existsSync(this.filePath)) return null;
    const { records } = parseJsonl<ErasureRecord>(fs.readFileSync(this.filePath, "utf8"));
    return records.length ? records[records.length - 1] : null;
  }
}
