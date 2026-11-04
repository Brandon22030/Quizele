import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { parse } from "devalue";
import { WS_SUBPROTOCOL, serverMessageSchema, type ServerMessage } from "../../../src/shared/protocol";
import { arreterTout, lancerServeur, type ServeurLocal } from "../tableau-de-bord/serveur-local";

// QA indépendante QZ-002-17 : le bilan est produit par une vraie partie (quiz créé par les Actions, lancé, joué par
// 7 joueurs en WebSocket, terminé par l'hôte), pas par des lignes semées en SQL.

const A = "qa-animateur-a@exemple.fr";
const B = "qa-animateur-b@exemple.fr";

// Pseudos hostiles que le serveur de jeu accepte (les caractères de contrôle, dont \n et \t, sont refusés à l'inscription).
const HOSTILES = ['=HYPERLINK("a";"b")', "+1", "@x", 'a;b"c', "-2+3"];
const PSEUDOS = [...HOSTILES, "Grâce", "Noé"];

async function hydrate(page: Page) {
  await page.waitForFunction(() => {
    const ilots = document.querySelectorAll("astro-island");
    return ilots.length > 0 && [...ilots].every((i) => !i.hasAttribute("ssr"));
  });
  await page.evaluate(() => document.fonts.ready);
}

const cookies = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function ouvrir(browser: Browser, serveur: ServeurLocal, email: string) {
  const contexte = await browser.newContext({ viewport: test.info().project.use.viewport ?? { width: 390, height: 844 } });
  const page = await contexte.newPage();
  const connus = cookies.get(email);
  if (connus) {
    await contexte.addCookies(connus);
    return { contexte, page };
  }
  await page.goto(`${serveur.url}/connexion`);
  await hydrate(page);
  await page.getByLabel("Ton adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un lien par e-mail" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Regarde ta boîte mail" })).toBeVisible({ timeout: 30_000 });
  await page.goto(await serveur.lienMagique(email));
  await expect(page).toHaveURL(/\/tableau-de-bord$/, { timeout: 30_000 });
  cookies.set(email, await contexte.cookies());
  return { contexte, page };
}

async function action<T>(api: APIRequestContext, serveur: ServeurLocal, nom: string, corps: unknown): Promise<T> {
  const r = await api.post(`${serveur.url}/_actions/${nom}`, { data: corps, headers: { Origin: serveur.url } });
  const texte = await r.text();
  expect(r.status(), `${nom} -> ${texte}`).toBe(200);
  return parse(texte) as T;
}

class Socket {
  readonly messages: ServerMessage[] = [];
  private readonly ws: WebSocket;
  private readonly ecouteurs = new Set<() => void>();
  constructor(url: string, token: string) {
    this.ws = new WebSocket(url, [WS_SUBPROTOCOL, token]);
    this.ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      this.messages.push(serverMessageSchema.parse(JSON.parse(e.data)));
      this.ecouteurs.forEach((f) => f());
    });
  }
  async ouvert() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error("WebSocket refusé")));
    });
  }
  envoyer(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  attendre<T extends ServerMessage["type"]>(type: T, filtre: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) {
    const chercher = () => this.messages.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && filtre(m as never));
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const trouve = chercher();
      if (trouve) return resolve(trouve);
      const minuteur = setTimeout(() => reject(new Error(`Délai dépassé : ${type}`)), 20_000);
      const f = () => {
        const m = chercher();
        if (!m) return;
        clearTimeout(minuteur);
        this.ecouteurs.delete(f);
        resolve(m);
      };
      this.ecouteurs.add(f);
    });
  }
  fermer() {
    try {
      this.ws.close(1000);
    } catch {
      // déjà fermé
    }
  }
}

const question = (prompt: string, bonne: string, autres: string[], reference?: string) => ({
  type: "single",
  prompt,
  durationSec: 30,
  reference,
  options: [{ label: bonne, isCorrect: true }, ...autres.map((label) => ({ label, isCorrect: false }))],
});

// Q1 : 1 joueur sur 7 réussit (14 %). Q2 : 4 sur 7 (57 %). Q3 : tous (100 %, donc absente de « À revoir »).
const BONNES: Record<number, string[]> = { 0: ["Grâce"], 1: ["Grâce", "Noé", HOSTILES[0]!, HOSTILES[1]!], 2: PSEUDOS };

