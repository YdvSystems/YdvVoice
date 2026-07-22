// E2E-V12 — le MIXER WINDOWS du ducking, CŒUR RÉEL (vrai helper PowerShell, vraies sessions WASAPI).
//
// Le test cible des process TÉMOINS créés ici (hook `onlyPids` — powershell qui joue un silence en boucle →
// session de rendu réelle) et ne baisse jamais les sessions de l'utilisateur. Résidu honnête (NIT re-croisé) :
// le chemin filet-boot du bloc 5 restaure PAR NOM (« powershell ») — une session powershell TIERCE qui jouerait
// de l'audio pendant le run serait remise à un volume PLEIN (une écriture, jamais une baisse) ; improbable et
// bénin, mais dit. Couvre :
//   1. start() écrit le helper + le lance (READY) — protocole JSON (M1 croisé conv 57) ;
//   2. duck() → le témoin est BAISSÉ (×factor mesuré au GETV par une instance de VÉRIF indépendante du
//      même helper — le protocole est la surface de test) + write-ahead (duck-restore.json AVANT la baisse) ;
//   3. re-scan : un 2e témoin lancé EN PLEIN duck est baissé au vol + ajouté au fichier ;
//   4. restore() → volumes à l'IDENTIQUE + fichier effacé (réconcilié) ;
//   5. FILET BOOT : un duck-restore.json résiduel (crash simulé — volume baissé + fichier avec un PID MORT)
//      → un mixer frais restaure PAR NOM (la persistance per-app Windows, prouvée au banc conv 57) ;
//      + après stop(), duck() est refusé ;
//   6. EXPANSION D'ARBRE : exclure un PID exclut ses ENFANTS (le bug « ça baisse Sophia aussi » — venv launcher) ;
//   7. M1 : un nom d'exe à ESPACES traverse tout le protocole (l'ancien protocole positionnel cassait le
//      RESTORE entier — copie réelle de powershell.exe en « sophia test player.exe ») ;
//   8. M2/M3 : app FERMÉE pendant le duck → la dette SURVIT dans le write-ahead ; la session RELANCÉE est
//      ADOPTÉE avec l'origine DU FICHIER (jamais un double-duck ni un « restauré » sur parole).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { WindowsMixer } = require(path.join(root, "dist/src/orchestrator/voice/duck-mixer.js"));

const results = [];
const check = (n, c) => results.push([n, !!c]);
const logs = [];
const onLog = (l) => logs.push(l);

// ── outillage ──────────────────────────────────────────────────────────────────
const home = fs.mkdtempSync(path.join(os.tmpdir(), "sophia-e2e-v12-"));
const wav = path.join(home, "silence.wav");
{
  // WAV : 2 s de silence 16 kHz mono 16-bit (le témoin le joue en boucle → session active, inaudible).
  const sr = 16000, n = sr * 2, dataLen = n * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataLen, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(dataLen, 40);
  fs.writeFileSync(wav, b);
}

const PLAY_CMD = `(New-Object Media.SoundPlayer '${wav}').PlayLooping(); Start-Sleep 300`;
function startWitness(exe = "powershell") {
  return spawn(exe, ["-NoProfile", "-WindowStyle", "Hidden", "-Command", PLAY_CMD], { windowsHide: true });
}

/** Instance de VÉRIF indépendante du MÊME helper (home/duck-helper.ps1) — protocole JSON ligne/ligne. */
class Verif {
  constructor(script) {
    this.buf = "";
    this.waiters = [];
    this.proc = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
    this.proc.stdout.on("data", (d) => {
      this.buf += String(d);
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        const w = this.waiters.shift();
        if (w) w(line);
      }
    });
  }
  readLine(ms = 20000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout vérif")), ms);
      this.waiters.push((l) => { clearTimeout(t); resolve(l); });
    });
  }
  async cmd(obj) { this.proc.stdin.write(JSON.stringify(obj) + "\n"); return JSON.parse(await this.readLine()); }
  async vol(pid) { const r = await this.cmd({ op: "getv", pid }); return typeof r.vol === "number" ? r.vol : -1; }
  async kill() { try { await this.cmd({ op: "quit" }); } catch { /* */ } try { this.proc.kill(); } catch { /* */ } }
}

