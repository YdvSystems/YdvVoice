// V13 — les PHRASES DE SECOURS (« jamais de silence », F7/S11 — technique/01 §4.7).
//
// Le CONTENU appartient à Yohann (c'est SA voix qui parle — domaine personnalité, placeholder 03 comme les
// phrases fixes du routeur) ; la STRUCTURE appartient au protocole : l'orchestrateur descend `[{name, text}]`
// via `cmd.tts.cache` (boot phase 5 + à chaque construction du pipeline), les OREILLES pré-synthétisent
// (Piper transitoire, B2 réinterprété — décision A conv 58) et gardent le cache RAM. En épisode de panne
// (orchestrateur parti), le sidecar joue la phrase `secours` — une fois, en entier, exempte de barge-in.
//
// Le texte par défaut = l'exemple MÊME du gravé §4.7. Une seule phrase suffit aujourd'hui ; la structure en
// accepte N (des messages différenciés par cause viendraient ici, jamais dans le sidecar). La prononciation
// passe par le lexique de la bouche (`for_synth`) → même voix, mêmes corrections qu'en parole normale.

export interface FallbackPhrase {
  name: string;
  text: string;
}

export const FALLBACK_PHRASES: FallbackPhrase[] = [
  { name: "secours", text: "Mon cerveau ne répond pas, je redémarre — un instant." },
];
