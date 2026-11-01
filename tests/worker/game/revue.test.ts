import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/server/db/client";
import { getSessionReport } from "../../../src/server/db/results";
import type { QuizDefinition } from "../../../src/server/game/quiz";
import { PLAYER_TOKEN_TTL_MS } from "../../../src/shared/protocol";
import { OWNER_ID, connect, sessionRow, setup, sidFor, spyOnDatabase, stubFor, type Client } from "./helpers";

const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});

const quiz = (count: number, extra: Partial<QuizDefinition> = {}): QuizDefinition => ({
  title: "Quiz de revue",
  showCorrectAnswer: true,
  questions: Array.from({ length: count }, (_, i) => ({
    id: `q${i}`,
    kind: "single" as const,
    prompt: `Question ${i}`,
    durationSec: 20 as const,
    options: [
      { id: `q${i}a`, label: "Bonne", isCorrect: true },
      { id: `q${i}b`, label: "Mauvaise", isCorrect: false },
    ],
  })),
  ...extra,
});

async function game(playerCount: number, definition: QuizDefinition) {
  const result = await setup(playerCount, definition);
  opened.push(result.host, ...result.players.map((p) => p.client));
  return result;
}

const sql = (code: string, query: string, ...bindings: unknown[]) =>
  runInDurableObject(stubFor(code), (_i, state) => void state.storage.sql.exec(query, ...bindings));

const abandon = (code: string) => sql(code, "UPDATE meta SET value = ? WHERE key = 'last_host_at'", String(Date.now() - PLAYER_TOKEN_TTL_MS - 1000));

