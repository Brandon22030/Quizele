import type { ReactNode } from "react";
import { cn } from "../ui/cn";

interface Props {
  className?: string;
  children: ReactNode;
}

// Fond jaune des écrans joueurs avec la trame pointillée de l'affiche (QZ-001, décision n°1).
export function EcranJeu({ className, children }: Props) {
  return <div className={cn("trame-points min-h-dvh bg-jaune-soleil pb-8 text-vert-foret", className)}>{children}</div>;
}
