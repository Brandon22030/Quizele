import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "./button";
import { cn } from "./cn";

interface EtatErreurProps {
  titre?: string;
  children: ReactNode;
  onRetry?: () => void;
  libelleRetry?: string;
  className?: string;
}

export function EtatErreur({ titre, children, onRetry, libelleRetry = "Réessayer", className }: EtatErreurProps) {
  return (
    <div
      role="alert"
      data-papier=""
      className={cn(
        "flex flex-col items-start gap-3 rounded-md border-trait border-piment bg-creme p-4 text-vert-foret shadow-relief-sm",
        className,
      )}
    >
      {titre ? <p className="font-affiche text-xl leading-tight">{titre}</p> : null}
      <p className="text-base font-bold">{children}</p>
      {onRetry ? (
        <Button taille="petit" onClick={onRetry}>
          <RotateCw aria-hidden="true" className="size-4" />
          {libelleRetry}
        </Button>
      ) : null}
    </div>
  );
}
