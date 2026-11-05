import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYER_TOKEN_TTL_MS } from "../../../src/shared/protocol";
import {
  closeCodeOf, connect, createGame, floodUntilClosed, freezeClock, hostToken, join, newCode, rawConnect, setup, signFor, stubFor,
  type Client,
} from "./helpers";

const opened: Client[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const client of opened.splice(0)) client.close();
});

async function game(playerCount: number) {
  const result = await setup(playerCount);
  opened.push(result.host, ...result.players.map((p) => p.client));
  return result;
}

const closeOf = (client: Client) => new Promise<CloseEvent>((resolve) => client.ws.addEventListener("close", resolve));
const sqlOf = <T>(code: string, query: string): Promise<T[]> =>
  runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec(query).toArray() as T[]);

async function finishGame(host: Client): Promise<void> {
  host.send({ type: "start" });
  for (const q of ["q1", "q2", "q3"]) {
    await host.waitFor("question", (m) => m.questionId === q);
    host.send({ type: "reveal" });
    await host.waitFor("reveal", (m) => m.questionId === q);
    host.send({ type: "next" });
  }
  await host.waitFor("finished");
}

// Ouvre un socket et renvoie son code de fermeture s'il est refusé, null s'il est accepté. Un délai fixe pour
// attendre la fermeture ne suffisait pas sous machine chargée : un refus arrivé après lui comptait comme accepté.
// On envoie donc « ping » : un socket accepté par la partie répond « pong » (réponse automatique, sans réveiller
// l'objet ni consommer de jeton), un socket refusé est déjà refermé et ne répondra jamais.
async function openOrClosed(code: string, token: string): Promise<number | null> {
  const response = await rawConnect(code, token);
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  const ponged = new Promise<null>((resolve) => ws.addEventListener("message", (event) => event.data === "pong" && resolve(null)));
  ws.accept();
  if (ws.readyState === WebSocket.OPEN) ws.send("ping");
  const result = await Promise.race([closed, ponged]);
  if (result === null) opened.push({ close: () => ws.close(1000) } as Client);
  return result;
}

describe("code de partie : unicité portée par D1", () => {
  it("deux lancements simultanés sur le même code : un seul réussit, l'autre est refermé en 4001", async () => {
    const code = newCode();
    const sids = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.allSettled(sids.map((sid) => createGame(code, undefined, sid)));
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const winner = results.findIndex((r) => r.status === "fulfilled");
    const loser = 1 - winner;
    // Le perdant n'existe pas dans D1 : conflit entre hôtes, refus applicatif définitif.
    expect(await closeCodeOf(code, await signFor(code, { code, role: "host", sid: sids[loser] }))).toBe(4001);
    const ok = await connect(code, await signFor(code, { code, role: "host", sid: sids[winner] }));
    opened.push(ok);
  });

  it("un autre hôte est refusé tant que la partie est en cours, puis accepté quand elle est terminée", async () => {
    const { code, host } = await game(0);
    const intruderSid = crypto.randomUUID();
    const intruder = await signFor(code, { code, role: "host", sid: intruderSid });
    expect(await closeCodeOf(code, intruder)).toBe(4001);
    // Le même hôte (même sid) se reconnecte sans difficulté.
    const again = await connect(code, await hostToken(code));
    opened.push(again);
    await finishGame(host);
    await createGame(code, undefined, intruderSid);
    const successor = await connect(code, intruder);
    opened.push(successor);
    expect((await join(code, "Nouveau")).status).toBe(201);
  });

  it("l'hôte d'une partie terminée dont le code a été repris est refermé en 4004, pas en 4001", async () => {
    const { code, host } = await game(0);
    const formerHost = await hostToken(code);
    await finishGame(host);
    const successorSid = crypto.randomUUID();
    await createGame(code, undefined, successorSid);
    const successor = await connect(code, await signFor(code, { code, role: "host", sid: successorSid }));
    opened.push(successor);
    expect(await closeCodeOf(code, formerHost)).toBe(4004);
  });

  it("une partie terminée ne reçoit plus de connexion de joueur", async () => {
    const { code, host, players } = await game(1);
    await finishGame(host);
    expect(await closeCodeOf(code, players[0]!.token)).toBe(4004);
    expect((await join(code, "Tardif")).status).toBe(410);
  });
});

