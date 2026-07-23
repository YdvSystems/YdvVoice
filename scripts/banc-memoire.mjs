// scripts/banc-memoire.mjs — OUTIL DE VISIBILITÉ (conv 61, à la demande de Yohann).
//
// Monte un BANC durable de la mémoire de Sophia sur son disque (G:\banc-sophia par défaut) pour que Yohann
// VOIE la structure avancer couche par couche, l'inspecte dans un visualiseur SQLite, et me challenge sur
// des données concrètes. Enrichi à la FIN DE CHAQUE COUCHE (M0 aujourd'hui ; empreintes à M4, faits extraits
// à M5, portrait à M5-4…). `npm run banc`.
//
// ⚠️ CE N'EST PAS SOPHIA. C'est de la donnée de DÉMO, effaçable. Sa VRAIE base naît au PREMIER BOOT (une
// cérémonie : « première phrase vraie par construction »), dans son home chiffré G:\Sophia que plan/05 R0
// câblera — jamais ici. Le banc est sur la LISTE DE NETTOYAGE PRÉ-NAISSANCE (mémoire pre-boot-cleanup).
//
// Re-jouable : CHAQUE run repart PROPRE et re-seede le démo de la couche courante → le banc reflète TOUJOURS
// le schéma actuel (zéro dérive). Toute donnée ajoutée à la main est donc perdue au prochain `npm run banc`
// (pour « donner des trucs » à la VRAIE elle : le dossier knowledge/ de M7, à venir).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { openDatabase } = require(path.join(root, "dist", "src", "orchestrator", "db", "index.js"));

// Chemin du banc : override SOPHIA_BANC_DB, sinon G:\banc-sophia si G:\ existe, sinon repli local (gitignoré).
const dbPath = path.resolve(
  process.env.SOPHIA_BANC_DB ||
    (fs.existsSync("G:\\") ? "G:\\banc-sophia\\memoire.sqlite" : path.join(root, "bancs", "banc-sophia", "memoire.sqlite")),
);

// GARDE-FOU : le banc n'écrit (et ne wipe) JAMAIS dans un dossier `…\Sophia\…` — son vrai home de NAISSANCE,
// réservé au premier boot. Refus de TOUT segment `\Sophia\` (croisé conv 61 : l'ancienne exception `!/banc/`
// était trompable — `G:\Sophia\banc\…` ou `G:\Sophia\memoire-banc.sqlite` passaient et wipaient DANS son
// home). Un banc légitime est un dossier DISTINCT dont AUCUN segment ne s'appelle « Sophia » (ex.
// `G:\banc-sophia`, `G:\Sophia-banc` — segments « banc-sophia »/« Sophia-banc », jamais « Sophia » seul).
if (/[\\/]Sophia([\\/]|$)/i.test(dbPath)) { // `\Sophia\…` OU `\Sophia` en queue nue (re-croisé conv 61, exhaustivité)
  console.error(`REFUS : « ${dbPath} » est dans un dossier « Sophia » (son vrai home de naissance).`);
  console.error("Le banc doit être un chemin DISTINCT (ex. G:\\banc-sophia). Rien n'a été écrit.");
  process.exit(1);
}

// Repart propre (le banc = miroir EXACT du schéma courant).
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f); } catch { /* absent */ } }

