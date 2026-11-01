import { contraste, couleurJeton, expect, test, zoneForet, zoneJaune } from "./aide";

for (const [nomZone, zone] of [
  ["fond jaune", zoneJaune],
  ["fond forêt", zoneForet],
] as const) {
  test.describe(`Onglets (${nomZone})`, () => {
    test("rôles ARIA, tabindex tournant, flèches, Début/Fin, bouclage", async ({ guide }) => {
      const liste = zone(guide).getByRole("tablist", { name: "Vue des quiz" });
      const onglets = liste.getByRole("tab");
      await expect(onglets).toHaveCount(2);
      const [a, b] = [onglets.nth(0), onglets.nth(1)];

      await expect(a).toHaveAttribute("aria-selected", "true");
      await expect(b).toHaveAttribute("aria-selected", "false");
      await expect(a).toHaveAttribute("tabindex", "0");
      await expect(b).toHaveAttribute("tabindex", "-1");

      const panneauId = await a.getAttribute("aria-controls");
      expect(panneauId).toBeTruthy();
      expect(await b.getAttribute("aria-controls")).toBe(panneauId);
      const panneau = guide.locator(`[id="${panneauId}"]`);
      await expect(panneau).toHaveAttribute("role", "tabpanel");
      expect(await panneau.getAttribute("aria-labelledby")).toBe(await a.getAttribute("id"));
      await expect(panneau).toContainText("Liste de tes quiz.");

      await a.focus();
      await guide.keyboard.press("ArrowRight");
      await expect(b).toBeFocused();
      await expect(b).toHaveAttribute("aria-selected", "true");
      await expect(b).toHaveAttribute("tabindex", "0");
      await expect(a).toHaveAttribute("tabindex", "-1");
      await expect(panneau).toContainText("Liste des parties jouées.");
      expect(await panneau.getAttribute("aria-labelledby")).toBe(await b.getAttribute("id"));

      await guide.keyboard.press("ArrowRight");
      await expect(a).toBeFocused();
      await expect(a).toHaveAttribute("aria-selected", "true");
      await guide.keyboard.press("ArrowLeft");
      await expect(b).toBeFocused();
      await guide.keyboard.press("Home");
      await expect(a).toBeFocused();
      await expect(a).toHaveAttribute("aria-selected", "true");
      await guide.keyboard.press("End");
      await expect(b).toBeFocused();
      await expect(b).toHaveAttribute("aria-selected", "true");

      // Un seul arrêt dans l'ordre de tabulation, puis le panneau.
      await guide.keyboard.press("Tab");
      await expect(panneau).toBeFocused();
    });

    test("le clic sélectionne un onglet", async ({ guide }) => {
      const b = zone(guide).getByRole("tab").nth(1);
      await b.click();
      await expect(b).toHaveAttribute("aria-selected", "true");
    });
  });

  test.describe(`Interrupteur (${nomZone})`, () => {
    test("role=switch, état initial, Espace bascule, description liée", async ({ guide }) => {
      const z = zone(guide);
      const montrer = z.getByRole("switch", { name: "Montrer la bonne réponse" });
      const melanger = z.getByRole("switch", { name: "Mélanger l'ordre" });
      await expect(montrer).toBeChecked();
      await expect(melanger).not.toBeChecked();
      await expect(montrer).toHaveAccessibleDescription("Après chaque question, avec l'explication.");

      await melanger.focus();
      await guide.keyboard.press("Space");
      await expect(melanger).toBeChecked();
      await guide.keyboard.press("Space");
      await expect(melanger).not.toBeChecked();
      await expect(melanger).toBeFocused();
    });

    test("un clic sur le libellé bascule", async ({ guide }) => {
      const melanger = zone(guide).getByRole("switch", { name: "Mélanger l'ordre" });
      await zone(guide).getByText("Mélanger l'ordre", { exact: true }).click();
      await expect(melanger).toBeChecked();
    });
  });

  test.describe(`Repli (${nomZone})`, () => {
    test("details : Entrée et Espace ouvrent et ferment, contenu masqué replié", async ({ guide }) => {
      const details = zone(guide).locator("details", { hasText: "Référence et explication" });
      const resume = details.locator("summary");
      const contenu = details.getByText("Un contenu replié, accessible au clavier.");
      await expect(details).not.toHaveAttribute("open", "");
      await expect(contenu).toBeHidden();
      await resume.focus();
      await guide.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(contenu).toBeVisible();
      await guide.keyboard.press("Space");
      await expect(details).not.toHaveAttribute("open", "");
      await expect(contenu).toBeHidden();
    });
  });

  test.describe(`OptionMode (${nomZone})`, () => {
    test("radios groupés, flèches déplacent et cochent, bouclage, clic sur la carte", async ({ guide }) => {
      const groupe = zone(guide).getByRole("group", { name: "Comment on joue ?" });
      const ensemble = groupe.getByRole("radio", { name: /Tout le monde ensemble/ });
      const rythme = groupe.getByRole("radio", { name: /Chacun à son rythme/ });
      await expect(ensemble).toBeChecked();
      await expect(rythme).not.toBeChecked();

      await ensemble.focus();
      await guide.keyboard.press("ArrowDown");
      await expect(rythme).toBeFocused();
      await expect(rythme).toBeChecked();
      await expect(ensemble).not.toBeChecked();
      await guide.keyboard.press("ArrowUp");
      await expect(ensemble).toBeChecked();
      await guide.keyboard.press("ArrowRight");
      await expect(rythme).toBeChecked();
      await guide.keyboard.press("ArrowRight");
      await expect(ensemble).toBeChecked();

      await groupe.getByText("Chacun à son rythme").click();
      await expect(rythme).toBeChecked();
    });
  });

  test.describe(`FormField (${nomZone})`, () => {
    test("aide liée, puis erreur annoncée, aria-invalid et description", async ({ guide }) => {
      const z = zone(guide);
      const champ = z.getByLabel("Ton pseudo");
      await expect(champ).not.toHaveAttribute("aria-invalid", "true");
      await expect(champ).toHaveAccessibleDescription("20 caractères au maximum.");
      await expect(z.getByRole("alert").filter({ hasText: "Choisis un pseudo" })).toHaveCount(0);

      await champ.focus();
      await champ.blur();
      const alerte = z.getByRole("alert").filter({ hasText: "Choisis un pseudo pour rejoindre la partie." });
      await expect(alerte).toBeVisible();
      await expect(champ).toHaveAttribute("aria-invalid", "true");
      const description = (await champ.getAttribute("aria-describedby"))!.split(" ");
      expect(description).toHaveLength(2);
      expect(await alerte.getAttribute("id")).toBe(description[0]);
      await expect(champ).toHaveAccessibleDescription(/Choisis un pseudo pour rejoindre la partie\..*20 caractères/);

      await champ.fill("Salomon");
      await expect(alerte).toHaveCount(0);
      await expect(champ).not.toHaveAttribute("aria-invalid", "true");
      await expect(champ).toHaveAccessibleDescription("20 caractères au maximum.");
      await champ.fill("a".repeat(30));
      expect((await champ.inputValue()).length).toBe(20);
    });
  });
}

