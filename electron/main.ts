import { app, BrowserWindow, Menu, Tray, nativeImage, dialog } from "electron";
import * as path from "path";
import { boot } from "../src/orchestrator/boot/index.js";
import type { BootStateSnapshot, BootAlert, BootOutcome } from "../src/orchestrator/boot/index.js";
import { Supervisor } from "../src/orchestrator/supervisor/index.js";
import { installBeforeQuit } from "./before-quit.js";
import { resolvePaths } from "../src/orchestrator/paths.js";

// NOTE conv 34 : la desactivation GPU (disableHardwareAcceleration + --disable-gpu) etait une mesure
// TEMPORAIRE pour proteger le fine-tune voix qui tournait EN PARALLELE sur le 2060. Ce travail est
// termine -> mesure RETIREE (retour au defaut Electron). La vraie politique « l'UI partage-t-elle le
// GPU avec le pipeline voix (STT sur le 2060, VRAM tendue) ? » est une decision de RESSOURCES =
// plan/05, tranchee la-bas, PAS gravee dans le socle (Garde-fou Phase 3). Voir plan/00 §7.
//
// T5 : ce fichier est la VUE. Toute la logique de reveil vit dans src/orchestrator/boot (Node pur,
// testable hors Electron) ; ici on ne fait que L'AFFICHER — systray + voyant + titre. Rien n'est
// stocke ici : l'affichage est une vue DERIVEE de l'etat (plan/99 O5), jamais une seconde verite.

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let etat: BootStateSnapshot = { phase: "BOOTING", degraded: [], wake: null };
const alertes: BootAlert[] = [];
let session: BootOutcome | null = null;

const paths = resolvePaths();
const supervisor = new Supervisor({
  python: path.join(app.getAppPath(), ".venv-sidecar", "Scripts", "python.exe"),
  script: "sidecar/server.py",
  cwd: app.getAppPath(),
  pidfile: paths.sidecarPidfile,
  onLog: (l) => console.log(l),
  onReady: () => {
    // Le sidecar est (re)devenu READY. Si un SANS_VOIX avait ete pose (sidecar lent au boot, ou
    // disjoncteur puis retablissement), on le LEVE via la seule source d'etat. Sans cette symetrie,
    // le voyant resterait « sans voix » a vie alors que la voix fonctionne (R2, croise conv 35).
    if (session?.kind !== "PRIMARY") return; // au 1er boot, onReady precede l'affectation de session : rien a lever
    session.runtime.clearDegradation("SANS_VOIX");
  },
  onDegraded: () => {
    // Disjoncteur ouvert APRES le boot : la voix tombe en cours de route. On ne bricole PAS l'etat
    // local ici — on le dit a la SEULE source (le runtime du boot), qui rediffuse via onState.
    // La vue reste une vue derivee (plan/99 O5) ; sinon on aurait deux verites.
    // (Pendant le boot, session n'est pas encore assignee : c'est le retour `false` de sidecarStart
    //  qui porte alors la degradation — pas de trou.)
    if (session?.kind !== "PRIMARY") return;
    session.runtime.markDegraded("SANS_VOIX");
    session.runtime.alert({
      code: "VOIX_PERDUE",
      message: "J'ai perdu mes oreilles et ma voix — je suis toujours la, mais tu vas devoir m'ecrire.",
    });
  },
});

/** Voyant 16x16 (BGRA brut — aucun asset, aucune dependance). */
function voyant(r: number, g: number, b: number): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dedans = (x - c) ** 2 + (y - c) ** 2 <= 6.5 ** 2;
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = dedans ? 255 : 0;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

/** Une couleur = un etat, lisible d'un coup d'oeil (jamais un silence). */
function couleur(): Electron.NativeImage {
  if (etat.degraded.includes("SANS_ECRITURE")) return voyant(220, 60, 60);   // rouge : elle n'ecrit plus
  if (etat.degraded.length > 0) return voyant(230, 160, 40);                 // orange : elle vit, diminuee
  if (etat.phase === "PRET") return voyant(70, 190, 110);                    // vert : elle est la
  return voyant(120, 130, 145);                                             // gris : elle se reveille
}

function libelle(): string {
  if (etat.phase !== "PRET") return `Sophia — reveil (${etat.phase})`;
  if (etat.degraded.length === 0) return "Sophia — la";
  const quoi = etat.degraded.map((d) => ({
    SANS_VOIX: "sans oreilles ni voix",
    SANS_ECRITURE: "sans ecrire dans sa memoire",
    SANS_IDENTITE: "sans son persona",
  }[d])).join(", ");
  return `Sophia — la, ${quoi}`;
}

