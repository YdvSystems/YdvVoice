// EmbedSpace — M1 (plan 02) : le côté ORCHESTRATEUR de la prise embed (l'écrivain unique, F2).
//
// Le sidecar CALCULE (cmd.embed -> evt.embed.done, BGE-M3 ONNX) ; ICI on ÉCRIT — et on porte les trois
// mécanismes de couche 2 qui vivent côté orchestrateur (jamais dans le sidecar) :
//
//   1. LE GARDE D'ESPACE (§2.2, T17) : avant d'écrire un vecteur, comparer son identité d'espace (portée par
//      evt.embed.done : model · dimension · preproc_revision) à la MÉTA DE LA TABLE ÉCRITE (embed_space_meta) —
//      méta ACTIVE pour un corpus live, méta CIBLE (active=0) pour une table ombre en construction (M9, B-ζ).
//      Mismatch -> REFUS d'écriture + ÉVÉNEMENT DE SANTÉ immédiat, JAMAIS un refus muet.
//   2. « LA BASE EST LA FILE » (§2.2) : « à embedder » = les lignes SOURCE sans ligne `vec` (aucune table de
//      queue) -> la file se RECALCULE depuis l'état réel après crash/respawn (divergence impossible par construction).
//   3. LE SUIVI DES ÉCHECS (b-m5, redéfini conv 62 — décision Yohann « option b ») : ⛔ M1 NE DEAD-LETTER JAMAIS
//      (4 tours d'audit ont prouvé que « la permanence d'un échec est INCONNAISSABLE depuis l'orchestrateur » : tout
//      dead-letter fondé sur une inférence de permanence tue soit une ligne SAINE en silence, soit ne borne pas le
//      reprocess). À la place, correct par construction : COMPTER les échecs consécutifs par ligne (embed_failures,
//      persisté) + SURFACER un événement de santé TYPÉ (`embed.persistent_failure {kind: timeout|sidecar-error}`)
//      au seuil -> rien de silencieux, rien d'abandonné. Sur une panne SYSTÉMIQUE (sonde de santé KO) on n'isole
//      même pas -> une ligne saine n'est jamais comptée pendant une panne moteur. La POLITIQUE (skip/backoff/dead,
//      calibrée au temps d'embed i5 vs timeout) appartient à M2+gouverneur, avec le banc (garde-fou conv 15 : le plan
//      pose le mécanisme, pas la politique). `rowsToEmbed` respecte `dead=1` par avance (posé par M2/M8), jamais par M1.
//
// ⛔ CONTRATS write-once (conv 61, opposables) : le rowid de `vec_<corpus>` = l'id de la SOURCE (jamais un id
// fabriqué) ; node:sqlite lie les `number` en REAL et vec0 exige un INTEGER -> **rowid en BigInt** (prouvé conv 61).
// La NON-RÉUTILISATION d'un id (AUTOINCREMENT côté source) + la MAINTENANCE du vec à l'effacement (delete du vec
// dans la transaction M8) sont la discipline qui garantit « zéro vecteur orphelin ». Testés à M1/M8.

import type { DatabaseSync } from "node:sqlite";

/** L'identité d'un espace vectoriel (portée par evt.embed.done ; comparée au garde). */
export interface SpaceIdentity {
  model: string;
  dimension: number;
  preproc_revision: string;
}

/** Le résultat d'un cmd.embed (evt.embed.done). `error` -> échec moteur/contenu (poison-row candidat). */
export interface EmbedResult extends SpaceIdentity {
  vectors: number[][];
  error?: string;
  /** `true` = l'échec est un THROW du TRANSPORT (timeout, canal fermé, embed-non-monté) — transitoire/systémique
   *  par nature, JAMAIS un poison de contenu (3ᵉ re-croisé conv 62 : le design définit le poison comme « le SIDECAR
   *  renvoie une erreur » `02` L101 ; un timeout n'est PAS le sidecar qui renvoie une erreur). Posé par `safeEmbed`. */
  transient?: boolean;
}

