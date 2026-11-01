import { useReducedMotion } from "motion/react";
import { cx, TRAIT } from "./cx";
import { initiale } from "./formats";

interface Props {
  pseudo: string;
  // Vient d'arriver : fond jaune et animation d'apparition.
  nouveau?: boolean;
  className?: string;
}

export function PuceJoueur({ pseudo, nouveau = false, className }: Props) {
  const reduced = useReducedMotion();
  return (
    <span
      className={cx(
        "inline-flex min-h-10 items-center gap-2 rounded-pill border-vert-foret py-0 pr-3 pl-1 text-sm font-extrabold",
        TRAIT,
        nouveau ? "bg-jaune-soleil" : "bg-creme",
        nouveau && !reduced && "animate-pop",
        className,
      )}
    >
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-vert-foret font-affiche text-sm text-jaune-soleil">
        {initiale(pseudo)}
      </span>
      {pseudo}
    </span>
  );
}

// Puce de débordement : « + 5 autres ».
export function PuceReste({ count }: { count: number }) {
  return (
    <span className={cx("inline-flex min-h-10 items-center rounded-pill border-vert-foret px-3 text-sm font-extrabold", TRAIT)}>
      + {count} {count > 1 ? "autres" : "autre"}
    </span>
  );
}

interface ListeProps {
  players: { id: string; pseudo: string }[];
  // Pseudo du dernier arrivé, mis en avant.
  newestId?: string;
  max?: number;
  label?: string;
}

export function ListeJoueurs({ players, newestId, max = 7, label = "Joueurs présents" }: ListeProps) {
  const visibles = players.slice(0, max);
  const reste = players.length - visibles.length;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {visibles.map((p) => (
        <li key={p.id}>
          <PuceJoueur pseudo={p.pseudo} nouveau={p.id === newestId} />
        </li>
      ))}
      {reste > 0 ? (
        <li>
          <PuceReste count={reste} />
        </li>
      ) : null}
    </ul>
  );
}
