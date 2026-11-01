import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "./cn";

// Le dégradé fait 300 % de large pour que animate-brille le fasse défiler d'un bord à l'autre.
const largeurBrillance: CSSProperties = { backgroundSize: "300% 100%" };

/** Bloc de chargement décoratif : la page annonce l'attente elle-même (aria-busy ou texte « Chargement »). */
export function Squelette({ className, style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      style={{ ...largeurBrillance, ...style }}
      className={cn(
        "animate-brille rounded-sm bg-linear-100 from-vert-foret/15 from-30% via-vert-foret/25 via-50% to-vert-foret/15 to-70%",
        className,
      )}
      {...rest}
    />
  );
}
