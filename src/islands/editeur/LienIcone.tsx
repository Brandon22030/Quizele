import type { ReactNode } from "react";
import { cn } from "../../components/ui/cn";

interface Props {
  href: string;
  label: string;
  icone: ReactNode;
  className?: string;
}

// Équivalent de IconButton pour une navigation : un vrai lien, 44 px, même relief.
export function LienIcone({ href, label, icone, className }: Props) {
  return (
    <a
      href={href}
      aria-label={label}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret bg-creme text-vert-foret shadow-relief-sm",
        "transition-transform active:-translate-x-1 active:translate-y-1 active:shadow-relief-appui",
        className,
      )}
    >
      {icone}
    </a>
  );
}
