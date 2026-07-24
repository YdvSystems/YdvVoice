// Runner de la suite de tests du socle. Lance TOUS les U-T* (ne s'arrête pas au premier échec
// -> on voit tout), imprime un récapitulatif, et sort en erreur si un seul échoue.
// Usage : `npm test` (qui compile d'abord). Ordre : les plus légers d'abord.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = ["u-t1.mjs", "u-t0.mjs", "u-t0-gitleaks.mjs", "u-t2.mjs", "u-t3.mjs", "u-t4.mjs", "u-t5.mjs", "i-t5.mjs", "u-t6.mjs", "u-t7.mjs", "u-t8.mjs", "u-m0.mjs", "u-m1.mjs", "u-warm.mjs", "u-states.mjs", "u-router.mjs", "u-portier-parity.mjs", "u-metrics.mjs", "u-residence.mjs", "u-phantoms.mjs", "u-ducking.mjs", "u-fallback.mjs"];

const summary = [];
for (const s of suites) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [path.join("tests", s)], { cwd: root, stdio: "inherit" });
  summary.push([s, r.status === 0]);
}

console.log("\n--- récapitulatif ---");
for (const [s, ok] of summary) console.log(`${ok ? "PASS" : "FAIL"}  ${s}`);
const allOk = summary.every(([, ok]) => ok);
console.log(allOk ? "\nTOUS LES TESTS DU SOCLE PASSENT" : "\nDES TESTS ONT ÉCHOUÉ");
process.exit(allOk ? 0 : 1);
