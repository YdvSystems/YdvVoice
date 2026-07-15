import { contextBridge } from "electron";

// Socle T0 : surface minimale exposee au rendu, contextIsolation active
// (nodeIntegration off, sandbox on). S'etoffera (etat derive, sante) aux
// couches suivantes — l'UI reste une VUE DERIVEE de l'etat (doc 99, O5).
contextBridge.exposeInMainWorld("sophia", {
  socle: "T0",
  version: "0.0.0",
});
