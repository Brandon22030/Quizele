import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYER_TOKEN_TTL_MS } from "../../../src/shared/protocol";
import {
  aliasStubFor, closeCodeOf, connect, hostToken, join, newCode, rawConnect, setup, signFor, stubFor,
  type Client,
} from "./helpers";

const opened: Client[] = [];
afterEach(() => {
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

// Ouvre un socket et renvoie son code de fermeture s'il est refermé dans le délai, null s'il reste ouvert.
async function openOrClosed(code: string, token: string, waitMs = 60): Promise<number | null> {
  const response = await rawConnect(code, token);
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  ws.accept();
  const result = await Promise.race([closed, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
  if (result === null) opened.push({ close: () => ws.close(1000) } as Client);
  return result;
}

describe("alias : comparaison-échange entre hôtes", () => {
  it("registerSid n'écrit que si l'alias vaut la valeur attendue", async () => {
    const alias = aliasStubFor(newCode());
    expect(await alias.registerSid("a", null)).toBe(true);
    expect(await alias.registerSid("b", null)).toBe(false);
    expect(await alias.registerSid("b", "x")).toBe(false);
    expect(await alias.currentSid()).toBe("a");
    expect(await alias.registerSid("b", "a")).toBe(true);
    expect(await alias.currentSid()).toBe("b");
  });

  // Le perdant était refusé en HTTP 409, que le navigateur ne voit que comme un 1006 : il se reconnectait en boucle.
  // Il reçoit désormais un socket refermé en 4001 (conflit entre hôtes, sa partie n'a jamais existé).
  it("deux hôtes simultanés sur le même code : un seul obtient la partie, l'autre est refermé en 4001", async () => {
    const code = newCode();
    const sids = [crypto.randomUUID(), crypto.randomUUID()];
    const tokens = await Promise.all(sids.map((sid) => signFor(code, { code, role: "host", sid })));
    const responses = await Promise.all(tokens.map((token) => rawConnect(code, token)));
    expect(responses.map((r) => r.status)).toEqual([101, 101]);
    const outcomes = await Promise.all(
      responses.map((response) => {
        const ws = response.webSocket!;
        const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
        ws.accept();
        return Promise.race([closed, new Promise<null>((r) => setTimeout(() => r(null), 100))]);
      }),
    );
    expect([...outcomes].sort()).toEqual([4001, null]);
    const winner = outcomes.indexOf(null);
    responses[winner]!.webSocket!.close(1000);
    expect(await aliasStubFor(code).currentSid()).toBe(sids[winner]);
  });

  it("un autre hôte est refusé tant que la partie est en cours, puis accepté quand elle est terminée", async () => {
    const { code, host } = await game(0);
    const intruder = await signFor(code, { code, role: "host", sid: crypto.randomUUID() });
    // Ex-409 : refus applicatif définitif (4001), sa partie n'ayant jamais existé.
    expect(await closeCodeOf(code, intruder)).toBe(4001);
    // Le même hôte (même sid) se reconnecte sans difficulté.
    const again = await connect(code, await hostToken(code));
    opened.push(again);
    await finishGame(host);
    const successor = await connect(code, intruder);
    opened.push(successor);
    expect(await aliasStubFor(code).currentSid()).not.toBe(null);
    expect((await join(code, "Nouveau")).status).toBe(201);
  });

  it("l'hôte d'une partie terminée dont le code a été repris est refermé en 4004, pas en 4001", async () => {
    const { code, host } = await game(0);
    const formerHost = await hostToken(code);
    await finishGame(host);
    const successor = await connect(code, await signFor(code, { code, role: "host", sid: crypto.randomUUID() }));
    opened.push(successor);
    expect(await closeCodeOf(code, formerHost)).toBe(4004);
  });

  it("une réservation toute récente, partie pas encore créée, bloque aussi un second hôte", async () => {
    const code = newCode();
    expect(await aliasStubFor(code).registerSid("reserve-en-cours", null)).toBe(true);
    // Ex-409 : conflit entre hôtes, refus applicatif définitif (4001).
    expect(await closeCodeOf(code, await signFor(code, { code, role: "host", sid: crypto.randomUUID() }))).toBe(4001);
  });
});

describe("fermetures applicatives définitives", () => {
  it("la purge ferme les sockets ouverts avec 4004, et un joueur qui revient reçoit 4004", async () => {
    const { code, players } = await game(1);
    const closed = closeOf(players[0]!.client);
    await runInDurableObject(stubFor(code), (_i, state) =>
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'last_host_at'", String(Date.now() - PLAYER_TOKEN_TTL_MS - 1000)));
    await runDurableObjectAlarm(stubFor(code));
    expect((await closed).code).toBe(4004);
    expect(await closeCodeOf(code, players[0]!.token)).toBe(4004);
  });

  it("le dépassement de débit reste 1008 et la taille 1009 : ce ne sont pas des fins définitives", async () => {
    const { players } = await game(1);
    const closed = closeOf(players[0]!.client);
    for (let i = 0; i < 60; i += 1) players[0]!.client.send({ type: "resume" });
    expect((await closed).code).toBe(1008);
  });
});

describe("seau à jetons et fréquence de connexion", () => {
  it("le seau d'un socket fermé proprement est conservé dans le SQLite et ne repart pas à plein", async () => {
    const { code, players } = await game(1);
    const { client, playerId, token } = players[0]!;
    const startedAt = Date.now();
    for (let i = 0; i < 20; i += 1) client.send({ type: "resume" });
    await client.waitFor("snapshot", () => client.messages.filter((m) => m.type === "snapshot").length >= 21);
    const closed = closeOf(client);
    client.close();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    const [row] = await sqlOf<{ tokens: number }>(code, `SELECT tokens FROM buckets WHERE key = 'p:${playerId}'`);
    // 30 - 21 jetons consommés + recharge de 10/s sur le temps réellement écoulé : borne qui tient sous machine chargée.
    const refill = (Date.now() - startedAt) / 100;
    expect(row!.tokens).toBeLessThan(9 + refill + 1);
    expect(row!.tokens).toBeLessThan(30);

    const next = await connect(code, token);
    opened.push(next);
    const nextClosed = closeOf(next);
    for (let i = 0; i < 25; i += 1) next.send({ type: "resume" });
    const reopenedAt = Date.now();
    await Promise.race([nextClosed, next.waitFor("snapshot", () => next.messages.filter((m) => m.type === "snapshot").length >= 25, 8_000).catch(() => null)]);
    const allowed = row!.tokens + ((Date.now() - reopenedAt) / 1000) * 10 + 2;
    expect(next.messages.filter((m) => m.type === "snapshot").length).toBeLessThanOrEqual(allowed);
    expect(allowed).toBeLessThan(30);
  });

  it("au-delà de 10 connexions d'affilée, le joueur est refermé (1008) avant d'atteindre la partie", async () => {
    const { code, players } = await game(1);
    const results: (number | null)[] = [];
    // addPlayer a déjà consommé une connexion.
    for (let i = 0; i < 12; i += 1) results.push(await openOrClosed(code, players[0]!.token, 20));
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