/** Transport vers la prise embed du sidecar (injectable : prod = IpcEmbedTransport ; test = fake). */
export interface EmbedTransport {
  embed(items: string[], priority: "interactive" | "background"): Promise<EmbedResult>;
}

/** Bilan d'UN balayage froid (un lot). ⚠️ `done` = « ce lot a été traité / le moteur a progressé », PAS « la file
 *  est vide » (3ᵉ re-croisé conv 62) : le consommateur M2 boucle sur `rowsToEmbed(corpus).length`, JAMAIS sur `done`.
 *  `systemic` = le moteur est prouvé DOWN (sonde de santé KO) -> rien dead-letterré, le consommateur ESPACE (back-off). */
export interface EmbedSweepResult {
  done: boolean;
  written: number;
  refused: number;
  failed: number;
  systemic?: boolean;
}

/** Registre des corpus HYBRIDES (== seeds embed_space_meta + tables vec_* de schema-02). Noms FIXES (#G) ;
 *  interpolés dans le SQL -> proviennent de CE registre, JAMAIS d'une entrée utilisateur (pas d'injection). */
const CORPORA: Record<string, { source: string; content: string; vec: string }> = {
  facts:     { source: "facts",            content: "content", vec: "vec_facts" },
  sessions:  { source: "sessions",         content: "summary", vec: "vec_sessions" },   // AF-2 : summary = seul contenu mutable
  chronicle: { source: "chronicle",        content: "content", vec: "vec_chronicle" },
  knowledge: { source: "knowledge_chunks", content: "content", vec: "vec_knowledge" },
};

const DEFAULT_SURFACE_AFTER = 3;  // seuil de SURFAÇAGE : après N échecs consécutifs d'une ligne, on émet UN événement
//   de santé typé (jamais un dead-letter — décision Yohann conv 62, option b). Calibration §6.
const DEFAULT_BATCH = 32;       // taille de lot du chemin FROID (calibration §6)
// Chaîne CONNUE-BONNE pour la sonde de santé (re-croisé conv 62) : n'importe quel texte court que le moteur sait
// embedder ; sert à distinguer « moteur mort » de « lot où une ligne échoue » (sonde-en-premier sur échec de lot).
const HEALTH_SENTINEL = "sophia";

export interface EmbedSpaceOptions {
  /** Événement de santé (T17) : refus du garde d'espace, échec PERSISTANT d'une ligne (surfaçage). Prod = voyant
   *  systray + journal ; test = recorder. */
  onHealth?: (kind: string, detail: Record<string, unknown>) => void;
  /** Après combien d'échecs consécutifs d'UNE ligne on émet l'événement de surfaçage (jamais un dead-letter, opt. b). */
  surfaceAfter?: number;
}

export class EmbedSpace {
  private readonly db: DatabaseSync;
  private readonly transport: EmbedTransport;
  private readonly onHealth: (kind: string, detail: Record<string, unknown>) => void;
  private readonly surfaceAfter: number;
  /** Sérialisation PAR CORPUS des balayages froids (m-2 croisé conv 62) : deux `embedPending` concurrents sur
   *  le même corpus sélectionneraient la même ligne sans vec -> `UNIQUE constraint` au 2e INSERT. On enchaîne
   *  (patron WarmBrain.chain). */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(db: DatabaseSync, transport: EmbedTransport, opts: EmbedSpaceOptions = {}) {
    this.db = db;
    this.transport = transport;
    this.onHealth = opts.onHealth ?? (() => { /* pas d'abonné : le refus reste tracé en base (embed_failures) */ });
    // Durcissement (ultime check conv 62) : un seuil `0`/négatif/non-entier ne serait JAMAIS atteint par `attempts`
    // entier (`===`) -> jamais surfacé -> reprocess silencieux. On borne à un ENTIER >= 1 (un futur appelant M2 ne
    // peut pas désarmer le surfaçage par accident). Note : `?? ` ne rattrape pas `0` (non-nullish) -> le clamp le fait.
    this.surfaceAfter = Math.max(1, Math.floor(opts.surfaceAfter ?? DEFAULT_SURFACE_AFTER));
  }

  /** Corpus connus (hybrides). */
  static corpora(): string[] {
    return Object.keys(CORPORA);
  }

