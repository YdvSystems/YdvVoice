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
// fillerAfterMs : cible du masqueur pour le verdict « à l'heure ». 4000 (calé à l'oreille par Yohann conv 52,
// router.ts — hmm au seuil SOPHIA_HMM_AFTER_MS [défaut 1,4 s, conv 56] × proba SOPHIA_HMM_PROB [0,6], phrase à 4 s).
export const REF = { reveilLo: 650, reveilHi: 830, reveilJuge: 759, ttftBanc: 1276, ttftJuge: 1389, fillerAfterMs: 4000 };
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
    this.gpucpu = [];         // [{gpuUtil, vramMb, cpu}] — échantillons de charge pendant les tours (conv 52)
    this.hmms = 0;            // V10 (conv 52) : nb de « hmm » de réflexion joués (clip à 1,5 s, AVANT le masqueur)
    this.respawns = [];       // [{role, reason}] — respawns AU BOOT (conv 52 : explique un compte de sidecars > 2 SANS lire la console)
    this.pauses = [];         // [{transcript}] — V10 : « attends s'il te plaît » → pensée gardée, sommeil name-only
    this.resumes = [];        // [{}]           — V10 : « tu es là ? » → reprise au début de la phrase coupée
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
      hmmDelayMs: r(turn.hmmDelayMs),   // conv 55 : délai du « hmm » depuis la fin de tour (Yohann veut voir quand il part)
      transcript: turn.transcript || null,
    };
    this.curPass.push(rec);
    return rec;
  }

  /** V10 (conv 52) : un « hmm » de réflexion joué (comble le petit blanc à ~1,5 s, AVANT le masqueur). */
  recordHmm() { this.hmms += 1; }
  recordEndpointTurn(t) { this.endpointTurns.push({ evals: t.evals || [], endProb: num(t.endProb) }); }
  recordBarge(b) { this.barges.push({ latMs: r(b.latMs), score: num(b.score) }); }
  recordSpeaker(s) { this.speakers.push({ locuteur: s.locuteur ?? null, score: num(s.score) }); }
  setHygiene(when, counts) { if (when === "start" || when === "end") this.hygiene[when] = counts; }
  /** conv 52 : un échantillon de charge (GPU util %, VRAM Mo, CPU %) pris pendant une conversation. */
  recordGpuCpu(s) { this.gpucpu.push({ gpuUtil: num(s.gpuUtil), vramMb: num(s.vramMb), cpu: num(s.cpu) }); }
  /** conv 52 : un respawn au boot (raison = fige/spawn-echoue/crash). Enregistré depuis le log du superviseur → la
   *  cause d'un « sidecars > 2 » est DANS les stats, plus besoin de lire la console (demande Yohann). */
  recordRespawn(x) { this.respawns.push({ role: x.role ?? null, reason: x.reason ?? null }); }
  /** V10 : une pause tenue (« attends s'il te plaît » → elle garde sa pensée). */
  recordPause(p = {}) { this.pauses.push({ transcript: p.transcript || null }); }
  /** V10 : une reprise (« tu es là ? » → « Oui, je suis là » + reprise de la phrase coupée). */
  recordResume() { this.resumes.push({}); }

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
    const reps = all.filter((t) => t.type === "reponse");
    // SILENCE VÉCU (conv 58, demande Yohann « qu'on puisse vraiment comparer chaque conversation de test ») :
    // ce que Yohann VIT = fin de SA parole → premier son d'elle = endpointing (elle décide qu'il a fini) + réponse→son.
    // Le résumé les séparait → la latence RESSENTIE n'était comparable qu'à la main. C'est LA ligne de comparaison
    // de session en session (une dérive ici = « une petite régression qui ne dit pas son nom » — jamais sous le tapis).
    const vecus = reps.filter((t) => t.sonMs != null && t.endpointingMs != null).map((t) => t.endpointingMs + t.sonMs);
    return {
      reveil: median(all.filter((t) => t.type === "reveil").map((t) => t.sonMs).filter((x) => x != null)),
      ttft: median(reps.map((t) => t.ttftMs).filter((x) => x != null)),
      son: median(reps.map((t) => t.sonMs).filter((x) => x != null)),
      vecu: median(vecus),
      vecuMax: vecus.length ? Math.max(...vecus) : null,
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
        const mq = t.filler ? `  (${t.hmmDelayMs != null ? `hmm +${t.hmmDelayMs} · ` : ""}masqueur${t.fillerDelayMs != null ? ` +${t.fillerDelayMs}` : ""})` : "";
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
    // conv 58 : LA ligne ressentie, comparable de session en session (l'historique la porte : vecuMedianMs/vecuMaxMs).
    if (m.vecu != null) out.push(`  SILENCE VÉCU médian  : ${m.vecu} ms (fin de TA parole → son d'elle = endpointing + réponse) · pire tour ${m.vecuMax} ms — à comparer de session en session`);

    out.push(...this._masqueurLines());
    out.push(...this._endpointLines());
    out.push(...this._bargeLines());
    out.push(...this._pauseResumeLines());
    out.push(...this._speakerLines());
    out.push(...this._gpuCpuLines());
    out.push(...this._hygieneLines());
    return out;
  }

  // PAUSE / REPRISE (V10) : « attends s'il te plaît » → elle garde sa pensée ; « tu es là ? » → elle revient et reprend
  // au début de la phrase coupée. Ce que Yohann teste À CHAQUE run → désormais DANS les stats (plus « pas testé » à tort).
  _pauseResumeLines() {
    if (!this.pauses.length && !this.resumes.length) return [];
    const out = ["\n  ── PAUSE / REPRISE (V10, « attends s'il te plaît » → « tu es là ? ») ──"];
    out.push(`    ${this.pauses.length} pause(s) tenue(s) · ${this.resumes.length} reprise(s).`);
    if (this.pauses.length && this.resumes.length >= this.pauses.length) {
      out.push("    ✓ chaque pause a été suivie d'une reprise (pensée gardée puis phrase coupée reprise au début).");
    } else if (this.pauses.length > this.resumes.length) {
      out.push(`    ⚠ ${this.pauses.length - this.resumes.length} pause(s) sans reprise (restée en sommeil name-only — pas rappelée, ou reprise ratée).`);
    } else if (this.resumes.length) {
      out.push("    (reprise(s) sans pause enregistrée — vérifier l'appariement des logs).");
    }
    return out;
  }

  // GPU / CPU (conv 52) : la charge réelle pendant les conversations — la contention se VOIT ici (au lieu de la
  // déduire du nombre de process). Échantillonné périodiquement par le lanceur ; agrégé min/médian/max.
  _gpuCpuLines() {
    if (!this.gpucpu.length) return [];
    const out = ["\n  ── GPU / CPU (charge pendant les conversations) ──"];
    const g = this.gpucpu.map((s) => s.gpuUtil).filter((x) => x != null);
    const v = this.gpucpu.map((s) => s.vramMb).filter((x) => x != null);
    const c = this.gpucpu.map((s) => s.cpu).filter((x) => x != null);
    out.push(`    ${this.gpucpu.length} échantillon(s).`);
    if (g.length) out.push(`    GPU util % : médian ${median(g)} · min ${Math.min(...g)} · max ${Math.max(...g)}`);
    if (v.length) out.push(`    VRAM Mo    : médian ${median(v)} · max ${Math.max(...v)}`);
    if (c.length) out.push(`    CPU %      : médian ${median(c)} · min ${Math.min(...c)} · max ${Math.max(...c)}`);
    return out;
  }

  // Masqueur (« Donne-moi une petite minute ») — le « trop tard » de Yohann, chiffré OBJECTIVEMENT.
  _masqueurLines() {
    const fillers = this.passes.flat().filter((t) => t.type === "reponse" && t.filler);
    const out = ["\n  ── COMBLEURS DU BLANC (hmm à 1,4 s × proba 0,6 [conv 56] · masqueur « Donne-moi une petite minute » à 4 s) ──"];
    out.push(`    « hmm » de réflexion : ${this.hmms} joué(s) (clip non-verbal, seuil 1,4 s, aléatoire ~3/5).`);
    if (!fillers.length) { out.push("    masqueur « Donne-moi une petite minute » : aucun (le cerveau a répondu à temps) — le mieux."); return out; }
    // conv 55 (demande Yohann) : la SÉQUENCE par tour — quand le hmm part, quand le masqueur part, quand le cerveau
    // répond. Le masqueur est une ÉNONCIATION (~2 s) : la vraie réponse attend DERRIÈRE lui dans la file → si le
    // cerveau finit PENDANT qu'il joue, on l'entend « juste après » la petite minute — et le masqueur l'a alors RETARDÉE.
    const FILLER_DUR = 2000; // durée approx du clip « Donne-moi une petite minute »
    out.push(`    ${fillers.length} masqueur(s) — séquence par tour (délais depuis ta fin de tour) :`);
    let pendantMasqueur = 0;
    for (const t of fillers) {
      const gap = (num(t.ttftMs) != null && num(t.fillerDelayMs) != null) ? t.ttftMs - t.fillerDelayMs : null; // cerveau prêt APRÈS le déclenchement du masqueur
      const dur = gap != null && gap < FILLER_DUR;
      if (dur) pendantMasqueur += 1;
      const hmm = t.hmmDelayMs != null ? `+${t.hmmDelayMs}` : "—";
      out.push(`      hmm ${hmm} · masqueur +${t.fillerDelayMs ?? "?"} · cerveau ${t.ttftMs != null ? "+" + t.ttftMs : "?"}`
        + (gap != null ? `  (cerveau prêt ${gap >= 0 ? "+" + gap : gap} ms après le masqueur${dur ? " ⚠ PENDANT qu'il jouait" : ""})` : ""));
    }
    const md = median(fillers.map((t) => t.fillerDelayMs).filter((x) => x != null));
    if (md != null) out.push(`    → masqueur déclenché à ${md} ms (cible ${this.ref.fillerAfterMs}) → ${Math.abs(md - this.ref.fillerAfterMs) <= 400 ? "✓ à l'heure" : "⚠ décalé"}`);
    if (pendantMasqueur) out.push(`    → ⚠ ${pendantMasqueur}/${fillers.length} : le cerveau était prêt PENDANT le masqueur (~2 s) → la réponse attend derrière lui dans la file, tu l'entends « juste après » — et le masqueur l'a RETARDÉE. C'est ton observation. (Levier : couper le masqueur dès que la réponse arrive, ou reculer/supprimer son seuil.)`);
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
    // conv 52 — POURQUOI sidecars > 2 : le juge lit les respawns du superviseur → la cause est ICI, plus dans la console.
    if (this.respawns.length) {
      const by = {};
      for (const rs of this.respawns) { const k = `${rs.role ?? "?"}/${rs.reason ?? "?"}`; by[k] = (by[k] || 0) + 1; }
      out.push(`    respawns au boot : ${Object.entries(by).map(([k, n]) => `${k}×${n}`).join(" · ")} → EXPLIQUE sidecars > 2 (un sidecar tué met ~15 s à mourir sous CUDA → le neuf + l'agonisant coexistent).`);
    } else if (h.start && h.start.sidecars > 2) {
      out.push("    respawns au boot : AUCUN → les sidecars en trop sont des fantômes d'un run PRÉCÉDENT (pas un respawn ; le nettoyage convergent aurait dû les prendre — à investiguer).");
    } else if (h.start) {
      out.push("    respawns au boot : aucun ✓");
    }
    return out;
  }

  /** La ligne d'historique (le lanceur l'append en JSONL). `ts` injecté (pas d'horloge ici → pur/testable). */
  historyRecord(ts) {
    const m = this.medians();
    const yo = this.speakers.filter((s) => s.locuteur === "yohann");
    const fillers = this.passes.flat().filter((t) => t.type === "reponse" && t.filler);
    const gu = this.gpucpu.map((s) => s.gpuUtil).filter((x) => x != null);
    const gv = this.gpucpu.map((s) => s.vramMb).filter((x) => x != null);
    const gc = this.gpucpu.map((s) => s.cpu).filter((x) => x != null);
    return {
      ts,
      reveilMedianMs: m.reveil,
      ttftMedianMs: m.ttft,
      reponseSonMedianMs: m.son,   // conv 58 : médianes de COMPARAISON en tête de ligne (le détail par tour est dans `temps`)
      vecuMedianMs: m.vecu,        // conv 58 : le SILENCE VÉCU (endpointing + son) — LA ligne à suivre de session en session
      vecuMaxMs: m.vecuMax,
      gpucpu: {
        samples: this.gpucpu.length,
        gpuUtilMedian: median(gu), gpuUtilMax: gu.length ? Math.max(...gu) : null,
        vramMaxMb: gv.length ? Math.max(...gv) : null,
        cpuMedian: median(gc), cpuMax: gc.length ? Math.max(...gc) : null,
      },
      hmm: this.hmms,   // V10 (conv 52) : nb de « hmm » de réflexion joués
      masqueur: {
        count: fillers.length,
        delayMedianMs: median(fillers.map((t) => t.fillerDelayMs).filter((x) => x != null)),
      },
      bargeins: this.barges.map((b) => ({ latMs: b.latMs, score: b.score })),
      respawns: this.respawns.map((rs) => ({ role: rs.role, reason: rs.reason })),
      pauseReprise: { pauses: this.pauses.length, resumes: this.resumes.length },
      speaker: { total: this.speakers.length, yohann: yo.length, inconnu: this.speakers.length - yo.length },
      endpoint: this.endpointTurns.map((t) => ({ evals: (t.evals || []).map((e) => num(e.prob)), endProb: num(t.endProb) })),
      hygiene: this.hygiene,
      temps: this.passes.filter((p) => p.length).map((turns) => turns.map((t) => ({
        type: t.type, sonMs: t.sonMs, ttftMs: t.ttftMs, endpointingMs: t.endpointingMs,
        masqueur: t.filler, masqueurDelayMs: t.fillerDelayMs, hmmDelayMs: t.hmmDelayMs, transcript: t.transcript,
      }))),
    };
  }
}
