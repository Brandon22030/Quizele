import AxeBuilder from "@axe-core/playwright";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { ServeurLocal } from "../tableau-de-bord/serveur-local";

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const VIEWPORT = { width: 390, height: 844 };

export async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

/** Violations serious ou critical uniquement, avec les cibles pour le diagnostic. */
export async function axeGrave(page: Page, ecran: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    graves.map((v) => `${ecran} : ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `axe sur « ${ecran} »`,
  ).toEqual([]);
}

/** Connexion par lien magique réel : le lien est lu dans le journal console du serveur dédié. */
export async function connecterParLienMagique(page: Page, serveur: ServeurLocal, email: string) {
  await page.goto(`${serveur.url}/connexion`);
  await hydrate(page);
  await axeGrave(page, "connexion");
  await page.getByLabel("Ton adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible({ timeout: 30_000 });
  await axeGrave(page, "connexion : lien envoyé");
  await page.goto(await serveur.lienMagique(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/, { timeout: 30_000 });
  await hydrate(page);
}

export async function ouvrirJoueur(browser: Browser, serveur: ServeurLocal, code: string, pseudo: string, options: { reducedMotion?: "reduce" } = {}) {
  const contexte = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, ...options });
  const page = await contexte.newPage();
  await page.goto(`${serveur.url}/j/${code}`);
  await hydrate(page);
  await page.getByLabel("Pseudo").fill(pseudo);
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/j/${code}/jouer$`), { timeout: 30_000 });
  await expect(page.getByText("EN ATTENTE")).toBeVisible({ timeout: 30_000 });
  return { contexte, page, pseudo };
}

/** Remplace navigator.share par un espion qui garde les octets du fichier partagé. */
export async function espionnerPartage(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __partage: { type: string; nom: string; octets: number[] } | null };
    w.__partage = null;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (donnees: ShareData) => {
        const fichier = donnees.files?.[0];
        if (!fichier) return;
        w.__partage = { type: fichier.type, nom: fichier.name, octets: Array.from(new Uint8Array(await fichier.arrayBuffer())) };
      },
    });
  });
}

export async function lirePartage(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __partage: unknown }).__partage), { timeout: 15_000 }).not.toBeNull();
  return page.evaluate(() => (window as unknown as { __partage: { type: string; nom: string; octets: number[] } }).__partage);
}

export function verifierPng(partage: { type: string; octets: number[] }) {
  expect(partage.type).toBe("image/png");
  expect(partage.octets.length).toBeGreaterThan(1000);
  expect(partage.octets.slice(0, 8)).toEqual(PNG_SIGNATURE);
}

/** Aucune animation infinie en cours : ce que prefers-reduced-motion doit garantir. */
export async function animationsEnBoucle(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity)
      .map((a) => (a as CSSAnimation).animationName ?? a.id ?? "animation"),
  );
}

export async function fermer(...contextes: BrowserContext[]) {
  await Promise.all(contextes.map((c) => c.close().catch(() => undefined)));
}
