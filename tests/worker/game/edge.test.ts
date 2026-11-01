import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { ANSWER_TOLERANCE_MS, MAX_PLAYERS } from "../../../src/shared/protocol";
import {
  addPlayer, closeCodeOf, createGame, connect, join, newCode, rawConnect, rewindQuestion, setup, signFor, stubFor, withoutCorrection,
  type Client,
} from "./helpers";

const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});

async function game(playerCount: number, quiz?: Parameters<typeof setup>[1]) {
  const result = await setup(playerCount, quiz);
  opened.push(result.host, ...result.players.map((p) => p.client));
  return result;
}

const sqlOf = <T>(code: string, query: string): Promise<T[]> =>
  runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec(query).toArray() as T[]);

const CORRECTION = /correct|explanation|reference|isCorrect/i;

describe("plafond de joueurs", () => {
  it(`accepte ${MAX_PLAYERS} joueurs puis refuse le suivant (409 game_full) sans rien écrire`, async () => {
    const { code } = await game(0);
    const stub = stubFor(code);
    for (let i = 0; i < MAX_PLAYERS; i += 1) expect((await stub.join(`P${i}`)).ok).toBe(true);
    const response = await join(code, "Trop tard");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "game_full" });
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM players")).toEqual([{ n: MAX_PLAYERS }]);
    // Un pseudo invalide reste 400 même partie pleine ; un pseudo déjà pris reste refusé.
    expect((await join(code, "   ")).status).toBe(400);
    expect((await join(code, "P0")).status).toBe(409);
  }, 60_000);

  it("inscriptions concurrentes à la limite : jamais plus de 200 joueurs", async () => {
    const { code } = await game(0);
    const stub = stubFor(code);
    for (let i = 0; i < MAX_PLAYERS - 3; i += 1) await stub.join(`P${i}`);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => join(code, `Course ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM players")).toEqual([{ n: MAX_PLAYERS }]);
  }, 60_000);
});

describe("pseudos : cas limites", () => {
  it("vide, 21 caractères, espaces seuls, corps invalide", async () => {
    const { code } = await game(0);
    expect((await join(code, "")).status).toBe(400);
    expect((await join(code, " ".repeat(5))).status).toBe(400);
    expect((await join(code, "\t\n ")).status).toBe(400);
    expect((await join(code, "a".repeat(21))).status).toBe(400);
    expect((await join(code, `  ${"a".repeat(21)}  `)).status).toBe(400);
    expect((await join(code, `  ${"a".repeat(20)}  `)).status).toBe(201);
    const bad = (body: unknown) =>
      stubFetch(code, typeof body === "string" ? body : JSON.stringify(body));
    expect((await bad("pas du json")).status).toBe(400);
    expect((await bad({})).status).toBe(400);
    expect((await bad({ pseudo: 42 })).status).toBe(400);
    expect((await bad({ pseudo: null })).status).toBe(400);
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM players")).toEqual([{ n: 1 }]);
  });

  it("doublon en casse différente, accents compris, et avec espaces autour", async () => {
    const { code } = await game(0);
    expect((await join(code, "Éloïse")).status).toBe(201);
    expect((await join(code, "éLOÏSE")).status).toBe(409);
    expect((await join(code, "  ÉLOÏSE ")).status).toBe(409);
    expect((await join(code, "Eloise")).status).toBe(201);
  });

  it("inscriptions simultanées du même pseudo en casses différentes : une seule gagne", async () => {
    const { code } = await game(0);
    const results = await Promise.all(["Awa", "AWA", "awa", "aWa", " awa "].map((p) => join(code, p)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });

  it("Unicode et emoji : acceptés, restitués à l'identique, sans fuite d'injection", async () => {
    const { code, host } = await game(0);
    for (const pseudo of ["Ñandú", "李雷", "Zoë-Ève", "😀", "👨‍👩‍👧", "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉", "<b>x</b>", "x'); DROP TABLE--"]) {
      expect((await join(code, pseudo)).status, pseudo).toBe(201);
    }
    host.send({ type: "resume" });
    const snapshot = await host.waitFor("snapshot", (m) => (m.players?.length ?? 0) === 8);
    expect(snapshot.players?.map((p) => p.pseudo)).toContain("👨‍👩‍👧");
    expect(snapshot.players?.map((p) => p.pseudo)).toContain("x'); DROP TABLE--");
    expect((await join(code, "😀")).status).toBe(409);
  });
});

async function stubFetch(code: string, body: string): Promise<Response> {
  const { exports } = await import("cloudflare:workers");
  return exports.default.fetch(`https://exemple.test/api/parties/${code}/joueurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("inscription sur un code inconnu", () => {
  it("renvoie 404 et ne crée aucune ligne persistante", async () => {
    const code = newCode();
    const response = await join(code, "Awa");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "game_not_found" });
    // Aucune table du tout, pas seulement des tables sans ligne.
    expect(await sqlOf(code, "SELECT name FROM sqlite_master")).toEqual([]);
    expect(await runInDurableObject(stubFor(code), (_i, state) => state.storage.getAlarm())).toBeNull();
  });

  it("codes mal formés : 404 sans toucher au Durable Object", async () => {
    for (const bad of ["abc", "ABCDEFG", "AB CD1", "%00%00%00", "ÉÉÉÉÉÉ"]) {
      expect((await join(bad, "Awa")).status, bad).toBe(404);
    }
  });

  it("aucun jeton, pas même celui de l'hôte, ne crée la partie : seul le lancement la crée, et une tentative échouée ne l'empêche pas d'exister ensuite", async () => {
    const code = newCode();
    expect(await closeCodeOf(code, await signFor(code, { code, role: "screen" }))).toBe(4004);
    expect(await closeCodeOf(code, await signFor(code, { code, role: "player", playerId: "x" }))).toBe(4004);
    expect(await closeCodeOf(code, await signFor(code, { code, role: "host" }))).toBe(4004);
    expect(await sqlOf(code, "SELECT name FROM sqlite_master")).toEqual([]);
    await createGame(code);
    const host = await connect(code, await signFor(code, { code, role: "host" }));
    opened.push(host);
    expect((await join(code, "Awa")).status).toBe(201);
  });
});

