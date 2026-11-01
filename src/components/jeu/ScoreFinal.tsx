import { Timer } from "lucide-react";
import { Pilule } from "../ui/pilule";
import { formatDuree } from "./formats";

interface Props {
  score: number;
  total: number;
  totalMs: number;
  rank: number;
  playerCount: number;
  message?: string;
}

// Écran f : le score est le seul élément fort, tout le reste reste sobre.
export function ScoreFinal({ score, total, totalMs, rank, playerCount, message }: Props) {
  return (
    <section aria-label="Ton résultat" className="px-4 pt-6 text-center">
      <p className="-rotate-3 font-affiche text-6xl leading-none tabular-nums text-creme text-shadow-affiche">
        <span className="sr-only">{score} sur {total}</span>
        <span aria-hidden="true">
          {score}
          <span className="text-4xl text-jaune-soleil">/{total}</span>
        </span>
      </p>
      <p className="mt-2 font-affiche text-xl">bonnes réponses</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Pilule variante="creme">
          <Timer aria-hidden="true" className="size-5" />
          Temps : {formatDuree(totalMs)}
        </Pilule>
        <Pilule variante="soleil">
          Rang : {rank} / {playerCount}
        </Pilule>
      </div>
      {message ? <p className="mt-5 font-note text-xl">{message}</p> : null}
    </section>
  );
}
