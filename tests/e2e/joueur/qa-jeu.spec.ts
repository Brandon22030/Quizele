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

test("chrono à zéro : aucun envoi, la correction ne vient que du serveur (ordre ou échéance + 2 s)", async ({ browser }) => {
  test.setTimeout(90_000);
  const partie = await lancerPartie({ questions: [unique("Chrono ?", 10)] });
  const hote = new Hote(partie.code, partie.hostToken);
  const j = await ouvrirJoueur(browser, partie.code, "Lent");
  const envoyes = espionner(j.page);
  // Tout est horodaté dans la page, sur la même horloge (performance.now) : le chrono à zéro, le verdict rendu, et l'arrivée de
  // la trame « reveal » (écouteur posé à la construction de la socket, donc exécuté avant celui de l'application).
  const trames: number[] = [];
  j.page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      try {
        if (JSON.parse(String(f.payload)).type === "reveal") trames.push(trames.length);
      } catch {
        // trame de service (pong)
      }
    }),
  );
  await j.page.addInitScript(() => {
    interface Horodatage {
      zero: number | null;
      verdict: number | null;
      reveal: { at: number; verdictDejaLa: boolean } | null;
    }
    const t: Horodatage = { zero: null, verdict: null, reveal: null };
    (window as unknown as { __t: Horodatage }).__t = t;
    const verdictPresent = () => [...document.querySelectorAll("h1, h2, h3, h4, [role=heading]")].some((h) => /JUSTE|PAS CETTE/.test(h.textContent ?? ""));
    const lire = () => {
      if (t.zero === null && document.querySelector('[role="timer"][aria-label="Temps écoulé"]')) t.zero = performance.now();
      if (t.verdict === null && verdictPresent()) t.verdict = performance.now();
    };
    new MutationObserver(lire).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const Origine = window.WebSocket;
    window.WebSocket = class extends Origine {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        this.addEventListener("message", (e) => {
          try {
            if (JSON.parse(String(e.data)).type === "reveal" && t.reveal === null) t.reveal = { at: performance.now(), verdictDejaLa: verdictPresent() };
          } catch {
            // trame de service (pong)
          }
        });
      }
    } as typeof WebSocket;
  });
  await j.page.reload();
  await pret(j.page);
  await hote.envoyer({ type: "start" });
  await expect(j.page.getByRole("timer")).toBeVisible();
  await expect(j.page.getByRole("timer")).toHaveAttribute("aria-label", "Temps écoulé", { timeout: 30_000 });
  await expect(j.page.getByText("Temps écoulé, on attend la suite.")).toBeVisible();
  // La tuile reste lisible mais n'est plus un bouton : plus rien à toucher.
  await expect(j.page.getByRole("button", { name: /Alpha/ })).toHaveCount(0);
  await expect(j.page.getByText("Alpha")).toBeVisible();

  // Aucun ordre de l'animateur : la révélation vient du serveur, à l'échéance + 2 s.
  await expect(j.page.getByRole("heading", { name: /PAS CETTE\s*FOIS/ })).toBeVisible({ timeout: 30_000 });
  await expect(j.page.getByText("Tu n'as pas répondu à temps")).toBeVisible();
  const { zero, verdict, reveal } = await j.page.evaluate(
    () => (window as unknown as { __t: { zero: number | null; verdict: number | null; reveal: { at: number; verdictDejaLa: boolean } | null } }).__t,
  );
  expect(zero, "« Temps écoulé » observé").not.toBeNull();
  expect(verdict, "verdict observé").not.toBeNull();
  expect(reveal, "trame reveal observée dans la page").not.toBeNull();
  expect(trames, "une seule trame reveal reçue").toHaveLength(1);
  // Ni verdict ni trame reveal avant le chrono à zéro ; aucun verdict dans le DOM à l'arrivée de la trame ; le verdict
  // n'est rendu qu'après elle.
  expect(reveal!.verdictDejaLa).toBe(false);
  expect(reveal!.at).toBeGreaterThanOrEqual(zero!);
  expect(verdict!).toBeGreaterThanOrEqual(reveal!.at);
  expect(envoyes.filter((m) => m.type === "answer")).toHaveLength(0);
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