test.describe("Button", () => {
  test("chargement : aria-busy, annonce, reste focalisable, clic neutralisé", async ({ guide }) => {
    const bouton = zoneJaune(guide).getByRole("button", { name: /Envoi/ });
    await expect(bouton).toHaveAttribute("aria-busy", "true");
    await expect(bouton).toHaveAttribute("aria-disabled", "true");
    expect(await bouton.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(false);
    await expect(bouton).toContainText("Chargement en cours");
    await bouton.focus();
    await expect(bouton).toBeFocused();
  });

  // La démo statique n'est pas hydratée : on monte le vrai composant via Vite (DEV) dans un formulaire pour mesurer le garde-fou.
  test("chargement : deux clics n'envoient pas le formulaire, témoin sans chargement envoie", async ({ guide }) => {
    const racine = process.cwd();
    const envois = await guide.evaluate(async (dir) => {
      // Import dynamique construit à l'exécution : ces modules n'existent que côté navigateur (Vite DEV).
      const importer = new Function("u", "return import(u)") as (u: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { Button } = await importer(`/@fs${dir}/src/components/ui/button.tsx`);
      const reactMod = await importer("/@id/react");
      const clientMod = await importer("/@id/react-dom/client");
      const React = reactMod.default ?? reactMod;
      const createRoot = clientMod.createRoot ?? clientMod.default.createRoot;
      const mesurer = async (chargement: boolean) => {
        document.body.insertAdjacentHTML("beforeend", "<div></div>");
        const hote = document.body.lastElementChild as HTMLElement;
        let n = 0;
        const bouton = () => hote.querySelector("button") as HTMLButtonElement;
        createRoot(hote).render(
          React.createElement(
            "form",
            { onSubmit: (e: Event) => (e.preventDefault(), n++) },
            React.createElement(Button, { chargement, type: "submit" }, "Go"),
          ),
        );
        await new Promise((r) => setTimeout(r, 300));
        bouton().click();
        bouton().click();
        return n;
      };
      return { enCharge: await mesurer(true), temoin: await mesurer(false) };
    }, racine);
    expect(envois).toEqual({ enCharge: 0, temoin: 2 });
  });

  test("rendu en lien avec href : <a>, cible de 44 px, atteignable au clavier, même habillage", async ({ guide }) => {
    const racine = process.cwd();
    const lien = await guide.evaluate(async (dir) => {
      // Import dynamique construit à l'exécution : ces modules n'existent que côté navigateur (Vite DEV).
      const importer = new Function("u", "return import(u)") as (u: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { Button } = await importer(`/@fs${dir}/src/components/ui/button.tsx`);
      const reactMod = await importer("/@id/react");
      const clientMod = await importer("/@id/react-dom/client");
      const React = reactMod.default ?? reactMod;
      const createRoot = clientMod.createRoot ?? clientMod.default.createRoot;
      document.body.insertAdjacentHTML("beforeend", "<div></div>");
      const hote = document.body.lastElementChild as HTMLElement;
      createRoot(hote).render(React.createElement(Button, { href: "/connexion", taille: "petit" }, "Créer un compte"));
      await new Promise((r) => setTimeout(r, 300));
      const a = hote.firstElementChild as HTMLAnchorElement;
      const r = a.getBoundingClientRect();
      a.focus();
      return { tag: a.tagName, href: a.getAttribute("href"), hauteur: r.height, focus: document.activeElement === a, role: a.getAttribute("role") };
    }, racine);
    expect(lien).toMatchObject({ tag: "A", href: "/connexion", focus: true, role: null });
    expect(lien.hauteur).toBeGreaterThanOrEqual(44);
  });

  test("désactivé : natif, pas d'opacité réduite, contraste AA", async ({ guide }) => {
    const bouton = zoneJaune(guide).getByRole("button", { name: "Désactivé" });
    await expect(bouton).toBeDisabled();
    const etat = await bouton.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { opacite: cs.opacity, couleur: cs.color, style: cs.borderStyle, fond: getComputedStyle(document.documentElement).backgroundColor };
    });
    expect(etat.opacite).toBe("1");
    expect(etat.style).toBe("dashed");
    expect(etat.couleur).toBe(await couleurJeton(guide, "vert-mousse"));
    expect(contraste(etat.couleur, etat.fond)).toBeGreaterThanOrEqual(4.5);
  });

  test("désactivé : ne prend pas le focus au clic", async ({ guide }) => {
    const bouton = zoneJaune(guide).getByRole("button", { name: "Désactivé" });
    await bouton.click({ force: true });
    await expect(bouton).not.toBeFocused();
  });
});

test.describe("MenuCompte", () => {
  test("aria-expanded, Échap ferme et rend le focus, clic dehors ferme", async ({ guide }) => {
    const z = zoneJaune(guide);
    const bouton = z.getByRole("button", { name: /Menu du compte/ });
    const lien = z.getByRole("link", { name: "Se déconnecter" });
    await expect(bouton).toHaveAttribute("aria-expanded", "false");
    await expect(lien).toBeHidden();
    await bouton.click();
    await expect(bouton).toHaveAttribute("aria-expanded", "true");
    await expect(lien).toBeVisible();
    await guide.keyboard.press("Escape");
    await expect(lien).toBeHidden();
    await expect(bouton).toBeFocused();
    await bouton.click();
    await guide.mouse.click(2, 2);
    await expect(lien).toBeHidden();
  });
});
