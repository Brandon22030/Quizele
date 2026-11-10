import { describe, expect, it, vi } from "vitest";
import { sanitizeCode } from "../../../src/components/jeu/code-input";
import { JOIN_MESSAGES, isCompleteCode, joinGame, readToken, tokenKey, validatePseudo, writeToken } from "../../../src/islands/rejoindre/inscription";

const reponse = (status: number, body: unknown, brut = false) => Promise.resolve(new Response(brut ? String(body) : JSON.stringify(body), { status }));

describe("sanitizeCode : alphabet du serveur", () => {
  it("retire 0, O, 1, I, séparateurs, emoji ; accents ramenés à la lettre", () => {
    expect(sanitizeCode("a0o1i")).toBe("A");
    expect(sanitizeCode("k7q-2mb")).toBe("K7Q2MB");
    expect(sanitizeCode("É è ï")).toBe("EE");
    expect(sanitizeCode("😀")).toBe("");
    expect(sanitizeCode("")).toBe("");
    expect(sanitizeCode("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  });
  it("isCompleteCode : exactement 6", () => {
    expect(isCompleteCode("ABCDE")).toBe(false);
    expect(isCompleteCode("ABCDEF")).toBe(true);
    expect(isCompleteCode("ABCDEFG")).toBe(false);
  });
});

describe("validatePseudo", () => {
  const invalide = JOIN_MESSAGES.invalid_pseudo;
  it("refuse vide, espaces, invisibles, contrôle, trop long", () => {
    for (const p of ["", "   ", "​", "\u0000", "a\nb", "a".repeat(21), "🙂".repeat(21), "x".repeat(500)]) {
      expect(validatePseudo(p), JSON.stringify(p)).toBe(invalide);
    }
  });
  it("accepte 1 et 20 caractères, accents, emojis simples et composés comptés en graphèmes", () => {
    for (const p of ["a", "a".repeat(20), "Zoé", "🙂", "🙂".repeat(20), "👨‍👩‍👧".repeat(20), "Awa Diop", "  Léa  "]) {
      expect(validatePseudo(p), JSON.stringify(p)).toBeNull();
    }
  });
});

describe("joinGame : cas limites", () => {
  it("encode le code et le met en majuscules dans l'URL", async () => {
    const doFetch = vi.fn((..._args: Parameters<typeof fetch>) => reponse(201, { playerId: "p", token: "t" }));
    await joinGame("k7q2mb", "Léa", doFetch);
    expect(doFetch.mock.calls[0][0]).toBe("/api/parties/K7Q2MB/joueurs");
    expect(doFetch.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ pseudo: "Léa" }) });
  });
  it("chaque erreur connue est reconnue quel que soit le statut", async () => {
    for (const error of ["invalid_pseudo", "pseudo_taken", "game_full", "game_not_found", "game_finished"] as const) {
      expect(await joinGame("ABCDEF", "x", () => reponse(418, { error }))).toEqual({ ok: false, error });
    }
  });
  it("500 en HTML, corps vide, JSON de forme inattendue, erreur inconnue : unknown", async () => {
    expect(await joinGame("ABCDEF", "x", () => reponse(500, "<h1>x</h1>", true))).toEqual({ ok: false, error: "unknown" });
    expect(await joinGame("ABCDEF", "x", () => reponse(500, "", true))).toEqual({ ok: false, error: "unknown" });
    expect(await joinGame("ABCDEF", "x", () => reponse(500, null))).toEqual({ ok: false, error: "unknown" });
    expect(await joinGame("ABCDEF", "x", () => reponse(500, { error: "server_misconfigured" }))).toEqual({ ok: false, error: "unknown" });
    expect(await joinGame("ABCDEF", "x", () => reponse(500, { error: { game_full: 1 } }))).toEqual({ ok: false, error: "unknown" });
  });
  it("201 sans jeton exploitable : unknown, jamais ok", async () => {
    for (const corps of [{}, { playerId: "p" }, { token: "t" }, { playerId: 1, token: "t" }, null, []]) {
      expect(await joinGame("ABCDEF", "x", () => reponse(201, corps))).toEqual({ ok: false, error: "unknown" });
    }
  });
  it("un 200 n'est pas une inscription", async () => {
    expect(await joinGame("ABCDEF", "x", () => reponse(200, { playerId: "p", token: "t" }))).toEqual({ ok: false, error: "unknown" });
  });
  it("erreur réseau : network", async () => {
    expect(await joinGame("ABCDEF", "x", () => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ ok: false, error: "network" });
  });
  it("tous les messages sont en français, non vides, sans code technique", () => {
    for (const message of Object.values(JOIN_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/invalid_|_taken|_full|_not_found|_finished|undefined|\[object/);
    }
  });
});

describe("jeton : robustesse du stockage", () => {
  const store = (donnees: Record<string, string> = {}, echec = false) => {
    const data = new Map(Object.entries(donnees));
    return {
      getItem: (k: string) => {
        if (echec) throw new Error("SecurityError");
        return data.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (echec) throw new Error("QuotaExceeded");
        data.set(k, v);
      },
      removeItem: (k: string) => void data.delete(k),
    };
  };
  it("stockage qui lève : lecture null, écriture false, sans exception", () => {
    expect(readToken(store({}, true), "ABCDEF")).toBeNull();
    expect(writeToken(store({}, true), "ABCDEF", { playerId: "p", token: "t" })).toBe(false);
  });
  it("les jetons de deux parties ne se mélangent pas", () => {
    const s = store();
    writeToken(s, "AAAAAA", { playerId: "1", token: "a" });
    writeToken(s, "BBBBBB", { playerId: "2", token: "b" });
    expect(readToken(s, "aaaaaa")).toEqual({ playerId: "1", token: "a" });
    expect(readToken(s, "BBBBBB")).toEqual({ playerId: "2", token: "b" });
    expect(readToken(s, "CCCCCC")).toBeNull();
  });
  it("n'écrit que playerId et token, même si l'objet porte autre chose", () => {
    const s = store();
    writeToken(s, "ABCDEF", { playerId: "p", token: "t", secret: "x" } as never);
    expect(JSON.parse(s.getItem(tokenKey("ABCDEF"))!)).toEqual({ playerId: "p", token: "t" });
  });
  it("valeurs JSON de mauvais type : null", () => {
    for (const v of ["null", "42", '"txt"', "[]", '{"playerId":1,"token":"t"}', '{"playerId":"p"}']) {
      expect(readToken(store({ [tokenKey("ABCDEF")]: v }), "ABCDEF"), v).toBeNull();
    }
  });
});
