import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeCases } from "../../../src/components/jeu/CodeCases";
import { backspaceAt, changeAt, extractTyped, insertAt, sanitizeCode } from "../../../src/components/jeu/code-input";

describe("sanitizeCode", () => {
  it("met en majuscules, retire accents, espaces et tirets", () => {
    expect(sanitizeCode(" k7-q2 mé ")).toBe("K7Q2ME");
  });
});

describe("alphabet du serveur", () => {
  it("ignore 0, O, 1 et I, à la saisie comme au collage", () => {
    expect(sanitizeCode("0O1IAB")).toBe("AB");
    expect(insertAt("", 0, "0O1IAB6")).toEqual({ value: "AB6", focus: 3 });
    expect(insertAt("AB", 2, "o")).toEqual({ value: "AB", focus: 2 });
    expect(sanitizeCode("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  });
});

describe("clavier Android (key « Unidentified »)", () => {
  it("un change avec une valeur vide efface la case remplie", () => {
    expect(changeAt("K7Q", 1, "")).toEqual({ value: "KQ", focus: 1 });
    expect(changeAt("K7Q2MB", 5, "")).toEqual({ value: "K7Q2M", focus: 5 });
  });

  it("un change vide sur une case déjà vide ne change rien", () => {
    expect(changeAt("K7", 3, "")).toEqual({ value: "K7", focus: 3 });
  });

  it("un change avec un caractère se comporte comme la saisie", () => {
    expect(changeAt("K7", 2, "q")).toEqual({ value: "K7Q", focus: 3 });
    expect(changeAt("K7Q", 1, "7X")).toEqual({ value: "KXQ", focus: 2 });
  });
});

describe("saisie au clavier", () => {
  it("ajoute un caractère à la suite et avance d'une case", () => {
    expect(insertAt("K7", 2, "q")).toEqual({ value: "K7Q", focus: 3 });
  });

  it("ignore un caractère non autorisé sans bouger", () => {
    expect(insertAt("K7", 2, "!")).toEqual({ value: "K7", focus: 2 });
  });

  it("remplace le caractère d'une case déjà remplie", () => {
    expect(insertAt("K7Q", 1, "x")).toEqual({ value: "KXQ", focus: 2 });
  });

  it("garde le nouveau caractère quand le navigateur renvoie ancien + nouveau", () => {
    expect(extractTyped("7", "7X")).toBe("X");
    expect(extractTyped("7", "X7")).toBe("X");
    expect(extractTyped(undefined, "x")).toBe("X");
  });

  it("reste sur la dernière case quand le code est complet", () => {
    expect(insertAt("K7Q2M", 4, "z")).toEqual({ value: "K7Q2Z", focus: 5 });
    expect(insertAt("K7Q2MB", 5, "z")).toEqual({ value: "K7Q2MZ", focus: 5 });
  });
});

describe("collage", () => {
  it("répartit un code entier depuis la première case, en majuscules", () => {
    expect(insertAt("", 0, "k7q2mb")).toEqual({ value: "K7Q2MB", focus: 5 });
  });

  it("nettoie le texte collé et tronque à 6 caractères", () => {
    expect(insertAt("", 0, " k7-q2mb99 ").value).toBe("K7Q2MB");
  });

  it("colle à partir de la case courante", () => {
    expect(insertAt("K7", 2, "Q2MB")).toEqual({ value: "K7Q2MB", focus: 5 });
  });
});

describe("retour arrière", () => {
  it("efface la case courante si elle est remplie", () => {
    expect(backspaceAt("K7Q", 1)).toEqual({ value: "KQ", focus: 1 });
  });

  it("efface la case précédente depuis une case vide", () => {
    expect(backspaceAt("K7", 2)).toEqual({ value: "K", focus: 1 });
  });

  it("ne fait rien sur un code vide", () => {
    expect(backspaceAt("", 0)).toEqual({ value: "", focus: 0 });
  });

  it("efface la dernière case d'un code complet", () => {
    expect(backspaceAt("K7Q2MB", 5)).toEqual({ value: "K7Q2M", focus: 5 });
  });
});

describe("rendu de CodeCases", () => {
  const html = renderToStaticMarkup(createElement(CodeCases, { labelledBy: "libelle-code", value: "K7Q", onChange: () => undefined }));

  it("affiche 6 cases étiquetées dans un groupe", () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-labelledby="libelle-code"');
    expect(html).not.toContain('aria-label="Code de la partie"');
    expect(html.match(/<input/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Caractère 6 du code"');
  });

  it("n'expose qu'une case dans l'ordre de tabulation, la première vide", () => {
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(5);
    expect(html).toMatch(/tabindex="0"[^>]*aria-label="Caractère 4 du code"|aria-label="Caractère 4 du code"[^>]*tabindex="0"/);
  });

  it("demande les majuscules et désactive la correction automatique", () => {
    expect(html).toContain('autoCapitalize="characters"');
    expect(html).toContain('autoComplete="off"');
  });
});
