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

describe("session-state : corrections de revue", () => {
  it("ignore un compteur de réponses d'une autre question", () => {
    let state = apply(initialSessionState, { type: "question", ...question });
    state = apply(state, { type: "answer_count", questionId: "q1", count: 2, total: 3 });
    const after = apply(state, { type: "answer_count", questionId: "q0", count: 9, total: 9 });
    expect(after.answeredCount).toBe(2);
  });

  it("remet l'erreur à zéro sur answer_ack, reveal et finished", () => {
    const failed = apply(initialSessionState, { type: "error", code: "wrong_phase" });
    expect(failed.error).toBe("wrong_phase");
    expect(apply(failed, { type: "answer_ack", questionId: "q1", duplicate: false, late: false }).error).toBeNull();
    expect(apply(failed, { type: "reveal", questionId: "q1" }).error).toBeNull();
    expect(apply(failed, { type: "finished", ranking: [], total: 3 }).error).toBeNull();
  });

  it("player_left retire le joueur et met à jour le compte", () => {
    let state = apply(initialSessionState, { type: "player_joined", player: { id: "p1", pseudo: "Awa" }, count: 1 });
    state = apply(state, { type: "player_left", playerId: "p1", count: 0 });
    expect(state.players).toEqual([]);
    expect(state.playerCount).toBe(0);
  });
});

describe("session-state : statuts terminaux", () => {
  it.each(["kicked", "ended", "rejected"] as const)("le statut %s ne se défait pas sur un événement de connexion tardif", (status) => {
    let state = sessionReducer(initialSessionState, { type: "connection", status });
    state = sessionReducer(state, { type: "connection", status: "reconnecting" });
    state = sessionReducer(state, { type: "connection", status: "open" });
    expect(state.connection).toBe(status);
  });
});

describe("session-state : changement de partie", () => {
  it("un statut terminal résiste aux changements de connexion mais pas à la remise à zéro d'un nouveau code", () => {
    let state = sessionReducer(initialSessionState, { type: "connection", status: "open" });
    state = apply(state, { type: "finished", ranking: [], total: 3 });
    state = sessionReducer(state, { type: "connection", status: "ended" });
    expect(sessionReducer(state, { type: "connection", status: "open" }).connection).toBe("ended");
    // useGameSession envoie "reset" à chaque nouveau code avant d'ouvrir le socket de la nouvelle partie.
    state = sessionReducer(state, { type: "reset" });
    expect(state).toEqual(initialSessionState);
    state = sessionReducer(state, { type: "connection", status: "open" });
    expect(state.connection).toBe("open");
    expect(state.phase).toBeNull();
  });

  it("la fin de partie conserve le résultat du joueur et la progression du mode libre", () => {
    let state = apply(initialSessionState, { type: "progress", finished: 2, total: 5 });
    expect(state).toMatchObject({ finishedCount: 2, playerCount: 5 });
    state = apply(state, {
      type: "finished",
      ranking: [{ playerId: "p1", pseudo: "Awa", score: 3, totalMs: 4000, rank: 1 }],
      total: 10,
      you: { rank: 1, score: 3, totalMs: 4000 },
    });
    expect(state).toMatchObject({ phase: "finished", result: { rank: 1, score: 3, totalMs: 4000 }, totalQuestions: 10 });
  });

  it("lobby_players remplace le compteur et les derniers arrivés", () => {
    const state = apply(
      { ...initialSessionState, players: [{ id: "p1", pseudo: "Awa" }] },
      { type: "lobby_players", playerCount: 12, players: [{ id: "p2", pseudo: "Kofi" }, { id: "p3", pseudo: "Esi" }] },
    );
    expect(state.playerCount).toBe(12);
    expect(state.players).toEqual([{ id: "p2", pseudo: "Kofi" }, { id: "p3", pseudo: "Esi" }]);
  });

  it("l'instantané d'une partie finie restitue le rang et le mode", () => {
    const state = apply(initialSessionState, {
      type: "snapshot",
      role: "player",
      phase: "finished",
      serverNow: 1,
      title: "Quiz",
      playerCount: 1,
      mode: "own_pace",
      ranking: [{ playerId: "p1", pseudo: "Awa", score: 2, totalMs: 900, rank: 1 }],
      me: { playerId: "p1", pseudo: "Awa", score: 2, answered: false, rank: 1 },
    });
    expect(state).toMatchObject({ mode: "own_pace", result: { rank: 1, score: 2, totalMs: 900 } });
  });
});

