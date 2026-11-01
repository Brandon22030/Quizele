import { Heart } from "lucide-react";
import { Forme } from "../ui/forme";
import { cn } from "../ui/cn";

export interface PlacePodium {
  playerId: string;
  rank: 1 | 2 | 3;
  pseudo: string;
  isYou?: boolean;
}

interface Props {
  places: PlacePodium[];
  className?: string;
}

const marches = {
  1: { largeur: "w-marche-large", hauteur: "h-marche-haute", ordre: "order-2", bloc: "bg-vert-foret shadow-relief-vif", chiffre: "text-4xl text-jaune-soleil text-shadow-affiche-sm" },
  2: { largeur: "w-marche", hauteur: "h-marche-moyenne", ordre: "order-1", bloc: "bg-creme shadow-relief-sm", chiffre: "text-3xl" },
  3: { largeur: "w-marche", hauteur: "h-16", ordre: "order-3", bloc: "bg-jaune-soleil shadow-relief-sm", chiffre: "text-3xl" },
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
            <li key={p.playerId} className={cn("flex flex-col items-center text-center", m.ordre, m.largeur)}>
              {p.rank === 1 ? (
                <Forme forme="etoile" variante="soleil" className="mx-auto size-11">
                  <Heart aria-hidden="true" className="size-5" />
                </Forme>
              ) : null}
              <p className="w-full text-sm font-bold break-words">
                <span className="sr-only">Place {p.rank} : </span>
                {p.pseudo}
                {p.isYou ? " (toi)" : ""}
              </p>
              <div
                aria-hidden="true"
                className={cn("grid w-full place-items-center rounded-t-sm border-trait border-vert-foret", m.bloc, m.hauteur)}
              >
                <span className={cn("font-affiche", m.chiffre)}>{p.rank}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="h-trait bg-vert-foret" />
    </section>
  );
}
