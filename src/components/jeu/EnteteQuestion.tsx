import type { QuestionKind } from "../../shared/protocol";
import { Papier } from "../ui/papier";
import { Pilule } from "../ui/pilule";
import { libelleJustes } from "./formats";

interface EnteteProps {
  index: number;
  total: number;
  // Absent quand la correction est masquée : le score trahirait la justesse des réponses.
  score?: number;
}

export function EnteteQuestion({ index, total, score }: EnteteProps) {
  return (
    <header className="flex items-center justify-between px-4 pt-2">
      <Pilule variante="foret" inclinaison="gauche">
        Question {index} sur {total}
      </Pilule>
      {score === undefined ? null : (
        <Pilule variante="creme">
          <span className="sr-only">Ton score : </span>
          {libelleJustes(score)}
        </Pilule>
      )}
    </header>
  );
}

interface EnonceProps {
  prompt: string;
  kind: QuestionKind;
}

const consignes: Record<QuestionKind, string | null> = {
  single: null,
  true_false: null,
  multiple: "Plusieurs réponses sont justes : choisis-les toutes, puis valide.",
};

export function EnonceQuestion({ prompt, kind }: EnonceProps) {
  const consigne = consignes[kind];
  return (
    <Papier className="mx-4 mt-5 px-4 py-5">
      <h1 className="font-affiche text-2xl">{prompt}</h1>
      {consigne ? <p className="mt-3 text-sm font-bold text-vert-mousse">{consigne}</p> : null}
    </Papier>
  );
}
