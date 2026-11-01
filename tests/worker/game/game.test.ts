import { runDurableObjectAlarm, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { ANSWER_TOLERANCE_MS } from "../../../src/shared/protocol";
import {
  closeCodeOf, connect, demoQuiz, join, newCode, rawConnect, rewindQuestion, setup, signFor, stubFor, withoutCorrection,
  type Client,
} from "./helpers";

const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});

async function game(playerCount: number, quiz?: typeof demoQuiz) {
  const result = await setup(playerCount, quiz);
  opened.push(result.host, ...result.players.map((p) => p.client));
  return result;
}

const Q1_CORRECT = "q1b";
const FORBIDDEN_BEFORE_REVEAL = /correct|explanation|reference|isCorrect/i;

describe("jetons et connexion", () => {
  it("refuse un jeton absent, falsifié, expiré, d'une autre partie, ou un hôte inconnu", async () => {
    const code = newCode();
    const valid = await signFor(code, { code, role: "host" });
    expect((await rawConnect(code, null)).status).toBe(401);
    expect((await rawConnect(code, `${valid}x`)).status).toBe(401);
    const signature = valid.split(".")[1];
    const forged = `${btoa(JSON.stringify({ c: code, r: "host", e: Date.now() + 1e9 })).replace(/=+$/, "")}.${signature}`;
    expect((await rawConnect(code, forged)).status).toBe(401);
    // Jeton bien signé mais expiré : refus définitif (4001) pour que le client cesse de se reconnecter.
    expect(await closeCodeOf(code, await signFor(code, { code, role: "host" }, Date.now() - 10_000, 1000))).toBe(4001);
    const other = newCode();
    expect((await rawConnect(code, await signFor(other, { code: other, role: "host" }))).status).toBe(401);
  });

  it("refuse l'upgrade absent (426), un code invalide (404) et une partie inexistante pour un joueur", async () => {
    const code = newCode();
    const res = await (await import("cloudflare:workers")).exports.default.fetch(`https://exemple.test/ws/${code}`);
    expect(res.status).toBe(426);
    expect((await rawConnect("ab", "x")).status).toBe(404);
    const playerToken = await signFor(code, { code, role: "player", playerId: "inconnu" });
    expect(await closeCodeOf(code, playerToken)).toBe(4004);
  });

  it("un jeton joueur d'une autre partie est refusé même avec un joueur valide ailleurs", async () => {
    const a = await game(1);
    const b = await game(0);
    const response = await rawConnect(b.code, a.players[0]!.token);
    expect(response.status).toBe(401);
  });

  it("refuse un joueur au jeton valide mais absent de la partie (4001)", async () => {
    const { code } = await game(0);
    expect(await closeCodeOf(code, await signFor(code, { code, role: "player", playerId: "fantome" }))).toBe(4001);
  });
});

describe("page de démonstration", () => {
  it("n'existe pas dans le bundle de production (404)", async () => {
    const res = await (await import("cloudflare:workers")).exports.default.fetch("https://exemple.test/dev/prototype?role=host");
    expect(res.status).toBe(404);
  });
});

describe("pseudos", () => {
  it("trim, 1 à 20 caractères, unique sans tenir compte de la casse", async () => {
    const { code } = await game(0);
    expect((await join(code, "   ")).status).toBe(400);
    expect((await join(code, "x".repeat(21))).status).toBe(400);
    expect((await join(code, "  Awa  ")).status).toBe(201);
    expect((await join(code, "AWA")).status).toBe(409);
    expect((await join(code, "x".repeat(20))).status).toBe(201);
  });

  it("répond 404 pour une partie qui n'existe pas", async () => {
    expect((await join(newCode(), "Awa")).status).toBe(404);
  });
});

