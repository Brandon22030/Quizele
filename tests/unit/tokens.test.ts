import { describe, expect, it } from "vitest";
import { signToken, tokenFromRequest, verifyToken } from "../../src/server/game/tokens";
import { WS_SUBPROTOCOL } from "../../src/shared/protocol";

const SECRET = "secret-de-test-unitaire-32-caracteres-minimum";
const claims = { code: "ABC123", sid: "sid-1", role: "player" as const, playerId: "p1" };

describe("tokens", () => {
  it("refuse de signer ou vérifier avec un secret de moins de 32 octets", async () => {
    await expect(signToken("trop-court", claims)).rejects.toThrow(/32 octets/);
    await expect(verifyToken("trop-court", "a.b", { code: "ABC123" })).rejects.toThrow(/32 octets/);
    await expect(signToken("é".repeat(15), claims)).rejects.toThrow(/32 octets/);
    await expect(signToken("é".repeat(16), claims)).resolves.toBeTypeOf("string");
  });

  it("aller-retour, avec sid attendu", async () => {
    const token = await signToken(SECRET, claims);
    expect(await verifyToken(SECRET, token, { code: "ABC123" })).toMatchObject({ sid: "sid-1", playerId: "p1" });
    expect(await verifyToken(SECRET, token, { code: "ABC123", sid: "sid-1" })).not.toBeNull();
    expect(await verifyToken(SECRET, token, { code: "ABC123", sid: "sid-2" })).toBeNull();
    expect(await verifyToken(SECRET, token, { code: "ZZZ999" })).toBeNull();
  });

  it("refuse un jeton sans sid ou expiré", async () => {
    const token = await signToken(SECRET, claims, 1000, 10);
    expect(await verifyToken(SECRET, token, { code: "ABC123" }, 2000)).toBeNull();
    const payload = btoa(JSON.stringify({ c: "ABC123", r: "host", e: Date.now() + 1e6 })).replace(/=+$/, "");
    expect(await verifyToken(SECRET, `${payload}.AAAA`, { code: "ABC123" })).toBeNull();
  });

  it("extrait le jeton du sous-protocole sans jamais le chercher dans l'URL", () => {
    const withToken = new Request("https://x.test/ws/ABC123?token=piege", { headers: { "Sec-WebSocket-Protocol": `${WS_SUBPROTOCOL}, jeton.signe` } });
    expect(tokenFromRequest(withToken)).toBe("jeton.signe");
    expect(tokenFromRequest(new Request("https://x.test/ws/ABC123?token=piege"))).toBe("");
    expect(tokenFromRequest(new Request("https://x.test/", { headers: { "Sec-WebSocket-Protocol": WS_SUBPROTOCOL } }))).toBe("");
  });
});
