import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SOUS_PROTOCOLE, PORT_JEU, URL_JEU, demarrerServeur, lancerPartie, rejoindre, type QuestionLocale, type ServeurLocal } from "./serveur-local";

// QA indépendante de QZ-002-11, contre le vrai Worker : animateur simulé, mode libre, correction masquée, jeton,
// reconnexion, bfcache et accessibilité mobile.
const unique = (prompt: string, duree: 10 | 20 = 20): QuestionLocale => ({
  kind: "single",
  prompt,
  durationSec: duree,
  explanation: "Parce que c'est écrit.",
  options: [
    { label: "Alpha", isCorrect: true },
    { label: "Bravo", isCorrect: false },
    { label: "Charlie", isCorrect: false },
  ],
});
const multiple = (prompt: string): QuestionLocale => ({
  kind: "multiple",
  prompt,
  durationSec: 20,
  options: [
    { label: "Un", isCorrect: true },
    { label: "Deux", isCorrect: false },
    { label: "Trois", isCorrect: true },
  ],
});

class Hote {
  private readonly socket: WebSocket;
  private readonly ouverte: Promise<void>;
  constructor(code: string, token: string) {
    this.socket = new WebSocket(`ws://localhost:${PORT_JEU}/ws/${code}`, [SOUS_PROTOCOLE, token]);
    this.ouverte = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve());
      this.socket.addEventListener("error", () => reject(new Error("hôte non connecté")));
    });
  }
  async envoyer(message: Record<string, unknown>) {
    await this.ouverte;
    this.socket.send(JSON.stringify(message));
  }
  fermer() {
    this.socket.close();
  }
}

let serveur: ServeurLocal;
test.beforeAll(async () => {
  test.setTimeout(150_000);
  serveur = await demarrerServeur();
});
test.afterAll(async () => {
  await serveur?.arreter();
});
test.beforeEach(({ browserName }, info) => {
  void browserName;
  test.skip(info.project.name !== "mobile", "écran de jeu conçu pour 390 px");
});

const cle = (code: string) => `quizdeszeles:jeton:${code}`;

async function ouvrirJoueur(browser: Browser, code: string, pseudo: string, options: { reducedMotion?: "reduce" } = {}) {
  const contexte = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...options });
  const page = await contexte.newPage();
  const jeton = await rejoindre(code, pseudo);
  // Posé une seule fois : sinon le script rejouerait la clé après sa suppression par l'application.
  await page.addInitScript(
    ([k, v]) => {
      if (sessionStorage.getItem("amorce")) return;
      sessionStorage.setItem("amorce", "1");
      localStorage.setItem(k!, v!);
    },
    [cle(code), JSON.stringify(jeton)],
  );
  await page.goto(`${URL_JEU}/j/${code}/jouer`);
  return { page, contexte, ...jeton };
}

function espionner(page: Page) {
  const envoyes: { type: string; [k: string]: unknown }[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      try {
        const m = JSON.parse(String(f.payload));
        if (m && typeof m.type === "string") envoyes.push(m);
      } catch {
        // trame de service (ping)
      }
    }),
  );
  return envoyes;
}