describe("partie de 50 joueurs", () => {
  it("diffuse la question à tous, compte 50 réponses, classe correctement, sans fuite avant reveal", async () => {
    const { code, host, players } = await game(50);
    expect(players).toHaveLength(50);
    host.send({ type: "start" });
    const questions = await Promise.all(players.map((p) => p.client.waitFor("question")));
    expect(questions.every((q) => q.questionId === "q1" && q.durationMs === 20_000 && q.serverNow >= q.startedAt)).toBe(true);
    expect(questions[0]!.options.every((o) => Object.keys(o).sort().join() === "id,label")).toBe(true);

    // 50 réponses dans la même seconde : les 25 premiers joueurs ont juste.
    players.forEach((p, i) => p.client.send({ type: "answer", questionId: "q1", optionIds: [i < 25 ? Q1_CORRECT : "q1a"] }));
    await Promise.all(players.map((p) => p.client.waitFor("answer_ack")));
    const lastCount = await host.waitFor("answer_count", (m) => m.count === 50);
    expect(lastCount.total).toBe(50);

    // Aucun message destiné aux joueurs, ni à l'écran, ne porte de correction avant la révélation.
    for (const p of players) expect(p.client.raw.filter((raw) => FORBIDDEN_BEFORE_REVEAL.test(raw))).toEqual([]);

    // Double réponse : comptée une seule fois, la première est conservée.
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    await players[0]!.client.waitFor("answer_ack", (m) => m.duplicate);

    host.send({ type: "reveal" });
    const reveals = await Promise.all(players.map((p) => p.client.waitFor("reveal")));
    expect(reveals.filter((r) => r.you?.wasCorrect)).toHaveLength(25);
    expect(reveals[0]!.you).toMatchObject({ wasCorrect: true, score: 1 });
    expect(reveals[49]!.you).toMatchObject({ wasCorrect: false, score: 0 });
    expect(reveals[0]!.correctOptionIds).toEqual([Q1_CORRECT]);
    expect(reveals[0]!.ranking).toHaveLength(10);
    expect(reveals[0]!.ranking!.every((r) => r.score === 1)).toBe(true);
    const hostReveal = await host.waitFor("reveal");
    expect(hostReveal.ranking!.filter((r) => r.score === 1)).toHaveLength(10);

    const stub = stubFor(code);
    const rows = await runInDurableObject(stub, (_i, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM answers").one().n);
    expect(rows).toBe(50);
  });
});

describe("règles de réponse", () => {
  it("choix multiple : ensemble exact seulement", async () => {
    const { host, players } = await game(3);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    host.send({ type: "reveal" });
    await players[0]!.client.waitFor("reveal");
    host.send({ type: "next" });
    await Promise.all(players.map((p) => p.client.waitFor("question", (q) => q.questionId === "q2")));
    const sets = [["q2a", "q2c"], ["q2a"], ["q2a", "q2b", "q2c"]];
    players.forEach((p, i) => p.client.send({ type: "answer", questionId: "q2", optionIds: sets[i]! }));
    await Promise.all(players.map((p) => p.client.waitFor("answer_ack", (m) => m.questionId === "q2")));
    host.send({ type: "reveal" });
    const reveals = await Promise.all(players.map((p) => p.client.waitFor("reveal", (r) => r.questionId === "q2")));
    expect(reveals.map((r) => r.you?.wasCorrect)).toEqual([true, false, false]);
  });

  it("réponse tardive : acceptée dans la tolérance, fausse au-delà", async () => {
    const { code, host, players } = await game(2);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    await rewindQuestion(code, 20_000 + ANSWER_TOLERANCE_MS - 500);
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: [Q1_CORRECT] });
    expect(await players[0]!.client.waitFor("answer_ack")).toMatchObject({ late: false });
    await rewindQuestion(code, 1500);
    players[1]!.client.send({ type: "answer", questionId: "q1", optionIds: [Q1_CORRECT] });
    expect(await players[1]!.client.waitFor("answer_ack")).toMatchObject({ late: true });
    host.send({ type: "reveal" });
    const [a, b] = await Promise.all(players.map((p) => p.client.waitFor("reveal")));
    expect(a!.you?.wasCorrect).toBe(true);
    expect(b!.you?.wasCorrect).toBe(false);
  });

  it("refuse les messages invalides, les rôles interdits et les options inconnues", async () => {
    const { host, players } = await game(1);
    const player = players[0]!.client;
    player.send({ type: "start" });
    await player.waitFor("error", (m) => m.code === "forbidden");
    host.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    await host.waitFor("error", (m) => m.code === "forbidden");
    player.ws.send("pas du json");
    await player.waitFor("error", (m) => m.code === "invalid_message");
    // Aucun champ de texte libre : un message qui en porte un est rejeté.
    player.ws.send(JSON.stringify({ type: "answer", questionId: "q1", optionIds: ["q1a"], text: "libre" }));
    await player.waitFor("error", (m) => m.code === "invalid_message");
    player.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    await player.waitFor("error", (m) => m.code === "wrong_phase");
    host.send({ type: "next" });
    await host.waitFor("error", (m) => m.code === "wrong_phase");
    host.send({ type: "start" });
    await player.waitFor("question");
    player.send({ type: "answer", questionId: "q9", optionIds: ["q1a"] });
    await player.waitFor("error", (m) => m.code === "unknown_question");
    player.send({ type: "answer", questionId: "q1", optionIds: ["zzz"] });
    await player.waitFor("error", (m) => m.code === "invalid_options");
  });

  it("n'envoie la correction ni aux joueurs ni à l'écran quand show_correct_answer est faux", async () => {
    const { code, host, players } = await game(1, withoutCorrection);
    const screen = await connect(code, await signFor(code, { code, role: "screen" }));
    opened.push(screen);
    screen.send({ type: "resume" });
    await screen.waitFor("snapshot");
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    host.send({ type: "reveal" });
    const reveal = await players[0]!.client.waitFor("reveal");
    expect(reveal.correctOptionIds).toBeUndefined();
    expect(reveal.explanation).toBeUndefined();
    expect(reveal.reference).toBeUndefined();
    const screenReveal = await screen.waitFor("reveal");
    expect(screenReveal.correctOptionIds).toBeUndefined();
    const hostReveal = await host.waitFor("reveal");
    expect(hostReveal.correctOptionIds).toEqual([Q1_CORRECT]);
    expect(players[0]!.client.raw.some((raw) => /q1b.*"correctOptionIds"|"correctOptionIds"/.test(raw))).toBe(false);
  });
});

