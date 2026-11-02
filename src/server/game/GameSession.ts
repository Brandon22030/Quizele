import { DurableObject } from "cloudflare:workers";
import {
  ANSWER_TOLERANCE_MS,
  CLOSE_CODES,
  LOBBY_RECENT_PLAYERS,
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
import { getDb } from "../db/client";
import { markSessionRunning } from "../db/sessions";
import { saveSessionResults, type QuestionStatResult } from "../db/results";
import { parseQuizDefinition, type QuizDefinition } from "./quiz";
import { isAnswerCorrect, rankEntries } from "./scoring";
import { closedSocket } from "./reject";
import { shuffleSeeded } from "./shuffle";
import { GameStorage, type MetaState, type PlayerState, type StoredOption, type StoredQuestion } from "./storage";
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
// Un joueur reçoit le haut du classement et son propre rang : le bilan complet reste réservé à l'hôte et à l'écran.
// Diffuser 200 lignes à 200 sockets coûterait plus de CPU que tout le reste de la fin de partie.
const PLAYER_RANKING_SIZE = 20;
const BUCKET_CAPACITY = 30;
const BUCKET_REFILL_PER_MS = 10 / 1000;
// Une reconnexion n'est pas gratuite : sans ce coût, se reconnecter en boucle contournerait le seau.
const CONNECT_COST = 5;
// Au plus 10 connexions d'affilée par joueur (ou rôle), puis une toutes les 6 s : assez pour un réseau mobile
// instable avec le délai croissant du client, pas pour une boucle.
const CONNECT_BURST = 10;
const CONNECT_REFILL_PER_MS = 1 / 6000;
const COUNT_INTERVAL_MS = 250;
const LOBBY_INTERVAL_MS = 500;
// Une écriture finale restée sans réponse au-delà de ce délai est considérée comme perdue (objet évincé en route) :
// la fin de partie peut alors être retentée.
const FINISH_LOCK_MS = 30_000;
// Attente après qu'un joueur a vu sa correction : au-delà, s'il a quitté la page, il est marqué terminé.
const REVEALED_IDLE_MS = 3 * 60 * 1000;
// Délai avant de retenter la clôture d'une partie abandonnée quand D1 a échoué.
const ABANDON_RETRY_MS = 60 * 60 * 1000;
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
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLobbyAt = 0;
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

  // null : partie jamais créée ou purgée.
  currentPhase(): Phase | null {
    return this.ready() ? this.store.readMeta().phase : null;
  }

  // Appelé en RPC par l'action de lancement, avec l'instantané du quiz lu dans D1. Un quiz invalide est rejeté ici,
  // avant tout stockage. Idempotent : une partie déjà initialisée n'est pas écrasée.
  async init(code: string, sid: string, input: QuizDefinition): Promise<void> {
    if (this.ready()) return;
    const quiz = parseQuizDefinition(input);
    this.store.migrate();
    this.schemaReady = true;
    this.store.loadQuiz(code, sid, quiz, Date.now(), quiz.seed ?? crypto.randomUUID());
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
    // Mode libre : un joueur qui arrive en cours de partie commence sa propre série tout de suite.
    if (meta.phase === "running") this.beginQuestion(meta, playerId, 0, Date.now());
    this.broadcast(["host", "screen"], () => ({
      type: "player_joined",
      player: { id: playerId, pseudo: pseudo.data },
      count: this.store.playerCount(),
    }));
    this.notifyLobby();
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
      // Seule l'action de lancement crée une partie : une connexion ne crée jamais rien.
      return closedSocket(CLOSE_CODES.gameGone, "Partie introuvable");
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
      case "next":
        if (attachment.role === "player" && this.store.readMeta().mode === "own_pace") return this.handlePlayerNext(ws, attachment);
      // Les autres rôles passent par la vérification de l'hôte.
      // falls through
      case "start":
      case "reveal":
      case "end":
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
    if (!this.ready()) return;
    const meta = this.store.readMeta();
    const now = Date.now();
    if (meta.phase === "finished") {
      if (now >= meta.finishedAt + PLAYER_TOKEN_TTL_MS) return this.purge();
      return this.scheduleAlarm();
    }
    if (now >= meta.lastHostAt + PLAYER_TOKEN_TTL_MS) {
      // Une partie abandonnée est d'abord clôturée : sans bilan, D1 la garderait « active » et son code resterait bloqué.
      // Si D1 échoue, l'état est conservé et la clôture est retentée plus tard.
      if (!(await this.finish())) await this.ctx.storage.setAlarm(now + ABANDON_RETRY_MS);
      return;
    }
    if (meta.phase === "question" && now >= meta.startedAt + meta.durationMs + ANSWER_TOLERANCE_MS) return this.reveal(meta);
    if (meta.phase === "running") {
      for (const playerId of this.store.expiredPlayerIds(now)) await this.expireOwnPace(meta, playerId);
      await this.scheduleAlarm();
      await this.finishIfAllDone();
      return;
    }
    await this.scheduleAlarm();
  }

  // Une seule alarme par objet : on programme la plus proche entre fin de question et inactivité de l'hôte.
  private async scheduleAlarm(): Promise<void> {
    const meta = this.store.readMeta();
    const targets = [meta.lastHostAt + PLAYER_TOKEN_TTL_MS];
    if (meta.phase === "question") targets.push(meta.startedAt + meta.durationMs + ANSWER_TOLERANCE_MS);
    if (meta.phase === "running") {
      const next = this.store.nextPlayerDeadline();
      if (next !== null) targets.push(next);
    }
    // Une partie terminée n'attend plus l'hôte : seule la purge à 24 h reste programmée.
    if (meta.phase === "finished") targets.splice(0, targets.length, meta.finishedAt + PLAYER_TOKEN_TTL_MS);
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
    const ownPace = meta.mode === "own_pace";
    // Mode libre : la question du joueur et son heure de départ sont les siennes, pas celles de la partie.
    const personal = ownPace ? this.store.playerState(playerId) : null;
    if (ownPace ? meta.phase !== "running" || meta.finishingAt > 0 || personal?.phase !== "question" : meta.phase !== "question") {
      return this.send(ws, { type: "error", code: "wrong_phase" });
    }
    const question = ownPace ? this.questionOf(meta, playerId, personal!.idx) : this.store.questionAt(meta.index);
    if (!question || question.id !== questionId) return this.send(ws, { type: "error", code: "unknown_question" });

    const options = this.store.options(question.id);
    const known = new Set(options.map((option) => option.id));
    if (optionIds.some((id) => !known.has(id))) return this.send(ws, { type: "error", code: "invalid_options" });

    const startedAt = personal?.startedAt ?? meta.startedAt;
    const durationMs = personal?.durationMs ?? meta.durationMs;
    const elapsed = Math.max(0, receivedAt - startedAt);
    const late = elapsed > durationMs + ANSWER_TOLERANCE_MS;
    const correctIds = options.filter((option) => option.isCorrect).map((option) => option.id);
    const correct = !late && isAnswerCorrect(question.kind, optionIds, correctIds);
    const inserted = this.store.insertAnswer({
      playerId,
      questionId,
      optionIds,
      receivedAt,
      elapsedMs: Math.min(elapsed, durationMs),
      correct,
      late,
    });
    this.send(ws, { type: "answer_ack", questionId, duplicate: !inserted, late });
    if (ownPace) return this.revealOwnPace(meta, personal!, question);
    if (inserted && !late) this.notifyCount();
  }

  // Ordre propre à chaque joueur en mode libre : mélange déterministe dérivé de la graine de la partie et de son
  // identifiant, donc recalculable à tout moment sans rien stocker. Sans mélange, c'est l'ordre du quiz.
  private questionOf(meta: MetaState, playerId: string, idx: number): StoredQuestion | null {
    const positions = Array.from({ length: this.store.questionCount() }, (_, i) => i);
    const order = meta.shuffle ? shuffleSeeded(positions, `${meta.seed}:player:${playerId}`) : positions;
    const position = order[idx];
    return position === undefined ? null : this.store.questionAt(position);
  }

  // En mode ensemble, l'ordre des options est déjà figé dans le stockage pour toute la partie.
  private optionsOf(meta: MetaState, question: StoredQuestion, playerId?: string): StoredOption[] {
    const options = this.store.options(question.id);
    if (!playerId || meta.mode !== "own_pace" || !meta.shuffle || question.kind === "true_false") return options;
    return shuffleSeeded(options, `${meta.seed}:player:${playerId}:${question.id}`);
  }

  private sendToPlayer(playerId: string, message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets(`p:${playerId}`)) this.trySend(ws, payload);
  }

  // Démarre la question `idx` d'un joueur : sa propre horloge commence maintenant.
  private beginQuestion(meta: MetaState, playerId: string, idx: number, now: number): void {
    const question = this.questionOf(meta, playerId, idx);
    if (!question) return;
    const state: PlayerState = { playerId, idx, phase: "question", startedAt: now, durationMs: question.durationMs };
    this.store.savePlayerState(state, now + question.durationMs + ANSWER_TOLERANCE_MS);
    this.sendToPlayer(playerId, { type: "question", ...this.questionPayload(meta, question, idx, now, question.durationMs, playerId) });
  }

  // Après sa réponse ou à l'échéance, le joueur voit sa correction (si elle est affichée) puis avance quand il veut.
  private async revealOwnPace(meta: MetaState, state: PlayerState, question: StoredQuestion): Promise<void> {
    this.store.savePlayerState({ ...state, phase: "revealed" }, Date.now() + REVEALED_IDLE_MS);
    await this.scheduleAlarm();
    this.sendToPlayer(state.playerId, { type: "reveal", ...this.ownPaceReveal(meta, question, state.playerId) });
  }

  // À l'échéance d'une question on ne teste jamais le socket : iOS et Android ferment le WebSocket d'un téléphone
  // verrouillé, et ce joueur doit retrouver sa partie. Seul le dépassement de l'attente après correction, sans socket
  // ouvert (onglet fermé, ou jamais connecté), marque le joueur terminé : il garde ses points mais ne bloque plus la
  // fin automatique.
  private async expireOwnPace(meta: MetaState, playerId: string): Promise<void> {
    const state = this.store.playerState(playerId);
    const question = state ? this.questionOf(meta, playerId, state.idx) : null;
    if (!state || !question) return;
    if (state.phase === "question") return this.revealOwnPace(meta, state, question);
    if (this.ctx.getWebSockets(`p:${playerId}`).length === 0) {
      this.store.savePlayerState({ ...state, phase: "done" }, null);
      const finished = this.store.doneCount();
      const total = this.store.playerCount();
      this.broadcast(["host", "screen"], () => ({ type: "progress", finished, total }));
      return;
    }
    // Joueur encore connecté mais inactif : on revérifie plus tard, il peut simplement lire sa correction.
    this.store.savePlayerState(state, Date.now() + REVEALED_IDLE_MS);
  }

  private ownPaceReveal(meta: MetaState, question: StoredQuestion, playerId: string): RevealPayload {
    if (!meta.showCorrectAnswer) return { questionId: question.id };
    const reveal: RevealPayload = {
      questionId: question.id,
      correctOptionIds: this.store.options(question.id).filter((option) => option.isCorrect).map((option) => option.id),
      you: { wasCorrect: this.store.answerOf(playerId, question.id)?.correct ?? false, score: this.store.playerScore(playerId) },
    };
    if (question.explanation) reveal.explanation = question.explanation;
    if (question.reference) reveal.reference = question.reference;
    return reveal;
  }

  private async handlePlayerNext(ws: WebSocket, attachment: SocketAttachment): Promise<void> {
    const playerId = attachment.playerId;
    const meta = this.store.readMeta();
    const state = playerId ? this.store.playerState(playerId) : null;
    if (!playerId || !state || meta.phase !== "running" || meta.finishingAt > 0 || state.phase !== "revealed") {
      return this.send(ws, { type: "error", code: "wrong_phase" });
    }
    if (state.idx + 1 < this.store.questionCount()) {
      this.beginQuestion(meta, playerId, state.idx + 1, Date.now());
      return this.scheduleAlarm();
    }
    this.store.savePlayerState({ ...state, phase: "done" }, null);
    this.send(ws, this.buildSnapshot(attachment));
    const finished = this.store.doneCount();
    const total = this.store.playerCount();
    this.broadcast(["host", "screen"], () => ({ type: "progress", finished, total }));
    await this.scheduleAlarm();
    await this.finishIfAllDone();
  }

  // Mode libre : la partie se termine d'elle-même quand le dernier joueur a fini.
  private async finishIfAllDone(): Promise<void> {
    const meta = this.store.readMeta();
    if (meta.mode !== "own_pace" || meta.phase !== "running") return;
    const total = this.store.playerCount();
    if (total > 0 && this.store.doneCount() >= total) await this.finish();
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

  // Salle d'attente : les joueurs reçoivent le nombre de présents et les derniers arrivés, au plus un message toutes
  // les 500 ms. Les anciens arrivants ne sont jamais listés en entier.
  private notifyLobby(): void {
    const wait = LOBBY_INTERVAL_MS - (Date.now() - this.lastLobbyAt);
    if (wait <= 0) return this.sendLobby();
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      this.sendLobby();
    }, wait);
  }

  private sendLobby(): void {
    if (!this.ready() || this.store.readMeta().phase !== "lobby") return;
    this.lastLobbyAt = Date.now();
    const playerCount = this.store.playerCount();
    const players = this.store.recentPlayers(LOBBY_RECENT_PLAYERS);
    this.broadcast(["player"], () => ({ type: "lobby_players", playerCount, players }));
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

  private async handleHostCommand(ws: WebSocket, message: { type: "start" | "reveal" | "next" | "end" | "kick"; playerId?: string }): Promise<void> {
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
      this.notifyLobby();
      await this.scheduleAlarm();
      return this.finishIfAllDone();
    }

    if (message.type === "end") {
      if (meta.phase === "finished") return this.send(ws, { type: "error", code: "wrong_phase" });
      return this.endGame(ws);
    }

    const command = message.type;
    const expected = command === "start" ? "lobby" : command === "reveal" ? "question" : "revealed";
    if (meta.phase !== expected) return this.send(ws, { type: "error", code: "wrong_phase" });

    if (command === "start") return meta.mode === "own_pace" ? this.startOwnPace(meta) : this.startQuestion(0);
    if (command === "reveal") return this.reveal(meta);
    if (meta.index + 1 < this.store.questionCount()) return this.startQuestion(meta.index + 1);
    await this.endGame(ws);
  }

  private async endGame(ws: WebSocket): Promise<void> {
    if (!(await this.finish())) this.send(ws, { type: "error", code: "save_failed" });
  }

  // Mode libre : tous les joueurs présents partent en même temps, chacun avec son ordre.
  private async startOwnPace(meta: MetaState): Promise<void> {
    const now = Date.now();
    this.store.writeMeta({ phase: "running" });
    const running = { ...meta, phase: "running" as const };
    for (const playerId of this.store.playersWithoutState()) this.beginQuestion(running, playerId, 0, now);
    await this.scheduleAlarm();
    for (const role of ["host", "screen"] as const) {
      for (const ws of this.ctx.getWebSockets(role)) {
        const attachment = ws.deserializeAttachment() as SocketAttachment | null;
        if (attachment) this.trySend(ws, JSON.stringify(this.buildSnapshot(attachment)));
      }
    }
    await this.markRunning(meta.sid);
  }

  // Meilleur effort : le statut « en cours » n'est qu'un confort d'affichage pour le tableau de bord. Un échec de D1
  // ne doit jamais empêcher la partie de commencer.
  private async markRunning(sid: string): Promise<void> {
    try {
      await markSessionRunning(getDb(this.env.DB), sid);
    } catch {
      // La partie reste « en attente » dans D1 ; l'écriture finale la passera à « terminée ».
    }
  }

  private async startQuestion(index: number): Promise<void> {
    const question = this.store.questionAt(index);
    if (!question) {
      await this.finish();
      return;
    }
    const startedAt = Date.now();
    this.store.writeMeta({ phase: "question", idx: index, started_at: startedAt, duration_ms: question.durationMs });
    this.revealCache = null;
    // Alarme plutôt que setTimeout pour la fin de question : un minuteur en mémoire est perdu si l'objet est évincé
    // et retarde l'hibernation tant qu'il est armé. Le minuteur court du compteur de réponses (250 ms) reste
    // acceptable : sa perte ne fait que sauter une mise à jour.
    await this.scheduleAlarm();
    const meta = this.store.readMeta();
    const payload = this.questionPayload(meta, question, index, startedAt, question.durationMs);
    this.broadcast(["host", "screen", "player"], () => ({ type: "question", ...payload }));
    if (index === 0) await this.markRunning(meta.sid);
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

  // Écrit le classement et les statistiques dans D1 en un seul batch, puis seulement fige la partie. Si D1 échoue, la
  // partie reste en l'état et l'hôte peut réessayer : mieux vaut une fin retardée qu'un bilan perdu.
  // Renvoie false si la fin n'a pas eu lieu (écriture en échec ou déjà en cours).
  private async finish(): Promise<boolean> {
    const meta = this.store.readMeta();
    if (meta.phase === "finished") return true;
    const now = Date.now();
    // Le verrou couvre l'attente de D1 : pendant ce temps d'autres messages peuvent arriver.
    if (meta.finishingAt > 0 && now - meta.finishingAt < FINISH_LOCK_MS) return false;
    this.store.writeMeta({ finishing_at: now });
    const ranking = rankEntries(this.store.ranking());
    try {
      await saveSessionResults(
        getDb(this.env.DB),
        meta.sid,
        ranking.map((entry, index) => ({ pseudo: entry.pseudo, score: entry.score, totalTimeMs: entry.totalMs, rank: index + 1 })),
        this.buildStats(),
        new Date(now),
      );
    } catch {
      this.store.writeMeta({ finishing_at: 0 });
      return false;
    }
    this.store.writeMeta({ phase: "finished", finished_at: now, finishing_at: 0 });
    this.revealCache = null;
    await this.scheduleAlarm();
    const total = this.store.questionCount();
    const full = JSON.stringify({ type: "finished", ranking, total });
    this.sendAll("host", full);
    this.sendAll("screen", full);
    const base = JSON.stringify({ type: "finished", ranking: ranking.slice(0, PLAYER_RANKING_SIZE), total });
    const rankOf = new Map(ranking.map((entry, index) => [entry.playerId, { entry, rank: index + 1 }]));
    for (const ws of this.ctx.getWebSockets("player")) {
      const found = rankOf.get((ws.deserializeAttachment() as SocketAttachment | null)?.playerId ?? "");
      const you = found && { rank: found.rank, score: found.entry.score, totalMs: found.entry.totalMs };
      this.trySend(ws, you ? `${base.slice(0, -1)},"you":${JSON.stringify(you)}}` : base);
    }
    return true;
  }

  private buildStats(): QuestionStatResult[] {
    const totals = new Map(this.store.answerTotals().map((row) => [row.questionId, row]));
    const picks = new Map(this.store.optionPicks().map((row) => [`${row.questionId}:${row.optionId}`, row.n]));
    const optionsByQuestion = new Map<string, (StoredOption & { questionId: string })[]>();
    for (const option of this.store.allOptions()) {
      const list = optionsByQuestion.get(option.questionId) ?? [];
      list.push(option);
      optionsByQuestion.set(option.questionId, list);
    }
    return this.store.allQuestions().map((question) => {
      const options = optionsByQuestion.get(question.id) ?? [];
      // Clé = libellé : c'est ce que le bilan affiche. Deux options de même libellé s'additionnent.
      const distribution: Record<string, number> = {};
      for (const option of options) distribution[option.label] = (distribution[option.label] ?? 0) + (picks.get(`${question.id}:${option.id}`) ?? 0);
      const total = totals.get(question.id);
      return {
        position: question.position,
        prompt: question.prompt,
        correctLabels: options.filter((option) => option.isCorrect).map((option) => option.label),
        reference: question.reference,
        answerCount: total?.answerCount ?? 0,
        correctCount: total?.correctCount ?? 0,
        distribution,
      };
    });
  }

  private questionPayload(
    meta: MetaState,
    question: StoredQuestion,
    index: number,
    startedAt: number,
    durationMs: number,
    playerId?: string,
  ): QuestionPayload {
    return {
      index,
      total: this.store.questionCount(),
      questionId: question.id,
      kind: question.kind,
      prompt: question.prompt,
      options: this.optionsOf(meta, question, playerId).map(({ id, label }) => ({ id, label })),
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
    const ownPace = meta.mode === "own_pace";
    const playerId = attachment.role === "player" ? attachment.playerId : undefined;
    const personal = ownPace && playerId && meta.phase === "running" ? this.store.playerState(playerId) : null;
    const snapshot: Snapshot = {
      type: "snapshot",
      role: attachment.role,
      phase: meta.phase,
      serverNow: Date.now(),
      title: meta.title,
      playerCount: this.store.playerCount(),
      mode: meta.mode,
    };
    if (ownPace && meta.phase === "running") {
      // Chaque joueur voit sa propre progression ; l'hôte et l'écran voient la partie « en cours ».
      snapshot.phase = personal ? (personal.phase === "done" ? "waiting" : personal.phase) : playerId ? "lobby" : "running";
      if (!playerId) snapshot.finishedCount = this.store.doneCount();
    }
    const ownQuestion = personal && personal.phase !== "done" ? this.questionOf(meta, personal.playerId, personal.idx) : null;
    const question = ownQuestion ?? (!ownPace && (meta.phase === "question" || meta.phase === "revealed") ? this.store.questionAt(meta.index) : null);
    if (question) {
      snapshot.question = personal
        ? this.questionPayload(meta, question, personal.idx, personal.startedAt, personal.durationMs, personal.playerId)
        : this.questionPayload(meta, question, meta.index, meta.startedAt, meta.durationMs);
      if (personal) {
        if (personal.phase === "revealed") snapshot.reveal = this.ownPaceReveal(meta, question, personal.playerId);
      } else if (meta.phase === "revealed") {
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
    const ranking = meta.phase === "finished" ? rankEntries(this.store.ranking()) : null;
    if (ranking) {
      snapshot.ranking = attachment.role === "player" ? ranking.slice(0, PLAYER_RANKING_SIZE) : ranking;
      snapshot.total = this.store.questionCount();
    }
    if (attachment.role !== "player") snapshot.players = this.store.players();
    else if (meta.phase === "lobby") snapshot.players = this.store.recentPlayers(LOBBY_RECENT_PLAYERS);

    if (attachment.role === "player" && attachment.playerId) {
      const player = this.store.player(attachment.playerId);
      if (player) {
        const answer = question ? this.store.answerOf(player.id, question.id) : null;
        const position = ranking?.findIndex((row) => row.playerId === player.id) ?? -1;
        // Ensemble : le score exclut la question en cours, il ne doit pas trahir la justesse de la réponse. Libre : la
        // correction est montrée dès la réponse, le score cumulé est donc déjà connu du joueur.
        const score = ranking
          ? (ranking[position]?.score ?? 0)
          : ownPace
            ? this.store.playerScore(player.id)
            : (this.store.ranking(meta.phase === "question" ? question?.id : "").find((row) => row.playerId === player.id)?.score ?? 0);
        snapshot.me = {
          playerId: player.id,
          pseudo: player.pseudo,
          answered: answer !== null,
          // Sa propre réponse, jamais la correction.
          ...(answer ? { answeredOptionIds: answer.optionIds } : {}),
          ...(meta.showCorrectAnswer || meta.phase === "finished" ? { score } : {}),
          ...(position >= 0 ? { rank: position + 1 } : {}),
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
