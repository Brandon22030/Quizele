import { afterEach, describe, expect, it } from "vitest";
import { closeCodeOf, connect, join, setup, type Client } from "./helpers";

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

describe("seau à jetons et reconnexion en boucle", () => {
  it("le seau ne se remet pas à plein à chaque reconnexion du même joueur", async () => {
    const { code, players } = await game(1);
    const token = players[0]!.token;
    let processed = 0;
    let closedFor1008 = 0;
    for (let round = 0; round < 6; round += 1) {
      const client = await connect(code, token);
      opened.push(client);
      const closed = closeOf(client);
      for (let i = 0; i < 25; i += 1) client.send({ type: "resume" });
      await Promise.race([closed, new Promise((r) => setTimeout(r, 150))]);
      processed += client.messages.filter((m) => m.type === "snapshot").length;
      if (client.ws.readyState !== WebSocket.OPEN && (await Promise.race([closed, Promise.resolve(null)]))?.code === 1008) closedFor1008 += 1;
    }
    // 150 messages en moins d'une seconde : capacité 30 + recharge de 10/s => bien moins de 60 traités.
    expect(processed).toBeLessThan(60);
    expect(closedFor1008).toBeGreaterThan(0);
  });

  it("un joueur exclu ne peut pas se reconnecter en boucle, ni se réinscrire sous un autre jeton valide", async () => {
    const { code, host, players } = await game(1);
    const closed = closeOf(players[0]!.client);
    host.send({ type: "kick", playerId: players[0]!.playerId });
    expect((await closed).code).toBe(4003);
    // 4003 est définitif : le client cesse de se reconnecter au lieu de boucler sur un refus anonyme.
    for (let i = 0; i < 5; i += 1) expect(await closeCodeOf(code, players[0]!.token)).toBe(4003);
    // Décision produit : pas de retour sous le même pseudo (ni une variante de casse), un autre pseudo est accepté.
    expect((await join(code, "Joueur 0")).status).toBe(409);
    expect((await join(code, "JOUEUR 0")).status).toBe(409);
    expect((await join(code, "Autre")).status).toBe(201);
  });

  it("classement final cohérent après exclusion : le joueur exclu n'y figure pas", async () => {
    const { host, players } = await game(2);
    host.send({ type: "start" });
    await Promise.all(players.map((p) => p.client.waitFor("question")));
    players[0]!.client.send({ type: "answer", questionId: "q1", optionIds: ["q1b"] });
    await players[0]!.client.waitFor("answer_ack");
    host.send({ type: "kick", playerId: players[0]!.playerId });
    await host.waitFor("player_left");
    for (const q of ["q1", "q2", "q3"]) {
      if (q !== "q1") await host.waitFor("question", (m) => m.questionId === q);
      host.send({ type: "reveal" });
      await host.waitFor("reveal", (m) => m.questionId === q);
      host.send({ type: "next" });
    }
    const finished = await players[1]!.client.waitFor("finished");
    expect(finished.ranking.map((r) => r.pseudo)).toEqual(["Joueur 1"]);
    expect(finished.ranking[0]).toMatchObject({ score: 0 });
  });
});
