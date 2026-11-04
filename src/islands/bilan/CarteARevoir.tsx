import { BookOpen } from "lucide-react";
import { Pilule } from "../../components/ui/pilule";
import type { QuestionARevoir } from "./logique";

export function CarteARevoir({ question }: { question: QuestionARevoir }) {
  return (
    <article data-papier="" className="flex flex-col gap-2 rounded-md border-trait border-vert-foret bg-creme p-4 text-vert-foret shadow-relief-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-extrabold break-words">{question.prompt}</h3>
        {/* Un seul paragraphe : un lecteur d'écran annonce « 33 pour cent de bonnes réponses » d'un tenant. */}
        <p className="flex-none text-right">
          <span className="block font-affiche text-xl whitespace-nowrap tabular-nums text-piment">
            {question.taux}
            <span aria-hidden="true">&nbsp;%</span>
            <span className="sr-only"> pour cent</span>
          </span>
          <span className="block text-sm font-semibold text-vert-mousse">de bonnes réponses</span>
        </p>
      </div>
      <p className="text-sm font-semibold text-vert-mousse">
        Bonne réponse : <b className="text-vert-foret">{question.bonneReponse}</b>
      </p>
      {question.reference ? (
        <Pilule className="self-start">
          <BookOpen aria-hidden="true" className="size-4" />
          <span className="sr-only">Référence : </span>
          {question.reference}
        </Pilule>
      ) : null}
    </article>
  );
}
