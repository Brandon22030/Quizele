import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/server/db/client";
import { getSessionReport } from "../../../src/server/db/results";
import type { QuizDefinition, QuizQuestion } from "../../../src/server/game/quiz";
import { shuffleSeeded } from "../../../src/server/game/shuffle";
import type { ServerMessage } from "../../../src/shared/protocol";
import { OWNER_ID, addPlayer, newCode, prepareDb, setup, sidFor, spyOnDatabase, stubFor, type Client, type Player } from "./helpers";

const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});

const makeQuestion = (i: number, kind: QuizQuestion["kind"] = "single"): QuizQuestion => ({
  id: `q${i}`,
  kind,
  prompt: `Question ${i}`,
  durationSec: 20,
  explanation: `Explication ${i}`,
  options: [
    { id: `q${i}a`, label: "Bonne", isCorrect: true },
    { id: `q${i}b`, label: "Mauvaise", isCorrect: false },
    { id: `q${i}c`, label: "Autre", isCorrect: false },
    { id: `q${i}d`, label: "Encore", isCorrect: false },
  ],
});

const makeQuiz = (count: number, extra: Partial<QuizDefinition> = {}): QuizDefinition => ({
  title: "Quiz de test",
  showCorrectAnswer: true,
  questions: Array.from({ length: count }, (_, i) => makeQuestion(i)),
  ...extra,
});

async function game(playerCount: number, quiz: QuizDefinition) {
  const result = await setup(playerCount, quiz);
  opened.push(result.host, ...result.players.map((p) => p.client));
  return result;
}

type Question = Extract<ServerMessage, { type: "question" }>;

// Joue toutes les questions d'un joueur en mode libre et renvoie l'ordre dans lequel il les a reçues.
async function playOwnPace(player: Player, total: number, correct: boolean): Promise<Question[]> {
  const seen: Question[] = [];
  for (let i = 0; i < total; i += 1) {
    const question = await player.client.waitFor("question", (m) => m.index === i);
    seen.push(question);
    const answer = correct ? `${question.questionId}a` : `${question.questionId}b`;
    player.client.send({ type: "answer", questionId: question.questionId, optionIds: [answer] });
    await player.client.waitFor("reveal", (m) => m.questionId === question.questionId);
    player.client.send({ type: "next" });
  }
  return seen;
}

const FORBIDDEN = /correct|explanation|reference|isCorrect/i;

