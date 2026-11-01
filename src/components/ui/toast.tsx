import { useEffect, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { IconButton } from "./button";
import { cn } from "./cn";

export type ToastVariant = "info" | "succes" | "erreur";

const variants: Record<ToastVariant, { classes: string; icone: ReactNode }> = {
  info: { classes: "bg-creme text-vert-foret border-vert-foret", icone: <Info className="size-5" /> },
  succes: { classes: "bg-vert-eclat text-vert-nuit border-vert-foret", icone: <CircleCheck className="size-5" /> },
  erreur: { classes: "bg-piment text-creme border-vert-nuit", icone: <CircleAlert className="size-5" /> },
};

interface ToastProps {
  variante?: ToastVariant;
  children: ReactNode;
  onClose?: () => void;
  /** Fermeture automatique en millisecondes ; absente = reste jusqu'à fermeture. */
  duree?: number;
  className?: string;
}

export function Toast({ variante = "info", children, onClose, duree, className }: ToastProps) {
  useEffect(() => {
    if (!duree || !onClose) return;
    const minuteur = setTimeout(onClose, duree);
    return () => clearTimeout(minuteur);
  }, [duree, onClose]);

  const { classes, icone } = variants[variante];
  return (
    <div
      role={variante === "erreur" ? "alert" : "status"}
      className={cn(
        "flex animate-pop items-center gap-3 rounded-md border-trait py-2 pr-2 pl-4 text-base font-bold shadow-relief",
        classes,
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icone}
      </span>
      <p className="min-w-0 flex-1">{children}</p>
      {onClose ? (
        <IconButton
          label="Fermer le message"
          icone={<X className="size-5" />}
          onClick={onClose}
          className="border-vert-foret bg-creme text-vert-foret"
        />
      ) : null}
    </div>
  );
}

/** Pile de messages en bas d'écran : region annoncée poliment, sans voler le focus. */
export function ZoneToasts({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 *:pointer-events-auto", className)}>
      {children}
    </div>
  );
}
