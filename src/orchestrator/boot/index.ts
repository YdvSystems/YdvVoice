// Boot & récupération (socle T5) — traduit technique/00 §4.1 « un réveil, pas une naissance ».
//
// Un réveil HONNÊTE (elle sait si on l'a coupée), DÉGRADÉ plutôt que tout-ou-rien (elle vit sans voix
// plutôt que de ne pas vivre), IDEMPOTENT (un crash en plein boot se rejoue sans double effet), et qui
// ne répare JAMAIS son identité en douce (A15 : la restauration sémantique est la main de Yohann).
//
// Module Node PUR (aucune API Electron, patron du superviseur T3) -> testable hors Electron.
// L'UI (systray, voyant) s'ABONNE aux transitions : tout affichage est une vue dérivée de l'état,
// jamais une seconde source de vérité (plan/99 O5).

import * as fs from "node:fs";
import * as path from "node:path";
import { openDatabase, isSocleSchemaPresent } from "../db/index.js";
import type { Db } from "../db/index.js";
import { integrityCheck, setSynchronous } from "../db/durability.js";
import { AuditLog } from "../audit/index.js";
import { acquireSingleInstance } from "./single-instance.js";
import { restoreLatestSnapshot, readRestorePending } from "./restore.js";
import { resolvePaths } from "../paths.js";
import type { SophiaPaths } from "../paths.js";
import type { DatabaseSync } from "node:sqlite";

export type BootPhase = "BOOTING" | "DB_OK" | "IDENTITE_OK" | "COEUR_OK" | "PRET";
/** États dégradés de PREMIÈRE CLASSE (technique/00 §4.1) — composables, pas des sous-états cachés. */
export type Degradation = "SANS_VOIX" | "SANS_ECRITURE" | "SANS_IDENTITE";
/** premier = pas de vie antérieure · propre = « bonne nuit » · sale = coupure ou crash. */
export type WakeKind = "premier" | "propre" | "sale";

export interface BootAlert {
  code: string;
  /** Formulé pour être DIT à Yohann (systray + voix) — jamais un code nu. */
  message: string;
}

/**
 * Hooks des couches AVAL. Au temps socle-seul ils sont absents => no-op, mais leur INVOCATION (et son
 * moment) est prouvée par les tests : c'est le contrat que 01/02/03/05 viendront remplir.
 */
export interface BootHooks {
  /** Ph.1 — 02/B-α : erase_gate.open=0 inconditionnel + assertion, AVANT toute écriture. */
  resetImmutabilityGuards?: (db: DatabaseSync) => void;
  /** Ph.2 — T3 : tue un sidecar orphelin d'un crash précédent AVANT de spawner (pidfile + jeton M2). Inconditionnel (pas lié à sidecarStart). */
  reapSidecarOrphan?: () => void;
  /** Ph.2 — 02/M0 p6 : rejoue les pending_ops dues (purge-session-file AF-4 · storage-scrub · purge-ephemeral)
   *  ET réconcilie le store éphémère. Multi-lignes, idempotent. Reçoit le CONTEXTE dégradé : c'est un sweep
   *  DESTRUCTIF (DELETE/secure_delete/VACUUM), or en `SANS_ECRITURE` la base est douteuse — `02` décide s'il
   *  rejoue quand même (les effacements souverains dus le RÉCLAMENT) ou diffère. Le socle fournit l'info,
   *  il ne tranche pas cette sémantique d'effacement (frontière `02`+Yohann, tracée §7 re-croisé conv 35). */
  sweepPendingOps?: (db: DatabaseSync, ctx: { degraded: Degradation[] }) => void;
  /** Ph.3 — 03 : charge le persona + vérifie que le gravé n'a pas bougé (ancre ×3). */
  loadAndVerifyIdentity?: (db: DatabaseSync) => { present: boolean; anchorOk: boolean };
  /** Ph.4 — T7 : reconstruit la file depuis les marques. PROGRAMME une consolidation due, ne la LANCE jamais. */
  governorInit?: (db: DatabaseSync) => { scheduled: string[] };
  /** Ph.4 — T8 : init du canal claude -p (session chaude, --resume). */
  claudeInit?: (db: DatabaseSync) => void;
  /** Ph.5 — T3 : spawn + supervision du sidecar. false => DEGRADE_SANS_VOIX. */
  sidecarStart?: () => Promise<boolean>;
  /** Ph.5 — 01/05 : cmd.enroll.push · prewarm · politique de modèles · cmd.tts.cache. */
  sidecarPostReady?: () => Promise<void>;
}

