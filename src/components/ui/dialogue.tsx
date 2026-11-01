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

  // Cible du dernier pointerdown : un glissement qui démarre dans le contenu (sélection de texte) et se relâche sur le voile
  // ne doit pas fermer le dialogue.
  const departClic = useRef<EventTarget | null>(null);

  // Échap déclenche cancel puis close : sans ce garde, le parent serait prévenu deux fois d'une seule fermeture.
  const dejaFerme = useRef(false);
  function demanderFermeture() {
    if (dejaFerme.current) return;
    dejaFerme.current = true;
    onClose();
  }

  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    if (open) dejaFerme.current = false;
    if (open && !dialogue.open) dialogue.showModal();
    if (!open && dialogue.open) dialogue.close();
  }, [open]);

  // Verrou de défilement : le dialogue modal rend la page inerte mais pas immobile, et sur iOS le fond défile derrière le voile.
  useEffect(() => {
    if (!open) return;
    const { body, documentElement } = document;
    const precedent = { body: body.style.overflow, html: documentElement.style.overflow };
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = precedent.body;
      documentElement.style.overflow = precedent.html;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titreId}
      data-papier=""
      // Échap : on laisse l'état parent décider (le dialogue se ferme via la prop open, jamais en douce).
      onCancel={(e) => {
        e.preventDefault();
        demanderFermeture();
      }}
      // Fermeture native (par exemple form method="dialog") : on resynchronise l'état parent.
      onClose={() => {
        if (open) demanderFermeture();
      }}
      onPointerDown={(e) => {
        departClic.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === ref.current && departClic.current === ref.current) demanderFermeture();
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
          <IconButton label="Fermer" icone={<X className="size-5" />} onClick={demanderFermeture} />
        </div>
        {children}
      </div>
    </dialog>
  );
}