describe("jetons : cas limites", () => {
  it("jeton joueur expiré refusé à la connexion, même pour un joueur existant", async () => {
    const { code, players } = await game(1);
    const expired = await signFor(code, { code, role: "player", playerId: players[0]!.playerId }, Date.now() - 10_000, 1_000);
    expect(await closeCodeOf(code, expired)).toBe(4001);
    const justValid = await signFor(code, { code, role: "player", playerId: players[0]!.playerId }, Date.now(), 60_000);
    const client = await connect(code, justValid);
    opened.push(client);
  });

  it("jeton joueur sans playerId, jeton au rôle inconnu, morceaux manquants : 401", async () => {
    const { code } = await game(0);
    expect((await rawConnect(code, await signFor(code, { code, role: "player" }))).status).toBe(401);
    for (const token of ["", ".", "a.b", "a.b.c", "....", "%%%.%%%"]) {
      expect((await rawConnect(code, token)).status, token).toBe(401);
    }
  });

  it("jeton d'une autre partie, hôte, écran et joueur : 401", async () => {
    const a = await game(1);
    const b = await game(0);
    for (const role of ["host", "screen"] as const) {
      expect((await rawConnect(b.code, await signFor(a.code, { code: a.code, role }))).status).toBe(401);
    }
    expect((await rawConnect(b.code, a.players[0]!.token)).status).toBe(401);
  });

  it("le code de l'URL est insensible à la casse mais le jeton reste lié au code", async () => {
    const { code } = await game(0);
    const response = await rawConnect(code.toLowerCase(), await signFor(code, { code, role: "screen" }));
    expect(response.status).toBe(101);
    response.webSocket!.accept();
    response.webSocket!.close(1000);
  });

  it("un joueur ne peut lancer ni start, ni reveal, ni next : l'état ne bouge pas", async () => {
    const { code, host, players } = await game(1);
    const player = players[0]!.client;
    for (const type of ["start", "reveal", "next"] as const) {
      player.send({ type });
    }
    await player.waitFor("error", () => player.messages.filter((m) => m.type === "error").length === 3);
    expect(player.messages.filter((m) => m.type === "error").map((m) => (m.type === "error" ? m.code : ""))).toEqual(["forbidden", "forbidden", "forbidden"]);
    expect(await sqlOf(code, "SELECT value FROM meta WHERE key = 'phase'")).toEqual([{ value: "lobby" }]);

    host.send({ type: "start" });
    await player.waitFor("question");
    player.send({ type: "reveal" });
    player.send({ type: "next" });
    await player.waitFor("error", (m) => m.code === "forbidden");
    expect(await sqlOf(code, "SELECT value FROM meta WHERE key = 'phase'")).toEqual([{ value: "question" }]);
    expect(player.messages.some((m) => m.type === "reveal")).toBe(false);
  });

  it("un écran ne peut ni répondre ni commander", async () => {
    const { code, host, players } = await game(1);
    const screen = await connect(code, await signFor(code, { code, role: "screen" }));
    opened.push(screen);
    host.send({ type: "start" });
    await screen.waitFor("question");
    screen.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    screen.send({ type: "reveal" });
    screen.send({ type: "next" });
    screen.send({ type: "start" });
    await screen.waitForCount("error", 4);
    const codes = screen.messages.filter((m) => m.type === "error").map((m) => (m.type === "error" ? m.code : ""));
    expect(codes).toEqual(["forbidden", "forbidden", "forbidden", "forbidden"]);
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM answers")).toEqual([{ n: 0 }]);
    expect(await sqlOf(code, "SELECT value FROM meta WHERE key = 'phase'")).toEqual([{ value: "question" }]);
    expect(players[0]!.client.messages.some((m) => m.type === "reveal")).toBe(false);
  });

  it("une nouvelle connexion du même joueur remplace l'ancienne (pas de socket zombie)", async () => {
    const { code, players } = await game(1);
    const closed = new Promise<CloseEvent>((resolve) => players[0]!.client.ws.addEventListener("close", resolve));
    const second = await connect(code, players[0]!.token);
    opened.push(second);
    expect((await closed).code).toBe(1000);
  });
});