describe("alarme, reprise et éviction", () => {
  it("programme une alarme au lancement et révèle quand elle sonne après le délai", async () => {
    const { code, host, players } = await game(1);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    const stub = stubFor(code);
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).not.toBeNull();

    // Alarme avant l'échéance : sans effet, elle se reprogramme.
    await runDurableObjectAlarm(stub);
    expect(players[0]!.client.messages.some((m) => m.type === "reveal")).toBe(false);

    await rewindQuestion(code, 20_000 + ANSWER_TOLERANCE_MS + 100);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await players[0]!.client.waitFor("reveal")).questionId).toBe("q1");
    expect((await host.waitFor("reveal")).correctOptionIds).toEqual([Q1_CORRECT]);
  });

  it("reprise après fermeture du socket : instantané complet et réponse en double comptée une fois", async () => {
    const { code, host, players } = await game(2);
    host.send({ type: "start" });
    const first = players[0]!;
    await first.client.waitFor("question");
    first.client.send({ type: "answer", questionId: "q1", optionIds: [Q1_CORRECT] });
    await first.client.waitFor("answer_ack");
    first.client.close();

    const back = await connect(code, first.token);
    opened.push(back);
    back.send({ type: "resume" });
    const snapshot = await back.waitFor("snapshot");
    expect(snapshot).toMatchObject({ role: "player", phase: "question", me: { answered: true, answeredOptionIds: [Q1_CORRECT], score: 0 } });
    expect(snapshot.question?.questionId).toBe("q1");
    expect(snapshot.question!.serverNow).toBeGreaterThanOrEqual(snapshot.question!.startedAt);
    expect(JSON.stringify(snapshot)).not.toMatch(FORBIDDEN_BEFORE_REVEAL);

    back.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    expect(await back.waitFor("answer_ack")).toMatchObject({ duplicate: true });
    host.send({ type: "reveal" });
    expect((await back.waitFor("reveal")).you).toMatchObject({ wasCorrect: true, score: 1 });
  });

  it("l'instantané de l'hôte porte le compteur et la liste des joueurs", async () => {
    const { host, players } = await game(2);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    await host.waitFor("answer_count", (m) => m.count === 1);
    host.send({ type: "resume" });
    const snapshots = host.messages.filter((m) => m.type === "snapshot");
    await host.waitFor("snapshot", (m) => m.phase === "question");
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const last = host.messages.filter((m) => m.type === "snapshot").at(-1);
    expect(last).toMatchObject({ phase: "question", answeredCount: 1, playerCount: 2 });
    expect(last?.type === "snapshot" && last.players).toHaveLength(2);
  });

  it("reconstruit tout l'état sur une nouvelle instance après éviction (sockets hibernés)", async () => {
    const { code, host, players } = await game(2);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: [Q1_CORRECT] });
    await players[0]!.client.waitFor("answer_ack");

    const stub = stubFor(code);
    await evictDurableObject(stub);

    players[1]!.client.send({ type: "resume" });
    const snapshot = await players[1]!.client.waitFor("snapshot", (m) => m.phase === "question" && m.me?.pseudo === "Joueur 1" && m.question !== undefined);
    expect(snapshot.me?.answered).toBe(false);
    players[1]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    await players[1]!.client.waitFor("answer_ack");
    host.send({ type: "reveal" });
    const reveal = await players[0]!.client.waitFor("reveal");
    expect(reveal.you).toMatchObject({ wasCorrect: true, score: 1 });
    const versions = await runInDurableObject(stub, (_i, state) => state.storage.sql.exec("SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_version").one());
    // Deux migrations (schéma initial, puis bannis et seaux), chacune appliquée une seule fois.
    expect(versions).toEqual({ n: 2, v: 2 });
  });
});

