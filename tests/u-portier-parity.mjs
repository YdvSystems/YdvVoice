// u-portier-parity — PROUVE que la grille TS (src/orchestrator/voice/portier.ts) rend un verdict IDENTIQUE au
// VRAI portier Python (sidecar/consumers/stt.py) sur un corpus (« testée identique au portier », plan/01 morceau C).
// C'est ce qui FERME le risque de l'option (a) : une divergence Python↔TS rendrait routeur et sidecar incohérents
// (l'un ferme la conversation, l'autre pas). On fait tourner le vrai portier (tests/portier_ref.py) et on compare
// verdict par verdict (norm, opening, closing, goodnight, halluc). Skip si .venv-sidecar absent.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const grille = require(path.join(root, "dist/src/orchestrator/voice/portier.js"));
const PY = process.env.SIDECAR_PYTHON || path.join(root, ".venv-sidecar", "Scripts", "python.exe");

if (!fs.existsSync(PY)) { console.log("SKIP  u-portier-parity : .venv-sidecar absent (pytest non installé ici)."); process.exit(0); }

// Corpus : ouvreurs / clôtures / bonne nuit / hallucinations / bords (Sophie≠Sophia, apostrophes, accents, casse,
// ponctuation, « sofia », vide). Doit exercer CHAQUE branche des fonctions pures.
const CORPUS = [
  // ouvreurs (opening=true)
  "Bonjour Sophia", "Bonsoir Sophia.", "Dis-moi Sophia", "dis moi sophia", "Salut Sophia !",
  "Bonne nuit Sophia", "sofia bonjour", "Bonjour Sofia,", "EH, DIS-MOI SOPHIA",
  // PAS des ouvreurs (opening=false)
  "Bonjour Sophie", "Salut Sonia", "Bonjour", "Sophia", "dis-moi quelque chose",
  // clôtures (closing=true : « sophia » + marqueur)
  "Merci Sophia, à plus tard", "Sophia, à bientôt.", "à tout à l'heure Sophia", "on s'arrête Sophia",
  "Sophia au revoir", "à demain sophia", "Merci Sophia. On arrête pour aujourd'hui.",
  // PAS des clôtures (closing=false)
  "Merci Sophia", "à plus tard", "au revoir tout le monde", "Sophia raconte-moi une blague",
  // bonne nuit (goodnight=true)
  "Bonne nuit Sophia", "bonne nuit", "BONNE NUIT", "Allez, bonne nuit Sophia.",
  // hallucinations / vide (halluc=true)
  "", "   ", "Sous-titrage ST' 501", "Merci d'avoir regardé cette vidéo",
  "Abonnez-vous à la chaîne", "Amara.org", "Merci de votre attention", "...",
  // vraies phrases (halluc=false)
  "Quelle heure est-il ?", "Raconte-moi une histoire courte", "Il fait beau aujourd'hui à Paris",
  // bords de normalisation
  "Bonjour   Sophia…", "DIS-MOI  SOPHIA ??", "à\tplus\ttard sophia", "Ça va, Sophia ?",
];

// verdicts TS
const tsV = CORPUS.map((t) => ({
  norm: grille.norm(t), opening: grille.matchOpening(t), closing: grille.matchClosing(t),
  goodnight: grille.isGoodnight(t), halluc: grille.isHallucination(t),
}));

// verdicts Python (vrai portier)
const py = spawn(PY, [path.join(root, "tests", "portier_ref.py")], { cwd: root, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
let out = "", perr = "";
py.stdout.on("data", (d) => { out += d.toString(); });
py.stderr.on("data", (d) => { perr += d.toString(); });
const done = new Promise((res, rej) => { py.on("exit", res); py.on("error", rej); });
py.stdin.write(CORPUS.map((t) => JSON.stringify(t)).join("\n") + "\n");
py.stdin.end();
await done;

const results = [];
const check = (n, c) => results.push([n, !!c]);

const pyV = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
check(`portier Python a produit ${CORPUS.length} verdicts`, pyV.length === CORPUS.length);
if (pyV.length !== CORPUS.length) console.error("--- stderr python ---\n", perr.slice(-1500));

let divergences = 0;
for (let i = 0; i < CORPUS.length && i < pyV.length; i++) {
  const a = tsV[i], b = pyV[i];
  const same = a.norm === b.norm && a.opening === b.opening && a.closing === b.closing
    && a.goodnight === b.goodnight && a.halluc === b.halluc;
  if (!same) { divergences++; console.error(`DIVERGENCE « ${CORPUS[i]} »\n  TS: ${JSON.stringify(a)}\n  PY: ${JSON.stringify(b)}`); }
}
check("ZÉRO divergence TS↔Python sur tout le corpus", divergences === 0);

// sanité : la grille fait le BON travail (pas seulement « identique à un python buggé »).
check("« Bonjour Sophia » = ouvreur", grille.matchOpening("Bonjour Sophia"));
check("« Bonjour Sophie » n'est PAS un ouvreur (distingue Sophie)", !grille.matchOpening("Bonjour Sophie"));
check("« Merci Sophia, à plus tard » = clôture", grille.matchClosing("Merci Sophia, à plus tard"));
check("« Merci Sophia » (sans marqueur) n'est PAS une clôture", !grille.matchClosing("Merci Sophia"));
check("« Bonne nuit Sophia » = bonne nuit", grille.isGoodnight("Bonne nuit Sophia"));
check("« Sous-titrage… » = hallucination", grille.isHallucination("Sous-titrage ST' 501"));
check("« Quelle heure est-il ? » n'est PAS une hallucination", !grille.isHallucination("Quelle heure est-il ?"));
check("no_speech_prob > 0.80 → hallucination", grille.isHallucination("bonjour", 0.9));

for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
const failed = results.filter(([, ok]) => !ok);
if (failed.length === 0) console.log("\nu-portier-parity OK : la grille TS est IDENTIQUE au portier Python (option a fermée par construction)");
else console.error(`\nu-portier-parity ÉCHEC : ${failed.length} critère(s)`);
process.exit(failed.length === 0 ? 0 : 1);