test("salle d'attente en direct : pastilles des derniers arrivés et « + N autres »", async ({ browser }) => {
  test.setTimeout(90_000);
  const partie = await lancerPartie({ questions: [unique("Salle ?")] });
  const premier = await ouvrirJoueur(browser, partie.code, "Premier");
  await expect(premier.page.getByText("Tu es le premier arrivé")).toBeVisible();
  const liste = premier.page.getByRole("list", { name: "Derniers arrivés" });
  await rejoindre(partie.code, "Deuxieme");
  await expect(premier.page.getByText("Tu es le premier arrivé")).toHaveCount(0);
  await expect(liste.getByText("Deuxieme")).toBeVisible();
  const compteur = premier.page.locator("span:has(> span.sr-only)").filter({ hasText: "Joueurs dans la salle" });
  await expect(compteur).toContainText("2");
  // Au-delà de 8 joueurs la liste se résume : pastilles + « + N autres » couvrent tout le monde.
  for (let i = 3; i <= 12; i += 1) await rejoindre(partie.code, `Joueur${i}`);
  await expect(compteur).toContainText("12", { timeout: 30_000 });
  await expect(liste.getByText(/\+ \d+ autres/)).toBeVisible();
  const autres = Number(/\+ (\d+) autres/.exec(await liste.innerText())?.[1]);
  const pastilles = await liste.getByRole("listitem").count();
  expect(autres + pastilles - 1).toBe(12);
  await expect(liste.getByText("Joueur12")).toBeVisible();
  await mobileOk(premier.page);
  await sansViolation(premier.page);
  await premier.contexte.close();
});

test("annonces vocales dans l'ordre, rangs du serveur et total correct pour un joueur qui se reconnecte en fin de partie", async ({ browser }) => {
  test.setTimeout(120_000);
  const partie = await lancerPartie({ questions: [unique("Annonce un ?"), unique("Annonce deux ?")] });
  const hote = new Hote(partie.code, partie.hostToken);
  const a = await ouvrirJoueur(browser, partie.code, "Anna");
  const b = await ouvrirJoueur(browser, partie.code, "Boaz");
  await pret(a.page);
  const recus: { type: string; [k: string]: unknown }[] = [];
  a.page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      try {
        recus.push(JSON.parse(String(f.payload)));
      } catch {
        // trame de service
      }
    }),
  );
  await a.page.reload();
  await pret(a.page);
  await a.page.evaluate(() => {
    const w = window as unknown as { __annonces: string[] };
    w.__annonces = [];
    const region = document.querySelector("p[aria-live=polite]")!;
    const noter = () => {
      const t = region.textContent ?? "";
      if (t && w.__annonces.at(-1) !== t) w.__annonces.push(t);
    };
    new MutationObserver(noter).observe(region, { childList: true, characterData: true, subtree: true });
  });
  await hote.envoyer({ type: "start" });
  await a.page.getByRole("button", { name: /Alpha/ }).click();
  await b.page.getByRole("button", { name: /Bravo/ }).click();
  await hote.envoyer({ type: "reveal" });
  await expect(a.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await hote.envoyer({ type: "next" });
  await expect(a.page.getByRole("heading", { name: "Annonce deux ?" })).toBeVisible();
  await a.page.getByRole("button", { name: /Alpha/ }).click();
  await b.page.getByRole("button", { name: /Alpha/ }).click();
  await hote.envoyer({ type: "reveal" });
  await expect(a.page.getByRole("heading", { name: "JUSTE !" })).toBeVisible();
  await hote.envoyer({ type: "end" });
  await expect(a.page.getByText(/Rang : 1 \/ 2/)).toBeVisible();

  const annonces = await a.page.evaluate(() => (window as unknown as { __annonces: string[] }).__annonces);
  const ordre = ["Question 1 sur 2", "Réponse bien enregistrée", "Juste !", "Question 2 sur 2", "Réponse bien enregistrée", "Juste !", "Résultats"];
  let curseur = 0;
  for (const attendu of ordre) {
    const trouve = annonces.indexOf(attendu, curseur);
    expect(trouve, `annonce « ${attendu} » dans ${JSON.stringify(annonces)}`).toBeGreaterThanOrEqual(0);
    curseur = trouve + 1;
  }

  // Le rang affiché est celui du serveur, pas la position dans la liste.
  const fin = recus.find((m) => m.type === "finished") as { total: number; you: { rank: number }; ranking: { pseudo: string; rank: number }[] } | undefined;
  expect(fin?.total).toBe(2);
  await expect(a.page.getByText(`Rang : ${fin!.you.rank} / 2`)).toBeVisible();
  for (const ligne of fin!.ranking) expect(ligne.rank).toBeGreaterThanOrEqual(1);
  await expect(a.page.getByText(/sur 2/).first()).toBeVisible();
  await expect(a.page.getByText(/sur 0/)).toHaveCount(0);

  // Reconnexion après la fin : le total vient du serveur, pas de la dernière question vue (aucune dans ce nouvel onglet).
  const retour = await a.contexte.newPage();
  await retour.goto(`${URL_JEU}/j/${partie.code}/jouer`);
  await expect(retour.getByRole("heading", { name: /Résultat final|Partie terminée/ })).toBeAttached({ timeout: 30_000 });
  await expect(retour.getByText(/sur 0/)).toHaveCount(0);
  if (await retour.getByText(/Rang :/).count()) await expect(retour.getByText(/sur 2/).first()).toBeVisible();
  hote.fermer();
  await a.contexte.close();
  await b.contexte.close();
});
