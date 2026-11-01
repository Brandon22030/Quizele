import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type FormeVariant = "creme" | "soleil" | "eclat" | "piment";

const fonds: Record<FormeVariant, string> = {
  creme: "bg-creme text-vert-foret",
  soleil: "bg-jaune-soleil text-vert-foret",
  eclat: "bg-vert-eclat text-vert-nuit",
  piment: "bg-piment text-creme",
};

export interface FormeProps extends HTMLAttributes<HTMLSpanElement> {
  variante?: FormeVariant;
}

/** Socle commun d'Explosion et de BadgeEtoile : contour vert forêt (clip-path extérieur) et remplissage (clip-path intérieur). */
export function Forme({ forme, variante = "creme", className, children, ...rest }: FormeProps & { forme: "etoile" | "explosion" }) {
  const clip = forme === "etoile" ? "forme-etoile" : "forme-explosion";
  return (
    <span className={cn("relative grid aspect-square size-20 place-items-center bg-vert-foret", clip, className)} {...rest}>
      <span className={cn("absolute inset-1 grid place-items-center text-center", clip, fonds[variante])}>{children}</span>
    </span>
  );
}
