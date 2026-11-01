import type { ReactNode } from "react";
import { cx, TRAIT } from "./cx";

type Ton = "foret" | "soleil" | "creme";

const tons: Record<Ton, string> = {
  foret: "bg-vert-foret text-creme",
  soleil: "bg-jaune-soleil text-vert-foret",
  creme: "bg-creme text-vert-foret",
};

interface Props {
  ton?: Ton;
  penchee?: boolean;
  className?: string;
  children: ReactNode;
}

export function Pilule({ ton = "creme", penchee = false, className, children }: Props) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-pill border-vert-foret px-4 py-1 text-sm font-extrabold tabular-nums leading-snug",
        TRAIT,
        tons[ton],
        penchee && "-rotate-4",
        className,
      )}
    >
      {children}
    </span>
  );
}