describe("mode « Chacun à son rythme »", () => {
  it("partie libre complète : chacun avance seul, la fin est automatique, D1 reçoit le bilan", async () => {
    const { code, host, players } = await game(2, makeQuiz(3, { mode: "own_pace" }));
    host.send({ type: "start" });
    const running = await host.waitFor("snapshot", (m) => m.phase === "running");
    expect(running.mode).toBe("own_pace");

    const first = await playOwnPace(players[0]!, 3, true);
    expect(first.map((q) => q.questionId)).toEqual(["q0", "q1", "q2"]);
    // Le joueur 0 a fini : il attend, l'hôte voit la progression, la partie continue pour l'autre.
    const waiting = await players[0]!.client.waitFor("snapshot", (m) => m.phase === "waiting");
    expect(waiting.question).toBeUndefined();
    const progress = await host.waitFor("progress");
    expect(progress).toMatchObject({ finished: 1, total: 2 });
    expect(players[1]!.client.messages.some((m) => m.type === "finished")).toBe(false);

    await playOwnPace(players[1]!, 3, false);
    const finished = await players[0]!.client.waitFor("finished");
    expect(finished.ranking.map((r) => [r.pseudo, r.score])).toEqual([["Joueur 0", 3], ["Joueur 1", 0]]);
    expect(finished.you).toMatchObject({ rank: 1, score: 3 });
    expect((await players[1]!.client.waitFor("finished")).you).toMatchObject({ rank: 2, score: 0 });
    expect("you" in (await host.waitFor("finished"))).toBe(false);

    const report = await getSessionReport(getDb(env.DB), OWNER_ID, sidFor(code));
    expect(report?.session.status).toBe("ended");
    expect(report?.players.map((p) => [p.pseudo, p.score, p.rank])).toEqual([["Joueur 0", 3, 1], ["Joueur 1", 0, 2]]);
    expect(report?.stats.map((s) => [s.position, s.answerCount, s.correctCount])).toEqual([[0, 2, 1], [1, 2, 1], [2, 2, 1]]);
    expect(report?.stats[0]).toMatchObject({ correctLabels: ["Bonne"], distribution: { Bonne: 1, Mauvaise: 1, Autre: 0, Encore: 0 } });
  });

  it("aucune correction dans les messages d'une question, ni avant la réponse du joueur", async () => {
    const { host, players } = await game(1, makeQuiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    const question = await players[0]!.client.waitFor("question");
    expect(JSON.stringify(question)).not.toMatch(FORBIDDEN);
    const snapshots = players[0]!.client.raw.filter((raw) => raw.includes('"snapshot"'));
    expect(snapshots.filter((raw) => FORBIDDEN.test(raw))).toEqual([]);
    players[0]!.client.send({ type: "resume" });
    const resumed = await players[0]!.client.waitFor("snapshot", (m) => m.phase === "question");
    expect(JSON.stringify(resumed)).not.toMatch(FORBIDDEN);
  });

  it("correction masquée : la révélation personnelle ne porte ni correction ni résultat", async () => {
    const { host, players } = await game(1, makeQuiz(2, { mode: "own_pace", showCorrectAnswer: false }));
    host.send({ type: "start" });
    const question = await players[0]!.client.waitFor("question");
    players[0]!.client.send({ type: "answer", questionId: question.questionId, optionIds: [`${question.questionId}a`] });
    const reveal = await players[0]!.client.waitFor("reveal");
    expect(reveal).toEqual({ type: "reveal", questionId: question.questionId });
    players[0]!.client.send({ type: "resume" });
    const snapshot = await players[0]!.client.waitFor("snapshot", (m) => m.phase === "revealed");
    expect(JSON.stringify(snapshot)).not.toMatch(FORBIDDEN);
    expect(snapshot.me?.score).toBeUndefined();
  });

  it("la correction personnelle arrive dès la réponse quand elle est affichée", async () => {
    const { host, players } = await game(1, makeQuiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    const question = await players[0]!.client.waitFor("question");
    players[0]!.client.send({ type: "answer", questionId: question.questionId, optionIds: [`${question.questionId}b`] });
    const reveal = await players[0]!.client.waitFor("reveal");
    expect(reveal.correctOptionIds).toEqual([`${question.questionId}a`]);
    expect(reveal.you).toEqual({ wasCorrect: false, score: 0 });
  });

  it("le joueur ne peut avancer qu'après sa révélation, et l'hôte ne pilote pas les questions", async () => {
    const { host, players } = await game(1, makeQuiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    players[0]!.client.send({ type: "next" });
    expect((await players[0]!.client.waitFor("error")).code).toBe("wrong_phase");
    host.send({ type: "next" });
    expect((await host.waitFor("error")).code).toBe("wrong_phase");
    host.send({ type: "reveal" });
    expect((await host.waitFor("error", () => host.messages.filter((m) => m.type === "error").length >= 2)).code).toBe("wrong_phase");
  });

  it("à l'échéance (durée + tolérance), l'alarme révèle la question du joueur retardataire", async () => {
    const { code, host, players } = await game(2, makeQuiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    await Promise.all(players.map((p) => p.client.waitFor("question")));
    const question = await players[0]!.client.waitFor("question");
    players[1]!.client.send({ type: "answer", questionId: question.questionId, optionIds: [`${question.questionId}a`] });
    await players[1]!.client.waitFor("reveal");
    await runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec("UPDATE pstate SET deadline = deadline - 600000 WHERE phase = 'question'"));
    await runDurableObjectAlarm(stubFor(code));
    const reveal = await players[0]!.client.waitFor("reveal");
    expect(reveal.you).toEqual({ wasCorrect: false, score: 0 });
  });

  it("une réponse tardive en mode libre vaut 0 point et reste hors compteur", async () => {
    const { code, host, players } = await game(1, makeQuiz(1, { mode: "own_pace" }));
    host.send({ type: "start" });
    const question = await players[0]!.client.waitFor("question");
    await runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec("UPDATE pstate SET started_at = started_at - 600000"));
    players[0]!.client.send({ type: "answer", questionId: question.questionId, optionIds: [`${question.questionId}a`] });
    expect(await players[0]!.client.waitFor("answer_ack")).toMatchObject({ late: true });
    expect((await players[0]!.client.waitFor("reveal")).you).toEqual({ wasCorrect: false, score: 0 });
  });

  it("un joueur qui arrive en cours de partie commence sa propre série", async () => {
    const { code, host } = await game(1, makeQuiz(2, { mode: "own_pace" }));
    host.send({ type: "start" });
    await host.waitFor("snapshot", (m) => m.phase === "running");
    const late = await addPlayer(code, "Retardataire");
    opened.push(late.client);
    const snapshot = await late.client.waitFor("snapshot");
    expect(snapshot).toMatchObject({ phase: "question", question: { index: 0 } });
  });

  it("l'hôte peut terminer la partie : les joueurs en cours sont classés sur ce qu'ils ont fait", async () => {
    const { code, host, players } = await game(2, makeQuiz(3, { mode: "own_pace" }));
    host.send({ type: "start" });
    await playOwnPace(players[0]!, 1, true);
    host.send({ type: "end" });
    const finished = await players[1]!.client.waitFor("finished");
    expect(finished.ranking.map((r) => [r.pseudo, r.score])).toEqual([["Joueur 0", 1], ["Joueur 1", 0]]);
    expect((await getSessionReport(getDb(env.DB), OWNER_ID, sidFor(code)))?.session.status).toBe("ended");
  });

  it("retirer le dernier joueur en cours termine la partie quand tous les autres ont fini", async () => {
    const { host, players } = await game(2, makeQuiz(1, { mode: "own_pace" }));
    host.send({ type: "start" });
    await playOwnPace(players[0]!, 1, true);
    host.send({ type: "kick", playerId: players[1]!.playerId });
    const finished = await players[0]!.client.waitFor("finished");
    expect(finished.ranking.map((r) => r.pseudo)).toEqual(["Joueur 0"]);
  });
});

describe("mélange de l'ordre", () => {
  const ids = (list: { questionId: string }[]) => list.map((q) => q.questionId);
  const many = (seed: string, mode: QuizDefinition["mode"], shuffle = true) => makeQuiz(10, { mode, shuffle, seed });

  it("shuffleSeeded est déterministe et dépend de la graine", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(shuffleSeeded(items, "a")).toEqual(shuffleSeeded(items, "a"));
    expect(shuffleSeeded(items, "a")).not.toEqual(shuffleSeeded(items, "b"));
    expect([...shuffleSeeded(items, "a")].sort((x, y) => x - y)).toEqual(items);
    expect(shuffleSeeded(items, "a")).not.toEqual(items);
  });

  it("ensemble : un seul ordre pour toute la partie, partagé par l'hôte et les joueurs, reproductible par la graine", async () => {
    const orders: string[][] = [];
    for (const seed of ["graine-1", "graine-1", "graine-2"]) {
      const { host, players } = await game(1, many(seed, "together"));
      const order: string[] = [];
      host.send({ type: "start" });
      for (let i = 0; i < 10; i += 1) {
        const seenByHost = await host.waitFor("question", (m) => m.index === i);
        const seenByPlayer = await players[0]!.client.waitFor("question", (m) => m.index === i);
        expect(seenByPlayer.questionId).toBe(seenByHost.questionId);
        expect(seenByPlayer.options.map((o) => o.id)).toEqual(seenByHost.options.map((o) => o.id));
        order.push(seenByHost.questionId);
        host.send({ type: "reveal" });
        await host.waitFor("reveal", (m) => m.questionId === seenByHost.questionId);
        if (i < 9) host.send({ type: "next" });
      }
      orders.push(order);
    }
    expect(orders[0]).toEqual(orders[1]);
    expect(orders[0]).not.toEqual(orders[2]);
    expect(orders[0]).not.toEqual(Array.from({ length: 10 }, (_, i) => `q${i}`));
    expect([...orders[0]!].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `q${i}`).sort());
  });

  it("libre : un ordre par joueur, stable après reconnexion, chaque joueur voit toutes les questions", async () => {
    const { host, players } = await game(2, many("graine-libre", "own_pace"));
    host.send({ type: "start" });
    const first = await Promise.all(players.map((p) => p.client.waitFor("question")));
    // La reprise renvoie la même question dans le même ordre d'options.
    players[0]!.client.send({ type: "resume" });
    const resumed = await players[0]!.client.waitFor("snapshot", (m) => m.phase === "question");
    expect(resumed.question?.questionId).toBe(first[0]!.questionId);
    expect(resumed.question?.options.map((o) => o.id)).toEqual(first[0]!.options.map((o) => o.id));
    const [a, b] = await Promise.all(players.map((p) => playOwnPace(p, 10, true)));
    expect([...ids(a!)].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `q${i}`).sort());
    expect(ids(a!)).not.toEqual(ids(b!));
  });

  it("sans mélange, l'ordre du quiz est conservé dans les deux modes", async () => {
    const { host, players } = await game(1, many("x", "own_pace", false));
    host.send({ type: "start" });
    expect(ids(await playOwnPace(players[0]!, 10, true))).toEqual(Array.from({ length: 10 }, (_, i) => `q${i}`));
  });

  it("vrai/faux : l'ordre Vrai puis Faux n'est jamais mélangé", async () => {
    const trueFalse: QuizQuestion = {
      id: "tf",
      kind: "true_false",
      prompt: "Vrai ?",
      durationSec: 10,
      options: [
        { id: "tfa", label: "Vrai", isCorrect: true },
        { id: "tfb", label: "Faux", isCorrect: false },
      ],
    };
    const { host, players } = await game(1, makeQuiz(0, { questions: [trueFalse], mode: "own_pace", shuffle: true, seed: "tf" }));
    host.send({ type: "start" });
    const question = await players[0]!.client.waitFor("question");
    expect(question.options.map((o) => o.label)).toEqual(["Vrai", "Faux"]);
  });
});