describe("fermetures applicatives définitives", () => {
  it("la purge ferme les sockets ouverts avec 4004, et un joueur qui revient reçoit 4004", async () => {
    const { code, players } = await game(1);
    const closed = closeOf(players[0]!.client);
    await runInDurableObject(stubFor(code), (_i, state) =>
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'last_host_at'", String(Date.now() - PLAYER_TOKEN_TTL_MS - 1000)));
    await runDurableObjectAlarm(stubFor(code));
    await runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec("UPDATE meta SET value = '1' WHERE key = 'finished_at'"));
    await runDurableObjectAlarm(stubFor(code));
    expect((await closed).code).toBe(4004);
    expect(await closeCodeOf(code, players[0]!.token)).toBe(4004);
  });

  it("le dépassement de débit reste 1008 et la taille 1009 : ce ne sont pas des fins définitives", { timeout: 60_000 }, async () => {
    // Horloge figée : sinon un serveur ralenti par la charge traite les messages au rythme de la recharge et le flot
    // ne vide jamais le seau.
    freezeClock();
    const { players } = await game(1);
    const closed = closeOf(players[0]!.client);
    expect((await floodUntilClosed(players[0]!.client, closed))?.code).toBe(1008);
  });
});

describe("seau à jetons et fréquence de connexion", () => {
  it("le seau d'un socket fermé proprement est conservé dans le SQLite et ne repart pas à plein", async () => {
    // Horloge figée : le seau se recharge de 10 jetons par seconde réelle, et sous machine chargée deux secondes entre le
    // dernier message et la fermeture suffisaient à le remettre presque plein (29,91 observé).
    freezeClock();
    const { code, players } = await game(1);
    const { client, playerId, token } = players[0]!;
    for (let i = 0; i < 20; i += 1) client.send({ type: "resume" });
    await client.waitFor("snapshot", () => client.messages.filter((m) => m.type === "snapshot").length >= 21);
    const closed = closeOf(client);
    client.close();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    const [row] = await sqlOf<{ tokens: number }>(code, `SELECT tokens FROM buckets WHERE key = 'p:${playerId}'`);
    // 30 - 21 jetons consommés, sans recharge.
    expect(row!.tokens).toBe(9);

    const next = await connect(code, token);
    opened.push(next);
    const nextClosed = closeOf(next);
    for (let i = 0; i < 25; i += 1) next.send({ type: "resume" });
    // Le seau repris (9 jetons, moins le coût de reconnexion) s'épuise avant les 25 messages : fermeture en 1008.
    expect((await nextClosed).code).toBe(1008);
    expect(next.messages.filter((m) => m.type === "snapshot").length).toBeLessThanOrEqual(row!.tokens);
  });

  it("au-delà de 10 connexions d'affilée, le joueur est refermé (1008) avant d'atteindre la partie", async () => {
    // Horloge figée dès la première connexion : la limite se recharge d'une connexion toutes les 6 s, et une boucle
    // ralentie par la charge ne doit pas en regagner une en route.
    freezeClock();
    const { code, players } = await game(1);
    const results: (number | null)[] = [];
    // addPlayer a déjà consommé une connexion.
    for (let i = 0; i < 12; i += 1) results.push(await openOrClosed(code, players[0]!.token));
    expect(results.slice(0, 9).every((r) => r === null || r === 1000)).toBe(true);
    expect(results.slice(9)).toEqual([1008, 1008, 1008]);
  });

  it("ni une fermeture sans consommation ni le remplacement d'un zombie ne réécrivent la ligne buckets", async () => {
    const { code, players } = await game(1);
    const { client, playerId, token } = players[0]!;
    const row = async () => (await sqlOf<{ tokens: number; at: number }>(code, `SELECT tokens, at FROM buckets WHERE key = 'p:${playerId}'`))[0]!;
    const zombieClosed = closeOf(client);
    const next = await connect(code, token);
    opened.push(next);
    const afterConnect = await row();
    await zombieClosed;
    await new Promise((r) => setTimeout(r, 50));
    expect(await row()).toEqual(afterConnect);

    const nextClosed = closeOf(next);
    next.close();
    await nextClosed;
    await new Promise((r) => setTimeout(r, 50));
    expect(await row()).toEqual(afterConnect);
  });

  it("un attachement sans seau (version antérieure) reste lisible", async () => {
    const { code, host } = await game(0);
    await runInDurableObject(stubFor(code), (_i, state) => {
      for (const ws of state.getWebSockets("host")) ws.serializeAttachment({ role: "host" });
    });
    const before = host.messages.filter((m) => m.type === "snapshot").length;
    host.send({ type: "resume" });
    await host.waitFor("snapshot", () => host.messages.filter((m) => m.type === "snapshot").length > before);
  });
});

