import ReconnectingWebSocket from "partysocket/ws";
import { localNow } from "../../shared/clock";
import { CLOSE_CODES, WS_SUBPROTOCOL, serverMessageSchema, type ClientMessage, type ServerMessage } from "../../shared/protocol";

// Statuts terminaux : le serveur a refermé avec un code applicatif, se reconnecter ne servirait à rien.
export type TerminalStatus = "kicked" | "ended" | "rejected";
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | TerminalStatus;

export function terminalStatusFor(code: number): TerminalStatus | null {
  if (code === CLOSE_CODES.kicked) return "kicked";
  if (code === CLOSE_CODES.gameGone) return "ended";
  // 4001, et 4002 réservé : tout autre refus applicatif vaut lien invalide.
  if (code >= 4001 && code <= 4004) return "rejected";
  return null;
}

export const isTerminalStatus = (status: ConnectionStatus): status is TerminalStatus =>
  status === "kicked" || status === "ended" || status === "rejected";

export interface GameSocketOptions {
  code: string;
  getToken: () => string | Promise<string>;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  // Base `ws://hote` ou `wss://hote` ; par défaut, l'origine de la page.
  baseUrl?: string;
  // Pour les tests : constructeur WebSocket de remplacement.
  WebSocket?: typeof WebSocket;
}

const PING_INTERVAL_MS = 20_000;
// Au-delà, la connexion est considérée comme zombie (réseau mobile coupé sans événement close).
const SILENCE_LIMIT_MS = 50_000;
// Un refus HTTP (jeton signé avec un secret qui a changé) n'arrive qu'en 1006 anonyme. Après autant d'échecs en
// ligne sans jamais avoir ouvert le socket (environ 12 s avec le délai croissant), on abandonne.
export const MAX_FAILED_ATTEMPTS = 8;

export class GameSocket {
  private readonly socket: ReconnectingWebSocket;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private lastActivity = localNow();
  private opened = false;
  private stopped = false;
  private failedAttempts = 0;

  constructor(private readonly options: GameSocketOptions) {
    const base = options.baseUrl ?? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
    // Le jeton voyage dans Sec-WebSocket-Protocol, pas dans l'URL (journaux, historique). Il est relu à chaque
    // tentative au cas où il aurait été renouvelé.
    this.socket = new ReconnectingWebSocket(
      `${base}/ws/${options.code}`,
      async () => [WS_SUBPROTOCOL, await options.getToken()],
      {
        maxEnqueuedMessages: 20,
        minReconnectionDelay: 500,
        maxReconnectionDelay: 8_000,
        shouldReconnectOnClose: (event) => terminalStatusFor(event.code) === null,
        WebSocket: options.WebSocket,
      },
    );
    this.socket.addEventListener("open", () => {
      this.opened = true;
      this.lastActivity = localNow();
      options.onStatus("open");
      this.send({ type: "resume" });
    });
    this.socket.addEventListener("close", (event) => {
      if (this.stopped) return;
      const terminal = terminalStatusFor(event.code);
      if (terminal) {
        this.close();
        options.onStatus(terminal);
        return;
      }
      // Hors ligne, l'échec ne dit rien du jeton : seul un échec avec réseau compte.
      if (!this.opened && globalThis.navigator?.onLine !== false && ++this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.close();
        options.onStatus("rejected");
        return;
      }
      options.onStatus(this.opened ? "reconnecting" : "connecting");
    });
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
    this.stopped = true;
    clearInterval(this.pingTimer);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.resync);
    this.socket.close();
  }

  private handleMessage(data: unknown): void {
    this.lastActivity = localNow();
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
    if (this.stopped) return;
    if (localNow() - this.lastActivity > SILENCE_LIMIT_MS) {
      this.socket.reconnect();
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send("ping");
  }

  private readonly resync = (): void => {
    if (this.stopped) return;
    if (this.socket.readyState === WebSocket.OPEN) this.send({ type: "resume" });
    else this.socket.reconnect();
  };

  // iOS et Android coupent les WebSocket en arrière-plan : au retour au premier plan on resynchronise.
  private readonly onVisible = (): void => {
    if (document.visibilityState === "visible") this.resync();
  };
}
