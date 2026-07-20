"""Sophia — sidecar / residence des modeles cote voix (plan 01, V11 · 01-E, S7).

Les OUTILS de la residence, cote sidecar : la POLITIQUE (recue par cmd.model.policy), la mesure VRAM
(pour la remontee evt.model.loaded), et le repli CPU (« allocation refusee -> degrade et rapporte, jamais
de crash silencieux », technique/01 §4.5 · technique/05 §2.3).

ECART DE CONCEPTION (tracé §7) : 01-E imagine une residence ALTERNEE (VEILLE a GPU vide, Whisper<->Kokoro
sur le GPU, prewarm Whisper au wake). Dans le produit c'est SANS OBJET :
  - le reveil EST le STT (le wake-model a ete ecarte conv 27 -> faster-whisper + portier entendent « Sophia »)
    -> le STT est resident/actif sur le GPU MEME en VEILLE, jamais dechargeable sans devenir sourde ;
  - la voix est Piper A20 sur CPU (conv 33-34/47) -> pas d'alternance GPU ecouter/parler ;
  - le seul modele GPU de toute la voix = le STT.
Donc le set GPU est de fait INVARIANT aujourd'hui. V11 pose le CONTRAT (politique enregistree + remontee VRAM)
et le REFLEXE reactif (repli CPU sur refus) ; les dynamiques PROACTIVES (swap JEU->CPU, eviction SECOURS) et
leur declencheur (les calques poses par doc 05, le cerveau de secours Phi-4-mini) arrivent avec doc 05 —
« l'orchestrateur recoit ici [05] la politique de reponse » (l'echelle menage->cran->CPU->constat).

Module IMPORT-LEGER : stdlib seul au niveau module ; torch est importe PARESSEUSEMENT (dans vram_snapshot).
"""
from __future__ import annotations

from typing import Callable

VOICE_GROUPS = ("veille", "conversation")


def parse_policy(payload: dict) -> dict:
    """Normalise un payload `cmd.model.policy` -> `{group, layers:{secours, jeu}}`. Robuste : un `group`
    absent/invalide retombe sur « conversation » (le set COMPLET = defaut sur : jamais sous-provisionner par
    accident) ; des `layers` absents = False. Les trois axes de la politique (S7) : (1) le groupe voix, (2) les
    calques du gouverneur, (3) les autorisations transitoires (`cmd.tts.cache` = V13, hors de cette politique)."""
    if not isinstance(payload, dict):
        payload = {}
    group = payload.get("group")
    if group not in VOICE_GROUPS:
        group = "conversation"
    layers = payload.get("layers")
    if not isinstance(layers, dict):
        layers = {}
    return {
        "group": group,
        "layers": {
            "secours": bool(layers.get("secours", False)),
            "jeu": bool(layers.get("jeu", False)),
        },
    }


def resolve_stt_device(policy: dict) -> str:
    """Le device CIBLE du STT selon la politique : CPU en JEU (le GPU va au jeu, technique/05 §2.2), sinon CUDA.
    NB V11 : le STT charge au boot du worker (AVANT toute politique) -> device par defaut cuda ; ce mapping
    documente l'INTENTION et alimente /debug (target_stt_device). L'EXECUTION du swap (recharger le modele sur
    l'autre device, fenetre sourde) = doc 05 (l'echelle de reponse). Le repli REACTIF (refus VRAM -> CPU) du
    chargement, lui, est deja en place (load_with_fallback) et couvre le cas « GPU sature au load »."""
    return "cpu" if policy.get("layers", {}).get("jeu") else "cuda"


def vram_snapshot(device_index: int = 0) -> int | None:
    """VRAM UTILISEE (Mo) sur le GPU `device_index`, ou None si pas de CUDA (ou torch/driver indisponible).
    `torch.cuda.mem_get_info` -> (free, total) en octets ; used = total - free. C'est une figure DEVICE-WIDE
    (le driver, pas l'allocateur torch) -> elle REFLETE l'allocation de CTranslate2 (qui alloue hors de
    l'allocateur torch). Un delta avant/apres chargement approxime l'empreinte du modele (§7 : approximatif, pas
    une attribution fine par tenseur). Ne LEVE jamais (sonde d'observabilite, best-effort)."""
    try:
        import torch
        if not torch.cuda.is_available():
            return None
        free, total = torch.cuda.mem_get_info(device_index)
        return round((total - free) / (1024 * 1024))
    except Exception:
        return None


def load_with_fallback(loader: Callable[[str], object], requested_device: str = "cuda"):
    """Charge un modele avec REPLI CPU (le durcissement V11 : « allocation VRAM refusee -> degrade et rapporte,
    jamais de crash »). `loader(device) -> objet` (leve si l'allocation echoue). Retourne `(objet, device_obtenu,
    degraded)` ; sur echec CUDA -> retente « cpu » (plancher prouve viable, banc conv 25) ; `degraded` = True si
    on a du replier. Si le device demande n'est PAS cuda, ou si le repli CPU echoue AUSSI, l'exception remonte ->
    l'appelant degrade honnetement (worker STT : compte l'erreur + emet evt.model.unloaded, jamais un crash muet)."""
    try:
        return loader(requested_device), requested_device, False
    except Exception as gpu_err:
        if requested_device != "cuda":
            raise
        try:
            return loader("cpu"), "cpu", True
        except Exception:
            raise gpu_err   # les deux ont echoue (ex. modele absent) -> re-leve l'echec CUDA d'origine