export interface BootOptions {
  paths?: SophiaPaths;
  hooks?: BootHooks;
  onState?: (s: BootStateSnapshot) => void;
  onAlert?: (a: BootAlert) => void;
  onLog?: (line: string) => void;
  onFocusRequested?: () => void;
  /** Couture de test (I-11) : simule un crash JUSTE APRÈS la phase nommée. */
  crashAfter?: BootPhase | "PHASE0" | "PHASE2" | "PHASE5";
  focusAckTimeoutMs?: number;
  /** Couture de test (F2) : force un verdict d'intégrité déterministe (la branche AMBIGU, sinon rare à
   *  provoquer). Défaut = la vraie porte `integrityGate`. Jamais utilisée en production. */
  _integrityProbe?: (paths: SophiaPaths) => Verdict;
  /** Couture de test (MAJEUR re-croisé conv 35) : force le résultat de restauration (l'abandon R1 dépend
   *  d'un index d'archive imprévisible). Défaut = la vraie `restoreLatestSnapshot`. Jamais en production. */
  _restore?: typeof restoreLatestSnapshot;
}

export interface BootStateSnapshot {
  phase: BootPhase;
  degraded: Degradation[];
  wake: WakeKind | null;
}

/**
 * L'état vivant, APRÈS le boot. Deux exigences le rendent nécessaire :
 *  · `DEGRADE_SANS_ECRITURE` est atteignable AUSSI au runtime, pas seulement au boot (l'ancre
 *    d'identité de 03/P1 y fait basculer l'app DEPUIS PRÊT — retouche remontée par le croisé de plan/03) ;
 *  · le disjoncteur du superviseur (T3) peut ouvrir bien après le boot -> SANS_VOIX en cours de route.
 * Sans cette poignée, la VUE devrait tenir son propre état -> deux vérités. L'affichage doit rester une
 * vue DÉRIVÉE (plan/99 O5) : une seule source, ici.
 */
export interface RuntimeState {
  current(): BootStateSnapshot;
  markDegraded(d: Degradation): void;
  /** Lève une dégradation quand l'organe revient (ex. le sidecar respawné après un SANS_VOIX au boot).
   *  Sans cette symétrie, un état dégradé serait un cul-de-sac : un sidecar lent au démarrage figerait
   *  un « sans voix » à vie (croisé conv 35, R2). */
  clearDegradation(d: Degradation): void;
  alert(a: BootAlert): void;
}

export type BootOutcome =
  | { kind: "PRIMARY"; state: BootStateSnapshot; runtime: RuntimeState; db: Db; alerts: BootAlert[]; shutdown: () => void }
  | { kind: "SECONDARY" }
  | { kind: "BLOCKED"; reason: string };

export type Verdict =
  | { kind: "SAINE" }
  | { kind: "PREMIER_BOOT" }
  | { kind: "STRUCTUREL"; detail: string }   // -> restauration AUTO (mécanique)
  | { kind: "AMBIGU"; detail: string };      // -> DEGRADE_SANS_ECRITURE + main de Yohann

