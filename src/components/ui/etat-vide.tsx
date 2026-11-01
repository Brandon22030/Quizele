import type { ReactNode } from "react";
import { Explosion } from "./explosion";
import { cn } from "./cn";

interface EtatVideProps {
  icone: ReactNode;
  titre: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EtatVide({ icone, titre, children, action, className }: EtatVideProps) {
  return (
    <section className={cn("flex flex-col items-center gap-4 px-4 py-8 text-center", className)}>
      <Explosion variante="soleil" className="size-20">
        <span aria-hidden="true" className="grid place-items-center">
          {icone}
        </span>
      </Explosion>
      <h2 className="font-affiche text-2xl leading-tight">{titre}</h2>
      {children ? <p className="max-w-xs text-base font-medium">{children}</p> : null}
      {action ? <div className="mt-2 w-full max-w-xs">{action}</div> : null}
    </section>
  );
}
