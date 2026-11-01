import type { InputHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "./cn";

interface InterrupteurProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "children"> {
  label: string;
  description?: string;
}

// Case à cocher native exposée en role="switch" : clavier, formulaire et état coché viennent du navigateur,
// le rendu s'appuie sur :has(:checked) donc fonctionne en contrôlé comme en non contrôlé.
export function Interrupteur({ label, description, className, ...rest }: InterrupteurProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <label className={cn("group flex min-h-14 cursor-pointer items-center gap-3", className)}>
      <span className="flex-1">
        <span className="block font-bold">{label}</span>
        {description ? (
          <span id={descriptionId} className="block text-sm font-semibold text-vert-mousse foret:text-creme">
            {description}
          </span>
        ) : null}
      </span>
      <input type="checkbox" role="switch" aria-describedby={descriptionId} className="peer sr-only" {...rest} />
      <span
        aria-hidden="true"
        className={cn(
          "flex h-10 w-16 shrink-0 items-center rounded-pill border-trait border-vert-foret bg-creme px-1",
          "group-has-checked:justify-end group-has-checked:bg-vert-eclat",
          "peer-focus-visible:outline-trait peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vert-foret",
          "foret:peer-focus-visible:outline-jaune-soleil",
          "group-has-disabled:cursor-not-allowed group-has-disabled:border-dashed",
        )}
      >
        <span className="size-6 rounded-full bg-vert-foret group-has-checked:bg-vert-nuit" />
      </span>
    </label>
  );
}
