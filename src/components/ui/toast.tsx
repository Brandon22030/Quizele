import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Fermeture automatique en millisecondes (ignorée pour une erreur : elle reste jusqu'à fermeture). */
  duree?: number;
  className?: string;
}

// Le rôle d'annonce appartient aux régions de ZoneToasts : un role posé sur un élément inséré après coup est annoncé de façon
// peu fiable par les lecteurs d'écran.
export function Toast({ variante = "info", children, onClose, duree, className }: ToastProps) {
  // onClose dans un ref : un parent qui passe une fonction neuve à chaque rendu ne relance pas le minuteur.
  const fermer = useRef(onClose);
  fermer.current = onClose;
  // Survol et focus suspendent la fermeture automatique, pour laisser le temps de lire ou d'atteindre le bouton.
  const [suspendu, setSuspendu] = useState(false);
  const automatique = Boolean(duree) && Boolean(onClose) && variante !== "erreur";

  useEffect(() => {
    if (!automatique || suspendu) return;
    const minuteur = setTimeout(() => fermer.current?.(), duree);
    return () => clearTimeout(minuteur);
  }, [automatique, suspendu, duree]);

  const { classes, icone } = variants[variante];
  return (
    <div
      data-papier={variante === "info" ? "" : undefined}
      onPointerEnter={() => setSuspendu(true)}
      onPointerLeave={() => setSuspendu(false)}
      onFocus={() => setSuspendu(true)}
      onBlur={() => setSuspendu(false)}
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
          // Anneau à l'intérieur du bouton, sur son propre fond crème : dehors il tomberait sur le fond vif du toast (moins de 3:1).
          className="border-vert-foret bg-creme text-vert-foret focus-visible:-outline-offset-4 focus-visible:outline-vert-foret"
        />
      ) : null}
    </div>
  );
}

interface ZoneToastsProps {
  /** Messages d'information et de succès : annoncés poliment. */
  statuts?: ReactNode;
  /** Erreurs : annoncées tout de suite. */
  alertes?: ReactNode;
  className?: string;
}

/**
 * Pile de messages en bas d'écran, montée en permanence : les deux régions vides existent avant le premier message,
 * condition pour que les lecteurs d'écran annoncent ensuite leur contenu.
 */
export function ZoneToasts({ statuts, alertes, className }: ZoneToastsProps) {
  return (
    <div className={cn("pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 *:pointer-events-auto", className)}>
      <div role="status" className="flex flex-col gap-2">
        {statuts}
      </div>
      <div role="alert" className="flex flex-col gap-2">
        {alertes}
      </div>
    </div>
  );
}
