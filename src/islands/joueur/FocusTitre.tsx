import { useEffect } from "react";

// À chaque changement d'écran, le focus va sur le titre : sans cela il retombe sur body quand le bouton cliqué disparaît.
// tabIndex -1 rend le titre focalisable par script sans l'ajouter à l'ordre de tabulation.
export function FocusTitre({ selecteur = "h1" }: { selecteur?: string }) {
  useEffect(() => {
    const titre = document.querySelector<HTMLElement>(selecteur);
    if (!titre) return;
    if (!titre.hasAttribute("tabindex")) titre.tabIndex = -1;
    titre.focus({ preventScroll: true });
  }, [selecteur]);
  return null;
}
