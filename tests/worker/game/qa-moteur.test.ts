import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../../../src/server/db/client";
import { createQuiz, type QuestionInput } from "../../../src/server/db/quizzes";
import { getSessionReport } from "../../../src/server/db/results";
import { user } from "../../../src/server/db/schema";
import { LaunchError, issueSessionToken, launchGame, type SessionUser } from "../../../src/server/game/launch";
import type { QuizDefinition, QuizQuestion } from "../../../src/server/game/quiz";
import { CLOSE_CODES } from "../../../src/shared/protocol";
import { OWNER_ID, addPlayer, closeCodeOf, connect, createGame, hostToken, join, newCode, prepareDb, reuseCode, setup, sidFor, signFor, stubFor, type Client } from "./helpers";

// QA indépendante de QZ-002-07 : complète launch.test.ts et moteur.test.ts sans les dupliquer.
const owner: SessionUser = { id: OWNER_ID, name: "Animateur", email: "animateur@example.invalid" };
const other: SessionUser = { id: "autre-qa", name: null, email: "autre-qa@example.invalid" };
const FORBIDDEN = /correct|explanation|reference|isCorrect/i;

const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});
beforeAll(async () => {
  await prepareDb();
  await getDb(env.DB).insert(user).values({ id: other.id, name: "Autre", email: other.email });
});

const input = (prompt: string, options: { label: string; isCorrect: boolean }[]): QuestionInput => ({ type: "single", prompt, durationSec: 20, options });
const good = (prompt = "Q ?") => input(prompt, [{ label: "Oui", isCorrect: true }, { label: "Non", isCorrect: false }]);

async function failure(task: Promise<unknown>): Promise<LaunchError> {
  try {
    await task;
  } catch (error) {
    expect(error).toBeInstanceOf(LaunchError);
    return error as LaunchError;
  }
  throw new Error("Aucune erreur levée");
}

