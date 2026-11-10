import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { QuizDefinition } from "../../../src/server/game/quiz";
import { PLAYER_TOKEN_TTL_MS } from "../../../src/shared/protocol";
import { sessionRow, setup, sidFor, stubFor, type Client } from "./helpers";

// QA indépendante : durées exactes de l'abandon (24 h) et de l'attente après correction (3 min), en mode libre.
const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});

const quiz: QuizDefinition = {
  title: "QA abandon",
  showCorrectAnswer: true,
  mode: "own_pace",
  questions: [0, 1].map((i) => ({
    id: `q${i}`,
    kind: "single" as const,
    prompt: `Q${i}`,
    durationSec: 20 as const,
    options: [
      { id: `q${i}a`, label: "Bonne", isCorrect: true },
      { id: `q${i}b`, label: "Mauvaise", isCorrect: false },
    ],
  })),
};

const rows = <T>(code: string, query: string) => runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec(query).toArray() as T[]);

describe("durées d'attente du mode libre et de l'abandon", () => {
  it("après une correction, l'échéance du joueur est de 3 minutes ; pendant une question, durée + tolérance", async () => {
    const { code, host, players } = await setup(1, quiz);
    opened.push(host, players[0]!.client);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    const [asking] = await rows<{ deadline: number; started_at: number; duration_ms: number }>(code, "SELECT deadline, started_at, duration_ms FROM pstate");
    expect(asking!.deadline - asking!.started_at).toBeGreaterThan(asking!.duration_ms);
    expect(asking!.deadline - asking!.started_at).toBeLessThanOrEqual(asking!.duration_ms + 5_000);
    players[0]!.client.send({ type: "answer", questionId: "q0", optionIds: ["q0a"] });
    await players[0]!.client.waitFor("reveal");
    const [revealed] = await rows<{ deadline: number }>(code, "SELECT deadline FROM pstate");
    const wait = revealed!.deadline - Date.now();
    expect(wait).toBeLessThanOrEqual(3 * 60 * 1000);
    expect(wait).toBeGreaterThan(3 * 60 * 1000 - 30_000);
  });

  it("l'hôte absent moins de 24 h ne ferme pas la partie ; au-delà elle passe à ended, code libéré", async () => {
    const { code, host } = await setup(1, quiz);
    opened.push(host);
    const setHostAt = (ago: number) =>
      runInDurableObject(stubFor(code), (_i, state) => void state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'last_host_at'", String(Date.now() - ago)));
    await setHostAt(PLAYER_TOKEN_TTL_MS - 60_000);
    await runDurableObjectAlarm(stubFor(code));
    expect((await sessionRow(sidFor(code)))?.status).not.toBe("ended");
    await setHostAt(PLAYER_TOKEN_TTL_MS + 1_000);
    await runDurableObjectAlarm(stubFor(code));
    expect((await sessionRow(sidFor(code)))?.status).toBe("ended");
  });
});
