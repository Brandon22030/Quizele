import { QUESTION_TYPES, type QuestionType } from "../../shared/quiz-schema";
import { cn } from "../../components/ui/cn";
import { LIBELLES_TYPE } from "./modele";

interface Props {
  valeur: QuestionType;
  onChange: (type: QuestionType) => void;
  // Un groupe radio par question visible : deux groupes à l'écran (liste et formulaire) ne doivent pas partager un nom.
  nom: string;
}

// Pictogramme : une case pleine par bonne réponse possible, sur le nombre de réponses du type.
const PICTOS: Record<QuestionType, boolean[]> = {
  single: [true, false, false],
  multiple: [true, true, false],
  true_false: [true, false],
};

// Radios natifs : les flèches naviguent dans le groupe et l'état coché vient du navigateur. Exactement trois types : aucune
// réponse écrite, ni ici ni ailleurs.
export function ChoixType({ valeur, onChange, nom }: Props) {
  return (
    <fieldset className="grid min-w-0 grid-cols-3 gap-2">
      <legend className="sr-only">Type de question</legend>
      {QUESTION_TYPES.map((type) => (
        <label key={type} className="block min-w-0 cursor-pointer">
          <input type="radio" className="peer sr-only" name={nom} value={type} checked={valeur === type} onChange={() => onChange(type)} />
          <span
            className={cn(
              "flex min-h-20 flex-col items-center justify-center gap-1 rounded-md border-trait border-vert-foret bg-creme p-2 text-center text-sm leading-tight font-extrabold text-vert-foret",
              "peer-checked:bg-vert-foret peer-checked:text-jaune-soleil peer-checked:shadow-relief-vif",
              "peer-focus-visible:outline-trait peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vert-foret",
            )}
          >
            <span aria-hidden="true" className="flex gap-1">
              {PICTOS[type].map((pleine, i) => (
                <i key={i} className={cn("size-4 border-trait border-current", pleine && "bg-current")} />
              ))}
            </span>
            {LIBELLES_TYPE[type]}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
