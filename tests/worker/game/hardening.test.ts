import { exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { PLAYER_TOKEN_TTL_MS, WS_SUBPROTOCOL } from "../../../src/shared/protocol";
import {
  closeCodeOf, connect, createGame, floodUntilClosed, hostToken, join, newCode, reuseCode, sessionRow, setup, sidFor, signFor, stubFor, withoutCorrection,
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

const closeOf = (client: Client) => new Promise<CloseEvent>((resolve) => client.ws.addEventListener("close", resolve));

describe("aucune écriture pour un code inconnu", () => {
  it("un WebSocket écran ou joueur sur un code inconnu ne crée ni tables ni alarme dans un Durable Object", async () => {
    const code = newCode();
    expect(await closeCodeOf(code, await signFor(code, { code, role: "screen" }))).toBe(4004);
    expect((await join(code, "Awa")).status).toBe(404);
    const stub = stubFor(code);
    expect(await runInDurableObject(stub, (_i, state) => state.storage.sql.exec("SELECT name FROM sqlite_master").toArray())).toEqual([]);
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull();
  });

  it("D1 porte le code dès la création de la partie, et le passe à « terminée » à la fin", async () => {
    const { code, host } = await game(0);
    const sid = (await import("./helpers")).sidFor(code);
    expect(await sessionRow(sid)).toMatchObject({ status: "lobby" });
    await finishGame(host);
    expect(await sessionRow(sid)).toMatchObject({ status: "ended" });
  });
});

describe("identité de partie (sid)", () => {
  it("un jeton d'une ancienne partie au même code est refusé, la nouvelle partie reste isolée", async () => {
    const old = await game(1);
    const oldToken = old.players[0]!.token;
    // Le code n'est repris qu'une fois l'ancienne partie terminée (voir la course entre deux hôtes).
    await finishGame(old.host);
    const sid = reuseCode(old.code);
    await createGame(old.code, undefined, sid);
    const host = await connect(old.code, await hostToken(old.code));
    opened.push(host);

    expect(await closeCodeOf(old.code, oldToken)).toBe(4004);
    expect(await closeCodeOf(old.code, await signFor(old.code, { code: old.code, role: "screen", sid: "autre" }))).toBe(4004);
    // Le pseudo de l'ancienne partie est libre dans la nouvelle : les états ne se mélangent pas.
    expect((await join(old.code, "Joueur 0")).status).toBe(201);
    expect(await sqlOf(old.code, "SELECT COUNT(*) AS n FROM players")).toEqual([{ n: 1 }]);
  });

  // Ex-401 : un jeton authentique d'une autre partie sous le même code reçoit, comme au routeur, une fermeture
  // applicative (4004 écran et joueur, 4001 hôte) au lieu d'un refus HTTP que le navigateur réduirait à un 1006.
  it("le DO de la partie refuse lui-même un jeton de même code mais d'un autre sid", async () => {
    const { code } = await game(0);
    for (const [role, expected] of [["screen", 4004], ["player", 4004], ["host", 4001]] as const) {
      const closeCode = await runInDurableObject(stubFor(code), async (instance) => {
        const token = await signFor(code, { code, role, sid: "imposteur", playerId: role === "player" ? "x" : undefined });
        const response = await instance.fetch(new Request(`https://x.test/ws/${code}`, { headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${WS_SUBPROTOCOL}, ${token}` } }));
        expect(response.status).toBe(101);
        const ws = response.webSocket!;
        const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
        ws.accept();
        return closed;
      });
      expect(closeCode, role).toBe(expected);
    }
    // Un jeton falsifié reste un refus HTTP 401.
    const forged = await runInDurableObject(stubFor(code), async (instance) => {
      const token = `${await signFor(code, { code, role: "screen", sid: "imposteur" })}x`;
      return (await instance.fetch(new Request(`https://x.test/ws/${code}`, { headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${WS_SUBPROTOCOL}, ${token}` } }))).status;
    });
    expect(forged).toBe(401);
  });

  it("le jeton dans la query string n'est plus accepté", async () => {
    const { code } = await game(0);
    const token = await hostToken(code);
    const response = await exports.default.fetch(`https://exemple.test/ws/${code}?token=${encodeURIComponent(token)}`, { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(401);
  });
});

describe("purge des parties abandonnées", () => {
  it("l'inactivité de l'hôte pendant 24 h supprime tout, y compris en lobby, et l'instance vivante répond proprement", async () => {
    const { code, host } = await game(1);
    const stub = stubFor(code);
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    // Alarme prématurée : rien n'est supprimé.
    await runDurableObjectAlarm(stub);
    expect((await sqlOf(code, "SELECT COUNT(*) AS n FROM players"))[0]).toEqual({ n: 1 });

    const before = (await sqlOf<{ value: string }>(code, "SELECT value FROM meta WHERE key = 'last_host_at'"))[0]!.value;
    host.send({ type: "start" });
    await host.waitFor("question");
    const after = (await sqlOf<{ value: string }>(code, "SELECT value FROM meta WHERE key = 'last_host_at'"))[0]!.value;
    expect(Number(after)).toBeGreaterThanOrEqual(Number(before));

    await runInDurableObject(stub, (_i, state) =>
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'last_host_at'", String(Date.now() - PLAYER_TOKEN_TTL_MS - 1000)));
    await runDurableObjectAlarm(stub);
    // L'abandon est d'abord clôturé avec son bilan : D1 libère le code et garde le joueur.
    expect((await sessionRow(sidFor(code)))?.status).toBe("ended");
    expect((await sqlOf(code, "SELECT COUNT(*) AS n FROM players"))[0]).toEqual({ n: 1 });
    await runInDurableObject(stub, (_i, state) => state.storage.sql.exec("UPDATE meta SET value = '1' WHERE key = 'finished_at'"));
    await runDurableObjectAlarm(stub);
    expect(await sqlOf(code, "SELECT name FROM sqlite_master WHERE name = 'meta'")).toEqual([]);
    // Même instance : pas d'erreur "no such table", la partie est simplement introuvable.
    expect(await stub.join("Retardataire")).toEqual({ ok: false, error: "game_not_found" });
    expect((await join(code, "Retardataire")).status).toBe(404);
  });

  it("une partie dont la dernière commande hôte est récente n'est pas purgée par l'alarme", async () => {
    const { code, host } = await game(0);
    host.send({ type: "start" });
    await host.waitFor("question");
    await runDurableObjectAlarm(stubFor(code));
    expect(await sqlOf(code, "SELECT name FROM sqlite_master WHERE name = 'meta'")).toHaveLength(1);
  });
});

describe("limites des messages entrants", () => {
  it("un message binaire ferme la connexion (1009)", async () => {
    const { host } = await game(0);
    const closed = closeOf(host);
    host.ws.send(new Uint8Array([1, 2, 3]));
    expect((await closed).code).toBe(1009);
  });

  it("un message de plus de 2 Ko ferme la connexion (1009), un message de 2 Ko pile reste lu", async () => {
    const { host, players } = await game(1);
    const player = players[0]!.client;
    const closed = closeOf(player);
    player.ws.send(JSON.stringify({ type: "resume", pad: "x".repeat(3000) }));
    expect((await closed).code).toBe(1009);
    host.ws.send(" ".repeat(2000) + JSON.stringify({ type: "resume" }));
    await host.waitFor("snapshot", () => host.messages.filter((m) => m.type === "snapshot").length >= 2);
  });

  it("un flot de messages épuise le seau à jetons et ferme la connexion (1008)", { timeout: 60_000 }, async () => {
    const { host } = await game(0);
    const closed = closeOf(host);
    expect((await floodUntilClosed(host, closed))?.code).toBe(1008);
  });

  it("une rafale raisonnable (20 messages) reste acceptée", async () => {
    const { host } = await game(0);
    for (let i = 0; i < 20; i += 1) host.send({ type: "resume" });
    await host.waitFor("snapshot", () => host.messages.filter((m) => m.type === "snapshot").length >= 21);
  });
});

describe("étiquettes d'hibernation", () => {
  it("cible hôte, écran et joueur sans parcourir les sockets, et remplace le socket zombie", async () => {
    const { code, players } = await game(1);
    const screen = await connect(code, await signFor(code, { code, role: "screen" }));
    opened.push(screen);
    const playerId = players[0]!.playerId;
    const count = (tag: string) => runInDurableObject(stubFor(code), (_i, state) => state.getWebSockets(tag).length);
    expect(await count("host")).toBe(1);
    expect(await count("screen")).toBe(1);
    expect(await count("player")).toBe(1);
    expect(await count(`p:${playerId}`)).toBe(1);
    const second = await connect(code, players[0]!.token);
    opened.push(second);
    await new Promise((r) => setTimeout(r, 50));
    expect(await count(`p:${playerId}`)).toBe(1);
  });
});

describe("exclusion d'un joueur (kick)", () => {
  it("ferme ses sockets, invalide son jeton, bannit son pseudo et prévient l'hôte", async () => {
    const { code, host, players } = await game(2);
    const [a, b] = players as [typeof players[0], typeof players[0]];
    const closed = closeOf(a!.client);
    host.send({ type: "kick", playerId: a!.playerId });
    expect((await closed).code).toBe(4003);
    expect(await host.waitFor("player_left")).toMatchObject({ playerId: a!.playerId, count: 1 });
    expect(await closeCodeOf(code, a!.token)).toBe(4003);
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM players")).toEqual([{ n: 1 }]);
    // Décision produit : le pseudo exclu reste banni dans cette partie, un autre pseudo est accepté.
    expect((await join(code, "Joueur 0")).status).toBe(409);
    expect((await join(code, "Autre pseudo")).status).toBe(201);

    b!.client.send({ type: "kick", playerId: b!.playerId });
    await b!.client.waitFor("error", (m) => m.code === "forbidden");
    host.send({ type: "kick", playerId: "inconnu" });
    await host.waitFor("error", (m) => m.code === "unknown_player");
  });

  it("retire aussi les réponses du joueur exclu du compteur et du classement", async () => {
    const { code, host, players } = await game(2);
    host.send({ type: "start" });
    await Promise.all(players.map((p) => p.client.waitFor("question")));
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    await players[0]!.client.waitFor("answer_ack");
    host.send({ type: "kick", playerId: players[0]!.playerId });
    await host.waitFor("player_left");
    expect(await sqlOf(code, "SELECT COUNT(*) AS n FROM answers")).toEqual([{ n: 0 }]);
    host.send({ type: "reveal" });
    const reveal = await players[1]!.client.waitFor("reveal");
    expect(reveal.ranking).toHaveLength(1);
  });
});

describe("correction masquée : ni résultat, ni score, ni classement avant la fin", () => {
  it("reveal et instantané des joueurs et de l'écran, puis scores au message finished", async () => {
    const { code, host, players } = await game(2, withoutCorrection);
    const screen = await connect(code, await signFor(code, { code, role: "screen" }));
    opened.push(screen);
    const [a, b] = players.map((p) => p.client) as [Client, Client];
    host.send({ type: "start" });
    await a.waitFor("question");
    a.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    b.send({ type: "answer", questionId: "q1", optionIds: ["q1a"] });
    await Promise.all([a.waitFor("answer_ack"), b.waitFor("answer_ack")]);
    host.send({ type: "reveal" });
    const hostReveal = await host.waitFor("reveal");
    expect(hostReveal.correctOptionIds).toEqual(["q1b"]);
    expect(hostReveal.ranking?.[0]).toMatchObject({ score: 1 });

    for (const client of [a, b, screen]) {
      const reveal = await client.waitFor("reveal");
      expect(Object.keys(reveal).sort()).toEqual(["questionId", "type"]);
    }
    a.send({ type: "resume" });
    const snapshot = await a.waitFor("snapshot", (m) => m.phase === "revealed");
    expect(snapshot.reveal).toEqual({ questionId: "q1" });
    expect(snapshot.me?.score).toBeUndefined();
    expect(snapshot.me).toMatchObject({ answered: true });

    host.send({ type: "next" });
    for (const id of ["q2", "q3"]) {
      await a.waitFor("question", (q) => q.questionId === id);
      host.send({ type: "reveal" });
      await a.waitFor("reveal", (r) => r.questionId === id);
      host.send({ type: "next" });
    }
    const finished = await a.waitFor("finished");
    expect(finished.ranking.map((r) => r.score)).toEqual([1, 0]);
    a.send({ type: "resume" });
    const last = await a.waitFor("snapshot", (m) => m.phase === "finished");
    expect(last.me?.score).toBe(1);
  });
});

describe("regroupement du compteur de réponses", () => {
  it("12 réponses simultanées produisent moins de 12 diffusions, la dernière donnant le total", { timeout: 60_000 }, async () => {
    const { code, host, players } = await game(12);
    host.send({ type: "start" });
    await Promise.all(players.map((p) => p.client.waitFor("question")));
    players.forEach((p) => p.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] }));
    await host.waitFor("answer_count", (m) => m.count === 12);
    const counts = host.messages.filter((m) => m.type === "answer_count");
    // Au plus un compteur par fenêtre de 250 ms : la borne suit l'étalement réel des réponses côté serveur, qui s'allonge
    // sous machine chargée, au lieu de supposer qu'elles arrivent toutes ensemble.
    const [{ span }] = await sqlOf<{ span: number }>(code, "SELECT MAX(received_at) - MIN(received_at) AS span FROM answers");
    expect(counts.length).toBeLessThanOrEqual(Math.floor(span! / 250) + 2);
    // Réponses resserrées (moins de 2,5 s d'étalement) : le regroupement doit toujours économiser des diffusions.
    if (span! < 2_500) expect(counts.length).toBeLessThan(12);
    expect(counts.at(-1)).toMatchObject({ count: 12, total: 12 });
  });
});

describe("phase corrompue", () => {
  it("une valeur de phase inconnue retombe sur lobby au lieu de planter", async () => {
    const { code, host } = await game(0);
    await runInDurableObject(stubFor(code), (_i, state) => state.storage.sql.exec("UPDATE meta SET value = 'bizarre' WHERE key = 'phase'"));
    host.send({ type: "resume" });
    const snapshot = await host.waitFor("snapshot", (m) => m.phase === "lobby" && host.messages.filter((x) => x.type === "snapshot").length >= 2);
    expect(snapshot.phase).toBe("lobby");
  });
});

describe("pseudos : Unicode", () => {
  it("NFKC : une variante pleine chasse ou décomposée est le même pseudo", async () => {
    const { code } = await game(0);
    expect((await join(code, "ＡＢＣ")).status).toBe(201);
    expect((await join(code, "abc")).status).toBe(409);
    expect((await join(code, "élan")).status).toBe(201);
    expect((await join(code, "Élan")).status).toBe(409);
  });

  it("refuse les caractères invisibles et de contrôle, accepte les emojis composés", async () => {
    const { code } = await game(0);
    for (const bad of ["a​b", "‮gnp", "a\u0000b", "x‎y", "a\nb", "﻿​"]) {
      expect((await join(code, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await join(code, "👨‍👩‍👧")).status).toBe(201);
  });

  it("longueur comptée en graphèmes, et chaîne brute plafonnée à 200", async () => {
    const { code } = await game(0);
    expect((await join(code, "👨‍👩‍👧".repeat(20))).status).toBe(201);
    expect((await join(code, "🎉".repeat(21))).status).toBe(400);
    expect((await join(code, " ".repeat(150) + "x".repeat(5))).status).toBe(201);
    expect((await join(code, "x ".repeat(101))).status).toBe(400);
  });
});