describe("réponses : cas limites", () => {
  const start = async (playerCount = 1, quiz?: Parameters<typeof setup>[1]) => {
    const g = await game(playerCount, quiz);
    g.host.send({ type: "start" });
    await Promise.all(g.players.map((p) => p.client.waitFor("question")));
    return g;
  };
  const answerAndAck = async (client: Client, questionId: string, optionIds: string[]) => {
    const before = client.messages.filter((m) => m.type === "answer_ack").length;
    client.send({ type: "answer", questionId, optionIds });
    await client.waitFor("answer_ack", () => client.messages.filter((m) => m.type === "answer_ack").length > before);
    return client.messages.filter((m) => m.type === "answer_ack")[before]!;
  };

  it("juste avant la limite (durée + 2 s - 1,5 s) : acceptée et juste ; après (+ 1,5 s) : tardive et fausse", async () => {
    const { code, host, players } = await start(2);
    await rewindQuestion(code, 20_000 + ANSWER_TOLERANCE_MS - 1_500);
    expect(await answerAndAck(players[0]!.client, "q1", ["q1b"])).toMatchObject({ late: false, duplicate: false });
    await rewindQuestion(code, 3_000);
    expect(await answerAndAck(players[1]!.client, "q1", ["q1b"])).toMatchObject({ late: true, duplicate: false });
    host.send({ type: "reveal" });
    const reveals = await Promise.all(players.map((p) => p.client.waitFor("reveal")));
    expect(reveals.map((r) => r.you?.wasCorrect)).toEqual([true, false]);
    expect(reveals[1]!.you?.score).toBe(0);
    const rows = await sqlOf<{ late: number; correct: number; elapsed_ms: number }>(code, "SELECT late, correct, elapsed_ms FROM answers ORDER BY received_at");
    expect(rows.map((r) => r.late)).toEqual([0, 1]);
    // Le temps retenu ne dépasse jamais la durée de la question.
    expect(rows.every((r) => r.elapsed_ms <= 20_000)).toBe(true);
  });

  it("réponse en double : la première est gardée même si la seconde est juste", async () => {
    const { code, host, players } = await start(1);
    const client = players[0]!.client;
    expect(await answerAndAck(client, "q1", ["q1a"])).toMatchObject({ duplicate: false });
    expect(await answerAndAck(client, "q1", ["q1b"])).toMatchObject({ duplicate: true });
    expect(await answerAndAck(client, "q1", ["q1b"])).toMatchObject({ duplicate: true });
    expect(await sqlOf(code, "SELECT option_ids FROM answers")).toEqual([{ option_ids: '["q1a"]' }]);
    host.send({ type: "reveal" });
    expect((await client.waitFor("reveal")).you).toMatchObject({ wasCorrect: false, score: 0 });
    const counts = host.messages.filter((m) => m.type === "answer_count");
    expect(counts).toHaveLength(1);
  });

  it("réponses en rafale du même joueur (même tick) : une seule ligne", async () => {
    const { code, players } = await start(1);
    const client = players[0]!.client;
    for (let i = 0; i < 20; i += 1) client.send({ type: "answer", questionId: "q1", optionIds: [i % 2 ? "q1a" : "q1b"] });
    await client.waitFor("answer_ack", () => client.messages.filter((m) => m.type === "answer_ack").length === 20);
    expect(await sqlOf(code, "SELECT option_ids FROM answers")).toEqual([{ option_ids: '["q1b"]' }]);
  });

  it("ids d'options inexistants ou d'une autre question : rejetés sans enregistrement", async () => {
    const { code, players } = await start(1);
    const client = players[0]!.client;
    const expectError = async (optionIds: string[], questionId = "q1") => {
      const before = client.messages.filter((m) => m.type === "error").length;
      client.send({ type: "answer", questionId, optionIds });
      await client.waitFor("error", () => client.messages.filter((m) => m.type === "error").length > before);
      return client.messages.filter((m) => m.type === "error")[before];
    };
    expect(await expectError(["q2a"])).toMatchObject({ code: "invalid_options" });
    expect(await expectError(["q1b", "q2a"])).toMatchObject({ code: "invalid_options" });
    expect(await expectError(["Q1B"])).toMatchObject({ code: "invalid_options" });
    expect(await expectError(["q1b "])).toMatchObject({ code: "invalid_options" });
    expect(await expectError(["q1b"], "q2")).toMatchObject({ code: "unknown_question" });
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM answers")).toEqual([{ n: 0 }]);
    // Le joueur peut encore répondre correctement ensuite.
    expect(await answerAndAck(client, "q1", ["q1b"])).toMatchObject({ duplicate: false });
  });

  it("liste vide, trop longue, non-chaînes, champ texte en trop : invalid_message, rien d'enregistré", async () => {
    const { code, players } = await start(1);
    const client = players[0]!.client;
    const payloads: unknown[] = [
      { type: "answer", questionId: "q1", optionIds: [] },
      { type: "answer", questionId: "q1", optionIds: Array.from({ length: 9 }, (_, i) => `o${i}`) },
      { type: "answer", questionId: "q1", optionIds: [1] },
      { type: "answer", questionId: "q1", optionIds: [""] },
      { type: "answer", questionId: "q1", optionIds: "q1b" },
      { type: "answer", questionId: "q1" },
      { type: "answer", optionIds: ["q1b"] },
      { type: "answer", questionId: "q1", optionIds: ["q1b"], text: "libre" },
      { type: "answer", questionId: "q1", optionIds: ["q1b"], answer: "libre" },
      { type: "answer", questionId: "q1", optionIds: ["q1b"], __proto__x: 1 },
      { type: "inconnu" },
      [],
      null,
      "chaine",
    ];
    for (const payload of payloads) client.ws.send(JSON.stringify(payload));
    client.ws.send(new Uint8Array([1, 2, 3]));
    await client.waitFor("error", () => client.messages.filter((m) => m.type === "error").length >= payloads.length + 1 - 1);
    const errors = client.messages.filter((m) => m.type === "error");
    expect(errors.every((m) => m.type === "error" && m.code === "invalid_message")).toBe(true);
    expect(client.messages.some((m) => m.type === "answer_ack")).toBe(false);
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM answers")).toEqual([{ n: 0 }]);
  });

  it("choix unique : plusieurs options ou doublons d'id sont faux ; multiple partiel ou excédentaire faux", async () => {
    const { host, players } = await start(3);
    await Promise.all([
      answerAndAck(players[0]!.client, "q1", ["q1b", "q1b"]),
      answerAndAck(players[1]!.client, "q1", ["q1b", "q1a"]),
      answerAndAck(players[2]!.client, "q1", ["q1b"]),
    ]);
    host.send({ type: "reveal" });
    const reveals = await Promise.all(players.map((p) => p.client.waitFor("reveal")));
    expect(reveals.map((r) => r.you?.wasCorrect)).toEqual([false, false, true]);

    host.send({ type: "next" });
    await Promise.all(players.map((p) => p.client.waitFor("question", (q) => q.questionId === "q2")));
    await Promise.all([
      answerAndAck(players[0]!.client, "q2", ["q2a", "q2a"]),
      answerAndAck(players[1]!.client, "q2", ["q2c"]),
      answerAndAck(players[2]!.client, "q2", ["q2c", "q2a"]),
    ]);
    host.send({ type: "reveal" });
    const second = await Promise.all(players.map((p) => p.client.waitFor("reveal", (r) => r.questionId === "q2")));
    expect(second.map((r) => r.you?.wasCorrect)).toEqual([false, false, true]);
  });

  it("vrai/faux : une seule option exacte compte", async () => {
    const { host, players } = await start(2);
    for (const expected of ["q2", "q3"]) {
      host.send({ type: "reveal" });
      await players[0]!.client.waitFor("reveal", (r) => r.questionId === (expected === "q2" ? "q1" : "q2"));
      host.send({ type: "next" });
      await Promise.all(players.map((p) => p.client.waitFor("question", (q) => q.questionId === expected)));
    }
    await answerAndAck(players[0]!.client, "q3", ["q3b"]);
    await answerAndAck(players[1]!.client, "q3", ["q3a", "q3b"]);
    host.send({ type: "reveal" });
    const reveals = await Promise.all(players.map((p) => p.client.waitFor("reveal", (r) => r.questionId === "q3")));
    expect(reveals.map((r) => r.you?.wasCorrect)).toEqual([true, false]);
  });

  it("répondre après la révélation ou à une question passée est refusé", async () => {
    const { code, host, players } = await start(2);
    await answerAndAck(players[0]!.client, "q1", ["q1b"]);
    host.send({ type: "reveal" });
    await players[1]!.client.waitFor("reveal");
    players[1]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    await players[1]!.client.waitFor("error", (m) => m.code === "wrong_phase");
    host.send({ type: "next" });
    await players[1]!.client.waitFor("question", (q) => q.questionId === "q2");
    players[1]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    await players[1]!.client.waitFor("error", (m) => m.code === "unknown_question");
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM answers")).toEqual([{ n: 1 }]);
  });

  it("une réponse tardive est enregistrée mais ne marque aucun point et n'entre pas dans le compteur", async () => {
    const { code, host, players } = await start(1);
    await rewindQuestion(code, 20_000 + ANSWER_TOLERANCE_MS + 1_000);
    expect(await answerAndAck(players[0]!.client, "q1", ["q1b"])).toMatchObject({ late: true });
    host.send({ type: "reveal" });
    const reveal = await host.waitFor("reveal");
    expect(reveal.ranking?.[0]).toMatchObject({ score: 0, totalMs: 0 });
    expect(await sqlOf(code, "SELECT late FROM answers")).toEqual([{ late: 1 }]);
    expect(host.messages.some((m) => m.type === "answer_count")).toBe(false);
  });
});