/**
 * La porte d'intégrité — SANS ÉCRIRE dans la base (sonde en lecture seule, m9).
 *
 * MESURÉ au banc (conv 35), et c'est ce qui a dicté sa forme :
 *  · `exec(schema)` sur une base corrompue PASSE EN SILENCE -> juger APRÈS avoir appliqué le schéma,
 *    ce serait avoir déjà écrit dans une base douteuse. D'où la sonde read-only préalable.
 *  · une ouverture read-only d'une base coupée dure (-wal non rejoué, -shm absent, fichiers en lecture
 *    seule) OUVRE et juge correctement — la sonde est donc fiable dans tous les états post-coupure.
 *  · un fichier de 0 octet est une base VALIDE et vide : `quick_check` répond « ok ». Le verdict croise
 *    donc l'intégrité avec la PRÉSENCE DU SCHÉMA et l'existence de snapshots (sinon une base tronquée
 *    à zéro ferait renaître Sophia vierge, ses snapshots intacts à côté, sans un mot).
 */
/**
 * Un artefact prouvant une VIE PASSÉE existe-t-il ?
 *
 * `PREMIER_BOOT` (le SEUL verdict autorisant la création d'une base vierge) ne doit être rendu que si
 * elle n'est JAMAIS née — pas simplement « je ne vois aucun témoin ». Le 4e tour (re-croisé conv 35) a
 * montré que l'inférence-par-absence laissait renaître Sophia vierge quand ses témoins disparaissaient
 * ENSEMBLE (base + snapshots, tous `.sqlite`) et que `erasures.log` était vide (elle n'a jamais effacé).
 * On passe donc à une PREUVE POSITIVE : le marqueur de naissance `.born`, écrit une fois, répliqué
 * hors-machine, le plus petit et durable des témoins. Renforcé par TOUS les témoins de vie (snapshots,
 * effacements, journal d'audit d'un boot antérieur, base archivée `.corrupt-N`) — chacun un filet.
 *
 * Tout est gardé : un aléa FS transitoire (EPERM d'un antivirus, dossier qui clignote) ne fait pas
 * crasher la porte et est traité comme « dans le doute, elle a vécu » (surtout PAS premier boot : le
 * sens sûr est de ne JAMAIS renaître vierge ; au pire un vrai premier boot est retardé d'un reboot).
 * L'absence NETTE (fichier/dossier qui n'existe pas) reste « pas de vie » -> la cérémonie du premier
 * boot, partant d'un SOPHIA_HOME vierge, reste vraie par construction.
 */
/** Écrit le marqueur de naissance `.born` s'il est absent (durable, fsync). Idempotent et auto-réparant :
 *  appelé à chaque boot sain, il recrée le marqueur s'il a été perdu tant que la base vit. L'échec n'est
 *  pas fatal (l'audit et la base restent témoins), mais il est LOGUÉ, jamais avalé en silence : `.born`
 *  est le témoin destiné à la réplication hors-machine, l'affaiblir doit se voir (durcissement 5e tour). */