/** Poll une condition jusqu'à `ms` (le mixer est fire-and-forget → on observe le RÉSULTAT, pas des sleeps fixes). */
async function until(fn, ms = 8000, step = 150) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(step);
  }
  return fn();
}

const near = (a, b, eps = 0.012) => Math.abs(a - b) <= eps;
const restoreFile = path.join(home, "duck-restore.json");
const readEntries = () => {
  try { return JSON.parse(fs.readFileSync(restoreFile, "utf8")).entries ?? []; } catch { return null; }
};

// ── scénario ───────────────────────────────────────────────────────────────────
const targets = []; // PIDs témoins — la cible DYNAMIQUE du hook onlyPids
const w1 = startWitness();
targets.push(w1.pid);
let w2 = null;
let wS = null;   // témoin au nom à ESPACES+ACCENT (bloc 7-8)
let wS2 = null;
let verif = null;
let mixer2 = null; // remontés au scope du finally (MINEUR harnais re-croisé : restaurer AVANT de détruire)
let mixer3 = null;

const mixer = new WindowsMixer({
  home,
  onlyPids: () => targets,           // hook de TEST : ne toucher QUE les témoins
  duckFactor: 0.2,
  rampMs: 100,
  rescanMs: 500,
  onLog,
});

try {
  // 1 — start : écrit le helper + filet boot (aucun fichier résiduel ici)
  mixer.start();
  check("1: helper écrit dans le home", await until(() => fs.existsSync(path.join(home, "duck-helper.ps1")), 10000));
  verif = new Verif(path.join(home, "duck-helper.ps1"));
  check("1: instance de vérif READY (le .ps1 écrit est un helper valide)", (await verif.readLine()) === "READY");
  check("1: ping JSON → pong", (await verif.cmd({ op: "ping" })).pong === true);

  // témoin 1 visible
  check("t: session du témoin 1 apparue", await until(async () => (await verif.vol(w1.pid)) >= 0, 10000));
  const orig1 = await verif.vol(w1.pid);

  // 2 — duck : baissé ×0.2 + write-ahead
  mixer.duck();
  check("2: témoin 1 BAISSÉ à orig×0.2", await until(async () => near(await verif.vol(w1.pid), orig1 * 0.2)));
  check("2: write-ahead — duck-restore.json existe", fs.existsSync(restoreFile));
  {
    const e = (readEntries() ?? []).find((x) => x.pid === w1.pid);
    check("2: le fichier porte le volume D'ORIGINE du témoin", !!e && near(e.vol, orig1));
  }

  // 3 — re-scan : un 2e témoin lancé EN PLEIN duck est baissé au vol
  w2 = startWitness();
  targets.push(w2.pid);
  check("3: session du témoin 2 apparue", await until(async () => (await verif.vol(w2.pid)) >= 0, 10000));
  const orig2raw = await verif.vol(w2.pid);
  check("3: témoin 2 baissé AU VOL par le re-scan", await until(async () => near(await verif.vol(w2.pid), orig2raw * 0.2), 6000));
  check("3: le fichier s'est enrichi du témoin 2 (write-ahead au vol)", await until(() => (readEntries() ?? []).some((x) => x.pid === w2.pid), 4000));

  // 4 — restore : volumes à l'identique + fichier effacé (réconcilié)
  const saved2 = (readEntries() ?? []).find((x) => x.pid === w2.pid)?.vol;
  mixer.restore();
  check("4: témoin 1 RESTAURÉ à l'identique", await until(async () => near(await verif.vol(w1.pid), orig1)));
  check("4: témoin 2 RESTAURÉ à sa valeur snapée", saved2 != null && (await until(async () => near(await verif.vol(w2.pid), saved2))));
  check("4: duck-restore.json effacé après restauration réconciliée", await until(() => !fs.existsSync(restoreFile), 4000));

  // fin de vie du témoin 2 (le filet boot ci-dessous restaure PAR NOM → un seul « powershell » témoin doit vivre)
  try { w2.kill(); } catch { /* */ }
  await mixer.stop();

  // 5 — FILET BOOT (crash simulé) : volume baissé « par un Sophia mort » + fichier avec un PID MORT
  //     → un mixer FRAIS restaure PAR NOM (la persistance per-app rend ce chemin nécessaire, banc conv 57).
  //     + n9 : après stop(), duck() est refusé (le mixer arrêté ne touche plus rien).
  mixer.duck();
  await sleep(400);
  check("5: après stop, duck() est REFUSÉ (volume inchangé)", near(await verif.vol(w1.pid), orig1));
  await verif.cmd({ op: "setv", targets: [{ pid: w1.pid, vol: 0.15 }] });
  check("5: témoin 1 artificiellement laissé BAS (le crash)", await until(async () => near(await verif.vol(w1.pid), 0.15)));
  fs.writeFileSync(restoreFile, JSON.stringify({ ts: Date.now(), entries: [{ pid: 999999, name: "powershell", vol: orig1 }] }));
  mixer2 = new WindowsMixer({ home, onlyPids: () => targets, onLog });
  mixer2.start();
  check("5: FILET BOOT — restauré PAR NOM (pid mort → même exe)", await until(async () => near(await verif.vol(w1.pid), orig1), 15000));
  check("5: fichier résiduel effacé (dette réconciliée)", await until(() => !fs.existsSync(restoreFile), 4000));
  await mixer2.stop();

  // 6 — EXPANSION D'ARBRE (le bug « ça baisse Sophia aussi », mesuré au juge conv 57) : le python.exe d'un
  //     venv est un LAUNCHER — la session audio appartient à son ENFANT. Exclure un PID doit exclure son ARBRE.
  {
    const childPidFile = path.join(home, "child.pid");
    const childScript = path.join(home, "child.ps1");
    fs.writeFileSync(childScript, `Set-Content '${childPidFile}' $PID\n(New-Object Media.SoundPlayer '${wav}').PlayLooping()\nStart-Sleep 300\n`);
    const parent = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command",
      `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${childScript}' -WindowStyle Hidden; Start-Sleep 300`],
      { windowsHide: true });
    let childPid = 0;
    check("6: l'enfant a démarré (pidfile)", await until(() => {
      try { childPid = parseInt(fs.readFileSync(childPidFile, "utf8").trim(), 10); return Number.isFinite(childPid) && childPid > 0; }
      catch { return false; }
    }, 10000));
    check("6: session de l'ENFANT apparue", await until(async () => (await verif.vol(childPid)) >= 0, 10000));
    const snapAll = await verif.cmd({ op: "snap", ex: [], exNames: [], only: [] });
    check("6: contrôle — l'enfant est visible SANS exclusion", (snapAll.entries ?? []).some((e) => e.pid === childPid));
    const snapEx = await verif.cmd({ op: "snap", ex: [parent.pid], exNames: [], only: [] });
    check("6: exclure le PARENT exclut l'ENFANT (l'arbre — le fix du bug)", snapEx.ok === true && !(snapEx.entries ?? []).some((e) => e.pid === childPid));
    try { process.kill(childPid, "SIGKILL"); } catch { /* */ }
    try { parent.kill(); } catch { /* */ }
  }

  // 7 — M1 + encodage (re-croisé) : un nom d'exe à ESPACES **et à ACCENT** traverse TOUT le protocole
  //     (l'ancien protocole positionnel levait au RESTORE ; le pipe OEM mangeait les non-ASCII → le restore
  //     par nom ne matchait jamais). Copie réelle de powershell.exe → nom de process réel à espaces+accent.
  const spacedExe = path.join(home, "sophia tést player.exe");
  fs.copyFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), spacedExe);
  const spacedTargets = [];
  wS = startWitness(spacedExe);
  spacedTargets.push(wS.pid);
  check("7: session du témoin à ESPACES apparue", await until(async () => (await verif.vol(wS.pid)) >= 0, 15000));
  const snapS = await verif.cmd({ op: "snap", ex: [], exNames: [], only: [wS.pid] });
  const entS = (snapS.entries ?? []).find((e) => e.pid === wS.pid);
  check("7: le nom à espaces traverse le SNAP intact", !!entS && /\s/.test(entS.name ?? ""));
  check("7: l'ACCENT traverse le pipe intact (encodage UTF-8, re-croisé)", !!entS && (entS.name ?? "").includes("tést"));
  const origS = await verif.vol(wS.pid);
  mixer3 = new WindowsMixer({ home, onlyPids: () => spacedTargets, duckFactor: 0.2, rampMs: 50, onLog });
  mixer3.start();
  mixer3.duck();
  check("7: témoin à espaces BAISSÉ", await until(async () => near(await verif.vol(wS.pid), origS * 0.2)));
  mixer3.restore();
  check("7: témoin à espaces RESTAURÉ (M1 : le protocole JSON tient)", await until(async () => near(await verif.vol(wS.pid), origS)));

  // 8 — M2/M3 : app FERMÉE pendant le duck → la dette SURVIT ; la session RELANCÉE est ADOPTÉE (origine du fichier)
  mixer3.duck();
  check("8: re-baissé", await until(async () => near(await verif.vol(wS.pid), origS * 0.2)));
  try { wS.kill(); } catch { /* */ }
  check("8: l'app fermée — sa session a disparu", await until(async () => (await verif.vol(wS.pid)) < 0, 10000));
  mixer3.restore();
  check("8: la DETTE survit dans le write-ahead (jamais effacé sur parole)", await until(() => {
    const es = readEntries();
    return es != null && es.some((e) => e.name === "sophia tést player" && near(e.vol, origS));
  }, 6000));
  // l'app relancée (même exe) : Windows lui ressert le volume PERSISTÉ-baissé → l'adoption doit reprendre l'ORIGINE
  wS2 = startWitness(spacedExe);
  spacedTargets.push(wS2.pid);
  check("8: session relancée apparue", await until(async () => (await verif.vol(wS2.pid)) >= 0, 15000));
  const servedVol = await verif.vol(wS2.pid);
  check("8: Windows a resservi le volume BAISSÉ à la session relancée (la persistance per-app, banc conv 57)", near(servedVol, origS * 0.2));
  mixer3.duck();
  check("8: ADOPTION — le write-ahead porte l'ORIGINE VRAIE (pas le volume persisté-baissé)", await until(() => {
    const es = readEntries();
    return es != null && es.some((e) => e.pid === wS2.pid && near(e.vol, origS));
  }, 6000));
  mixer3.restore();
  check("8: la session relancée est RÉPARÉE à l'origine vraie (M3 bout-en-bout)", await until(async () => near(await verif.vol(wS2.pid), origS), 8000));
  check("8: dette réconciliée → fichier effacé", await until(() => !fs.existsSync(restoreFile), 4000));
  await mixer3.stop();
} finally {
  // MINEUR harnais (re-croisé conv 57) : RESTAURER D'ABORD (mixers stop → dettes réglées pendant que les
  // témoins VIVENT), tuer/effacer ENSUITE — un crash au milieu du test ne laisse plus le per-app
  // powershell.exe de la machine baissé avec son write-ahead détruit.
  for (const m of [mixer, mixer2, mixer3]) { try { if (m) await m.stop(); } catch { /* */ } }
  try { await verif?.kill(); } catch { /* */ }
  try { w1.kill(); } catch { /* */ }
  try { w2?.kill(); } catch { /* */ }
  try { wS?.kill(); } catch { /* */ }
  try { wS2?.kill(); } catch { /* */ }
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* */ }
}

// ── récapitulatif ──
let ok = 0;
for (const [n, c] of results) { console.log(`${c ? "ok  " : "FAIL"} ${n}`); if (ok += c ? 1 : 0, !c) { /* */ } }
if (ok !== results.length) { console.log("\n--- logs mixer ---"); for (const l of logs) console.log(l); }
console.log(`\ne2e-v12 : ${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
