import { Papier } from "./Papier";
import { cx } from "./cx";

export interface LigneClassement {
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

const separateur = "color-mix(in srgb, var(--color-vert-foret) 25%, transparent)";

export function Classement({ rows, total, className }: Props) {
  return (
    <Papier className={cx("px-4 py-3", className)}>
      {rows.length === 0 ? (
        <p className="py-2 text-center font-bold">Personne d'autre au classement pour l'instant.</p>
      ) : (
        <ol aria-label="Classement" className="m-0 list-none p-0">
          {rows.map((row, i) => (
            <li
              key={`${row.rank}-${row.pseudo}`}
              className="flex justify-between gap-4 py-2 font-bold"
              style={i < rows.length - 1 ? { borderBottom: `2px dashed ${separateur}` } : undefined}
            >
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
