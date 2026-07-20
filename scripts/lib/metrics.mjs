// LE CŒUR DE MESURE — module PUR, sans I/O, sans horloge, sans process (conv 51). C'est le « cerveau » du juge :
// il ACCUMULE les tours d'une session, calcule les médianes vs. le banc, formate le résumé et produit la ligne
// d'historique. Le lanceur (`scripts/juge.mjs`) lui donne des CHIFFRES déjà mesurés (latences en ms, scores) ; lui
// ne fait que ranger, agréger et formater.
//
// POURQUOI SÉPARÉ (demande Yohann conv 51 — « quelque chose de solide, complet à chaque fois, pas à réécrire ») :
//   · TESTABLE seul (tests/u-metrics.mjs lui injecte des tours synthétiques → prouve médianes/résumé/historique) →
//     il ne peut plus casser en silence. C'est la garantie « solide ».
//   · RÉUTILISABLE : le même cœur servira à mesurer l'APPLI plus tard (on lui branchera les evt.* de l'app au lieu
//     des 2 process du juge) sans le réécrire. Ici il ne connaît RIEN du WS/des sidecars/du spawn.
//
// Ce qu'il agrège (COMPLET — tout, à chaque run, plus de flags à retenir) :
//   · par tour  : réveil / réponse / clôture · son (ms) · TTFT cerveau · endpointing (attente) · masqueur (+ son délai) · transcript.
//   · endpointing : score Smart Turn de chaque pause vs. les vraies fins (near-cuts).
//   · barge-in  : latence de coupe + score V6 qui l'a déclenchée.
//   · speaker   : reconnaissance V6 (yohann vs inconnu, scores) — « est-ce qu'elle t'a bien reconnu ? ».
//   · hygiène   : nb de process (juge / WarmBrain / sidecars) au départ et à la fin → détecte une fuite/contention.

// Repères connus (banc / juge conv 47) pour dire « régression ou pas » d'un coup d'œil.
export const REF = { reveilLo: 650, reveilHi: 830, reveilJuge: 759, ttftBanc: 1276, ttftJuge: 1389, fillerAfterMs: 3000 };
const TURN_THR = 0.5; // seuil banc Smart Turn (turn.py TURN_THR)