function render(): void {
  if (tray) {
    tray.setImage(couleur());
    tray.setToolTip(libelle());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: libelle(), enabled: false },
      { type: "separator" },
      { label: `Reveil : ${etat.wake ?? "…"}`, enabled: false },
      ...(alertes.length
        ? [{ type: "separator" as const }, ...alertes.map((a) => ({ label: a.message, enabled: false }))]
        : []),
      { type: "separator" },
      { label: "Afficher", click: () => focus() },
      { label: "Quitter", click: () => app.quit() }, // -> before-quit -> arret gracieux (T6)
    ]));
  }
  win?.setTitle(libelle());
}

function focus(): void {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 460,
    height: 340,
    title: libelle(),
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(app.getAppPath(), "electron", "index.html"));
  win.on("closed", () => { win = null; });
}

app.whenReady().then(async () => {
  const outcome = await boot({
    paths,
    onState: (s) => { etat = s; render(); },
    onAlert: (a) => { alertes.push(a); render(); },
    onLog: (l) => console.log(l),
    onFocusRequested: () => focus(), // une 2e instance demande a voir Sophia -> on se montre
    hooks: {
      // Phase 2 — tuer un sidecar orphelin d'un crash precedent AVANT de spawner (il tient micro/GPU).
      // Inconditionnel (F1). Le Supervisor re-nettoie au start (idempotent, pidfile+jeton M2).
      reapSidecarOrphan: () => supervisor.orphanCleanup(),
      // Phase 5 — le sidecar (T3). Un echec ne fait pas tomber le boot : elle vit sans voix.
      sidecarStart: async () => {
        await supervisor.start();
        return supervisor.currentState === "READY";
      },
      // Phase 5 — cmd.enroll.push / prewarm / politique de modeles / cmd.tts.cache : definis en 01/05.
      // Phases 1-4 — resetImmutabilityGuards / sweepPendingOps / loadAndVerifyIdentity : definis en 02/03.
      // Phase 4 — governorInit / claudeInit : T7/T8.
    },
  });

  if (outcome.kind === "SECONDARY") { app.quit(); return; }   // une Sophia veille deja : elle a le focus
  if (outcome.kind === "BLOCKED") {
    dialog.showErrorBox("Sophia n'a pas pu demarrer", outcome.reason); // jamais un echec muet
    app.quit();
    return;
  }

  session = outcome;
  tray = new Tray(couleur());
  if (!win) createWindow(); // NIT conv 35 : une 2e instance connectee PENDANT le boot a pu deja creer la
  // fenetre via onFocusRequested -> ne pas en ouvrir une seconde (fenetre orpheline).
  render();

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((e: Error) => {
  dialog.showErrorBox("Sophia n'a pas pu demarrer", e.message);
  app.quit();
});

// T5 : fermer la fenetre ne tue plus Sophia — elle vit dans le systray (elle ecoute).
app.on("window-all-closed", () => { /* on reste en vie */ });

// T6 — ARRET GRACIEUX. On prend la main sur la sortie (preventDefault) pour dérouler la séquence propre
// AVANT que le process meure : cmd.shutdown au sidecar (libère CUDA + flush) -> terminer le sidecar
// (SIGTERM->SIGKILL) -> drapeau « propre » DURABLE (running=0) -> teardown -> app.exit. Le drapeau propre
// est le dernier acte : un arret incomplet reste « sale » (T4). Le canal WS n'existe pas au socle (il vient
// avec le pipeline vocal, plan 01) -> IpcClient court-vécu vers le port du sidecar, le temps d'un cmd.shutdown.
// T6 — ARRET GRACIEUX. Le câblage (garde ré-entrant ①, garde-fou global ⑨, porte de vivacité ⑤, séquence
// gracefulShutdown) est extrait dans before-quit.ts pour être PROUVÉ par un smoke Electron réel (bancs/t6/
// smoke-electron) — main.ts lui-même n'a pas de test unitaire. Il prend la main sur la sortie
// (preventDefault), déroule l'arrêt propre (cmd.shutdown -> terminer -> running=0 durable -> teardown), app.exit.
installBeforeQuit(app, { getSession: () => session, supervisor, paths });