const sessionCount = async (quizId: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM game_sessions WHERE quiz_id = ?").bind(quizId).first<{ n: number }>())!.n;

describe("lancement : quiz refusés (règle quizStatus partagée)", () => {
  it("quiz vide : message français précis, aucune partie créée", async () => {
    const quizId = await createQuiz(getDb(env.DB), OWNER_ID, { title: "Vide", questions: [] });
    const error = await failure(launchGame(env, owner, quizId));
    expect(error).toMatchObject({ code: "BAD_REQUEST", message: "Le quiz n'est pas prêt : ajoute au moins une question." });
    expect(await sessionCount(quizId)).toBe(0);
  });

  it("une option sans libellé rend la question incomplète, et la liste mêle tous les motifs", async () => {
    const blankLabel = input("B", [{ label: "", isCorrect: true }, { label: "Non", isCorrect: false }]);
    const noCorrect = input("A", [{ label: "Oui", isCorrect: false }, { label: "Non", isCorrect: false }]);
    const quizId = await createQuiz(getDb(env.DB), OWNER_ID, { title: "Mixte", questions: [noCorrect, blankLabel, good()] });
    const error = await failure(launchGame(env, owner, quizId));
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe("Le quiz n'est pas prêt : les questions 1, 2 sont à compléter.");
    expect(await sessionCount(quizId)).toBe(0);

    const single = await createQuiz(getDb(env.DB), OWNER_ID, { title: "Une", questions: [good(), blankLabel] });
    expect((await failure(launchGame(env, owner, single))).message).toBe("Le quiz n'est pas prêt : la question 2 est à compléter.");
  });

  it("un non-propriétaire et un visiteur sont refusés, sans fuite sur l'existence du quiz", async () => {
    const quizId = await createQuiz(getDb(env.DB), OWNER_ID, { title: "Privé", questions: [good()] });
    const stranger = await failure(launchGame(env, other, quizId));
    const missing = await failure(launchGame(env, other, "n-existe-pas"));
    expect(stranger.code).toBe("NOT_FOUND");
    expect(stranger.message).toBe(missing.message);
    expect((await failure(launchGame(env, null, quizId))).code).toBe("UNAUTHORIZED");
    expect(await sessionCount(quizId)).toBe(0);
  });

  it("deux lancements successifs : deux parties, deux codes, deux Durable Objects indépendants", async () => {
    const quizId = await createQuiz(getDb(env.DB), OWNER_ID, { title: "Deux fois", questions: [good()] });
    const a = await launchGame(env, owner, quizId);
    const b = await launchGame(env, owner, quizId);
    expect(a.code).not.toBe(b.code);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(await sessionCount(quizId)).toBe(2);
    // Le jeton hôte de A ne donne pas la main sur B.
    expect(await closeCodeOf(b.code, await signFor(b.code, { code: b.code, role: "host", sid: a.sessionId }))).toBe(CLOSE_CODES.gameGone);
  });
});

describe("jetons écran et hôte", () => {
  it("refusés à un autre compte et sur une partie terminée, pour les deux rôles", async () => {
    const quizId = await createQuiz(getDb(env.DB), OWNER_ID, { title: "Jetons", questions: [good()] });
    const game = await launchGame(env, owner, quizId);
    for (const role of ["screen", "host"] as const) {
      expect((await failure(issueSessionToken(env, other, game.sessionId, role))).code).toBe("NOT_FOUND");
      expect((await failure(issueSessionToken(env, null, game.sessionId, role))).code).toBe("UNAUTHORIZED");
    }
    const host = await connect(game.code, game.hostToken);
    opened.push(host);
    host.send({ type: "end" });
    await host.waitFor("finished");
    for (const role of ["screen", "host"] as const) {
      expect((await failure(issueSessionToken(env, owner, game.sessionId, role))).code).toBe("NOT_FOUND");
    }
  });
});

describe("code de partie", () => {
  const tables = (stub: ReturnType<typeof stubFor>) =>
    runInDurableObject(stub, (_i, state) => ({ tables: state.storage.sql.exec("SELECT name FROM sqlite_master").toArray(), alarm: null as number | null }));

  it("un code inconnu ne crée de stockage dans aucun Durable Object, ni par le code ni par le sid du jeton", async () => {
    const code = newCode();
    const sid = crypto.randomUUID();
    expect((await join(code, "Awa")).status).toBe(404);
    expect(await closeCodeOf(code, await signFor(code, { code, role: "host", sid }))).toBe(CLOSE_CODES.gameGone);
    expect(await closeCodeOf(code, await signFor(code, { code, role: "player", sid, playerId: "x" }))).toBe(CLOSE_CODES.gameGone);
    for (const name of [code, sid, `alias:${code}`]) {
      const stub = env.GAME_SESSION.get(env.GAME_SESSION.idFromName(name));
      expect((await tables(stub)).tables).toEqual([]);
      expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull();
    }
  });

  it("une partie terminée ne réveille plus son Durable Object : ni inscription ni connexion n'y écrivent", async () => {
    const { code, host, players } = await setup(1);
    opened.push(host, players[0]!.client);
    const token = players[0]!.token;
    host.send({ type: "end" });
    await host.waitFor("finished");
    const snapshot = () =>
      runInDurableObject(stubFor(code), (_i, state) => ({
        buckets: state.storage.sql.exec("SELECT * FROM buckets ORDER BY key").toArray(),
        players: state.storage.sql.exec("SELECT COUNT(*) AS n FROM players").one(),
      }));
    const before = await snapshot();
    expect((await join(code, "Tardif")).status).toBe(410);
    expect(await closeCodeOf(code, token)).toBe(CLOSE_CODES.gameGone);
    expect(await closeCodeOf(code, await hostToken(code))).toBe(CLOSE_CODES.gameGone);
    expect(await snapshot()).toEqual(before);
  });

  it("le code d'une partie finie est réutilisable : la nouvelle partie est vierge et aucun ancien jeton ne s'y connecte", async () => {
    const old = await setup(1);
    opened.push(old.host, old.players[0]!.client);
    const oldPlayer = old.players[0]!.token;
    const oldHost = await hostToken(old.code);
    old.host.send({ type: "end" });
    await old.host.waitFor("finished");

    const newSid = reuseCode(old.code);
    await createGame(old.code, undefined, newSid);
    const fresh = await connect(old.code, await hostToken(old.code));
    opened.push(fresh);
    fresh.send({ type: "resume" });
    expect(await fresh.waitFor("snapshot")).toMatchObject({ phase: "lobby", playerCount: 0 });

    expect(await closeCodeOf(old.code, oldPlayer)).toBe(CLOSE_CODES.gameGone);
    expect(await closeCodeOf(old.code, oldHost)).toBe(CLOSE_CODES.gameGone);
    expect((await join(old.code, "Joueur 0")).status).toBe(201);
  });
});

// Enveloppe D1 vue par le Durable Object : compte les requêtes préparées et les batchs.
async function spyOnDatabase(code: string) {
  const trace = { batches: [] as number[], prepared: 0 };
  await runInDurableObject(stubFor(code), (instance) => {
    const proxy = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") return (query: string) => ((trace.prepared += 1), target.prepare(query));
        if (prop === "batch") return (statements: D1PreparedStatement[]) => (trace.batches.push(statements.length), target.batch(statements));
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const holder = instance as unknown as { env: Env };
    holder.env = Object.create(holder.env, { DB: { value: proxy } });
  });
  return trace;
}

const question = (i: number): QuizQuestion => ({
  id: `q${i}`,
  kind: "single",
  prompt: `Question ${i}`,
  durationSec: 20,
  explanation: `Explication ${i}`,
  options: ["a", "b", "c", "d"].map((letter, n) => ({ id: `q${i}${letter}`, label: `Option ${letter}`, isCorrect: n === 0 })),
});
const quiz = (count: number, extra: Partial<QuizDefinition> = {}): QuizDefinition => ({
  title: "QA",
  showCorrectAnswer: true,
  questions: Array.from({ length: count }, (_, i) => question(i)),
  ...extra,
});
async function game(playerCount: number, definition: QuizDefinition) {
  const result = await setup(playerCount, definition);
  opened.push(result.host, ...result.players.map((p) => p.client));
  return result;
}
const sql = <T>(code: string, query: string, ...bindings: unknown[]) =>
  runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec(query, ...bindings).toArray() as T[]);

