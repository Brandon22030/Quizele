import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { env } from "cloudflare:workers";
import { quizActionInputs } from "../shared/quiz-schema";
import { getDb } from "../server/db/client";
import * as handlers from "../server/quiz/handlers";
import { actionFailure } from "../server/quiz/handlers";

type Handler<I, O> = (db: ReturnType<typeof getDb>, user: App.Locals["user"], input: I) => Promise<O>;

// Toute erreur passe par actionFailure : l'utilisateur ne voit que des messages français, jamais une trace interne.
function run<I, O>(name: string, handler: Handler<I, O>) {
  return async (input: I, context: ActionAPIContext): Promise<O> => {
    try {
      return await handler(getDb(env.DB), context.locals.user, input);
    } catch (error) {
      const failure = actionFailure(name, error);
      throw new ActionError({ code: failure.code, message: failure.message });
    }
  };
}

export const quiz = {
  creer: defineAction({ input: quizActionInputs.creer, handler: run("creer", handlers.creer) }),
  dupliquer: defineAction({ input: quizActionInputs.dupliquer, handler: run("dupliquer", handlers.dupliquer) }),
  supprimer: defineAction({ input: quizActionInputs.supprimer, handler: run("supprimer", handlers.supprimer) }),
  majReglages: defineAction({ input: quizActionInputs.majReglages, handler: run("majReglages", handlers.majReglages) }),
  ajouterQuestion: defineAction({ input: quizActionInputs.ajouterQuestion, handler: run("ajouterQuestion", handlers.ajouterQuestion) }),
  majQuestion: defineAction({ input: quizActionInputs.majQuestion, handler: run("majQuestion", handlers.majQuestion) }),
  supprimerQuestion: defineAction({ input: quizActionInputs.supprimerQuestion, handler: run("supprimerQuestion", handlers.supprimerQuestion) }),
  reordonner: defineAction({ input: quizActionInputs.reordonner, handler: run("reordonner", handlers.reordonner) }),
  lister: defineAction({ handler: run("lister", (db, user) => handlers.lister(db, user)) }),
  charger: defineAction({ input: quizActionInputs.charger, handler: run("charger", handlers.charger) }),
};
