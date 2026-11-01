import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { serverMessageSchema, type ClientMessage, type ServerMessage } from "../../../src/shared/protocol";
import { quizDemo, type QuizDefinition } from "../../../src/server/game/fixtures/quiz-demo";
import { signToken } from "../../../src/server/game/tokens";

const ORIGIN = "https://exemple.test";
const secret = () => env.PLAYER_TOKEN_SECRET as string;

let counter = 0;
export const newCode = () => `G${String(++counter).padStart(5, "0")}`;

export const stubFor = (code: string) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(code));

export class Client {
  readonly messages: ServerMessage[] = [];
  readonly raw: string[] = [];
  private listeners: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      this.raw.push(event.data);
      // Chaque message reçu doit respecter le schéma du protocole.
      this.messages.push(serverMessageSchema.parse(JSON.parse(event.data)));
      for (const listener of [...this.listeners]) listener();
    });
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    filter: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 4000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const find = () => this.messages.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && filter(m as never));
    const found = find();
    if (found) return found;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Délai dépassé en attendant "${type}"`)), timeoutMs);
      const listener = () => {
        const message = find();
        if (!message) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== listener);
        resolve(message);
      };
      this.listeners.push(listener);
    });
  }

  close(): void {
    try {
      this.ws.close(1000);
    } catch {
      // déjà fermé
    }
  }
}

export async function rawConnect(code: string, token: string | null): Promise<Response> {
  const query = token === null ? "" : `?token=${encodeURIComponent(token)}`;
  return exports.default.fetch(`${ORIGIN}/ws/${code}${query}`, { headers: { Upgrade: "websocket" } });
}

export async function connect(code: string, token: string): Promise<Client> {
  const response = await rawConnect(code, token);
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  ws.accept();
  return new Client(ws);
}

export const hostToken = (code: string) => signToken(secret(), { code, role: "host" });
export const signFor = (code: string, claims: Parameters<typeof signToken>[1], now?: number, ttl?: number) =>
  signToken(secret(), claims, now, ttl);

export async function join(code: string, pseudo: string): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}/api/parties/${code}/joueurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pseudo }),
  });
}

export interface Player {
  client: Client;
  playerId: string;
  token: string;
  pseudo: string;
}

export async function addPlayer(code: string, pseudo: string): Promise<Player> {
  const response = await join(code, pseudo);
  expect(response.status).toBe(201);
  const { playerId, token } = (await response.json()) as { playerId: string; token: string };
  const client = await connect(code, token);
  client.send({ type: "resume" });
  await client.waitFor("snapshot");
  return { client, playerId, token, pseudo };
}

export async function setup(playerCount: number, quiz?: QuizDefinition) {
  const code = newCode();
  if (quiz) await stubFor(code).init(code, quiz);
  const host = await connect(code, await hostToken(code));
  host.send({ type: "resume" });
  await host.waitFor("snapshot");
  const players: Player[] = [];
  for (let i = 0; i < playerCount; i += 1) players.push(await addPlayer(code, `Joueur ${i}`));
  return { code, host, players };
}

// Simule le temps écoulé en reculant l'horodatage de départ stocké : le DO juge le délai à partir de lui.
export async function rewindQuestion(code: string, ms: number): Promise<void> {
  await runInDurableObject(stubFor(code), (_instance, state) => {
    state.storage.sql.exec("UPDATE meta SET value = CAST(CAST(value AS INTEGER) - ? AS TEXT) WHERE key = 'started_at'", ms);
  });
}

export const demoQuiz = quizDemo;
export const withoutCorrection: QuizDefinition = { ...quizDemo, showCorrectAnswer: false };
