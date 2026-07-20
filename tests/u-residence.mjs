// u-residence — la RÉSIDENCE DES MODÈLES (V11, ModelResidence) — pure, sans sidecar ni gouverneur réel. Couvre :
// mapping état d'écoute → groupe voix · politique initiale au start · émission SUR transition + dé-doublonnage ·
// repli des calques (SECOURS/JEU) + ré-émission sur onGovernorMode · abonnement/réaction aux evt.model.* ·
// stop() coupe les émissions · un logger qui lève ne casse jamais la résidence.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ModelResidence, voiceGroupFor } = require(path.join(root, "dist/src/orchestrator/voice/residence.js"));

const results = [];
const check = (n, c) => results.push([n, !!c]);

/** Faux IpcClient (oreilles) : capture les cmd.model.policy émises + permet de tirer des evt.model.*. */
function fakeIpc() {
  const requests = []; // [type, payload]
  const listeners = {};
  return {
    requests,
    request(type, payload) { requests.push([type, payload]); return Promise.resolve({}); },
    on(evt, h) { (listeners[evt] ??= []).push(h); },
    fire(evt, payload) { (listeners[evt] ?? []).forEach((h) => h({ type: evt, id: "x", ts: 0, payload })); },
    policies() { return requests.filter(([t]) => t === "cmd.model.policy").map(([, p]) => p); },
  };
}

/** Faux gouverneur : hasMode lit un Set de calques (mutable pour simuler doc 05 qui les pose). */
function fakeGov(modes = new Set()) { return { modes, hasMode: (l) => modes.has(l) }; }

// ── A — voiceGroupFor : le mapping état d'écoute → groupe voix ──
{
  check("A: veille → veille", voiceGroupFor("veille") === "veille");
  check("A: pause → veille (PAUSE comme VEILLE côté sidecar)", voiceGroupFor("pause") === "veille");
  check("A: ecoute → conversation", voiceGroupFor("ecoute") === "conversation");
  check("A: dictee → conversation", voiceGroupFor("dictee") === "conversation");
  check("A: approbation → conversation", voiceGroupFor("approbation") === "conversation");
}

// ── B — start() émet la politique INITIALE (groupe veille, calques faux) — un sidecar frais n'en a aucune (S10) ──
{
  const ears = fakeIpc();
  const r = new ModelResidence({ ears, governor: fakeGov() });
  check("B: aucune émission avant start", ears.policies().length === 0);
  r.start();
  const pols = ears.policies();
  check("B: start émet 1 politique initiale", pols.length === 1);
  check("B: initiale = groupe veille", pols[0].group === "veille");
  check("B: initiale = calques faux", pols[0].layers.secours === false && pols[0].layers.jeu === false);
  check("B: current() reflète la politique", r.current().group === "veille");
}

// ── C — onVoiceState : la politique SUIT l'état, avec dé-doublonnage (jamais de commande redondante) ──
{
  const ears = fakeIpc();
  const r = new ModelResidence({ ears, governor: fakeGov() });
  r.start(); // veille (1)
  r.onVoiceState("ecoute"); // → conversation (2)
  check("C: ecoute → conversation émise", ears.policies().at(-1).group === "conversation");
  r.onVoiceState("approbation"); // conversation (déjà) → DÉ-DOUBLONNÉ (pas de nouvelle émission)
  check("C: approbation (déjà conversation) → PAS de ré-émission (dé-doublonnage)", ears.policies().length === 2);
  r.onVoiceState("veille"); // → veille (3)
  check("C: veille → nouvelle politique veille", ears.policies().length === 3 && ears.policies().at(-1).group === "veille");
  r.onVoiceState("pause"); // veille (déjà) → dé-doublonné
  check("C: pause (→ veille, déjà) → dé-doublonné", ears.policies().length === 3);
}