describe("mode ensemble : de bout en bout", () => {
  it("start, questions, réponses, révélations, next, fin : une seule écriture D1, rangs uniques, finished sans correction", async () => {
    const { code, host, players } = await game(3, quiz(3));
    const trace = await spyOnDatabase(code);
    host.send({ type: "start" });
    await host.waitFor("question");
    // Seule écriture observée : le passage « en cours » de la ligne D1, une fois, au démarrage (meilleur effort).
    expect(trace).toEqual({ batches: [], prepared: 1 });
    trace.prepared = 0;
    for (let i = 0; i < 3; i += 1) {
      await Promise.all([host, ...players.map((p) => p.client)].map((c) => c.waitFor("question", (m) => m.index === i)));
      // Joueur 0 toujours juste, joueur 1 juste sauf la dernière, joueur 2 toujours faux (le même score que personne).
      const picks = [`q${i}a`, i < 2 ? `q${i}a` : `q${i}b`, `q${i}c`];
      players.forEach((p, n) => p.client.send({ type: "answer", questionId: `q${i}`, optionIds: [picks[n]!] }));
      await Promise.all(players.map((p) => p.client.waitFor("answer_ack", (m) => m.questionId === `q${i}`)));
      host.send({ type: "reveal" });
      await host.waitFor("reveal", (m) => m.questionId === `q${i}`);
      if (i < 2) host.send({ type: "next" });
    }
    // Ensuite plus aucune requête D1 jusqu'à la fin, pas seulement aucun batch.
    expect(trace).toEqual({ batches: [], prepared: 0 });
    host.send({ type: "next" });
    const finished = await host.waitFor("finished");
    expect(trace.batches).toHaveLength(1);

    expect(finished.ranking.map((r) => [r.pseudo, r.score])).toEqual([["Joueur 0", 3], ["Joueur 1", 2], ["Joueur 2", 0]]);
    await Promise.all(players.map((p) => p.client.waitFor("finished")));
    for (const client of [host, ...players.map((p) => p.client)]) {
      const raw = client.raw.filter((r) => r.includes('"type":"finished"'));
      expect(raw).toHaveLength(1);
      expect(raw[0]).not.toMatch(FORBIDDEN);
    }
    const you = await Promise.all(players.map(async (p) => (await p.client.waitFor("finished")).you?.rank));
    expect(you).toEqual([1, 2, 3]);

    const report = await getSessionReport(getDb(env.DB), OWNER_ID, sidFor(code));
    expect(report?.session.status).toBe("ended");
    expect(report?.players.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(new Set(report?.players.map((p) => p.rank)).size).toBe(3);

    // Une commande tardive ne réécrit rien.
    host.send({ type: "end" });
    expect((await host.waitFor("error")).code).toBe("wrong_phase");
    expect(trace.batches).toHaveLength(1);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM session_players WHERE session_id = ?").bind(sidFor(code)).first<{ n: number }>();
    expect(count?.n).toBe(3);
  });
});

describe("mode chacun à son rythme : chrono, anti-triche, reprise", () => {
  const own = (count: number, extra: Partial<QuizDefinition> = {}) => quiz(count, { mode: "own_pace", ...extra });

  it("chaque joueur a son propre chrono serveur : la réponse tardive de l'un n'affecte pas l'autre", async () => {
    const { code, host, players } = await game(2, own(2));
    host.send({ type: "start" });
    const [q0, q1] = await Promise.all(players.map((p) => p.client.waitFor("question")));
    expect(q0!.questionId).toBe(q1!.questionId);
    await runInDurableObject(stubFor(code), (_i, state) =>
      state.storage.sql.exec("UPDATE pstate SET started_at = started_at - 600000 WHERE player_id = ?", players[1]!.playerId),
    );
    players[0]!.client.send({ type: "answer", questionId: q0!.questionId, optionIds: ["q0a"] });
    players[1]!.client.send({ type: "answer", questionId: q1!.questionId, optionIds: ["q0a"] });
    expect(await players[0]!.client.waitFor("answer_ack")).toMatchObject({ late: false });
    expect(await players[1]!.client.waitFor("answer_ack")).toMatchObject({ late: true });
    expect((await players[0]!.client.waitFor("reveal")).you).toEqual({ wasCorrect: true, score: 1 });
    expect((await players[1]!.client.waitFor("reveal")).you).toEqual({ wasCorrect: false, score: 0 });
  });

  it("un joueur n'a jamais la correction d'une question qu'il n'a pas jouée, ni l'hôte avant la fin", async () => {
    const { host, players } = await game(2, own(3));
    host.send({ type: "start" });
    const [fast, slow] = players;
    for (let i = 0; i < 2; i += 1) {
      const q = await fast!.client.waitFor("question", (m) => m.index === i);
      fast!.client.send({ type: "answer", questionId: q.questionId, optionIds: [`${q.questionId}a`] });
      await fast!.client.waitFor("reveal", (m) => m.questionId === q.questionId);
      fast!.client.send({ type: "next" });
    }
    await fast!.client.waitFor("question", (m) => m.index === 2);
    // Le lent est resté sur la question 0 : rien de ce qu'il a reçu ne contient de correction, même après la reprise.
    slow!.client.send({ type: "resume" });
    await slow!.client.waitFor("snapshot", (m) => m.phase === "question" && m.question?.index === 0);
    expect(slow!.client.raw.filter((r) => FORBIDDEN.test(r))).toEqual([]);
    expect(host.raw.filter((r) => FORBIDDEN.test(r))).toEqual([]);
    // Il ne peut pas non plus répondre à une question qu'il n'a pas encore reçue.
    slow!.client.send({ type: "answer", questionId: "q2", optionIds: ["q2a"] });
    expect((await slow!.client.waitFor("error")).code).toBeTruthy();
    expect(slow!.client.messages.some((m) => m.type === "reveal")).toBe(false);
  });

  it("impossible de sauter une question, de répondre deux fois ou de rejouer une question passée", async () => {
    const { code, host, players } = await game(1, own(3));
    host.send({ type: "start" });
    const client = players[0]!.client;
    const q0 = await client.waitFor("question");
    expect(q0.questionId).toBe("q0");
    // Sauter : répondre à q1 depuis q0, ou passer à la suite sans répondre.
    client.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    expect((await client.waitFor("error")).code).toBeTruthy();
    expect(await sql(code, "SELECT COUNT(*) AS n FROM answers")).toEqual([{ n: 0 }]);
    // Double réponse : la première compte, la seconde est un doublon.
    client.send({ type: "answer", questionId: "q0", optionIds: ["q0b"] });
    client.send({ type: "answer", questionId: "q0", optionIds: ["q0a"] });
    await client.waitForCount("answer_ack", 2);
    expect(client.messages.filter((m) => m.type === "answer_ack").map((m) => m.type === "answer_ack" && m.duplicate)).toEqual([false, true]);
    expect(await sql(code, "SELECT option_ids FROM answers")).toEqual([{ option_ids: JSON.stringify(["q0b"]) }]);
    await client.waitFor("reveal");
    client.send({ type: "next" });
    await client.waitFor("question", (m) => m.index === 1);
    // Rejouer q0 après être passé à q1 : doublon, la réponse initiale reste seule retenue.
    client.send({ type: "answer", questionId: "q0", optionIds: ["q0a"] });
    await client.waitForCount("answer_ack", 3);
    expect(client.messages.filter((m) => m.type === "answer_ack").at(-1)).toMatchObject({ questionId: "q0", duplicate: true });
    expect(await sql(code, "SELECT option_ids FROM answers")).toEqual([{ option_ids: JSON.stringify(["q0b"]) }]);
    // Et q2, qui n'a pas encore été servie, reste refusée.
    client.send({ type: "answer", questionId: "q2", optionIds: ["q2a"] });
    await client.waitForCount("error", 2);
    expect(await sql(code, "SELECT COUNT(*) AS n FROM answers")).toEqual([{ n: 1 }]);
  });

  it("un joueur déconnecté en cours de route retrouve sa question et sa progression à la reconnexion", async () => {
    const { code, host, players } = await game(2, own(3));
    host.send({ type: "start" });
    const [p, rival] = players;
    const q0 = await p!.client.waitFor("question");
    p!.client.send({ type: "answer", questionId: q0.questionId, optionIds: [`${q0.questionId}a`] });
    await p!.client.waitFor("reveal");
    p!.client.send({ type: "next" });
    const q1 = await p!.client.waitFor("question", (m) => m.index === 1);
    p!.client.close();
    // Pendant ce temps l'autre joueur avance et la partie ne s'arrête pas.
    const rivalQ = await rival!.client.waitFor("question");
    rival!.client.send({ type: "answer", questionId: rivalQ.questionId, optionIds: [`${rivalQ.questionId}a`] });
    await rival!.client.waitFor("reveal");

    const back = await connect(code, p!.token);
    opened.push(back);
    back.send({ type: "resume" });
    const snapshot = await back.waitFor("snapshot");
    expect(snapshot).toMatchObject({ phase: "question", question: { index: 1, questionId: q1.questionId } });
    expect(snapshot.question?.options.map((o) => o.id)).toEqual(q1.options.map((o) => o.id));
    expect(snapshot.me?.score).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/correctOptionIds|explanation/);
  });

  it("la fin arrive quand le dernier joueur termine, et pas avant", async () => {
    const { host, players } = await game(2, own(1));
    host.send({ type: "start" });
    const [a, b] = players;
    const qa = await a!.client.waitFor("question");
    a!.client.send({ type: "answer", questionId: qa.questionId, optionIds: ["q0a"] });
    await a!.client.waitFor("reveal");
    a!.client.send({ type: "next" });
    await host.waitFor("progress", (m) => m.finished === 1);
    expect([a, b, { client: host }].some((x) => x!.client.messages.some((m) => m.type === "finished"))).toBe(false);
    const qb = await b!.client.waitFor("question");
    b!.client.send({ type: "answer", questionId: qb.questionId, optionIds: ["q0b"] });
    await b!.client.waitFor("reveal");
    b!.client.send({ type: "next" });
    for (const c of [host, a!.client, b!.client]) expect((await c.waitFor("finished")).ranking).toHaveLength(2);
  });
});

