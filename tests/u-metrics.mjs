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
  c.record({ type: "reponse", sonMs: 4600, endpointingMs: 1200, filler: true, fillerDelayMs: 4010 }); // cible 4000 (conv 52)
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
  check("résumé : masqueur à l'heure (~4000)", hasLine(L, "à l'heure"));
  // conv 55 : la SÉQUENCE par tour (hmm · masqueur · cerveau) + le flag « réponse prête PENDANT le masqueur »
  // (ici ttft 4300 - masqueur 4010 = 290 ms < 2 s → le masqueur a retardé la réponse — l'observation de Yohann).
  check("résumé : séquence masqueur + réponse PENDANT (conv 55)",
    hasLine(L, "masqueur +4010") && hasLine(L, "cerveau +4300") && hasLine(L, "PENDANT"));
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
  check("résumé : aucun masqueur = le mieux", hasLine(L, "Donne-moi une petite minute") && hasLine(L, "le mieux"));
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

// ── GPU/CPU (conv 52) : agrégation min/médian/max + résumé + historique ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 760 });
  c.recordGpuCpu({ gpuUtil: 40, vramMb: 3000, cpu: 25 });
  c.recordGpuCpu({ gpuUtil: 60, vramMb: 3200, cpu: 55 });
  c.recordGpuCpu({ gpuUtil: 50, vramMb: 3100, cpu: 35 });
  const L = c.summaryLines();
  check("gpucpu: section présente", hasLine(L, "GPU / CPU"));
  check("gpucpu: GPU util médian/min/max", hasLine(L, "GPU util % : médian 50 · min 40 · max 60"));
  check("gpucpu: VRAM médian/max", hasLine(L, "VRAM Mo    : médian 3100 · max 3200"));
  check("gpucpu: CPU médian/min/max", hasLine(L, "CPU %      : médian 35 · min 25 · max 55"));
  const h = c.historyRecord("2026-07-21T00:00:00.000Z");
  check("gpucpu historique: samples", h.gpucpu.samples === 3);
  check("gpucpu historique: gpuUtilMedian/Max", h.gpucpu.gpuUtilMedian === 50 && h.gpucpu.gpuUtilMax === 60);
  check("gpucpu historique: vramMaxMb", h.gpucpu.vramMaxMb === 3200);
  check("gpucpu historique: cpuMedian/Max", h.gpucpu.cpuMedian === 35 && h.gpucpu.cpuMax === 55);
}

// ── GPU/CPU : GPU absent (pas de NVIDIA) → seulement le CPU, pas de crash ; 0 échantillon → pas de section ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 760 });
  check("gpucpu: aucune section si 0 échantillon", !hasLine(c.summaryLines(), "GPU / CPU"));
  check("gpucpu historique: samples=0", c.historyRecord("t").gpucpu.samples === 0);
  c.recordGpuCpu({ cpu: 42 }); // GPU absent → gpuUtil/vram null
  const L = c.summaryLines();
  check("gpucpu: CPU seul si GPU absent", hasLine(L, "CPU %") && !hasLine(L, "GPU util %"));
  check("gpucpu historique: cpu seul", c.historyRecord("t").gpucpu.cpuMedian === 42 && c.historyRecord("t").gpucpu.gpuUtilMedian === null);
}

// ── RESPAWN (conv 52) : la cause d'un « sidecars > 2 » est DANS les stats (plus besoin de la console) ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 800 });
  c.setHygiene("start", { juge: 1, warm: 1, sidecars: 4 });
  c.recordRespawn({ role: "ears", reason: "fige" });
  c.recordRespawn({ role: "ears", reason: "fige" });
  const L = c.summaryLines();
  check("respawn : résumé montre la cause + le compte", hasLine(L, "respawns au boot : ears/fige×2"));
  check("respawn : explique sidecars > 2", hasLine(L, "EXPLIQUE sidecars > 2"));
  const h = c.historyRecord("t");
  check("respawn : historique conserve role+reason", h.respawns.length === 2 && h.respawns[0].role === "ears" && h.respawns[0].reason === "fige");
}

// ── RESPAWN absent MAIS sidecars > 2 → fantômes d'un run précédent (pas un respawn) ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 800 });
  c.setHygiene("start", { juge: 1, warm: 1, sidecars: 4 });
  check("respawn absent + sidecars>2 → fantômes", hasLine(c.summaryLines(), "AUCUN → les sidecars en trop sont des fantômes"));
  check("respawn : historique vide si aucun", c.historyRecord("t").respawns.length === 0);
}