describe("initialisation du Durable Object", () => {
  it("rejette un type de question inconnu avant tout stockage", async () => {
    const code = newCode();
    await prepareDb();
    const quiz = makeQuiz(1);
    const bad = { ...quiz, questions: [{ ...quiz.questions[0]!, kind: "text" }] } as unknown as QuizDefinition;
    expect(await initError(code, bad)).toMatch(/invalide/);
    expect(await runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec("SELECT name FROM sqlite_master").toArray())).toEqual([]);
  });

  it("rejette un quiz sans bonne réponse, avec trop d'options ou trop de questions", async () => {
    const code = newCode();
    const quiz = makeQuiz(1);
    const noCorrect = { ...quiz, questions: [{ ...quiz.questions[0]!, options: quiz.questions[0]!.options.map((o) => ({ ...o, isCorrect: false })) }] };
    const fiveOptions = { ...quiz, questions: [{ ...quiz.questions[0]!, options: [...quiz.questions[0]!.options, { id: "x", label: "X", isCorrect: false }] }] };
    for (const invalid of [noCorrect, fiveOptions, makeQuiz(51), makeQuiz(0)]) {
      expect(await initError(code, invalid)).not.toBeNull();
    }
  });

  it("une partie déjà initialisée n'est pas écrasée", async () => {
    const { code } = await game(0, makeQuiz(2));
    await stubFor(code).init(code, sidFor(code), makeQuiz(5));
    expect(await runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM questions").one())).toEqual({ n: 2 });
  });
});

