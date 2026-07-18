// Arrêt propre (socle T6) — traduit technique/00 §Durabilité (« il sait mourir proprement ») + plan/00 T6.
//
// Le « bonne nuit » de Sophia : mourir vite et proprement pour se réveiller HONNÊTEMENT (elle sait si on
// l'a coupée ou si elle s'est endormie). Séquence : cmd.shutdown (coopératif, le sidecar libère CUDA +
// flush) -> terminer le sidecar (SIGTERM->SIGKILL, filet forceful) -> **drapeau « propre » durable** ->
// teardown. Pas de snapshot à l'arrêt (rapide ; fenêtre d'extinction Windows bornée, §6).
//
// L'ARGUMENT DE STRUCTURE (ce qui rend le réveil honnête par CONSTRUCTION) : `running=0` est écrit
// DURABLEMENT comme DERNIER acte avant le teardown. Donc tout arrêt INCOMPLET (crash, force-kill de l'OS,
// échec d'écriture) laisse `running=1` -> réveil « sale ». « propre » EXIGE la preuve d'un arrêt achevé :
// c'est « un arrêt forcé = traité comme une coupure » (T4), gratuit par l'ordonnancement.
//
// Module Node PUR (aucune API Electron, patron T3/T5) : capacités injectées -> testable hors Electron
// (stubs en U-T6) et prouvé en cœur réel (E2E : vrai sidecar honorant cmd.shutdown).

import type { DatabaseSync } from "node:sqlite";
import { setSynchronous } from "../db/durability.js";
import { AuditLog } from "../audit/index.js";
import type { SophiaPaths } from "../paths.js";

export interface ShutdownCapabilities {
  /** Le fichier de vérité (out.db.raw) — pour poser le drapeau « propre ». */
  db: DatabaseSync;
  paths: SophiaPaths;
  /** T7 (⑩) — quiescer le gouverneur AVANT tout : couper le fond + finir/attendre l'unité en cours, pour qu'AUCUNE
   *  transaction ne reste ouverte quand `writeCleanShutdown` posera le drapeau propre (le drapeau doit rester son
   *  PROPRE commit durable — sinon `writeCleanShutdown` jette et le réveil sera « sale »). Best-effort, borné par le
   *  quiesce lui-même + le garde-fou global de before-quit. Absent avant T7 (ou en boot dégradé) = no-op. */
  quiesceGovernor?: () => Promise<void>;
  /** T8 — couper toute invocation `claude` en vol AVANT de terminer le sidecar (léger : request-scoped → d'ordinaire
   *  rien en vol, mais une deep/rêverie longue doit céder). Best-effort, jamais fatal. Absent avant T8 (ou en boot
   *  dégradé sans canal) = no-op. */
  stopChannel?: () => void;
  /** V7 (⑩) — couper le ROUTEUR de conversation (le fil oreilles↔voix) : plus de nouveau tour accepté, purge de sa
   *  voix (cmd.tts.stop), fermeture de la connexion IPC de la voix, annulation des timers (masqueur/deadline/gate).
   *  AVANT stopWarm (le routeur cesse d'accepter → le tour en vol cède ensuite avec le cerveau). Absent avant V7 = no-op. */
  stopVoice?: () => void;
  /** V7 (⑩) — couper le CERVEAU CHAUD (WarmBrain) : tuer le process claude persistant + un tour de dialogue en vol
   *  (rendu partiel/aborté, jamais un hang). Best-effort, jamais fatal. Absent avant V7 (ou en boot dégradé) = no-op. */
  stopWarm?: () => void;
  /** T3 — couper respawn + battement AVANT cmd.shutdown (une mort du sidecar pendant l'arrêt n'est pas
   *  relancée). Optionnel : absent en boot dégradé sans superviseur. */
  beginSidecarShutdown?: () => void;
  /** T2/01/05 — cmd.shutdown (WS) : le sidecar libère CUDA + flush + acquitte. Best-effort, BORNÉ ici :
   *  un sidecar figé ne doit jamais bloquer l'arrêt. Absent si pas de voix (rien à prévenir). */
  sendShutdown?: () => Promise<void>;
  /** T3 — SIGTERM -> grace -> SIGKILL. Retourne `died`. Absent si pas de sidecar. */
  terminateSidecar?: (graceMs: number) => Promise<{ died: boolean }>;
  /** Dernier acte : close db (checkpoint WAL, mesuré au banc t6) + release de l'instance unique. */
  teardown: () => void;
  onLog?: (line: string) => void;
  /** Timeouts (calibration §6). Défauts sûrs, bornés pour la fenêtre d'extinction Windows. */
  sidecarAckTimeoutMs?: number; // attente de l'ack de cmd.shutdown avant de passer au terminate
  sidecarGraceMs?: number;      // grace SIGTERM->SIGKILL (passé à terminateSidecar)
}

