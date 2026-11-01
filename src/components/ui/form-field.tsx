import { useId, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "./cn";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FormFieldProps {
  label: string;
  aide?: string;
  erreur?: string;
  className?: string;
  /** Reçoit les attributs à poser sur le contrôle pour lier libellé, aide et erreur. */
  children: (control: FieldControlProps) => ReactNode;
}

export function FormField({ label, aide, erreur, className, children }: FormFieldProps) {
  const id = useId();
  const aideId = aide ? `${id}-aide` : undefined;
  const erreurId = erreur ? `${id}-erreur` : undefined;
  const describedby = [erreurId, aideId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-extrabold">
        {label}
      </label>
      {children({ id, "aria-describedby": describedby, "aria-invalid": erreur ? true : undefined })}
      {aide ? (
        <p id={aideId} className="text-sm font-semibold text-vert-mousse foret:text-creme">
          {aide}
        </p>
      ) : null}
      {erreur ? (
        // Piment sur jaune ne passe pas l'AA : le message vit sur une pastille crème (5,12).
        <p
          id={erreurId}
          role="alert"
          className="flex items-start gap-2 self-start rounded-sm border-trait border-piment bg-creme px-3 py-1 text-sm font-extrabold text-piment"
        >
          <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