async function sansViolation(page: Page) {
  const resultat = await new AxeBuilder({ page }).analyze();
  expect(resultat.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

// 44 px minimum sur chaque cible interactive visible, aucun débordement horizontal à 390 px.
async function mobileOk(page: Page) {
  const probleme = await page.evaluate(() => {
    const trop: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], [role=button], input")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (r.height < 44 || r.width < 44) trop.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return { trop, debord: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(probleme.trop).toEqual([]);
  expect(probleme.debord).toBeLessThanOrEqual(0);
}

async function pret(page: Page) {
  await expect(page.getByText("EN ATTENTE")).toBeVisible();
}

test("ensemble : attente, question, juste, pas cette fois, question suivante, fin avec rang, score et PNG", async ({ browser }) => {
  test.setTimeout(120_000);
  const partie = await lancerPartie({ questions: [unique("Première ?"), unique("Deuxième ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const a = await ouvrirJoueur(browser, partie.code, "Aline");
  const b = await ouvrirJoueur(browser, partie.code, "Basile");
  await pret(a.page);
  await pret(b.page);
  await mobileOk(a.page);
  await hote.envoyer({ type: "start" });
  await expect(a.page.getByRole("heading", { name: "Première ?" })).toBeVisible();
  await mobileOk(a.page);
  await sansViolation(a.page);
  await a.page.getByRole("button", { name: /Alpha/ }).click();
  await b.page.getByRole("button", { name: /Bravo/ }).click();
  await expect(a.page.getByText("Réponse enregistrée")).toBeVisible();
  await hote.envoyer({ type: "reveal" });
  await expect(a.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await expect(b.page.getByRole("heading", { name: /PAS CETTE\s*FOIS/ })).toBeVisible();
  await mobileOk(a.page);
  await sansViolation(b.page);
  await hote.envoyer({ type: "next" });
  await expect(a.page.getByRole("heading", { name: "Deuxième ?" })).toBeVisible();
  // Aucune trace de la correction précédente sur la nouvelle question.
  await expect(a.page.getByRole("heading", { name: "JUSTE !" })).toHaveCount(0);
  await a.page.getByRole("button", { name: /Alpha/ }).click();
  await b.page.getByRole("button", { name: /Alpha/ }).click();
  await hote.envoyer({ type: "reveal" });
  await expect(a.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await hote.envoyer({ type: "end" });
  await expect(a.page.getByText(/Rang : 1 \/ 2/)).toBeVisible();
  await expect(b.page.getByText(/Rang : 2 \/ 2/)).toBeVisible();
  await expect(a.page.getByText(/2/).first()).toBeVisible();
  const partager = a.page.getByRole("button", { name: "Partager mon score" });
  await expect(partager).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
  await mobileOk(a.page);
  await sansViolation(a.page);
  await a.page.evaluate(() => {
    (navigator as unknown as { canShare: () => boolean }).canShare = () => true;
    (window as unknown as { __partage: unknown }).__partage = null;
    navigator.share = async (data) => {
      (window as unknown as { __partage: unknown }).__partage = { type: data?.files?.[0]?.type, taille: data?.files?.[0]?.size };
    };
  });
  await partager.click();
  await expect.poll(() => a.page.evaluate(() => (window as unknown as { __partage: { type: string; taille: number } | null }).__partage)).toMatchObject({ type: "image/png" });
  const infos = await a.page.evaluate(() => (window as unknown as { __partage: { taille: number } }).__partage);
  expect(infos.taille).toBeGreaterThan(1000);
  hote.fermer();
  await a.contexte.close();
  await b.contexte.close();
});

test("libre : le joueur avance seul, « Question suivante » puis « Voir mon résultat »", async ({ browser }) => {
  test.setTimeout(90_000);
  const partie = await lancerPartie({ mode: "own_pace", questions: [unique("Libre un ?"), unique("Libre deux ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Solo");
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  await expect(j.page.getByRole("heading", { name: "Libre un ?" })).toBeVisible();
  await j.page.getByRole("button", { name: /Alpha/ }).click();
  // L'animateur ne pilote pas : la correction arrive seule, avec le bouton de suite.
  await expect(j.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await mobileOk(j.page);
  await sansViolation(j.page);
  await j.page.getByRole("button", { name: "Question suivante" }).click();
  await expect(j.page.getByRole("heading", { name: "Libre deux ?" })).toBeVisible();
  await j.page.getByRole("button", { name: /Bravo/ }).click();
  await expect(j.page.getByRole("heading", { name: /PAS CETTE\s*FOIS/ })).toBeVisible();
  await expect(j.page.getByRole("button", { name: "Question suivante" })).toHaveCount(0);
  await j.page.getByRole("button", { name: "Voir mon résultat" }).click();
  await expect(j.page.getByText(/Rang : 1 \/ 1/)).toBeVisible();
  hote.fermer();
  await j.contexte.close();
});

test("correction masquée : aucun indice de justesse ni score dans le DOM avant la fin", async ({ browser }) => {
  test.setTimeout(90_000);
  const partie = await lancerPartie({ showCorrectAnswer: false, questions: [unique("Masquée ?"), unique("Masquée deux ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Mask");
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  const indices = () =>
    j.page.evaluate(() => {
      const trouves: string[] = [];
      const texte = document.body.innerText;
      if (/juste|pas cette fois|faux|bonne réponse|explication|\d+ point|score/i.test(texte.replace(/La correction arrive à la fin de la partie/g, ""))) trouves.push(`texte: ${texte}`);
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        const classes = typeof el.className === "string" ? el.className : "";
        if (/vert-eclat|vert-nuit|border-dashed/.test(classes)) trouves.push(`classe: ${el.tagName}.${classes}`);
        for (const attr of el.getAttributeNames()) {
          if (attr.startsWith("aria-") && /juste|correct|faux|bonne|score/i.test(el.getAttribute(attr) ?? "")) trouves.push(`${attr}=${el.getAttribute(attr)}`);
        }
      }
      return trouves;
    });
  await expect(j.page.getByRole("heading", { name: "Masquée ?" })).toBeVisible();
  await j.page.getByRole("button", { name: /Alpha/ }).click();
  await expect(j.page.getByText("Réponse enregistrée")).toBeVisible();
  expect(await indices()).toEqual([]);
  await hote.envoyer({ type: "reveal" });
  await expect(j.page.getByText("La correction arrive à la fin de la partie")).toBeVisible();
  expect(await indices()).toEqual([]);
  await mobileOk(j.page);
  await sansViolation(j.page);
  await hote.envoyer({ type: "next" });
  await expect(j.page.getByRole("heading", { name: "Masquée deux ?" })).toBeVisible();
  expect(await indices()).toEqual([]);
  await j.page.getByRole("button", { name: /Bravo/ }).click();
  await hote.envoyer({ type: "reveal" });
  await expect(j.page.getByText("La correction arrive à la fin de la partie")).toBeVisible();
  expect(await indices()).toEqual([]);
  await hote.envoyer({ type: "end" });
  await expect(j.page.getByText(/Rang : 1 \/ 1/)).toBeVisible();
  hote.fermer();
  await j.contexte.close();
});

test("choix multiple : rien n'est envoyé sans « Valider la sélection », qui exige une sélection", async ({ browser }) => {
  test.setTimeout(60_000);
  const partie = await lancerPartie({ questions: [multiple("Plusieurs ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Multi");
  const envoyes = espionner(j.page);
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  await expect(j.page.getByRole("heading", { name: "Plusieurs ?" })).toBeVisible();
  const valider = j.page.getByRole("button", { name: "Valider la sélection" });
  await expect(valider).toBeDisabled();
  await j.page.getByRole("button", { name: /Un/ }).click();
  await j.page.getByRole("button", { name: /Trois/ }).click();
  await j.page.getByRole("button", { name: /Deux/ }).click();
  await j.page.getByRole("button", { name: /Deux/ }).click();
  await j.page.waitForTimeout(500);
  expect(envoyes.filter((m) => m.type === "answer")).toHaveLength(0);
  await expect(j.page.getByText("Réponse enregistrée")).toHaveCount(0);
  await mobileOk(j.page);
  await valider.click();
  await expect(j.page.getByText("Réponse enregistrée")).toBeVisible();
  expect(envoyes.filter((m) => m.type === "answer")).toHaveLength(1);
  await hote.envoyer({ type: "reveal" });
  await expect(j.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  hote.fermer();
  await j.contexte.close();
});

test("chrono à zéro : « Temps écoulé », tuiles inactives, aucun envoi, la correction n'arrive que sur ordre", async ({ browser }) => {
  test.setTimeout(90_000);
  const partie = await lancerPartie({ questions: [unique("Chrono ?", 10)] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Lent");
  const envoyes = espionner(j.page);
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  await expect(j.page.getByRole("timer")).toBeVisible();
  await expect(j.page.getByRole("heading", { name: "JUSTE !" })).toHaveCount(0);
  await expect(j.page.getByRole("timer")).toHaveAttribute("aria-label", "Temps écoulé", { timeout: 30_000 });
  await expect(j.page.getByText("Temps écoulé, on attend la suite.")).toBeVisible();
  // La tuile reste lisible mais n'est plus un bouton : plus rien à toucher.
  await expect(j.page.getByRole("button", { name: /Alpha/ })).toHaveCount(0);
  await expect(j.page.getByText("Alpha")).toBeVisible();
  // Aucun verdict avant l'ordre de l'animateur, et aucune réponse envoyée à notre insu.
  await j.page.waitForTimeout(1500);
  await expect(j.page.getByRole("heading", { name: /JUSTE|PAS CETTE/ })).toHaveCount(0);
  expect(envoyes.filter((m) => m.type === "answer")).toHaveLength(0);
  await hote.envoyer({ type: "reveal" });
  await expect(j.page.getByRole("heading", { name: /PAS CETTE\s*FOIS/ })).toBeVisible();
  await expect(j.page.getByText("Tu n'as pas répondu à temps")).toBeVisible();
  hote.fermer();
  await j.contexte.close();
});

test("un double toucher n'envoie qu'une seule réponse", async ({ browser }) => {
  test.setTimeout(60_000);
  const partie = await lancerPartie({ questions: [unique("Double ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Rapide");
  const envoyes = espionner(j.page);
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  const tuile = j.page.getByRole("button", { name: /Alpha/ });
  await expect(tuile).toBeVisible();
  await tuile.dblclick({ noWaitAfter: true }).catch(() => undefined);
  await expect(j.page.getByText("Réponse enregistrée")).toBeVisible();
  await j.page.waitForTimeout(800);
  expect(envoyes.filter((m) => m.type === "answer")).toHaveLength(1);
  hote.fermer();
  await j.contexte.close();
});

test.describe("jeton", () => {
  async function ouvrirAvecCharge(browser: Browser, code: string, valeur: string) {
    const contexte = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await contexte.newPage();
    await page.goto(`${URL_JEU}/j/${code}`);
    await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [cle(code), valeur]);
    const avant = await page.evaluate(() => history.length);
    await page.goto(`${URL_JEU}/j/${code}/jouer`);
    return { contexte, page, avant };
  }
  const charge = (e: number) => Buffer.from(JSON.stringify({ c: "ABC234", s: "x", r: "player", p: "p", e })).toString("base64url");

  test("jeton expiré (e passé) : clé supprimée, redirection unique sans boucle", async ({ browser }) => {
    test.setTimeout(60_000);
    const partie = await lancerPartie({ questions: [unique("Jeton ?")] });
    const { contexte, page, avant } = await ouvrirAvecCharge(browser, partie.code, JSON.stringify({ playerId: "p", token: `${charge(Date.now() - 60_000)}.signature` }));
    await page.waitForURL(`${URL_JEU}/j/${partie.code}`, { timeout: 30_000 });
    expect(await page.evaluate((k) => localStorage.getItem(k), cle(partie.code))).toBeNull();
    // replace : une seule entrée ajoutée (la page /jouer a été remplacée), et retour arrière sans retour sur /jouer.
    expect(await page.evaluate(() => history.length)).toBe(avant + 1);
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(`${URL_JEU}/j/${partie.code}`);
    await page.goBack();
    expect(page.url()).not.toContain("/jouer");
    await contexte.close();
  });

  test("jeton falsifié : clé supprimée et retour à /j/<CODE>, sans boucle", async ({ browser }) => {
    test.setTimeout(90_000);
    const partie = await lancerPartie({ questions: [unique("Jeton ?")] });
    const { contexte, page, avant } = await ouvrirAvecCharge(browser, partie.code, JSON.stringify({ playerId: "p", token: `${charge(Date.now() + 3_600_000)}.falsifie` }));
    await page.waitForURL(`${URL_JEU}/j/${partie.code}`, { timeout: 45_000 });
    expect(await page.evaluate((k) => localStorage.getItem(k), cle(partie.code))).toBeNull();
    expect(await page.evaluate(() => history.length)).toBe(avant + 1);
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(`${URL_JEU}/j/${partie.code}`);
    await contexte.close();
  });

  test("valeur illisible dans la clé : traitée comme absente", async ({ browser }) => {
    const partie = await lancerPartie({ questions: [unique("Jeton ?")] });
    const { contexte, page } = await ouvrirAvecCharge(browser, partie.code, "{pas du json");
    await page.waitForURL(`${URL_JEU}/j/${partie.code}`, { timeout: 30_000 });
    expect(await page.evaluate((k) => localStorage.getItem(k), cle(partie.code))).toBeNull();
    await contexte.close();
  });

  test("joueur exclu par l'hôte : écran terminal et clé supprimée", async ({ browser }) => {
    test.setTimeout(60_000);
    const partie = await lancerPartie({ questions: [unique("Exclu ?")] });
    const hote = new Hote(partie.code, partie.hostToken);
    const j = await ouvrirJoueur(browser, partie.code, "Indésirable");
    await pret(j.page);
    await hote.envoyer({ type: "kick", playerId: j.playerId });
    await expect(j.page.getByRole("heading", { name: "Tu as été retiré de la partie" })).toBeVisible();
    expect(await j.page.evaluate((k) => localStorage.getItem(k), cle(partie.code))).toBeNull();
    await mobileOk(j.page);
    await sansViolation(j.page);
    // Pas de redirection : l'écran terminal reste, et un rechargement ne reconnecte pas le joueur.
    expect(j.page.url()).toContain("/jouer");
    hote.fermer();
    await j.contexte.close();
  });

  test("partie terminée avant l'ouverture de la page : écran terminal", async ({ browser }) => {
    test.setTimeout(60_000);
    const partie = await lancerPartie({ questions: [unique("Fin ?")] });
    const hote = new Hote(partie.code, partie.hostToken);
    const jeton = await rejoindre(partie.code, "Retard");
    await hote.envoyer({ type: "end" });
    await new Promise((r) => setTimeout(r, 1500));
    const contexte = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await contexte.newPage();
    await page.addInitScript(([k, v]) => {
      if (sessionStorage.getItem("amorce")) return;
      sessionStorage.setItem("amorce", "1");
      localStorage.setItem(k!, v!);
    }, [cle(partie.code), JSON.stringify(jeton)]);
    await page.goto(`${URL_JEU}/j/${partie.code}/jouer`);
    await expect(page.getByRole("heading", { name: /Partie terminée|Lien invalide/ })).toBeVisible({ timeout: 30_000 });
    await sansViolation(page);
    hote.fermer();
    await contexte.close();
  });
});

async function coupure(contexte: BrowserContext, page: Page, actif: boolean) {
  await contexte.setOffline(actif);
  if (actif) {
    // Chromium ne ferme pas toujours une socket déjà ouverte en mode hors ligne : on la ferme comme le ferait un réseau mobile.
    await page.evaluate(() => {
      for (const ws of (window as unknown as { __sockets?: WebSocket[] }).__sockets ?? []) ws.close(4999);
    });
  }
}

test("reconnexion : bandeau « Connexion… » puis retour sur la même question, réponse conservée", async ({ browser }) => {
  test.setTimeout(120_000);
  const partie = await lancerPartie({ questions: [unique("Reprise ?"), unique("Reprise deux ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Fragile");
  await j.page.addInitScript(() => {
    const Origine = window.WebSocket;
    const liste: WebSocket[] = [];
    (window as unknown as { __sockets: WebSocket[] }).__sockets = liste;
    window.WebSocket = class extends Origine {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        liste.push(this);
      }
    } as typeof WebSocket;
  });
  await j.page.reload();
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  await expect(j.page.getByRole("heading", { name: "Reprise ?" })).toBeVisible();
  await j.page.getByRole("button", { name: /Alpha/ }).click();
  await expect(j.page.getByText("Réponse enregistrée")).toBeVisible();

  await coupure(j.contexte, j.page, true);
  await expect(j.page.getByText(/Connexion/).first()).toBeVisible({ timeout: 30_000 });
  await mobileOk(j.page);
  await sansViolation(j.page);
  await coupure(j.contexte, j.page, false);
  await expect(j.page.getByText(/Connexion/)).toHaveCount(0, { timeout: 60_000 });
  // Même question, réponse conservée : pas de nouveau choix possible.
  await expect(j.page.getByText("Réponse enregistrée")).toBeVisible();
  await expect(j.page.getByRole("button", { name: /Bravo/ })).toHaveCount(0);
  await hote.envoyer({ type: "reveal" });
  await expect(j.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  hote.fermer();
  await j.contexte.close();
});

test("bfcache : restauration de la page, aucun bouton bloqué", async ({ browser }) => {
  test.setTimeout(90_000);
  const partie = await lancerPartie({ questions: [unique("Retour ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Navigateur");
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  await expect(j.page.getByRole("heading", { name: "Retour ?" })).toBeVisible();
  // Aller ailleurs puis revenir en arrière : si le cache de navigation s'applique, pageshow arrive avec persisted.
  await j.page.goto(`${URL_JEU}/`);
  await j.page.goBack();
  await expect(j.page.getByRole("heading", { name: "Retour ?" })).toBeVisible({ timeout: 30_000 });
  // Restauration simulée de façon déterministe (Chromium headless ne met pas toujours la page en cache).
  await j.page.evaluate(() => window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })));
  await expect(j.page.getByRole("heading", { name: "Retour ?" })).toBeVisible({ timeout: 30_000 });
  await expect(j.page.getByRole("button", { name: /Alpha/ })).toBeEnabled();
  await expect(j.page.locator("[aria-busy=true]")).toHaveCount(0);
  await j.page.getByRole("button", { name: /Alpha/ }).click();
  await expect(j.page.getByText("Réponse enregistrée")).toBeVisible();
  hote.fermer();
  await j.contexte.close();
});

test("reduced-motion : aucune animation en boucle sur l'attente ni la correction", async ({ browser }) => {
  test.setTimeout(90_000);
  const partie = await lancerPartie({ questions: [unique("Calme ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Calme", { reducedMotion: "reduce" });
  await pret(j.page);
  const enBoucle = () =>
    j.page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && (a.effect?.getComputedTiming().iterations ?? 1) === Infinity)
        .map((a) => (a.effect as KeyframeEffect | null)?.target?.className ?? "?"),
    );
  expect(await enBoucle()).toEqual([]);
  await hote.envoyer({ type: "start" });
  await j.page.getByRole("button", { name: /Alpha/ }).click();
  await hote.envoyer({ type: "reveal" });
  await expect(j.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await j.page.waitForTimeout(1500);
  expect(await enBoucle()).toEqual([]);
  hote.fermer();
  await j.contexte.close();
});