describe("partie complète", () => {
  it("va jusqu'au classement final, refuse les nouveaux joueurs ensuite", async () => {
    const { code, host, players } = await game(2);
    host.send({ type: "start" });
    for (const [index, question] of demoQuiz.questions.entries()) {
      await players[0]!.client.waitFor("question", (q) => q.questionId === question.id);
      const good = question.options.filter((o) => o.isCorrect).map((o) => o.id);
      players[0]!.client.send({ type: "answer", questionId: question.id, optionIds: good });
      await players[0]!.client.waitFor("answer_ack", (m) => m.questionId === question.id);
      host.send({ type: "reveal" });
      await players[0]!.client.waitFor("reveal", (r) => r.questionId === question.id);
      host.send({ type: "next" });
      if (index === demoQuiz.questions.length - 1) break;
    }
    const finished = await players[1]!.client.waitFor("finished");
    expect(finished.ranking.map((r) => [r.pseudo, r.score])).toEqual([["Joueur 0", 3], ["Joueur 1", 0]]);
    expect((await join(code, "Retard")).status).toBe(410);
    expect(await runInDurableObject(stubFor(code), (_i, state) => state.storage.getAlarm())).not.toBeNull();
  });

  it("purge l'état 24 h après la fin", async () => {
    const { code, host, players } = await game(1);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    host.send({ type: "reveal" });
    host.send({ type: "next" });
    for (let i = 0; i < 2; i += 1) {
      await host.waitFor("question", (q) => q.index === i + 1);
      host.send({ type: "reveal" });
      await host.waitFor("reveal", (r) => r.questionId === demoQuiz.questions[i + 1]!.id);
      host.send({ type: "next" });
    }
    await host.waitFor("finished");
    const stub = stubFor(code);
    await runInDurableObject(stub, (_i, state) => state.storage.sql.exec("UPDATE meta SET value = '1' WHERE key = 'finished_at'"));
    await runDurableObjectAlarm(stub);
    const left = await runInDurableObject(stub, (_i, state) => state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'meta'").toArray());
    expect(left).toEqual([]);
  });
});
