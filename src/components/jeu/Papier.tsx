import type { ReactNode } from "react";
import { cx } from "./cx";

interface Props {
  className?: string;
  children: ReactNode;
}

// Les deux bords déchirés sont des éléments décoratifs : le masque ne doit pas rogner le contenu.
export function Papier({ className, children }: Props) {
  return (
    <div className={cx("relative my-3 bg-creme text-vert-foret", className)}>
      <span aria-hidden="true" className="bord-dechire absolute inset-x-0 bottom-full h-3 translate-y-px bg-creme" />
      {children}
      <span
        aria-hidden="true"
        className="bord-dechire absolute inset-x-0 top-full h-3 -translate-y-px -scale-y-100 bg-creme"
      />
    </div>
  );
}