const DEFAULT_ACK_TIMEOUT_MS = 1500;
const DEFAULT_SIDECAR_GRACE_MS = 1500;

/** Une promesse bornée : rejette si `p` n'a pas résolu dans `ms`. Un sidecar figé ne fige pas l'arrêt. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e as Error); },
    );
  });
}

/**
 * Pose le drapeau « propre » DURABLEMENT : `running=0` + `last_clean_shutdown_at`, encadré `synchronous=FULL`
 * (fsync — mesuré durable au banc t6). C'est le POINT DE COMMIT de « je me suis arrêtée proprement » : il
 * doit être le DERNIER acte durable avant le teardown, pour que tout arrêt incomplet reste « sale » (T4).
 *
 * Inconditionnel (jamais gardé sur l'état dégradé) : un arrêt propre EST propre même si la session tournait
 * diminuée (SANS_VOIX/SANS_ECRITURE). `runtime_flags` est une table TECHNIQUE, pas « ses souvenirs » (A15) ;
 * la garde « ne pas toucher les souvenirs » de SANS_ECRITURE ne la couvre pas. Si l'écriture échoue (base
 * vraiment abîmée), l'appelant l'attrape -> `running` reste 1 -> réveil « sale » (fail-safe, jamais un faux
 * « propre »).
 */
export function writeCleanShutdown(db: DatabaseSync): void {
  // ⑩ (re-croisé conv 36) : le drapeau « propre » doit être son PROPRE commit atomique et durable — le
  // « dernier acte durable ». Au socle, aucun autre écrivain (écrivain unique) -> aucune transaction n'est
  // ouverte ici. Mais quand 02/03/T7 tiendront des transactions multi-statements cédant sur un await, un
  // before-quit pourrait tomber transaction ouverte -> `running=0` s'exécuterait DANS la transaction
  // étrangère (rollback au force-kill = arrêt propre perdu ; toggle FULL/NORMAL muté en plein vol). On le
  // REFUSE bruyamment (miroir de createSnapshot/N4) plutôt qu'une corruption silencieuse : gracefulShutdown
  // attrape -> `running` reste 1 -> « sale » (fail-safe). Les couches aval devront quiescer les writers avant.
  if (db.isTransaction) {
    throw new Error("writeCleanShutdown : une transaction est ouverte -> le drapeau propre ne serait pas son propre commit durable (quiescer les writers avant l'arrêt, aval 02/03/T7)");
  }
  setSynchronous(db, "FULL");
  db.prepare("UPDATE runtime_flags SET running=0, last_clean_shutdown_at=? WHERE id=1").run(Date.now());
  // ⑦ (re-croisé conv 36) : le drapeau est committé DURABLEMENT ci-dessus. Restaurer NORMAL est COSMÉTIQUE
  // (la connexion est fermée juste après par le teardown) -> un échec ICI ne doit PAS faire croire à
  // l'appelant que le drapeau n'a pas été posé (sinon log « NON posé » + audit `shutdown.clean` sauté, alors
  // qu'il EST posé et que le réveil lira bien « propre »). writeCleanShutdown ne jette que si l'écriture
  // RÉELLE du drapeau échoue.
  try { setSynchronous(db, "NORMAL"); } catch { /* cosmétique ; base fermée juste après */ }
}

/**
 * Décision du handler `before-quit` d'Electron, extraite en fonction PURE (⑥ re-croisé conv 36) pour la
 * rendre testable — c'était l'ancien MAJEUR ① (un 2e « Quitter » abandonnait l'arrêt en vol) et il n'avait
 * aucun filet de non-régression. Contrat :
 *  · pas PRIMARY (SECONDARY/BLOCKED) -> ne rien bloquer, sortie normale ;
 *  · PRIMARY, séquence pas encore lancée -> BLOQUER la sortie par défaut + LANCER l'arrêt propre ;
 *  · PRIMARY, séquence déjà en vol -> BLOQUER (jamais laisser un 2e quit tuer l'arrêt) mais NE PAS relancer.
 * L'invariant clé : pour un PRIMARY, `prevent` est TOUJOURS vrai (jamais de sortie par défaut qui court-
 * circuiterait `writeCleanShutdown`) ; la seule sortie est l'`app.exit(0)` du gracefulShutdown déjà lancé.
 */
export function planBeforeQuit(isPrimary: boolean, quitting: boolean): { prevent: boolean; run: boolean } {
  if (!isPrimary) return { prevent: false, run: false };
  if (quitting) return { prevent: true, run: false };
  return { prevent: true, run: true };
}

