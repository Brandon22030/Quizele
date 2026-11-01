import type { ReactNode } from "react";
import { cx } from "./cx";

interface Props {
  className?: string;
  children: ReactNode;
}

// Fond jaune des écrans joueurs avec la trame pointillée de l'affiche (QZ-001, décision n°1).
export function EcranJeu({ className, children }: Props) {
  return (
    <div
      className={cx("min-h-dvh bg-jaune-soleil pb-8 text-vert-foret", className)}
      style={{
        backgroundImage:
          "radial-gradient(color-mix(in srgb, var(--color-vert-foret) 10%, transparent) 1.2px, transparent 1.4px)",
        backgroundSize: "var(--spacing-4) var(--spacing-4)",
      }}
    >
      {children}
    </div>
  );
}