// ── D — les CALQUES du gouverneur (SECOURS/JEU) entrent dans la politique + onGovernorMode ré-émet sur changement ──
{
  const ears = fakeIpc();
  const modes = new Set();
  const r = new ModelResidence({ ears, governor: fakeGov(modes) });
  r.start(); // veille, sans calque (1)
  check("D: initiale sans calque", ears.policies().at(-1).layers.jeu === false);
  modes.add("JEU"); // doc 05 pose JEU
  r.onGovernorMode(); // → ré-émet (2)
  check("D: onGovernorMode après JEU posé → politique avec jeu:true", ears.policies().at(-1).layers.jeu === true);
  check("D: le groupe est inchangé (toujours veille)", ears.policies().at(-1).group === "veille");
  r.onGovernorMode(); // rien n'a changé → dé-doublonné
  check("D: onGovernorMode sans changement → dé-doublonné", ears.policies().length === 2);
  modes.add("SECOURS");
  r.onGovernorMode(); // → ré-émet (3)
  check("D: SECOURS posé → politique avec secours:true", ears.policies().at(-1).layers.secours === true && ears.policies().length === 3);
}

// ── E — les deux axes composent : un changement d'état RE-porte les calques courants ──
{
  const ears = fakeIpc();
  const modes = new Set(["JEU"]);
  const r = new ModelResidence({ ears, governor: fakeGov(modes) });
  r.start(); // veille +jeu (1)
  r.onVoiceState("ecoute"); // conversation +jeu (2)
  const p = ears.policies().at(-1);
  check("E: conversation garde le calque jeu (les deux axes composent)", p.group === "conversation" && p.layers.jeu === true);
}

// ── F — abonnement aux evt.model.* : la résidence les journalise (vue O5), sans lever ──
{
  const ears = fakeIpc();
  const logs = [];
  const r = new ModelResidence({ ears, governor: fakeGov(), onLog: (l) => logs.push(l) });
  r.start();
  ears.fire("evt.model.loaded", { model: "stt", device: "cuda", vram_mb: 2100, degraded: false });
  check("F: evt.model.loaded journalisé (device+vram)", logs.some((l) => l.includes("evt.model.loaded") && l.includes("cuda")));
  ears.fire("evt.model.loaded", { model: "stt", device: "cpu", vram_mb: 0, degraded: true });
  check("F: evt.model.loaded dégradé signalé (repli CPU)", logs.some((l) => l.includes("DÉGRADÉ")));
  ears.fire("evt.model.unloaded", { model: "stt", reason: "stop" });
  check("F: evt.model.unloaded journalisé", logs.some((l) => l.includes("evt.model.unloaded") && l.includes("stop")));
}

// ── G — stop() coupe toute émission ultérieure (quiesce) ──
{
  const ears = fakeIpc();
  const r = new ModelResidence({ ears, governor: fakeGov() });
  r.start();
  const before = ears.policies().length;
  r.stop();
  r.onVoiceState("ecoute"); // après stop → aucune émission
  r.onGovernorMode();
  check("G: aucune émission après stop()", ears.policies().length === before);
}

// ── H — sans gouverneur (null) : les calques sont faux, jamais d'exception ──
{
  const ears = fakeIpc();
  const r = new ModelResidence({ ears, governor: null });
  r.start();
  check("H: sans gouverneur → calques faux", ears.policies().at(-1).layers.secours === false && ears.policies().at(-1).layers.jeu === false);
}

// ── I — un logger qui LÈVE ne casse jamais la résidence (l'émission a lieu quand même) ──
{
  const ears = fakeIpc();
  const r = new ModelResidence({ ears, governor: fakeGov(), onLog: () => { throw new Error("logger cassé"); } });
  r.start(); // le log de l'émission initiale lève → doit être capturé
  check("I: la politique est émise malgré le logger qui lève", ears.policies().length === 1);
}

// ── récapitulatif ──
let ok = 0;
for (const [n, c] of results) { console.log(`${c ? "ok  " : "FAIL"} ${n}`); if (c) ok++; }
console.log(`\nu-residence : ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