describe("mélange", () => {
  const firstQuestionOptions = async (seed: string | undefined, shuffle: boolean) => {
    const { host } = await game(0, quiz(1, { shuffle, seed }));
    host.send({ type: "start" });
    return (await host.waitFor("question")).options.map((o) => o.id);
  };

  it("même graine, même ordre des options ; options réellement mélangées ; ensemble complet conservé", async () => {
    const a = await firstQuestionOptions("graine-qa", true);
    const b = await firstQuestionOptions("graine-qa", true);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(["q0a", "q0b", "q0c", "q0d"]);
    const distinct = new Set<string>();
    for (let i = 0; i < 6; i += 1) distinct.add((await firstQuestionOptions(`s${i}`, true)).join());
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("la bonne réponse change de position d'une partie à l'autre (graines aléatoires), et reste en tête sans mélange", async () => {
    const positions = new Set<number>();
    for (let i = 0; i < 10; i += 1) positions.add((await firstQuestionOptions(undefined, true)).indexOf("q0a"));
    expect(positions.size).toBeGreaterThan(1);
    expect(await firstQuestionOptions(undefined, false)).toEqual(["q0a", "q0b", "q0c", "q0d"]);
  });

  it("libre : les options sont propres à chaque joueur mais stables à sa reconnexion", async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const { host, players } = await game(1, quiz(1, { mode: "own_pace", shuffle: true, seed: `libre-${i}` }));
      host.send({ type: "start" });
      const q = await players[0]!.client.waitFor("question");
      orders.add(q.options.map((o) => o.id).join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("route locale de charge", () => {
  // Les questions viennent de l'appelant depuis que la fixture n'est plus embarquée dans le bundle.
  const body = JSON.stringify({ questions: [{ kind: "single", prompt: "Q", durationSec: 20, options: [{ label: "A", isCorrect: true }, { label: "B", isCorrect: false }] }] });
  const call = (headers: Record<string, string>, method = "POST") =>
    exports.default.fetch("https://exemple.test/api/parties/local", { method, headers: { "Content-Type": "application/json", ...headers }, body: method === "POST" ? body : undefined });

  it("404 sans en-tête, avec un mauvais secret, un secret vide ou une autre casse de valeur", async () => {
    await prepareDb();
    const secret = env.PLAYER_TOKEN_SECRET as string;
    for (const headers of [{} as Record<string, string>, { "x-local-secret": "mauvais" }, { "x-local-secret": "" }, { "x-local-secret": secret.toUpperCase() }, { "x-local-secret": secret.slice(1) }]) {
      expect((await call(headers)).status).toBe(404);
    }
    expect((await call({ authorization: `Bearer ${secret}` })).status).toBe(404);
  });

  it("n'écrit rien en D1 quand l'accès est refusé", async () => {
    await prepareDb();
    const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM game_sessions").first<{ n: number }>())!.n;
    const before = await count();
    await call({ "x-local-secret": "mauvais" });
    expect(await count()).toBe(before);
  });

  it("le bon secret, en local (MAIL_TRANSPORT=console), crée une partie jouable", async () => {
    await prepareDb();
    expect(env.MAIL_TRANSPORT).toBe("console");
    // La route exige le drapeau LOCAL_TOOLS en plus du transport : on le force puis on restaure la valeur de la config.
    const flags = env as unknown as Record<string, string | undefined>;
    const initial = flags.LOCAL_TOOLS;
    flags.LOCAL_TOOLS = "true";
    try {
      const response = await call({ "x-local-secret": env.PLAYER_TOKEN_SECRET as string });
      expect(response.status).toBe(201);
      const { code, hostToken: token } = (await response.json()) as { code: string; hostToken: string };
      const host = await connect(code, token);
      opened.push(host);
      host.send({ type: "resume" });
      expect(await host.waitFor("snapshot")).toMatchObject({ role: "host", phase: "lobby" });
      const joined = await addPlayer(code, "Awa");
      opened.push(joined.client);
    } finally {
      if (initial === undefined) delete flags.LOCAL_TOOLS;
      else flags.LOCAL_TOOLS = initial;
    }
  });
});

