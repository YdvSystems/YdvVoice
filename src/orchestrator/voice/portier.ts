// La GRILLE d'intention (TS) — copie EXACTE des fonctions PURES du portier sidecar (V7 morceau C, embryon V9/V10).
//
// Le portier tourne DÉJÀ dans le sidecar (`sidecar/consumers/stt.py` : `_gate_check` appelle `wake.on_wake` /
// `wake.release`) → l'éveil sort en `evt.wake`, mais la CLÔTURE (`wake.release()`) est SILENCIEUSE (aucun emit).
// Le routeur doit donc décider lui-même, sur le transcript, si un tour ferme la conversation (« Merci Sophia, à
// plus tard ») ou continue. La conception cible V10 met la grille d'intention CÔTÉ ORCHESTRATEUR ; V7 en pose
// l'embryon. Deux options ont été pesées (plan/01 §Frontières) :
//   (a) grille TS = copie EXACTE du portier, décidée SYNCHRONIQUEMENT à `evt.turn.end` (le transcript précède
//       toujours turn.end) — ZÉRO changement sidecar (V3/V4/V5 verrouillés). ← RETENU.
//   (b) le sidecar SIGNALE la clôture au release : mais `release()` tourne dans `_gate_check` APRÈS
//       `_emit_turn_end` → le signal arriverait APRÈS turn.end → décision impossible en synchrone (course).
// Le risque de (a) = une DIVERGENCE Python↔TS sur les fonctions FEUILLES (normalisation/marqueurs) rendrait routeur
// et sidecar incohérents. Ce risque-là est FERMÉ PAR CONSTRUCTION : `tests/u-portier-parity.mjs` fait tourner le VRAI
// portier Python sur un corpus et exige des feuilles au verdict IDENTIQUE — « testée identique au portier » (plan/01).
// NB (croisé conv 47) : la parité couvre les FEUILLES, pas la COMPOSITION — le routeur ferme un tour sur `matchClosing`
// SEUL (== branche active de `_on_turn` du banc), là où le sidecar désarme via son propre `_gate_check`. Pour les
// transcrits RÉALISTES (clôtures « … à plus tard », « bonne nuit sophia »), les deux concordent (vérifié croisé C).
//
// PORT LIGNE À LIGNE de `sidecar/consumers/stt.py` (`_norm`, `OPEN_PHRASES`, `CLOSE_MARKERS`, `match_opening`,
// `match_closing`, `is_goodnight`, `is_hallucination`). Toute évolution du portier Python DOIT être répercutée ici
// (le test de parité MORD sinon). Fonctions PURES, sans état — se testent seules.

/** Normalise pour la grille (== `_norm` Python) : minuscules, ponctuation/tirets → espaces, « sofia » → « sophia »
 *  (le STT écrit parfois « Sofia »), espaces compressés. */