// Le rejet est capté dans le Durable Object : une erreur qui traverse le RPC est signalée par le runtime comme non gérée.
async function initError(code: string, quiz: unknown): Promise<string | null> {
  return runInDurableObject(stubFor(code), async (instance) => {
    try {
      await instance.init(code, sidFor(code), quiz as QuizDefinition);
      return null;
    } catch (error) {
      return String(error);
    }
  });
}

// Remplace le binding D1 vu par le Durable Object par une enveloppe qui compte les batchs et peut échouer à la demande.
describe("écriture de fin de partie dans D1", () => {
  it("un seul batch, sous la limite de requêtes de l'offre gratuite, et aucune écriture pendant le jeu", { timeout: 90_000 }, async () => {
    const { code, host, players } = await game(30, makeQuiz(5));
    const trace = await spyOnDatabase(code);
    host.send({ type: "start" });
    for (let i = 0; i < 5; i += 1) {
      await host.waitFor("question", (m) => m.index === i);
      host.send({ type: "reveal" });
      await host.waitFor("reveal", (m) => m.questionId === `q${i}`);
      if (i < 4) {
        host.send({ type: "next" });
      }
    }
    expect(trace.batches).toEqual([]);
    host.send({ type: "next" });
    await host.waitFor("finished");
    expect(trace.batches).toHaveLength(1);
    expect(trace.prepared).toBeLessThan(50);
    expect(players).toHaveLength(30);
  });

  it("si D1 échoue, la partie n'est pas terminée et l'hôte peut réessayer", async () => {
    const { code, host, players } = await game(2, makeQuiz(1));
    const trace = await spyOnDatabase(code);
    host.send({ type: "start" });
    await host.waitFor("question");
    players[0]!.client.send({ type: "answer", questionId: "q0", optionIds: ["q0a"] });
    await players[0]!.client.waitFor("answer_ack");
    trace.failBatch = true;
    host.send({ type: "end" });
    expect((await host.waitFor("error")).code).toBe("save_failed");
    expect(host.messages.some((m) => m.type === "finished")).toBe(false);
    expect((await getSessionReport(getDb(env.DB), OWNER_ID, sidFor(code)))?.session.status).not.toBe("ended");
    trace.failBatch = false;
    host.send({ type: "end" });
    const finished = await host.waitFor("finished");
    expect(finished.ranking[0]).toMatchObject({ pseudo: "Joueur 0", score: 1 });
    expect((await getSessionReport(getDb(env.DB), OWNER_ID, sidFor(code)))?.session.status).toBe("ended");
  });

  it("deux commandes de fin simultanées n'écrivent qu'une fois", async () => {
    const { code, host } = await game(2, makeQuiz(1));
    const trace = await spyOnDatabase(code);
    host.send({ type: "end" });
    host.send({ type: "end" });
    await host.waitFor("finished");
    // Le doublon est refusé, que la première écriture soit encore en cours ou déjà finie.
    await host.waitFor("error");
    expect(trace.batches).toHaveLength(1);
  });

  it("une partie terminée ne peut plus être terminée ni modifiée", async () => {
    const { host } = await game(1, makeQuiz(1));
    host.send({ type: "end" });
    await host.waitFor("finished");
    host.send({ type: "end" });
    expect((await host.waitFor("error")).code).toBe("wrong_phase");
  });
});
