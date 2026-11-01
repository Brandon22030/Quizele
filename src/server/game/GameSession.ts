import { DurableObject } from "cloudflare:workers";
import {
  ANSWER_TOLERANCE_MS,
  MAX_PLAYERS,
  PLAYER_TOKEN_TTL_MS,
  clientMessageSchema,
  pseudoSchema,
  type Role,
  type QuestionPayload,
  type RankingEntry,
  type RevealPayload,
  type ServerMessage,
  type Snapshot,
} from "../../shared/protocol";
import { quizDemo, type QuizDefinition } from "./fixtures/quiz-demo";
import { isAnswerCorrect, rankEntries } from "./scoring";
import { GameStorage, type MetaState, type StoredQuestion } from "./storage";
import { verifyToken } from "./tokens";

interface SocketAttachment {
  role: Role;
  playerId?: string;
}

export type JoinResult =
  | { ok: true; playerId: string }
  | { ok: false; error: "invalid_pseudo" | "pseudo_taken" | "game_full" | "game_not_found" | "game_finished" };

const REVEAL_RANKING_SIZE = 10;

// Aucun état utile n'est gardé dans les champs de l'instance : le Durable Object peut hiberner
// entre deux messages, tout est relu du SQLite à chaque événement.
export class GameSession extends DurableObject<Env> {
  private readonly store: GameStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new GameStorage(ctx.storage.sql, ctx.storage);
    // La réponse automatique ne réveille pas l'objet : les pings des mobiles ne coûtent rien.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => this.store.migrate());
  }

  // Prototype : le quiz vient d'une fixture. QZ-002-07 passera le quiz lu dans D1.
  init(code: string, quiz: QuizDefinition = quizDemo): void {
    if (this.store.readMeta().code !== null) return;
    this.store.loadQuiz(code, quiz);
  }

  join(rawPseudo: string): JoinResult {
    const pseudo = pseudoSchema.safeParse(rawPseudo);
    if (!pseudo.success) return { ok: false, error: "invalid_pseudo" };
    const meta = this.store.readMeta();
    if (meta.code === null) return { ok: false, error: "game_not_found" };
    if (meta.phase === "finished") return { ok: false, error: "game_finished" };
    if (this.store.playerCount() >= MAX_PLAYERS) return { ok: false, error: "game_full" };
    const playerId = crypto.randomUUID();
    if (this.store.addPlayer(playerId, pseudo.data, Date.now()) === "taken") return { ok: false, error: "pseudo_taken" };
    this.broadcast(["host", "screen"], () => ({
      type: "player_joined",
      player: { id: playerId, pseudo: pseudo.data },
      count: this.store.playerCount(),
    }));
    return { ok: true, playerId };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Upgrade WebSocket requis", { status: 426 });
    const url = new URL(request.url);
    const code = url.pathname.split("/")[2]?.toUpperCase() ?? "";
    const token = url.searchParams.get("token") ?? "";
    const secret = this.env.PLAYER_TOKEN_SECRET;
    if (!secret) return new Response("Configuration manquante", { status: 500 });
    const claims = await verifyToken(secret, token, code);
    if (!claims) return new Response("Jeton invalide", { status: 401 });

    const meta = this.store.readMeta();
    if (meta.code === null) {
      // Seul un jeton hôte, que seul le serveur peut signer, crée la partie.
      if (claims.role !== "host") return new Response("Partie introuvable", { status: 404 });
      this.init(claims.code);
    } else if (meta.code !== claims.code) {
      return new Response("Jeton d'une autre partie", { status: 403 });
    }
    if (claims.role === "player" && (!claims.playerId || !this.store.player(claims.playerId))) {
      return new Response("Joueur inconnu", { status: 401 });
    }

    // Un joueur qui se reconnecte laisse parfois un socket zombie : on le remplace.
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (claims.playerId && attachment?.playerId === claims.playerId) socket.close(1000, "Remplacé par une nouvelle connexion");
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: claims.role, playerId: claims.playerId } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    let json: unknown;
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) return this.send(ws, { type: "error", code: "invalid_message" });
    const message = parsed.data;

    switch (message.type) {
      case "resume":
        return this.send(ws, this.buildSnapshot(attachment));
      case "answer":
        return this.handleAnswer(ws, attachment, message.questionId, message.optionIds);
      case "start":
      case "reveal":
      case "next":
        if (attachment.role !== "host") return this.send(ws, { type: "error", code: "forbidden" });
        return this.handleHostCommand(ws, message.type);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // Les codes 1005, 1006 et 1015 sont réservés : les renvoyer à close() lèverait une erreur.
    try {
      ws.close(code >= 1000 && code < 1005 ? code : 1000, "Fermeture");
    } catch {
      // Socket déjà fermé.
    }
  }

  webSocketError(ws: WebSocket): void {
    try {
      ws.close(1011, "Erreur");
    } catch {
      // Socket déjà fermé.
    }
  }

  async alarm(): Promise<void> {
    const meta = this.store.readMeta();
    const now = Date.now();
    if (meta.phase === "question") {
      const deadline = meta.startedAt + meta.durationMs + ANSWER_TOLERANCE_MS;
      if (now < deadline) return this.ctx.storage.setAlarm(deadline);
      await this.reveal(meta);
    } else if (meta.phase === "finished" && now >= meta.finishedAt + PLAYER_TOKEN_TTL_MS) {
      await this.store.purge();
    }
  }

  private async handleAnswer(ws: WebSocket, attachment: SocketAttachment, questionId: string, optionIds: string[]): Promise<void> {
    // Heure prise dès la réception : c'est le seul juge du délai.
    const receivedAt = Date.now();
    if (attachment.role !== "player" || !attachment.playerId) return this.send(ws, { type: "error", code: "forbidden" });
    const playerId = attachment.playerId;

    const existing = this.store.answerOf(playerId, questionId);
    if (existing) return this.send(ws, { type: "answer_ack", questionId, duplicate: true, late: existing.late });

    const meta = this.store.readMeta();
    if (meta.phase !== "question") return this.send(ws, { type: "error", code: "wrong_phase" });
    const question = this.store.questionAt(meta.index);
    if (!question || question.id !== questionId) return this.send(ws, { type: "error", code: "unknown_question" });

    const options = this.store.options(question.id);
    const known = new Set(options.map((option) => option.id));
    if (optionIds.some((id) => !known.has(id))) return this.send(ws, { type: "error", code: "invalid_options" });

    const elapsed = Math.max(0, receivedAt - meta.startedAt);
    const late = elapsed > meta.durationMs + ANSWER_TOLERANCE_MS;
    const correctIds = options.filter((option) => option.isCorrect).map((option) => option.id);
    const correct = !late && isAnswerCorrect(question.kind, optionIds, correctIds);
    const inserted = this.store.insertAnswer({
      playerId,
      questionId,
      optionIds,
      receivedAt,
      elapsedMs: Math.min(elapsed, meta.durationMs),
      correct,
      late,
    });
    this.send(ws, { type: "answer_ack", questionId, duplicate: !inserted, late });
    if (!inserted) return;

    const count = this.store.answeredCount(questionId);
    const total = this.store.playerCount();
    this.broadcast(["host", "screen"], () => ({ type: "answer_count", questionId, count, total }));
  }

  private async handleHostCommand(ws: WebSocket, command: "start" | "reveal" | "next"): Promise<void> {
    const meta = this.store.readMeta();
    const expected = command === "start" ? "lobby" : command === "reveal" ? "question" : "revealed";
    if (meta.phase !== expected) return this.send(ws, { type: "error", code: "wrong_phase" });

    if (command === "start") return this.startQuestion(0);
    if (command === "reveal") return this.reveal(meta);
    if (meta.index + 1 < this.store.questionCount()) return this.startQuestion(meta.index + 1);
    await this.finish();
  }

  private async startQuestion(index: number): Promise<void> {
    const question = this.store.questionAt(index);
    if (!question) return this.finish();
    const startedAt = Date.now();
    this.store.writeMeta({ phase: "question", idx: index, started_at: startedAt, duration_ms: question.durationMs });
    // Alarme plutôt que setTimeout : un minuteur en mémoire empêcherait l'hibernation et ne survivrait pas à l'éviction.
    await this.ctx.storage.setAlarm(startedAt + question.durationMs + ANSWER_TOLERANCE_MS);
    const payload = this.questionPayload(question, index, startedAt, question.durationMs);
    this.broadcast(["host", "screen", "player"], () => ({ type: "question", ...payload, serverNow: Date.now() }));
  }

  private async reveal(meta: MetaState): Promise<void> {
    const question = this.store.questionAt(meta.index);
    if (!question) return;
    this.store.writeMeta({ phase: "revealed" });
    await this.ctx.storage.deleteAlarm();
    const ranking = rankEntries(this.store.ranking());
    const correctPlayers = this.store.correctPlayerIds(question.id);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      this.send(ws, { type: "reveal", ...this.revealPayload(meta, question, attachment, ranking, correctPlayers) });
    }
  }

  private async finish(): Promise<void> {
    const now = Date.now();
    this.store.writeMeta({ phase: "finished", finished_at: now });
    await this.ctx.storage.setAlarm(now + PLAYER_TOKEN_TTL_MS);
    const ranking = rankEntries(this.store.ranking());
    this.broadcast(["host", "screen", "player"], () => ({ type: "finished", ranking }));
  }

  private questionPayload(question: StoredQuestion, index: number, startedAt: number, durationMs: number): QuestionPayload {
    return {
      index,
      total: this.store.questionCount(),
      questionId: question.id,
      kind: question.kind,
      prompt: question.prompt,
      options: this.store.options(question.id).map(({ id, label }) => ({ id, label })),
      startedAt,
      durationMs,
      serverNow: Date.now(),
    };
  }

  private revealPayload(
    meta: MetaState,
    question: StoredQuestion,
    attachment: SocketAttachment,
    ranking: RankingEntry[],
    correctPlayers: Set<string>,
  ): RevealPayload {
    const showCorrection = meta.showCorrectAnswer || attachment.role === "host";
    const payload: RevealPayload = { questionId: question.id, ranking: ranking.slice(0, REVEAL_RANKING_SIZE) };
    if (showCorrection) {
      payload.correctOptionIds = this.store.options(question.id).filter((o) => o.isCorrect).map((o) => o.id);
      if (question.explanation) payload.explanation = question.explanation;
      if (question.reference) payload.reference = question.reference;
    }
    if (attachment.role === "player" && attachment.playerId) {
      const position = ranking.findIndex((entry) => entry.playerId === attachment.playerId);
      payload.you = {
        wasCorrect: correctPlayers.has(attachment.playerId),
        score: ranking[position]?.score ?? 0,
        rank: position + 1,
      };
    }
    return payload;
  }

  private buildSnapshot(attachment: SocketAttachment): Snapshot {
    const meta = this.store.readMeta();
    const now = Date.now();
    const snapshot: Snapshot = {
      type: "snapshot",
      role: attachment.role,
      phase: meta.phase,
      serverNow: now,
      title: meta.title,
      playerCount: this.store.playerCount(),
    };
    const question = meta.phase === "question" || meta.phase === "revealed" ? this.store.questionAt(meta.index) : null;
    if (question) {
      snapshot.question = this.questionPayload(question, meta.index, meta.startedAt, meta.durationMs);
      if (meta.phase === "revealed") {
        const ranking = rankEntries(this.store.ranking());
        snapshot.reveal = this.revealPayload(meta, question, attachment, ranking, this.store.correctPlayerIds(question.id));
      } else if (attachment.role !== "player") {
        snapshot.answeredCount = this.store.answeredCount(question.id);
      }
    }
    if (meta.phase === "finished") snapshot.ranking = rankEntries(this.store.ranking());
    if (attachment.role !== "player") snapshot.players = this.store.players();

    if (attachment.role === "player" && attachment.playerId) {
      const player = this.store.player(attachment.playerId);
      if (player) {
        const answer = question ? this.store.answerOf(player.id, question.id) : null;
        const entry = this.store.ranking(meta.phase === "question" ? question?.id : "").find((row) => row.playerId === player.id);
        snapshot.me = {
          playerId: player.id,
          pseudo: player.pseudo,
          score: entry?.score ?? 0,
          answered: answer !== null,
          // Sa propre réponse, jamais la correction.
          ...(answer ? { answeredOptionIds: answer.optionIds } : {}),
        };
      }
    }
    return snapshot;
  }

  private broadcast(roles: Role[], build: () => ServerMessage): void {
    const message = JSON.stringify(build());
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment && roles.includes(attachment.role)) this.trySend(ws, message);
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    this.trySend(ws, JSON.stringify(message));
  }

  private trySend(ws: WebSocket, payload: string): void {
    try {
      ws.send(payload);
    } catch {
      // Socket en cours de fermeture : le joueur retrouvera l'état via resume.
    }
  }
}
