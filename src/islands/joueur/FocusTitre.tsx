import { useEffect } from "react";

interface Cibles {
  querySelector: (selecteur: string) => HTMLElement | null;
  scrollTo: (options: ScrollToOptions) => void;
}

// À chaque changement d'écran, le focus va sur le titre : sans cela il retombe sur body quand le bouton cliqué disparaît.
// tabIndex -1 rend le titre focalisable par script sans l'ajouter à l'ordre de tabulation.
export function allerAuTitre(selecteur: string, { querySelector, scrollTo }: Cibles): void {
  // preventScroll évite un saut vers le titre, mais laisse la page là où l'écran précédent l'avait défilée :
  // le retour en haut est explicite, et « instant » ignore un scroll-behavior lissé (reduced-motion respecté).
  scrollTo({ top: 0, left: 0, behavior: "instant" });
  const titre = querySelector(selecteur);
  if (!titre) return;
  if (!titre.hasAttribute("tabindex")) titre.tabIndex = -1;
  titre.focus({ preventScroll: true });
}

export function FocusTitre({ selecteur = "h1" }: { selecteur?: string }) {
  useEffect(() => {
    allerAuTitre(selecteur, {
      querySelector: (s) => document.querySelector<HTMLElement>(s),
      scrollTo: (o) => window.scrollTo(o),
    });
  }, [selecteur]);
  return null;
}
