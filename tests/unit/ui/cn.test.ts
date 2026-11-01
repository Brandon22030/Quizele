import { describe, expect, it } from "vitest";
import { cn } from "../../../src/components/ui/cn";

describe("cn : jetons du projet face à tailwind-merge", () => {
  it("border-trait ne supprime pas border-vert-foret, dans les deux ordres", () => {
    expect(cn("border-trait", "border-vert-foret")).toBe("border-trait border-vert-foret");
    expect(cn("border-vert-foret", "border-trait")).toBe("border-vert-foret border-trait");
  });
  it("outline-trait ne supprime pas outline-vert-foret", () => {
    expect(cn("outline-trait", "outline-vert-foret")).toBe("outline-trait outline-vert-foret");
  });
  it("une classe de surcharge remplace bien la couleur sans toucher au trait", () => {
    expect(cn("border-trait border-vert-foret", "border-piment")).toBe("border-trait border-piment");
  });
  it("garde border-dashed et border-trait ensemble (style et largeur)", () => {
    expect(cn("border-trait border-vert-foret", "border-dashed")).toBe("border-trait border-vert-foret border-dashed");
  });
  it("garde les largeurs et couleurs avec le préfixe de variante", () => {
    expect(cn("foret:border-vert-nuit", "border-trait")).toBe("foret:border-vert-nuit border-trait");
  });
  it("ignore les valeurs fausses comme clsx", () => {
    expect(cn("border-trait", 0 as unknown as string, null, undefined, "")).toBe("border-trait");
  });
});
