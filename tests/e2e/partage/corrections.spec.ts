import { expect, test, type Page } from "@playwright/test";

import { URL_DEV } from "../serveurs";

const MODULE = "/src/client/partage/index.ts";
const top = (n: number) => Array.from({ length: n }, (_, i) => ({ pseudo: `Joueur${i + 1}`, score: Math.max(0, 10 - i), rank: i + 1 }));
const base = { quizTitle: "Les héros de la foi", pseudo: "Grâce_22", score: 7, total: 10, rank: 3, playerCount: 24, top: top(5) };

async function ouvrir(page: Page) {
  test.setTimeout(120_000);
  await page.goto(`${URL_DEV}/dev/partage`, { waitUntil: "networkidle" });
}

test("sans feuille de style, le rendu lève l'erreur des jetons en moins de 5 s", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(() => {
    for (const s of [...document.styleSheets]) s.disabled = true;
    for (const l of document.querySelectorAll("style, link[rel=stylesheet]")) l.remove();
  });
  const r = await page.evaluate(
    async ({ module, donnees }) => {
      const m = await import(/* @vite-ignore */ module);
      const debut = performance.now();
      try {
        await m.renderResultImage(donnees, "portrait");
        return { erreur: null, duree: performance.now() - debut };
      } catch (e) {
        return { erreur: String(e), duree: performance.now() - debut };
      }
    },
    { module: MODULE, donnees: base },
  );
  expect(r.erreur).toContain("Jetons de l'affiche introuvables");
  expect(r.duree).toBeLessThan(5_000);
});

test("polices qui ne répondent jamais : le rendu aboutit avec les polices de secours", async ({ page }) => {
  await ouvrir(page);
  const r = await page.evaluate(
    async ({ module, donnees }) => {
      const m = await import(/* @vite-ignore */ module);
      const original = document.fonts.load;
      document.fonts.load = () => new Promise(() => {});
      const debut = performance.now();
      try {
        const blob: Blob = await m.renderLeaderboardImage(donnees, "paysage");
        return { taille: blob.size, duree: performance.now() - debut };
      } finally {
        document.fonts.load = original;
      }
    },
    { module: MODULE, donnees: { quizTitle: base.quizTitle, total: 10, playerCount: 24, top: top(5) } },
  );
  expect(r.taille).toBeGreaterThan(5_000);
  expect(r.duree).toBeGreaterThanOrEqual(4_500);
  expect(r.duree).toBeLessThan(15_000);
});

// Rend une image en relevant les canvas créés et chaque texte dessiné (texte, police, couleur de trait).
async function rendreAvecTraces(page: Page, genre: "resultat" | "classement", format: string, donnees: unknown) {
  return page.evaluate(
    async ({ module, genre, format, donnees }) => {
      const canvases: HTMLCanvasElement[] = [];
      const creer = document.createElement.bind(document);
      document.createElement = ((nom: string, o?: ElementCreationOptions) => {
        const e = creer(nom, o);
        if (nom === "canvas") canvases.push(e as HTMLCanvasElement);
        return e;
      }) as typeof document.createElement;
      const proto = CanvasRenderingContext2D.prototype;
      const fillText = proto.fillText;
      const stroke = proto.stroke;
      const textes: Array<{ texte: string; font: string }> = [];
      const traits: string[] = [];
      proto.fillText = function (this: CanvasRenderingContext2D, texte: string, x: number, y: number, max?: number) {
        textes.push({ texte, font: this.font });
        return fillText.call(this, texte, x, y, max);
      };
      proto.stroke = function (this: CanvasRenderingContext2D, ...a: [Path2D?]) {
        if (this.getLineDash().length > 0) traits.push(String(this.strokeStyle));
        return (stroke as (...x: unknown[]) => void).apply(this, a);
      };
      try {
        const m = await import(/* @vite-ignore */ module);
        await (genre === "resultat" ? m.renderResultImage(donnees, format) : m.renderLeaderboardImage(donnees, format));
      } finally {
        document.createElement = creer;
        proto.fillText = fillText;
        proto.stroke = stroke;
      }
      const sonde = creer("div");
      sonde.className = "bg-separateur";
      document.body.appendChild(sonde);
      const separateur = getComputedStyle(sonde).backgroundColor;
      sonde.remove();
      return { textes, traits, separateur, tailles: canvases.map((c) => [c.width, c.height]) };
    },
    { module: MODULE, genre, format, donnees },
  );
}

