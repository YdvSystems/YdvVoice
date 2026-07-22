// u-router — le ROUTEUR de conversation (V7 morceau C) avec un FAUX IPC + un FAUX cerveau (déterministe, sans
// sidecar ni claude). Couvre : salutation miroir (éveil, chemins lent ET rapide) · éveil-clôture (bonne nuit) ·
// tour de conversation (streaming → cmd.tts) · clôture (au revoir, PAS de cerveau) · GATE b2/busy (ne se répond pas
// à elle-même) · filtre hallucination/vide · masqueur (cerveau lent) · secours (isError SANS onDelta) · deadline
// done F-A (evt.tts.done jamais reçu → gate débloqué) · prewarm à l'éveil · quiesce (stop).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ConversationRouter } = require(path.join(root, "dist/src/orchestrator/voice/router.js"));
const { matchPause, matchOpening } = require(path.join(root, "dist/src/orchestrator/voice/portier.js"));

const results = [];
const check = (n, c) => results.push([n, !!c]);

// ── Faux IPC : enregistre les cmd.tts.* ; émet les evt.* aux handlers du routeur ; complète les énonciations à la
//    demande (simule le sidecar qui finit de jouer → evt.tts.done). PAS d'auto-complétion → le test drive tout. ──
class FakeIpc {
  constructor() { this.handlers = new Map(); this.cmds = []; this.openIds = new Set(); this.doneIds = new Set(); }
  on(type, h) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(h); }
  request(type, payload = {}) {
    this.cmds.push({ type, id: payload.id, text: payload.text, from: payload.from, name: payload.name });
    if (type === "cmd.tts.speak" || type === "cmd.tts.clip") this.openIds.add(payload.id); // V10 : le clip s'ouvre comme une énonciation
    return Promise.resolve({ type: "evt.ack", id: "x", ts: 0, payload: { ok: true, for: type } });
  }
  listen(kind) { return this.cmds.filter((c) => c.type === `cmd.listen.${kind}`); }
  emit(type, payload = {}) { const env = { type, id: "s", ts: 0, payload }; for (const h of (this.handlers.get(type) ?? [])) h(env); }
  complete() { for (const id of [...this.openIds]) if (!this.doneIds.has(id)) { this.doneIds.add(id); this.emit("evt.tts.done", { id, reason: "completed" }); } this.openIds.clear(); }
  tts(kind) { return this.cmds.filter((c) => c.type === `cmd.tts.${kind}`); }
  pushedAll() { return this.cmds.filter((c) => c.type === "cmd.tts.push").map((c) => c.text); }
}

// ── Faux cerveau : ask() rend une promesse que le test résout (finish) ; delta() streame via onDelta. prewarm compté. ──
class FakeBrain {
  constructor() { this.calls = []; this.prewarms = 0; }
  prewarm() { this.prewarms++; }
  ask(text, opts = {}) {
    const call = { text, onDelta: opts.onDelta, signal: opts.signal, aborted: false, resolve: null };
    // V8 : le WarmBrain honore `signal` (barge-in/quiesce → AskResult aborted) ; le faux le simule (abandon → aborted).
    if (opts.signal) opts.signal.addEventListener("abort", () => { call.aborted = true; call.resolve?.({ isError: false, aborted: true, text: "" }); }, { once: true });
    this.calls.push(call);
    return new Promise((res) => { call.resolve = res; });
  }
  last() { return this.calls[this.calls.length - 1]; }
  delta(s) { this.last().onDelta?.(s); }
  finish(r = {}) { this.last().resolve({ isError: false, aborted: false, text: "", ...r }); }
}

const CFG = { fillerAfterMs: 60, gateTailMs: 30, doneDeadlineMs: 120, greetFallbackMs: 60 };
function setup(over = {}) {
  const ipc = new FakeIpc();
  const brain = new FakeBrain();
  const logs = [];
  const router = new ConversationRouter({ ipc, brain, onLog: (l) => logs.push(l), ...CFG, ...over });
  router.start();
  return { ipc, brain, router, logs };
}
const TICK = 25; // marge microtasks + envois