async function jouerPartie(serveur: ServeurLocal, api: APIRequestContext): Promise<{ sessionId: string; code: string }> {
  const { quizId } = await action<{ quizId: string }>(api, serveur, "quiz.creer", { title: "Les héros de la foi QA" });
  const qs = [
    question("Combien de jours a duré la création ?", "Six jours", ["Sept jours", "Trois jours"], "Genèse 1"),
    question("Qui a construit l'arche ?", "Noé", ["Moïse", "Josué"]),
    question("Question facile", "Oui", ["Non"]),
  ];
  for (const q of qs) await action(api, serveur, "quiz.ajouterQuestion", { quizId, question: q });
  const { sessionId, code, hostToken } = await action<{ sessionId: string; code: string; hostToken: string }>(api, serveur, "partie.lancer", { quizId });
  const ws = serveur.url.replace("http", "ws");
  const hote = new Socket(`${ws}/ws/${code}`, hostToken);
  await hote.ouvert();
  hote.envoyer({ type: "resume" });
  await hote.attendre("snapshot");

  const joueurs: { pseudo: string; socket: Socket }[] = [];
  for (const pseudo of PSEUDOS) {
    const r = await api.post(`${serveur.url}/api/parties/${code}/joueurs`, { data: { pseudo }, headers: { Origin: serveur.url } });
    expect(r.status(), `join ${pseudo}`).toBe(201);
    const { token } = (await r.json()) as { token: string };
    const socket = new Socket(`${ws}/ws/${code}`, token);
    await socket.ouvert();
    socket.envoyer({ type: "resume" });
    await socket.attendre("snapshot");
    joueurs.push({ pseudo, socket });
  }

  hote.envoyer({ type: "start" });
  for (let i = 0; i < qs.length; i++) {
    const libelleBon = (qs[i]!.options[0]!.label);
    await Promise.all(
      joueurs.map(async ({ pseudo, socket }) => {
        const q = await socket.attendre("question", (m) => m.index === i);
        const option = BONNES[i]!.includes(pseudo) ? q.options.find((o) => o.label === libelleBon)! : q.options.find((o) => o.label !== libelleBon)!;
        socket.envoyer({ type: "answer", questionId: q.questionId, optionIds: [option.id] });
      }),
    );
    await hote.attendre("answer_count", (m) => m.count === PSEUDOS.length && m.questionId.length > 0);
    hote.envoyer({ type: "reveal" });
    await hote.attendre("reveal");
    hote.envoyer({ type: "next" });
    if (i < qs.length - 1) await hote.attendre("question", (m) => m.index === i + 1);
  }
  await hote.attendre("finished").catch(async () => {
    hote.envoyer({ type: "end" });
    await hote.attendre("finished");
  });
  joueurs.forEach((j) => j.socket.fermer());
  hote.fermer();
  return { sessionId, code };
}

