// Réordonnancement de la liste des questions : fonctions pures, partagées par le glisser et les flèches du clavier.

export function deplacer<T>(liste: readonly T[], de: number, vers: number): T[] {
  const copie = [...liste];
  if (de < 0 || de >= copie.length) return copie;
  const arrivee = Math.max(0, Math.min(copie.length - 1, vers));
  const [element] = copie.splice(de, 1);
  copie.splice(arrivee, 0, element);
  return copie;
}

// Décale la clé de `delta` rangs (flèche haut : -1, flèche bas : +1) ; liste inchangée en butée.
export function decalerCle(cles: readonly string[], cle: string, delta: number): string[] {
  const index = cles.indexOf(cle);
  if (index === -1) return [...cles];
  return deplacer(cles, index, index + delta);
}

export interface Bande {
  top: number;
  bottom: number;
}

// Rang de la ligne sous le pointeur ; au-dessus de la première ou sous la dernière, on borne (le doigt sort de la liste).
export function indexSousPointeur(bandes: readonly Bande[], y: number): number {
  if (bandes.length === 0) return -1;
  if (y <= bandes[0].top) return 0;
  const dernier = bandes.length - 1;
  if (y >= bandes[dernier].bottom) return dernier;
  // Entre deux lignes (l'espacement), on reste sur la ligne du dessus : pas de saut tant que le pointeur n'est pas sur la suivante.
  for (let i = 0; i < bandes.length; i++) {
    if (y < bandes[i].bottom) return y >= bandes[i].top ? i : Math.max(0, i - 1);
  }
  return dernier;
}

export function annonceDeplacement(position: number, total: number): string {
  return `Question déplacée en position ${position} sur ${total}.`;
}

export const MARGE_DEFILEMENT_PX = 48;
export const VITESSE_DEFILEMENT_MAX_PX = 16;

// Pendant un glisser, le doigt ne peut pas faire défiler la liste : près d'un bord de la zone visible, la liste défile seule,
// d'autant plus vite que le pointeur s'approche du bord (ou le dépasse). Négatif vers le haut, positif vers le bas.
export function vitesseDefilement(y: number, haut: number, bas: number, marge: number = MARGE_DEFILEMENT_PX, max: number = VITESSE_DEFILEMENT_MAX_PX): number {
  if (bas - haut <= 2 * marge) return 0;
  const proportion = (distance: number) => Math.min(1, (marge - distance) / marge);
  if (y < haut + marge) return -Math.ceil(max * proportion(y - haut));
  if (y > bas - marge) return Math.ceil(max * proportion(bas - y));
  return 0;
}
