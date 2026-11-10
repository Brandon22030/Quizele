import { Papier } from "../ui/papier";
import { cn } from "../ui/cn";

export interface LigneClassement {
  playerId: string;
  rank: number;
  pseudo: string;
  score: number;
  isYou?: boolean;
}

interface Props {
  rows: LigneClassement[];
  total: number;
  className?: string;
}

export function Classement({ rows, total, className }: Props) {
  return (
    <Papier className={cn("px-4 py-3", className)}>
      {rows.length === 0 ? (
        <p className="py-2 text-center font-bold">Personne d'autre au classement pour l'instant.</p>
      ) : (
        <ol aria-label="Classement" className="m-0 list-none divide-y-2 divide-dashed divide-separateur p-0">
          {rows.map((row) => (
            <li key={row.playerId} className="flex justify-between gap-4 py-2 font-bold">
              <span className="min-w-0 break-words">
                <b className="font-affiche font-normal">{row.rank}</b>
                &nbsp; {row.pseudo}
                {row.isYou ? " (toi)" : ""}
              </span>
              <span className="flex-none tabular-nums">
                {row.score} / {total}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Papier>
  );
}
