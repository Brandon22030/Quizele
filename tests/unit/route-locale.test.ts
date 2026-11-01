import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// La route de charge ne doit répondre que dans l'environnement local : on la charge avec un `env` simulé.
const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, launched: 0 }));
vi.mock("cloudflare:workers", () => ({ env: new Proxy({}, { get: (_t, key: string) => state.env[key] }) }));
vi.mock("../../src/server/game/launch", () => ({ launchGame: async () => ((state.launched += 1), { sessionId: "s", code: "ABC234", hostToken: "t" }) }));
vi.mock("../../src/server/game/local", () => ({ LOCAL_USER: { id: "local" }, createLocalGame: async () => ((state.launched += 1), { code: "ABC234" }) }));

const SECRET = "secret-de-test";
const request = (headers: Record<string, string> = {}) =>
  new Request("https://exemple.test/api/parties/local", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });

async function post(headers?: Record<string, string>) {
  const { POST } = await import("../../src/pages/api/parties/local");
  return POST({ request: request(headers) } as never);
}

describe("POST /api/parties/local", () => {
  beforeEach(() => {
    state.launched = 0;
  });

  it("404 quand MAIL_TRANSPORT n'est pas « console », même avec le bon secret", async () => {
    for (const transport of [undefined, "", "resend", "Console"]) {
      state.env = { MAIL_TRANSPORT: transport, PLAYER_TOKEN_SECRET: SECRET };
      expect((await post({ "x-local-secret": SECRET })).status).toBe(404);
    }
    expect(state.launched).toBe(0);
  });

  it("404 sans secret serveur configuré, même avec un en-tête vide", async () => {
    state.env = { MAIL_TRANSPORT: "console", PLAYER_TOKEN_SECRET: undefined };
    expect((await post({ "x-local-secret": "" })).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(state.launched).toBe(0);
  });

  it("404 sans en-tête ou avec un mauvais en-tête, 201 avec le bon", async () => {
    state.env = { MAIL_TRANSPORT: "console", PLAYER_TOKEN_SECRET: SECRET };
    expect((await post()).status).toBe(404);
    expect((await post({ "x-local-secret": "autre" })).status).toBe(404);
    expect(state.launched).toBe(0);
    expect((await post({ "x-local-secret": SECRET })).status).toBe(201);
    expect(state.launched).toBe(1);
  });
});

describe("configuration de déploiement", () => {
  // Les environnements nommés n'héritent pas des vars du niveau supérieur : preview et production envoient par Resend,
  // donc la route de charge y est inaccessible quel que soit le secret.
  const config = readFileSync("wrangler.jsonc", "utf8");
  const section = (name: string) => {
    const start = config.indexOf(`"${name}": {`, config.indexOf('"env"'));
    return config.slice(start, start + 1500);
  };

  it("MAIL_TRANSPORT vaut « console » uniquement au niveau supérieur", () => {
    expect(config.match(/"MAIL_TRANSPORT":\s*"console"/g)).toHaveLength(1);
    expect(config.indexOf('"MAIL_TRANSPORT": "console"')).toBeLessThan(config.indexOf('"env"'));
    for (const name of ["preview", "production"]) expect(section(name)).toMatch(/"MAIL_TRANSPORT":\s*"resend"/);
  });
});
