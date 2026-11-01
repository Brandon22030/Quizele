import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

type Ton = "creme" | "soleil" | "eclat" | "piment";

const tons: Record<Ton, string> = {
  creme: "bg-creme text-vert-foret",
  soleil: "bg-jaune-soleil text-vert-foret",
  eclat: "bg-vert-eclat text-vert-nuit",
  piment: "bg-piment text-creme",
};

interface Props {
  ton?: Ton;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

// Étoile à contour vert forêt : une étoile pleine sert de bordure, la seconde (rognée de 4 px) porte la couleur.
export function Etoile({ ton = "creme", className, style, children }: Props) {
  return (
    <div className={cx("forme-etoile relative grid aspect-square place-items-center bg-vert-foret", className)} style={style}>
      <span className={cx("forme-etoile absolute inset-1 grid place-items-center text-center", tons[ton])}>{children}</span>
    </div>
  );
}
