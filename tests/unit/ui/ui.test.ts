import { createElement, type ElementType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, IconButton } from "../../../src/components/ui/button";
import { cn } from "../../../src/components/ui/cn";
import { EtatErreur } from "../../../src/components/ui/etat-erreur";
import { Feuille } from "../../../src/components/ui/feuille";
import { FormField, type FieldControlProps } from "../../../src/components/ui/form-field";
import { Input } from "../../../src/components/ui/input";
import { Interrupteur } from "../../../src/components/ui/interrupteur";
import { MenuCompte } from "../../../src/components/ui/menu-compte";
import { Modal } from "../../../src/components/ui/modal";
import { Onglets, ongletCible } from "../../../src/components/ui/onglets";
import { OptionMode } from "../../../src/components/ui/option-mode";
import { Repli } from "../../../src/components/ui/repli";
import { Squelette } from "../../../src/components/ui/squelette";
import { Toast } from "../../../src/components/ui/toast";

// Les props de composants sont vérifiées par leurs propres tests de rendu : ici createElement reste souple sur les enfants.
const h = createElement as (type: ElementType, props?: object | null, ...children: unknown[]) => ReactElement;
const rendre = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("cn", () => {
  it("garde la largeur de trait et la couleur de bordure ensemble", () => {
    expect(cn("border-trait", "border-vert-foret")).toBe("border-trait border-vert-foret");
  });
  it("remplace une couleur de bordure par une autre", () => {
    expect(cn("border-vert-foret", "border-piment")).toBe("border-piment");
  });
  it("laisse la dernière ombre de relief gagner", () => {
    expect(cn("shadow-relief", "shadow-relief-sm")).toBe("shadow-relief-sm");
  });
  it("ne confond pas une taille de texte et une couleur de texte", () => {
    expect(cn("text-lg", "text-vert-foret")).toBe("text-lg text-vert-foret");
  });
});

describe("Button", () => {
  it("est de type button par défaut (jamais un envoi de formulaire involontaire)", () => {
    expect(rendre(h(Button, null, "Jouer"))).toContain('type="button"');
  });
  it("annonce le chargement et reste atteignable au clavier", () => {
    const html = rendre(h(Button, { chargement: true }, "Envoi"));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Chargement en cours");
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
  });
  it("utilise un contour pointillé plutôt qu'une opacité réduite quand il est désactivé", () => {
    const html = rendre(h(Button, { disabled: true }, "Non"));
    expect(html).toContain("disabled");
    expect(html).toContain("border-dashed");
    expect(html).not.toMatch(/opacity/);
  });
  it("devient un lien quand href est fourni", () => {
    const html = rendre(h(Button, { href: "/connexion" }, "Créer un compte"));
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/connexion"');
  });
  it("donne une cible de 44 px au bouton icône et un nom accessible", () => {
    const html = rendre(h(IconButton, { label: "Supprimer", icone: h("svg") }));
    expect(html).toContain('aria-label="Supprimer"');
    expect(html).toContain("size-11");
  });
  it("garde 44 px minimum pour la taille petite", () => {
    expect(rendre(h(Button, { taille: "petit" }, "Ok"))).toContain("min-h-11");
  });
});

describe("FormField", () => {
  const champ = (props: { aide?: string; erreur?: string }) =>
    rendre(h(FormField, { label: "Pseudo", ...props }, (control: FieldControlProps) => h(Input, control)));

  it("relie le libellé au champ", () => {
    const html = champ({});
    const id = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });
  it("lie l'erreur et l'aide au champ par aria-describedby et marque le champ invalide", () => {
    const html = champ({ aide: "20 caractères", erreur: "Pseudo requis" });
    const describedby = /aria-describedby="([^"]+)"/.exec(html)?.[1].split(" ") ?? [];
    expect(describedby).toHaveLength(2);
    for (const id of describedby) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });
  it("n'ajoute ni description ni invalidité sans aide ni erreur", () => {
    const html = champ({});
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
  });
});