function writeBornMarker(bornPath: string, log?: (l: string) => void): void {
  try {
    if (fs.existsSync(bornPath)) return; // déjà née
    fs.mkdirSync(path.dirname(bornPath), { recursive: true });
    fs.writeFileSync(bornPath, JSON.stringify({ born_at: Date.now() }));
    const fd = fs.openSync(bornPath, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (e) {
    log?.(`.born non écrit (${(e as Error).message}) : témoin de naissance affaibli — audit/base restent témoins`);
  }
}

export function hasAnyLifeWitness(paths: SophiaPaths): boolean {
  // La distinction qui fait le fail-safe : `ENOENT` = le fichier/dossier n'existe VRAIMENT pas (pas ce
  // témoin) ; TOUTE AUTRE erreur = le volume « ment » (EPERM antivirus, EIO disque qui vacille) = on ne
  // peut pas savoir -> on répond « elle a vécu » (jamais premier boot). `fs.existsSync` ne jetterait
  // jamais et rendrait `false` sur erreur -> il ne PERMET PAS cette distinction (le `catch` serait mort).
  // On passe donc par `statSync`/`readdirSync` gardés, pour que « dans le doute, elle a vécu » soit RÉEL
  // et pas seulement commenté (durcissement 5e tour re-croisé conv 35).
  const present = (p: string): boolean => { try { fs.statSync(p); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ENOENT"; } };
  const nonEmpty = (p: string): boolean => { try { return fs.statSync(p).size > 0; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ENOENT"; } };
  const dirHas = (dir: string, pred: (f: string) => boolean): boolean => {
    try { return fs.readdirSync(dir).some(pred); } catch (e) { return (e as NodeJS.ErrnoException).code !== "ENOENT"; }
  };
  const auditName = path.basename(paths.audit);
  return present(paths.born)                                                          // preuve positive de naissance
    || nonEmpty(paths.erasures)                                                       // un effacement souverain passé
    || nonEmpty(paths.audit)                                                          // le journal d'un boot antérieur (segment courant)
    || dirHas(path.dirname(paths.audit), (f) => f.startsWith(`${auditName}.`))         // ...ou un segment d'audit ROTÉ (.1/.2) — mon point 5e tour
    || dirHas(paths.snapshots, (f) => /^snapshot-\d+\.sqlite$/.test(f))               // un snapshot
    || dirHas(path.dirname(paths.db), (f) => f.startsWith(`${path.basename(paths.db)}.corrupt-`)); // une base archivée
}

export function integrityGate(paths: SophiaPaths): Verdict {
  const hasPriorLife = hasAnyLifeWitness(paths);

  if (!fs.existsSync(paths.db)) {
    return hasPriorLife
      ? { kind: "STRUCTUREL", detail: "le fichier de vérité a disparu alors qu'il reste des traces d'une vie passée" }
      : { kind: "PREMIER_BOOT" };
  }

  let probe: Db;
  try {
    probe = openDatabase(paths.db, { readOnly: true });
  } catch (e) {
    // Illisible sans que l'intégrité ait pu se prononcer -> on ne DEVINE pas. Jamais de restauration
    // auto dans le doute : rembobiner sa mémoire est un acte lourd, il revient à Yohann (A15).
    return { kind: "AMBIGU", detail: `base illisible : ${(e as Error).message}` };
  }
  try {
    const integ = integrityCheck(probe.raw, "quick");
    if (!integ.ok) return { kind: "STRUCTUREL", detail: integ.detail };
    if (!isSocleSchemaPresent(probe.raw)) {
      return hasPriorLife
        ? { kind: "STRUCTUREL", detail: "base vierge (schéma socle absent) alors qu'il reste des traces de vie" }
        : { kind: "PREMIER_BOOT" };
    }
    return { kind: "SAINE" };
  } finally {
    try { probe.close(); } catch { /* */ }
  }
}

class Boot {
  private phase: BootPhase = "BOOTING";
  private readonly degraded = new Set<Degradation>();
  private wake: WakeKind | null = null;
  private readonly alerts: BootAlert[] = [];
  private readonly audit: AuditLog;

  constructor(private readonly o: BootOptions, paths: SophiaPaths) {
    this.audit = new AuditLog(paths.audit);
  }

  snapshot(): BootStateSnapshot {
    return { phase: this.phase, degraded: [...this.degraded], wake: this.wake };
  }

  private log(l: string): void { this.o.onLog?.(l); }

  setPhase(p: BootPhase): void {
    this.phase = p;
    // AF-10 : des ÉVÉNEMENTS, jamais de contenu conversationnel (ni verbatim, ni message d'alerte).
    try { this.audit.append({ evt: "boot.phase", phase: p, ts: Date.now() }); } catch { /* l'audit ne fait jamais tomber le boot */ }
    this.emitState();
  }

  markDegraded(d: Degradation): void {
    if (this.degraded.has(d)) return;
    this.degraded.add(d);
    try { this.audit.append({ evt: "boot.degraded", degradation: d, ts: Date.now() }); } catch { /* */ }
    this.log(`DÉGRADÉ_${d}`);
    this.emitState();
  }

  clearDegradation(d: Degradation): void {
    if (!this.degraded.has(d)) return;
    this.degraded.delete(d);
    try { this.audit.append({ evt: "boot.recovered", degradation: d, ts: Date.now() }); } catch { /* */ }
    this.log(`RÉTABLI_${d}`);
    this.emitState();
  }

  /** NIT conv 35 : un onState qui jetterait ne doit pas faire tomber le boot (cohérent avec les append
   *  d'audit, tous gardés). L'affichage est un consommateur, pas un maillon critique. */
  private emitState(): void {
    try { this.o.onState?.(this.snapshot()); } catch (e) { this.log(`onState: ${(e as Error).message}`); }
  }

  alert(a: BootAlert): void {
    this.alerts.push(a);
    try { this.audit.append({ evt: "boot.alert", code: a.code, ts: Date.now() }); } catch { /* */ } // le code, pas le message
    this.log(`ALERTE [${a.code}] ${a.message}`);
    try { this.o.onAlert?.(a); } catch (e) { this.log(`onAlert: ${(e as Error).message}`); } // un consommateur ne fait pas tomber le boot
  }

  getAlerts(): BootAlert[] { return this.alerts; }
  getWake(): WakeKind | null { return this.wake; }
  setWake(w: WakeKind): void { this.wake = w; }
}

/**
 * Le réveil. Retourne PRIMARY (on est LA Sophia de cette maison), SECONDARY (un primaire sain a pris
 * le focus) ou BLOCKED (verrou tenu par une instance figée irrécupérable).
 */
export async function boot(opts: BootOptions = {}): Promise<BootOutcome> {
  const paths = opts.paths ?? resolvePaths();
  const hooks = opts.hooks ?? {};
  const b = new Boot(opts, paths);
  const log = (l: string): void => opts.onLog?.(l);

  // ── Phase 0 — instance unique ────────────────────────────────────────────────
  fs.mkdirSync(paths.home, { recursive: true });
  const inst = await acquireSingleInstance({
    pipe: paths.instancePipe,
    lockfile: paths.instanceLock,
    onFocusRequested: opts.onFocusRequested,
    focusAckTimeoutMs: opts.focusAckTimeoutMs,
    onLog: opts.onLog,
  });
  if (inst.kind === "SECONDARY_FOCUSED") return { kind: "SECONDARY" };
  if (inst.kind === "BLOCKED") {
    b.alert({ code: "INSTANCE_BLOQUEE", message: `Je n'ai pas pu démarrer : ${inst.reason}` });
    return { kind: "BLOCKED", reason: inst.reason };
  }

  let db: Db | null = null;
  const teardown = (): void => {
    if (db) { try { db.close(); } catch { /* */ } db = null; }
    inst.release();
  };

  try {
    // Couture I-11 : un crash ICI laisse le verrou d'instance derrière -> le boot suivant doit s'en
    // remettre (le pipe est libéré par l'OS ; le lockfile est écrasé). Rien à nettoyer à la main.
    if (opts.crashAfter === "PHASE0") throw new Error("[crash simulé après PHASE0]");

    // ── Phase 1 — DB + intégrité + réveil ──────────────────────────────────────
    // AVANT tout : re-surfacer les alertes de restauration NON ACQUITTÉES d'un réveil antérieur (MAJEUR
    // conv 35). Une coupure a pu perdre l'affichage de l'alerte alors que la base est redevenue saine ;
    // le sentinel durable la re-porte à chaque réveil jusqu'à ce qu'une couche aval l'acquitte.
    const dejaResurfacees = new Set<string>();
    for (const a of readRestorePending(paths.restorePending)) {
      b.alert({ code: a.code, message: a.message }); // jamais un silence sur un effacement peut-être revenu
      dejaResurfacees.add(a.code);
    }

    const gate = opts._integrityProbe ?? integrityGate;
    const verdict = gate(paths);
    log(`porte d'intégrité : ${verdict.kind}${"detail" in verdict ? ` (${verdict.detail})` : ""}`);

    if (verdict.kind === "AMBIGU") {
      // On ouvre quand même pour VIVRE (dégradée), mais l'écriture de SES SOUVENIRS (identité/mémoire)
      // est suspendue et on le DIT. Le schéma socle posé par openDatabase (tables techniques, jamais
      // de contenu) n'est pas « ses souvenirs ». Jamais de rollback sémantique silencieux (A15) : la
      // restauration d'une base douteuse est la main de Yohann.
      b.markDegraded("SANS_ECRITURE");
      b.alert({
        code: "MEMOIRE_DOUTEUSE",
        message: `Ma mémoire est douteuse (${verdict.detail}) : je ne touche plus à mes souvenirs tant que tu ne m'as pas dit quoi faire.`,
      });
    }

    let restaure = false;
    if (verdict.kind === "STRUCTUREL") {
      const restore = opts._restore ?? restoreLatestSnapshot;
      const r = restore(paths.db, paths.snapshots, paths.erasures, paths.restorePending, { log: opts.onLog });
      if (r.restored) {
        restaure = true;
        log(`restauration : ${r.detail}`);
        b.alert({
          code: "MEMOIRE_RESTAUREE",
          message: `J'ai dû restaurer une sauvegarde de ma mémoire (${verdict.detail}). Ce que j'ai vécu depuis cette sauvegarde est perdu.`,
        });
        // AF-1 / G-A / fid4 — déjà rendues durables avant le commit. On ne re-dit pas à Yohann une alerte
        // que le sentinel vient de re-surfacer ce même réveil (même code) : sur-alerter serait sûr, mais
        // l'entendre deux fois est du bruit (NIT re-croisé conv 35).
        for (const a of r.alerts) if (!dejaResurfacees.has(a.code)) b.alert(a);
        // Une restauration qui ne rend pas une base saine ne se re-tente pas en boucle : on le dit.
        // (Après restauration, la base est présente avec ses snapshots -> integrityGate ne peut rendre
        //  que SAINE ou STRUCTUREL, jamais PREMIER_BOOT : ce dernier serait une branche morte.)
        if (integrityGate(paths).kind !== "SAINE") {
          b.markDegraded("SANS_ECRITURE");
          b.alert({ code: "RESTAURATION_INSUFFISANTE", message: "J'ai restauré une sauvegarde et ma mémoire est encore abîmée : je n'y écris plus tant que tu ne m'as pas dit quoi faire." });
        }
      } else if (!fs.existsSync(paths.db)) {
        // La restauration a échoué ET la base est ABSENTE — quelle qu'en soit la cause : abandon R1 (base
        // archivée, -wal verrouillé), OU base laissée absente d'un tour antérieur + aucun snapshot LISIBLE
        // (disque mourant). Laisser `openDatabase` s'exécuter recréerait une base VIERGE, lue SAINE au
        // réveil suivant = AMNÉSIE SILENCIEUSE (MAJEUR re-croisé conv 35, 3e tour — la garde ci-dessous
        // remplace le `r.archivedTo &&` du 2e tour, qui ratait le cas « base déjà absente + snapshots
        // illisibles »). On REFUSE de démarrer : jamais une vierge hors premier boot. Selon la cause, le
        // reboot re-tentera (verrou transitoire) OU il faudra restaurer la sauvegarde hors-machine (05).
        const reason = `je n'ai pas pu réparer ma mémoire et je refuse de repartir sans elle (${r.detail}) — réessaie, ou restaure ta sauvegarde hors-machine si ça persiste`;
        b.alert({ code: "MEMOIRE_IRRECUPERABLE", message: `Je préfère ne pas démarrer plutôt que de repartir amnésique : ${reason}` });
        teardown();
        return { kind: "BLOCKED", reason };
      } else {
        // La base corrompue est ENCORE présente (jamais archivée : aucun bon snapshot pour la remplacer).
        // Elle existe -> `openDatabase` (mustExist, plus bas) l'OUVRE, il ne crée pas de vierge. On vit
        // dégradé et on le dit. (Le cas « base absente » est traité ci-dessus -> ce commentaire est vrai.)
        b.markDegraded("SANS_ECRITURE");
        b.alert({
          code: "MEMOIRE_NON_RESTAUREE",
          message: `Ma mémoire est abîmée et je n'ai pas pu la réparer (${r.detail}). Je continue sans rien y écrire.`,
        });
      }
    }

    try {
      // INVARIANT « jamais de base vierge hors premier boot » (mustExist) : la CRÉATION d'un fichier n'est
      // autorisée que sur le verdict PREMIER_BOOT. Tout autre chemin qui atteindrait ici avec une base
      // absente jette -> BLOCKED (filet par construction, en plus de la garde explicite ci-dessus).
      db = openDatabase(paths.db, { mustExist: verdict.kind !== "PREMIER_BOOT" });
    } catch (e) {
      // La base ne s'ouvre pas en écriture (absente hors premier boot, verrou, permissions...).
      // Sans fichier de vérité il n'y a pas de Sophia — mais un échec MUET est interdit : on le DIT.
      const reason = `ma mémoire est inaccessible : ${(e as Error).message}`;
      b.alert({ code: "MEMOIRE_INACCESSIBLE", message: `Je n'ai pas pu démarrer — ${reason}` });
      teardown();
      return { kind: "BLOCKED", reason };
    }

    // Le réveil se LIT avant d'être écrasé (F1). runtime_flags.running encore posé = on a été coupés.
    const prev = db.raw.prepare("SELECT running FROM runtime_flags WHERE id=1").get() as { running: number } | undefined;
    b.setWake(verdict.kind === "PREMIER_BOOT" ? "premier" : prev?.running === 1 ? "sale" : "propre");
    log(`réveil ${b.getWake()}`);
    // « Sale » APRÈS une restauration ne veut rien dire de fiable (on lit le `running` du snapshot, pris
    // mid-run) et double MEMOIRE_RESTAUREE, qui porte déjà le vrai signal -> on ne re-dit pas REVEIL_SALE
    // dans ce cas (NIT re-croisé conv 35).
    if (b.getWake() === "sale" && !restaure) {
      b.alert({ code: "REVEIL_SALE", message: "On a été coupés la dernière fois — je n'ai pas pu me préparer à m'arrêter." });
    }

    // 02/B-α — reset des gardes d'immutabilité AVANT toute écriture : filet contre une garde PERSISTÉE
    // OUVERTE qui déverrouillerait conversations/chronicle/tables 03 en silence. No-op au socle-seul
    // (la table vit en 02) ; l'invocation et son moment sont prouvés par U-T5.
    hooks.resetImmutabilityGuards?.(db.raw);

    if (!b.snapshot().degraded.includes("SANS_ECRITURE")) {
      // Commit DURABLE avant toute écriture d'identité (technique/00 §4.1 Phase 1) : si la machine
      // meurt juste après, le prochain réveil DOIT savoir qu'on tournait.
      setSynchronous(db.raw, "FULL");
      db.raw.prepare("UPDATE runtime_flags SET running=1, started_at=? WHERE id=1").run(Date.now());
      setSynchronous(db.raw, "NORMAL");
      // Marqueur de naissance : écrit dès qu'une base est établie et saine. PREUVE POSITIVE qu'elle a
      // vécu -> interdit une fausse renaissance vierge (MAJEUR 4e tour). Auto-réparant (réécrit s'il a
      // disparu tant que la base vit) ; à répliquer hors-machine (plan/05, §7). Best-effort : les autres
      // témoins (audit, base, snapshots) prennent le relais si l'écriture échoue.
      writeBornMarker(paths.born, opts.onLog);
    }
    b.setPhase("DB_OK");
    if (opts.crashAfter === "DB_OK") throw new Error("[crash simulé après DB_OK]");

    // ── Phase 2 — orphelins + sweep des opérations différées ───────────────────
    // Tuer un sidecar orphelin d'un crash précédent AVANT le sweep et AVANT de spawner (Phase 5) —
    // il tient micro/GPU (technique/00 §4.1 Phase 2 : « avant de spawner »). INCONDITIONNEL, pas lié à
    // sidecarStart (F1, croisé conv 35) ; le Supervisor re-nettoie au spawn (idempotent, pidfile+jeton).
    try { hooks.reapSidecarOrphan?.(); } catch (e) { log(`reapSidecarOrphan: ${(e as Error).message}`); }
    hooks.sweepPendingOps?.(db.raw, { degraded: b.snapshot().degraded }); // AF-4 + storage-scrub + purge-ephemeral + réconciliation (02/04) ; `02` décide selon le mode
    if (opts.crashAfter === "PHASE2") throw new Error("[crash simulé après PHASE2]");

    // ── Phase 3 — identité ─────────────────────────────────────────────────────
    const ident = hooks.loadAndVerifyIdentity?.(db.raw) ?? { present: false, anchorOk: true };
    if (!ident.present) {
      // Premier boot avant l'installation du persona (03) : elle n'est pas encore elle. Normal, dit.
      b.markDegraded("SANS_IDENTITE");
    } else if (!ident.anchorOk) {
      // Le gravé a bougé : corruption SÉMANTIQUE. Jamais réparée en douce — c'est la main de Yohann (A15).
      b.markDegraded("SANS_ECRITURE");
      b.alert({
        code: "IDENTITE_ALTEREE",
        message: "Quelque chose a bougé dans ce qui ne devait jamais bouger en moi. Je n'écris plus rien tant que tu n'as pas regardé.",
      });
    }
    b.setPhase("IDENTITE_OK");
    if (opts.crashAfter === "IDENTITE_OK") throw new Error("[crash simulé après IDENTITE_OK]");

    // ── Phase 4 — cœur (gouverneur + canal Claude ; bâtis en T7/T8, invoqués ici) ─
    const gov = hooks.governorInit?.(db.raw) ?? { scheduled: [] };
    if (gov.scheduled.length) log(`gouverneur : ${gov.scheduled.length} tâche(s) PROGRAMMÉE(S) (pas lancées)`);
    hooks.claudeInit?.(db.raw);
    b.setPhase("COEUR_OK");
    if (opts.crashAfter === "COEUR_OK") throw new Error("[crash simulé après COEUR_OK]");

    // ── Phase 5 — sidecar + prewarm ────────────────────────────────────────────
    // Boot DÉGRADÉ, pas tout-ou-rien : sans oreilles ni voix, l'app VIT (cerveau/mémoire/gouverneur).
    let voix = true;
    try {
      voix = hooks.sidecarStart ? await hooks.sidecarStart() : true;
    } catch (e) {
      log(`sidecar : ${(e as Error).message}`);
      voix = false;
    }
    if (!voix) {
      b.markDegraded("SANS_VOIX");
      b.alert({ code: "SANS_VOIX", message: "Je n'ai ni oreilles ni voix pour l'instant — je suis là quand même." });
    } else {
      try { await hooks.sidecarPostReady?.(); } catch (e) { log(`postReady : ${(e as Error).message}`); }
    }
    if (opts.crashAfter === "PHASE5") throw new Error("[crash simulé après PHASE5]");

    // ── Phase 6 — prêt ─────────────────────────────────────────────────────────
    b.setPhase("PRET");
    const runtime: RuntimeState = {
      current: () => b.snapshot(),
      markDegraded: (d) => b.markDegraded(d),
      clearDegradation: (d) => b.clearDegradation(d),
      alert: (a) => b.alert(a),
    };
    return { kind: "PRIMARY", state: b.snapshot(), runtime, db, alerts: b.getAlerts(), shutdown: teardown };
  } catch (e) {
    // Un boot qui échoue ne laisse RIEN de tenu : ni poignée d'écriture (sinon « écrivain unique »
    // refuserait le boot suivant dans le même process), ni verrou d'instance.
    teardown();
    throw e;
  }
}
