import { useState } from "react";
import { actions } from "astro:actions";
import { VueApercu, VueChargement, VueErreur } from "./Vue";
import { MESSAGE_RESEAU, type EtatApercu } from "./logique";

interface Props {
  quizId: string;
  initial: EtatApercu;
}

export default function Apercu({ quizId, initial }: Props) {
  const [etat, setEtat] = useState(initial);

  async function recharger() {
    setEtat({ etat: "chargement" });
    try {
      const { data, error } = await actions.quiz.charger({ quizId });
      if (error) {
        setEtat({ etat: "erreur", message: error.message, reessayable: error.code === "INTERNAL_SERVER_ERROR" });
        return;
      }
      const q = data.quiz;
      setEtat({
        etat: "pret",
        donnees: {
          quizId: q.id,
          title: q.title,
          showCorrectAnswer: q.showCorrectAnswer,
          questions: q.questions.map((question) => ({
            id: question.id,
            type: question.type,
            prompt: question.prompt,
            durationSec: question.durationSec,
            reference: question.reference,
            explanation: question.explanation,
            options: question.options.map((o) => ({ id: o.id, label: o.label, isCorrect: o.isCorrect })),
          })),
        },
      });
    } catch {
      setEtat({ etat: "erreur", message: MESSAGE_RESEAU, reessayable: true });
    }
  }

  if (etat.etat === "chargement") return <VueChargement quizId={quizId} />;
  if (etat.etat === "erreur") return <VueErreur quizId={quizId} message={etat.message} onRetry={etat.reessayable ? () => void recharger() : undefined} />;
  return <VueApercu donnees={etat.donnees} />;
}
