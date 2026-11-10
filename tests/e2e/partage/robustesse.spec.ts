import { expect, test, type Page } from "@playwright/test";

import { URL_DEV, URL_PREVIEW } from "../serveurs";

// Les modules de production sont importés par leur URL Vite : on teste le code réel, pas une copie.
const MODULE = "/src/client/partage/index.ts";

const FORMATS = [
  { format: "portrait", largeur: 1080, hauteur: 1350 },
  { format: "paysage", largeur: 1200, hauteur: 630 },
] as const;

async function ouvrir(page: Page) {
  test.setTimeout(180_000);
  await page.goto(`${URL_DEV}/dev/partage`, { waitUntil: "networkidle" });
}

// Rend une image et renvoie : octets du PNG, pixels aux points clés, et le tracé de chaque texte dessiné.
async function rendre(page: Page, genre: "resultat" | "classement", format: string, donnees: unknown) {
  return page.evaluate(
    async ({ module, genre, format, donnees }) => {
      const traces: Array<{ texte: string; font: string; x: number; y: number; largeur: number; align: string }> = [];
      const proto = CanvasRenderingContext2D.prototype;
      const originaux = { fillText: proto.fillText, strokeText: proto.strokeText };
      for (const nom of ["fillText", "strokeText"] as const) {
        proto[nom] = function (this: CanvasRenderingContext2D, texte: string, x: number, y: number, ...reste: number[]) {
          const m = this.getTransform();
          const largeur = this.measureText(texte).width * m.a;
          traces.push({ texte, font: this.font, x: x * m.a + m.e, y: y * m.d + m.f, largeur, align: this.textAlign });
          return (originaux[nom] as (...a: unknown[]) => void).call(this, texte, x, y, ...reste);
        } as never;
      }
      let erreur: string | null = null;
      let blob: Blob | null = null;
      try {
        const m = await import(/* @vite-ignore */ module);
        blob = await (genre === "resultat" ? m.renderResultImage(donnees, format) : m.renderLeaderboardImage(donnees, format));
      } catch (e) {
        erreur = String(e);
      } finally {
        proto.fillText = originaux.fillText;
        proto.strokeText = originaux.strokeText;
      }
      if (!blob) return { erreur, octets: [], pixels: null, traces, largeur: 0, hauteur: 0 };
      const octets = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
      const w = bmp.width;
      const h = bmp.height;
      const pixels = { coins: [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)], centre: px(Math.floor(w / 2), Math.floor(h / 2)) };
      return { erreur, octets, pixels, traces, largeur: w, hauteur: h };
    },
    { module: MODULE, genre, format, donnees },
  );
}

const jaune = (page: Page) =>
  page.evaluate(() => {
    const s = document.createElement("div");
    s.className = "bg-jaune-soleil";
    document.body.appendChild(s);
    const [r, g, b] = getComputedStyle(s).backgroundColor.match(/\d+/g)!.map(Number);
    s.remove();
    return [r, g, b];
  });

const top = (n: number) => Array.from({ length: n }, (_, i) => ({ pseudo: `Joueur${i + 1}`, score: Math.max(0, 10 - i), rank: i + 1 }));
const base = { quizTitle: "Les héros de la foi", pseudo: "Grâce_22", score: 7, total: 10, rank: 3, playerCount: 24 };

