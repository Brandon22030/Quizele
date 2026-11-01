import { describe, expect, it } from "vitest";
import { pseudoKey, pseudoSchema } from "../../src/shared/protocol";
import { rankEntries } from "../../src/server/game/scoring";

describe("clé de pseudo", () => {
  it("ignore les caractères invisibles qui créeraient de faux doublons", () => {
    const awa = pseudoKey("Awa");
    for (const variant of ["Awa️", "A͏wa", "Aw‍a", "AWA", " awa ", "awaㅤ"]) {
      expect(pseudoKey(variant), JSON.stringify(variant)).toBe(awa);
    }
    expect(pseudoKey("Awa  Diop")).toBe(pseudoKey("awa diop"));
  });

  it("refuse un pseudo fait uniquement de caractères invisibles ou d'espaces", () => {
    for (const pseudo of ["ㅤ", "ㅤ ㅤ", "͏", "️", "‍"]) {
      expect(pseudoSchema.safeParse(pseudo).success, JSON.stringify(pseudo)).toBe(false);
    }
  });

  it("garde le ZWJ à l'affichage des emojis composés", () => {
    const family = "👨‍👩‍👧";
    expect(pseudoSchema.parse(family)).toBe(family);
    expect(pseudoKey(family)).not.toBe(family);
  });
});

describe("classement", () => {
  it("départage à égalité selon l'ordre alphabétique français", () => {
    const entries = ["Zoé", "Fanny", "Émile", "eli"].map((pseudo, i) => ({ playerId: String(i), pseudo, score: 1, totalMs: 10 }));
    expect(rankEntries(entries).map((e) => e.pseudo)).toEqual(["eli", "Émile", "Fanny", "Zoé"]);
  });
});
