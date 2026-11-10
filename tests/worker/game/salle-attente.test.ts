import { afterEach, describe, expect, it } from "vitest";
import { LOBBY_RECENT_PLAYERS } from "../../../src/shared/protocol";
import { addPlayer, join, setup, type Client } from "./helpers";

const opened: Client[] = [];
afterEach(() => {
  for (const client of opened.splice(0)) client.close();
});

async function lobby(playerCount: number) {
  const result = await setup(playerCount);
  opened.push(result.host, ...result.players.map((p) => p.client));
  return result;
}

const lobbyMessages = (client: Client) => client.messages.flatMap((m) => (m.type === "lobby_players" ? [m] : []));
const pseudos = (m: { players: { pseudo: string }[] }) => m.players.map((p) => p.pseudo);

describe("salle d'attente : lobby_players", () => {
  it("chaque joueur reçoit le compteur et les derniers arrivés à chaque arrivée", async () => {
    const { code, players } = await lobby(1);
    const second = await addPlayer(code, "Deuxieme");
    opened.push(second.client);
    const first = await players[0]!.client.waitFor("lobby_players", (m) => m.playerCount === 2);
    expect(pseudos(first)).toEqual(["Joueur 0", "Deuxieme"]);
    const third = await addPlayer(code, "Troisieme");
    opened.push(third.client);
    const last = await players[0]!.client.waitFor("lobby_players", (m) => m.playerCount === 3);
    expect(pseudos(last)).toEqual(["Joueur 0", "Deuxieme", "Troisieme"]);
  });

  it("le départ d'un joueur exclu est diffusé aux joueurs restants", async () => {
    const { host, players } = await lobby(2);
    host.send({ type: "kick", playerId: players[1]!.playerId });
    const message = await players[0]!.client.waitFor("lobby_players", (m) => m.playerCount === 1);
    expect(pseudos(message)).toEqual(["Joueur 0"]);
  });

  it(`ne liste que les ${LOBBY_RECENT_PLAYERS} derniers arrivés`, async () => {
    const { code, players } = await lobby(1);
    for (let i = 0; i < 10; i += 1) expect((await join(code, `Arrivant ${i}`)).status).toBe(201);
    const message = await players[0]!.client.waitFor("lobby_players", (m) => m.playerCount === 11);
    expect(message.players).toHaveLength(LOBBY_RECENT_PLAYERS);
    expect(pseudos(message)).toEqual(Array.from({ length: LOBBY_RECENT_PLAYERS }, (_, i) => `Arrivant ${i + 3}`));
  });

  it("20 arrivées simultanées produisent peu de diffusions, la dernière donnant le total", { timeout: 60_000 }, async () => {
    const { code, players } = await lobby(1);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => join(code, `Rafale ${i}`)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    await players[0]!.client.waitFor("lobby_players", (m) => m.playerCount === 21);
    expect(lobbyMessages(players[0]!.client).length).toBeLessThan(20);
  });

  it("l'instantané d'un joueur qui se connecte porte le même contenu (players et playerCount)", async () => {
    const { code, players } = await lobby(2);
    const late = await addPlayer(code, "Dernier");
    opened.push(late.client);
    const snapshot = late.client.messages.find((m) => m.type === "snapshot")!;
    expect(snapshot).toMatchObject({ phase: "lobby", playerCount: 3 });
    expect(snapshot.type === "snapshot" && snapshot.players?.map((p) => p.pseudo)).toEqual(["Joueur 0", "Joueur 1", "Dernier"]);
    expect(players).toHaveLength(2);
  });

  it("plus aucun lobby_players une fois la partie lancée", async () => {
    const { code, host, players } = await lobby(1);
    host.send({ type: "start" });
    await players[0]!.client.waitFor("question");
    const before = lobbyMessages(players[0]!.client).length;
    expect((await join(code, "Retardataire")).status).toBe(201);
    await host.waitFor("player_joined", (m) => m.player.pseudo === "Retardataire");
    expect(lobbyMessages(players[0]!.client).length).toBe(before);
  });
});

describe("fin de partie : total et rang serveur", () => {
  it("finished et l'instantané de fin portent total, et chaque entrée un rang unique", async () => {
    const { host, players } = await lobby(2);
    host.send({ type: "start" });
    for (const q of ["q1", "q2", "q3"]) {
      await host.waitFor("question", (m) => m.questionId === q);
      host.send({ type: "reveal" });
      await host.waitFor("reveal", (m) => m.questionId === q);
      host.send({ type: "next" });
    }
    const player = await players[0]!.client.waitFor("finished");
    expect(player.total).toBe(3);
    expect((await host.waitFor("finished")).total).toBe(3);
    expect(player.ranking.map((r) => r.rank)).toEqual([1, 2]);
    players[0]!.client.send({ type: "resume" });
    const snapshot = await players[0]!.client.waitFor("snapshot", (m) => m.phase === "finished");
    expect(snapshot.total).toBe(3);
    expect(snapshot.ranking?.map((r) => r.rank)).toEqual([1, 2]);
  });
});
