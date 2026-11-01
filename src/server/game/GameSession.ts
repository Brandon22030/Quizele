import { DurableObject } from "cloudflare:workers";
import {
  ANSWER_TOLERANCE_MS,
  CLOSE_CODES,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  PLAYER_TOKEN_TTL_MS,
  WS_SUBPROTOCOL,
  clientMessageSchema,
  pseudoKey,
  pseudoSchema,
  type Phase,
  type QuestionPayload,
  type RevealPayload,
  type Role,
  type ServerMessage,
  type Snapshot,
} from "../../shared/protocol";
import { quizDemo, type QuizDefinition } from "./fixtures/quiz-demo";
import { isAnswerCorrect, rankEntries } from "./scoring";
import { closedSocket } from "./reject";
import { GameStorage, type MetaState, type StoredQuestion } from "./storage";
import { tokenFromRequest, verifyToken } from "./tokens";

interface SocketAttachment {
  role: Role;
  playerId?: string;
  // Seau à jetons du socket, qui survit à l'hibernation. Absent sur un attachement d'une version antérieure.
  tokens?: number;
  at?: number;
  // Socket zombie remplacé par une nouvelle connexion, dont le seau a déjà été repris.
  replaced?: boolean;
}

export type JoinResult =
  | { ok: true; playerId: string }
  | { ok: false; error: "invalid_pseudo" | "pseudo_taken" | "game_full" | "game_not_found" | "game_finished" };

const REVEAL_RANKING_SIZE = 10;
const BUCKET_CAPACITY = 30;
const BUCKET_REFILL_PER_MS = 10 / 1000;
// Une reconnexion n'est pas gratuite : sans ce coût, se reconnecter en boucle contournerait le seau.
const CONNECT_COST = 5;
// Au plus 10 connexions d'affilée par joueur (ou rôle), puis une toutes les 6 s : assez pour un réseau mobile
// instable avec le délai croissant du client, pas pour une boucle.
const CONNECT_BURST = 10;
const CONNECT_REFILL_PER_MS = 1 / 6000;
const ALIAS_CLAIM_GRACE_MS = 30_000;
const COUNT_INTERVAL_MS = 250;
const ALIAS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

const refill = (tokens: number, at: number, now: number, capacity: number, perMs: number) =>
  Math.min(capacity, tokens + Math.max(0, now - at) * perMs);
const bucketKey = (attachment: { role: Role; playerId?: string }) => (attachment.playerId ? `p:${attachment.playerId}` : attachment.role);

