import { HAUTEUR_DECHIRURE, etoile, fond, mesure, papier, pilule, police, texteExtrude, type Ctx } from "./dessin";
import { lireJetons, type Jetons } from "./jetons";
import { fitText } from "./texte";
import type { LeaderboardShareData, ResultShareData, ShareFormat, ShareRankingEntry } from "./types";

const NOM_APP = "QUIZDESZELES";
const MAX_LIGNES = 5;
// Au-delà, on dessine avec les polices de secours de la pile CSS : une image un peu moins fidèle vaut mieux
// qu'un bouton de partage qui ne répond jamais (réseau lent, police bloquée).
const DELAI_POLICES_MS = 5_000;

// Ratios typographiques, rapportés au corps du texte concerné.
// Corps des lignes du classement rapporté à la hauteur d'une ligne : laisse l'air du filet pointillé.
const CORPS_LIGNE_CLASSEMENT = 0.7;
// Demi-hauteur visuelle du gros chiffre du score (Lilita a peu de jambage : un peu plus que la moitié du corps).
const DEMI_HAUTEUR_SCORE = 0.55;
// « /total » plus petit, abaissé pour s'aligner sur la ligne de base du gros chiffre.
const ABAISSEMENT_TOTAL = 0.1;
// Retrait du pseudo après le rang : place d'un rang à deux chiffres.
const RETRAIT_PSEUDO = 1.6;
// Baloo 2 a un œil haut : le pseudo descend légèrement pour paraître aligné avec le rang et le score.
const RECENTRAGE_PSEUDO = 0.1;
// Rayon de l'étoile « TOP 5 » rapporté au corps text-5xl, et recentrage de Bangers dans l'étoile.
const RAYON_ETOILE = 0.65;
const RECENTRAGE_BADGE = 0.05;

// Caractères de contrôle et de forçage de direction (LRE, RLE, PDF, LRO, RLO, LRI, RLI, FSI, PDI) : un titre ou un
// pseudo qui en contient pourrait retourner le reste de la ligne dessinée ou y laisser des glyphes de substitution.
const CONTROLES = /\p{Cc}/gu;
const DIRECTION = /[\u202A-\u202E\u2066-\u2069]/gu;

function nettoyer(texte: string): string {
  return texte.replace(CONTROLES, " ").replace(DIRECTION, "");
}

// Dimensions de sortie en pixels et échelle vers l'unité de conception (390 de large en portrait, comme les maquettes).
const FORMATS: Record<ShareFormat, { largeur: number; hauteur: number; echelle: number }> = {
  portrait: { largeur: 1080, hauteur: 1350, echelle: 1080 / 390 },
  paysage: { largeur: 1200, hauteur: 630, echelle: 2 },
};

interface Scene {
  ctx: Ctx;
  t: Jetons;
  /** Dimensions en unités de conception. */
  l: number;
  h: number;
  /** Colonne de présentation (centre et largeur) et zone de la feuille de classement. */
  colonne: { cx: number; largeur: number };
  feuille: { x: number; haut: number; largeur: number; hauteur: number };
}

function scene(canvas: HTMLCanvasElement, format: ShareFormat, t: Jetons): Scene {
  const { largeur, hauteur, echelle } = FORMATS[format];
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  ctx.scale(echelle, echelle);
  const l = largeur / echelle;
  const h = hauteur / echelle;
  const marge = t.espaces.six;
  if (format === "portrait") {
    return { ctx, t, l, h, colonne: { cx: l / 2, largeur: l - marge * 2 }, feuille: { x: marge, haut: 0, largeur: l - marge * 2, hauteur: 0 } };
  }
  const moitie = (l - marge * 3) / 2;
  return {
    ctx,
    t,
    l,
    h,
    colonne: { cx: marge + moitie / 2, largeur: moitie },
    feuille: { x: marge * 2 + moitie, haut: marge, largeur: moitie, hauteur: h - marge * 2 },
  };
}

