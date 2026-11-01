import { createElement, type ElementType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BadgeEtoile } from "../../../src/components/ui/badge-etoile";
import { Button } from "../../../src/components/ui/button";
import { cn } from "../../../src/components/ui/cn";
import { Explosion } from "../../../src/components/ui/explosion";
import { Forme } from "../../../src/components/ui/forme";
import { Input } from "../../../src/components/ui/input";
import { Papier } from "../../../src/components/ui/papier";
import { Pilule } from "../../../src/components/ui/pilule";
import { Repli } from "../../../src/components/ui/repli";
import { Squelette } from "../../../src/components/ui/squelette";
import { Ticket } from "../../../src/components/ui/ticket";
import { Toast, ZoneToasts } from "../../../src/components/ui/toast";

const h = createElement as (type: ElementType, props?: object | null, ...children: unknown[]) => ReactElement;
const rendre = (el: ReactElement) => renderToStaticMarkup(el);

describe("cn : animations et ombres de texte", () => {
  it("la dernière animation du projet gagne", () => {
    expect(cn("animate-pop", "animate-brille")).toBe("animate-brille");
  });
  it("la dernière ombre de texte gagne", () => {
    expect(cn("text-shadow-affiche", "text-shadow-affiche-sm")).toBe("text-shadow-affiche-sm");
  });
  it("une animation n'écrase ni une couleur ni une ombre de texte", () => {
    expect(cn("animate-pop", "text-creme", "text-shadow-affiche")).toBe("animate-pop text-creme text-shadow-affiche");
  });
});

describe("Input : une seule source pour l'état invalide", () => {
  it("le style suit aria-invalid et le composant n'a plus de prop invalide", () => {
    const html = rendre(h(Input, { "aria-invalid": true }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("aria-invalid:border-piment");
    // Une prop inconnue serait transmise telle quelle au DOM : preuve qu'elle n'est plus interprétée.
    expect(rendre(h(Input, { invalide: true }))).not.toContain("aria-invalid=");
  });
});

describe("Button lien", () => {
  it("interdit chargement au niveau du type et n'affiche aucun indicateur sur un lien", () => {
    // @ts-expect-error un lien navigue : pas d'état de chargement
    const html = rendre(createElement(Button, { href: "/x", chargement: true, children: "Aller" }));
    expect(html).toMatch(/^<a /);
    expect(html).not.toContain("aria-busy");
  });
  it("ne se coupe pas en deux lignes et n'est pas souligné", () => {
    const html = rendre(h(Button, { href: "/x" }, "Créer un compte"));
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("no-underline");
  });
  it("désactivé : fond crème, lisible sur jaune comme sur forêt", () => {
    const html = rendre(h(Button, { disabled: true }, "Non"));
    expect(html).toContain("bg-creme");
    expect(html).toContain("foret:border-creme");
  });
});

describe("data-papier sur les surfaces crème", () => {
  it("Papier, Toast info et contenu de Repli sont marqués", () => {
    expect(rendre(h(Papier, null, "x"))).toContain('data-papier=""');
    expect(rendre(h(Toast, { variante: "info" }, "x"))).toContain('data-papier=""');
    expect(rendre(h(Repli, { titre: "t" }, "x"))).toContain('<div data-papier=""');
  });
  it("Repli ouvert marque aussi le details (résumé sur crème)", () => {
    expect(rendre(h(Repli, { titre: "t", defaultOpen: true }, "x"))).toMatch(/^<details[^>]*data-papier=""/);
    expect(rendre(h(Repli, { titre: "t" }, "x"))).not.toMatch(/^<details[^>]*data-papier/);
  });
  it("les toasts de succès et d'erreur ne sont pas marqués (fond vif, pas crème)", () => {
    expect(rendre(h(Toast, { variante: "succes" }, "x"))).not.toContain("data-papier");
    expect(rendre(h(Toast, { variante: "erreur" }, "x"))).not.toContain("data-papier");
  });
});

describe("ZoneToasts", () => {
  it("monte deux régions vides en permanence : status puis alert", () => {
    const html = rendre(h(ZoneToasts));
    expect(html).toContain('<div role="status" class="flex flex-col gap-2"></div>');
    expect(html).toContain('<div role="alert" class="flex flex-col gap-2"></div>');
  });
  it("range les messages dans la région qui correspond", () => {
    const html = rendre(h(ZoneToasts, { statuts: h("i", null, "ok"), alertes: h("b", null, "ko") }));
    expect(html.indexOf("<i>ok</i>")).toBeLessThan(html.indexOf('role="alert"'));
    expect(html.indexOf("<b>ko</b>")).toBeGreaterThan(html.indexOf('role="alert"'));
  });
});

describe("styles déplacés dans global.css", () => {
  it("Ticket et Squelette utilisent des classes, plus de style inline", () => {
    const ticket = rendre(h(Ticket, null, "x"));
    expect(ticket).toContain("ticket-ombre");
    expect(ticket).toContain("ticket-perfore");
    expect(ticket).not.toContain("style=");
    const squelette = rendre(h(Squelette));
    expect(squelette).toContain("squelette-brillance");
    expect(squelette).not.toContain("style=");
  });
  it("Ticket sans ombre", () => {
    expect(rendre(h(Ticket, { ombre: false }, "x"))).not.toContain("ticket-ombre");
  });
  it("Repli masque le marqueur natif par une classe", () => {
    expect(rendre(h(Repli, { titre: "t" }, "x"))).toContain("resume-sans-marqueur");
  });
});

describe("Pilule, Papier, Forme", () => {
  it("Pilule : chiffres tabulaires et interligne serré", () => {
    const html = rendre(h(Pilule, null, "19h00"));
    expect(html).toContain("tabular-nums");
    expect(html).toContain("leading-snug");
  });
  it("Pilule forêt garde un contour visible sur fond forêt", () => {
    expect(rendre(h(Pilule, { variante: "foret" }, "x"))).toContain("foret:border-creme");
  });
  it("Papier : bords posés contre le corps avec 1 px de recouvrement", () => {
    const html = rendre(h(Papier, null, "x"));
    expect(html).toContain("bottom-full translate-y-px");
    expect(html).toContain("top-full -translate-y-px");
  });
  it("Forme est utilisable en étoile et sa taille se surcharge sans doublon", () => {
    const html = rendre(h(Forme, { forme: "etoile", className: "size-11" }, "x"));
    expect(html).toContain("forme-etoile");
    expect(html).toContain("size-11");
    expect(html).not.toContain("size-20");
  });
  it("Explosion et BadgeEtoile gardent la taille par défaut une seule fois", () => {
    for (const el of [h(Explosion, null, "x"), h(BadgeEtoile, null, "x")]) {
      expect(rendre(el).match(/size-20/g)).toHaveLength(1);
    }
  });
});
