import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { arreterTout, lancerServeur, type ServeurLocal } from "./serveur-local";

// CAPTURES_DIR : dossier des captures de revue ; sans lui, aucune image n'est écrite.
async function capturer(page: Page, nom: string) {
  const dossier = process.env.CAPTURES_DIR;
  if (!dossier) return;
  mkdirSync(dossier, { recursive: true });
  await page.screenshot({ path: join(dossier, `qz002-12-${nom}.png`), fullPage: true });
}

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

// La page de confirmation lit l'adresse en sessionStorage (jamais dans l'URL) : on la pose comme le fait le formulaire.
async function adresseEnvoyee(page: Page, email: string) {
  await page.addInitScript((valeur) => sessionStorage.setItem("quizdeszeles:connexion-email", valeur), email);
}

async function axe(page: Page) {
  const resultat = await new AxeBuilder({ page }).analyze();
  return resultat.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function ciblesTactilesAssezGrandes(page: Page) {
  const petites = await page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input")]
      .map((el) => ({ nom: (el.textContent || el.getAttribute("name") || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((c) => c.h > 0 && c.h < 44),
  );
  expect(petites).toEqual([]);
}

test.describe("pages 404 et 500", () => {
  test("404 : style affiche, retour à l'accueil, axe propre", async ({ page, request }) => {
    const reponse = await request.get("/une-page-qui-nexiste-pas");
    expect(reponse.status()).toBe(404);
    await page.goto("/une-page-qui-nexiste-pas");
    await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "404");
    await page.getByRole("link", { name: "Retour à l'accueil" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("500 : message et retour à l'accueil, axe propre", async ({ page }) => {
    await page.goto("/500");
    await expect(page.getByRole("heading", { level: 1, name: /souci de notre côté/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toHaveAttribute("href", "/");
    expect(await axe(page)).toEqual([]);
    await capturer(page, "500");
  });
});

test.describe("confirmation d'envoi (serveur partagé)", () => {
  test("renvoi temporisé : bouton inactif puis actif, nouvel envoi confirmé", async ({ page }) => {
    await page.clock.install();
    await page.route("**/api/auth/sign-in/magic-link", (route) => route.fulfill({ status: 200, json: { status: true } }));
    await adresseEnvoyee(page, "esther@exemple.fr");
    await page.goto("/connexion/verifier?retour=%2Fquiz%2Fabc");
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
    await expect(page.getByText("e***@exemple.fr")).toBeVisible();
    await expect(page.getByText("esther@exemple.fr")).toHaveCount(0);
    const renvoi = page.getByRole("button", { name: /Renvoyer le lien/ });
    await expect(renvoi).toBeDisabled();
    await expect(renvoi).toContainText("dans 60 s");
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "verifier");
    await page.clock.runFor(61_000);
    await expect(renvoi).toBeEnabled();
    await renvoi.click();
    await expect(page.getByRole("status")).toHaveText("Un nouveau lien vient de partir.");
    await expect(renvoi).toBeDisabled();
  });

  test("un refus 429 au renvoi affiche le message neutre", async ({ page }) => {
    await page.clock.install();
    await page.route("**/api/auth/sign-in/magic-link", (route) => route.fulfill({ status: 429, json: { message: "Too many requests." } }));
    await adresseEnvoyee(page, "esther@exemple.fr");
    await page.goto("/connexion/verifier");
    await hydrate(page);
    await page.clock.runFor(61_000);
    await page.getByRole("button", { name: "Renvoyer le lien" }).click();
    const alerte = page.getByRole("alert");
    await expect(alerte).toContainText("Trop de demandes, réessaie dans une minute.");
    await expect(alerte).not.toContainText(/jour|quotidien/i);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "verifier-erreur");
  });

  test("sans adresse en mémoire : confirmation sans renvoi, avec « Changer d'adresse »", async ({ page }) => {
    await page.goto("/connexion/verifier?retour=https%3A%2F%2Fevil.example");
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Renvoyer le lien/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Changer d'adresse" })).toHaveAttribute("href", "/connexion?retour=%2Ftableau-de-bord");
    expect(await axe(page)).toEqual([]);
  });

  test("le décompte survit à un rechargement de la page", async ({ page }) => {
    await page.clock.install();
    await adresseEnvoyee(page, "esther@exemple.fr");
    await page.goto("/connexion/verifier");
    await hydrate(page);
    await page.clock.runFor(20_000);
    await expect(page.getByRole("button", { name: /Renvoyer le lien/ })).toContainText("dans 40 s");
    await page.reload();
    await hydrate(page);
    await expect(page.getByRole("button", { name: /Renvoyer le lien/ })).toContainText(/dans (39|40) s/);
  });
});

test.describe("connexion, lien magique seul", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(2);
  });
  test.afterAll(() => arreterTout());

  test("état vide : formulaire initial, aucun bouton Google, axe propre", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion?retour=%2Fquiz%2Fabc`);
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Connecte-toi");
    await expect(page.getByRole("button", { name: "Continuer avec Google" })).toHaveCount(0);
    await expect(page.getByLabel("Ton adresse e-mail")).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "connexion-vide");
  });

  test("e-mail invalide : message d'erreur lié au champ, aucun envoi", async ({ page }) => {
    let appels = 0;
    await page.route("**/api/auth/sign-in/magic-link", (route) => {
      appels++;
      return route.abort();
    });
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await page.getByLabel("Ton adresse e-mail").fill("pas-un-mail");
    await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
    await expect(page.getByRole("alert")).toContainText("n'a pas l'air valide");
    await expect(page.getByLabel("Ton adresse e-mail")).toHaveAttribute("aria-invalid", "true");
    expect(appels).toBe(0);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "connexion-email-invalide");
  });

  test("lien expiré : message français après la redirection de Better Auth", async ({ page }) => {
    await page.goto(`${serveur.url}/api/auth/magic-link/verify?token=inconnu&callbackURL=%2Fquiz%2Fabc&errorCallbackURL=%2Fconnexion%3Fretour%3D%252Fquiz%252Fabc`);
    await hydrate(page);
    await expect(page).toHaveURL(/\/connexion\?retour=%2Fquiz%2Fabc&error=INVALID_TOKEN/);
    await expect(page.getByRole("alert")).toContainText("Ce lien a expiré ou a déjà servi.");
    expect(await axe(page)).toEqual([]);
    await capturer(page, "connexion-lien-expire");
  });

  test("retour externe refusé : le callbackURL envoyé retombe sur le tableau de bord", async ({ page }) => {
    let corps: { callbackURL?: string } = {};
    await page.route("**/api/auth/sign-in/magic-link", (route) => {
      corps = route.request().postDataJSON();
      return route.fulfill({ status: 200, json: { status: true } });
    });
    await page.goto(`${serveur.url}/connexion?retour=https%3A%2F%2Fevil.example%2Fquiz`);
    await hydrate(page);
    await page.getByLabel("Ton adresse e-mail").fill("externe@exemple.fr");
    await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
    await expect(page).toHaveURL(/\/connexion\/verifier/);
    expect(corps.callbackURL).toBe("/tableau-de-bord");
  });

  test("parcours complet : demande, confirmation, lien du journal, session et redirection vers retour", async ({ page }) => {
    const email = "parcours@exemple.fr";
    await page.goto(`${serveur.url}/connexion?retour=%2Fquiz%2Fabc`);
    await hydrate(page);
    await page.getByLabel("Ton adresse e-mail").fill(email);
    await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible();
    await expect(page).toHaveURL(/\/connexion\/verifier\?retour=%2Fquiz%2Fabc$/);

    const lien = await serveur.lienMagique(email);
    await page.goto(lien);
    await expect(page).toHaveURL(/\/quiz\/abc$/);
    const session = await page.request.get(`${serveur.url}/api/auth/get-session`);
    expect((await session.json()).user.email).toBe(email);

    // Connecté : /connexion renvoie directement vers `retour`.
    await page.goto(`${serveur.url}/connexion?retour=%2Fquiz%2Fabc`);
    await expect(page).toHaveURL(/\/quiz\/abc$/);
  });
});

test.describe("connexion, Google et lien magique", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(3, { GOOGLE_CLIENT_ID: "id-factice.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "secret-factice" });
  });
  test.afterAll(() => arreterTout());

  test("Google est l'action principale et lance la redirection avec le retour", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion?retour=%2Fquiz%2Fabc`);
    await hydrate(page);
    const google = page.getByRole("button", { name: "Continuer avec Google" });
    await expect(google).toBeVisible();
    await expect(page.getByLabel("Ton adresse e-mail")).toBeVisible();
    await ciblesTactilesAssezGrandes(page);
    expect(await axe(page)).toEqual([]);
    await capturer(page, "connexion-google");

    let urlGoogle = "";
    await page.route("https://accounts.google.com/**", (route) => {
      urlGoogle = route.request().url();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google</title>" });
    });
    await google.click();
    await expect(page).toHaveURL(/accounts\.google\.com/);
    expect(urlGoogle).toContain("client_id=id-factice");
    expect(urlGoogle).toContain("redirect_uri=");
  });

  test("état de chargement pendant la redirection Google", async ({ page }) => {
    await page.route("**/api/auth/sign-in/social", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ status: 200, json: { url: `${serveur.url}/connexion`, redirect: true } });
    });
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await page.getByRole("button", { name: "Continuer avec Google" }).click();
    await expect(page.getByRole("button", { name: /Redirection vers Google en cours/ })).toHaveAttribute("aria-busy", "true");
    await capturer(page, "connexion-chargement");
  });

  test("échec Google : message d'erreur et bouton de nouveau disponible", async ({ page }) => {
    await page.route("**/api/auth/sign-in/social", (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto(`${serveur.url}/connexion`);
    await hydrate(page);
    await page.getByRole("button", { name: "Continuer avec Google" }).click();
    await expect(page.getByRole("alert")).toContainText("Réessaie");
    await expect(page.getByRole("button", { name: "Continuer avec Google" })).not.toHaveAttribute("aria-busy", "true");
    await capturer(page, "connexion-erreur");
  });
});

test.describe("connexion, aucune méthode active", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    serveur = await lancerServeur(4, { MAGIC_LINK_ENABLED: "false" });
  });
  test.afterAll(() => arreterTout());

  test("état d'erreur explicite, retour à l'accueil, axe propre", async ({ page }) => {
    await page.goto(`${serveur.url}/connexion`);
    await expect(page.getByRole("heading", { level: 1, name: "Connexion indisponible" })).toBeVisible();
    await expect(page.getByText("Aucune méthode de connexion")).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await capturer(page, "connexion-aucune-methode");
  });
});