test("le canvas de rendu est libéré après toBlob", async ({ page }) => {
  await ouvrir(page);
  const r = await rendreAvecTraces(page, "resultat", "portrait", base);
  expect(r.tailles.length).toBeGreaterThan(0);
  for (const t of r.tailles) expect(t).toEqual([0, 0]);
});

test("le canvas est libéré même quand le dessin lève avant l'encodage", async ({ page }) => {
  await ouvrir(page);
  const r = await page.evaluate(
    async ({ module, donnees }) => {
      const m = await import(/* @vite-ignore */ module);
      const canvases: HTMLCanvasElement[] = [];
      const creer = document.createElement.bind(document);
      document.createElement = ((nom: string, o?: ElementCreationOptions) => {
        const e = creer(nom, o);
        if (nom === "canvas") canvases.push(e as HTMLCanvasElement);
        return e;
      }) as typeof document.createElement;
      const proto = CanvasRenderingContext2D.prototype;
      const fillText = proto.fillText;
      let tailleAuMomentDeLErreur: number[] = [];
      proto.fillText = function (this: CanvasRenderingContext2D) {
        tailleAuMomentDeLErreur = [this.canvas.width, this.canvas.height];
        throw new Error("dessin interrompu");
      };
      let erreur: string | null = null;
      try {
        await m.renderResultImage(donnees, "portrait");
      } catch (e) {
        erreur = String(e);
      } finally {
        document.createElement = creer;
        proto.fillText = fillText;
      }
      return { erreur, tailleAuMomentDeLErreur, tailles: canvases.map((c) => [c.width, c.height]) };
    },
    { module: MODULE, donnees: base },
  );
  expect(r.erreur).toContain("dessin interrompu");
  expect(r.tailleAuMomentDeLErreur).toEqual([1080, 1350]);
  expect(r.tailles).toEqual([[0, 0]]);
});

test("titre et pseudos sans caractère de contrôle ni de forçage de direction", async ({ page }) => {
  await ouvrir(page);
  const piege = "Quiz‮dlrow‬\u0007 de\nla⁦ foi⁩";
  const r = await rendreAvecTraces(page, "resultat", "portrait", {
    ...base,
    quizTitle: piege,
    pseudo: "Grâce‮_22",
    top: [{ pseudo: "Grâce‮_22", score: 7, rank: 1 }, ...top(4)],
  });
  const interdits = /[\p{Cc}‪-‮⁦-⁩]/u;
  expect(r.textes.filter((t) => interdits.test(t.texte)).map((t) => t.texte)).toEqual([]);
  expect(r.textes.map((t) => t.texte)).toContain("Quizdlrow de la foi");
});

test("les filets du classement utilisent le jeton --color-separateur", async ({ page }) => {
  await ouvrir(page);
  const r = await rendreAvecTraces(page, "classement", "portrait", { quizTitle: "t", total: 10, playerCount: 24, top: top(5) });
  expect(r.traits.length).toBeGreaterThan(0);
  const attendu = await page.evaluate((c) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.strokeStyle = c;
    return String(ctx.strokeStyle);
  }, r.separateur);
  for (const t of r.traits) expect(t).toBe(attendu);
});

test("portrait : les lignes du classement mesurent au moins 32 px sur 1080", async ({ page }) => {
  await ouvrir(page);
  const r = await rendreAvecTraces(page, "resultat", "portrait", base);
  const ligne = r.textes.find((t) => t.texte === "Joueur1")!;
  const corps = Number(/([\d.]+)px/.exec(ligne.font)![1]);
  // Le canvas est mis à l'échelle 1080 / 390 : le corps relevé est en unités de conception.
  expect(corps * (1080 / 390)).toBeGreaterThanOrEqual(32);
});
