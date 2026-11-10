import { useEffect, useState } from "react";

// Faux au premier rendu (celui du serveur) puis aligné sur la préférence après montage : le HTML hydraté
// est identique au HTML serveur, sans avertissement d'hydratation. Le CSS coupe déjà les animations
// `animate-*` sous prefers-reduced-motion ; ce hook sert à ne pas poser la classe (et les confettis) du tout.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
