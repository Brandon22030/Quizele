import type {
  PlayerInfo,
  GameMode,
  Phase,
  QuestionPayload,
  RankingEntry,
  RevealPayload,
  Role,
  ServerMessage,
  Snapshot,
} from "../../shared/protocol";
import type { QuestionClock } from "../../shared/clock";
import { isTerminalStatus, type ConnectionStatus } from "./game-socket";

export interface SessionState {
  connection: ConnectionStatus;
  role: Role | null;
  mode: GameMode | null;
  phase: Phase | null;
  title: string;
  playerCount: number;
  players: PlayerInfo[];
  question: QuestionPayload | null;
  clock: QuestionClock | null;
  reveal: RevealPayload | null;
  ranking: RankingEntry[];
  me: Snapshot["me"] | null;
  answered: boolean;
  answeredOptionIds: string[];
  answeredCount: number;
  // Mode libre, hôte et écran : joueurs ayant fini toutes leurs questions.
  finishedCount: number;
  // Résultat du joueur reçu avec la fin de partie : rang, score et temps, sans correction.
  result: { rank: number; score: number; totalMs: number } | null;
  lateAnswer: boolean;
  error: string | null;
}

export type SessionAction =
  | { type: "reset" }
  | { type: "connection"; status: ConnectionStatus }
  | { type: "message"; message: ServerMessage; clock: QuestionClock | null };

export const initialSessionState: SessionState = {
  connection: "connecting",
  role: null,
  mode: null,
  phase: null,
  title: "",
  playerCount: 0,
  players: [],
  question: null,
  clock: null,
  reveal: null,
  ranking: [],
  me: null,
  answered: false,
  answeredOptionIds: [],
  answeredCount: 0,
  finishedCount: 0,
  result: null,
  lateAnswer: false,
  error: null,
};

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  // Seul moyen de sortir d'un statut terminal : changer de partie.
  if (action.type === "reset") return initialSessionState;
  if (action.type === "connection") {
    // Une fin définitive (exclusion, partie terminée, lien invalide) ne se défait pas.
    if (isTerminalStatus(state.connection)) return state;
    return { ...state, connection: action.status };
  }
  const { message, clock } = action;
  switch (message.type) {
    case "snapshot":
      // L'instantané remplace tout : c'est ce qui rend la reprise après coupure fiable.
      return {
        ...state,
        error: null,
        role: message.role,
        mode: message.mode ?? state.mode,
        phase: message.phase,
        title: message.title,
        playerCount: message.playerCount,
        players: message.players ?? [],
        question: message.question ?? null,
        clock,
        reveal: message.reveal ?? null,
        ranking: message.ranking ?? [],
        me: message.me ?? null,
        answered: message.me?.answered ?? false,
        answeredOptionIds: message.me?.answeredOptionIds ?? [],
        answeredCount: message.answeredCount ?? 0,
        finishedCount: message.finishedCount ?? 0,
        result:
          message.phase === "finished" && message.me?.rank !== undefined
            ? {
                rank: message.me.rank,
                score: message.me.score ?? 0,
                totalMs: message.ranking?.find((row) => row.playerId === message.me?.playerId)?.totalMs ?? 0,
              }
            : null,
        lateAnswer: false,
      };
    case "question": {
      const { type: _type, ...question } = message;
      return {
        ...state,
        error: null,
        phase: "question",
        question,
        clock,
        reveal: null,
        answered: false,
        answeredOptionIds: [],
        answeredCount: 0,
        lateAnswer: false,
      };
    }
    case "reveal": {
      const { type: _type, ...reveal } = message;
      return { ...state, error: null, phase: "revealed", reveal, me: state.me && reveal.you ? { ...state.me, score: reveal.you.score } : state.me };
    }
    case "finished":
      return { ...state, error: null, phase: "finished", ranking: message.ranking, result: message.you ?? null };
    case "progress":
      return { ...state, finishedCount: message.finished, playerCount: message.total };
    case "answer_ack":
      return { ...state, error: null, answered: true, lateAnswer: message.late };
    case "answer_count":
      // Un compteur en retard d'une question précédente ne doit pas écraser celui de la question courante.
      if (state.question?.questionId !== message.questionId) return state;
      return { ...state, answeredCount: message.count };
    case "player_left":
      return {
        ...state,
        playerCount: message.count,
        players: state.players.filter((p) => p.id !== message.playerId),
      };
    case "player_joined":
      return {
        ...state,
        playerCount: message.count,
        players: state.players.some((p) => p.id === message.player.id) ? state.players : [...state.players, message.player],
      };
    case "error":
      return { ...state, error: message.code };
  }
}
