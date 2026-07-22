# -*- coding: utf-8 -*-
"""Outil A/B de prononciation (dev, PERMANENT) — Sophia parle dans SA voix (Piper A20, length_scale produit),
pour que Yohann tranche à l'oreille. HORS produit : n'entre jamais dans le pipeline (parité `npm run juge`).

Deux usages :
  • DIAGNOSTIC (défaut, sans argument) : rend une liste de mots/phrases TELLE QUELLE (le `for_synth` ACTUEL)
    → Yohann écoute et marque ce qui écorche, et comment. « Mesurer avant de coder ».
  • A/B (avec un spec JSON) : `[{"label": "...", "clips": [{"tag": "avant", "text": "..."},
    {"tag": "après", "text": "Voici [[tʃalɛnˈʒœʁ]]."}]}]` → avant/après pour choisir un fix.

Lancer :  npm run ab            (diagnostic de la liste par défaut)
          npm run ab spec.json  (A/B depuis un spec)
Sortie : des WAV + une page HTML A/B, ouverte dans le navigateur. CPU only, voix produit inchangée.
"""
from __future__ import annotations

import html
import json
import os
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

# Le VRAI code produit : le moteur A20 + le pipeline texte (for_synth appliqué DANS engine.synth).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # sidecar/ importable → tts.*
from tts.engine import PiperEngine, voice_model_path            # noqa: E402
from tts.text import for_synth                                   # noqa: E402

# Console Windows en cp1252 : les logs contiennent des flèches « → » et de l'IPA → forcer l'UTF-8 en
# sortie, sinon le print final plante (après avoir écrit la page) et le navigateur ne s'ouvre pas.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


# ─────────────────────────────────────────────────────────────────────────────
#  Liste DIAGNOSTIC par défaut — la liste de tics de Yohann (conv 53), en contexte naturel.
#  (label affiché, texte synthétisé). Homographes = avec le contexte qui désambiguïse.
# ─────────────────────────────────────────────────────────────────────────────
DIAGNOSTIC: list[tuple[str, list[tuple[str, str]]]] = [
    ("Homographes — le contexte décide", [
        ("j'en veux plus  (= davantage → le S s'entend)", "J'en veux plus."),
        ("je n'en veux plus  (= négation → S muet)",       "Je n'en veux plus."),
        ("à plus tard  (S muet)",                          "À plus tard."),
        ("cosmos  (S final entendu)",                      "Le cosmos est immense."),
        ("en fait  (T entendu)",                           "En fait, tu as raison."),
        ("tu as  (liaison)",                               "Tu as tout compris."),
    ]),
    ("Nombres / ordinaux", [
        ("19e siècle",   "Nous parlons du 19e siècle."),
        ("19ème siècle", "Nous parlons du 19ème siècle."),
        ("treize",       "Il en reste treize."),
    ]),
    ("Mots courants — noms & adjectifs", [
        ("adulte",        "Voici un adulte."),
        ("philosophe",    "Voici un philosophe."),
        ("philosophie",   "Voici la philosophie."),
        ("groupe",        "Voici un groupe."),
        ("sac à dos",     "Voici un sac à dos."),
        ("chose",         "Voici une chose."),
        ("bien",          "C'est très bien."),
        ("cathartique",   "C'est cathartique."),
        ("épisode",       "Voici un épisode."),
        ("millénaire",    "Voici un millénaire."),
        ("absolument",    "Absolument."),
        ("protocole",     "Voici le protocole."),
        ("époque",        "Voici une époque."),
        ("présocratique", "Un penseur présocratique."),
        ("justement",     "Justement."),
        ("hauteur",       "Quelle hauteur."),
        ("glouton",       "Quel glouton."),
        ("souveraineté",  "La souveraineté."),
        ("stoïcien",      "Un stoïcien."),
        ("ennemi",        "Voici un ennemi."),
        ("rare",          "C'est très rare."),
    ]),
    ("Mots courants — verbes & tournures", [
        ("ressent",                        "Il ressent quelque chose."),
        ("pose (je te pose une question)", "Je te pose une question."),
        ("réalise",                        "Il réalise son rêve."),
    ]),
    ("Noms propres / anglais (→ dico)", [
        ("Challenger",    "Voici le professeur Challenger."),
        ("Jesse Pinkman", "Voici Jesse Pinkman."),
        ("The Wire",      "J'ai regardé The Wire."),
        ("Kevin Bacon",   "Voici Kevin Bacon."),
        ("Footloose",     "Le film Footloose."),
        ("Thriller",      "Le clip Thriller."),
        ("David Fincher", "Un film de David Fincher."),
        ("Seven",         "Le film Seven."),
        ("Napoléon",      "Voici Napoléon."),
    ]),
]


