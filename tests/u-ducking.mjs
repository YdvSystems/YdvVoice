// u-ducking — la POLITIQUE DE DUCKING (V12, DuckingPolicy) — pure, mixer FAUX injecté. Couvre :
// décision A (duck par ÉTAT : tenu toute la conversation, remonte à la sortie) · VEILLE : wake seul ·
// éveil-clôture « bonne nuit » (l'état ne bouge jamais → restore à tts.done) · filet deadline (jamais un duck
// coincé) · le VAD ne duck JAMAIS (U-V12) · DICTÉE désarmée (S9) · TABLÉE par injection (voix + nom seuls,
// hystérésis, AT10) · dé-doublonnage · stop() restaure toujours · un mixer qui lève ne casse rien.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { DuckingPolicy } = require(path.join(root, "dist/src/orchestrator/voice/ducking.js"));

const results = [];
const check = (n, c) => results.push([n, !!c]);

function setup(opts = {}) {
  const calls = []; // "duck" | "restore"
  const logs = [];
  const mixer = { duck: () => calls.push("duck"), restore: () => calls.push("restore") };
  const p = new DuckingPolicy({ mixer, onLog: (l) => logs.push(l), wakeDeadlineMs: 120, tableeReleaseMs: 40, veilleReleaseMs: 40, ...opts });
  return { p, calls, logs, mixer };
}

// ── A — état initial : rien n'est ducké, aucune commande au démarrage ──
{
  const { p, calls } = setup();
  check("A: pas ducké au départ", p.isDucked === false);
  check("A: aucune commande mixer au démarrage", calls.length === 0);
}

// ── B — VEILLE : wake → duck ; l'ÉCOUTE qui suit le rend permanent (1 seul duck, dé-doublonné) ──
{
  const { p, calls } = setup();
  p.onWake();
  check("B: wake en veille → duck", p.isDucked === true && calls.join() === "duck");
  p.onVoiceState("ecoute");
  check("B: ÉCOUTE qui suit → toujours bas, PAS de 2e duck (dé-doublonné)", p.isDucked === true && calls.join() === "duck");
}

// ── C — DÉCISION A : le duck TIENT toute la conversation (tours multiples), remonte à la clôture ──
{
  const { p, calls } = setup();
  p.onWake(); p.onVoiceState("ecoute");
  // trois tours : sa voix démarre/finit trois fois — JAMAIS de remontée entre les tours (le cœur de la décision A)
  for (let i = 0; i < 3; i++) { p.onTtsStart(); p.onTtsDone(); }
  check("C: le duck TIENT entre les tours (aucun restore en conversation)", p.isDucked === true && calls.join() === "duck");
  p.onVoiceState("veille"); // clôture (« merci Sophia, à plus tard ») ou garde R-1
  check("C: sortie de conversation → UN restore", p.isDucked === false && calls.join() === "duck,restore");
}

// ── D — le VAD ne duck JAMAIS (l'entrée no-op du contrat U-V12) ──
{
  const { p, calls } = setup();
  p.onVadStart(); // en VEILLE : parler à quelqu'un d'autre ne touche pas YouTube (F3)
  check("D: vad.start en VEILLE → rien", p.isDucked === false && calls.length === 0);
  const t = setup({ tablee: true });
  t.p.onVadStart(); // en TABLÉE : les convives se parlent entre eux (AT10)
  check("D: vad.start en TABLÉE → rien", t.p.isDucked === false && t.calls.length === 0);
}

// ── E — éveil-clôture « bonne nuit Sophia » à froid : l'état ne bouge JAMAIS (veille→veille = no-op
//        ListenState sans notification) → c'est tts.done-en-veille qui restaure — en DIFFÉRÉ (SOLO-1) ──
{
  const { p, calls } = setup(); // veilleReleaseMs = 40
  p.onWake();          // duck d'éveil
  p.onTtsStart();      // « Bonne nuit Yohann. Dors bien, à demain. »
  check("E: goodnight joue, médias bas", p.isDucked === true);
  p.onTtsDone();       // fini — AUCUN onVoiceState n'est jamais venu
  check("E: pas de restore IMMÉDIAT à tts.done (le différé court)", p.isDucked === true);
  await sleep(90);
  check("E: restore DIFFÉRÉ (le cas sans transition d'état)", p.isDucked === false && calls.join() === "duck,restore");
}