/**
 * L'arrêt gracieux. Coopératif d'abord (cmd.shutdown), forceful en filet (SIGTERM->SIGKILL), drapeau propre
 * en dernier. Ne jette JAMAIS : chaque étape est gardée -> un échec de sidecar/IPC ne laisse pas Sophia à
 * moitié éteinte. Le teardown est TOUJOURS appelé (close db + release instance), même si le reste a raté.
 */
export async function gracefulShutdown(cap: ShutdownCapabilities): Promise<void> {
  const log = (l: string): void => cap.onLog?.(l);
  const audit = new AuditLog(cap.paths.audit);

  // 0. T7 (⑩) — quiescer le gouverneur : plus de nouvelle unité de fond, on attend l'unité en cours (son commit
  //    atomique est SYNCHRONE → à sa fin, aucune transaction n'est ouverte). C'est ce qui permet à writeCleanShutdown
  //    (étape 4) de poser le drapeau propre comme son PROPRE commit durable. Best-effort, jamais fatal (un gouverneur
  //    qui traîne ne laisse pas Sophia à moitié éteinte — le garde-fou global de before-quit borne en dernier ressort).
  if (cap.quiesceGovernor) {
    try { await cap.quiesceGovernor(); log("gouverneur quiescé (aucune tâche de fond en vol)"); }
    catch (e) { log(`quiesce gouverneur: ${(e as Error).message} — on continue l'arrêt`); }
  }

  // 0bis. T8 (⑩bis) — couper les invocations `claude` en vol (request-scoped ; d'ordinaire rien, mais une deep longue
  //       doit céder AVANT le terminate du sidecar). Best-effort, jamais fatal.
  try { cap.stopChannel?.(); } catch (e) { log(`stopChannel: ${(e as Error).message}`); }

  // 0ter. V7 (⑩) — couper le ROUTEUR de conversation AVANT le cerveau : il cesse d'accepter un nouveau tour, purge sa
  //       voix (cmd.tts.stop), ferme sa connexion IPC et annule ses timers. Ainsi le tour en vol (respond) ne relance
  //       plus rien ; il cédera avec le cerveau (stopWarm, juste après). Best-effort, jamais fatal.
  try { cap.stopVoice?.(); } catch (e) { log(`stopVoice: ${(e as Error).message}`); }

  // 0quater. V7 (⑩) — couper le cerveau chaud (process claude persistant de DIALOGUE) : un tour en vol est rendu
  //       partiel/aborté, jamais un hang. Distinct de stopChannel (T8, request-scoped/ACTION) : WarmBrain = canal DIALOGUE.
  try { cap.stopWarm?.(); } catch (e) { log(`stopWarm: ${(e as Error).message}`); }

  // 1. Couper le respawn : à partir d'ici, une mort du sidecar n'est plus relancée.
  try { cap.beginSidecarShutdown?.(); } catch (e) { log(`beginSidecarShutdown: ${(e as Error).message}`); }

  // 2. cmd.shutdown — coopératif : le sidecar libère CUDA + flush + acquitte. BORNÉ : un sidecar figé ne
  //    bloque pas l'arrêt (on tombe sur le terminate forceful). Best-effort, jamais fatal.
  if (cap.sendShutdown) {
    try {
      await withTimeout(cap.sendShutdown(), cap.sidecarAckTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS);
      log("cmd.shutdown acquitté (sidecar prêt à être terminé)");
    } catch (e) {
      log(`cmd.shutdown non confirmé (${(e as Error).message}) — on termine quand même`);
    }
  }

  // 3. Terminer le sidecar (SIGTERM -> grace -> SIGKILL). `died` dit s'il est bien parti.
  let died = true;
  if (cap.terminateSidecar) {
    try {
      ({ died } = await cap.terminateSidecar(cap.sidecarGraceMs ?? DEFAULT_SIDECAR_GRACE_MS));
    } catch (e) {
      died = false;
      log(`terminate sidecar: ${(e as Error).message}`);
    }
  }

  // 4. Drapeau « propre » — DERNIER acte durable. Point de commit de l'arrêt propre.
  try {
    writeCleanShutdown(cap.db);
    try { audit.append({ evt: "shutdown.clean", sidecar_reaped: died, ts: Date.now() }); } catch { /* l'audit ne fait jamais tomber l'arrêt */ }
    log("arrêt propre : running=0 posé (réveil « propre »)");
  } catch (e) {
    // On NE MENT PAS : le drapeau n'est pas posé -> running reste 1 -> réveil « sale » (fail-safe).
    log(`drapeau propre NON posé (${(e as Error).message}) — le réveil sera « sale » (jamais un faux « propre »)`);
  }

  // 5. Teardown : close db (checkpoint WAL) + release de l'instance unique. Toujours, même après un échec.
  try { cap.teardown(); } catch (e) { log(`teardown: ${(e as Error).message}`); }
}