// ── RESPAWN absent, sidecars=2 → « aucun ✓ » ──
{
  const c = new StatsCollector();
  c.setHygiene("start", { juge: 1, warm: 0, sidecars: 2 });
  check("respawn : aucun ✓ quand propre", hasLine(c.summaryLines(), "respawns au boot : aucun ✓"));
}

// ── PAUSE / REPRISE (V10) : ce que Yohann teste À CHAQUE run est DANS les stats (plus « pas testé » à tort) ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 800 });
  c.recordPause({ transcript: "Attends s'il te plaît" });
  c.recordResume();
  const L = c.summaryLines();
  check("pause/reprise : section présente", hasLine(L, "PAUSE / REPRISE"));
  check("pause/reprise : 1 pause · 1 reprise", hasLine(L, "1 pause(s) tenue(s) · 1 reprise(s)"));
  check("pause/reprise : chaque pause suivie d'une reprise", hasLine(L, "chaque pause a été suivie"));
  const h = c.historyRecord("t");
  check("pause/reprise : historique", h.pauseReprise.pauses === 1 && h.pauseReprise.resumes === 1);
}

// ── PAUSE sans reprise → restée en sommeil (signalé) ; absente si aucune ──
{
  const c = new StatsCollector();
  c.recordPause({ transcript: "Attends" });
  check("pause sans reprise signalée", hasLine(c.summaryLines(), "1 pause(s) sans reprise"));
  check("pause/reprise : section absente si aucune", !hasLine(new StatsCollector().summaryLines(), "PAUSE / REPRISE"));
}

// ── HMM (V10 conv 52) : le « hmm » de réflexion compté (à part du masqueur) ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 760 });
  c.record({ type: "reponse", sonMs: 1200, endpointingMs: 700 });
  check("hmm : 0 par défaut", hasLine(c.summaryLines(), "« hmm » de réflexion : 0 joué"));
  c.recordHmm(); c.recordHmm();
  const L = c.summaryLines();
  check("hmm : compté dans le résumé", hasLine(L, "« hmm » de réflexion : 2 joué"));
  check("hmm : historique", c.historyRecord("t").hmm === 2);
}

// ── SILENCE VÉCU (conv 58) : endpointing + son = ce que Yohann VIT, comparable de session en session ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 800 });
  c.record({ type: "reponse", sonMs: 1500, endpointingMs: 2000 });   // vécu 3500
  c.record({ type: "reponse", sonMs: 2500, endpointingMs: 1500 });   // vécu 4000
  c.record({ type: "reponse", sonMs: 3000, endpointingMs: 4000 });   // vécu 7000 (pire tour)
  c.record({ type: "reponse", sonMs: 1200 });                        // endpointing absent → EXCLU du vécu (jamais un faux chiffre)
  const m = c.medians();
  check("vécu : médian = endpointing+son des tours complets", m.vecu === 4000);
  check("vécu : pire tour", m.vecuMax === 7000);
  check("vécu : réponse→son médian exposé", m.son === median([1500, 2500, 3000, 1200]));
  const L = c.summaryLines();
  check("vécu : LA ligne de comparaison au verdict", hasLine(L, "SILENCE VÉCU médian  : 4000 ms") && hasLine(L, "pire tour 7000 ms"));
  const h = c.historyRecord("t");
  check("vécu : historique (comparaison inter-sessions)", h.vecuMedianMs === 4000 && h.vecuMaxMs === 7000 && h.reponseSonMedianMs === m.son);
}

// ── SILENCE VÉCU absent (aucun tour complet) → pas de ligne, pas de faux chiffre ──
{
  const c = new StatsCollector();
  c.record({ type: "reveil", sonMs: 800 });
  c.record({ type: "reponse", sonMs: 1200 });                        // sans endpointing
  check("vécu : pas de ligne sans donnée", !hasLine(c.summaryLines(), "SILENCE VÉCU"));
  check("vécu : historique null (jamais 0 fabriqué)", c.historyRecord("t").vecuMedianMs === null);
}

// ── récap ──
const ok = results.filter(([, c]) => c).length;
for (const [n, c] of results) if (!c) console.log(`  FAIL  ${n}`);
console.log(`u-metrics : ${ok}/${results.length} ${ok === results.length ? "OK" : "ÉCHECS"}`);
process.exit(ok === results.length ? 0 : 1);