  // ── LE GARDE D'ESPACE ────────────────────────────────────────────────────────────────────────
  /** Compare `space` à la méta de la table écrite : ACTIVE (défaut) pour un corpus live, CIBLE (active=false)
   *  pour une ombre M9 (B-ζ). Renvoie {ok} ou {ok:false, reason} — JAMAIS une exception (le garde décide). */
  checkSpace(corpus: string, space: SpaceIdentity, active = true): { ok: boolean; reason?: string; expected?: SpaceIdentity } {
    const meta = this.db
      .prepare("SELECT model, dimension, preproc_revision FROM embed_space_meta WHERE corpus = ? AND active = ?")
      .get(corpus, active ? 1 : 0) as SpaceIdentity | undefined;
    if (!meta) return { ok: false, reason: "no_meta" };
    if (meta.model === space.model && Number(meta.dimension) === Number(space.dimension)
        && meta.preproc_revision === space.preproc_revision) {
      return { ok: true };
    }
    return { ok: false, reason: "space_mismatch", expected: meta };
  }

  // ── « LA BASE EST LA FILE » ──────────────────────────────────────────────────────────────────
  /** Les lignes SOURCE d'un corpus SANS vecteur (et non `dead`) — recalculé depuis l'état réel (pas de queue). */
  rowsToEmbed(corpus: string, limit = DEFAULT_BATCH): { id: number; content: string }[] {
    const c = CORPORA[corpus];
    if (!c) throw new Error(`corpus inconnu: ${corpus}`);
    return this.db.prepare(
      `SELECT s.id AS id, s.${c.content} AS content
         FROM ${c.source} s
        WHERE s.${c.content} IS NOT NULL AND s.${c.content} <> ''
          AND s.id NOT IN (SELECT rowid FROM ${c.vec})
          AND s.id NOT IN (SELECT source_id FROM embed_failures WHERE corpus = ? AND dead = 1)
        ORDER BY s.id
        LIMIT ?`,
    ).all(corpus, limit) as { id: number; content: string }[];
  }

  // ── ÉCRITURE D'UN VECTEUR (garde + insert) ───────────────────────────────────────────────────
  /** Écrit un vecteur dans vec_<corpus> APRÈS le garde. rowid = id source (BigInt — vec0 exige un INTEGER, conv 61).
   *  Refus du garde -> événement de santé (T17) + PAS de poison-row (#5). Renvoie {written} ou {refused, reason}. */
  writeVector(corpus: string, id: number, vector: number[], space: SpaceIdentity, active = true):
      { written: true } | { written: false; reason: string } {
    const c = CORPORA[corpus];
    if (!c) return { written: false, reason: "unknown_corpus" };
    const g = this.checkSpace(corpus, space, active);
    if (!g.ok) {
      this.onHealth("embed.space_refused", { corpus, id, reason: g.reason, expected: g.expected, got: space });
      return { written: false, reason: g.reason ?? "space_mismatch" };   // refus d'espace : JAMAIS un poison-row (#5)
    }
    // Garde de LONGUEUR (NIT-1 croisé conv 62) : la dimension DÉCLARÉE (garde ci-dessus) doit correspondre à la
    // longueur RÉELLE du vecteur — un moteur qui « mentirait » (déclare 1024, renvoie 768) ferait lever vec0 DANS
    // la transaction (rollback du lot). Refus honnête + santé ; pas un poison (défense, aucun moteur correct ne ment).
    if (!Array.isArray(vector) || vector.length !== Number(space.dimension)) {
      this.onHealth("embed.dimension_mismatch", { corpus, id, declared: space.dimension, got: Array.isArray(vector) ? vector.length : null });
      return { written: false, reason: "dimension_length" };
    }
    // Finitude (re-croisé conv 62, NIT) : un NaN/Inf passerait la garde de longueur puis ferait LEVER vec0 DANS
    // l'INSERT (`JSON.stringify(NaN)`->`null` -> « JSON parsing error » vec0) -> rollback du lot + exception qui fuit.
    // On refuse PROPREMENT (jamais un throw d'écriture). Défensif : BGE-M3 normalise avec plancher 1e-12, ne ment pas.
    if (vector.some((v) => !Number.isFinite(v))) {
      this.onHealth("embed.non_finite", { corpus, id });
      return { written: false, reason: "non_finite" };
    }
    // ⛔ Contrat write-once #2 — FENÊTRE ORPHELIN (MINEUR-C croisé conv 62) : entre `rowsToEmbed` et ICI il y a eu
    // un `await` (le round-trip embed) ; un effacement souverain M8 a PU supprimer la source pendant cet await.
    // On RE-VÉRIFIE SYNCHRONEMENT (writeBatch est sans `await` interne -> M8, sur la même event-loop, ne peut pas
    // s'intercaler entre ce SELECT et l'INSERT) : source disparue -> AUCUN vecteur écrit (JAMAIS un orphelin).
    const alive = this.db.prepare(`SELECT 1 FROM ${c.source} WHERE id = ?`).get(id);
    if (!alive) return { written: false, reason: "source_gone" };
    this.db.prepare(`INSERT INTO ${c.vec}(rowid, embedding) VALUES (?, ?)`)
      .run(BigInt(id), JSON.stringify(vector));   // BigInt : vec0 exige un INTEGER ; JSON : vec0 parse le tableau
    return { written: true };
  }