// ── E2 — PAS DE BLIP au réveil (SOLO-1, MORD sans le différé) : le tts.done du salut arrive en VEILLE,
//         l'ÉCOUTE suit dans la foulée (l'ordre RÉEL du routeur : awaitDone PUIS states.wake) ──
{
  const { p, calls } = setup();
  p.onWake();                  // « Bonjour Sophia » → duck d'éveil
  p.onTtsStart();              // « Bonjour Yohann. »
  p.onTtsDone();               // le salut finit — l'état est ENCORE veille
  p.onVoiceState("ecoute");    // states.wake() arrive juste après (même tranche en réel)
  await sleep(120);            // > veilleReleaseMs : le différé annulé ne doit JAMAIS tirer
  check("E2: AUCUN restore transitoire au réveil (pas de blip)", p.isDucked === true && calls.join() === "duck");
  p.onVoiceState("veille");
  check("E2: la clôture restaure normalement ensuite", p.isDucked === false && calls.join() === "duck,restore");
}

// ── F — FILET deadline : un duck posé hors conversation SANS suite (ni écoute, ni tts.done) remonte seul ──
{
  const { p, calls } = setup(); // wakeDeadlineMs = 120
  p.onWake();
  check("F: duck posé", p.isDucked === true);
  await sleep(250);
  check("F: filet deadline → restore (jamais un duck coincé)", p.isDucked === false && calls.join() === "duck,restore");
}

// ── F2 — le filet NE MORD PAS si la conversation a suivi (désarmé à l'entrée en ÉCOUTE) ──
{
  const { p, calls } = setup();
  p.onWake(); p.onVoiceState("ecoute");
  await sleep(250);
  check("F2: en conversation, le filet ne mord pas (toujours bas après la deadline)", p.isDucked === true && calls.join() === "duck");
}

// ── F3 — m6 : filet « conversation MORTE » (les oreilles meurent → plus AUCUN événement → restore).
//        RE-croisé (MAJEUR) : le VAD TÉMOIGNE de la vie — pendant un long monologue (aucun tts/wake), seul
//        `vad.start` bat ; sans ce témoignage, le filet remonterait les médias EN PLEINE parole. ──
{
  const { p, calls } = setup({ conversationIdleMs: 160 });
  p.onWake(); p.onVoiceState("ecoute");   // t≈0 — filet armé (échéance ~160)
  await sleep(110);
  p.onVadStart();                          // t≈110 — le SEUL battement (monologue) → échéance repoussée ~270
  await sleep(110);                        // t≈220 — SANS le témoignage vad, l'échéance (160) serait passée
  check("F3: le VAD témoigne de la vie (MAJEUR re-croisé) — pas de restore en plein monologue", p.isDucked === true);
  check("F3: et il n'a toujours PAS ducké (le contrat U-V12 tient)", calls.join() === "duck");
  await sleep(340);                        // plus RIEN pendant >> conversationIdleMs (socket mort)
  check("F3: conversation morte → restore (jamais un duck coincé jusqu'au quit)", p.isDucked === false && calls.join() === "duck,restore");
  p.onTtsStart();                          // un événement revient (respawn un jour) → re-duck naturel
  check("F3: un événement qui revient re-duck", p.isDucked === true);
}

// ── G — PAUSE ≡ VEILLE : la pause remonte les médias ; la reprise re-duck ──
{
  const { p, calls } = setup();
  p.onWake(); p.onVoiceState("ecoute");
  p.onVoiceState("pause"); // « attends s'il te plaît »
  check("G: pause → restore (PAUSE ≡ VEILLE)", p.isDucked === false && calls.join() === "duck,restore");
  p.onWake();              // « tu es là Sophia ? »
  p.onVoiceState("ecoute");
  check("G: reprise → re-duck", p.isDucked === true && calls.join() === "duck,restore,duck");
}

