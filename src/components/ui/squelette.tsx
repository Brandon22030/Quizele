import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** Bloc de chargement décoratif : la page annonce l'attente elle-même (aria-busy ou texte « Chargement »). */
export function Squelette({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "squelette-brillance animate-brille rounded-sm bg-linear-100 from-vert-foret/15 from-30% via-vert-foret/25 via-50% to-vert-foret/15 to-70% foret:from-creme/15 foret:via-creme/25 foret:to-creme/15",
        className,
      )}
      {...rest}
    />
  );
}