export function median(xs) {
  if (!xs || !xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const r = (x) => (num(x) != null ? Math.round(x) : null);

export class StatsCollector {
  constructor({ ref = REF } = {}) {
    this.ref = ref;
    this.passes = [[]];       // passes[i] = liste de tours {type, sonMs, ttftMs, endpointingMs, filler, fillerDelayMs, transcript}
    this.endpointTurns = [];  // [{evals:[{prob,parle,plaf,reason}], endProb}] — un par tour fini (endpointing)
    this.barges = [];         // [{latMs, score}] — coupures (V8)
    this.speakers = [];       // [{locuteur, score}] — chaque evt.speaker (V6)
    this.hygiene = { start: null, end: null }; // {juge, warm, sidecars} — process comptés (contention)
  }

  get curPass() { return this.passes[this.passes.length - 1]; }

  /** Nouveau « temps » (conversation). Le 1er existe déjà (constructeur). */
  startPass() { this.passes.push([]); }

  /** Range un tour mesuré. `turn` = {type, sonMs, endpointingMs?, filler?, fillerDelayMs?, transcript?}. Le TTFT est
   *  apparié plus tard (finalizeTtft) car il est lu du cerveau APRÈS coup. Retourne le tour rangé (pour formatTurnLine). */
  record(turn) {
    const rec = {
      type: turn.type,
      sonMs: r(turn.sonMs),
      ttftMs: null,
      endpointingMs: r(turn.endpointingMs),
      filler: !!turn.filler,
      fillerDelayMs: r(turn.fillerDelayMs),
      transcript: turn.transcript || null,
    };
    this.curPass.push(rec);
    return rec;
  }

  recordEndpointTurn(t) { this.endpointTurns.push({ evals: t.evals || [], endProb: num(t.endProb) }); }
  recordBarge(b) { this.barges.push({ latMs: r(b.latMs), score: num(b.score) }); }
  recordSpeaker(s) { this.speakers.push({ locuteur: s.locuteur ?? null, score: num(s.score) }); }
  setHygiene(when, counts) { if (when === "start" || when === "end") this.hygiene[when] = counts; }

  /** Apparie les TTFT (dans l'ordre) aux tours 'reponse' (dans l'ordre) — tours sérialisés → 1:1. */
  finalizeTtft(ttftQueue) {
    const reps = this.passes.flat().filter((t) => t.type === "reponse");
    reps.forEach((rec, i) => { rec.ttftMs = i < ttftQueue.length ? num(ttftQueue[i]) : null; });
  }

  /** La ligne temps-réel d'un tour (imprimée par le lanceur au fil de l'eau). */
  formatTurnLine(turn, passNum) {
    const flag = turn.type === "reveil" ? (turn.sonMs != null && turn.sonMs <= this.ref.reveilHi ? "✓ fourchette banc" : `⚠ > ${this.ref.reveilHi}`) : "";
    const att = turn.endpointingMs != null ? `  (endpointing ${turn.endpointingMs})` : "";
    const mq = turn.filler ? `  (masqueur${turn.fillerDelayMs != null ? ` +${turn.fillerDelayMs} ms` : ""})` : "";
    return `  T${passNum} · ${String(turn.type).padEnd(8)} → son ${String(turn.sonMs ?? "?").padStart(5)} ms${att}${mq}  ${flag}`;
  }

  // ── médianes / agrégats ─────────────────────────────────────────────────────────
  medians() {
    const all = this.passes.flat();
    return {
      reveil: median(all.filter((t) => t.type === "reveil").map((t) => t.sonMs).filter((x) => x != null)),
      ttft: median(all.filter((t) => t.type === "reponse").map((t) => t.ttftMs).filter((x) => x != null)),
    };
  }

  /** Le résumé complet, en lignes (le lanceur les imprime). Aucun I/O ici → testable. */
  summaryLines() {
    const out = [];
    out.push("╔══════════════════════════════════════════════════════════╗");
    out.push("║  RÉSUMÉ — le juge à ta voix (latences, ms)                ║");
    out.push("╚══════════════════════════════════════════════════════════╝");
    this.passes.forEach((turns, i) => {
      if (!turns.length) return;
      const reveils = turns.filter((t) => t.type === "reveil").map((t) => t.sonMs).filter((x) => x != null);
      const reponses = turns.filter((t) => t.type === "reponse");
      const rSon = reponses.map((t) => t.sonMs).filter((x) => x != null);
      const rTtft = reponses.map((t) => t.ttftMs).filter((x) => x != null);
      out.push(`\n  TEMPS ${i + 1} (${turns.length} tours) :`);
      for (const t of turns) {
        const att = t.endpointingMs != null ? `  endpointing ${String(t.endpointingMs).padStart(4)}` : "";
        const ttft = t.ttftMs != null ? `  TTFT ${String(t.ttftMs).padStart(5)}` : "";
        const mq = t.filler ? `  (masqueur${t.fillerDelayMs != null ? ` +${t.fillerDelayMs}` : ""})` : "";
        out.push(`    ${String(t.type).padEnd(8)}  → son ${String(t.sonMs ?? "?").padStart(5)} ms${ttft}${att}${mq}`);
      }
      if (reveils.length) out.push(`    → réveil médian     : ${median(reveils)} ms   (banc ${this.ref.reveilLo}-${this.ref.reveilHi} · juge ${this.ref.reveilJuge})`);
      if (rSon.length) out.push(`    → réponse→son médian: ${median(rSon)} ms`);
      if (rTtft.length) out.push(`    → cerveau TTFT médian: ${median(rTtft)} ms   (banc ${this.ref.ttftBanc} · juge ${this.ref.ttftJuge})`);
    });

    // ── VERDICT global (les temps ensemble : le retour après pause reste-t-il chaud ?) ──
    const m = this.medians();
    out.push("\n  ── VERDICT (vs banc/juge) ──");
    if (m.reveil != null) out.push(`  réveil médian global : ${m.reveil} ms → ${m.reveil <= this.ref.reveilHi ? "✓ PAS de régression (≤ fourchette banc)" : "⚠ AU-DESSUS de la fourchette banc"}`);
    if (m.ttft != null) out.push(`  cerveau TTFT médian  : ${m.ttft} ms → ${m.ttft <= this.ref.ttftJuge + 250 ? "✓ dans la plage juge/banc" : "⚠ au-dessus du juge"}`);

    out.push(...this._masqueurLines());
    out.push(...this._endpointLines());
    out.push(...this._bargeLines());
    out.push(...this._speakerLines());
    out.push(...this._hygieneLines());
    return out;
  }

  // Masqueur (« Donne-moi une petite minute ») — le « trop tard » de Yohann, chiffré OBJECTIVEMENT.
  _masqueurLines() {
    const fillers = this.passes.flat().filter((t) => t.type === "reponse" && t.filler);
    const out = ["\n  ── MASQUEUR (« Donne-moi une petite minute », si le cerveau tarde) ──"];
    if (!fillers.length) { out.push("    aucun masqueur joué (le cerveau a répondu à temps sur tous les tours) — c'est le mieux."); return out; }
    const delays = fillers.map((t) => t.fillerDelayMs).filter((x) => x != null);           // depuis ta FIN DE TOUR
    const fromMe = fillers.map((t) => (t.fillerDelayMs ?? 0) + (t.endpointingMs ?? 0)).filter((x) => x > 0); // depuis que TU as fini de parler
    const md = median(delays);
    out.push(`    ${fillers.length} masqueur(s) joué(s).`);
    if (md != null) out.push(`    déclenché à : ${md} ms après ta fin de tour (cible ${this.ref.fillerAfterMs}) → ${Math.abs(md - this.ref.fillerAfterMs) <= 400 ? "✓ à l'heure" : "⚠ décalé"}`);
    if (fromMe.length) out.push(`    ressenti    : ${median(fromMe)} ms depuis que TU as fini de parler (= endpointing + ${this.ref.fillerAfterMs}) — c'est l'ENDPOINTING avant qui donne l'impression de retard, pas le masqueur.`);
    return out;
  }

  // Endpointing (Smart Turn) : score de chaque pause vs. tes vraies fins. Best-effort (croisé conv 48) — au pire on
  // CACHE un near-cut, jamais on n'en invente un (un tour abandonné décale l'étiquette de numéro, compte agrégé juste).
  _endpointLines() {
    const out = ["\n  ── ENDPOINTING (Smart Turn, seuil 0,5 ; « laisse-moi parler avec mes pauses ») ──"];
    if (!this.endpointTurns.length) { out.push("    (aucune donnée d'endpointing ce run)"); return out; }
    const pauses = []; const ends = [];
    this.endpointTurns.forEach((t, i) => {
      const ev = t.evals || [];
      const seq = ev.map((e) => (num(e.prob) != null ? e.prob.toFixed(2) : " — ")).join(" ");
      out.push(`    tour ${String(i + 1).padStart(2)} : [${seq}]  → fin ${num(t.endProb) != null ? t.endProb.toFixed(2) : "?"}`);
      ev.slice(0, -1).forEach((e) => { if (num(e.prob) != null) pauses.push(e.prob); });
      if (num(t.endProb) != null) ends.push(t.endProb);
    });
    const nearCuts = pauses.filter((p) => p > TURN_THR);
    const maxPause = pauses.length ? Math.max(...pauses) : null;
    out.push(`    pauses (silences où tu as REPRIS) : n=${pauses.length}  max=${maxPause != null ? maxPause.toFixed(2) : "—"}  near-cuts (>0,5) = ${nearCuts.length}`);
    out.push(`    vraies fins (score finalisant)    : ${ends.length ? ends.map((e) => e.toFixed(2)).join(", ") : "—"}`);
    out.push(`    → ${nearCuts.length === 0
      ? "✓ aucune pause n'a frôlé la coupe — MARGE saine (seuil 0,5 loin des pauses)"
      : `⚠ ${nearCuts.length} pause(s) ont scoré > 0,5 (frôlé la coupe) — la calibration mordrait ici`}`);
    out.push("    (si tu m'as dit « elle m'a coupé », le tour concerné a une pause à score élevé ci-dessus)");
    return out;
  }

  _bargeLines() {
    const out = ["\n  ── BARGE-IN (V8, « coupe-la en parlant par-dessus ») ──"];
    if (!this.barges.length) { out.push("    aucune coupure ce run — parle PAR-DESSUS sa réponse (pas dans un silence) pour l'armer."); return out; }
    const lats = this.barges.map((b) => b.latMs).filter((x) => x != null);
    const scores = this.barges.map((b) => b.score).filter((x) => x != null);
    out.push(`    ${this.barges.length} coupure(s) ; latence médiane (ta parole → coupure) : ${median(lats) ?? "?"} ms (dominée par l'accumulation V6 ~0,75 s ; loin des 0,7 s visés — calibration V6/plan/02).`);
    if (scores.length) out.push(`    score V6 déclencheur médian : ${median(scores.map((s) => Math.round(s * 100))) / 100} (seuil 0,22 — plus haut = plus sûr que c'est toi).`);
    return out;
  }

  _speakerLines() {
    const out = ["\n  ── SPEAKER-ID (V6, « est-ce qu'elle t'a reconnu ? ») ──"];
    if (!this.speakers.length) { out.push("    aucun evt.speaker ce run (V6 ne score que pendant sa pensée développée = quand le barge est armé)."); return out; }
    const yo = this.speakers.filter((s) => s.locuteur === "yohann");
    const inc = this.speakers.filter((s) => s.locuteur !== "yohann");
    const yScores = yo.map((s) => s.score).filter((x) => x != null);
    out.push(`    ${this.speakers.length} évaluation(s) : ${yo.length} × yohann · ${inc.length} × inconnu (son propre résidu post-AEC doit rester « inconnu » < 0,22 — invariant F2).`);
    if (yScores.length) out.push(`    scores « yohann » : médian ${(median(yScores.map((s) => Math.round(s * 100))) / 100)} · min ${Math.min(...yScores).toFixed(2)} · max ${Math.max(...yScores).toFixed(2)}.`);
    return out;
  }

  _hygieneLines() {
    const h = this.hygiene;
    if (!h.start && !h.end) return [];
    const out = ["\n  ── HYGIÈNE PROCESS (contention — le mal de conv 51) ──"];
    if (h.start) out.push(`    au démarrage (après nettoyage) : juge=${h.start.juge} · WarmBrain=${h.start.warm} · sidecars=${h.start.sidecars}`);
    if (h.end) {
      const leak = h.end.warm > 1 || h.end.sidecars > 2 || h.end.juge > 1;
      out.push(`    à la fin (avant nettoyage)     : juge=${h.end.juge} · WarmBrain=${h.end.warm} · sidecars=${h.end.sidecars} → ${leak ? "⚠ FUITE (des fantômes s'accumulent — le prochain run les nettoiera, mais à surveiller)" : "✓ propre (1 juge, 1 cerveau, 2 sidecars)"}`);
    }
    return out;
  }

  /** La ligne d'historique (le lanceur l'append en JSONL). `ts` injecté (pas d'horloge ici → pur/testable). */
  historyRecord(ts) {
    const m = this.medians();
    const yo = this.speakers.filter((s) => s.locuteur === "yohann");
    const fillers = this.passes.flat().filter((t) => t.type === "reponse" && t.filler);
    return {
      ts,
      reveilMedianMs: m.reveil,
      ttftMedianMs: m.ttft,
      masqueur: {
        count: fillers.length,
        delayMedianMs: median(fillers.map((t) => t.fillerDelayMs).filter((x) => x != null)),
      },
      bargeins: this.barges.map((b) => ({ latMs: b.latMs, score: b.score })),
      speaker: { total: this.speakers.length, yohann: yo.length, inconnu: this.speakers.length - yo.length },
      endpoint: this.endpointTurns.map((t) => ({ evals: (t.evals || []).map((e) => num(e.prob)), endProb: num(t.endProb) })),
      hygiene: this.hygiene,
      temps: this.passes.filter((p) => p.length).map((turns) => turns.map((t) => ({
        type: t.type, sonMs: t.sonMs, ttftMs: t.ttftMs, endpointingMs: t.endpointingMs,
        masqueur: t.filler, masqueurDelayMs: t.fillerDelayMs, transcript: t.transcript,
      }))),
    };
  }
}
