import ReconnectingWebSocket from "partysocket/ws";
import { serverMessageSchema, type ClientMessage, type ServerMessage } from "../../shared/protocol";

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

export interface GameSocketOptions {
  code: string;
  getToken: () => string | Promise<string>;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  // Base `ws://hote` ou `wss://hote` ; par défaut, l'origine de la page.
  baseUrl?: string;
}

const PING_INTERVAL_MS = 20_000;
// Au-delà, la connexion est considérée comme zombie (réseau mobile coupé sans événement close).
const SILENCE_LIMIT_MS = 50_000;

export class GameSocket {
  private readonly socket: ReconnectingWebSocket;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private lastActivity = Date.now();
  private opened = false;

  constructor(private readonly options: GameSocketOptions) {
    const base = options.baseUrl ?? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
    // L'URL est recalculée à chaque tentative : le jeton est relu au cas où il aurait été renouvelé.
    this.socket = new ReconnectingWebSocket(
      async () => `${base}/ws/${options.code}?token=${encodeURIComponent(await options.getToken())}`,
      undefined,
      { maxEnqueuedMessages: 20, minReconnectionDelay: 500, maxReconnectionDelay: 8_000 },
    );
    this.socket.addEventListener("open", () => {
      this.opened = true;
      this.lastActivity = Date.now();
      options.onStatus("open");
      this.send({ type: "resume" });
    });
    this.socket.addEventListener("close", () => options.onStatus(this.opened ? "reconnecting" : "connecting"));
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.resync);
    options.onStatus("connecting");
  }

  // Les messages envoyés hors connexion sont mis en file par partysocket ; les réponses sont idempotentes côté serveur.
  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    clearInterval(this.pingTimer);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.resync);
    this.socket.close();
  }

  private handleMessage(data: unknown): void {
    this.lastActivity = Date.now();
    if (typeof data !== "string" || data === "pong") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = serverMessageSchema.safeParse(json);
    if (parsed.success) this.options.onMessage(parsed.data);
  }

  private ping(): void {
    if (Date.now() - this.lastActivity > SILENCE_LIMIT_MS) {
      this.socket.reconnect();
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send("ping");
  }

  private readonly resync = (): void => {
    if (this.socket.readyState === WebSocket.OPEN) this.send({ type: "resume" });
    else this.socket.reconnect();
  };

  // iOS et Android coupent les WebSocket en arrière-plan : au retour au premier plan on resynchronise.
  private readonly onVisible = (): void => {
    if (document.visibilityState === "visible") this.resync();
  };
}
