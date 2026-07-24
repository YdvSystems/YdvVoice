// U-M1 — la PRISE EMBED, côté ORCHESTRATEUR (plan 02, M1). Le sidecar CALCULE (test_embed.py le prouve) ;
// ICI on prouve l'ÉCRIVAIN : le GARDE D'ESPACE (refus + santé T17), « LA BASE EST LA FILE » (recalculée après
// respawn), le POISON-ROW (dead-letter après N, jamais un refus d'espace), le chemin CHAUD (embedQuery), et
// ⛔ LES 2 CONTRATS WRITE-ONCE NON NÉGOCIABLES (conv 61) : « zéro vecteur orphelin après effacement » +
// « AUTOINCREMENT, jamais d'id réutilisé/explicite ». Base JETABLE (M0), transport FAKE (déterministe).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { openDatabase } = require("../dist/src/orchestrator/db/index.js");
const { EmbedSpace } = require("../dist/src/orchestrator/memory/embed-space/index.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const results = [];
const check = (name, cond) => results.push([name, !!cond]);

const dbPath = path.join(root, ".sophia-home-dev", "u-m1.sqlite");
const clean = () => { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f); } catch { /* */ } } };

const SPACE = { model: "bge-m3", dimension: 1024, preproc_revision: "v1" };   // == seed embed_space_meta
const vecFor = (t) => Array.from({ length: 1024 }, (_, i) => Math.sin((t.length + i) * 0.7) * 0.03);

/** Transport FAKE déterministe. Modélise les DEUX classes d'échec (clivage du 3ᵉ re-croisé) :
 *  - ERREUR RENVOYÉE par le sidecar (résolue `{error}`, candidat poison) : `poison` (item ciblé) / `failAll` (moteur DOWN) ;
 *  - THROW du TRANSPORT (transitoire, JAMAIS poison) : `throwit` (tout) / `throwOn` (un item précis fait timeout). */
class FakeTransport {
  constructor({ space = SPACE, poison = [], failAll = false, throwit = false, throwOn = [] } = {}) {
    this.space = space; this.poison = poison; this.failAll = failAll; this.throwit = throwit; this.throwOn = throwOn; this.calls = [];
  }
  async embed(items, priority) {
    this.calls.push({ items: [...items], priority });
    if (this.throwit || items.some((t) => this.throwOn.includes(t))) throw new Error("timeout/canal fermé");  // THROW transport
    if (this.failAll) return { ...this.space, vectors: [], error: "engine_down" };                            // erreur SIDECAR
    if (items.some((t) => this.poison.includes(t))) return { ...this.space, vectors: [], error: "poison" };   // erreur SIDECAR
    return { ...this.space, vectors: items.map((t) => vecFor(t)) };
  }
}

clean();
let db = openDatabase(dbPath);
let raw = db.raw;                                         // `let` : les helpers ci-dessous suivent le reopen
const run = (sql, ...a) => raw.prepare(sql).run(...a);
const get = (sql, ...a) => raw.prepare(sql).get(...a);
const insertFact = (content) => run("INSERT INTO facts(content,category,created_at) VALUES(?,?,?)", content, "monde", 1);
const health = [];
let transport = new FakeTransport();
const es = () => new EmbedSpace(raw, transport, { onHealth: (k, d) => health.push({ k, d }), surfaceAfter: 2 });

/** Ferme la poignée AVANT de nettoyer (écrivain unique) puis rouvre une base M0 fraîche. */
function reopen() {
  try { db.close(); } catch { /* */ }
  clean();
  db = openDatabase(dbPath);
  raw = db.raw;
  run("INSERT INTO sessions(id,mode,started_at) VALUES(1,'conversation',1)");
}

/** Ferme + rouvre le MÊME fichier (SANS clean) : un VRAI respawn -> prouve la persistance sur disque (n-3). */
function reopenKeep() {
  try { db.close(); } catch { /* */ }
  db = openDatabase(dbPath);
  raw = db.raw;
}

