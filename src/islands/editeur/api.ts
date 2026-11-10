import { actions } from "astro:actions";
import { ErreurApi, avecDelaiMax, type EditeurApi } from "./file-enregistrement";
import type { QuizServeur } from "./modele";

const MESSAGE_RESEAU = "Connexion perdue. Vérifie ton réseau puis réessaie.";

interface Resultat<T> {
  data?: T;
  error?: { code: string; message: string };
}

// Un fetch qui échoue lève une exception (réseau coupé) ; une réponse d'erreur du serveur arrive dans `error`.
async function appeler<T>(requete: Promise<Resultat<T>>): Promise<T> {
  let resultat: Resultat<T>;
  try {
    resultat = await avecDelaiMax(requete, MESSAGE_RESEAU);
  } catch {
    throw new ErreurApi(MESSAGE_RESEAU, { reseau: true });
  }
  if (resultat.error) throw new ErreurApi(resultat.error.message, { code: resultat.error.code });
  return resultat.data as T;
}

export const apiEditeur: EditeurApi = {
  creer: (title) => appeler(actions.quiz.creer({ title })),
  async majTitre(quizId, title) {
    await appeler(actions.quiz.majReglages({ quizId, title }));
  },
  ajouterQuestion: (quizId, question) => appeler(actions.quiz.ajouterQuestion({ quizId, question })),
  async majQuestion(questionId, question) {
    await appeler(actions.quiz.majQuestion({ questionId, question }));
  },
  async supprimerQuestion(questionId) {
    await appeler(actions.quiz.supprimerQuestion({ questionId }));
  },
  async reordonner(quizId, questionIds) {
    await appeler(actions.quiz.reordonner({ quizId, questionIds }));
  },
};

export async function chargerQuiz(quizId: string): Promise<QuizServeur> {
  const { quiz } = await appeler(actions.quiz.charger({ quizId }));
  return quiz;
}
