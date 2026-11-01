import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("socle : Worker Astro", () => {
  it("sert l'accueil en 200 avec lang fr", async () => {
    const res = await SELF.fetch("https://exemple.test/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toMatch(/<html[^>]*\slang="fr"/);
  });

  it("route /ws/<code> vers le routeur temps réel (stub 501) et non vers Astro", async () => {
    const res = await SELF.fetch("https://exemple.test/ws/XXXXXX");
    expect(res.status).toBe(501);
  });

  it("n'envoie pas /ws sans barre finale vers le routeur", async () => {
    const res = await SELF.fetch("https://exemple.test/ws");
    expect(res.status).not.toBe(501);
  });

  it("renvoie 404 pour une route inconnue", async () => {
    const res = await SELF.fetch("https://exemple.test/inexistant");
    expect(res.status).toBe(404);
  });

  it("expose les bindings D1, DO et R2 et les vars de test", async () => {
    expect(env.DB).toBeDefined();
    expect(env.MEDIA).toBeDefined();
    expect(env.GAME_SESSION).toBeDefined();
    expect(env.MAIL_TRANSPORT).toBe("console");
    expect(env.PLAYER_TOKEN_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it("D1 local répond à une requête", async () => {
    const row = await env.DB.prepare("SELECT 1 AS un").first<{ un: number }>();
    expect(row?.un).toBe(1);
  });

  it("R2 local accepte une écriture puis une lecture", async () => {
    await env.MEDIA.put("test/ok.txt", "bonjour");
    expect(await (await env.MEDIA.get("test/ok.txt"))?.text()).toBe("bonjour");
    await env.MEDIA.delete("test/ok.txt");
  });

  it("le Durable Object GameSession est adressable", async () => {
    const id = env.GAME_SESSION.idFromName("TEST01");
    expect(env.GAME_SESSION.get(id)).toBeDefined();
  });
});
