import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/client/partage/types.ts", "utf8");

describe("partage : types d'entrée", () => {
  it("ne contiennent aucun champ de correction", () => {
    const champs = [...source.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
    expect(champs.length).toBeGreaterThan(0);
    const interdits = /correct|answer|reponse|solution|explanation|reference|option|isRight|valid/i;
    expect(champs.filter((champ) => interdits.test(champ))).toEqual([]);
  });

  it("déclarent exactement les champs publics du message de fin de partie", () => {
    const champs = new Set([...source.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]));
    for (const attendu of ["quizTitle", "pseudo", "score", "total", "rank", "playerCount", "top"]) {
      expect(champs.has(attendu), attendu).toBe(true);
    }
  });
});
