import { useState } from "react";
import { Check, Play } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EtatErreur } from "../../components/ui/etat-erreur";
import { Papier } from "../../components/ui/papier";
import { Pilule } from "../../components/ui/pilule";
import { MenuCarte } from "./MenuCarte";
import { dateCourte, libelleQuestions, urlEditeur, type ErreurLancement, type QuizCarte } from "./logique";

interface CarteQuizProps {
  quiz: QuizCarte;
  lancementEnCours: boolean;
  erreur: ErreurLancement | null;
  onLancer: () => void;
  onDupliquer: () => void;
  onSupprimer: () => void;
}

export function CarteQuiz({ quiz, lancementEnCours, erreur, onLancer, onDupliquer, onSupprimer }: CarteQuizProps) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const { ready, label } = quiz.status;
  return (
    // Un menu ouvert déborde sur la carte suivante : la carte monte d'un cran le temps de l'ouverture.
    <Papier className={menuOuvert ? "z-20" : undefined}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Pilule variante={ready ? "foret" : "soleil"} className="text-xs">
            {ready ? <Check aria-hidden="true" className="size-4" /> : null}
            {label}
          </Pilule>
          <h2 className="mt-2 font-affiche text-xl leading-tight break-words">{quiz.title}</h2>
          <p className="text-sm font-semibold text-vert-mousse">
            {libelleQuestions(quiz.questionCount)} - modifié le {dateCourte(quiz.updatedAt)}
          </p>
        </div>
        <MenuCarte quizId={quiz.id} titre={quiz.title} onDupliquer={onDupliquer} onSupprimer={onSupprimer} onOuverture={setMenuOuvert} />
      </div>
      <Button
        bloc
        variante={ready ? "primaire" : "creme"}
        className="mt-4"
        chargement={lancementEnCours}
        libelleChargement={`Lancement de ${quiz.title} en cours`}
        onClick={onLancer}
      >
        <Play aria-hidden="true" className="size-5" />
        Lancer
      </Button>
      {erreur ? (
        <div className="mt-4 flex flex-col gap-3">
          <EtatErreur>{erreur.message}</EtatErreur>
          {erreur.incomplet ? (
            <Button href={urlEditeur(quiz.id)} variante="soleil" taille="petit" className="self-start">
              Compléter le quiz
            </Button>
          ) : null}
        </div>
      ) : null}
    </Papier>
  );
}
