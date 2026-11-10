import type { Jetons } from "./jetons";
import { fitText } from "./texte";

// Primitives de l'affiche. Toutes les coordonnées sont en unités de conception (390 de large en portrait),
// le canvas est mis à l'échelle une fois pour toutes par le rendu.

export type Ctx = CanvasRenderingContext2D;

// Trame : reprise de `.trame-points` (global.css), pas de --spacing-4, point vert forêt à 10 %, rayon de 1,2 px.
const OPACITE_TRAME = 0.1;
const RAYON_TRAME = 1.2;
// Lettrage extrudé : profondeur et contour proportionnels au corps, comme l'ombre « relief » des titres de l'affiche.
const PROFONDEUR_EXTRUSION = 0.09;
const CONTOUR_LETTRAGE = 0.14;
// Rayon intérieur des pointes de l'étoile, rapporté au rayon extérieur : même rapport que --forme-etoile
// (creux à 40 % du centre, pointes à 49 %).
const CREUX_ETOILE = 0.82;
// Pilule : hauteur rapportée au corps, et décalage vertical qui compense le jambage bas des polices arrondies
// (Baloo, Lilita) pour que le texte paraisse centré.
const HAUTEUR_PILULE = 1.9;
const RECENTRAGE_PILULE = 0.06;

export function police(famille: string, taille: number, graisse: number | "" = ""): string {
  return `${graisse} ${taille}px ${famille}`.trim();
}

export function mesure(ctx: Ctx, font: string): (texte: string) => number {
  return (texte) => {
    ctx.font = font;
    return ctx.measureText(texte).width;
  };
}

export function fond(ctx: Ctx, t: Jetons, largeur: number, hauteur: number): void {
  ctx.fillStyle = t.couleurs.jaune;
  ctx.fillRect(0, 0, largeur, hauteur);
  // Trame de points de l'affiche : très discrète, elle ne doit pas gêner la lecture.
  const pas = t.espaces.quatre;
  ctx.fillStyle = t.couleurs.foret;
  ctx.globalAlpha = OPACITE_TRAME;
  for (let y = pas / 2; y < hauteur; y += pas) {
    for (let x = pas / 2; x < largeur; x += pas) {
      ctx.beginPath();
      ctx.arc(x, y, RAYON_TRAME, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

interface OptionsTexte {
  taille: number;
  famille: string;
  fill: string;
  profondeur?: number;
}

/** Lettrage extrudé : contour forêt, extrusion vert vif décalée vers le bas à gauche, face pleine par-dessus. */
export function texteExtrude(ctx: Ctx, t: Jetons, texte: string, x: number, y: number, o: OptionsTexte): void {
  const profondeur = o.profondeur ?? Math.max(2, Math.round(o.taille * PROFONDEUR_EXTRUSION));
  const epaisseur = Math.max(2, o.taille * CONTOUR_LETTRAGE);
  ctx.font = police(o.famille, o.taille);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = t.couleurs.foret;
  ctx.lineWidth = epaisseur;
  for (let i = profondeur; i >= 0; i--) ctx.strokeText(texte, x - i, y + i);
  ctx.fillStyle = t.couleurs.vif;
  for (let i = profondeur; i >= 1; i--) ctx.fillText(texte, x - i, y + i);
  ctx.strokeText(texte, x, y);
  ctx.fillStyle = o.fill;
  ctx.fillText(texte, x, y);
}

export function etoile(ctx: Ctx, t: Jetons, cx: number, cy: number, rayon: number): void {
  const pointes = 14;
  const chemin = new Path2D();
  for (let i = 0; i < pointes * 2; i++) {
    const r = i % 2 === 0 ? rayon : rayon * CREUX_ETOILE;
    const angle = (Math.PI * i) / pointes - Math.PI / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) chemin.moveTo(px, py);
    else chemin.lineTo(px, py);
  }
  chemin.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = t.espaces.deux / 2;
  ctx.strokeStyle = t.couleurs.foret;
  ctx.fillStyle = t.couleurs.creme;
  ctx.stroke(chemin);
  ctx.fill(chemin);
}

interface OptionsPilule {
  fond: string;
  encre: string;
  taille: number;
  famille: string;
  largeurMax: number;
  graisse?: number;
  bord?: string;
}

/** Pilule centrée en `cx`, `haut` en ordonnée du bord supérieur. Retourne sa hauteur. */
export function pilule(ctx: Ctx, t: Jetons, texte: string, cx: number, haut: number, o: OptionsPilule): number {
  const font = police(o.famille, o.taille, o.graisse ?? "");
  const remplissage = t.espaces.quatre;
  const hauteur = Math.round(o.taille * HAUTEUR_PILULE);
  const propre = fitText(mesure(ctx, font), texte, o.largeurMax - remplissage * 2);
  ctx.font = font;
  const largeur = ctx.measureText(propre).width + remplissage * 2;
  const x = cx - largeur / 2;
  ctx.beginPath();
  ctx.roundRect(x, haut, largeur, hauteur, hauteur / 2);
  ctx.fillStyle = o.fond;
  ctx.fill();
  ctx.lineWidth = t.espaces.deux / 2;
  ctx.strokeStyle = o.bord ?? t.couleurs.foret;
  ctx.stroke();
  ctx.fillStyle = o.encre;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(propre, cx, haut + hauteur / 2 + o.taille * RECENTRAGE_PILULE);
  return hauteur;
}

// Profil du bord déchiré : mêmes points que le chemin SVG de --masque-dechire (global.css, viewBox 0 0 120 12),
// répété sur la largeur. Toute retouche du masque CSS doit être reportée ici, et inversement.
const DECHIRURE: ReadonlyArray<readonly [number, number]> = [
  [0, 6], [7, 3], [13, 7], [20, 2], [28, 6], [34, 1], [41, 5], [49, 3], [55, 8],
  [62, 2], [70, 5], [77, 1], [84, 6], [91, 3], [98, 7], [105, 2], [113, 5], [120, 6],
];
const MOTIF = 120;
export const HAUTEUR_DECHIRURE = 12;

function bord(chemin: Path2D, x: number, y: number, largeur: number, sens: 1 | -1): void {
  const tuiles = Math.ceil(largeur / MOTIF);
  const echelle = largeur / (tuiles * MOTIF);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < tuiles; i++) {
    for (const [px, py] of DECHIRURE) {
      if (i > 0 && px === 0) continue;
      points.push([x + (i * MOTIF + px) * echelle, y + (sens === 1 ? py : HAUTEUR_DECHIRURE - py)]);
    }
  }
  if (sens === -1) points.reverse();
  for (const [px, py] of points) chemin.lineTo(px, py);
}

/** Feuille crème aux bords haut et bas déchirés. Le contenu se place entre `haut + 12` et `haut + hauteur - 12`. */
export function papier(ctx: Ctx, t: Jetons, x: number, haut: number, largeur: number, hauteur: number): void {
  const chemin = new Path2D();
  chemin.moveTo(x, haut + HAUTEUR_DECHIRURE);
  bord(chemin, x, haut, largeur, 1);
  chemin.lineTo(x + largeur, haut + hauteur - HAUTEUR_DECHIRURE);
  bord(chemin, x, haut + hauteur - HAUTEUR_DECHIRURE, largeur, -1);
  chemin.closePath();
  ctx.fillStyle = t.couleurs.creme;
  ctx.fill(chemin);
}
