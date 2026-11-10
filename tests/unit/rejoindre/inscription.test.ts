import { describe, expect, it, vi } from "vitest";
import { JOIN_MESSAGES, joinGame, playPath, readToken, tokenKey, validatePseudo, writeToken } from "../../../src/islands/rejoindre/inscription";

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const reponse = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("clé et chemin", () => {
  it("met le code en majuscules", () => {
    expect(tokenKey("k7q2mb")).toBe("quizdeszeles:jeton:K7Q2MB");
    expect(playPath("k7q2mb")).toBe("/j/K7Q2MB/jouer");
  });
});

describe("jeton en localStorage", () => {
  it("écrit puis relit playerId et token", () => {
    const store = fakeStore();
    expect(writeToken(store, "K7Q2MB", { playerId: "p1", token: "t" })).toBe(true);
    expect(readToken(store, "k7q2mb")).toEqual({ playerId: "p1", token: "t" });
  });
  it("ignore une valeur absente, corrompue ou incomplète", () => {
    expect(readToken(fakeStore(), "K7Q2MB")).toBeNull();
    expect(readToken(fakeStore({ [tokenKey("K7Q2MB")]: "{pas du json" }), "K7Q2MB")).toBeNull();
    expect(readToken(fakeStore({ [tokenKey("K7Q2MB")]: JSON.stringify({ playerId: "p" }) }), "K7Q2MB")).toBeNull();
  });
  it("ne lève pas quand le stockage refuse l'écriture", () => {
    const plein = { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new Error("quota"); } };
    expect(writeToken(plein, "K7Q2MB", { playerId: "p", token: "t" })).toBe(false);
  });
  it("garde les parties séparées", () => {
    const store = fakeStore();
    writeToken(store, "AAAAAA", { playerId: "a", token: "ta" });
    expect(readToken(store, "BBBBBB")).toBeNull();
  });
});

describe("validatePseudo", () => {
  it("accepte 1 à 20 caractères", () => {
    expect(validatePseudo("Grâce_22")).toBeNull();
    expect(validatePseudo("a".repeat(20))).toBeNull();
  });
  it("refuse le vide, les espaces et plus de 20 caractères", () => {
    expect(validatePseudo("")).toBe(JOIN_MESSAGES.invalid_pseudo);
    expect(validatePseudo("   ")).toBe(JOIN_MESSAGES.invalid_pseudo);
    expect(validatePseudo("a".repeat(21))).toBe(JOIN_MESSAGES.invalid_pseudo);
  });
});

describe("joinGame", () => {
  it("renvoie le jeton sur 201 et poste le pseudo en JSON", async () => {
    const doFetch = vi.fn(() => reponse(201, { playerId: "p1", token: "tok" }));
    const result = await joinGame("k7q2mb", "Léa", doFetch as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, playerId: "p1", token: "tok" });
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/parties/K7Q2MB/joueurs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ pseudo: "Léa" });
  });

  it.each([
    [400, "invalid_pseudo"],
    [409, "pseudo_taken"],
    [409, "game_full"],
    [404, "game_not_found"],
    [410, "game_finished"],
  ])("traduit %i %s", async (status, error) => {
    const result = await joinGame("K7Q2MB", "Léa", (() => reponse(status, { error })) as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error });
    expect(JOIN_MESSAGES[error as keyof typeof JOIN_MESSAGES]).not.toBe("");
  });

  it("signale une erreur réseau", async () => {
    const result = await joinGame("K7Q2MB", "Léa", (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error: "network" });
  });

  it("classe en inconnu un code non prévu ou un corps illisible", async () => {
    expect(await joinGame("K7Q2MB", "L", (() => reponse(500, { error: "server_misconfigured" })) as unknown as typeof fetch)).toEqual({ ok: false, error: "unknown" });
    expect(await joinGame("K7Q2MB", "L", (() => Promise.resolve(new Response("oups", { status: 502 }))) as unknown as typeof fetch)).toEqual({ ok: false, error: "unknown" });
    expect(await joinGame("K7Q2MB", "L", (() => reponse(201, { playerId: "p" })) as unknown as typeof fetch)).toEqual({ ok: false, error: "unknown" });
  });

  it("n'utilise aucun tiret cadratin dans les messages", () => {
    for (const message of Object.values(JOIN_MESSAGES)) expect(message).not.toContain("—");
  });
});

describe("jeton expiré", () => {
  const jetonExpirantA = (e: number) =>
    `${btoa(JSON.stringify({ c: "K7Q2MB", s: "s1", r: "player", p: "p1", e })).replace(/=+$/, "")}.signature`;

  it("traite un jeton expiré comme absent et supprime sa clé", () => {
    const store = fakeStore();
    writeToken(store, "K7Q2MB", {
      playerId: "p1",
      token: jetonExpirantA(1000),
    });
    expect(readToken(store, "K7Q2MB", 2000)).toBeNull();
    expect(store.getItem(tokenKey("K7Q2MB"))).toBeNull();
  });
  it("traite l'échéance atteinte comme expirée", () => {
    const store = fakeStore();
    writeToken(store, "K7Q2MB", {
      playerId: "p1",
      token: jetonExpirantA(2000),
    });
    expect(readToken(store, "K7Q2MB", 2000)).toBeNull();
  });
  it("garde un jeton encore valide", () => {
    const store = fakeStore();
    const token = jetonExpirantA(5000);
    writeToken(store, "K7Q2MB", { playerId: "p1", token });
    expect(readToken(store, "K7Q2MB", 2000)).toEqual({ playerId: "p1", token });
    expect(store.getItem(tokenKey("K7Q2MB"))).not.toBeNull();
  });
  it("lit l'échéance en base64url", () => {
    const store = fakeStore();
    const payload = btoa(JSON.stringify({ e: 1000, note: "???>>>" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    writeToken(store, "K7Q2MB", { playerId: "p1", token: `${payload}.sig` });
    expect(readToken(store, "K7Q2MB", 2000)).toBeNull();
  });
});
