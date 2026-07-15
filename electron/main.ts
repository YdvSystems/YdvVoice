import { app, BrowserWindow } from "electron";
import * as path from "path";

// NOTE conv 34 : la desactivation GPU (disableHardwareAcceleration + --disable-gpu) etait une mesure
// TEMPORAIRE pour proteger le fine-tune voix qui tournait EN PARALLELE sur le 2060. Ce travail est
// termine -> mesure RETIREE (retour au defaut Electron). La vraie politique « l'UI partage-t-elle le
// GPU avec le pipeline voix (STT sur le 2060, VRAM tendue) ? » est une decision de RESSOURCES =
// plan/05, tranchee la-bas, PAS gravee dans le socle (Garde-fou Phase 3). Voir plan/00 §7.

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 460,
    height: 340,
    title: "Sophia — socle (T0)",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(path.join(app.getAppPath(), "electron", "index.html"));
  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// T0 : sur Windows, quitter quand la fenetre se ferme. Le vrai cycle de vie
// (veille, systray, arret gracieux) = T5/T6.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