def _save_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    a = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm = (a * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm.tobytes())


def _spec_from_diagnostic() -> list[dict]:
    """La liste diagnostic → un spec uniforme (1 clip « actuel » par item, groupé par catégorie)."""
    groups = []
    for cat, items in DIAGNOSTIC:
        groups.append({
            "category": cat,
            "items": [{"label": lab, "clips": [{"tag": "non corrigé", "text": txt}]} for lab, txt in items],
        })
    return groups


def _spec_from_json(path: Path) -> list[dict]:
    """Spec A/B : liste de groupes {category?, items:[{label, clips:[{tag, text}]}]}, ou liste d'items à plat."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list) and data and isinstance(data[0], dict) and "items" in data[0]:
        return data
    return [{"category": "A/B", "items": data}]


def main() -> int:
    if not voice_model_path().exists():
        print(f"[ab] voix A20 absente : {voice_model_path()} — impossible de synthétiser.", flush=True)
        return 2

    mode_json = len(sys.argv) > 1
    groups = _spec_from_json(Path(sys.argv[1])) if mode_json else _spec_from_diagnostic()

    out = Path(tempfile.gettempdir()) / "sophia_ab"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.wav"):
        old.unlink()

    print("[ab] chargement de la voix A20…", flush=True)
    eng = PiperEngine()
    eng.warm()
    sr = eng.sample_rate
    print(f"[ab] prêt (SR={sr}, length_scale produit). Synthèse…", flush=True)

    rows, n, item_no = [], 0, 0
    t0 = time.perf_counter()
    for gi, g in enumerate(groups):
        rows.append(f'<h2>{html.escape(g.get("category", ""))}</h2>')
        for it in g["items"]:
            item_no += 1
            rows.append(f'<div class="item" id="n{item_no}">'
                        f'<div class="lab"><span class="num">{item_no}</span> {html.escape(it["label"])}</div>')
            for clip in it["clips"]:
                text = clip["text"]
                wav = out / f"clip_{n:03d}.wav"
                _save_wav(wav, eng.synth(text), sr)
                phon = for_synth(text)
                note = "" if phon == text else f'<span class="phon">→ {html.escape(phon)}</span>'
                rows.append(
                    f'<div class="clip"><span class="tag">{html.escape(clip["tag"])}</span>'
                    f'<audio controls preload="none" src="{wav.name}"></audio>'
                    f'<span class="txt">{html.escape(text)}</span>{note}</div>'
                )
                n += 1
            rows.append("</div>")
    dur = time.perf_counter() - t0

    page = f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Sophia — A/B prononciation</title><style>
 body{{font-family:system-ui,Segoe UI,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#1a1a1a}}
 h1{{font-size:20px}} h2{{margin:22px 0 6px;font-size:15px;color:#444;border-bottom:1px solid #ddd;padding-bottom:4px}}
 .item{{margin:10px 0;padding:8px 10px;background:#fafafa;border-radius:8px}}
 .lab{{font-weight:600;margin-bottom:4px}}
 .num{{display:inline-block;background:#1a6;color:#fff;font-weight:700;border-radius:5px;
       padding:1px 8px;margin-right:6px;min-width:20px;text-align:center}}
 .clip{{display:flex;align-items:center;gap:10px;margin:3px 0;flex-wrap:wrap}}
 .tag{{font-size:11px;color:#fff;background:#666;border-radius:4px;padding:1px 6px;min-width:78px;text-align:center}}
 audio{{height:30px}} .txt{{color:#333}} .phon{{color:#a05000;font-family:Consolas,monospace;font-size:13px}}
</style></head><body>
<h1>Sophia — diagnostic de prononciation ({n} clips, {dur:.1f}s)</h1>
<p>Chaque mot est <b>numéroté</b> et rendu <b>non corrigé</b> (comme Sophia le dit aujourd'hui). Dis-moi
simplement : « <b>numéro N</b> » + ce qui écorche et le son attendu. « → » = ce que le pipeline a déjà fait
du texte (chiffres/noms transformés).</p>
{''.join(rows)}
</body></html>"""
    html_path = out / "ab.html"
    html_path.write_text(page, encoding="utf-8")
    print(f"[ab] FINI — {n} clips en {dur:.1f}s → {html_path}", flush=True)
    try:
        os.startfile(str(html_path))   # ouvre dans le navigateur (Windows)
    except Exception:
        print(f"[ab] ouvre manuellement : {html_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