test.describe("bilan d'une partie réellement jouée", () => {
  test.describe.configure({ mode: "serial" });
  let serveur: ServeurLocal;
  let sessionId = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    cookies.clear();
    serveur = await lancerServeur(50);
    for (const email of [A, B]) await (await ouvrir(browser, serveur, email)).contexte.close();
    const { contexte, page } = await ouvrir(browser, serveur, A);
    ({ sessionId } = await jouerPartie(serveur, page.request));
    await contexte.close();
  });
  test.afterAll(() => arreterTout());

  test("podium, classement, À revoir trié, image limitée au top 5 sans donnée À revoir", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, contexte } = await ouvrir(browser, serveur, A);
    const dessins: string[] = [];
    await page.exposeFunction("__noterTexte", (t: string) => dessins.push(t));
    await page.addInitScript(() => {
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (texte: string, ...reste: [number, number]) {
        (window as unknown as { __noterTexte(t: string): void }).__noterTexte(texte);
        return original.call(this, texte, ...reste);
      };
    });
    await page.goto(`${serveur.url}/partie/${sessionId}/bilan`);
    await hydrate(page);
    await expect(page.getByRole("heading", { level: 1, name: "Les héros de la foi QA" })).toBeVisible();
    await expect(page.getByText("7 joueurs")).toBeVisible();
    await expect(page.getByText("Ce bilan sera supprimé automatiquement 90 jours après la partie.")).toBeVisible();

    // Les pseudos hostiles sont rendus comme du texte, jamais interprétés.
    await expect(page.getByText('=HYPERLINK("a";"b")').first()).toBeVisible();
    expect(await page.locator("body a[href^='javascript'], body img[onerror]").count()).toBe(0);

    const cartes = page.locator("article");
    await expect(cartes).toHaveCount(2);
    await expect(cartes.nth(0)).toContainText("Combien de jours a duré la création ?");
    await expect(cartes.nth(0)).toContainText("14");
    await expect(cartes.nth(0)).toContainText("Six jours");
    await expect(cartes.nth(0)).toContainText("Genèse 1");
    await expect(cartes.nth(1)).toContainText("Qui a construit l'arche ?");
    await expect(cartes.nth(1)).toContainText("57");
    await expect(cartes.nth(1)).toContainText("Noé");
    await expect(page.getByText("Question facile")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Partager" })).toBeEnabled({ timeout: 60_000 });
    // Image : 5 lignes au plus, et rien de la section « À revoir ensemble ».
    const texte = dessins.join("\n");
    for (const interdit of ["Combien de jours", "Six jours", "Genèse", "Qui a construit", "arche", "À revoir", "14 %", "57 %", "Moyenne"]) {
      expect(texte, `l'image ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
    const ranks = dessins.filter((t) => /^[1-9]$/.test(t));
    expect(ranks.length).toBeLessThanOrEqual(5);
    const pseudosDessines = PSEUDOS.filter((p) => dessins.includes(p));
    expect(pseudosDessines.length).toBeLessThanOrEqual(5);
    expect(pseudosDessines.length).toBeGreaterThanOrEqual(3);

    if (process.env.CAPTURES_DIR) {
      await page.screenshot({ path: `${process.env.CAPTURES_DIR}/qa-partie-reelle-${test.info().project.name}.png`, fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await contexte.close();
  });

  test("export CSV : BOM, point-virgule, accents, pseudos hostiles neutralisés et cités", async ({ browser }) => {
    const { page, contexte } = await ouvrir(browser, serveur, A);
    const r = await page.request.get(`${serveur.url}/partie/${sessionId}/export.csv`);
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("no-store");
    expect(r.headers()["content-disposition"]).toMatch(/^attachment; filename="bilan-les-heros-de-la-foi-qa-\d{4}-\d\d-\d\d\.csv"$/);
    const octets = await r.body();
    expect([...octets.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texte = octets.toString("utf8").slice(1);
    const lignes = texte.split("\r\n");
    expect(lignes[0]).toBe("Rang;Pseudo;Score;Questions;Temps total (s)");
    expect(lignes.at(-1)).toBe("");
    const corps = lignes.slice(1, -1);
    expect(corps).toHaveLength(7);
    // Aucune cellule de pseudo ne commence par un déclencheur de formule.
    expect(texte).toContain('\'=HYPERLINK(""a"";""b"")');
    expect(texte).toContain("'+1;");
    expect(texte).toContain("'@x;");
    expect(texte).toContain("'-2+3;");
    expect(texte).toContain('"a;b""c"');
    expect(texte).toContain("Grâce");
    const rangs = corps.map((l) => Number(l.split(";")[0]));
    expect(rangs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(corps[0]).toMatch(/^1;Grâce;3;3;\d+,\d$/);
    await contexte.close();
  });

  test("non propriétaire, anonyme et partie inconnue : refus identiques, no-store", async ({ browser }) => {
    const b = await ouvrir(browser, serveur, B);
    const vus: string[] = [];
    for (const id of [sessionId, "inconnue", "x".repeat(300)]) {
      const p = await b.page.goto(`${serveur.url}/partie/${id}/bilan`);
      const e = await b.page.request.get(`${serveur.url}/partie/${id}/export.csv`);
      expect(p?.status()).toBe(404);
      expect(e.status()).toBe(404);
      expect(p?.headers()["cache-control"]).toContain("no-store");
      expect(e.headers()["cache-control"]).toContain("no-store");
      expect(e.headers()["content-disposition"]).toBeUndefined();
      const corpsPage = await p!.text();
      expect(corpsPage).not.toContain("Les héros de la foi QA");
      expect(corpsPage).not.toContain("Grâce");
      expect(await e.text()).toBe("Bilan introuvable.");
      vus.push(`${e.status()}|${e.headers()["content-type"]}|${e.headers()["cache-control"]}`);
    }
    expect(new Set(vus).size).toBe(1);
    await b.contexte.close();

    // Anonyme : redirection vers la connexion, sans fuite, pour la page comme pour l'export.
    const anonyme = await browser.newContext();
    for (const chemin of [`/partie/${sessionId}/bilan`, `/partie/${sessionId}/export.csv`, `/partie/inconnue/export.csv`]) {
      const r = await anonyme.request.get(`${serveur.url}${chemin}`, { maxRedirects: 0 });
      expect(r.status()).toBe(302);
      expect(r.headers()["location"]).toMatch(/^\/connexion\?retour=/);
      expect(r.headers()["cache-control"]).toContain("no-store");
      expect(await r.text()).not.toContain("Grâce");
    }
    await anonyme.close();
  });
});
