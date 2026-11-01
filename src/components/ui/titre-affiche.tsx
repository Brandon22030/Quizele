import type { HTMLAttributes } from "react";
import { cn } from "./cn";

interface TitreAfficheProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3";
  petit?: boolean;
}

// Le contour et l'extrusion sont portés par text-shadow : l'accessibilité vient du texte lui-même, jamais de l'ombre.
export function TitreAffiche({ as: Balise = "h1", petit = false, className, ...rest }: TitreAfficheProps) {
  return (
    <Balise
      className={cn(
        "font-affiche tracking-wide text-creme",
        petit ? "text-shadow-affiche-sm leading-none" : "text-shadow-affiche leading-none",
        className,
      )}
      {...rest}
    />
  );
}
