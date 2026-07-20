// u-metrics — LE CŒUR DE MESURE DU JUGE (conv 51, StatsCollector) — PUR, sans IPC/sidecar/horloge. On lui injecte des
// tours synthétiques et on prouve : médianes (réveil/TTFT), appariement TTFT 1:1 (multi-temps), ligne temps-réel
// (drapeau banc réveil, masqueur), résumé (verdict, masqueur « à l'heure », endpointing near-cuts, barge, speaker,
// hygiène/fuite), et la ligne d'historique (forme + transcript conservé). C'est la garantie « il ne casse plus jamais
// en silence » demandée par Yohann : à chaque `npm test`, le module de mesure est prouvé complet.
import { StatsCollector, median, REF } from "../scripts/lib/metrics.mjs";

const results = [];
const check = (n, c) => results.push([n, !!c]);
const hasLine = (lines, sub) => lines.some((l) => l.includes(sub));

// ── median : pair / impair / vide ──
check("median impair", median([3, 1, 2]) === 2);
check("median pair (moyenne arrondie)", median([1, 2, 3, 4]) === 3); // (2+3)/2 = 2.5 → 3
check("median vide → null", median([]) === null);
check("median null-safe", median(null) === null);

// ── record + medians + appariement TTFT sur PLUSIEURS temps (tours sérialisés → 1:1) ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 800 });
  c.record({ type: "reponse", sonMs: 1200, endpointingMs: 900 });
  c.record({ type: "reponse", sonMs: 1400, endpointingMs: 1000 });
  c.startPass();
  c.record({ type: "reveil", sonMs: 700 });
  c.record({ type: "reponse", sonMs: 1300, endpointingMs: 800 });
  c.record({ type: "clôture", sonMs: 40 });
  c.finalizeTtft([1000, 2000, 1500]); // 3 réponses dans l'ordre (temps1: 2, temps2: 1)
  const reps = c.passes.flat().filter((t) => t.type === "reponse");
  check("TTFT apparié 1:1 dans l'ordre inter-temps", reps[0].ttftMs === 1000 && reps[1].ttftMs === 2000 && reps[2].ttftMs === 1500);
  const m = c.medians();
  check("réveil médian sur les 2 temps", m.reveil === 750);   // median(800,700)
  check("TTFT médian", m.ttft === 1500);                       // median(1000,2000,1500)
}

// ── formatTurnLine : drapeau réveil (banc), masqueur avec délai ──
{
  const c = new StatsCollector();
  const rev = c.record({ type: "reveil", sonMs: 700 });
  check("ligne réveil ✓ sous banc", c.formatTurnLine(rev, 1).includes("✓ fourchette banc"));
  const revBad = c.record({ type: "reveil", sonMs: 1200 });
  check("ligne réveil ⚠ au-dessus banc", c.formatTurnLine(revBad, 1).includes(`⚠ > ${REF.reveilHi}`));
  const rep = c.record({ type: "reponse", sonMs: 3200, endpointingMs: 900, filler: true, fillerDelayMs: 3050 });
  const line = c.formatTurnLine(rep, 2);
  check("ligne réponse montre endpointing", line.includes("endpointing 900"));
  check("ligne réponse montre masqueur + délai", line.includes("masqueur +3050 ms"));
}

// ── summaryLines : verdict, masqueur « à l'heure », endpointing near-cut, barge, speaker, hygiène/fuite ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 780 });
  c.record({ type: "reponse", sonMs: 1300, endpointingMs: 900 });
  c.record({ type: "reponse", sonMs: 3200, endpointingMs: 1200, filler: true, fillerDelayMs: 3050 });
  c.finalizeTtft([1200, 4300]);
  c.recordEndpointTurn({ evals: [{ prob: 0.02 }, { prob: 0.98 }], endProb: 0.98 });            // pas de near-cut
  c.recordEndpointTurn({ evals: [{ prob: 0.72 }, { prob: 0.96 }], endProb: 0.96 });            // 0.72 = near-cut (pause > 0.5)
  c.recordBarge({ latMs: 1700, score: 0.49 });
  c.recordSpeaker({ locuteur: "yohann", score: 0.49 });
  c.recordSpeaker({ locuteur: "inconnu", score: 0.10 });
  c.setHygiene("start", { juge: 1, warm: 0, sidecars: 2 });
  c.setHygiene("end", { juge: 1, warm: 2, sidecars: 2 }); // warm=2 → FUITE
  const L = c.summaryLines();
  check("résumé : verdict réveil ✓", hasLine(L, "réveil médian global : 780 ms") && hasLine(L, "PAS de régression"));
  check("résumé : verdict TTFT", hasLine(L, "cerveau TTFT médian"));
  check("résumé : masqueur à l'heure (~3000)", hasLine(L, "à l'heure"));
  check("résumé : masqueur ressenti = endpointing + 3000", hasLine(L, "ressenti"));
  check("résumé : endpointing 1 near-cut détecté", hasLine(L, "near-cuts (>0,5) = 1"));
  check("résumé : barge latence médiane", hasLine(L, "1700 ms"));
  check("résumé : speaker yohann + inconnu", hasLine(L, "1 × yohann") && hasLine(L, "1 × inconnu"));
  check("résumé : hygiène détecte la fuite", hasLine(L, "FUITE"));
}

// ── summaryLines : « aucun masqueur / aucune coupure » = cas propre ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 760 });
  c.record({ type: "reponse", sonMs: 1200, endpointingMs: 700 });
  const L = c.summaryLines();
  check("résumé : aucun masqueur = le mieux", hasLine(L, "aucun masqueur joué"));
  check("résumé : aucune coupure barge", hasLine(L, "aucune coupure"));
}

// ── historyRecord : forme + transcript conservé + médianes + speaker counts ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 800 });
  c.record({ type: "reponse", sonMs: 1300, endpointingMs: 900, transcript: "raconte-moi Platon" });
  c.record({ type: "reponse", sonMs: 3200, endpointingMs: 1000, filler: true, fillerDelayMs: 3050, transcript: "et Aristote ?" });
  c.finalizeTtft([1200, 4300]);
  c.recordBarge({ latMs: 1700, score: 0.49 });
  c.recordSpeaker({ locuteur: "yohann", score: 0.49 });
  const h = c.historyRecord("2026-07-20T10:00:00.000Z");
  check("historique : ts injecté (pas d'horloge interne)", h.ts === "2026-07-20T10:00:00.000Z");
  check("historique : médianes présentes", h.reveilMedianMs === 800 && typeof h.ttftMedianMs === "number");
  check("historique : masqueur compté", h.masqueur.count === 1 && h.masqueur.delayMedianMs === 3050);
  check("historique : barge conservé", h.bargeins.length === 1 && h.bargeins[0].score === 0.49);
  check("historique : speaker compté", h.speaker.yohann === 1 && h.speaker.total === 1);
  check("historique : transcript conservé par tour", h.temps[0][1].transcript === "raconte-moi Platon" && h.temps[0][2].transcript === "et Aristote ?");
  check("historique : masqueurDelayMs par tour", h.temps[0][2].masqueur === true && h.temps[0][2].masqueurDelayMs === 3050);
}

// ── récap ──
const ok = results.filter(([, c]) => c).length;
for (const [n, c] of results) if (!c) console.log(`  FAIL  ${n}`);
console.log(`u-metrics : ${ok}/${results.length} ${ok === results.length ? "OK" : "ÉCHECS"}`);
process.exit(ok === results.length ? 0 : 1);
