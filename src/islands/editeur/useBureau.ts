import { useSyncExternalStore } from "react";

// Même seuil que le préfixe lg: de Tailwind (64rem). Ce qui n'existe qu'en bureau n'est pas monté sur mobile : un aperçu
// caché coûte quand même son rendu à chaque frappe, et un texte caché en double gêne les lecteurs d'écran en mode lecture.
const REQUETE_BUREAU = "(min-width: 64rem)";

function abonner(fn: () => void): () => void {
  const requete = window.matchMedia(REQUETE_BUREAU);
  requete.addEventListener("change", fn);
  return () => requete.removeEventListener("change", fn);
}

export function useBureau(): boolean {
  return useSyncExternalStore(
    abonner,
    () => window.matchMedia(REQUETE_BUREAU).matches,
    () => false,
  );
}
