import { clsx, type ClassValue } from "clsx";

// Pas de tailwind-merge : aucune classe de ces composants n'en écrase une autre, et ses groupes
// ne connaissent pas les jetons de l'affiche (text-4xl, shadow-relief...).
export const cx = (...classes: ClassValue[]): string => clsx(classes);

// Contour de 3 px de l'affiche, tiré du jeton --spacing-trait.
export const TRAIT = "border-(length:--spacing-trait)";
