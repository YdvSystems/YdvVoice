// U-T0-gitleaks — prouve que la garde secret du repo PUBLIC bloque un secret. fid5 (croisé conv 34).
// Deux volets, sans dépendre d'un `bash` (fragile : WSL vs Git Bash) :
//   (1) CONSTRUCTION : le hook pre-commit invoque bien `gitleaks git --staged` (la commande testée) ;
//   (2) COMPORTEMENT : dans un dépôt git JETABLE, `gitleaks git --staged` laisse passer le propre et
//       BLOQUE (exit != 0) un secret stagé.
// SKIP bruyant (exit 0) si git ou gitleaks manquent — jamais un faux PASS silencieux.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = path.join(root, ".githooks", "pre-commit");

function has(cmd, args) {
  try { return spawnSync(cmd, args, { encoding: "utf8" }).status === 0; } catch { return false; }
}

const results = [];
const check = (n, c) => results.push([n, !!c]);

// (1) CONSTRUCTION : le hook existe ET invoque `gitleaks git --staged`.
if (!fs.existsSync(hookPath)) { console.error("U-T0-gitleaks ÉCHEC : .githooks/pre-commit introuvable"); process.exit(1); }
const hookSrc = fs.readFileSync(hookPath, "utf8");
check("le hook pre-commit invoque `gitleaks git --staged`", /gitleaks\s+git\s+--staged/.test(hookSrc));

// (2) COMPORTEMENT — requiert git + gitleaks (sinon SKIP bruyant).
if (!has("git", ["--version"]) || !has("gitleaks", ["version"])) {
  console.log("U-T0-gitleaks : volet COMPORTEMENT sauté (git ou gitleaks indisponible) — construction OK");
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sophia-hook-"));
  const git = (args) => spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
  const scan = () => spawnSync("gitleaks", ["git", "--staged", "--no-banner"], { cwd: tmp, encoding: "utf8" }).status;
  try {
    git(["init", "-q"]);
    git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
    fs.writeFileSync(path.join(tmp, "README.md"), "ok\n");
    git(["add", "README.md"]); git(["commit", "-q", "-m", "init"]);

    // propre stagé -> aucun secret -> exit 0
    fs.writeFileSync(path.join(tmp, "clean.txt"), "rien de secret ici\n");
    git(["add", "clean.txt"]);
    check("gitleaks --staged laisse passer le propre (exit 0)", scan() === 0);

    // faux secret stagé (GitHub PAT factice, règle github-pat) -> BLOQUE (exit != 0).
    // Construit par CONCATÉNATION : le littéral complet n'existe PAS dans ce fichier (sinon NOTRE
    // propre hook bloquerait le commit de ce test). 4 + 36 caractères.
    const fakePat = "ghp_" + "1234567890abcdefghijklmnopqrstuvwx12";
    fs.writeFileSync(path.join(tmp, "leak.env"), `gh=${fakePat}\n`);
    git(["add", "leak.env"]);
    check("gitleaks --staged BLOQUE un secret stagé (exit != 0)", scan() !== 0);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  }
}

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) { console.log("\nU-T0-gitleaks OK : la garde secret bloque un secret"); process.exit(0); }
console.error(`\nU-T0-gitleaks ÉCHEC : ${failed.length} critère(s)`); process.exit(1);
