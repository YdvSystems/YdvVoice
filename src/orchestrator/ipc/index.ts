// Client IPC de l'orchestrateur (socle T2).
//
// Le sidecar HEBERGE le serveur ; l'orchestrateur (ici) est le CLIENT. On utilise le WebSocket
// INTEGRE de Node 24 (aucune dependance). Enveloppe {type, id, ts, payload} ; familles cmd.*/evt.*.
// Correlation par id (requete/reponse) + evenements non sollicites (evt.*). L'audio ne traverse
// JAMAIS ce canal (JSON de controle uniquement).

export interface Envelope {
  type: string;
  id: string | number;
  ts: number;
  payload: Record<string, unknown>;
}

type EvtHandler = (env: Envelope) => void;

interface Pending {
  resolve: (e: Envelope) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface IpcClientOptions {
  requestTimeoutMs?: number;
}

export class IpcClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<string, Set<EvtHandler>>();
  private readonly requestTimeoutMs: number;

  constructor(opts: IpcClientOptions = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 3000;
  }

  /** Ouvre le canal vers le sidecar (localhost). Resout a l'ouverture. */
  connect(port: number, host = "127.0.0.1"): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}:${port}/ws`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("connexion IPC echouee"));
      ws.onmessage = (ev) => this.onMessage(String(ev.data));
      ws.onclose = () => this.onClose();
    });
  }

  private onMessage(data: string): void {
    let env: Envelope;
    try {
      env = JSON.parse(data) as Envelope;
    } catch {
      return;
    }
    const waiter = this.pending.get(String(env.id));
    if (waiter) {
      clearTimeout(waiter.timer);
      this.pending.delete(String(env.id));
      // m3 : une réponse evt.error CORRÉLÉE rejette la requête (jamais résolue comme un succès —
      // l'appelant d'un `await request(...)` verrait sinon une erreur comme un ack).
      if (env.type === "evt.error") {
        const reason = typeof env.payload?.reason === "string" ? env.payload.reason : "erreur sidecar";
        waiter.reject(new Error(`evt.error: ${reason}`));
      } else {
        waiter.resolve(env);
      }
      return;
    }
    // Evenement non sollicite : diffuse aux abonnes de ce type.
    const set = this.listeners.get(env.type);
    if (set) for (const h of set) h(env);
  }

  private onClose(): void {
    for (const [, w] of this.pending) {
      clearTimeout(w.timer);
      w.reject(new Error("canal ferme"));
    }
    this.pending.clear();
  }

  /** Envoie un cmd.* et resout avec l'evt.* correle par id (rejette au timeout). */
  request(type: string, payload: Record<string, unknown> = {}): Promise<Envelope> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("canal non ouvert"));
    }
    const id = `c${++this.seq}`;
    const env: Envelope = { type, id, ts: Math.round(performance.now() * 1000) / 1000, payload };
    return new Promise<Envelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout ${type}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(env));
    });
  }

  /** Abonne un handler a un type d'evt.* non sollicite (evt.health, evt.wake, ...). */
  on(evtType: string, handler: EvtHandler): void {
    let set = this.listeners.get(evtType);
    if (!set) {
      set = new Set();
      this.listeners.set(evtType, set);
    }
    set.add(handler);
  }

  /** Ferme le canal PROPREMENT (close frame → le sidecar lit un départ VOLONTAIRE, jamais une panne —
   *  V13 ROB-M4 : seul un crash SANS close frame [close_code 1006] ouvre un épisode de phrase de secours).
   *  `code` optionnel (3000-4999 = applicatif) : les TESTS s'en servent pour SIMULER une coupure anormale
   *  (un code ≠ 1000/1005 est traité « jouable » par le sidecar) — jamais utilisé en prod. */
  close(code?: number): void {
    this.ws?.close(code);
  }
}
