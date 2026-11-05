import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, vi } from "vitest";
import { WS_SUBPROTOCOL, serverMessageSchema, type ClientMessage, type ServerMessage } from "../../../src/shared/protocol";
import { getDb } from "../../../src/server/db/client";
import { gameSessions, user } from "../../../src/server/db/schema";
import { quizDemo } from "../../../src/server/game/fixtures/quiz-demo";
import type { QuizDefinition } from "../../../src/server/game/quiz";
import { signToken } from "../../../src/server/game/tokens";

const ORIGIN = "https://exemple.test";
const secret = () => env.PLAYER_TOKEN_SECRET as string;

let counter = 0;
export const newCode = () => `G${String(++counter).padStart(5, "0")}`;

const migrationFiles = import.meta.glob("../../../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const OWNER_ID = "proprietaire-test";
let prepared: Promise<void> | null = null;

// Applique les migrations D1 une fois par fichier de test et crée le compte animateur. Aucune table n'est vidée :
// chaque test utilise ses propres codes de partie.
export function prepareDb(): Promise<void> {
  prepared ??= (async () => {
    const statements = Object.keys(migrationFiles)
      .sort()
      .flatMap((file) => migrationFiles[file]!.split("--> statement-breakpoint"))
      .map((statement) => statement.trim())
      .filter(Boolean);
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
    await getDb(env.DB).insert(user).values({ id: OWNER_ID, name: "Animateur", email: "animateur@example.invalid" });
  })();
  return prepared;
}

// Une partie est identifiée par son sid ; le code court n'est que sa porte d'entrée.
const sids = new Map<string, string>();
export const sidFor = (code: string): string => {
  let sid = sids.get(code);
  if (!sid) {
    sid = crypto.randomUUID();
    sids.set(code, sid);
  }
  return sid;
};
// Nouvelle partie sous un code déjà utilisé : les jetons de l'ancienne partie doivent être refusés.
export const reuseCode = (code: string): string => {
  const sid = crypto.randomUUID();
  sids.set(code, sid);
  return sid;
};
export const stubFor = (code: string) => env.GAME_SESSION.get(env.GAME_SESSION.idFromName(sidFor(code)));

// Reproduit ce que fait partie.lancer : une ligne dans D1 (qui porte le code) puis l'initialisation du Durable Object.
export async function createGame(code: string, quiz: QuizDefinition = quizDemo, sid: string = sidFor(code)): Promise<string> {
  await prepareDb();
  await getDb(env.DB).insert(gameSessions).values({
    id: sid,
    code,
    ownerId: OWNER_ID,
    quizTitle: quiz.title,
    mode: quiz.mode ?? "together",
    showCorrectAnswer: quiz.showCorrectAnswer,
    shuffle: quiz.shuffle ?? false,
  });
  await env.GAME_SESSION.get(env.GAME_SESSION.idFromName(sid)).init(code, sid, quiz);
  return sid;
}

export async function sessionRow(sid: string) {
  await prepareDb();
  return (await env.DB.prepare("SELECT status, ended_at AS endedAt FROM game_sessions WHERE id = ?").bind(sid).first<{ status: string; endedAt: number | null }>()) ?? null;
}

// Envoie des rafales de `resume` jusqu'à la fermeture du socket. Les appelants figent l'horloge (freezeClock) : sans
// recharge, le seau se vide après au plus 30 messages quelle que soit la vitesse du serveur. Avec l'horloge réelle, un
// serveur ralenti par la charge traitait le flot au rythme même de la recharge et ne fermait jamais.
// On attend ensuite la fermeture elle-même, bornée par le délai du test, et non une fenêtre fixe qui expirait quand la
// machine était saturée. Le nombre de messages reste borné pour ne pas laisser partir un flot sans limite.
export const FLOOD_MAX_MESSAGES = 3_000;

export async function floodUntilClosed(client: Client, closed: Promise<CloseEvent>): Promise<CloseEvent> {
  let event: CloseEvent | null = null;
  void closed.then((e) => (event = e));
  let sent = 0;
  while (event === null && sent < FLOOD_MAX_MESSAGES) {
    try {
      for (let i = 0; i < 30; i += 1) client.send({ type: "resume" });
      sent += 30;
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return closed;
}

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
    timeoutMs = 15_000,
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

  // Attend que `count` messages de ce type soient arrivés : évite un délai fixe pour « laisser le temps ».
  async waitForCount(type: ServerMessage["type"], count: number, timeoutMs = 15_000): Promise<ServerMessage[]> {
    const matching = () => this.messages.filter((m) => m.type === type);
    if (matching().length >= count) return matching();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Délai dépassé en attendant ${count} "${type}"`)), timeoutMs);
      const listener = () => {
        if (matching().length < count) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== listener);
        resolve(matching());
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
  await prepareDb();
  const protocols = token ? `${WS_SUBPROTOCOL}, ${token}` : WS_SUBPROTOCOL;
  return exports.default.fetch(`${ORIGIN}/ws/${code}`, { headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": protocols } });
}

// Refus applicatif : le serveur accepte le socket puis le referme aussitôt avec un code 4xxx (ou 1008).
export async function closeCodeOf(code: string, token: string): Promise<number> {
  const response = await rawConnect(code, token);
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));
  ws.accept();
  return (await closed).code;
}

export async function connect(code: string, token: string): Promise<Client> {
  const response = await rawConnect(code, token);
  expect(response.status).toBe(101);
  expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(WS_SUBPROTOCOL);
  const ws = response.webSocket!;
  ws.accept();
  return new Client(ws);
}

type ClaimsInput = Omit<Parameters<typeof signToken>[1], "sid"> & { sid?: string };
export const hostToken = (code: string) => signToken(secret(), { code, sid: sidFor(code), role: "host" });
export const signFor = (_code: string, claims: ClaimsInput, now?: number, ttl?: number) =>
  signToken(secret(), { ...claims, sid: claims.sid ?? sidFor(claims.code) }, now, ttl);

export async function join(code: string, pseudo: string): Promise<Response> {
  await prepareDb();
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
  await createGame(code, quiz);
  const host = await connect(code, await hostToken(code));
  host.send({ type: "resume" });
  await host.waitFor("snapshot");
  const players: Player[] = [];
  for (let i = 0; i < playerCount; i += 1) players.push(await addPlayer(code, `Joueur ${i}`));
  return { code, host, players };
}

// Le Durable Object tourne dans le même isolat que les tests : remplacer Date.now fige aussi son horloge. Les délais,
// seaux à jetons et recharges ne dépendent alors plus de la durée réelle du test, donc plus de la charge de la machine.
// Les minuteurs restent réels : l'attente d'un message ne change pas. À annuler par restore() (ou vi.restoreAllMocks).
export function freezeClock(at: number = Date.now()) {
  let now = at;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    set: (value: number) => void (now = value),
    restore: () => spy.mockRestore(),
  };
}

// Simule le temps écoulé en reculant l'horodatage de départ stocké : le DO juge le délai à partir de lui.
export async function rewindQuestion(code: string, ms: number): Promise<void> {
  await runInDurableObject(stubFor(code), (_instance, state) => {
    state.storage.sql.exec("UPDATE meta SET value = CAST(CAST(value AS INTEGER) - ? AS TEXT) WHERE key = 'started_at'", ms);
  });
}

export const demoQuiz = quizDemo;
export const withoutCorrection: QuizDefinition = { ...quizDemo, showCorrectAnswer: false };

// Substitue le binding D1 d'une instance de DO par un proxy qui compte les requêtes et peut faire échouer les batchs.
export async function spyOnDatabase(code: string) {
  const trace = { batches: [] as number[], prepared: 0, failBatch: false };
  await runInDurableObject(stubFor(code), (instance) => {
    const proxy = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (query: string) => {
            trace.prepared += 1;
            return target.prepare(query);
          };
        }
        if (prop === "batch") {
          return (statements: D1PreparedStatement[]) => {
            trace.batches.push(statements.length);
            if (trace.failBatch) return Promise.reject(new Error("D1 indisponible"));
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const holder = instance as unknown as { env: Env };
    holder.env = Object.create(holder.env, { DB: { value: proxy } });
  });
  return trace;
}
