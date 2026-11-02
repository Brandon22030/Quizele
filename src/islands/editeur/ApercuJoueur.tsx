import { AnswerTile } from "../../components/jeu/AnswerTile";
import { EnonceQuestion, EnteteQuestion } from "../../components/jeu/EnteteQuestion";
import { LETTRES } from "./TuileReponseEditable";
import type { QuestionBrouillon } from "./modele";

interface Props {
  question: QuestionBrouillon;
  numero: number;
  total: number;
}

// Ce que verra le joueur : les composants de jeu eux-mêmes, en lecture seule. Aucune correction n'y figure, comme en partie.
// Décoratif pour les lecteurs d'écran : le formulaire à côté porte déjà la même information.
export function ApercuJoueur({ question, numero, total }: Props) {
  return (
    <div
      aria-hidden="true"
      className="w-full max-w-xs overflow-hidden rounded-xl border-trait border-vert-nuit bg-jaune-soleil py-4 text-vert-foret"
    >
      <EnteteQuestion index={numero} total={total} />
      <EnonceQuestion prompt={question.prompt.trim() || "Ta question apparaît ici"} kind={question.type} />
      <div className="mt-4 flex flex-col gap-3 px-4 pb-2">
        {question.options.map((o, i) => (
          <AnswerTile key={i} index={i} letter={LETTRES[i] ?? String(i + 1)} label={o.label.trim() || `Réponse ${LETTRES[i] ?? i + 1}`} />
        ))}
      </div>
    </div>
  );
}
