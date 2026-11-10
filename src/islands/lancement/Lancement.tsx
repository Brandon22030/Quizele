import { useCallback, useEffect, useRef, useState } from "react";
import { actions } from "astro:actions";
import { memoriserHote, urlPilotage } from "../tableau-de-bord/logique";
import { MESSAGE_RESEAU, type EtatLancement, type QuizLancement } from "./logique";
import { VueLancement } from "./VueLancement";

interface Props {
  quizId: string;
}

function stockageSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Accès refusé : la page de pilotage redemande un jeton hôte à l'action jetonHote.
    return null;
  }
}

export default function Lancement({ quizId }: Props) {
  const [etat, setEtat] = useState<EtatLancement>({ etat: "chargement" });
  const [lancementEnCours, setLancementEnCours] = useState(false);
  const [erreurLancement, setErreurLancement] = useState<string | null>(null);
  // Une réponse tardive d'un ancien chargement ne doit pas écraser un résultat plus récent.
  const generation = useRef(0);

  const charger = useCallback(
    async ({ silencieux = false } = {}) => {
      const courante = ++generation.current;
      if (!silencieux) setEtat({ etat: "chargement" });
      try {
        const { data, error } = await actions.quiz.charger({ quizId });
        if (courante !== generation.current) return;
        if (error) {
          setEtat({ etat: "erreur", message: error.message, introuvable: error.code === "NOT_FOUND" });
          return;
        }
        const quiz: QuizLancement = {
          id: data.quiz.id,
          title: data.quiz.title,
          mode: data.quiz.mode,
          showCorrectAnswer: data.quiz.showCorrectAnswer,
          questions: data.quiz.questions.map((q) => ({
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            durationSec: q.durationSec,
            explanation: q.explanation,
            options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
          })),
        };
        setEtat({ etat: "pret", quiz, status: data.status });
      } catch {
        if (courante === generation.current) setEtat({ etat: "erreur", message: MESSAGE_RESEAU, introuvable: false });
      }
    },
    [quizId],
  );

  useEffect(() => {
    void charger();
  }, [charger]);

  async function lancer() {
    if (lancementEnCours) return;
    setLancementEnCours(true);
    setErreurLancement(null);
    try {
      const { data, error } = await actions.partie.lancer({ quizId });
      if (error) {
        setErreurLancement(error.message);
        setLancementEnCours(false);
        // Quiz modifié depuis un autre onglet : la liste de vérification doit refléter ce que le serveur a vu.
        if (error.code === "BAD_REQUEST") void charger({ silencieux: true });
        return;
      }
      memoriserHote(stockageSession(), data);
      // Le bouton reste en chargement pendant la navigation : un second clic ne lancerait pas une autre partie.
      window.location.assign(urlPilotage(data.sessionId));
    } catch {
      setErreurLancement(MESSAGE_RESEAU);
      setLancementEnCours(false);
    }
  }

  return (
    <VueLancement
      quizId={quizId}
      etat={etat}
      lancementEnCours={lancementEnCours}
      erreurLancement={erreurLancement}
      onLancer={() => void lancer()}
      onReessayer={() => void charger()}
    />
  );
}
