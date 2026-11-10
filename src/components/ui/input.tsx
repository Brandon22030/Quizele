import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

// L'état invalide vient d'une seule source, aria-invalid (posé par FormField) : le style le suit, sans prop doublon.
const champ =
  "w-full rounded-md border-trait bg-creme px-4 text-lg font-bold text-vert-foret placeholder:font-semibold placeholder:text-vert-mousse " +
  "border-vert-foret aria-invalid:border-piment disabled:cursor-not-allowed disabled:border-dashed disabled:text-vert-mousse";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(champ, "min-h-14", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(champ, "min-h-20 py-3", className)} {...rest} />;
}