describe("pseudos : faux doublons invisibles", () => {
  it("ZWJ, sélecteur de variante et U+034F ne créent pas un second pseudo ; U+3164 seul est refusé", async () => {
    const { code, host } = await game(0);
    expect((await join(code, "Awa")).status).toBe(201);
    for (const pseudo of ["Awa️", "A͏wa", "Aw‍a", "awaㅤ"]) {
      expect((await join(code, pseudo)).status, JSON.stringify(pseudo)).toBe(409);
    }
    for (const pseudo of ["ㅤ", "ㅤ ㅤ", "͏", "️‍"]) {
      expect((await join(code, pseudo)).status, JSON.stringify(pseudo)).toBe(400);
    }
    expect((await join(code, "👨‍👩‍👧")).status).toBe(201);
    host.send({ type: "resume" });
    const snapshot = await host.waitFor("snapshot", (m) => (m.players?.length ?? 0) === 2);
    expect(snapshot.players?.map((p) => p.pseudo)).toContain("👨‍👩‍👧");
  });

  it("le pseudo d'un joueur exclu reste banni, y compris sous une variante invisible", async () => {
    const { code, host, players } = await game(1);
    host.send({ type: "kick", playerId: players[0]!.playerId });
    await host.waitFor("player_left");
    expect((await join(code, "Joueur 0️")).status).toBe(409);
    expect((await join(code, "Joueur 1")).status).toBe(201);
  });
});

describe("révélation et fin de partie", () => {
  it("les reprises après révélation réutilisent le classement calculé ; une exclusion l'invalide", async () => {
    const { code, host, players } = await game(2);
    host.send({ type: "start" });
    await Promise.all(players.map((p) => p.client.waitFor("question")));
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    await players[0]!.client.waitFor("answer_ack");
    host.send({ type: "reveal" });
    await host.waitFor("reveal");

    const spy = await runInDurableObject(stubFor(code), (instance) => vi.spyOn((instance as unknown as { store: { ranking: () => unknown } }).store, "ranking"));
    const snapshots = () => host.messages.filter((m) => m.type === "snapshot").length;
    let count = snapshots();
    host.send({ type: "resume" });
    players[1]!.client.send({ type: "resume" });
    await host.waitFor("snapshot", () => snapshots() > count);
    await players[1]!.client.waitFor("snapshot", (m) => m.phase === "revealed");
    // Seul le score personnel (`me`) du joueur relit le classement, pas la révélation.
    const callsAfterResumes = spy.mock.calls.length;
    expect(callsAfterResumes).toBe(1);

    host.send({ type: "kick", playerId: players[0]!.playerId });
    await host.waitFor("player_left");
    count = snapshots();
    host.send({ type: "resume" });
    await host.waitFor("snapshot", () => snapshots() > count);
    const snapshot = host.messages.filter((m) => m.type === "snapshot").at(-1)!;
    expect(snapshot.reveal?.ranking?.map((r) => r.pseudo)).toEqual(["Joueur 1"]);
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterResumes);
    spy.mockRestore();
  });

  it("l'animateur ne peut plus exclure une fois la partie terminée : le classement final est figé", async () => {
    const { host, players } = await game(1);
    await finishGame(host);
    host.send({ type: "kick", playerId: players[0]!.playerId });
    await host.waitFor("error", (m) => m.code === "wrong_phase");
    host.send({ type: "resume" });
    const snapshot = await host.waitFor("snapshot", (m) => m.phase === "finished");
    expect(snapshot.ranking?.map((r) => r.pseudo)).toEqual(["Joueur 0"]);
  });
});