describe("aucune fuite de correction", () => {
  it("ni dans question, ni dans les resume pris pendant la question, pour hôte hors correction, écran, joueur", async () => {
    const { code, host, players } = await game(2);
    const screen = await connect(code, await signFor(code, { code, role: "screen" }));
    opened.push(screen);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    await players[0]!.client.waitFor("answer_ack");
    for (const client of [players[0]!.client, players[1]!.client, screen]) {
      client.send({ type: "resume" });
      await client.waitFor("snapshot", (m) => m.phase === "question");
    }
    for (const client of [players[0]!.client, players[1]!.client, screen]) {
      for (const raw of client.raw) {
        expect(raw, raw).not.toMatch(CORRECTION);
        const parsed = JSON.parse(raw) as { type: string };
        if (parsed.type === "question" || parsed.type === "snapshot") {
          expect(raw).not.toMatch(/"is_?[cC]orrect"|"correctOptionIds"|"explanation"|"reference"/);
        }
      }
    }
    // Chaque option ne porte que id et label.
    const q = players[1]!.client.messages.find((m) => m.type === "snapshot" && m.question);
    expect(q?.type === "snapshot" && q.question?.options.every((o) => Object.keys(o).sort().join() === "id,label")).toBe(true);
  });

  it("le score de l'instantané pendant une question ne révèle pas la réponse en cours, y compris pour les questions suivantes", async () => {
    const { host, players } = await game(2);
    const [a, b] = players.map((p) => p.client) as [Client, Client];
    host.send({ type: "start" });
    await a.waitFor("question");
    a.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    b.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    await Promise.all([a.waitFor("answer_ack"), b.waitFor("answer_ack")]);
    const snap = async (c: Client) => {
      const n = c.messages.filter((m) => m.type === "snapshot").length;
      c.send({ type: "resume" });
      await c.waitFor("snapshot", () => c.messages.filter((m) => m.type === "snapshot").length > n);
      const last = c.messages.filter((m) => m.type === "snapshot").at(-1)!;
      return last.type === "snapshot" ? last : null;
    };
    expect((await snap(a))?.me).toMatchObject({ score: 0, answered: true });
    expect((await snap(b))?.me).toMatchObject({ score: 0, answered: true });
    host.send({ type: "reveal" });
    await a.waitFor("reveal");
    expect((await snap(a))?.me).toMatchObject({ score: 1 });
    host.send({ type: "next" });
    await a.waitFor("question", (q) => q.questionId === "q2");
    a.send({ type: "answer", questionId: "q2", optionIds: ["q2a", "q2c"] });
    await a.waitFor("answer_ack", (m) => m.questionId === "q2");
    // Score toujours celui de la question 1 : la bonne réponse en cours n'est pas trahie.
    expect((await snap(a))?.me).toMatchObject({ score: 1, answered: true, answeredOptionIds: ["q2a", "q2c"] });
    expect((await snap(b))?.me).toMatchObject({ score: 0, answered: false });
  });

  it("show_correct_answer faux : aucune correction pour l'écran ni le joueur, ni dans leurs resume après révélation", async () => {
    const { code, host, players } = await game(1, withoutCorrection);
    const screen = await connect(code, await signFor(code, { code, role: "screen" }));
    opened.push(screen);
    const player = players[0]!.client;
    host.send({ type: "start" });
    await player.waitFor("question");
    host.send({ type: "reveal" });
    await player.waitFor("reveal");
    await screen.waitFor("reveal");
    for (const client of [player, screen]) {
      client.send({ type: "resume" });
      await client.waitFor("snapshot", (m) => m.phase === "revealed");
      for (const raw of client.raw) {
        expect(raw).not.toMatch(/correctOptionIds|explanation|reference|Six jours/);
      }
    }
    const hostSnapshot = (host.send({ type: "resume" }), await host.waitFor("snapshot", (m) => m.phase === "revealed"));
    expect(hostSnapshot.reveal?.correctOptionIds).toEqual(["q1b"]);
    expect(await sqlOf(code, "SELECT value FROM meta WHERE key = 'show_correct'")).toEqual([{ value: "0" }]);
  });

  it("show_correct_answer faux : le classement de fin et le you n'exposent pas la correction", async () => {
    const { host, players } = await game(1, withoutCorrection);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    host.send({ type: "reveal" });
    const reveal = await players[0]!.client.waitFor("reveal");
    // Sans correction, le joueur ne reçoit ni résultat personnel ni classement avant la fin de la partie.
    expect(Object.keys(reveal).sort()).toEqual(["questionId", "type"]);
  });
});