test.describe("images de partage : contenu des 4 PNG", () => {
  for (const { format, largeur, hauteur } of FORMATS) {
    for (const genre of ["resultat", "classement"] as const) {
      test(`${genre} ${format} : PNG valide, ${largeur}x${hauteur}, fond jaune, texte dans l'image`, async ({ page }) => {
        await ouvrir(page);
        const donnees = genre === "resultat" ? { ...base, top: top(5) } : { quizTitle: base.quizTitle, total: 10, playerCount: 24, top: top(5) };
        const r = await rendre(page, genre, format, donnees);
        expect(r.erreur).toBeNull();
        expect(r.octets.slice(0, 8)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const vue = new DataView(new Uint8Array(r.octets.slice(16, 24)).buffer);
        expect([vue.getUint32(0), vue.getUint32(4)]).toEqual([largeur, hauteur]);
        expect([r.largeur, r.hauteur]).toEqual([largeur, hauteur]);
        expect(r.octets.length).toBeGreaterThan(5_000);
        const fond = await jaune(page);
        // Les coins sont du fond (la trame de points est quasi invisible : tolérance de quelques unités).
        for (const p of r.pixels!.coins) {
          expect(p[3]).toBe(255);
          for (let i = 0; i < 3; i++) expect(Math.abs(p[i]! - fond[i]!)).toBeLessThanOrEqual(12);
        }
        const c = r.pixels!.centre;
        expect(c[3]).toBe(255);
        expect(r.traces.length).toBeGreaterThan(3);
      });
    }
  }
});

test.describe("images de partage : polices", () => {
  test("à froid : les polices de l'affiche sont chargées avant le dessin et utilisées pour les accents", async ({ page }) => {
    await ouvrir(page);
    const avant = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").length);
    const r = await rendre(page, "resultat", "portrait", { ...base, pseudo: "Élodie Zoé Grâce", quizTitle: "Éveil à la foi", top: top(5) });
    expect(r.erreur).toBeNull();
    const apres = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").length);
    expect(apres).toBeGreaterThanOrEqual(avant);
    const familles = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")));
    expect(familles).toEqual(expect.arrayContaining(["Lilita One", "Baloo 2"]));

    // Le titre est dessiné en Lilita One, le pseudo en Baloo 2 : la police annoncée est bien disponible (document.fonts.check).
    const titre = r.traces.find((t) => t.texte === "QUIZDESZELES")!;
    const pseudo = r.traces.find((t) => t.texte.includes("Élodie"))!;
    expect(titre.font).toContain("Lilita One");
    expect(pseudo.font).toContain("Baloo 2");
    const chargees = await page.evaluate(
      async ([a, b]) => [await document.fonts.load(a!, "Q"), await document.fonts.load(b!, "É")].map((l) => l.length),
      [titre.font, pseudo.font],
    );
    expect(chargees[0]).toBeGreaterThan(0);
    expect(chargees[1]).toBeGreaterThan(0);

    // Mesure avec la police chargée différente de la mesure en repli : preuve que la bonne police sert au dessin.
    const ecart = await page.evaluate(
      ([fp, texte]) => {
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = fp!;
        const reel = ctx.measureText(texte!).width;
        ctx.font = fp!.replace(/(\d+px).*/, "$1 monospace");
        return [reel, ctx.measureText(texte!).width];
      },
      [pseudo.font, "Élodie Zoé Grâce"],
    );
    expect(ecart[0]).not.toBeCloseTo(ecart[1]!, 1);
  });
});

test.describe("images de partage : robustesse", () => {
  const cas: Array<{ nom: string; donnees: Record<string, unknown> }> = [
    { nom: "pseudo de 200 caractères sans espace", donnees: { ...base, pseudo: "W".repeat(200), top: [{ pseudo: "W".repeat(200), score: 9, rank: 1 }, ...top(4)] } },
    { nom: "pseudo de 200 caractères avec espaces", donnees: { ...base, pseudo: "Marie Ange ".repeat(20), top: top(5) } },
    { nom: "emojis composés", donnees: { ...base, pseudo: "👨‍👩‍👧‍👦🏳️‍🌈👩🏽‍🚀".repeat(10), top: [{ pseudo: "👨‍👩‍👧‍👦".repeat(30), score: 5, rank: 1 }] } },
    { nom: "arabe", donnees: { ...base, pseudo: "مرحبا بالعالم العربي الجميل", top: [{ pseudo: "مرحبا بالعالم".repeat(8), score: 8, rank: 1 }] } },
    { nom: "hébreu", donnees: { ...base, pseudo: "שלום עולם".repeat(10), top: [{ pseudo: "שלום עולם", score: 8, rank: 1 }] } },
    { nom: "titre de 120 caractères", donnees: { ...base, quizTitle: "Les héros de la foi ".repeat(6).slice(0, 120), top: top(5) } },
    { nom: "titre de 120 caractères sans espace", donnees: { ...base, quizTitle: "É".repeat(120), top: top(5) } },
    { nom: "top vide", donnees: { ...base, rank: 1, playerCount: 0, top: [] } },
    { nom: "top d'une entrée", donnees: { ...base, rank: 1, playerCount: 1, top: [{ pseudo: "Grâce_22", score: 7, rank: 1, isYou: true }] } },
    { nom: "top de 12 entrées", donnees: { ...base, rank: 9, top: top(12) } },
    { nom: "joueur hors du top 5", donnees: { ...base, rank: 17, playerCount: 40, top: top(5) } },
    { nom: "score 0 sur 1", donnees: { ...base, score: 0, total: 1, rank: 1, playerCount: 1, top: [{ pseudo: "Grâce_22", score: 0, rank: 1 }] } },
    { nom: "score 50 sur 50", donnees: { ...base, score: 50, total: 50, rank: 1, top: [{ pseudo: "Grâce_22", score: 50, rank: 1 }] } },
    { nom: "200 joueurs", donnees: { ...base, rank: 137, playerCount: 200, top: top(200) } },
  ];

  for (const { format, largeur, hauteur } of FORMATS) {
    for (const genre of ["resultat", "classement"] as const) {
      for (const c of cas) {
        test(`${genre} ${format} : ${c.nom}`, async ({ page }) => {
          await ouvrir(page);
          const donnees = genre === "resultat" ? c.donnees : { quizTitle: c.donnees.quizTitle, total: c.donnees.total, playerCount: c.donnees.playerCount, top: c.donnees.top };
          const r = await rendre(page, genre, format, donnees);
          expect(r.erreur, "exception de rendu").toBeNull();
          expect([r.largeur, r.hauteur]).toEqual([largeur, hauteur]);
          // Aucun texte ne sort de l'image : on borne chaque texte selon son alignement.
          const hors = r.traces
            .filter((t) => {
              const gauche = t.align === "center" ? t.x - t.largeur / 2 : t.align === "right" || t.align === "end" ? t.x - t.largeur : t.x;
              // Tolérance de 2 px pour le contour des lettres.
              return gauche < -2 || gauche + t.largeur > largeur + 2 || t.y < 0 || t.y > hauteur;
            })
            .map((t) => `${t.texte.slice(0, 20)} x=${Math.round(t.x)} l=${Math.round(t.largeur)}`);
          expect(hors, "texte hors de l'image").toEqual([]);
          // Les textes dessinés dans la feuille ou les pilules tiennent dans leur colonne (marge de 6 unités de conception).
          const echelle = largeur / (format === "portrait" ? 390 : 600);
          const debordeur = r.traces.filter((t) => t.largeur > largeur - 6 * echelle * (format === "portrait" ? 2 : 3)).map((t) => t.texte.slice(0, 20));
          expect(debordeur, "texte plus large que la colonne").toEqual([]);
        });
      }
    }
  }
});

test.describe("images de partage : jetons", () => {
  test("sans feuille de style, le rendu échoue clairement au lieu de dessiner par défaut", async ({ page }) => {
    await ouvrir(page);
    test.setTimeout(60_000);
    // On neutralise tout le CSS : les classes sondes ne résolvent plus rien.
    await page.evaluate(() => {
      for (const s of [...document.styleSheets]) s.disabled = true;
      for (const l of document.querySelectorAll("style, link[rel=stylesheet]")) l.remove();
    });
    const r = await rendre(page, "resultat", "portrait", { ...base, top: top(5) });
    expect(r.erreur, "le rendu doit lever une erreur explicite quand les jetons sont introuvables").not.toBeNull();
  });

  test("les couleurs du rendu viennent des classes sondes : redéfinir bg-jaune-soleil change le fond", async ({ page }) => {
    await ouvrir(page);
    await page.addStyleTag({ content: ".bg-jaune-soleil{background-color:rgb(10,200,30) !important}" });
    const r = await rendre(page, "classement", "paysage", { quizTitle: "t", total: 10, playerCount: 3, top: top(3) });
    expect(r.erreur).toBeNull();
    for (const p of r.pixels!.coins) expect(p.slice(0, 3).map((v, i) => Math.abs(v - [10, 200, 30][i]!)).every((d) => d <= 12)).toBe(true);
  });
});

test("la page /dev/partage répond 404 hors DEV (build de production)", async ({ request }) => {
  const r = await request.get(`${URL_PREVIEW}/dev/partage`);
  expect(r.status()).toBe(404);
});
