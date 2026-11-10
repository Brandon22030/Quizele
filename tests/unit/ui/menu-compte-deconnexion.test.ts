import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MenuCompte } from "../../../src/components/ui/menu-compte";

describe("MenuCompte : déconnexion", () => {
  it("poste par défaut vers /deconnexion, jamais vers l'API Better Auth qui exige du JSON", () => {
    const html = renderToStaticMarkup(createElement(MenuCompte, { nom: "Marie", email: "m@exemple.fr" }));
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/deconnexion"');
    expect(html).not.toContain("/api/auth/sign-out");
  });
});
