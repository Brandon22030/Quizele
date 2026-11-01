import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Les jetons du projet ne suivent pas les noms par défaut de Tailwind : sans cette extension,
// border-trait serait pris pour une couleur et écraserait border-vert-foret (et inversement).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "border-w": [{ border: ["trait"] }],
      "outline-w": [{ outline: ["trait"] }],
      shadow: [{ shadow: ["relief-sm", "relief", "relief-lg", "relief-vif", "relief-jaune", "relief-appui"] }],
      "text-shadow": [{ "text-shadow": ["affiche", "affiche-sm"] }],
      animate: [{ animate: ["pop", "tremble", "brille", "tourne"] }],
      rounded: [{ rounded: ["pill"] }],
      "font-family": [{ font: ["affiche", "badge", "note", "sans"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
