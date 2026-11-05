import { expect, test } from "@playwright/test";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PORT_PREVIEW } from "../serveurs";
import { anneau, interactifs, pret, sansViolation } from "./aide";

// Parcours réel : vrai Worker local (bundle dist/server), vraie D1 migrée, vrai Durable Object. Aucun appel distant.
// Serveur dédié (LOCAL_TOOLS=true passé explicitement, sans dépendre du preview des e2e) et état D1 isolé dans un dossier temporaire.
const CONFIG = "dist/server/wrangler.json";
const questions = [
  {
    kind: "single",
    prompt: "Qui a construit l'arche ?",
    durationSec: 20,
    options: [
      { label: "Noé", isCorrect: true },
      { label: "Moïse", isCorrect: false },
    ],
  },
];

test.describe.configure({ mode: "serial" });

let serveur: ChildProcess | null = null;
let dossier = "";
let base = "";
let secret = "";
let sortie = "";
let persistMigree = "";

async function demarrer(port: number, persist: string, migrer: boolean) {
  if (migrer) execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", CONFIG, "--persist-to", persist], { stdio: "ignore" });
  const enfant = spawn("npx", ["wrangler", "dev", "--config", CONFIG, "--port", String(port), "--local", "--persist-to", persist, "--var", "LOCAL_TOOLS:true"], { stdio: ["ignore", "pipe", "pipe"] });
  sortie = "";
  enfant.stdout?.on("data", (d) => (sortie += d));
  enfant.stderr?.on("data", (d) => (sortie += d));
  const limite = Date.now() + 90_000;
  for (;;) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).status > 0) break;
    } catch {
      if (Date.now() > limite) throw new Error(`wrangler dev ne répond pas :\n${sortie}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return enfant;
}

async function arreter() {
  if (!serveur?.pid) return;
  // wrangler lance workerd en sous-processus : on termine le groupe entier via le PID du parent, rien d'autre.
  const pid = serveur.pid;
  serveur.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  try {
    process.kill(pid, 0);
    serveur.kill("SIGKILL");
  } catch {
    /* déjà terminé */
  }
  serveur = null;
}

test.afterAll(async () => {
  await arreter();
  if (dossier) rmSync(dossier, { recursive: true, force: true });
});

test("D1 sans migrations : l'inscription répond 500 (cause de l'erreur signalée par l'implémenteur)", async ({ browserName: _nav }, info) => {
  test.setTimeout(150_000);
  dossier = mkdtempSync(join(tmpdir(), "qz10-d1-"));
  const port = PORT_PREVIEW + 30 + (info.project.name === "mobile" ? 0 : 1);
  serveur = await demarrer(port, join(dossier, "vide"), false);
  const res = await fetch(`http://localhost:${port}/api/parties/ABCDEF/joueurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pseudo: "Léa" }),
  });
  // Un code de format valide atteint D1 : sans table sessions, l'API ne peut pas répondre 404 propre.
  info.annotations.push({ type: "d1-sans-migrations", description: `statut ${res.status}` });
  expect(res.status).toBe(500);
  await arreter();
});