// Charge explicitement chaque police avec le texte à dessiner : un @font-face n'est téléchargé qu'à l'usage
// (et par sous-ensemble Unicode), `document.fonts.ready` seul ne suffirait pas hors d'une page qui les affiche.
async function attendrePolices(t: Jetons, textes: string): Promise<void> {
  const p = t.polices;
  const chargement = Promise.all([
    document.fonts.load(police(p.affiche, t.tailles.xl), textes),
    document.fonts.load(police(p.badge, t.tailles.xl), textes),
    document.fonts.load(police(p.note, t.tailles.xl), textes),
    document.fonts.load(police(p.texte, t.tailles.sm, 700), textes),
    document.fonts.load(police(p.texte, t.tailles.sm, 800), textes),
  ]).then(() => document.fonts.ready);
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<void>((resolve) => {
    minuterie = setTimeout(resolve, DELAI_POLICES_MS);
  });
  try {
    await Promise.race([chargement, delai]);
  } finally {
    clearTimeout(minuterie);
  }
}

function versPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Génération du PNG impossible"))), "image/png");
  });
}

async function dessinerPng(dessiner: (canvas: HTMLCanvasElement) => void): Promise<Blob> {
  const canvas = document.createElement("canvas");
  try {
    dessiner(canvas);
    return await versPng(canvas);
  } finally {
    // Safari iOS plafonne la mémoire totale des canvas : on libère le tampon sans attendre le ramasse-miettes,
    // y compris quand le dessin a levé avant l'encodage.
    canvas.width = 0;
    canvas.height = 0;
  }
}

function titreApp(s: Scene, y: number): number {
  const taille = s.t.tailles.xxl;
  const font = police(s.t.polices.affiche, taille);
  const largeur = s.colonne.largeur;
  const ajuste = Math.min(taille, (taille * largeur) / mesure(s.ctx, font)(NOM_APP));
  texteExtrude(s.ctx, s.t, NOM_APP, s.colonne.cx, y + taille / 2, { taille: ajuste, famille: s.t.polices.affiche, fill: s.t.couleurs.creme });
  return taille;
}

function pilulesTitre(s: Scene, texte: string, haut: number): number {
  return pilule(s.ctx, s.t, texte, s.colonne.cx, haut, {
    fond: s.t.couleurs.foret,
    encre: s.t.couleurs.creme,
    taille: s.t.tailles.sm,
    famille: s.t.polices.texte,
    graisse: 700,
    largeurMax: s.colonne.largeur,
  });
}

function scoreLigne(s: Scene, score: number, total: number, centreY: number, tailleGros: number, tailleReste: number): void {
  const { ctx, t } = s;
  const gros = String(score);
  const reste = `/${total}`;
  const largeurGros = mesure(ctx, police(t.polices.affiche, tailleGros))(gros);
  const largeurReste = mesure(ctx, police(t.polices.affiche, tailleReste))(reste);
  const espace = t.espaces.deux;
  const debut = s.colonne.cx - (largeurGros + espace + largeurReste) / 2;
  texteExtrude(ctx, t, gros, debut + largeurGros / 2, centreY, { taille: tailleGros, famille: t.polices.affiche, fill: t.couleurs.creme });
  texteExtrude(ctx, t, reste, debut + largeurGros + espace + largeurReste / 2, centreY + tailleGros * ABAISSEMENT_TOTAL, {
    taille: tailleReste,
    famille: t.polices.affiche,
    fill: t.couleurs.jaune,
  });
}

function etiquette(s: Scene, texte: string, y: number, taille: number): void {
  const { ctx, t } = s;
  ctx.font = police(t.polices.affiche, taille);
  ctx.fillStyle = t.couleurs.foret;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fitText(mesure(ctx, ctx.font), texte, s.colonne.largeur), s.colonne.cx, y);
}