async function run() {
  // ── A — salutation MIROIR, chemin LENT (final AVANT wake) ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" });
    ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK);
    check("A: prewarm déclenché à l'éveil", brain.prewarms === 1);
    check("A: salutation miroir « Bonjour Yohann. » poussée", ipc.pushedAll().includes("Bonjour Yohann."));
    check("A: 1 énonciation (speak) pour la salutation", ipc.tts("speak").length === 1);
    check("A: le cerveau n'est PAS appelé pour saluer", brain.calls.length === 0);
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── B — salutation, chemin RAPIDE (wake AVANT final) ──
  {
    const { ipc } = setup();
    ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK);
    check("B: rien poussé tant que le final n'est pas là (appariement différé)", ipc.tts("push").length === 0);
    ipc.emit("evt.stt.final", { text: "Salut Sophia" });
    await sleep(TICK);
    check("B: salutation « Salut Yohann. » poussée au final apparié", ipc.pushedAll().includes("Salut Yohann."));
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── C — éveil-clôture « bonne nuit Sophia » ──
  {
    const { ipc } = setup();
    ipc.emit("evt.stt.final", { text: "Bonne nuit Sophia" });
    ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK);
    check("C: « bonne nuit » → réponse bonne nuit (placeholder)", ipc.pushedAll().some((t) => /bonne nuit/i.test(t)));
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── D — tour de conversation : streaming cerveau → cmd.tts ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Quelle heure est-il ?" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    check("D: le cerveau est appelé avec le transcript", brain.calls.length === 1 && brain.last().text === "Quelle heure est-il ?");
    check("D: aucune énonciation ouverte AVANT le 1er delta (lazy)", ipc.tts("speak").length === 0);
    brain.delta("Il est "); brain.delta("midi pile.");
    await sleep(TICK);
    check("D: 1 énonciation ouverte au 1er delta", ipc.tts("speak").length === 1);
    check("D: les deltas sont poussés au fil", ipc.pushedAll().join("") === "Il est midi pile.");
    brain.finish({ isError: false, text: "Il est midi pile." });
    await sleep(TICK);
    check("D: cmd.tts.end émis après la réponse", ipc.tts("end").length === 1);
    check("D: pas de prewarm sur un tour (seulement à l'éveil)", brain.prewarms === 0);
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── EX (conv 53) — ARCHIVE : onExchange reçoit les DEUX voix à la fin du tour (le journal d'échanges) ──
  {
    const exchanges = [];
    const { ipc, brain } = setup({ onExchange: (e) => exchanges.push(e) });
    ipc.emit("evt.stt.final", { text: "Qui es-tu ?" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Je suis "); brain.delta("Sophia.");
    brain.finish({ isError: false, text: "Je suis Sophia." });
    await sleep(TICK);
    check("EX: 1 archive, avec TES mots ET SES mots", exchanges.length === 1
      && exchanges[0].user === "Qui es-tu ?" && exchanges[0].sophia === "Je suis Sophia.");
    check("EX: l'archive porte un horodatage", typeof exchanges[0]?.ts === "number");
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── EX2 — l'archive N'INVENTE PAS : un tour de SECOURS (rien voisé) ne produit aucune entrée ──
  {
    const exchanges = [];
    const { ipc, brain } = setup({ onExchange: (e) => exchanges.push(e) });
    ipc.emit("evt.stt.final", { text: "Une question." });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.finish({ isError: true, text: "" });   // cerveau en erreur, aucun delta → secours dit par le routeur
    await sleep(TICK);
    check("EX2: aucun échange archivé si rien n'a été voisé (secours)", exchanges.length === 0);
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── E — clôture « Merci Sophia, à plus tard » → au revoir, PAS de cerveau ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Merci Sophia, à plus tard" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    check("E: clôture → le cerveau n'est PAS appelé", brain.calls.length === 0);
    check("E: une phrase de clôture est prononcée", ipc.tts("push").length === 1 && ipc.tts("speak").length === 1);
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── F — GATE b2 : un evt.turn.end PENDANT qu'elle parle est IGNORÉ (elle ne se répond pas à elle-même) ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Première question" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Je réponds."); // énonciation ouverte → elle « parle » (busy)
    await sleep(TICK);
    // résidu de sa voix pendant qu'elle parle → un faux tour :
    ipc.emit("evt.stt.final", { text: "Deuxième question résiduelle" });
    ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(TICK);
    check("F: le 2e tour (pendant qu'elle parle) est IGNORÉ — cerveau appelé UNE fois", brain.calls.length === 1);
    brain.finish({ text: "Je réponds." });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── G — filtre : un tour VIDE / hallucination ne réveille pas le cerveau ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    check("G: tour vide → cerveau non appelé", brain.calls.length === 0);
    await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Sous-titrage ST' 501" }); // hallucination Whisper
    ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(TICK);
    check("G: hallucination Whisper → cerveau non appelé", brain.calls.length === 0);
  }

  // ── H — masqueur : cerveau lent > fillerAfter → une phrase d'attente joue AVANT la réponse ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Explique-moi la relativité" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    await sleep(CFG.fillerAfterMs + TICK); // laisse le masqueur partir (cerveau muet)
    const afterFiller = ipc.pushedAll().length;
    check("H: masqueur joué (cerveau lent) — une phrase poussée avant tout delta", afterFiller >= 1);
    brain.delta("La relativité, c'est la façon dont le temps et l'espace se lient.");
    await sleep(TICK);
    check("H: la réponse est poussée APRÈS le masqueur", ipc.pushedAll().length > afterFiller);
    check("H: masqueur + réponse = 2 énonciations distinctes", ipc.tts("speak").length === 2);
    brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── H2 (V10 conv 52) — hmm de réflexion : clip caché joué AVANT le masqueur (comble le petit blanc précoce) ──
  // conv 55 : hmmProbability:1 → hmm FORCÉ (le hmm est aléatoire par défaut ; ici on teste le mécanisme, pas l'aléa).
  {
    const { ipc, brain, logs } = setup({ hmmAfterMs: 40, fillerAfterMs: 200, hmmProbability: 1 });
    ipc.emit("evt.stt.final", { text: "Explique-moi la relativité" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    await sleep(60); // > hmmAfter (40), < fillerAfter (200) → le hmm est parti, PAS encore le masqueur
    const clips = ipc.tts("clip");
    check("H2: hmm joué en CLIP (cmd.tts.clip name='hmm')", clips.length === 1 && clips[0].name === "hmm");
    check("H2: log « hmm joué »", logs.some((l) => l.startsWith("hmm joué")));
    check("H2: la phrase longue N'est PAS encore partie (reste à 2,5 s)", !ipc.pushedAll().includes("Donne-moi une petite minute."));
    const hmmId = clips[0].id;
    await sleep(200); // dépasse fillerAfter (200) → le masqueur part AUSSI (tour vraiment lent)
    check("H2: puis le masqueur (les deux comblent)", ipc.pushedAll().includes("Donne-moi une petite minute."));
    const fillerId = ipc.tts("speak")[0]?.id;
    check("H2: le hmm (id) part AVANT le masqueur (id)", typeof hmmId === "number" && typeof fillerId === "number" && hmmId < fillerId);
    brain.delta("La relativité lie le temps et l'espace.");
    await sleep(TICK);
    check("H2: la réponse est poussée APRÈS", ipc.pushedAll().includes("La relativité lie le temps et l'espace."));
    brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── H2b (conv 55) — hmm ALÉATOIRE : si le tirage rate la proba (random ≥ hmmProbability), le hmm est SAUTÉ ──
  {
    const { ipc, brain, logs } = setup({ hmmAfterMs: 40, fillerAfterMs: 200, hmmProbability: 0.6, random: () => 0.9 });
    ipc.emit("evt.stt.final", { text: "Explique-moi la relativité" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    await sleep(60); // > hmmAfter (40) : le hmm AURAIT dû partir — mais 0.9 ≥ 0.6 → sauté
    check("H2b: random ≥ proba → AUCUN hmm (sauté)", ipc.tts("clip").length === 0);
    check("H2b: log « hmm sauté (aléatoire) »", logs.some((l) => l.startsWith("hmm sauté")));
    // (NIT-1 croisé conv 56 : la vérif tautologique « le tour n'est pas bloqué » retirée — la ligne suivante le prouve.)
    brain.delta("La relativité lie le temps et l'espace."); await sleep(TICK);
    check("H2b: la réponse est poussée normalement", ipc.pushedAll().includes("La relativité lie le temps et l'espace."));
    brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── H2c (conv 56) — le SEUIL du hmm est gouverné par l'env : SOPHIA_HMM_AFTER_MS remplace le défaut (1400 ms)
  //    quand l'option n'est pas fournie. Prouvé en le baissant à 40 ms → le hmm part vite (sinon il attendrait 1,4 s). ──
  {
    process.env.SOPHIA_HMM_AFTER_MS = "40";
    try {
      const { ipc, brain, logs } = setup({ fillerAfterMs: 200, hmmProbability: 1 }); // PAS d'option hmmAfterMs → défaut = env
      ipc.emit("evt.stt.final", { text: "Explique-moi la relativité" });
      ipc.emit("evt.turn.end", { mark: 1 });
      await sleep(TICK);
      await sleep(60); // > env (40), TRÈS < défaut code (1400) → si le hmm part, c'est l'env qui gouverne
      check("H2c: SOPHIA_HMM_AFTER_MS gouverne le seuil (hmm parti à ~40 ms, pas 1,4 s)", ipc.tts("clip").length === 1);
      check("H2c: log « hmm joué »", logs.some((l) => l.startsWith("hmm joué")));
      brain.delta("La relativité lie le temps et l'espace."); await sleep(TICK);
      brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    } finally { delete process.env.SOPHIA_HMM_AFTER_MS; }
  }

  // ── H2d (N-5 conv 56) — env SOPHIA_HMM_AFTER_MS BLANC («   ») = non-réglé → défaut 1400 ms (PAS un seuil 0 :
  //    Number("   ")===0 aurait remis le hmm quasi systématique en silence) ──
  {
    process.env.SOPHIA_HMM_AFTER_MS = "   ";
    try {
      const { ipc, brain } = setup({ fillerAfterMs: 5000, hmmProbability: 1 }); // pas d'option → défaut via env (blanc)
      ipc.emit("evt.stt.final", { text: "Explique-moi la relativité" });
      ipc.emit("evt.turn.end", { mark: 1 });
      await sleep(TICK);
      await sleep(100); // >> un seuil 0 bogué, << 1400 → si un hmm part ici, le blanc a été pris pour 0
      check("H2d: env BLANC → défaut 1400 ms (aucun hmm à ~100 ms)", ipc.tts("clip").length === 0);
      brain.delta("Réponse."); brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    } finally { delete process.env.SOPHIA_HMM_AFTER_MS; }
  }

  // ── H2e (N-5 conv 56) — env SOPHIA_HMM_PROB BLANC = non-réglé → défaut 0,6 (PAS une proba 0 = « jamais ») ──
  {
    process.env.SOPHIA_HMM_PROB = " ";
    try {
      const { ipc, brain, logs } = setup({ hmmAfterMs: 40, fillerAfterMs: 5000, random: () => 0.5 }); // 0,5 < 0,6 → doit JOUER
      ipc.emit("evt.stt.final", { text: "Explique-moi la relativité" });
      ipc.emit("evt.turn.end", { mark: 1 });
      await sleep(TICK);
      await sleep(60);
      check("H2e: env BLANC → défaut 0,6 (le hmm JOUE avec random 0,5)", ipc.tts("clip").length === 1 && logs.some((l) => l.startsWith("hmm joué")));
      brain.delta("Réponse."); brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    } finally { delete process.env.SOPHIA_HMM_PROB; }
  }

  // ── H2f (M-6 conv 56) — clip ABSENT côté sidecar (aucun evt.tts.start ne viendra) → deadline CLIP courte
  //    débloque le gate (clipDeadlineMs), PAS la deadline 30 s des énonciations (un clone sans WAV vendorisés
  //    gèlerait sinon ~30 s à chaque hmm tiré) ──
  {
    const { ipc, brain, logs } = setup({ hmmAfterMs: 40, fillerAfterMs: 5000, hmmProbability: 1, clipDeadlineMs: 120, doneDeadlineMs: 5000 });
    ipc.emit("evt.stt.final", { text: "Explique-moi la relativité" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    await sleep(60); // le hmm est parti (cmd.tts.clip) ; le faux sidecar ne répond JAMAIS (clip inconnu = no-op)
    check("H2f: le clip est parti", ipc.tts("clip").length === 1);
    check("H2f: pas encore débloqué AVANT la deadline clip", !logs.some((l) => l.includes("deadline clip")));
    await sleep(180); // > clipDeadlineMs (120 dès l'envoi à ~40 ms) mais TRÈS < doneDeadlineMs (5000)
    check("H2f: deadline CLIP courte → gate débloqué (pas 30 s)", logs.some((l) => l.includes("deadline clip")));
    brain.delta("Réponse."); brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── H3 (V10) — réponse RAPIDE (avant hmmAfter) → PAS de hmm, PAS de masqueur (les deux timers annulés) ──
  {
    const { ipc, brain } = setup({ hmmAfterMs: 120, fillerAfterMs: 200 });
    ipc.emit("evt.stt.final", { text: "Question courte" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Réponse immédiate."); // ouvre uid AVANT hmmAfter → annule les deux timers
    await sleep(260);
    check("H3: réponse rapide → aucun hmm", ipc.tts("clip").length === 0);
    check("H3: réponse rapide → aucun masqueur", !ipc.pushedAll().includes("Donne-moi une petite minute."));
    brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── I — secours : isError SANS aucun delta → le routeur dit SA phrase (jamais via onDelta) ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Une question difficile" });
    ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.finish({ isError: true, aborted: false, text: "SECOURS" }); // aucun delta
    await sleep(TICK);
    check("I: secours prononcé (1 énonciation) sur isError sans delta", ipc.tts("speak").length === 1 && ipc.tts("push").length === 1);
    check("I: le secours n'est PAS vide", (ipc.tts("push")[0]?.text ?? "").length > 3);
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── J — deadline done F-A : evt.tts.done jamais reçu → le gate se débloque quand même (jamais deaf à l'infini) ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Un tour" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Voilà."); brain.finish({ text: "Voilà." });
    await sleep(TICK);
    // on NE complète PAS (le moteur TTS est « mort ») → la deadline F-A doit débloquer le gate.
    ipc.emit("evt.stt.final", { text: "Un autre tour tout de suite" }); ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(TICK);
    check("J: pendant le blocage, un nouveau tour est IGNORÉ (gate fermé)", brain.calls.length === 1);
    await sleep(CFG.doneDeadlineMs + CFG.gateTailMs + TICK); // la deadline F-A tombe → gate débloqué
    ipc.emit("evt.stt.final", { text: "Encore un tour" }); ipc.emit("evt.turn.end", { mark: 3 });
    await sleep(TICK);
    check("J: après la deadline F-A, un nouveau tour est ACCEPTÉ (jamais deaf pour toujours)", brain.calls.length === 2);
    brain.finish({ text: "ok" }); await sleep(TICK);
  }

  // ── K — quiesce (stop) : purge de la voix + plus rien traité ──
  {
    const { ipc, brain, router } = setup();
    router.stop();
    check("K: stop() purge la voix (cmd.tts.stop)", ipc.tts("stop").length === 1);
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" });
    ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK);
    check("K: après stop(), un éveil n'est plus traité", brain.prewarms === 0 && ipc.tts("speak").length === 0);
  }

  // ── L — SOLO-1 : un cerveau qui REJETTE (hors contrat) → AUCUNE rejection non gérée + le GATE se rouvre ──
  {
    let unhandled = 0;
    const onU = () => unhandled++;
    process.on("unhandledRejection", onU);
    const ipc = new FakeIpc();
    const brain = { calls: 0, prewarm() {}, ask() { this.calls++; return Promise.reject(new Error("cerveau HS")); } };
    const router = new ConversationRouter({ ipc, brain, ...CFG });
    router.start();
    ipc.emit("evt.stt.final", { text: "Une question" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(CFG.gateTailMs + TICK * 2);
    check("L: cerveau qui rejette → AUCUNE rejection non gérée (SOLO-1, MORD sans runInteraction)", unhandled === 0);
    ipc.emit("evt.stt.final", { text: "Une autre" }); ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(TICK);
    check("L: le GATE s'est rouvert après le rejet (nouveau tour accepté, jamais deaf)", brain.calls === 2);
    process.off("unhandledRejection", onU);
  }

  // ── MAJ1 (croisé fidélité MAJEUR-1) : au 2e éveil, saluer sur le transcript FRAIS, jamais le PÉRIMÉ d'un tour/clôture ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);           // éveil #1
    ipc.emit("evt.stt.final", { text: "Quelle heure est-il ?" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK); brain.delta("Il est midi."); brain.finish({ text: "Il est midi." });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);           // un tour
    ipc.emit("evt.stt.final", { text: "Merci Sophia, à plus tard" }); ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);           // une clôture
    const before = ipc.pushedAll().length;
    ipc.emit("evt.wake", { pos: 2 });                                               // éveil #2 chemin RAPIDE (wake d'abord)
    await sleep(TICK);
    ipc.emit("evt.stt.final", { text: "Bonsoir Sophia" });                          // le transcript FRAIS arrive après
    await sleep(TICK);
    const fresh = ipc.pushedAll().slice(before);
    check("MAJ1: le 2e éveil salue sur le transcript FRAIS (« Bonsoir Yohann »)", fresh.includes("Bonsoir Yohann."));
    check("MAJ1: PAS de salutation générique sur le transcript périmé de la clôture", !fresh.includes("Oui Yohann."));
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── ROB-M1 (croisé robustesse M1) : evt.tts.start RE-ARME la deadline → une réponse longue ne rouvre PAS le gate ──
  {
    const { ipc, brain } = setup({ doneDeadlineMs: 40, playbackDeadlineMs: 400, gateTailMs: 30, fillerAfterMs: 2000 });
    ipc.emit("evt.stt.final", { text: "Réponds longuement" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(15);
    brain.delta("Je vais parler un bon moment."); // ouvre uid, arme la deadline 40 ms
    const uid = ipc.tts("speak")[0].id;
    ipc.emit("evt.tts.start", { id: uid });        // 1er son → re-arme sur playbackDeadlineMs (400 ms)
    brain.finish({ text: "…" });                    // end(uid) ; done PAS encore émis (elle « joue » longtemps)
    await sleep(90);                                // > doneDeadlineMs(40) mais < playbackDeadlineMs(400)
    ipc.emit("evt.stt.final", { text: "Résidu de sa propre voix" }); ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(20);
    check("ROB-M1: deadline re-armée au start → gate NON rouvert en plein discours (pas d'auto-réponse)", brain.calls.length === 1);
    ipc.emit("evt.tts.done", { id: uid, reason: "completed" });
    await sleep(30 + TICK);
  }

  // ── MIN2 (croisé fidélité MINEUR-2) : no_speech_prob>0.8 transmis au filtre → tour ignoré (fidèle au banc) ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "quelque chose", no_speech_prob: 0.9 }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    check("MIN2: tour à no_speech_prob>0.8 → ignoré (nsp transmis au filtre d'hallucination)", brain.calls.length === 0);
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── MIN3 (croisé fidélité MINEUR-3) : « bonne nuit » NU (sans sophia) → cerveau (pas une clôture ; cohérent sidecar) ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Bonne nuit tout le monde" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    check("MIN3: « bonne nuit » NU → cerveau appelé (matchClosing seul, pas || isGoodnight)", brain.calls.length === 1);
    brain.finish({ text: "x" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── V8-A (barge-in) : Yohann coupe pendant sa PENSÉE développée → coupe + capture rétroactive + abandon du cerveau ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Raconte-moi une longue histoire" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Il était une fois"); await sleep(TICK);      // ouvre l'énonciation de la pensée → armedUttId
    const uid = ipc.tts("speak")[0].id;
    ipc.emit("evt.tts.start", { id: uid });                    // sa voix démarre → arm (barge armé)
    await sleep(TICK);
    check("V8-A: sa pensée qui joue → oreilles ARMÉES (cmd.listen.arm)", ipc.listen("arm").length === 1);
    const stopsBefore = ipc.tts("stop").length;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.31, mark: 5 });   // Yohann parle par-dessus
    await sleep(TICK);
    check("V8-A: barge-in Yohann → la bouche est coupée (cmd.tts.stop)", ipc.tts("stop").length === stopsBefore + 1);
    check("V8-A: capture rétroactive → cmd.listen.resume {from: marque}", ipc.listen("resume").some((c) => c.from === 5));
    check("V8-A: le cerveau n'est PAS tué (option B — il finit en fond, contexte préservé)", brain.last().aborted === false);
    await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Autre chose" }); ipc.emit("evt.turn.end", { mark: 9 });
    await sleep(TICK);
    check("V8-A: après le barge-in, un nouveau tour est ACCEPTÉ (jamais coincé)", brain.calls.length === 2);
    brain.finish({ text: "ok" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── V8-B : son propre résidu (locuteur "inconnu", < 0,22) ne coupe JAMAIS (invariant F2) ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Explique quelque chose" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Voici"); await sleep(TICK);
    const uid = ipc.tts("speak")[0].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    const stopsBefore = ipc.tts("stop").length;
    ipc.emit("evt.speaker", { locuteur: "inconnu", score: 0.14, mark: 5 });   // son résidu / une inconnue
    await sleep(TICK);
    check("V8-B: résidu/inconnu → PAS de coupe (F2 : elle ne se coupe jamais elle-même)", ipc.tts("stop").length === stopsBefore);
    brain.finish({ text: "…" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── V8-C : une phrase FIXE (salutation) ne s'arme PAS → Yohann ne peut pas la couper (fidèle allow_bargein=False) ──
  {
    const { ipc } = setup();
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK);
    const uid = ipc.tts("speak")[0].id;                        // l'énonciation de la salutation
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    check("V8-C: salutation qui joue → oreilles MUTÉES (pas armées)", ipc.listen("mute").length === 1 && ipc.listen("arm").length === 0);
    const stopsBefore = ipc.tts("stop").length;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.4, mark: 5 });
    await sleep(TICK);
    check("V8-C: Yohann pendant la salutation → PAS de coupe (les phrases fixes ne se coupent pas)", ipc.tts("stop").length === stopsBefore);
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── V8-D : au repos (hors pensée), un evt.speaker ne coupe rien ──
  {
    const { ipc } = setup();
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.5, mark: 1 });
    await sleep(TICK);
    check("V8-D: evt.speaker au repos → aucune coupe (barge-in seulement pendant sa pensée)", ipc.tts("stop").length === 0);
  }

  // ── V8-E : après une coupe, le GATE se rouvre TOUT DE SUITE (traîne 0) → la suite de Yohann n'est pas ratée ──
  {
    const { ipc, brain } = setup({ gateTailMs: 300 });        // traîne LONGUE : si elle s'appliquait au barge, la suite serait ignorée
    ipc.emit("evt.stt.final", { text: "Développe longuement" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Je commence"); await sleep(TICK);
    const uid = ipc.tts("speak")[0].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // barge-in
    await sleep(TICK);                                         // BIEN moins que gateTailMs(300) : avec la traîne, busy serait fermé
    ipc.emit("evt.stt.final", { text: "Sa suite interruptrice" }); ipc.emit("evt.turn.end", { mark: 8 });
    await sleep(TICK);
    check("V8-E: après une coupe, la suite de Yohann est acceptée SANS attendre la traîne (busy rouvert tout de suite)", brain.calls.length === 2);
    brain.finish({ text: "ok" }); await sleep(TICK); ipc.complete(); await sleep(330 + TICK);
  }

  // ── V8-F (option B, décision Yohann) : le barge NE TUE PAS le cerveau — il finit en fond, deltas restants JETÉS ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Raconte" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Début de la pensée."); await sleep(TICK);
    const uid = ipc.tts("speak")[0].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // barge
    await sleep(TICK);
    const pushesAfterBarge = ipc.tts("push").length;
    check("V8-F: le cerveau n'est PAS aborté au barge (option B : contexte préservé)", brain.last().aborted === false);
    // le cerveau FINIT EN FOND : des deltas arrivent encore APRÈS le barge → ils doivent être JETÉS (bouche coupée)
    brain.delta("Suite ignorée."); brain.delta("Fin ignorée.");
    brain.finish({ text: "Début de la pensée. Suite ignorée. Fin ignorée." });   // le tour barged se termine en fond
    await sleep(TICK);
    check("V8-F: les deltas post-barge sont JETÉS (pas de double-voix ; le cerveau finit en fond)", ipc.tts("push").length === pushesAfterBarge);
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── V8-G (re-croisé R-2) : barge à l'instant EXACT où le cerveau finit → `asked` gagne la course, MAIS `barged` est
  //    vrai → respond rend quand même (jamais un cmd.tts.end parasite sur l'énonciation purgée). MORD sans `|| barged`. ──
  {
    const { ipc, brain } = setup();
    ipc.emit("evt.stt.final", { text: "Une question" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("La réponse."); await sleep(TICK);
    const uid = ipc.tts("speak")[0].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    const endsBefore = ipc.tts("end").length;
    brain.finish({ text: "La réponse." });                                  // le cerveau finit (asked résout) ...
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // ... au MÊME instant, Yohann barge
    await sleep(TICK);
    check("V8-G: barge au moment où le cerveau finit → PAS de cmd.tts.end parasite (énonciation purgée)", ipc.tts("end").length === endsBefore);
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── V9-A (états d'écoute) : réveil (salutation) → cmd.listen.start + état ÉCOUTE (B1 : l'orchestrateur confirme) ──
  {
    const { ipc, router } = setup();
    check("V9-A: au repos, état = VEILLE", router.listenState === "veille");
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(TICK);   // la salutation joue → done → states.wake()
    check("V9-A: après la salutation → cmd.listen.start (ÉCOUTE confirmée, B1)", ipc.listen("start").length === 1);
    check("V9-A: état = ÉCOUTE", router.listenState === "ecoute");
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── V9-B (états d'écoute) : clôture → cmd.listen.stop + retour VEILLE (« coupe l'écoute des tours à la source ») ──
  {
    const { ipc, router } = setup();
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);   // réveil → ÉCOUTE
    const stopsBefore = ipc.listen("stop").length;
    ipc.emit("evt.stt.final", { text: "Merci Sophia, à plus tard" }); ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(TICK); ipc.complete(); await sleep(TICK);   // au revoir → states.close()
    check("V9-B: clôture → cmd.listen.stop (retour VEILLE, coupe à la source)", ipc.listen("stop").length === stopsBefore + 1);
    check("V9-B: état = VEILLE", router.listenState === "veille");
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── V9-C (états d'écoute) : éveil-clôture « bonne nuit Sophia » À FROID → jamais ÉCOUTE, reste VEILLE ──
  //    (elle ne se met pas en écoute pour se rendormir aussitôt ; le sidecar désarme son auto-réveil via son portier
  //    — conception V7 actée « zéro changement sidecar pour la clôture » —, la garde R-1 étant le filet. Le
  //    cmd.listen.stop n'est émis que quand on QUITTE l'ÉCOUTE, cf V9-B ; à froid on n'y entre jamais.) ──
  {
    const { ipc, router } = setup();
    ipc.emit("evt.stt.final", { text: "Bonne nuit Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(TICK);
    check("V9-C: « bonne nuit Sophia » à froid → PAS de cmd.listen.start (jamais mise en écoute)", ipc.listen("start").length === 0);
    check("V9-C: état = VEILLE (elle se rendort)", router.listenState === "veille");
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── V9-D (états d'écoute) : un tour NORMAL ne re-transitionne pas (reste ÉCOUTE, pas de start/stop parasite) ──
  {
    const { ipc, brain, router } = setup();
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);   // réveil → ÉCOUTE
    const startsAfterWake = ipc.listen("start").length;
    const stopsAfterWake = ipc.listen("stop").length;
    ipc.emit("evt.stt.final", { text: "Quelle heure est-il ?" }); ipc.emit("evt.turn.end", { mark: 2 });
    await sleep(TICK); brain.delta("Il est midi."); brain.finish({ text: "Il est midi." });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);   // un vrai tour de conversation
    check("V9-D: un tour normal ne ré-émet PAS cmd.listen.start (reste ÉCOUTE)", ipc.listen("start").length === startsAfterWake);
    check("V9-D: un tour normal n'émet PAS cmd.listen.stop", ipc.listen("stop").length === stopsAfterWake);
    check("V9-D: état = toujours ÉCOUTE après un tour", router.listenState === "ecoute");
  }

  // ── V9-E (garde R-1, ROB-B croisé) : evt.listen.timeout (le sidecar s'est rendormi) → l'orchestrateur SYNCHRONISE ──
  {
    const { ipc, router } = setup();
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);   // réveil → ÉCOUTE
    check("V9-E: état ÉCOUTE avant le timeout", router.listenState === "ecoute");
    const stopsBefore = ipc.listen("stop").length;
    ipc.emit("evt.listen.timeout", { reason: "inactivite" });   // la garde R-1 a rendormi le sidecar (silence prolongé)
    await sleep(TICK);
    check("V9-E: evt.listen.timeout → état synchronisé en VEILLE (la vue dérivée ne ment pas)", router.listenState === "veille");
    check("V9-E: synchronisation → cmd.listen.stop (idempotent avec le sidecar déjà rendormi)", ipc.listen("stop").length === stopsBefore + 1);
  }

  // ── V9-F (garde R-1) : un timeout au REPOS (déjà VEILLE) est un no-op (jamais de stop parasite) ──
  {
    const { ipc, router } = setup();
    check("V9-F: au repos, état VEILLE", router.listenState === "veille");
    const stopsBefore = ipc.listen("stop").length;
    ipc.emit("evt.listen.timeout", { reason: "inactivite" });
    await sleep(TICK);
    check("V9-F: timeout en VEILLE → no-op (pas de cmd.listen.stop parasite)", ipc.listen("stop").length === stopsBefore);
    check("V9-F: état reste VEILLE", router.listenState === "veille");
  }

  // ── PR-C (V10-partiel) : matchPause PRÉCIS + le réveil de REPRISE « tu es là Sophia » (fonctions pures du portier) ──
  {
    check("PR-C: « Attends s'il te plaît » = pause", matchPause("Attends s'il te plaît"));
    check("PR-C: « attends s'il te plaît Sophia » = pause", matchPause("attends s'il te plaît Sophia"));
    check("PR-C: « Attends » seul = pause", matchPause("Attends"));
    check("PR-C: « Attends un instant » = pause", matchPause("Attends un instant"));
    check("PR-C: « Attends, explique-moi la relativité » ≠ pause (vraie question, pas une suspension)", !matchPause("Attends, explique-moi la relativité"));
    check("PR-C: « Raconte-moi une histoire » ≠ pause", !matchPause("Raconte-moi une histoire"));
    check("PR-C: réveil de reprise « Tu es là Sophia ? » reconnu", matchOpening("Tu es là Sophia ?"));
    check("PR-C: réveil de reprise « Sophia tu es là ? » reconnu", matchOpening("Sophia tu es là ?"));
    check("PR-C: « Tu es là Sophie ? » (pas Sophia) → NON réveil", !matchOpening("Tu es là Sophie ?"));
  }

  // ── PR-A (V10-partiel) : PAUSE (« attends s'il te plaît » après un barge) → sommeil ; REPRISE (« tu es là Sophia ? »)
  //    → « Oui, je suis là » + reprise AU DÉBUT DE LA PHRASE COUPÉE (repère TEMPOREL : temps parlé × cadence, pas le
  //    texte poussé — le cerveau streame bien plus vite qu'elle ne parle). Horloge injectée → cut point déterministe. ──
  {
    let clk = 100000;
    const now = () => clk;
    const { ipc, brain, router } = setup({ now, speechCharsPerSec: 10, resumeWaitMs: 80 });
    // réveil → ÉCOUTE (états V9)
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    check("PR-A: en conversation, état = ÉCOUTE", router.listenState === "ecoute");
    // une pensée développée (3 phrases)
    const THOUGHT = "Il était une fois un roi. Il vivait dans un château. Un jour, il partit à l'aventure.";
    ipc.emit("evt.stt.final", { text: "Raconte-moi une histoire" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Il était une fois un roi. "); brain.delta("Il vivait dans un château. ");
    await sleep(TICK);
    const speaks = ipc.tts("speak"); const uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid });          // 1er son → thoughtSpokenAt = clk (100000)
    await sleep(TICK);
    clk += 3500;                                      // elle a parlé 3,5 s → ~35 chars → mi-2e phrase (« château »)
    const stopsBeforeBarge = ipc.listen("stop").length;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // barge
    await sleep(TICK);
    // la phrase interruptrice « attends s'il te plaît » (captée en rétroactif) arrive au tour suivant
    ipc.emit("evt.stt.final", { text: "Attends s'il te plaît" }); ipc.emit("evt.turn.end", { mark: 6 });
    await sleep(TICK);
    check("PR-A: « attends s'il te plaît » → état PAUSE", router.listenState === "pause");
    check("PR-A: pause → cmd.listen.stop (sommeil name-only, elle dort)", ipc.listen("stop").length === stopsBeforeBarge + 1);
    check("PR-A: pause → PAS de nouveau tour cerveau (elle garde sa pensée, ne répond pas)", brain.calls.length === 1);
    // le cerveau FINIT en fond pendant la pause (option B) → texte complet prêt
    brain.finish({ isError: false, text: THOUGHT });
    await sleep(TICK);
    // REPRISE : « tu es là Sophia ? » réveille le sidecar de son sommeil name-only → evt.wake
    const beforeResume = ipc.pushedAll().length;
    const startsBeforeResume = ipc.listen("start").length;
    ipc.emit("evt.wake", { pos: 2 });
    await sleep(TICK);
    check("PR-A: reprise → « Oui, je suis là. » poussé", ipc.pushedAll().slice(beforeResume).includes("Oui, je suis là."));
    check("PR-A: reprise → cmd.listen.start (retour ÉCOUTE)", ipc.listen("start").length === startsBeforeResume + 1);
    check("PR-A: reprise → état ÉCOUTE", router.listenState === "ecoute");
    ipc.complete();                                   // « Oui, je suis là » fini → la pensée reprend
    await sleep(TICK);
    const resumed = ipc.pushedAll().slice(beforeResume);
    const rem = resumed.find((t) => t.includes("château") || t.includes("Un jour"));
    check("PR-A: reprend AU DÉBUT DE LA PHRASE COUPÉE (re-dit « Il vivait dans un château »)", !!rem && rem.includes("Il vivait dans un château"));
    check("PR-A: continue la pensée (« Un jour, il partit »)", !!rem && rem.includes("Un jour, il partit"));
    check("PR-A: ne répète PAS ce qui était déjà dit (« Il était une fois » absent de la reprise)", !rem || !rem.includes("Il était une fois"));
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── PR-B (V10-partiel) : le BARGE reste INCHANGÉ — après une coupe, une AUTRE phrase (nouvelle question) JETTE la
  //    pensée coupée et elle répond (jamais de pause). Prouve la non-régression du barge d'aujourd'hui. ──
  {
    let clk = 200000;
    const { ipc, brain, router } = setup({ now: () => clk, speechCharsPerSec: 10 });
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Développe un sujet" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Je développe une longue pensée. "); await sleep(TICK);
    const speaks = ipc.tts("speak"); const uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // barge
    await sleep(CFG.gateTailMs + TICK);
    // une NOUVELLE QUESTION (pas « attends ») → la pensée coupée est jetée, elle répond
    ipc.emit("evt.stt.final", { text: "Explique-moi plutôt autre chose" }); ipc.emit("evt.turn.end", { mark: 6 });
    await sleep(TICK);
    check("PR-B: barge + nouvelle question → le cerveau est rappelé (barge d'aujourd'hui INCHANGÉ)", brain.calls.length === 2);
    check("PR-B: barge + nouvelle question → PAS de pause (reste ÉCOUTE)", router.listenState === "ecoute");
    brain.finish({ text: "ok" }); await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── PR-E (solo conv 51) : une pensée gardée par un barge ne SURVIT PAS à un retour VEILLE (garde R-1 qui rendort sur
  //    inactivité) → un réveil FRAIS salue, jamais une reprise fantôme. SEULE une PAUSE tient la pensée. ──
  {
    let clk = 300000;
    const { ipc, brain, router } = setup({ now: () => clk, speechCharsPerSec: 10 });
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Développe un point" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Une pensée en cours. "); await sleep(TICK);
    const speaks = ipc.tts("speak"); const uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    clk += 1000;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // barge → heldThought posé
    await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.listen.timeout", { reason: "inactivite" });                // la garde R-1 rendort le sidecar → VEILLE
    await sleep(TICK);
    check("PR-E: garde R-1 → retour VEILLE", router.listenState === "veille");
    brain.finish({ text: "Une pensée en cours, complète." }); await sleep(TICK);
    const before = ipc.pushedAll().length;
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 2 });   // réveil FRAIS
    await sleep(TICK);
    const after = ipc.pushedAll().slice(before);
    check("PR-E: réveil frais après VEILLE → SALUTATION (pas de reprise fantôme de l'ancienne pensée)",
      after.includes("Bonjour Yohann.") && !after.includes("Oui, je suis là."));
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  // ── PR-D (solo conv 51) : RE-PAUSE pendant une reprise (le téléphone re-sonne) → la reprise est elle-même une pensée
  //    développée, donc tenable de nouveau (état PAUSE une 2e fois). ──
  {
    let clk = 400000;
    const { ipc, brain, router } = setup({ now: () => clk, speechCharsPerSec: 10, resumeWaitMs: 80 });
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Raconte longuement" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Phrase une. Phrase deux. Phrase trois. Phrase quatre."); await sleep(TICK);
    let speaks = ipc.tts("speak"); let uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    clk += 500;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // 1er barge
    await sleep(TICK);
    ipc.emit("evt.stt.final", { text: "Attends s'il te plaît" }); ipc.emit("evt.turn.end", { mark: 6 });
    await sleep(TICK);
    check("PR-D: 1re pause OK", router.listenState === "pause");
    brain.finish({ text: "Phrase une. Phrase deux. Phrase trois. Phrase quatre." }); await sleep(TICK);
    ipc.emit("evt.wake", { pos: 2 }); await sleep(TICK);      // reprise
    ipc.complete(); await sleep(TICK);                        // « Oui, je suis là » fini → la reprise joue
    speaks = ipc.tts("speak"); uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK); // la reprise démarre → re-armable
    clk += 500;
    const stopsBefore = ipc.listen("stop").length;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 9 });   // RE-barge sur la reprise
    await sleep(TICK);
    ipc.emit("evt.stt.final", { text: "Attends s'il te plaît" }); ipc.emit("evt.turn.end", { mark: 10 });
    await sleep(TICK);
    check("PR-D: RE-pause pendant la reprise → état PAUSE de nouveau (la reprise est tenable)", router.listenState === "pause");
    check("PR-D: re-pause → cmd.listen.stop de nouveau", ipc.listen("stop").length === stopsBefore + 1);
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── PR-F (croisé MAJEUR-1) : un barge APRÈS que le cerveau a FINI de streamer (elle parle encore) doit QUAND MÊME
  //    poser heldThought → « attends » met en PAUSE. MORD : sans le fix (this.thought nullifié au finally), heldThought
  //    n'est pas posé → « attends » file au cerveau → listenState resterait ÉCOUTE + brain.calls=2. ──
  {
    let clk = 500000;
    const { ipc, brain, router } = setup({ now: () => clk, speechCharsPerSec: 10, resumeWaitMs: 80 });
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Raconte" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Phrase une. Phrase deux. Phrase trois."); await sleep(TICK);
    const speaks = ipc.tts("speak"); const uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);      // elle commence à parler
    clk += 500;
    brain.finish({ isError: false, text: "Phrase une. Phrase deux. Phrase trois." });   // le cerveau FINIT de streamer
    await sleep(TICK);                                              // le finally de respond tourne (elle parle ENCORE, pas de tts.done)
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // barge PENDANT la lecture
    await sleep(TICK);
    ipc.emit("evt.stt.final", { text: "Attends s'il te plaît" }); ipc.emit("evt.turn.end", { mark: 6 });
    await sleep(TICK);
    check("PR-F: barge APRÈS fin du streaming (elle parle encore) → « attends » met en PAUSE (heldThought bien posé)", router.listenState === "pause");
    check("PR-F: pause → PAS de tour cerveau sur « attends » (la pensée n'a pas filé au cerveau)", brain.calls.length === 1);
    await sleep(CFG.gateTailMs + TICK);
  }

  // ── PR-G (croisé MINEUR-2) : un evt.turn.end RÉSIDUEL pendant une PAUSE est IGNORÉ (ne casse pas la pause) ──
  {
    let clk = 600000;
    const { ipc, brain, router } = setup({ now: () => clk, speechCharsPerSec: 10 });
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Raconte" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Une pensée. "); await sleep(TICK);
    const speaks = ipc.tts("speak"); const uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    clk += 500;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 }); await sleep(TICK);
    ipc.emit("evt.stt.final", { text: "Attends s'il te plaît" }); ipc.emit("evt.turn.end", { mark: 6 });
    await sleep(TICK);
    check("PR-G: en PAUSE", router.listenState === "pause");
    const callsBefore = brain.calls.length;
    ipc.emit("evt.stt.final", { text: "non plutôt dis-moi autre chose" }); ipc.emit("evt.turn.end", { mark: 7 }); // résidu en PAUSE
    await sleep(TICK);
    check("PR-G: tour résiduel PENDANT la PAUSE → IGNORÉ (pause préservée, cerveau pas rappelé)",
      brain.calls.length === callsBefore && router.listenState === "pause");
    brain.finish({ text: "Une pensée complète." }); await sleep(TICK);
  }

  // ── PR-H (re-croisé conv 51) : un heldThought posé HORS pause (phrase interruptrice inaudible, jamais désambiguïsée)
  //    → un réveil FRAIS SALUE, jamais une reprise fantôme. La reprise n'est légitime QUE depuis une vraie PAUSE.
  //    MORD : sans le garde `states==="pause"` dans onWake, le réveil frais reprendrait la vieille pensée. ──
  {
    let clk = 700000;
    const { ipc, brain, router } = setup({ now: () => clk, speechCharsPerSec: 10 });
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 1 });
    await sleep(TICK); ipc.complete(); await sleep(CFG.gateTailMs + TICK);
    ipc.emit("evt.stt.final", { text: "Raconte" }); ipc.emit("evt.turn.end", { mark: 1 });
    await sleep(TICK);
    brain.delta("Une pensée. "); await sleep(TICK);
    const speaks = ipc.tts("speak"); const uid = speaks[speaks.length - 1].id;
    ipc.emit("evt.tts.start", { id: uid }); await sleep(TICK);
    clk += 500;
    ipc.emit("evt.speaker", { locuteur: "yohann", score: 0.3, mark: 5 });   // barge → heldThought posé, ÉCOUTE (PAS pause)
    await sleep(CFG.gateTailMs + TICK);
    check("PR-H: après barge sans « attends » → état ÉCOUTE (pas pause)", router.listenState === "ecoute");
    brain.finish({ text: "Une pensée complète." }); await sleep(TICK);
    const before = ipc.pushedAll().length;
    ipc.emit("evt.stt.final", { text: "Bonjour Sophia" }); ipc.emit("evt.wake", { pos: 2 });   // réveil FRAIS
    await sleep(TICK);
    const after = ipc.pushedAll().slice(before);
    check("PR-H: réveil frais + heldThought hors-pause → SALUTATION (pas de reprise fantôme)",
      after.includes("Bonjour Yohann.") && !after.includes("Oui, je suis là."));
    ipc.complete(); await sleep(CFG.gateTailMs + TICK);
  }

  for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
  const failed = results.filter(([, ok]) => !ok);
  if (failed.length === 0) console.log(`\nu-router OK : le routeur de conversation (${results.length} vérifs) — éveil/tour/clôture/GATE b2/masqueur/secours/F-A/barge-in V8/états V9/pause-reprise V10`);
  else console.error(`\nu-router ÉCHEC : ${failed.length} critère(s)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

run();
