import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "./cn";

// Les encoches de perforation sont découpées par un masque : le fond de page (jaune ou forêt) reste visible derrière.
const masquePerfore: CSSProperties = {
  WebkitMask:
    "radial-gradient(circle 12px at 0 50%, transparent 11px, black 12px) left / 51% 100% no-repeat, radial-gradient(circle 12px at 100% 50%, transparent 11px, black 12px) right / 51% 100% no-repeat",
  mask: "radial-gradient(circle 12px at 0 50%, transparent 11px, black 12px) left / 51% 100% no-repeat, radial-gradient(circle 12px at 100% 50%, transparent 11px, black 12px) right / 51% 100% no-repeat",
};

// L'ombre est un filtre sur l'enveloppe : un box-shadow serait coupé par le masque.
const ombreVive: CSSProperties = { filter: "drop-shadow(-6px 6px 0 var(--color-vert-vif))" };

interface TicketProps extends HTMLAttributes<HTMLDivElement> {
  ombre?: boolean;
}

export function Ticket({ ombre = true, className, children, ...rest }: TicketProps) {
  return (
    <div style={ombre ? ombreVive : undefined} className={className} {...rest}>
      <div style={masquePerfore} className={cn("relative rounded-md bg-vert-foret p-6 text-creme")}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-2 rounded-sm border-trait border-dotted border-creme" />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