// L'état utile de la partie vit dans le SQLite : le Durable Object peut hiberner entre deux messages.
// Les seuls champs d'instance sont des optimisations dont la perte est sans conséquence (drapeau de schéma,
// regroupement du compteur de réponses, classement de la révélation en cache dans revealCache).
export class GameSession extends DurableObject<Env> {
  private readonly store: GameStorage;
  private schemaReady = false;
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCountAt = 0;
  // Classement de la révélation en cours, recalculé seulement s'il est perdu (hibernation) ou invalidé.
  private revealCache: { questionId: string; computed: ReturnType<GameSession["computeReveal"]> } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new GameStorage(ctx.storage.sql, ctx.storage);
    // La réponse automatique ne réveille pas l'objet : les pings des mobiles ne coûtent rien.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // Un objet encore vide n'écrit rien : le schéma n'est créé que par init(), donc par l'hôte.
    ctx.blockConcurrencyWhile(async () => {
      if (this.ready()) this.store.migrate();
    });
  }

  private ready(): boolean {
    if (!this.schemaReady) this.schemaReady = this.store.hasSchema();
    return this.schemaReady;
  }

  // Objet d'alias : traduit le code court en sid. Prototype sans D1, remplacé par D1 en QZ-002-07,
  // qui devra aussi vérifier l'existence de la partie dans D1 avant d'appeler un Durable Object.
  currentSid(): string | null {
    return this.store.aliasHolder()?.sid ?? null;
  }

  // Une réservation récente compte comme vivante : la partie de l'hôte qui vient de réserver n'est pas encore créée.
  recentlyClaimed(sid: string): boolean {
    const holder = this.store.aliasHolder();
    return holder !== null && holder.sid === sid && Date.now() - holder.claimedAt < ALIAS_CLAIM_GRACE_MS;
  }

  async registerSid(sid: string, expected: string | null): Promise<boolean> {
    if (!this.store.compareAndSetAlias(sid, expected, Date.now())) return false;
    await this.ctx.storage.setAlarm(Date.now() + ALIAS_TTL_MS);
    return true;
  }

  // null : partie jamais créée ou purgée.
  currentPhase(): Phase | null {
    return this.ready() ? this.store.readMeta().phase : null;
  }

  // Prototype : le quiz vient d'une fixture. QZ-002-07 passera le quiz lu dans D1.
  async init(code: string, sid: string, quiz: QuizDefinition = quizDemo): Promise<void> {
    if (this.ready()) return;
    this.store.migrate();
    this.schemaReady = true;
    this.store.loadQuiz(code, sid, quiz, Date.now());
    await this.scheduleAlarm();
  }

  join(rawPseudo: string): JoinResult {
    if (!this.ready()) return { ok: false, error: "game_not_found" };
    const pseudo = pseudoSchema.safeParse(rawPseudo);
    if (!pseudo.success) return { ok: false, error: "invalid_pseudo" };
    const meta = this.store.readMeta();
    if (meta.phase === "finished") return { ok: false, error: "game_finished" };
    if (this.store.playerCount() >= MAX_PLAYERS) return { ok: false, error: "game_full" };
    const playerId = crypto.randomUUID();
    // Un pseudo banni par exclusion répond comme un pseudo pris : on ne confirme pas l'exclusion à un tiers.
    if (this.store.addPlayer(playerId, pseudo.data, pseudoKey(pseudo.data), Date.now()) !== "ok") {
      return { ok: false, error: "pseudo_taken" };
    }
    this.revealCache = null;
    this.broadcast(["host", "screen"], () => ({
      type: "player_joined",
      player: { id: playerId, pseudo: pseudo.data },
      count: this.store.playerCount(),
    }));
    return { ok: true, playerId };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Upgrade WebSocket requis", { status: 426 });
    const code = new URL(request.url).pathname.split("/")[2]?.toUpperCase() ?? "";
    const secret = this.env.PLAYER_TOKEN_SECRET;
    if (!secret) return new Response("Configuration manquante", { status: 500 });
    const token = tokenFromRequest(request);

    let claims;
    if (!this.ready()) {
      claims = await verifyToken(secret, token, { code });
      if (!claims) return new Response("Jeton invalide", { status: 401 });
      // Seul un jeton hôte, que seul le serveur peut signer, crée la partie.
      if (claims.role !== "host") return closedSocket(CLOSE_CODES.gameGone, "Partie introuvable");
      await this.init(claims.code, claims.sid);
    } else {
      claims = await verifyToken(secret, token, { code });
      if (!claims) return new Response("Jeton invalide", { status: 401 });
      // Jeton authentique d'une autre partie sous le même code : refus applicatif, comme au routeur, pour que le
      // client ne se reconnecte pas en boucle sur un 1006.
      if (claims.sid !== this.store.readMeta().sid) {
        return claims.role === "host"
          ? closedSocket(CLOSE_CODES.tokenRejected, "Jeton d'une autre partie")
          : closedSocket(CLOSE_CODES.gameGone, "Partie terminée");
      }
    }
    if (claims.role === "player" && (!claims.playerId || !this.store.player(claims.playerId))) {
      if (claims.playerId && this.store.isBanned(claims.playerId)) return closedSocket(CLOSE_CODES.kicked, "Exclu de la partie");
      return closedSocket(CLOSE_CODES.tokenRejected, "Joueur inconnu");
    }

    const key = bucketKey(claims);
    const now = Date.now();
    const stored = this.store.bucket(key);
    const connectTokens = (stored ? refill(stored.connectTokens, stored.connectAt, now, CONNECT_BURST, CONNECT_REFILL_PER_MS) : CONNECT_BURST) - 1;
    // 1008 et non un code 4xxx : la limite se recharge (une connexion toutes les 6 s), le client doit donc
    // continuer à réessayer avec son délai croissant plutôt que d'abandonner définitivement.
    if (connectTokens < 0) return closedSocket(1008, "Trop de connexions");

    // Le seau repart de l'état le plus bas connu pour cette clé : sockets encore ouverts (zombie) ou état
    // conservé à la fermeture. Il ne part plein que pour une toute première connexion.
    const previous = this.ctx.getWebSockets(key);
    let tokens = stored ? refill(stored.tokens, stored.at, now, BUCKET_CAPACITY, BUCKET_REFILL_PER_MS) : BUCKET_CAPACITY;
    for (const socket of previous) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment) tokens = Math.min(tokens, this.bucketNow(attachment, now));
    }
    if (stored || previous.length > 0) tokens = Math.max(0, tokens - CONNECT_COST);
    this.store.saveBucket(key, { tokens, at: now, connectTokens, connectAt: now });

    // Un joueur qui se reconnecte laisse parfois un socket zombie : on le remplace.
    // Son seau est déjà compté ci-dessus : marqué remplacé, sa fermeture ne réécrit pas la ligne buckets.
    if (claims.playerId) {
      for (const socket of previous) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment) socket.serializeAttachment({ ...attachment, replaced: true } satisfies SocketAttachment);
        socket.close(1000, "Remplacé par une nouvelle connexion");
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Les étiquettes permettent de cibler un rôle ou un joueur sans désérialiser tous les sockets.
    this.ctx.acceptWebSocket(server, claims.playerId ? [claims.role, key] : [claims.role]);
    server.serializeAttachment({ role: claims.role, playerId: claims.playerId, tokens, at: now } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": WS_SUBPROTOCOL } });
  }

  private bucketNow(attachment: SocketAttachment, now: number): number {
    return refill(attachment.tokens ?? BUCKET_CAPACITY, attachment.at ?? now, now, BUCKET_CAPACITY, BUCKET_REFILL_PER_MS);
  }

  // Conserve le seau d'un socket qui se ferme, sans jamais le remonter au-dessus de l'état déjà conservé.
  // Le seau conservé et celui du socket se rechargent au même rythme : si le socket n'est pas plus bas, il n'a rien
  // consommé depuis la connexion et la ligne n'a pas à être réécrite.
  private persistBucket(attachment: SocketAttachment): void {
    if (attachment.replaced || !this.ready()) return;
    const key = bucketKey(attachment);
    const now = Date.now();
    const stored = this.store.bucket(key);
    if (!stored) return;
    const current = this.bucketNow(attachment, now);
    if (current >= refill(stored.tokens, stored.at, now, BUCKET_CAPACITY, BUCKET_REFILL_PER_MS)) return;
    this.store.saveBucket(key, { ...stored, tokens: Math.max(0, current), at: now });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    if (typeof raw !== "string") return ws.close(1009, "Messages texte uniquement");
    if (raw.length > MAX_MESSAGE_BYTES || (raw.length * 3 > MAX_MESSAGE_BYTES && encoder.encode(raw).length > MAX_MESSAGE_BYTES)) {
      return ws.close(1009, "Message trop volumineux");
    }
    const now = Date.now();
    const tokens = this.bucketNow(attachment, now) - 1;
    if (tokens < 0) {
      this.persistBucket({ ...attachment, tokens: 0, at: now });
      return ws.close(1008, "Trop de messages");
    }
    ws.serializeAttachment({ ...attachment, tokens, at: now } satisfies SocketAttachment);
    if (!this.ready()) return ws.close(CLOSE_CODES.gameGone, "Partie terminée");

    let json: unknown;
    try {
      json = JSON.parse(raw);
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
      case "kick":
        if (attachment.role !== "host") return this.send(ws, { type: "error", code: "forbidden" });
        return this.handleHostCommand(ws, message);
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment) this.persistBucket(attachment);
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
    if (!this.ready()) {
      // Objet d'alias arrivé à échéance.
      await this.ctx.storage.deleteAll();
      return;
    }
    const meta = this.store.readMeta();
    const now = Date.now();
    const abandoned = now >= meta.lastHostAt + PLAYER_TOKEN_TTL_MS;
    const expiredFinished = meta.phase === "finished" && now >= meta.finishedAt + PLAYER_TOKEN_TTL_MS;
    if (abandoned || expiredFinished) return this.purge();
    if (meta.phase === "question" && now >= meta.startedAt + meta.durationMs + ANSWER_TOLERANCE_MS) return this.reveal(meta);
    await this.scheduleAlarm();
  }

  // Une seule alarme par objet : on programme la plus proche entre fin de question et inactivité de l'hôte.
  private async scheduleAlarm(): Promise<void> {
    const meta = this.store.readMeta();
    const targets = [meta.lastHostAt + PLAYER_TOKEN_TTL_MS];
    if (meta.phase === "question") targets.push(meta.startedAt + meta.durationMs + ANSWER_TOLERANCE_MS);
    if (meta.phase === "finished") targets.push(meta.finishedAt + PLAYER_TOKEN_TTL_MS);
    await this.ctx.storage.setAlarm(Math.min(...targets));
  }

  private async purge(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_CODES.gameGone, "Partie supprimée");
      } catch {
        // Socket déjà fermé.
      }
    }
    await this.store.purge();
    await this.ctx.storage.deleteAlarm();
    // Sans cette remise à zéro, l'instance vivante croirait encore au schéma supprimé.
    this.schemaReady = false;
    this.revealCache = null;
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
    if (inserted && !late) this.notifyCount();
  }

  // Au plus un compteur toutes les 250 ms vers l'hôte : 200 réponses simultanées ne font pas 200 diffusions.
  private notifyCount(): void {
    const wait = COUNT_INTERVAL_MS - (Date.now() - this.lastCountAt);
    if (wait <= 0) return this.sendCount();
    if (this.countTimer) return;
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      this.sendCount();
    }, wait);
  }

  private sendCount(): void {
    if (!this.ready()) return;
    const meta = this.store.readMeta();
    if (meta.phase !== "question") return;
    const question = this.store.questionAt(meta.index);
    if (!question) return;
    this.lastCountAt = Date.now();
    const count = this.store.answeredCount(question.id);
    const total = this.store.playerCount();
    this.broadcast(["host", "screen"], () => ({ type: "answer_count", questionId: question.id, count, total }));
  }

  private async handleHostCommand(ws: WebSocket, message: { type: "start" | "reveal" | "next" | "kick"; playerId?: string }): Promise<void> {
    const meta = this.store.readMeta();
    this.store.writeMeta({ last_host_at: Date.now() });

    if (message.type === "kick") {
      // Le classement final est figé : exclure après coup le réécrirait.
      if (meta.phase === "finished") return this.send(ws, { type: "error", code: "wrong_phase" });
      if (!message.playerId || !this.store.kickPlayer(message.playerId)) return this.send(ws, { type: "error", code: "unknown_player" });
      this.revealCache = null;
      for (const socket of this.ctx.getWebSockets(`p:${message.playerId}`)) socket.close(CLOSE_CODES.kicked, "Exclu de la partie");
      const playerId = message.playerId;
      this.broadcast(["host", "screen"], () => ({ type: "player_left", playerId, count: this.store.playerCount() }));
      if (meta.phase === "question") this.notifyCount();
      return this.scheduleAlarm();
    }

    const command = message.type;
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
    this.revealCache = null;
    // Alarme plutôt que setTimeout pour la fin de question : un minuteur en mémoire est perdu si l'objet est évincé
    // et retarde l'hibernation tant qu'il est armé. Le minuteur court du compteur de réponses (250 ms) reste
    // acceptable : sa perte ne fait que sauter une mise à jour.
    await this.scheduleAlarm();
    const payload = this.questionPayload(question, index, startedAt, question.durationMs);
    this.broadcast(["host", "screen", "player"], () => ({ type: "question", ...payload }));
  }

  private async reveal(meta: MetaState): Promise<void> {
    const question = this.store.questionAt(meta.index);
    if (!question) return;
    this.store.writeMeta({ phase: "revealed" });
    await this.scheduleAlarm();
    const computed = this.computeReveal(meta, question);
    this.revealCache = { questionId: question.id, computed };
    // Les payloads identiques sont sérialisés une seule fois ; seul `you` diffère d'un joueur à l'autre.
    this.sendAll("host", JSON.stringify({ type: "reveal", ...computed.host }));
    this.sendAll("screen", JSON.stringify({ type: "reveal", ...computed.viewer }));
    const base = JSON.stringify({ type: "reveal", ...computed.viewer });
    for (const ws of this.ctx.getWebSockets("player")) {
      const playerId = (ws.deserializeAttachment() as SocketAttachment | null)?.playerId;
      const you = playerId ? computed.you(playerId) : undefined;
      this.trySend(ws, you ? `${base.slice(0, -1)},"you":${JSON.stringify(you)}}` : base);
    }
  }

  private async finish(): Promise<void> {
    const now = Date.now();
    this.store.writeMeta({ phase: "finished", finished_at: now });
    await this.scheduleAlarm();
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

  // Quand la correction est masquée, joueurs et écran ne reçoivent ni correction, ni classement, ni résultat
  // personnel : sur un vrai/faux, le moindre indice dévoilerait la bonne réponse. Les scores arrivent avec `finished`.
  private computeReveal(meta: MetaState, question: StoredQuestion) {
    const ranking = rankEntries(this.store.ranking());
    const correctOptionIds = this.store.options(question.id).filter((o) => o.isCorrect).map((o) => o.id);
    const correctPlayers = this.store.correctPlayerIds(question.id);
    const position = new Map(ranking.map((entry, index) => [entry.playerId, index]));
    const host: RevealPayload = { questionId: question.id, correctOptionIds, ranking: ranking.slice(0, REVEAL_RANKING_SIZE) };
    if (question.explanation) host.explanation = question.explanation;
    if (question.reference) host.reference = question.reference;
    const viewer: RevealPayload = meta.showCorrectAnswer ? host : { questionId: question.id };
    const you = (playerId: string): RevealPayload["you"] | undefined => {
      if (!meta.showCorrectAnswer) return undefined;
      const index = position.get(playerId) ?? ranking.length;
      return { wasCorrect: correctPlayers.has(playerId), score: ranking[index]?.score ?? 0, rank: index + 1 };
    };
    return { host, viewer, you };
  }

  private buildSnapshot(attachment: SocketAttachment): Snapshot {
    const meta = this.store.readMeta();
    const snapshot: Snapshot = {
      type: "snapshot",
      role: attachment.role,
      phase: meta.phase,
      serverNow: Date.now(),
      title: meta.title,
      playerCount: this.store.playerCount(),
    };
    const question = meta.phase === "question" || meta.phase === "revealed" ? this.store.questionAt(meta.index) : null;
    if (question) {
      snapshot.question = this.questionPayload(question, meta.index, meta.startedAt, meta.durationMs);
      if (meta.phase === "revealed") {
        const cached = this.revealCache?.questionId === question.id ? this.revealCache.computed : null;
        const computed = cached ?? this.computeReveal(meta, question);
        this.revealCache = { questionId: question.id, computed };
        const base = attachment.role === "host" ? computed.host : computed.viewer;
        const you = attachment.role === "player" && attachment.playerId ? computed.you(attachment.playerId) : undefined;
        snapshot.reveal = you ? { ...base, you } : base;
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
          answered: answer !== null,
          // Sa propre réponse, jamais la correction.
          ...(answer ? { answeredOptionIds: answer.optionIds } : {}),
          ...(meta.showCorrectAnswer || meta.phase === "finished" ? { score: entry?.score ?? 0 } : {}),
        };
      }
    }
    return snapshot;
  }

  private broadcast(roles: Role[], build: () => ServerMessage): void {
    const message = JSON.stringify(build());
    for (const role of roles) this.sendAll(role, message);
  }

  private sendAll(tag: Role, payload: string): void {
    for (const ws of this.ctx.getWebSockets(tag)) this.trySend(ws, payload);
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
