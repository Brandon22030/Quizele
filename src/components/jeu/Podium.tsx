import { Heart } from "lucide-react";
import { Etoile } from "./Etoile";
import { cx, TRAIT } from "./cx";

export interface PlacePodium {
  rank: 1 | 2 | 3;
  pseudo: string;
  isYou?: boolean;
}

interface Props {
  places: PlacePodium[];
  className?: string;
}

const marches = {
  1: { taille: "w-28", hauteur: "h-30", ordre: "order-2", bloc: "border-vert-foret bg-vert-foret shadow-relief-vif", chiffre: "text-4xl text-jaune-soleil text-shadow-affiche-sm" },
  2: { taille: "w-26", hauteur: "h-21", ordre: "order-1", bloc: "border-vert-foret bg-creme shadow-relief-sm", chiffre: "text-3xl" },
  3: { taille: "w-26", hauteur: "h-15.5", ordre: "order-3", bloc: "border-vert-foret bg-jaune-soleil shadow-relief-sm", chiffre: "text-3xl" },
} as const;

// Le DOM suit l'ordre de lecture (1, 2, 3), l'affichage place le premier au centre.
export function Podium({ places, className }: Props) {
  const triees = [...places].sort((a, b) => a.rank - b.rank);
  return (
    <section aria-label="Podium" className={className}>
      <ol className="m-0 flex list-none items-end justify-center gap-2 p-0">
        {triees.map((p) => {
          const m = marches[p.rank];
          return (
            <li key={p.rank} className={cx("flex flex-col items-center text-center", m.ordre, m.taille)}>
              {p.rank === 1 ? (
                <Etoile ton="soleil" className="mx-auto w-11">
                  <Heart aria-hidden="true" className="size-4.5" />
                </Etoile>
              ) : null}
              <p className="w-full text-sm font-bold break-words">
                <span className="sr-only">Place {p.rank} : </span>
                {p.pseudo}
                {p.isYou ? " (toi)" : ""}
              </p>
              <div
                aria-hidden="true"
                className={cx("grid w-full place-items-center rounded-t-sm", TRAIT, m.bloc, m.hauteur)}
              >
                <span className={cx("font-affiche", m.chiffre)}>{p.rank}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="h-trait bg-vert-foret" />
    </section>
  );
}