describe("reconnexion, hibernation et éviction", () => {
  it("reconnexion pendant la question : temps restant cohérent et réponse déjà donnée", async () => {
    const { code, host, players } = await game(1);
    host.send({ type: "start" });
    const first = players[0]!;
    const question = await first.client.waitFor("question");
    first.client.close();
    await rewindQuestion(code, 5_000);
    const back = await connect(code, first.token);
    opened.push(back);
    back.send({ type: "resume" });
    const snapshot = await back.waitFor("snapshot");
    const q = snapshot.question!;
    expect(q.startedAt).toBeLessThan(question.startedAt);
    expect(q.serverNow - q.startedAt).toBeGreaterThanOrEqual(5_000);
    expect(snapshot.me).toMatchObject({ answered: false, score: 0 });
    back.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    expect(await back.waitFor("answer_ack")).toMatchObject({ late: false, duplicate: false });
  });

  it("reconnexion après la révélation : snapshot revealed avec correction et rang", async () => {
    const { code, host, players } = await game(2);
    host.send({ type: "start" });
    const [a, b] = players;
    await a!.client.waitFor("question");
    a!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    await a!.client.waitFor("answer_ack");
    host.send({ type: "reveal" });
    await a!.client.waitFor("reveal");
    a!.client.close();
    const back = await connect(code, a!.token);
    opened.push(back);
    back.send({ type: "resume" });
    const snapshot = await back.waitFor("snapshot");
    expect(snapshot.phase).toBe("revealed");
    expect(snapshot.reveal?.correctOptionIds).toEqual(["q1b"]);
    expect(snapshot.reveal?.you).toMatchObject({ wasCorrect: true, score: 1, rank: 1 });
    expect(snapshot.me).toMatchObject({ score: 1, answered: true });
    expect(snapshot.answeredCount).toBeUndefined();
    b!.client.send({ type: "resume" });
    const other = await b!.client.waitFor("snapshot", (m) => m.phase === "revealed");
    expect(other.reveal?.you).toMatchObject({ wasCorrect: false, score: 0, rank: 2 });
  });

  it("éviction pendant la question : l'alarme persiste et révèle aux sockets hibernés", async () => {
    const { code, host, players } = await game(1);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    const stub = stubFor(code);
    const alarmBefore = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    await evictDurableObject(stub);
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBe(alarmBefore);
    await rewindQuestion(code, 20_000 + ANSWER_TOLERANCE_MS + 100);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await players[0]!.client.waitFor("reveal")).questionId).toBe("q1");
    expect((await host.waitFor("reveal")).correctOptionIds).toEqual(["q1b"]);
  });

  it("éviction après la révélation puis reconnexion hôte : la partie continue", async () => {
    const { code, host, players } = await game(1);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    host.send({ type: "reveal" });
    await players[0]!.client.waitFor("reveal");
    await evictDurableObject(stubFor(code));
    host.send({ type: "next" });
    const next = await players[0]!.client.waitFor("question", (q) => q.questionId === "q2");
    expect(next.index).toBe(1);
    await evictDurableObject(stubFor(code));
    players[0]!.client.send({ type: "answer", questionId: "q2", optionIds: ["q2a", "q2c"] });
    expect(await players[0]!.client.waitFor("answer_ack", (m) => m.questionId === "q2")).toMatchObject({ duplicate: false, late: false });
  });

  it("éviction en lobby : joueurs, pseudos pris et code conservés", async () => {
    const { code } = await game(1);
    await evictDurableObject(stubFor(code));
    expect((await join(code, "joueur 0")).status).toBe(409);
    expect((await join(code, "Nouveau")).status).toBe(201);
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM players")).toEqual([{ n: 2 }]);
  });

  it("l'ajout d'un joueur reconnecté après éviction d'un socket reste fonctionnel (addPlayer)", async () => {
    const { code, host } = await game(0);
    const p = await addPlayer(code, "Awa");
    opened.push(p.client);
    await evictDurableObject(stubFor(code));
    host.send({ type: "start" });
    expect((await p.client.waitFor("question")).questionId).toBe("q1");
  });
});
