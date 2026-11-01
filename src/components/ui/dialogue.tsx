import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./button";
import { cn } from "./cn";

export interface DialogueProps {
  open: boolean;
  onClose: () => void;
  titre: string;
  children: ReactNode;
  className?: string;
}

/**
 * Base de Feuille et Modal sur l'élément natif <dialog> ouvert en modal : le navigateur fournit le piège de focus,
 * l'inertie du reste de la page, la touche Échap et la restitution du focus à l'élément déclencheur.
 */
export function Dialogue({ open, onClose, titre, children, className, variante }: DialogueProps & { variante: "feuille" | "modal" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titreId = useId();

  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    if (open && !dialogue.open) dialogue.showModal();
    if (!open && dialogue.open) dialogue.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titreId}
      // Échap : on laisse l'état parent décider (le dialogue se ferme via la prop open, jamais en douce).
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "fixed m-0 w-full max-w-none overflow-y-auto border-trait border-vert-foret bg-creme p-0 text-vert-foret backdrop:bg-vert-nuit/55",
        variante === "feuille"
          ? "inset-x-0 top-auto bottom-0 max-h-dvh rounded-t-xl border-b-0"
          : "inset-0 m-auto h-fit max-w-sm rounded-lg shadow-relief-lg",
        className,
      )}
    >
      <div className="flex flex-col gap-4 px-4 pt-3 pb-6">
        {variante === "feuille" ? <span aria-hidden="true" className="mx-auto h-2 w-14 rounded-pill bg-vert-mousse" /> : null}
        <div className="flex items-center gap-3">
          <h2 id={titreId} className="min-w-0 flex-1 font-affiche text-xl leading-tight">
            {titre}
          </h2>
          <IconButton label="Fermer" icone={<X className="size-5" />} onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  );
}
