import { afterEach, describe, expect, it, vi } from "vitest";
import { lireJetons } from "../../../src/client/partage/jetons";

// Document minimal : chaque sonde porte sa classe, getComputedStyle simulé répond par classe.
interface Sonde {
  className: string;
  children: Sonde[];
  setAttribute: () => void;
  appendChild: (s: Sonde) => void;
  remove: () => void;
}

function faux(): { doc: Document; retraits: () => number } {
  let retraits = 0;
  const element = (): Sonde => {
    const e: Sonde = {
      className: "",
      children: [],
      setAttribute: () => {},
      appendChild: (s) => {
        e.children.push(s);
      },
      remove: () => {
        retraits++;
      },
    };
    return e;
  };
  const doc = { createElement: element, body: { appendChild: () => {} } } as unknown as Document;
  return { doc, retraits: () => retraits };
}

type Style = { backgroundColor: string; fontFamily: string; fontSize: string; paddingTop: string };

function styles(surcharge: (classe: string) => Partial<Style> = () => ({})) {
  vi.stubGlobal("getComputedStyle", (s: Sonde): Style => ({
    backgroundColor: s.className.startsWith("bg-") ? "rgb(10, 20, 30)" : "rgba(0, 0, 0, 0)",
    fontFamily: s.className.startsWith("font-") ? '"Baloo 2", system-ui' : "Times",
    fontSize: s.className.startsWith("text-") ? "20px" : "16px",
    paddingTop: s.className.startsWith("p-") ? "8px" : "0px",
    ...surcharge(s.className),
  }));
}

describe("lireJetons", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lit les jetons résolus par les sondes, séparateur compris, et retire le conteneur", () => {
    styles((c) => (c === "bg-separateur" ? { backgroundColor: "color(srgb 0.1 0.3 0.2 / 0.25)" } : {}));
    const { doc, retraits } = faux();
    const t = lireJetons(doc);
    expect(t.couleurs.jaune).toBe("rgb(10, 20, 30)");
    expect(t.couleurs.separateur).toBe("color(srgb 0.1 0.3 0.2 / 0.25)");
    expect(t.espaces.quatre).toBe(8);
    expect(retraits()).toBe(1);
  });

  it("une composante nulle n'est pas un alpha nul : jaune pur accepté", () => {
    styles((c) => (c === "bg-jaune-soleil" ? { backgroundColor: "rgb(255, 212, 0)" } : c === "bg-creme" ? { backgroundColor: "color(srgb 1 0.9 0)" } : {}));
    expect(lireJetons(faux().doc).couleurs.jaune).toBe("rgb(255, 212, 0)");
  });

  it("sans feuille de style (fonds transparents, espacements nuls) : erreur explicite", () => {
    vi.stubGlobal("getComputedStyle", (): Style => ({ backgroundColor: "rgba(0, 0, 0, 0)", fontFamily: "Times", fontSize: "16px", paddingTop: "0px" }));
    const { doc, retraits } = faux();
    expect(() => lireJetons(doc)).toThrow("Jetons de l'affiche introuvables");
    expect(retraits()).toBe(1);
  });

  it.each([
    ["une couleur transparente", (c: string) => (c === "bg-creme" ? { backgroundColor: "transparent" } : {})],
    ["une couleur à alpha nul en syntaxe à virgules", (c: string) => (c === "bg-vert-nuit" ? { backgroundColor: "rgba(12, 40, 20, 0)" } : {})],
    ["une couleur à alpha nul en syntaxe moderne", (c: string) => (c === "bg-vert-vif" ? { backgroundColor: "color(srgb 0 0 0 / 0)" } : {})],
    ["une police vide", (c: string) => (c === "font-note" ? { fontFamily: "" } : {})],
    ["une taille non numérique", (c: string) => (c === "text-3xl" ? { fontSize: "" } : {})],
    ["un espacement non numérique", (c: string) => (c === "p-6" ? { paddingTop: "auto" } : {})],
    ["un espacement nul (pas de trame nul : boucle sans fin)", (c: string) => (c === "p-4" ? { paddingTop: "0px" } : {})],
  ])("refuse %s", (_nom, surcharge) => {
    styles(surcharge);
    expect(() => lireJetons(faux().doc)).toThrow("Jetons de l'affiche introuvables");
  });
});
