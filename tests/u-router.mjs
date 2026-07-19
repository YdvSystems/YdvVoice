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

const results = [];
const check = (n, c) => results.push([n, !!c]);

// ── Faux IPC : enregistre les cmd.tts.* ; émet les evt.* aux handlers du routeur ; complète les énonciations à la
//    demande (simule le sidecar qui finit de jouer → evt.tts.done). PAS d'auto-complétion → le test drive tout. ──
class FakeIpc {
  constructor() { this.handlers = new Map(); this.cmds = []; this.openIds = new Set(); this.doneIds = new Set(); }
  on(type, h) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(h); }
  request(type, payload = {}) {
    this.cmds.push({ type, id: payload.id, text: payload.text, from: payload.from });
    if (type === "cmd.tts.speak") this.openIds.add(payload.id);
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

  for (const [n, ok] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${n}`);
  const failed = results.filter(([, ok]) => !ok);
  if (failed.length === 0) console.log(`\nu-router OK : le routeur de conversation (${results.length} vérifs) — éveil/tour/clôture/GATE b2/masqueur/secours/F-A/barge-in V8`);
  else console.error(`\nu-router ÉCHEC : ${failed.length} critère(s)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

run();