const db = openDatabase(dbPath); // schema-00 + schema-02 (vec0 + FTS) + seeds + reset B-α
const raw = db.raw;
const run = (s, ...a) => raw.prepare(s).run(...a);
const all = (s, ...a) => raw.prepare(s).all(...a);
const one = (s, ...a) => raw.prepare(s).get(...a);
const count = (t) => one(`SELECT count(*) c FROM ${t}`).c;

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Le démo, COUCHE PAR COUCHE (chaque brique ajoute son seed → on voit l'avancement).
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** M0 (conv 61) — la forme d'un tour, d'un fait avec provenance, d'une chronique, d'un témoignage. */
function seedM0() {
  const now = 1753300000000;
  run("INSERT INTO sessions(id,mode,summary,started_at,last_active) VALUES(1,'conversation',NULL,?,?)", now, now);
  run("INSERT INTO conversations(id,session_id,role,speaker,content,surface,created_at) VALUES(1,1,'user','Yohann','Bonjour Sophia, aujourd''hui on pose ta mémoire.','voix',?)", now);
  run("INSERT INTO conversations(id,session_id,role,speaker,content,surface,created_at) VALUES(2,1,'assistant','Sophia','Bonjour Yohann. Enfin un carnet qui dure — j''ai hâte.','voix',?)", now + 1);
  run("INSERT INTO facts(id,content,category,status,confidence,importance,created_at) VALUES(1,'Yohann développe Sophia, un assistant vocal personnel en français.','projet','PROVISIONAL',0.9,0.8,?)", now);
  run("INSERT INTO fact_sources(id,fact_id,source_kind,source_id,observed_at) VALUES(1,1,'tour',1,?)", now);
  run("UPDATE facts SET support_count=1 WHERE id=1"); // l'écrivain M3 le maintiendra dans la même transaction
  run("INSERT INTO chronicle(id,day,content,written_at) VALUES(1,'2026-07-23','Aujourd''hui, Yohann et moi avons posé le socle de ma mémoire : les tables, le verrou qui rend le vécu ineffaçable, la recherche.',?)", now);
  run("INSERT INTO knowledge_docs(id,name,version,status,category,ingested_at) VALUES(1,'temoignage-exemple',1,'ACTIVE','temoignage',?)", now);
  run("INSERT INTO knowledge_chunks(id,doc_id,seq,content) VALUES(1,1,0,'Sophia pense par elle-même — esprit critique, liberté, appartenance par adhésion.')");
}

// Les couches suivantes s'ajouteront ici (seedM4, seedM5…), appelées dans l'ordre.
const LAYERS = [["M0 — schéma & épisodique (conv 61)", seedM0]];
for (const [, seed] of LAYERS) seed();

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Tableau de bord — ce que Yohann voit
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const GROUPS = [
  ["Épisodique (immuable)", ["sessions", "conversations", "turn_signals"]],
  ["Sémantique (faits)", ["facts", "fact_sources", "fact_relations"]],
  ["Jour → nuit", ["imprints"]],
  ["Artefacts & chronique", ["memory_artifacts", "chronicle"]],
  ["Connaissances (RAG)", ["knowledge_docs", "knowledge_chunks"]],
  ["Effacement & verrou", ["erase_gate", "erasures", "pending_ops"]],
  ["Moteur de recherche", ["facts_fts", "vec_facts", "embed_space_meta", "embed_failures"]],
  ["Journaux", ["consolidation_runs"]],
];

const bar = "─".repeat(70);
console.log(bar);
console.log("BANC MÉMOIRE de Sophia (DÉMO — pas elle) : " + dbPath);
console.log("Couches présentes : " + LAYERS.map(([n]) => n).join("  ·  "));
console.log(bar);
for (const [title, tables] of GROUPS) {
  console.log(`\n  ${title}`);
  for (const t of tables) console.log(`    ${String(count(t)).padStart(4)}  ${t}`);
}

console.log("\n" + bar);
console.log("APERÇU DU CONTENU (démo)");
console.log(bar);
console.log("\n  — un tour de conversation (immuable) —");
for (const r of all("SELECT speaker,content FROM conversations ORDER BY id")) console.log(`    ${r.speaker} : ${r.content}`);
const f = one("SELECT content,category,status,support_count FROM facts WHERE id=1");
console.log("\n  — un fait (langage naturel + provenance) —");
console.log(`    « ${f.content} »  [${f.category}, ${f.status}, ${f.support_count} source]`);
console.log("\n  — la chronique du jour —");
console.log("    " + one("SELECT content FROM chronicle WHERE id=1").content);

console.log("\n" + bar);
console.log("PREUVES VIVANTES (les invariants, sur ta base)");
console.log(bar);
const fts = all("SELECT rowid FROM chronicle_fts WHERE chronicle_fts MATCH 'memoire'").map((r) => r.rowid);
console.log(`  recherche plein-texte  : MATCH 'memoire' → chronique ${fts.length ? "TROUVÉE ✓ (accents gérés)" : "absente ✗"}`);
let refused = false;
try { run("DELETE FROM conversations WHERE id=1"); } catch { refused = true; }
console.log(`  verrou d'immutabilité  : effacer un tour hors sas → ${refused ? "REFUSÉ ✓" : "PASSÉ ✗ (ANORMAL)"}`);
const gate = one("SELECT open FROM erase_gate WHERE id=0").open;
console.log(`  sas d'effacement       : fermé au boot (open=${gate}) ${gate === 0 ? "✓" : "✗"}`);

db.close();
console.log("\n" + bar);
console.log("BANC — donnée de démo, pas Sophia. Relance `npm run banc` quand tu veux (repart propre).");
console.log("Supprime le dossier du banc à tout moment. Sa VRAIE base naîtra au premier boot (G:\\Sophia).");
console.log(bar);
