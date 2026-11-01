import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const champ =
  "w-full rounded-md border-trait bg-creme px-4 text-lg font-bold text-vert-foret placeholder:font-semibold placeholder:text-vert-mousse " +
  "disabled:cursor-not-allowed disabled:border-dashed disabled:text-vert-mousse " +
  "in-data-foret:focus-visible:outline-jaune-soleil";

interface InvalidProps {
  invalide?: boolean;
}

export function Input({ invalide = false, className, ...rest }: InvalidProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      aria-invalid={invalide || undefined}
      className={cn(champ, "min-h-14", invalide ? "border-piment" : "border-vert-foret", className)}
      {...rest}
    />
  );
}

export function Textarea({ invalide = false, className, ...rest }: InvalidProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      aria-invalid={invalide || undefined}
      className={cn(champ, "min-h-20 py-3", invalide ? "border-piment" : "border-vert-foret", className)}
      {...rest}
    />
  );
}