  // ── LE SUIVI DES ÉCHECS (compter + surfacer ; JAMAIS dead-letter — opt. b conv 62) ─────────────
  /** Incrémente le compteur d'échec consécutif d'UNE ligne (embed_failures, persisté) et, au SEUIL
   *  (`surfaceAfter`), émet UN événement de santé TYPÉ. ⛔ NE POSE JAMAIS `dead` : M1 ne décide pas d'abandonner
   *  (la permanence est inconnaissable ; la politique skip/backoff = M2, avec la calibration). `kind` = la NATURE
   *  du dernier échec (`timeout` = throw transport · `sidecar-error` = erreur renvoyée par le sidecar) -> l'événement
   *  est DISTINGUABLE d'un vrai poison (le faux-décès « silencieux » du re-croisé est fermé : rien n'est tué, tout
   *  est surfacé et typé). Émet UNE fois, quand `attempts` atteint le seuil (pas de spam à chaque échec au-delà). */
  recordFailure(corpus: string, id: number, kind: string): { attempts: number } {
    this.db.prepare(
      `INSERT INTO embed_failures(corpus, source_id, attempts, last_error_at)
         VALUES (?, ?, 1, ?)
       ON CONFLICT(corpus, source_id) DO UPDATE SET
         attempts = attempts + 1,
         last_error_at = excluded.last_error_at`,
    ).run(corpus, id, Date.now());
    const row = this.db.prepare("SELECT attempts FROM embed_failures WHERE corpus = ? AND source_id = ?")
      .get(corpus, id) as { attempts: number };
    if (row.attempts === this.surfaceAfter) {   // === : surfacé UNE seule fois (au franchissement du seuil)
      this.onHealth("embed.persistent_failure", { corpus, id, attempts: row.attempts, kind });
    }
    return { attempts: row.attempts };
  }

  /** Une ligne qui finit par réussir efface sa trace d'échec (un échec transitoire ne doit pas s'accumuler). */
  private clearFailure(corpus: string, id: number): void {
    this.db.prepare("DELETE FROM embed_failures WHERE corpus = ? AND source_id = ?").run(corpus, id);
  }

  /** SONDE DE SANTÉ (re-croisé conv 62) : le moteur embedde-t-il une chaîne CONNUE-BONNE ? C'est le signal
   *  « moteur UP » INDÉPENDANT du contenu du lot en échec — sans lui, un moteur SAIN face à un lot tout-poison est
   *  indistinguable d'un moteur MORT (les 2 MAJEUR du re-croisé). Utilisé UNIQUEMENT quand aucune ligne du lot n'a
   *  réussi (le cas ambigu) — jamais sur le chemin nominal. */
  private async engineHealthy(): Promise<boolean> {
    const r = await this.safeEmbed([HEALTH_SENTINEL], "background");
    return !r.error && Array.isArray(r.vectors) && r.vectors.length === 1
      && Array.isArray(r.vectors[0]) && r.vectors[0].length > 0;
  }