export function norm(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(/[.,!?;:…'’"\-]/g, " "); // == re.sub(r"[.,!?;:…'’\"\-]", " ", t)
  t = t.replace(/\bsofia\b/g, "sophia"); // == re.sub(r"\bsofia\b", "sophia", t)
  return t.replace(/\s+/g, " ").trim();
}

// Adresse par PHRASE : le STT lit « … Sophia » ; « Sophie/Sonia » ne matchent pas. NORMALISÉES à la construction
// (comme le transcript à l'usage) → « dis-moi » et « dis moi » deviennent UNE forme. (== OPEN_PHRASES/stt.py)
// V10-partiel (conv 51) : « tu es là Sophia ? » (+ variantes) est AUSSI un réveil → il sort le portier du sommeil
// name-only d'une PAUSE. Si l'orchestrateur tient une pensée en pause, ce réveil la REPREND (sinon = simple présence).
// ADDITIF — doit rester IDENTIQUE au sidecar (parité `u-portier-parity`).
const OPEN_PHRASES = [
  "bonjour sophia", "bonsoir sophia", "dis-moi sophia", "salut sophia", "bonne nuit sophia",
  "tu es là sophia", "tu es la sophia", "sophia tu es là", "sophia tu es la", "es-tu là sophia", "es-tu la sophia",
].map(norm);
// Clôture = son NOM + une façon de dire au revoir. Un simple « merci Sophia » ne ferme PAS (décision Yohann conv 27).
// NORMALISÉES aussi (les apostrophes des marqueurs bruts deviendraient sinon incomparables). (== CLOSE_MARKERS/stt.py)
const CLOSE_MARKERS = [
  "à plus tard", "a plus tard", "à bientôt", "a bientot", "à tout à l'heure",
  "a tout a l'heure", "à demain", "a demain", "au revoir", "bonne nuit",
  "on s'arrête", "on arrête",
].map(norm);

/** Le transcript contient-il une phrase d'éveil (… Sophia) ? Rejette Sophie/Sonia. (== match_opening) */
export function matchOpening(transcript: string): boolean {
  const n = norm(transcript);
  return OPEN_PHRASES.some((p) => n.includes(p));
}

/** Ôte les accents (== NFD + retrait des marques combinantes) — pour un match tolérant côté orchestrateur. */
function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Mn}/gu, "");
}

/** V10-partiel (conv 51) — SUSPENSION : « attends s'il te plaît » (+ variantes polies). ORCHESTRATEUR-SEUL (pas de
 *  contrepartie sidecar → HORS parité) : le routeur l'appelle APRÈS un barge pour disambiguer « garde ta pensée et
 *  reprends » (pause) vs « nouvelle question » (barge d'aujourd'hui). PRÉCIS À DESSEIN : ce qui reste après avoir ôté
 *  le nom, la politesse et les petits fillers d'attente doit être EXACTEMENT un mot d'attente — sinon une vraie
 *  demande (« attends, explique-moi X ») serait prise à tort pour une pause. Accent-insensible. */
export function matchPause(transcript: string): boolean {
  const n = stripAccents(norm(transcript))
    .replace(/\bsophia\b/g, " ")
    .replace(/\bs il te plait\b/g, " ")
    .replace(/\bs il vous plait\b/g, " ")
    .replace(/\b(un peu|un instant|un moment|deux secondes|une seconde|une minute|juste)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return /^(attends|attend|attendez|patiente|patientez)$/.test(n);
}

/** Clôture = « sophia » + un marqueur d'au revoir (« à plus tard »/« bonne nuit »…). (== match_closing) */
export function matchClosing(transcript: string): boolean {
  const n = norm(transcript);
  return n.includes("sophia") && CLOSE_MARKERS.some((m) => n.includes(m));
}

/** « bonne nuit Sophia » = éveil-clôture (elle répond bonne nuit puis se rendort). (== is_goodnight) */
export function isGoodnight(transcript: string): boolean {
  return norm(transcript).includes("bonne nuit");
}

// ── Filet anti-hallucination STT (dernier rempart APRÈS le vad_filter) : ne pas répondre à du vent. (== stt.py) ──
const PHANTOMS = [
  "merci d avoir regarde", "sous titrage", "sous titres realises par",
  "amara org", "abonnez vous", "merci a tous et a bientot", "merci de votre attention",
];

/** == `_norm_halluc` : minuscules, sans accents (NFD + retrait des marques combinantes), ne garde que [a-z0-9 ]. */
function normHalluc(text: string): string {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, ""); // ôte les accents (== category != Mn)
  return t.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** True = fantôme Whisper / vide / no_speech élevé → NE PAS traiter (== is_hallucination[0]). `nsp` optionnel. */
export function isHallucination(text: string, noSpeechProb?: number | null): boolean {
  const n = normHalluc(text);
  if (n.length === 0) return true;
  for (const p of PHANTOMS) if (n.includes(p)) return true;
  if (noSpeechProb != null && noSpeechProb > 0.8) return true;
  return false;
}
