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
