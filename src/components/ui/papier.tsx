import type { HTMLAttributes } from "react";
import { cn } from "./cn";

interface BordDechireProps {
  cote: "haut" | "bas";
  className?: string;
}

/** Bande de papier déchiré : la couleur du masque suit le fond, ici crème par défaut. */
export function BordDechire({ cote, className }: BordDechireProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bord-dechire absolute inset-x-0 h-3 bg-creme",
        // 1 px de recouvrement : sans lui, le sous-pixel laisse un liseré entre le bord et le corps.
        cote === "haut" ? "bottom-full translate-y-px" : "top-full -translate-y-px -scale-y-100",
        className,
      )}
    />
  );
}

interface PapierProps extends HTMLAttributes<HTMLDivElement> {
  incline?: boolean;
}

export function Papier({ incline = false, className, children, ...rest }: PapierProps) {
  return (
    <div data-papier="" className={cn("relative my-3 bg-creme p-4 text-vert-foret", incline && "-rotate-1", className)} {...rest}>
      <BordDechire cote="haut" />
      {children}
      <BordDechire cote="bas" />
    </div>
  );
}
