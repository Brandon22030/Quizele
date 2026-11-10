import { BookOpen } from "lucide-react";
import { Papier } from "../ui/papier";

interface Props {
  explanation?: string;
  reference?: string;
}

// Rien à afficher sans explication ni référence : pas de papier vide.
export function Explication({ explanation, reference }: Props) {
  if (!explanation && !reference) return null;
  return (
    <Papier>
      <p className="text-sm font-extrabold text-vert-mousse">Explication</p>
      {explanation ? <p className="mt-1 font-semibold">{explanation}</p> : null}
      {reference ? (
        <p className="mt-3">
          <span className="inline-flex min-h-10 items-center gap-2 rounded-pill bg-vert-foret px-4 py-1 font-affiche text-base tracking-wide text-jaune-soleil">
            <BookOpen aria-hidden="true" className="size-5" />
            {reference}
          </span>
        </p>
      ) : null}
    </Papier>
  );
}
