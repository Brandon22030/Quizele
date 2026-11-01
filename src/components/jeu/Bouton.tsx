import type { ReactNode } from "react";
import { cx, TRAIT } from "./cx";

type Variante = "primaire" | "soleil" | "creme";

const variantes: Record<Variante, string> = {
  primaire: "bg-vert-foret text-jaune-soleil shadow-relief-vif",
  soleil: "bg-jaune-soleil text-vert-foret shadow-relief",
  creme: "bg-creme text-vert-foret shadow-relief",
};

interface Props {
  variante?: Variante;
  bloc?: boolean;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

// Brique locale en attendant la fusion avec src/components/ui/Button (QZ-002-04).
export function Bouton({ variante = "primaire", bloc = false, disabled = false, href, onClick, className, children }: Props) {
  const classes = cx(
    "inline-flex min-h-14 items-center justify-center gap-2 rounded-md border-vert-foret px-6 font-affiche text-lg tracking-wide whitespace-nowrap no-underline transition-all duration-100",
    TRAIT,
    bloc && "w-full",
    disabled
      ? "cursor-not-allowed border-dashed bg-creme text-vert-mousse"
      : cx(
          variantes[variante],
          "cursor-pointer hover:-translate-y-px hover:translate-x-px active:-translate-x-1 active:translate-y-1 active:shadow-relief-appui",
        ),
    className,
  );
  if (href && !disabled) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
