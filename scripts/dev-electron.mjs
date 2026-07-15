// Lanceur Electron (dev) — HYGIENE D'ENVIRONNEMENT (cf. plan 00, T3).
//
// VS Code pose `ELECTRON_RUN_AS_NODE=1` dans le terminal integre. Avec cette variable,
// `electron.exe` s'execute comme un simple Node : `require('electron')` renvoie le CHEMIN
// du binaire (une string), pas l'API {app, BrowserWindow, ...} -> crash au demarrage.
// On la retire de l'environnement AVANT de lancer Electron.
//
// Ce lanceur prefigure ce que le SUPERVISEUR (T3) fera pour de vrai en spawnant le sidecar
// et l'orchestrateur : neutraliser les injecteurs d'env (ELECTRON_RUN_AS_NODE, PYTHON*, ...).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const electronPath = require("electron"); // le paquet npm exporte le chemin du binaire

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // <-- le correctif

const child = spawn(electronPath, ["."], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