describe("partie abandonnée", () => {
  it("est clôturée dans D1 avec ses joueurs avant toute purge", async () => {
    const { code, players } = await game(2, quiz(2));
    await abandon(code);
    await runDurableObjectAlarm(stubFor(code));
    expect((await sessionRow(sidFor(code)))?.status).toBe("ended");
    const report = await getSessionReport(getDb(env.DB), OWNER_ID, sidFor(code));
    expect(report?.players.map((p) => p.pseudo).sort()).toEqual(players.map((p) => p.pseudo).sort());
  });

  it("sans joueur ni réponse, passe quand même par l'écriture de bilan", async () => {
    const { code } = await game(0, quiz(1));
    await abandon(code);
    await runDurableObjectAlarm(stubFor(code));
    expect((await sessionRow(sidFor(code)))?.status).toBe("ended");
  });

  it("si D1 échoue, l'état est conservé et la clôture est reportée d'environ 1 h", async () => {
    const { code } = await game(1, quiz(1));
    const trace = await spyOnDatabase(code);
    trace.failBatch = true;
    await abandon(code);
    await runDurableObjectAlarm(stubFor(code));
    expect((await sessionRow(sidFor(code)))?.status).not.toBe("ended");
    expect(await sql(code, "SELECT 1")).toBeUndefined();
    const alarm = await runInDurableObject(stubFor(code), (_i, state) => state.storage.getAlarm());
    expect(alarm! - Date.now()).toBeGreaterThan(50 * 60 * 1000);
    expect(alarm! - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    trace.failBatch = false;
    await runDurableObjectAlarm(stubFor(code));
    expect((await sessionRow(sidFor(code)))?.status).toBe("ended");
  });
});

describe("mode libre : joueurs partis", () => {
  const expireDeadline = (code: string, playerId: string) => sql(code, "UPDATE pstate SET deadline = 1 WHERE player_id = ?", playerId);

  async function finishPlayer(client: Client, total: number) {
    for (let i = 0; i < total; i += 1) {
      client.send({ type: "answer", questionId: `q${i}`, optionIds: [`q${i}a`] });
      await client.waitFor("reveal", (m) => m.questionId === `q${i}`);
      client.send({ type: "next" });
    }
  }

  // Échéance de la question : le joueur passe en correction (jamais terminé directement), puis l'attente de correction
  // expire à son tour.
  async function expireTwice(code: string, playerId: string) {
    await expireDeadline(code, playerId);
    await runDurableObjectAlarm(stubFor(code));
    await expireDeadline(code, playerId);
    await runDurableObjectAlarm(stubFor(code));
  }

  it("un joueur déconnecté pendant sa question est terminé après l'attente de correction, garde ses points et débloque la fin", async () => {
    const { code, host, players } = await game(2, quiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    await Promise.all(players.map((p) => p.client.waitFor("question")));
    players[1]!.client.send({ type: "answer", questionId: "q0", optionIds: ["q0a"] });
    await players[1]!.client.waitFor("reveal");
    players[1]!.client.send({ type: "next" });
    await players[1]!.client.waitFor("question", (m) => m.index === 1);
    players[1]!.client.close();
    await finishPlayer(players[0]!.client, 2);
    await players[0]!.client.waitFor("snapshot", (m) => m.phase === "waiting");
    expect((await sessionRow(sidFor(code)))?.status).not.toBe("ended");

    await expireDeadline(code, players[1]!.playerId);
    await runDurableObjectAlarm(stubFor(code));
    // Première échéance : correction, pas la fin.
    expect((await sessionRow(sidFor(code)))?.status).not.toBe("ended");
    await expireDeadline(code, players[1]!.playerId);
    await runDurableObjectAlarm(stubFor(code));
    const finished = await host.waitFor("finished");
    expect(finished.ranking.find((r) => r.pseudo === players[1]!.pseudo)?.score).toBe(1);
    expect((await sessionRow(sidFor(code)))?.status).toBe("ended");
  });

  it("un joueur parti après avoir lu sa correction est terminé à l'expiration de son attente", async () => {
    const { code, host, players } = await game(2, quiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    await Promise.all(players.map((p) => p.client.waitFor("question")));
    players[1]!.client.send({ type: "answer", questionId: "q0", optionIds: ["q0a"] });
    await players[1]!.client.waitFor("reveal");
    players[1]!.client.close();
    await finishPlayer(players[0]!.client, 2);
    await expireDeadline(code, players[1]!.playerId);
    await runDurableObjectAlarm(stubFor(code));
    await host.waitFor("finished");
  });

  it("un joueur inscrit mais jamais connecté suit la même règle", async () => {
    const { code, host, players } = await game(1, quiz(1, { mode: "own_pace" }));
    const ghost = await (await import("./helpers")).join(code, "Fantome");
    expect(ghost.status).toBe(201);
    const { playerId } = (await ghost.json()) as { playerId: string };
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    await finishPlayer(players[0]!.client, 1);
    await players[0]!.client.waitFor("snapshot", (m) => m.phase === "waiting");
    expect((await sessionRow(sidFor(code)))?.status).not.toBe("ended");
    await expireTwice(code, playerId);
    await host.waitFor("finished");
  });

  it("téléphone verrouillé : socket fermé pendant la question, reconnexion avant 3 min, la partie continue", async () => {
    const { code, host, players } = await game(1, quiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    players[0]!.client.close();
    await expireDeadline(code, players[0]!.playerId);
    await runDurableObjectAlarm(stubFor(code));
    const [state] = await runInDurableObject(stubFor(code), (_i, st) => st.storage.sql.exec("SELECT phase FROM pstate").toArray() as { phase: string }[]);
    expect(state!.phase).toBe("revealed");
    const back = await connect(code, players[0]!.token);
    opened.push(back);
    back.send({ type: "resume" });
    await back.waitFor("snapshot");
    back.send({ type: "next" });
    expect(await back.waitFor("question", (m) => m.index === 1)).toMatchObject({ index: 1 });
    expect(host.messages.some((m) => m.type === "finished")).toBe(false);
  });

  it("un joueur encore connecté n'est pas écarté", async () => {
    const { code, host, players } = await game(1, quiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    await expireDeadline(code, players[0]!.playerId);
    await runDurableObjectAlarm(stubFor(code));
    await players[0]!.client.waitFor("reveal");
    expect(host.messages.some((m) => m.type === "finished")).toBe(false);
  });
});