async function main() {
  run("INSERT INTO sessions(id,mode,started_at) VALUES(1,'conversation',1)");

  // ── A — « LA BASE EST LA FILE » + attribution MORDANTE ─────────────────────────────────────────
  const cA = "Yohann aime The Witcher", cB = "Yohann code un assistant vocal";   // longueurs distinctes -> vecs distincts
  insertFact(cA);   // id 1
  insertFact(cB);   // id 2
  let space = es();
  check("A: base-est-la-file trouve les 2 faits sans vec", space.rowsToEmbed("facts").length === 2);
  let r = await space.embedPending("facts");
  check("A: embedPending écrit les 2 vecteurs", r.written === 2 && r.failed === 0);
  check("A: après écriture, plus rien à embedder", space.rowsToEmbed("facts").length === 0);
  check("A: vec_facts porte 2 vecteurs (rowid = id source)", get("SELECT count(*) c FROM vec_facts").c === 2);
  // MORDANT (A-A croisé) : le vec écrit pour un fait = l'embed de SON contenu (pas d'inversion rows[i]<->vectors[i]).
  const knn = (v) => get("SELECT rowid FROM vec_facts WHERE embedding MATCH ? ORDER BY distance LIMIT 1", JSON.stringify(v)).rowid;
  check("A: attribution MORDANTE — KNN(vec du contenu A) retrouve l'id de A", knn(vecFor(cA)) === 1);
  check("A: attribution MORDANTE — KNN(vec du contenu B) retrouve l'id de B", knn(vecFor(cB)) === 2);
  // VRAI respawn (close+réouverture du fichier) -> la file recalculée depuis le disque (aucune divergence).
  reopenKeep(); space = es();
  check("A: VRAI respawn -> file recalculée depuis le disque (vide)", space.rowsToEmbed("facts").length === 0);
  run("DELETE FROM vec_facts WHERE rowid=?", 1n);
  check("A: vec perdu -> la source est re-sélectionnée (la base est la seule vérité)",
    space.rowsToEmbed("facts").map((x) => x.id).join() === "1");

  // ── B — LE GARDE D'ESPACE (T17) ───────────────────────────────────────────────────────────────
  space = es();
  health.length = 0;
  check("B: espace conforme -> écrit", space.writeVector("facts", 1, vecFor("x"), SPACE).written === true);
  const wModel = space.writeVector("facts", 2, vecFor("x"), { model: "autre", dimension: 1024, preproc_revision: "v1" });
  check("B: modèle non conforme -> REFUS + reason", wModel.written === false && wModel.reason === "space_mismatch");
  const wDim = space.writeVector("facts", 2, vecFor("x"), { model: "bge-m3", dimension: 768, preproc_revision: "v1" });
  check("B: dimension non conforme -> REFUS", wDim.written === false);
  check("B: chaque refus émet un événement de santé (T17)", health.filter((h) => h.k === "embed.space_refused").length === 2);
  check("B: un refus d'espace ne crée AUCUN poison-row (#5)", get("SELECT count(*) c FROM embed_failures").c === 0);

  // ── C — LE SUIVI DES ÉCHECS (opt. b conv 62) : COMPTER + SURFACER (typé) ; ⛔ JAMAIS de dead-letter ────────
  reopen();
  insertFact("POISON");    // id 1 — erreur RENVOYÉE par le sidecar (poison de contenu)
  insertFact("bon fait");  // id 2 — sain
  transport = new FakeTransport({ poison: ["POISON"] });
  space = es();            // surfaceAfter = 2
  health.length = 0;
  const c1 = await space.embedPending("facts", { batchSize: 10 });
  check("C: le bon écrit, l'échec isolé compté", c1.written === 1 && c1.failed === 1 && get("SELECT count(*) c FROM vec_facts").c === 1);
  check("C: après 1 échec, attempts=1 et TOUJOURS re-sélectionné (jamais abandonné)",
    get("SELECT attempts FROM embed_failures WHERE source_id=1").attempts === 1 && space.rowsToEmbed("facts").map((x) => x.id).join() === "1");
  await space.embedPending("facts", { batchSize: 10 });   // attempts=2 = seuil -> SURFACÉ
  const surf = health.find((h) => h.k === "embed.persistent_failure");
  check("C: au seuil -> événement de santé TYPÉ (persistent_failure · kind=sidecar-error · attempts=2)",
    !!surf && surf.d.kind === "sidecar-error" && surf.d.attempts === 2);
  check("C: ⛔ M1 n'auto-dead-letter JAMAIS (dead reste 0) — la ligne reste re-sélectionnée, jamais perdue en silence",
    get("SELECT count(*) c FROM embed_failures WHERE dead=1").c === 0 && space.rowsToEmbed("facts").map((x) => x.id).join() === "1");
  reopenKeep(); space = es();
  check("C: le compteur survit à un VRAI respawn (embed_failures persisté)", get("SELECT attempts FROM embed_failures WHERE source_id=1").attempts === 2);

  // ── C2 — panne SYSTÉMIQUE (sonde-en-premier) : ne COMPTE RIEN (jamais une ligne saine pendant une panne moteur) ──
  reopen();
  insertFact("un"); insertFact("deux"); insertFact("trois");
  transport = new FakeTransport({ failAll: true });   // moteur DOWN (erreur renvoyée sur TOUT, sentinelle comprise)
  space = es();
  health.length = 0;
  const sys = await space.embedPending("facts", { batchSize: 10 });
  check("C2: systemic:true, rien écrit, AUCUNE ligne comptée (pas d'isolate)",
    sys.systemic === true && sys.written === 0 && get("SELECT count(*) c FROM embed_failures").c === 0);
  check("C2: aucun surfaçage sur une panne systémique", !health.some((h) => h.k === "embed.persistent_failure"));
  await space.embedPending("facts", { batchSize: 10 });   // 2e cycle systémique
  check("C2: 2e cycle -> toujours zéro compteur (jamais d'accumulation sur des saines)", get("SELECT count(*) c FROM embed_failures").c === 0);
  transport = new FakeTransport();   // moteur revient
  space = es();
  const back = await space.embedPending("facts", { batchSize: 10 });
  check("C2: moteur revenu -> les 3 lignes s'embeddent (rien perdu à vie)", back.written === 3);

  // ── C3 — ⛔ L'HYDRE FERMÉE (opt. b) : un TIMEOUT TRANSPORT persistant est AUSSI compté + SURFACÉ (kind=timeout), jamais tué ──
  reopen();
  insertFact("flaky"); insertFact("good");
  transport = new FakeTransport({ throwOn: ["flaky"] });   // "flaky" fait TIMEOUT le transport (throw) ; le reste + sentinelle OK
  space = es();   // surfaceAfter = 2
  health.length = 0;
  for (let i = 0; i < 2; i++) await space.embedPending("facts", { batchSize: 10 });
  check("C3: 'good' écrit ; 'flaky' (timeout) COMPTÉ (attempts=2)",
    get("SELECT count(*) c FROM vec_facts").c === 1 && get("SELECT attempts FROM embed_failures WHERE source_id=1").attempts === 2);
  const surfT = health.find((h) => h.k === "embed.persistent_failure");
  check("C3: le timeout persistant est SURFACÉ + TYPÉ (kind=timeout) — plus jamais silencieux (Attack 2 fermée)",
    !!surfT && surfT.d.kind === "timeout");
  check("C3: ⛔ le timeout n'est JAMAIS dead-letterté (dead=0, re-sélectionné) — jamais abandonné à tort",
    get("SELECT count(*) c FROM embed_failures WHERE dead=1").c === 0 && space.rowsToEmbed("facts").some((x) => x.id === 1));
  transport = new FakeTransport();   // le transport GUÉRIT
  space = es();
  await space.embedPending("facts", { batchSize: 10 });
  check("C3: transport guéri -> 'flaky' s'embedde (rien perdu à vie)", get("SELECT count(*) c FROM vec_facts").c === 2);

  // ── C4 — une panne systémique n'INCRÉMENTE PAS le compteur d'une ligne déjà comptée (sonde-en-premier) ──
  reopen();
  insertFact("X"); insertFact("Y");
  transport = new FakeTransport({ poison: ["X"] });
  space = es();
  await space.embedPending("facts", { batchSize: 10 });   // X sidecar-error -> attempts=1 ; Y écrit
  check("C4: X compté (attempts=1), Y écrit", get("SELECT attempts FROM embed_failures WHERE source_id=1").attempts === 1);
  transport = new FakeTransport({ failAll: true });   // moteur DOWN
  space = es();
  const c4 = await space.embedPending("facts", { batchSize: 10 });   // [X] seul -> sonde KO -> systémique -> PAS d'isolate
  check("C4: panne systémique -> X NON incrémenté (sonde-en-premier, pas d'isolate)",
    get("SELECT attempts FROM embed_failures WHERE source_id=1").attempts === 1 && c4.systemic === true);

  // ── C5 — durcissement (ultime check) : un seuil mal configuré (0/non-entier) est borné à >=1 (surfaçage jamais désarmé) ──
  reopen();
  insertFact("z");
  transport = new FakeTransport({ poison: ["z"] });
  const health0 = [];
  const space0 = new EmbedSpace(raw, transport, { onHealth: (k, d) => health0.push({ k, d }), surfaceAfter: 0 });
  await space0.embedPending("facts", { batchSize: 10 });   // seuil 0 -> clampé à >=1 -> surfacé dès attempts=1
  check("C5: seuil 0 borné à >=1 -> surfaçage bien émis (jamais désarmé par une mauvaise config M2)",
    health0.some((h) => h.k === "embed.persistent_failure" && h.d.attempts === 1));

  // ── D — CHEMIN CHAUD (embedQuery) ─────────────────────────────────────────────────────────────
  transport = new FakeTransport();
  space = es();
  const q = await space.embedQuery("qu'est-ce qu'on s'était dit ?");
  check("D: embedQuery rend un vecteur 1024 + l'espace", !!q.vector && q.vector.length === 1024 && q.space.model === "bge-m3");
  transport = new FakeTransport({ poison: ["boom"] });
  space = es();
  const qErr = await space.embedQuery("boom");
  check("D: embedQuery en échec -> {error} (jamais un vecteur inventé)", !!qErr.error && !qErr.vector);

  // ── D2 — le transport qui THROW (timeout/canal fermé) est ENCAPSULÉ, jamais une exception ──────
  transport = new FakeTransport({ throwit: true });
  space = es();
  const qt = await space.embedQuery("x");
  check("D2: embedQuery sur transport qui throw -> {error} (jamais une exception)", !!qt.error && !qt.vector);
  reopen(); insertFact("a"); insertFact("b");
  transport = new FakeTransport({ throwit: true });
  space = es();
  let crashed = false;
  try { await space.embedPending("facts"); } catch { crashed = true; }
  check("D2: embedPending sur transport qui throw -> ne CRASHE pas", !crashed);
  check("D2: throw transport traité en systémique (rien dead-letterré)", get("SELECT count(*) c FROM embed_failures").c === 0);

  // ── G — ⛔ ENFORCEMENT writeVector : refuse d'écrire un orphelin (source disparue) + garde de longueur ──
  reopen();
  transport = new FakeTransport();
  space = es();
  const wGone = space.writeVector("facts", 4242, vecFor("x"), SPACE);   // le fait 4242 n'existe pas
  check("G: writeVector refuse une source disparue (JAMAIS un orphelin créé)", wGone.written === false && wGone.reason === "source_gone");
  check("G: aucun vec écrit pour une source disparue", get("SELECT count(*) c FROM vec_facts WHERE rowid=4242").c === 0);
  insertFact("réel");
  const idReal = get("SELECT max(id) m FROM facts").m;
  const wBadLen = space.writeVector("facts", idReal, [1, 2, 3], SPACE);   // longueur 3 ≠ 1024 déclaré
  check("G: writeVector refuse un vecteur de mauvaise longueur (garde NIT-1)", wBadLen.written === false && wBadLen.reason === "dimension_length");
  check("G: aucun vec écrit pour un vecteur mal dimensionné", get("SELECT count(*) c FROM vec_facts WHERE rowid=?", BigInt(idReal)).c === 0);
  const wNaN = space.writeVector("facts", idReal, Array.from({ length: 1024 }, (_, i) => (i === 5 ? NaN : 0.1)), SPACE);
  check("G: writeVector refuse un vecteur NON FINI (NaN) — garde de finitude (re-croisé)", wNaN.written === false && wNaN.reason === "non_finite");
  check("G: aucun vec écrit pour un vecteur NaN (jamais un throw vec0 qui fuit)", get("SELECT count(*) c FROM vec_facts WHERE rowid=?", BigInt(idReal)).c === 0);

  // ── H — balayages froids CONCURRENTS sérialisés (jamais UNIQUE constraint) ─────────────────────
  reopen();
  insertFact("h1"); insertFact("h2"); insertFact("h3");
  transport = new FakeTransport();
  space = es();
  let hCrash = false;
  try { await Promise.all([space.embedPending("facts", { batchSize: 10 }), space.embedPending("facts", { batchSize: 10 })]); }
  catch { hCrash = true; }
  check("H: deux embedPending concurrents -> aucun UNIQUE constraint (sérialisé par corpus)", !hCrash);
  check("H: chaque source a exactement un vec (aucun doublon)", get("SELECT count(*) c FROM vec_facts").c === 3);

  // ── E — ⛔ CONTRAT WRITE-ONCE 1 : AUTOINCREMENT, JAMAIS d'id réutilisé ─────────────────────────
  reopen();
  transport = new FakeTransport();
  space = es();
  insertFact("premier");
  const idA = get("SELECT max(id) m FROM facts").m;
  await space.embedPending("facts");
  check("E: le rowid du vec = l'id AUTOINCREMENT de la source", get("SELECT rowid FROM vec_facts").rowid === idA);
  run("DELETE FROM facts WHERE id=?", BigInt(idA));       // effacement discipliné : source + vec ensemble
  run("DELETE FROM vec_facts WHERE rowid=?", BigInt(idA));
  insertFact("second");
  const idB = get("SELECT max(id) m FROM facts").m;
  check("E: après effacement, un nouvel insert prend un id NEUF (jamais réutilisé)", idB > idA);
  await space.embedPending("facts");
  check("E: le nouveau vec porte le NOUVEL id (aucune collision avec l'ancien)",
    get("SELECT rowid FROM vec_facts").rowid === idB && idB !== idA);

  // ── F — ⛔ CONTRAT WRITE-ONCE 2 : ZÉRO VECTEUR ORPHELIN APRÈS EFFACEMENT ───────────────────────
  const orphelins = () => get("SELECT count(*) c FROM vec_facts WHERE rowid NOT IN (SELECT id FROM facts)").c;
  check("F: état sain -> zéro orphelin", orphelins() === 0);
  insertFact("à oublier");
  const idC = get("SELECT max(id) m FROM facts").m;
  await space.embedPending("facts");
  run("DELETE FROM facts WHERE id=?", BigInt(idC));       // MORDANT : on OUBLIE le vec (la faute)
  check("F: MORDANT — source effacée sans son vec -> 1 orphelin détecté", orphelins() === 1);
  run("DELETE FROM vec_facts WHERE rowid=?", BigInt(idC));  // discipline M8 : effacer aussi le vec
  check("F: discipline (source + vec) -> zéro vecteur orphelin (contrat tenu)", orphelins() === 0);

  try { db.close(); } catch { /* */ }
  report();
}

function report() {
  let ok = 0;
  for (const [name, pass] of results) { console.log(`${pass ? "OK  " : "FAIL"}  ${name}`); if (pass) ok++; }
  console.log(`\nu-m1 : ${ok}/${results.length} — la prise embed côté orchestrateur (garde · base-est-la-file · suivi des échecs [compte+surface, jamais de dead] · 2 contrats write-once)`);
  if (ok !== results.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
