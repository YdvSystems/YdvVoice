// u-states — la MACHINE DES ÉTATS D'ÉCOUTE (V9, ListenState) — pure, sans IPC ni sidecar. Couvre : état initial
// VEILLE · transitions VEILLE↔ÉCOUTE↔PAUSE · idempotence (no-op sans re-notification) · gardes (pause hors ÉCOUTE,
// reprise hors PAUSE) · onEnter reçoit (mode, prev) · un onEnter qui lève ne fige jamais la machine.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ListenState } = require(path.join(root, "dist/src/orchestrator/voice/states.js"));

const results = [];
const check = (n, c) => results.push([n, !!c]);

function setup() {
  const enters = []; // [mode, prev]
  const logs = [];
  const st = new ListenState({ onEnter: (m, p) => enters.push([m, p]), onLog: (l) => logs.push(l) });
  return { st, enters, logs };
}

// ── A — état initial = VEILLE, aucune notification au démarrage ──
{
  const { st, enters } = setup();
  check("A: état initial VEILLE", st.current === "veille");
  check("A: aucun onEnter au démarrage (l'init ne notifie pas)", enters.length === 0);
}

// ── B — réveil : VEILLE → ÉCOUTE (onEnter ecoute, prev veille) ──
{
  const { st, enters } = setup();
  st.wake();
  check("B: VEILLE → ÉCOUTE", st.current === "ecoute");
  check("B: onEnter(ecoute, veille)", enters.length === 1 && enters[0][0] === "ecoute" && enters[0][1] === "veille");
}

// ── C — clôture : ÉCOUTE → VEILLE ──
{
  const { st, enters } = setup();
  st.wake(); st.close();
  check("C: ÉCOUTE → VEILLE (clôture)", st.current === "veille");
  check("C: 2 transitions (ecoute puis veille)", enters.length === 2 && enters[1][0] === "veille" && enters[1][1] === "ecoute");
}

// ── D — pause : ÉCOUTE → PAUSE, puis reprise PAUSE → ÉCOUTE ──
{
  const { st, enters } = setup();
  st.wake(); st.pause();
  check("D: ÉCOUTE → PAUSE", st.current === "pause");
  check("D: onEnter(pause, ecoute)", enters[1][0] === "pause" && enters[1][1] === "ecoute");
  st.resume();
  check("D: PAUSE → ÉCOUTE (reprise)", st.current === "ecoute");
  check("D: onEnter(ecoute, pause)", enters[2][0] === "ecoute" && enters[2][1] === "pause");
}

// ── E — idempotence : une transition vers le même état = NO-OP (pas de re-notification) ──
{
  const { st, enters } = setup();
  st.wake(); st.wake(); // 2e wake alors qu'on est déjà en ÉCOUTE
  check("E: wake idempotent (reste ÉCOUTE)", st.current === "ecoute");
  check("E: un SEUL onEnter (le 2e wake est no-op)", enters.length === 1);
  st.close(); st.close(); // 2e close en VEILLE
  check("E: close idempotent (une seule notification veille)", enters.length === 2);
}

// ── F — gardes : pause HORS ÉCOUTE = no-op ; reprise HORS PAUSE = no-op (journalisées) ──
{
  const { st, enters, logs } = setup();
  st.pause(); // depuis VEILLE
  check("F: pause depuis VEILLE = no-op (reste VEILLE)", st.current === "veille" && enters.length === 0);
  check("F: pause hors ÉCOUTE journalisée", logs.some((l) => l.includes("pause ignorée")));
  st.wake(); st.resume(); // resume depuis ÉCOUTE (pas PAUSE)
  check("F: reprise hors PAUSE = no-op (reste ÉCOUTE)", st.current === "ecoute" && enters.length === 1);
  check("F: reprise hors PAUSE journalisée", logs.some((l) => l.includes("reprise ignorée")));
}

// ── G — clôture depuis PAUSE → VEILLE (la clôture ferme depuis n'importe quel état) ──
{
  const { st } = setup();
  st.wake(); st.pause(); st.close();
  check("G: PAUSE → VEILLE (clôture depuis pause)", st.current === "veille");
}

// ── H — un onEnter qui LÈVE ne fige jamais la machine (l'état change quand même, l'exception est capturée) ──
{
  const logs = [];
  const st = new ListenState({ onEnter: () => { throw new Error("consommateur cassé"); }, onLog: (l) => logs.push(l) });
  st.wake();
  check("H: l'état a changé malgré l'onEnter qui lève", st.current === "ecoute");
  check("H: l'exception onEnter est journalisée, pas propagée", logs.some((l) => l.includes("onEnter a levé")));
}

// ── récapitulatif ──
let ok = 0;
for (const [n, c] of results) { console.log(`${c ? "ok  " : "FAIL"} ${n}`); if (c) ok++; }
console.log(`\nu-states : ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
