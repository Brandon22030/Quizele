import { QUESTION_DURATIONS, type QuestionDuration } from "../../shared/quiz-schema";

interface Props {
  valeur: QuestionDuration;
  onChange: (duree: QuestionDuration) => void;
  nom: string;
}

export function PucesDuree({ valeur, onChange, nom }: Props) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-extrabold text-vert-foret">Temps pour répondre</legend>
      <div className="grid grid-cols-4 gap-2">
        {QUESTION_DURATIONS.map((duree) => (
          <label key={duree} className="block cursor-pointer">
            <input type="radio" className="peer sr-only" name={nom} value={duree} checked={valeur === duree} onChange={() => onChange(duree)} />
            <span className="grid min-h-11 place-items-center rounded-pill border-trait border-vert-foret bg-creme font-affiche text-base text-vert-foret peer-checked:bg-vert-foret peer-checked:text-jaune-soleil peer-focus-visible:outline-trait peer-focus-visible:outline-offset-2 peer-focus-visible:outline-vert-foret">
              {duree} s
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