test.describe("avec D1 migrée", () => {
  test.beforeAll(async ({ browserName: _nav }, info) => {
    test.setTimeout(150_000);
    const port = PORT_PREVIEW + 30 + (info.project.name === "mobile" ? 0 : 1);
    persistMigree = join(dossier || (dossier = mkdtempSync(join(tmpdir(), "qz10-d1-"))), "migree");
    serveur = await demarrer(port, persistMigree, true);
    base = `http://localhost:${port}`;
    secret = JSON.parse(readFileSync(CONFIG, "utf8")).vars?.PLAYER_TOKEN_SECRET;
    expect(secret).toBeTruthy();
  });
  test.afterAll(arreter);

  const creer = async () => {
    const res = await fetch(`${base}/api/parties/local`, { method: "POST", headers: { "Content-Type": "application/json", "x-local-secret": secret }, body: JSON.stringify({ questions }) });
    expect(res.status).toBe(201);
    const jeu = (await res.json()) as { code: string; hostToken: string };
    expect(jeu.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    return jeu;
  };

  test("la route locale refuse un mauvais secret (404)", async () => {
    const res = await fetch(`${base}/api/parties/local`, { method: "POST", headers: { "x-local-secret": "faux" }, body: "{}" });
    expect(res.status).toBe(404);
  });

  test("code inconnu : annoncé dès l'arrivée sans champ pseudo, l'API répond 404 game_not_found", async ({ page }) => {
    await page.goto(`${base}/j/ZZZZZZ`);
    await pret(page);
    // Le bloc pseudo est masqué tant que le code annoncé inconnu n'est pas modifié : l'erreur se lit à l'arrivée, plus après l'envoi.
    await expect(page.getByRole("alert").filter({ hasText: "Aucune partie ne correspond à ce code" })).toBeVisible();
    await expect(page.getByLabel("Pseudo")).toHaveCount(0);
    const res = await page.request.post(`${base}/api/parties/ZZZZZZ/joueurs`, { data: { pseudo: "Léa" } });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: "game_not_found" });
  });

  test("inscription réelle : 201, jeton signé stocké, redirection vers /jouer, reprise directe", async ({ page }) => {
    const { code } = await creer();
    await page.goto(`${base}/j/${code.toLowerCase()}`);
    await pret(page);
    await sansViolation(page);
    await page.getByLabel("Pseudo").fill("Léa 🙂");
    const reponse = page.waitForResponse((r) => r.url().includes(`/api/parties/${code}/joueurs`));
    await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
    const res = await reponse;
    expect(res.status()).toBe(201);

    await expect(page).toHaveURL(new RegExp(`/j/${code}/jouer$`));
    const stock = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(Object.keys(stock)).toEqual([`quizdeszeles:jeton:${code}`]);
    const jeton = JSON.parse(stock[`quizdeszeles:jeton:${code}`]) as { playerId: string; token: string };
    expect(Object.keys(jeton).sort()).toEqual(["playerId", "token"]);
    expect(jeton.playerId).toBeTruthy();
    expect(jeton.token.length).toBeGreaterThan(20);

    // Retour sur la page de la partie : reprise directe, sans nouvelle inscription.
    let inscriptions = 0;
    page.on("request", (r) => r.url().includes("/joueurs") && inscriptions++);
    await page.goto(`${base}/j/${code}`);
    await expect(page).toHaveURL(new RegExp(`/j/${code}/jouer$`));
    expect(inscriptions).toBe(0);
  });

  test("pseudo déjà pris (409) dans une vraie partie, casse et accents ignorés", async ({ browser }) => {
    const { code } = await creer();
    const inscrire = async (pseudo: string) => {
      const ctx = await browser.newContext({ baseURL: base });
      const page = await ctx.newPage();
      await page.goto(`/j/${code}`);
      await pret(page);
      await page.getByLabel("Pseudo").fill(pseudo);
      const reponse = page.waitForResponse((r) => r.url().includes("/joueurs"));
      await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
      const statut = (await reponse).status();
      return { page, ctx, statut };
    };
    const premier = await inscrire("Zoé");
    expect(premier.statut).toBe(201);
    const second = await inscrire("zoé");
    expect(second.statut).toBe(409);
    await expect(second.page.getByRole("alert").filter({ hasText: "déjà pris" })).toBeVisible();
    expect(await second.page.evaluate(() => localStorage.length)).toBe(0);
    await premier.ctx.close();
    await second.ctx.close();
  });

  test("double clic réel : un seul joueur créé (le second pseudo identique serait refusé en 409)", async ({ page }) => {
    const { code } = await creer();
    let envois = 0;
    page.on("request", (r) => r.method() === "POST" && r.url().includes("/joueurs") && envois++);
    await page.goto(`${base}/j/${code}`);
    await pret(page);
    await page.getByLabel("Pseudo").fill("Awa");
    await page.getByRole("button", { name: "Rejoindre", exact: true }).dblclick({ noWaitAfter: true });
    await expect(page).toHaveURL(new RegExp(`/j/${code}/jouer$`));
    expect(envois).toBe(1);
  });

  test("depuis l'accueil : code saisi puis inscription", async ({ page }) => {
    const { code } = await creer();
    await page.goto(`${base}/`);
    await pret(page);
    await page.getByLabel("Code de la partie").fill(code);
    await page.getByRole("button", { name: "Rejoindre la partie" }).click();
    await expect(page).toHaveURL(new RegExp(`/j/${code}$`));
    await pret(page);
    await page.getByLabel("Pseudo").fill("Marie");
    const reponse = page.waitForResponse((r) => r.url().includes("/joueurs"));
    await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
    expect((await reponse).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/j/${code}/jouer$`));
  });
  const terminer = (code: string) =>
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "DB", "--local", "--config", CONFIG, "--persist-to", persistMigree, "--command", `UPDATE game_sessions SET status = 'ended' WHERE code = '${code}'`],
      { stdio: "ignore" },
    );

  test("encart titre et animateur lu au rendu serveur, cache privé de 30 s, aucun JavaScript requis pour le lire", async ({ page, request }) => {
    const { code } = await creer();
    const reponse = await request.get(`${base}/j/${code}`);
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()["cache-control"]).toBe("private, max-age=30");
    const html = await reponse.text();
    expect(html).toContain("Partie locale");
    expect(html).toContain("Animateur local");
    // Aucune donnée sensible ne part dans la page : ni e-mail de l'animateur, ni jeton, ni identifiant de partie.
    expect(html).not.toMatch(/local-dev@example\.invalid|hostToken|ownerId|owner_id|x-local-secret/);

    await page.goto(`${base}/j/${code}`);
    await pret(page);
    await expect(page.getByText("Partie locale")).toBeVisible();
    await expect(page.getByText("Animé par")).toContainText("Animateur local");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await sansViolation(page);
    expect((await interactifs(page)).filter((e) => e.h < 44 || e.l < 44)).toEqual([]);
    const largeur = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largeur);
    const sansAnneau: string[] = [];
    for (const cible of [page.getByLabel("Pseudo"), page.getByRole("button", { name: "Rejoindre", exact: true }), page.getByRole("link", { name: "Retour à l'accueil" })]) {
      const o = await anneau(page, cible);
      if (!o.fv || o.style === "none" || o.largeur < 2) sansAnneau.push(await cible.evaluate((el) => el.getAttribute("aria-label") ?? el.id ?? el.tagName));
    }
    expect(sansAnneau).toEqual([]);
  });

  test("l'encart n'apparaît pas si le code saisi diffère du code de la page", async ({ page }) => {
    const { code } = await creer();
    await page.goto(`${base}/j/${code}`);
    await pret(page);
    const cases = page.getByRole("group", { name: "Code de la partie" }).getByRole("textbox");
    await cases.last().focus();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(code[4] === "K" ? "MM" : "KK");
    await expect(page.getByText("Animé par")).toHaveCount(0);
  });

  test("code inconnu : l'échec est annoncé dès l'arrivée, sans envoi, sans champ pseudo", async ({ page }) => {
    let envois = 0;
    page.on("request", (r) => r.method() === "POST" && r.url().includes("/joueurs") && envois++);
    await page.goto(`${base}/j/ZZZZZZ`);
    await pret(page);
    await expect(page.getByRole("alert").filter({ hasText: "Aucune partie ne correspond à ce code" })).toBeVisible();
    await expect(page.getByText("Animé par")).toHaveCount(0);
    expect(envois).toBe(0);
    await sansViolation(page);
    // Code inconnu et non modifié : le pseudo n'a pas de sens, il reparaît quand le code change.
    await expect(page.getByLabel("Pseudo")).toHaveCount(0);
  });

  test("partie terminée : annoncée dès l'arrivée ; l'API répond 410 game_finished", async ({ page }) => {
    const { code } = await creer();
    terminer(code);
    await page.goto(`${base}/j/${code}`);
    await pret(page);
    await expect(page.getByRole("alert").filter({ hasText: "Cette partie est terminée" })).toBeVisible();
    await expect(page.getByText("Animé par")).toHaveCount(0);
    await sansViolation(page);
    const res = await page.request.post(`${base}/api/parties/${code}/joueurs`, { data: { pseudo: "Tard" } });
    // Le 404 figé ici contredisait la page qui annonce « terminée » : l'API relit désormais la dernière partie du code (410).
    expect(res.status()).toBe(410);
    expect(await res.json()).toEqual({ error: "game_finished" });
  });

  test("forme non normalisée : 301 vers /j/CODE, y compris pour une partie réelle", async ({ request }) => {
    const { code } = await creer();
    const reponse = await request.get(`${base}/j/${code.toLowerCase()}`, { maxRedirects: 0 });
    expect(reponse.status()).toBe(301);
    expect(reponse.headers()["location"]).toBe(`/j/${code}`);
    const ok = await request.get(`${base}/j/${code}`, { maxRedirects: 0 });
    expect(ok.status()).toBe(200);
  });

  test("repli sans JavaScript : GET /?code= mène par 303 à /j/CODE", async ({ request }) => {
    const { code } = await creer();
    const reponse = await request.get(`${base}/?code=${code.toLowerCase()}`, { maxRedirects: 0 });
    expect(reponse.status()).toBe(303);
    expect(reponse.headers()["location"]).toBe(`/j/${code}`);
  });

  test("location.replace : après une inscription, le retour arrière ne ramène pas sur le formulaire", async ({ page }) => {
    const { code } = await creer();
    await page.goto(`${base}/`);
    await pret(page);
    await page.goto(`${base}/j/${code}`);
    await pret(page);
    await page.getByLabel("Pseudo").fill("Retour");
    const reponse = page.waitForResponse((r) => r.url().includes("/joueurs"));
    await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
    expect((await reponse).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/j/${code}/jouer$`));
    await page.goBack();
    // /j/CODE a été remplacée dans l'historique : on revient à l'accueil, pas au formulaire d'inscription.
    await expect(page).toHaveURL(`${base}/`);
  });
});
