import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "./cn";

interface RepliProps {
  titre: string;
  icone?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

// <details> natif : repli au clavier et annonce « développé / réduit » sans JavaScript.
export function Repli({ titre, icone, defaultOpen = false, children, className }: RepliProps) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        "group rounded-md border-trait border-dashed border-vert-foret open:border-solid open:bg-creme open:text-vert-foret",
        "in-data-foret:border-creme in-data-foret:open:border-vert-nuit",
        className,
      )}
    >
      <summary
        className={cn(
          "flex min-h-14 cursor-pointer list-none items-center gap-2 rounded-md px-4 font-extrabold",
          "in-data-foret:focus-visible:outline-jaune-soleil in-data-foret:group-open:focus-visible:outline-vert-foret",
        )}
      >
        {icone ? (
          <span aria-hidden="true" className="grid place-items-center">
            {icone}
          </span>
        ) : null}
        <span className="flex-1">{titre}</span>
        <Plus aria-hidden="true" className="size-5 group-open:hidden" />
        <Minus aria-hidden="true" className="hidden size-5 group-open:block" />
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">{children}</div>
    </details>
  );
}
