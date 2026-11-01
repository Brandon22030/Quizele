import { describe, expect, it } from "vitest";
import { isProtectedPath, safeReturnPath } from "../../src/server/auth/routes";
import { normalizeEmailKey } from "../../src/server/auth/email-quota";

const origin = "https://quiz.example";
const fallback = "/tableau-de-bord";

describe("safeReturnPath : cas supplémentaires", () => {
  it.each([
    "/QUIZ/x",
    "/Partie/x",
    "/tableau-de-bord-bis",
    "/tableau-de-bord.evil/..",
    "/quiz/..",
    "/quiz/./../j/X",
    "/quiz%2F..%2Fj%2FX",
    "/quiz/x?a=1\r\nHost: evil",
    "/quiz/‮evil",
    "https:/evil.example/quiz",
    "/∕evil.example",
    "/quiz/x%",
    "/quiz/%zz",
    "%2f%2fquiz",
    "  ",
    "/",
    "/api/auth/sign-out",
  ])("refuse %j", (retour) => {
    expect(safeReturnPath(retour, origin)).toBe(fallback);
  });

  it("un caractère bidi (U+202E) dans le chemin ressort percent-encodé, jamais brut", () => {
    const result = safeReturnPath("/quiz/\u202Eevil", origin);
    expect(result).toBe("/quiz/%E2%80%AEevil");
    expect(result).not.toContain("\u202E");
  });

  it("conserve la query d'un chemin protégé et ne double-décode pas", () => {
    expect(safeReturnPath("/quiz/a?x=1&y=2", origin)).toBe("/quiz/a?x=1&y=2");
    expect(safeReturnPath("%2Fquiz%2Fa%253F", origin)).toBe("/quiz/a%3F");
    expect(isProtectedPath(safeReturnPath("/quiz/é", origin))).toBe(true);
  });

  it("un chemin tout juste sous la limite de 512 caractères est accepté, un de plus est refusé", () => {
    const ok = `/quiz/${"a".repeat(512 - 6)}`;
    expect(ok.length).toBe(512);
    expect(safeReturnPath(ok, origin)).toBe(ok);
    expect(safeReturnPath(`${ok}a`, origin)).toBe(fallback);
  });
});

describe("normalizeEmailKey : cas supplémentaires", () => {
  it("ramène casse, espaces internes, tabulations et +tags multiples à une seule clé", () => {
    const key = normalizeEmailKey("victime@x.fr");
    for (const v of ["Victime+1@x.fr", "VICTIME+a+b@X.FR", " victime+@x.fr ", "vic\ttime+z@x.fr"]) {
      expect(normalizeEmailKey(v), v).toBe(key);
    }
    expect(normalizeEmailKey("autre@x.fr")).not.toBe(key);
    expect(normalizeEmailKey("victime@y.fr")).not.toBe(key);
  });
});