  /** Appel transport ENCAPSULÉ (m-3/D croisé conv 62) : une REJECTION (timeout, canal fermé, evt.error corrélé)
   *  est convertie en résultat `{error}` — elle ne FUIT jamais en exception (contrat « jamais bloquante » d'`embedQuery`
   *  + le froid ne crashe pas). */
  private async safeEmbed(items: string[], priority: "interactive" | "background"): Promise<EmbedResult> {
    try {
      // Résolu : soit des vecteurs, soit `{error}` RENVOYÉ par le sidecar (le moteur a échoué sur ce CONTENU).
      return await this.transport.embed(items, priority);
    } catch (e) {
      // THROW du transport (timeout `IpcClient` 3 s / canal fermé / evt.error « embed non monté ») -> `transient`.
      // (Contrat honnête : ce chemin FROID n'expose jamais une exception de transport ; une erreur DB, elle, est
      // rethrow par `writeBatch` [rollback tout-ou-rien] et remonte au gouverneur -> back-off — voulu.)
      return { model: "", dimension: 0, preproc_revision: "", vectors: [], error: (e as Error)?.message ?? "transport", transient: true };
    }
  }

  // ── CHEMIN CHAUD : l'embed de la requête (interactive) ────────────────────────────────────────
  /** Embed d'UNE requête (conversation). Ne l'ÉCRIT PAS (M2 la consomme pour le KNN). Échec (moteur OU transport)
   *  -> `{error}` (jamais une exception ; M2 saute la jambe vec). */
  async embedQuery(text: string): Promise<{ vector: number[]; space: SpaceIdentity } | { error: string }> {
    const r = await this.safeEmbed([text], "interactive");
    if (r.error || !r.vectors || r.vectors.length === 0) return { error: r.error ?? "no_vector" };
    return { vector: r.vectors[0], space: { model: r.model, dimension: r.dimension, preproc_revision: r.preproc_revision } };
  }

  // ── CHEMIN FROID : embedder les lignes en attente (background, dans les creux) ─────────────────
  /** Embedde un lot de lignes sans vec. SÉRIALISÉ par corpus (m-2) : deux balayages du même corpus ne peuvent
   *  pas s'entrelacer (sinon UNIQUE constraint au 2e INSERT). Le vrai travail = `_embedPending`. */
  async embedPending(corpus: string, opts: { batchSize?: number } = {}): Promise<EmbedSweepResult> {
    const prev = this.chains.get(corpus) ?? Promise.resolve();
    const run = (): Promise<EmbedSweepResult> => this._embedPending(corpus, opts);
    const p = prev.then(run, run);
    this.chains.set(corpus, p.then(() => undefined, () => undefined));
    return p;
  }

  private async _embedPending(corpus: string, opts: { batchSize?: number }): Promise<EmbedSweepResult> {
    const rows = this.rowsToEmbed(corpus, opts.batchSize ?? DEFAULT_BATCH);
    if (rows.length === 0) return { done: true, written: 0, refused: 0, failed: 0 };

    const res = await this.safeEmbed(rows.map((r) => r.content), "background");
    if (!res.error && res.vectors.length === rows.length) {
      const space: SpaceIdentity = { model: res.model, dimension: res.dimension, preproc_revision: res.preproc_revision };
      return this.writeBatch(corpus, rows, res.vectors, space);   // chemin NOMINAL : jamais de sonde
    }
    // Le lot a échoué. SONDE D'ABORD (3ᵉ re-croisé conv 62) : le signal « moteur UP » doit être INDÉPENDANT du
    // contenu du lot -> une sentinelle connue-bonne. Moteur DOWN -> systémique : on N'ISOLE PAS (économise N
    // ré-embeds voués à l'échec), rien dead-letterré, le consommateur espace. Moteur UP -> on isole pour trouver
    // le(s) poison(s) (le lot a échoué à cause d'une ligne de contenu, pas du moteur).
    const up = await this.engineHealthy();
    if (!up) return { done: false, written: 0, refused: 0, failed: rows.length, systemic: true };
    return this.isolateAndWrite(corpus, rows);
  }

