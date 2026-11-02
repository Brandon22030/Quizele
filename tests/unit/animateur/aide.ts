import { initialSessionState, sessionReducer, type SessionState } from "../../../src/client/realtime/session-state";
import { createQuestionClock } from "../../../src/shared/clock";
import type { ServerMessage } from "../../../src/shared/protocol";

export const CODE = "K7Q2M9";

export const options = [
  { id: "o1", label: "Abraham" },
  { id: "o2", label: "Noé" },
  { id: "o3", label: "Moïse" },
];

export const instantane = (extra: Partial<Extract<ServerMessage, { type: "snapshot" }>> = {}): ServerMessage => ({
  type: "snapshot",
  role: "host",
  phase: "lobby",
  serverNow: 1_000,
  title: "Les héros de la foi",
  playerCount: 0,
  mode: "together",
  players: [],
  ...extra,
});

export const question = (index = 2, total = 10): ServerMessage => ({
  type: "question",
  index,
  total,
  questionId: `q${index + 1}`,
  kind: "single",
  prompt: "Qui a construit l'arche ?",
  options,
  startedAt: 1_000,
  durationMs: 20_000,
  serverNow: 1_000,
});

export const revelation: ServerMessage = {
  type: "reveal",
  questionId: "q3",
  correctOptionIds: ["o2"],
  explanation: "Genèse 6.",
  ranking: [{ playerId: "p1", pseudo: "Esther.B", score: 1, totalMs: 4_000, rank: 1 }],
};

// Rejoue des messages de protocole simulés dans le vrai réducteur : l'écran reçoit exactement l'état de production.
export function etat(messages: ServerMessage[], connection: SessionState["connection"] = "open"): SessionState {
  const base = sessionReducer(initialSessionState, { type: "connection", status: connection });
  return messages.reduce<SessionState>((s, message) => {
    const horloge =
      message.type === "question"
        ? createQuestionClock(message, () => 6_000)
        : message.type === "snapshot" && message.question
          ? createQuestionClock({ ...message.question, serverNow: message.serverNow }, () => 6_000)
          : null;
    return sessionReducer(s, { type: "message", message, clock: horloge });
  }, base);
}
