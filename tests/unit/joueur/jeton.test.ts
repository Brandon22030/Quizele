import { describe, expect, it, vi } from "vitest";
import { cleJeton, effacerJeton, jetonExpire, lireJeton, retourRejoindre, urlRejoindre } from "../../../src/islands/joueur/jeton";

function stockage(initial: Record<string, string> = {}) {
  const donnees = new Map(Object.entries(initial));
  return { getItem: (k: string) => donnees.get(k) ?? null, removeItem: (k: string) => void donnees.delete(k), donnees };
}

describe("jeton joueur", () => {
  it("clé en majuscules, partagée avec la page rejoindre", () => {
    expect(cleJeton("k7q2m9")).toBe("quizdeszeles:jeton:K7Q2M9");
    expect(urlRejoindre("k7q2m9")).toBe("/j/K7Q2M9");
  });

  it("lit { playerId, token }", () => {
    const s = stockage({ "quizdeszeles:jeton:K7Q2M9": JSON.stringify({ playerId: "p1", token: "abc" }) });
    expect(lireJeton("k7q2m9", s)).toEqual({ playerId: "p1", token: "abc" });
  });

  it("absent, illisible ou mal formé : null", () => {
    expect(lireJeton("K7Q2M9", stockage())).toBeNull();
    expect(lireJeton("K7Q2M9", stockage({ "quizdeszeles:jeton:K7Q2M9": "pas du json" }))).toBeNull();
    expect(lireJeton("K7Q2M9", stockage({ "quizdeszeles:jeton:K7Q2M9": JSON.stringify({ token: "abc" }) }))).toBeNull();
    expect(lireJeton("K7Q2M9", null)).toBeNull();
  });

  it("expiration lue dans la charge utile base64url", () => {
    const charge = (e: number) => btoa(JSON.stringify({ e })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(jetonExpire(`${charge(1000)}.sig`, 2000)).toBe(true);
    expect(jetonExpire(`${charge(3000)}.sig`, 2000)).toBe(false);
    expect(jetonExpire("illisible", 2000)).toBe(false);
    const s = stockage({ "quizdeszeles:jeton:K7Q2M9": JSON.stringify({ playerId: "p1", token: `${charge(1000)}.sig` }) });
    expect(lireJeton("K7Q2M9", s, 2000)).toBeNull();
    expect(lireJeton("K7Q2M9", s, 500)).not.toBeNull();
  });

  it("efface la clé", () => {
    const s = stockage({ "quizdeszeles:jeton:K7Q2M9": "x" });
    effacerJeton("K7Q2M9", s);
    expect(s.donnees.size).toBe(0);
  });

  it("retour : supprime la clé puis redirige vers la page de saisie", () => {
    const s = stockage({ "quizdeszeles:jeton:K7Q2M9": "x" });
    const replace = vi.fn();
    vi.stubGlobal("localStorage", s);
    vi.stubGlobal("location", { replace });
    try {
      retourRejoindre("k7q2m9");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(s.donnees.size).toBe(0);
    expect(replace).toHaveBeenCalledWith("/j/K7Q2M9");
  });
});
