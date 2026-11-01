import { describe, expect, it } from "vitest";
import { initialSessionState, sessionReducer } from "../../src/client/realtime/session-state";
import type { ServerMessage } from "../../src/shared/protocol";

const question = {
  index: 0,
  total: 2,
  questionId: "q1",
  kind: "single" as const,
  prompt: "?",
  options: [{ id: "a", label: "A" }],
  startedAt: 1000,
  durationMs: 10_000,
  serverNow: 1500,
};

const apply = (state: typeof initialSessionState, message: ServerMessage) =>
  sessionReducer(state, { type: "message", message, clock: null });

describe("session-state", () => {
  it("une nouvelle question remet à zéro la réponse et le compteur", () => {
    let state = apply(initialSessionState, { type: "answer_ack", questionId: "q0", duplicate: false, late: false });
    state = apply(state, { type: "answer_count", questionId: "q0", count: 3, total: 4 });
    state = apply(state, { type: "question", ...question });
    expect(state.phase).toBe("question");
    expect(state.answered).toBe(false);
    expect(state.answeredCount).toBe(0);
    expect(state.question?.questionId).toBe("q1");
  });

  it("l'instantané remplace l'état et restitue la réponse déjà donnée", () => {
    const state = apply(initialSessionState, {
      type: "snapshot",
      role: "player",
      phase: "question",
      serverNow: 4000,
      title: "Quiz",
      playerCount: 2,
      question,
      me: { playerId: "p1", pseudo: "Awa", score: 1, answered: true, answeredOptionIds: ["a"] },
    });
    expect(state.answered).toBe(true);
    expect(state.answeredOptionIds).toEqual(["a"]);
    expect(state.me?.score).toBe(1);
  });

  it("player_joined n'ajoute pas deux fois le même joueur", () => {
    const message: ServerMessage = { type: "player_joined", player: { id: "p1", pseudo: "Awa" }, count: 1 };
    const state = apply(apply(initialSessionState, message), message);
    expect(state.players).toHaveLength(1);
  });

  it("le statut de connexion est indépendant de l'état de jeu", () => {
    const state = sessionReducer(initialSessionState, { type: "connection", status: "reconnecting" });
    expect(state.connection).toBe("reconnecting");
  });
});
