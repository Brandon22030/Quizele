import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { cn } from "../../components/ui/cn";
import { estComplete, type QuestionBrouillon } from "./modele";

interface Props {
  questions: readonly QuestionBrouillon[];
  courante: string | null;
  onSelect: (key: string) => void;
  onAjouter: () => void;
  peutAjouter: boolean;
}

// Pastilles numérotées : la courante en forêt, une pastille orange sur celles à compléter. Le défilement horizontal garde les
// 44 px de chaque pastille quand le quiz compte beaucoup de questions.
export function NavQuestions({ questions, courante, onSelect, onAjouter, peutAjouter }: Props) {
  const courantRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    courantRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [courante]);

  return (
    <nav aria-label="Questions" className="flex gap-2 overflow-x-auto px-4 pt-3 pb-3">
      {questions.map((q, i) => {
        const active = q.key === courante;
        const incomplete = !estComplete(q);
        return (
          <button
            key={q.key}
            ref={active ? courantRef : undefined}
            type="button"
            onClick={() => onSelect(q.key)}
            aria-current={active ? "step" : undefined}
            aria-label={`Question ${i + 1}${incomplete ? ", à compléter" : ""}`}
            className={cn(
              "relative grid size-11 shrink-0 place-items-center rounded-sm border-trait border-vert-foret bg-creme font-affiche text-lg text-vert-foret",
              active && "bg-vert-foret text-jaune-soleil shadow-relief-vif",
            )}
          >
            {i + 1}
            {incomplete ? (
              <span aria-hidden="true" className="absolute -top-1 -right-1 size-4 rounded-full border-trait border-vert-foret bg-mangue" />
            ) : null}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAjouter}
        disabled={!peutAjouter}
        aria-label="Ajouter une question"
        className="grid size-11 shrink-0 place-items-center rounded-sm border-trait border-dashed border-vert-foret text-vert-foret disabled:cursor-not-allowed disabled:text-vert-mousse"
      >
        <Plus aria-hidden="true" className="size-5" />
      </button>
    </nav>
  );
}
