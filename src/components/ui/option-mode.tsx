import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

interface OptionModeProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  titre: string;
  description: string;
}

// Radio natif : les flèches naviguent dans le groupe (même name) sans code. L'état choisi s'affiche via :has(:checked).
export function OptionMode({ titre, description, className, ...rest }: OptionModeProps) {
  return (
    <label className={cn("group block cursor-pointer", className)}>
      <input type="radio" className="peer sr-only" {...rest} />
      <span
        className={cn(
          "flex items-start gap-3 rounded-md border-trait border-vert-foret bg-creme p-4 text-vert-foret",
          "peer-checked:bg-vert-foret peer-checked:text-creme peer-checked:shadow-relief-vif foret:peer-checked:border-creme",
          "peer-focus-visible:outline-trait peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vert-foret",
          "foret:peer-focus-visible:outline-jaune-soleil",
          "peer-disabled:cursor-not-allowed peer-disabled:border-dashed",
        )}
      >
        <span aria-hidden="true" className="mt-1 grid size-pastille-option shrink-0 place-items-center rounded-full border-trait border-current">
          <span className="hidden size-3 rounded-full bg-jaune-soleil group-has-checked:block" />
        </span>
        <span className="block">
          <span className="block font-affiche text-lg leading-tight">{titre}</span>
          <span className="block text-sm font-semibold text-vert-mousse group-has-checked:text-creme">{description}</span>
        </span>
      </span>
    </label>
  );
}
