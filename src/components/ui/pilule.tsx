import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type PiluleVariant = "foret" | "soleil" | "creme";

const variants: Record<PiluleVariant, string> = {
  foret: "bg-vert-foret text-creme",
  soleil: "bg-jaune-soleil text-vert-foret foret:border-vert-nuit",
  creme: "bg-creme text-vert-foret foret:border-vert-nuit",
};

interface PiluleProps extends HTMLAttributes<HTMLSpanElement> {
  variante?: PiluleVariant;
  inclinaison?: "gauche" | "droite";
}

export function Pilule({ variante = "foret", inclinaison, className, ...rest }: PiluleProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border-trait border-vert-foret px-4 py-1 text-sm font-extrabold",
        variants[variante],
        inclinaison === "gauche" && "-rotate-4",
        inclinaison === "droite" && "rotate-3",
        className,
      )}
      {...rest}
    />
  );
}
