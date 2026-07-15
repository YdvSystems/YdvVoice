// U-T0 — smoke du socle : le sidecar répond `GET /health`.
// (L'ouverture d'Electron + la preuve GPU intouché = vérification observée, hors de ce smoke.)
// Lance le sidecar sur un port de test dédié, poll /health, vérifie {ok, ready}, puis l'arrête.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8771; // port de test dédié (distinct du dev 8770)
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");

const proc = spawn(PY, ["sidecar/server.py", String(PORT)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

let ok = false;
try {
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.status === 200) {
        const j = await r.json();
        if (j.ok === true && j.ready === true) { ok = true; break; }
      }
    } catch {
      // serveur pas encore prêt : on retente
    }
  }
} finally {
  proc.kill();
}

if (ok) {
  console.log("U-T0 OK : sidecar /health répond { ok: true, ready: true }");
  process.exit(0);
} else {
  console.error("U-T0 ÉCHEC : /health n'a pas répondu correctement");
  process.exit(1);
}
