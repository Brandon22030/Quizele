import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { env } from "cloudflare:workers";
import { quizActionInputs } from "../shared/quiz-schema";
import { getDb } from "../server/db/client";
import * as handlers from "../server/quiz/handlers";
import { toQuizFailure } from "../server/quiz/handlers";

type Handler<I, O> = (db: ReturnType<typeof getDb>, user: App.Locals["user"], input: I) => Promise<O>;

// Toute erreur passe par toQuizFailure : l'utilisateur ne voit que des messages français, jamais une trace interne.
function run<I, O>(handler: Handler<I, O>) {
  return async (input: I, context: ActionAPIContext): Promise<O> => {
    try {
      return await handler(getDb(env.DB), context.locals.user, input);
    } catch (error) {
      const failure = toQuizFailure(error);
      throw new ActionError({ code: failure.code, message: failure.message });
    }
  };
}

export const quiz = {
  creer: defineAction({ input: quizActionInputs.creer, handler: run(handlers.creer) }),
  dupliquer: defineAction({ input: quizActionInputs.dupliquer, handler: run(handlers.dupliquer) }),
  supprimer: defineAction({ input: quizActionInputs.supprimer, handler: run(handlers.supprimer) }),
  majReglages: defineAction({ input: quizActionInputs.majReglages, handler: run(handlers.majReglages) }),
  ajouterQuestion: defineAction({ input: quizActionInputs.ajouterQuestion, handler: run(handlers.ajouterQuestion) }),
  majQuestion: defineAction({ input: quizActionInputs.majQuestion, handler: run(handlers.majQuestion) }),
  supprimerQuestion: defineAction({ input: quizActionInputs.supprimerQuestion, handler: run(handlers.supprimerQuestion) }),
  reordonner: defineAction({ input: quizActionInputs.reordonner, handler: run(handlers.reordonner) }),
  lister: defineAction({ handler: run((db, user) => handlers.lister(db, user)) }),
  charger: defineAction({ input: quizActionInputs.charger, handler: run(handlers.charger) }),
};
