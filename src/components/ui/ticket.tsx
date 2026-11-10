import type { HTMLAttributes } from "react";
import { cn } from "./cn";

interface TicketProps extends HTMLAttributes<HTMLDivElement> {
  ombre?: boolean;
}

export function Ticket({ ombre = true, className, children, ...rest }: TicketProps) {
  return (
    <div className={cn(ombre && "ticket-ombre", className)} {...rest}>
      <div className="ticket-perfore relative rounded-md bg-vert-foret p-6 text-creme">
        <span aria-hidden="true" className="pointer-events-none absolute inset-2 rounded-sm border-trait border-dotted border-creme" />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
