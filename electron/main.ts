import { app, BrowserWindow, Menu, Tray, nativeImage, dialog } from "electron";
import * as path from "path";
import type { BootStateSnapshot, BootAlert } from "../src/orchestrator/boot/index.js";
import { SophiaRuntime } from "./runtime.js";
import { resolvePaths } from "../src/orchestrator/paths.js";

// T5/T6/T7 : ce fichier est la VUE. Tout le CÂBLAGE (superviseur + boot + gouverneur + arrêt propre, dont la couture ⑩)
// vit dans `electron/runtime.ts` (SophiaRuntime), PARTAGÉ avec le smoke qui l'exerce en Electron réel — main.ts ne fait
// que L'AFFICHER (systray + voyant + titre). Rien n'est stocké ici : l'affichage est une vue DÉRIVÉE de l'état (O5),
// jamais une seconde vérité. (La politique GPU UI-vs-pipeline voix = RESSOURCES/plan 05, pas gravée au socle — conv 34.)

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let etat: BootStateSnapshot = { phase: "BOOTING", degraded: [], wake: null };
const alertes: BootAlert[] = [];

const paths = resolvePaths();
const runtime = new SophiaRuntime(app, paths, app.getAppPath(), {
  onState: (s) => { etat = s; render(); },
  onAlert: (a) => { alertes.push(a); render(); },
  onFocusRequested: () => focus(), // une 2e instance demande à voir Sophia -> on se montre
  onLog: (l) => console.log(l),
}, { audioEnabled: true }); // prod : la VRAIE appli lance le pipeline vocal en 2 process (oreilles + bouche). Le smoke garde le défaut OFF (structure).

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
      { label: "Quitter", click: () => app.quit() }, // -> before-quit (installé par SophiaRuntime) -> arret gracieux (T6)
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
  const outcome = await runtime.run(); // boot + superviseur + gouverneur + arrêt propre : câblés dans SophiaRuntime

  if (outcome.kind === "SECONDARY") { app.quit(); return; }   // une Sophia veille deja : elle a le focus
  if (outcome.kind === "BLOCKED") {
    dialog.showErrorBox("Sophia n'a pas pu demarrer", outcome.reason); // jamais un echec muet
    app.quit();
    return;
  }

  tray = new Tray(couleur());
  if (!win) createWindow(); // NIT conv 35 : une 2e instance connectee PENDANT le boot a pu deja creer la fenetre
  // via onFocusRequested -> ne pas en ouvrir une seconde (fenetre orpheline).
  render();

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((e: Error) => {
  dialog.showErrorBox("Sophia n'a pas pu demarrer", e.message);
  app.quit();
});

// T5 : fermer la fenetre ne tue plus Sophia — elle vit dans le systray (elle ecoute). L'arret gracieux (T6) est installe
// par SophiaRuntime (before-quit) ; « Quitter » du menu declenche app.quit() -> before-quit -> gracefulShutdown.
app.on("window-all-closed", () => { /* on reste en vie */ });