describe("Interrupteur", () => {
  it("expose un switch natif relié à sa description", () => {
    const html = rendre(h(Interrupteur, { label: "Mélanger", description: "Pour éviter de copier", defaultChecked: true }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('type="checkbox"');
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("checked");
  });
  it("offre une rangée cliquable d'au moins 44 px", () => {
    expect(rendre(h(Interrupteur, { label: "x" }))).toContain("min-h-14");
  });
});

describe("Onglets", () => {
  const onglets = [
    { id: "quiz", label: "Mes quiz" },
    { id: "parties", label: "Parties jouées" },
  ];

  it("applique le modèle ARIA des onglets avec un seul onglet dans l'ordre de tabulation", () => {
    const html = rendre(
      h(Onglets, { onglets, label: "Vue", defaultValeur: "parties" }, (_actif: string, panneau: object) => h("div", panneau, "contenu")),
    );
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(2); // l'onglet actif et le panneau
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(html).toContain('role="tabpanel"');
  });

  it("calcule la cible des touches avec bouclage", () => {
    expect(ongletCible("ArrowRight", 1, 2)).toBe(0);
    expect(ongletCible("ArrowLeft", 0, 3)).toBe(2);
    expect(ongletCible("Home", 2, 3)).toBe(0);
    expect(ongletCible("End", 0, 3)).toBe(2);
    expect(ongletCible("a", 0, 3)).toBeNull();
  });
});

describe("Feuille et Modal", () => {
  it("rend un dialog nommé par son titre, fermé tant que open n'est pas passé en modal", () => {
    const html = rendre(h(Feuille, { open: false, onClose: () => {}, titre: "Tes questions" }, "contenu"));
    const labelledby = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toMatch(/^<dialog/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen(=|>|\s)/);
    expect(html).toContain(`id="${labelledby}"`);
    expect(html).toContain("Tes questions");
  });
  it("fournit un bouton Fermer de 44 px", () => {
    const html = rendre(h(Modal, { open: false, onClose: () => {}, titre: "Supprimer ?" }, "contenu"));
    expect(html).toContain('aria-label="Fermer"');
    expect(html).toContain("size-11");
  });
  it("ancre la feuille en bas de l'écran", () => {
    expect(rendre(h(Feuille, { open: false, onClose: () => {}, titre: "t" }, "x"))).toContain("bottom-0");
  });
});

describe("OptionMode, Repli, Squelette, EtatErreur, Toast, MenuCompte", () => {
  it("OptionMode est un radio natif", () => {
    const html = rendre(h(OptionMode, { name: "mode", value: "a", titre: "Ensemble", description: "d", defaultChecked: true }));
    expect(html).toContain('type="radio"');
    expect(html).toContain('name="mode"');
  });
  it("Repli est un details natif, fermé par défaut", () => {
    const html = rendre(h(Repli, { titre: "Plus d'options" }, "contenu"));
    expect(html).toMatch(/^<details/);
    expect(html).not.toMatch(/<details[^>]*\sopen(=|>|\s)/);
    expect(html).toContain("<summary");
  });
  it("Squelette est masqué aux lecteurs d'écran et utilise animate-brille", () => {
    const html = rendre(h(Squelette));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-brille");
  });
  it("EtatErreur annonce l'erreur et propose Réessayer seulement avec une action", () => {
    const sans = rendre(h(EtatErreur, null, "Oups"));
    expect(sans).toContain('role="alert"');
    expect(sans).not.toContain("Réessayer");
    expect(rendre(h(EtatErreur, { onRetry: () => {} }, "Oups"))).toContain("Réessayer");
  });
  it("Toast utilise alert pour une erreur et status sinon", () => {
    expect(rendre(h(Toast, { variante: "erreur" }, "x"))).toContain('role="alert"');
    expect(rendre(h(Toast, { variante: "succes" }, "x"))).toContain('role="status"');
  });
  it("MenuCompte cache le panneau et affiche nom, e-mail et lien de déconnexion", () => {
    const html = rendre(h(MenuCompte, { nom: "Marie", email: "m@exemple.fr", deconnexionHref: "/deconnexion" }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("hidden");
    expect(html).toContain("m@exemple.fr");
    expect(html).toContain('href="/deconnexion"');
    expect(html).toContain("Se déconnecter");
  });
});

describe("thème forêt", () => {
  it("les composants utilisent la variante foret (data-theme) et plus data-foret", () => {
    const html = rendre(h(Button, { variante: "soleil" }, "x"));
    expect(html).toContain("foret:focus-visible:outline-jaune-soleil");
    expect(html).not.toContain("data-foret");
  });
  it("les dialogues marquent leur papier crème pour interrompre le thème forêt", () => {
    expect(rendre(h(Modal, { open: false, onClose: () => {}, titre: "t" }, "x"))).toContain("data-papier");
  });
});
