// u-phantoms — le BALAYAGE convergent des sidecars fantômes (conv 56, `src/orchestrator/supervisor/phantoms.ts`)
// avec des ops INJECTÉES (couture) : la POLITIQUE est prouvée déterministe, sans PowerShell ni vrais process.
// Couvre : terrain propre (aucun kill) · convergence (kill → re-census → kill → 0) · juge vivant (on ne touche à
// RIEN) · PowerShell absent (best-effort, jamais fatal) · survivants (budget épuisé → on démarre quand même) ·
// ops qui lève (jamais fatal).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { sweepPhantomSidecars } = require(path.join(root, "dist/src/orchestrator/supervisor/phantoms.js"));

const results = [];
const check = (n, c) => results.push([n, !!c]);

/** Fabrique d'ops scriptées : `censuses` = la suite des recensements servis (le dernier se répète) ;
 *  enregistre les kills et les sleeps. */
function fakeOps(censuses) {
  const kills = [];
  const sleeps = [];
  let i = 0;
  return {
    kills, sleeps,
    census: async () => {
      const c = censuses[Math.min(i, censuses.length - 1)];
      i++;
      return typeof c === "function" ? c() : c;
    },
    kill: async (pids) => { kills.push([...pids]); },
    sleep: async (ms) => { sleeps.push(ms); }, // pas d'attente réelle → test instantané
  };
}
const C = (sidecars = [], warm = [], juges = []) => ({ juges, warm, sidecars });

async function run() {
  // ── 1 — terrain PROPRE : aucun fantôme → aucun kill, outcome "clean" ──
  {
    const ops = fakeOps([C()]);
    const r = await sweepPhantomSidecars({ repoToken: "YdvVoice", ops });
    check("1: terrain propre → outcome clean", r.outcome === "clean");
    check("1: aucun kill tenté", ops.kills.length === 0);
  }

  // ── 2 — CONVERGENCE : 2 fantômes → 1 survivant (mort CUDA différée) → 0. Chaque passe re-tue ce qui reste. ──
  {
    const ops = fakeOps([C([111, 222], [333]), C([222]), C()]); // census initial → après kill 1 → après kill 2
    const logs = [];
    const r = await sweepPhantomSidecars({ repoToken: "YdvVoice", ops, onLog: (l) => logs.push(l) });
    check("2: outcome swept", r.outcome === "swept");
    check("2: passe 1 tue TOUS les fantômes (sidecars + warm)", ops.kills[0]?.join(",") === "111,222,333");
    check("2: passe 2 re-tue le survivant (222, mort différée)", ops.kills[1]?.join(",") === "222");
    check("2: killed = les PIDs distincts", [...r.killed].sort().join(",") === "111,222,333");
    check("2: le log dit le nettoyage", logs.some((l) => l.includes("nettoyage convergent")));
    check("2: le log dit la convergence", logs.some((l) => l.includes("propre (3 tué(s)")));
  }

  // ── 3 — JUGE VIVANT : on ne touche à RIEN (ses sidecars sont légitimes), outcome "skipped-juge" ──
  {
    const ops = fakeOps([C([111, 222], [], [999])]); // 2 sidecars + un juge PID 999
    const logs = [];
    const r = await sweepPhantomSidecars({ repoToken: "YdvVoice", ops, onLog: (l) => logs.push(l) });
    check("3: juge vivant → outcome skipped-juge", r.outcome === "skipped-juge");
    check("3: AUCUN kill (jamais tuer les sidecars du juge)", ops.kills.length === 0);
    check("3: le log nomme le juge", logs.some((l) => l.includes("juge") && l.includes("999")));
  }

  // ── 4 — POWERSHELL ABSENT : census null → best-effort, aucun kill, jamais fatal ──
  {
    const ops = fakeOps([null]);
    const r = await sweepPhantomSidecars({ repoToken: "YdvVoice", ops });
    check("4: PowerShell absent → outcome no-powershell", r.outcome === "no-powershell");
    check("4: aucun kill", ops.kills.length === 0);
  }

  // ── 5 — SURVIVANTS : un fantôme increvable (census constant) → budget épuisé, on DÉMARRE quand même ──
  {
    const ops = fakeOps([C([777])]); // toujours le même survivant
    const logs = [];
    const r = await sweepPhantomSidecars({ repoToken: "YdvVoice", ops, tries: 3, delayMs: 1 });
    const r2 = r; // lisibilité
    check("5: outcome survivors (budget épuisé)", r2.outcome === "survivors");
    check("5: le survivant est nommé", r2.survivors.join(",") === "777");
    check("5: 3 passes de kill tentées (tries=3)", ops.kills.length === 3);
  }

  // ── 7 — M-1 (croisé conv 56) : un JUGE DÉMARRE PENDANT la convergence → arrêt NET (jamais tuer ses sidecars frais) ──
  {
    const ops = fakeOps([C([111, 222]), C([333], [], [999])]); // census 2 : un juge (999) apparu + son sidecar frais (333)
    const logs = [];
    const r = await sweepPhantomSidecars({ repoToken: "YdvVoice", ops, onLog: (l) => logs.push(l) });
    check("7: juge apparu EN ROUTE → outcome skipped-juge (arrêt net de la convergence)", r.outcome === "skipped-juge");
    check("7: un SEUL kill (le census initial) — jamais les sidecars frais du juge", ops.kills.length === 1 && ops.kills[0].join(",") === "111,222");
    check("7: le log dit l'arrêt", logs.some((l) => l.includes("vient de démarrer")));
  }

  // ── 6 — OPS QUI LÈVE : jamais fatal (le boot continue) ──
  {
    const ops = { census: async () => { throw new Error("boom"); }, kill: async () => {}, sleep: async () => {} };
    let threw = false;
    let r = null;
    try { r = await sweepPhantomSidecars({ repoToken: "YdvVoice", ops }); } catch { threw = true; }
    check("6: une ops qui lève ne fait JAMAIS échouer le balayage (boot protégé)", !threw && r?.outcome === "no-powershell");
  }

  // ── bilan ──
  let fail = 0;
  for (const [n, ok] of results) { console.log(`${ok ? "OK   " : "ECHEC"} ${n}`); if (!ok) fail++; }
  if (fail) { console.error(`\nu-phantoms : ${fail} échec(s)`); process.exit(1); }
  console.log(`\nu-phantoms OK : le balayage fantômes (${results.length} vérifs) — propre/convergence/juge/best-effort/survivants`);
}

run().catch((e) => { console.error(e); process.exit(1); });