// ── H — DICTÉE (S9) : désarmée — y entrer restaure, et plus rien ne duck tant qu'on y est ──
{
  const { p, calls } = setup();
  p.onWake(); p.onVoiceState("ecoute");
  p.onVoiceState("dictee");
  check("H: entrer en dictée pendant un duck → restore", p.isDucked === false && calls.join() === "duck,restore");
  p.onWake(); p.onTtsStart();
  check("H: en dictée, wake/tts ne duck PAS", p.isDucked === false && calls.join() === "duck,restore");
}

// ── I — APPROBATION = conversation (le duck tient, décision A) ──
{
  const { p, calls } = setup();
  p.onWake(); p.onVoiceState("ecoute"); p.onVoiceState("approbation");
  check("I: approbation → toujours bas (même groupe que l'écoute)", p.isDucked === true && calls.join() === "duck");
  p.onVoiceState("veille");
  check("I: sortie → restore", p.isDucked === false);
}

// ── J — TABLÉE (par injection, AT10) : voix + nom seuls · états inertes · hystérésis anti-yo-yo ──
{
  const { p, calls } = setup({ tablee: true }); // tableeReleaseMs = 40
  p.onVoiceState("ecoute"); // les états V9 ne duck JAMAIS en tablée (régime événementiel pur)
  check("J: en tablée, l'état ÉCOUTE ne duck pas", p.isDucked === false && calls.length === 0);
  p.onWake(); // son nom
  check("J: son nom → duck (AT10)", p.isDucked === true);
  p.onTtsStart(); // sa voix
  p.onTtsDone();
  check("J: sa voix finie → encore bas (l'hystérésis court)", p.isDucked === true);
  await sleep(90);
  check("J: hystérésis écoulée → restore", p.isDucked === false && calls.join() === "duck,restore");
  // anti-yo-yo : elle re-parle PENDANT la fenêtre de release → le timer est annulé, pas de remontée entre ses phrases
  p.onTtsStart(); p.onTtsDone(); // duck + fenêtre armée
  p.onTtsStart();                // re-parle tout de suite → annule la fenêtre
  await sleep(90);
  check("J: re-parler pendant la fenêtre → pas de yo-yo (toujours bas)", p.isDucked === true);
  p.onTtsDone();
  await sleep(90);
  check("J: dernière voix finie → restore", p.isDucked === false);
}

// ── K — stop() (quiesce ⑩) : restaure TOUJOURS + plus aucune commande ensuite ──
{
  const { p, calls } = setup();
  p.onWake(); p.onVoiceState("ecoute");
  p.stop();
  check("K: stop pendant un duck → restore (jamais un média laissé baissé)", p.isDucked === false && calls.join() === "duck,restore");
  p.onWake(); p.onVoiceState("ecoute"); p.onTtsStart();
  check("K: après stop, plus AUCUNE commande", calls.join() === "duck,restore");
}

// ── L — un mixer qui LÈVE ne casse jamais la policy (duck ET restore) ──
{
  const logs = [];
  const mixer = { duck: () => { throw new Error("mixer cassé"); }, restore: () => { throw new Error("mixer cassé"); } };
  const p = new DuckingPolicy({ mixer, onLog: (l) => logs.push(l), wakeDeadlineMs: 60 });
  p.onWake(); p.onVoiceState("ecoute");
  check("L: duck qui lève → capturé, l'intent tient", p.isDucked === true && logs.some((l) => l.includes("mixer.duck")));
  p.onVoiceState("veille");
  check("L: restore qui lève → capturé, l'intent tient", p.isDucked === false && logs.some((l) => l.includes("mixer.restore")));
}

// ── M — dé-doublonnage strict : événements répétés = une seule commande ──
{
  const { p, calls } = setup();
  p.onWake(); p.onWake(); p.onTtsStart(); p.onVoiceState("ecoute"); p.onTtsStart();
  check("M: rafale d'événements duckants → UN duck", calls.join() === "duck");
  p.onVoiceState("veille"); p.onVoiceState("pause"); p.onTtsDone();
  check("M: rafale de sorties → UN restore", calls.join() === "duck,restore");
}

// ── récapitulatif ──
let ok = 0;
for (const [n, c] of results) { console.log(`${c ? "ok  " : "FAIL"} ${n}`); if (c) ok++; }
console.log(`\nu-ducking : ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