function feuilleClassement(s: Scene, top: ShareRankingEntry[], total: number): void {
  const { ctx, t, feuille } = s;
  papier(ctx, t, feuille.x, feuille.haut, feuille.largeur, feuille.hauteur);
  const interieur = t.espaces.quatre;
  const haut = feuille.haut + HAUTEUR_DECHIRURE + t.espaces.deux;
  const zone = feuille.hauteur - (HAUTEUR_DECHIRURE + t.espaces.deux) * 2;
  const ligne = zone / MAX_LIGNES;
  const entrees = top.slice(0, MAX_LIGNES);
  if (entrees.length === 0) {
    ctx.font = police(t.polices.note, t.tailles.xl);
    ctx.fillStyle = t.couleurs.mousse;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Aucun joueur", feuille.x + feuille.largeur / 2, feuille.haut + feuille.hauteur / 2);
    return;
  }
  const taille = Math.min(t.tailles.lg, ligne * CORPS_LIGNE_CLASSEMENT);
  const fontRang = police(t.polices.affiche, taille);
  const fontNom = police(t.polices.texte, taille, 800);
  const fontScore = police(t.polices.affiche, taille);
  const gauche = feuille.x + interieur;
  const droite = feuille.x + feuille.largeur - interieur;
  entrees.forEach((entree, i) => {
    const y = haut + ligne * i;
    const milieu = y + ligne / 2;
    if (entree.isYou) {
      ctx.beginPath();
      ctx.roundRect(gauche - t.espaces.deux / 2, y + t.espaces.deux / 4, droite - gauche + t.espaces.deux, ligne - t.espaces.deux / 2, t.espaces.deux);
      ctx.fillStyle = t.couleurs.jaune;
      ctx.fill();
    } else if (i > 0) {
      ctx.strokeStyle = t.couleurs.separateur;
      ctx.lineWidth = t.espaces.deux / 4;
      ctx.setLineDash([t.espaces.deux, t.espaces.deux / 2]);
      ctx.beginPath();
      ctx.moveTo(gauche, y);
      ctx.lineTo(droite, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.textBaseline = "middle";
    ctx.fillStyle = t.couleurs.foret;
    ctx.textAlign = "left";
    ctx.font = fontRang;
    ctx.fillText(String(entree.rank), gauche + t.espaces.deux, milieu);
    const texteScore = `${entree.score} / ${total}`;
    ctx.font = fontScore;
    ctx.textAlign = "right";
    ctx.fillText(texteScore, droite - t.espaces.deux, milieu);
    const largeurScore = ctx.measureText(texteScore).width;
    const xNom = gauche + t.espaces.deux + taille * RETRAIT_PSEUDO;
    const place = droite - t.espaces.deux - largeurScore - t.espaces.deux - xNom;
    ctx.font = fontNom;
    ctx.textAlign = "left";
    ctx.fillText(fitText(mesure(ctx, fontNom), entree.pseudo, place), xNom, milieu + taille * RECENTRAGE_PSEUDO);
  });
}

function nbJoueurs(n: number): string {
  return n > 1 ? `${n} joueurs` : `${n} joueur`;
}

function preparerPortrait(s: Scene, haut: number, hauteur: number): void {
  // En portrait la feuille occupe le bas, sous la colonne de présentation.
  s.feuille.haut = haut;
  s.feuille.hauteur = hauteur;
}

function nettoyerTop(top: ShareRankingEntry[]): ShareRankingEntry[] {
  return top.slice(0, MAX_LIGNES).map((e) => ({ ...e, pseudo: nettoyer(e.pseudo) }));
}

export async function renderResultImage(entree: ResultShareData, format: ShareFormat = "portrait"): Promise<Blob> {
  const data = { ...entree, quizTitle: nettoyer(entree.quizTitle), pseudo: nettoyer(entree.pseudo), top: nettoyerTop(entree.top) };
  const t = lireJetons();
  await attendrePolices(t, `${NOM_APP} ${data.quizTitle} ${data.pseudo} ${data.top.map((e) => e.pseudo).join(" ")} 0123456789/ Rang :bonnes réponses`);
  return dessinerPng((canvas) => {
    const s = scene(canvas, format, t);
    const { ctx } = s;
    const marge = t.espaces.six;
    fond(ctx, t, s.l, s.h);

    titreApp(s, marge);
    const hautPilule = marge + t.tailles.xxl + t.espaces.quatre;
    const hPilule = pilulesTitre(s, data.quizTitle, hautPilule);
    // Le paysage est bas : le score descend d'un cran dans l'échelle typographique pour que la colonne tienne.
    const tailleGros = format === "portrait" ? t.tailles.cinq : t.tailles.quatre;
    const tailleReste = format === "portrait" ? t.tailles.quatre : t.tailles.xxxl;
    const centreScore = hautPilule + hPilule + t.espaces.quatre + tailleGros * DEMI_HAUTEUR_SCORE;
    scoreLigne(s, data.score, data.total, centreScore, tailleGros, tailleReste);
    const yLabel = centreScore + tailleGros * DEMI_HAUTEUR_SCORE + t.espaces.trois;
    etiquette(s, "bonnes réponses", yLabel + t.tailles.lg / 2, t.tailles.lg);
    let yPilules = yLabel + t.tailles.lg + t.espaces.trois;
    yPilules += pilule(ctx, t, `Rang : ${data.rank} / ${data.playerCount}`, s.colonne.cx, yPilules, {
      fond: t.couleurs.jaune,
      encre: t.couleurs.foret,
      taille: t.tailles.sm,
      famille: t.polices.affiche,
      largeurMax: s.colonne.largeur,
    });
    yPilules += t.espaces.deux;
    const hPseudo = pilule(ctx, t, data.pseudo, s.colonne.cx, yPilules, {
      fond: t.couleurs.creme,
      encre: t.couleurs.foret,
      taille: t.tailles.sm,
      famille: t.polices.texte,
      graisse: 800,
      largeurMax: s.colonne.largeur,
    });
    if (format === "portrait") {
      const haut = yPilules + hPseudo + t.espaces.quatre;
      preparerPortrait(s, haut, s.h - haut - t.espaces.quatre);
    }
    feuilleClassement(s, data.top, data.total);
  });
}

export async function renderLeaderboardImage(entree: LeaderboardShareData, format: ShareFormat = "portrait"): Promise<Blob> {
  const data = { ...entree, quizTitle: nettoyer(entree.quizTitle), top: nettoyerTop(entree.top) };
  const t = lireJetons();
  await attendrePolices(t, `${NOM_APP} ${data.quizTitle} ${data.top.map((e) => e.pseudo).join(" ")} 0123456789/ TOP 5 Classement joueurs`);
  return dessinerPng((canvas) => {
    const s = scene(canvas, format, t);
    const { ctx } = s;
    const marge = t.espaces.six;
    fond(ctx, t, s.l, s.h);

    titreApp(s, marge);
    const hautPilule = marge + t.tailles.xxl + t.espaces.quatre;
    const hPilule = pilulesTitre(s, data.quizTitle, hautPilule);
    const rayon = t.tailles.cinq * RAYON_ETOILE;
    const centreEtoile = hautPilule + hPilule + t.espaces.quatre + rayon;
    etoile(ctx, t, s.colonne.cx, centreEtoile, rayon);
    ctx.font = police(t.polices.badge, t.tailles.xxl);
    ctx.fillStyle = t.couleurs.foret;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TOP 5", s.colonne.cx, centreEtoile + t.tailles.xxl * RECENTRAGE_BADGE);
    const yLabel = centreEtoile + rayon + t.espaces.trois;
    etiquette(s, "Classement final", yLabel + t.tailles.xl / 2, t.tailles.xl);
    const yPilule = yLabel + t.tailles.xl + t.espaces.trois;
    const hJoueurs = pilule(ctx, t, nbJoueurs(data.playerCount), s.colonne.cx, yPilule, {
      fond: t.couleurs.creme,
      encre: t.couleurs.foret,
      taille: t.tailles.sm,
      famille: t.polices.affiche,
      largeurMax: s.colonne.largeur,
    });
    if (format === "portrait") {
      const haut = yPilule + hJoueurs + t.espaces.quatre;
      preparerPortrait(s, haut, s.h - haut - t.espaces.quatre);
    }
    feuilleClassement(s, data.top, data.total);
  });
}