  /** Écrit un lot de vecteurs (garde par item) dans une transaction SYNCHRONE (aucun `await` -> atomique vis-à-vis
   *  de l'event-loop -> M8 ne s'intercale pas ; ferme la fenêtre orphelin avec le re-check de `writeVector`). */
  private writeBatch(corpus: string, rows: { id: number; content: string }[], vectors: number[][], space: SpaceIdentity):
      EmbedSweepResult {
    let written = 0, refused = 0;
    this.db.exec("BEGIN");
    try {
      for (let i = 0; i < rows.length; i++) {
        const w = this.writeVector(corpus, rows[i].id, vectors[i], space);
        if (w.written) { written++; this.clearFailure(corpus, rows[i].id); } else { refused++; }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { done: written + refused === rows.length, written, refused, failed: 0 };
  }

  /** Ré-embedde chaque ligne SEULE d'un lot en échec. APPELÉE UNIQUEMENT quand le moteur est déjà PROUVÉ UP (sonde
   *  indépendante dans `_embedPending`) -> une panne SYSTÉMIQUE n'atteint jamais cette boucle (aucune ligne saine
   *  comptée pendant une panne moteur). ⛔ opt. b (conv 62) : on ÉCRIT les succès (+ `clearFailure`), et on COMPTE
   *  chaque échec (via `recordFailure`, avec sa NATURE : `timeout` throw transport · `sidecar-error` erreur renvoyée)
   *  -> le compteur monte, un événement TYPÉ est surfacé au seuil. On ne DEAD-LETTER JAMAIS (la permanence est
   *  inconnaissable ; skip/backoff = M2). `clearFailure` sur tout succès -> un échec transitoire qui se résout ne
   *  s'accumule pas. Une ligne persistamment en échec est donc SURFACÉE (jamais silencieuse) et reste re-sélectionnée
   *  (jamais abandonnée) — c'est le consommateur M2 qui posera l'espacement, avec la calibration du banc. */
  private async isolateAndWrite(corpus: string, rows: { id: number; content: string }[]): Promise<EmbedSweepResult> {
    let written = 0, refused = 0, failed = 0;
    for (const row of rows) {
      const r = await this.safeEmbed([row.content], "background");
      if (!r.error && r.vectors && r.vectors.length === 1) {
        try {
          const w = this.writeVector(corpus, row.id, r.vectors[0], { model: r.model, dimension: r.dimension, preproc_revision: r.preproc_revision });
          if (w.written) { written++; this.clearFailure(corpus, row.id); } else { refused++; }
        } catch { refused++; /* erreur DB sur une ligne : jamais un crash du balayage — la base reste la file */ }
      } else {
        this.recordFailure(corpus, row.id, r.transient ? "timeout" : "sidecar-error");   // compté + surfacé au seuil ; JAMAIS dead
        failed++;
      }
    }
    return { done: true, written, refused, failed };   // isolate n'est atteinte que moteur-UP -> progrès fait
  }
}

/** Transport de PRODUCTION : cmd.embed via l'IpcClient (evt.embed.done corrélé par id). */
export class IpcEmbedTransport implements EmbedTransport {
  // Sous-ensemble injecté de l'IpcClient (request) — évite un import dur, testable.
  constructor(private readonly ipc: { request(type: string, payload: Record<string, unknown>): Promise<{ payload: Record<string, unknown> }> }) {}

  async embed(items: string[], priority: "interactive" | "background"): Promise<EmbedResult> {
    const env = await this.ipc.request("cmd.embed", { items, priorite: priority });
    const p = env.payload as Record<string, unknown>;
    return {
      model: String(p.model ?? ""),
      dimension: Number(p.dimension ?? 0),
      preproc_revision: String(p.preproc_revision ?? ""),
      vectors: Array.isArray(p.vectors) ? (p.vectors as number[][]) : [],
      error: typeof p.error === "string" ? p.error : undefined,
    };
  }
}
