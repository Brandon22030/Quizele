import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { z } from "astro/zod";
import { gameModeSchema } from "../../../shared/protocol";
import { quizDemo } from "../../../server/game/fixtures/quiz-demo";
import { LOCAL_USER, createLocalGame } from "../../../server/game/local";
import { launchGame } from "../../../server/game/launch";
import type { QuizQuestion } from "../../../server/game/quiz";

const bodySchema = z.object({
  mode: gameModeSchema.default("together"),
  shuffle: z.boolean().default(false),
  showCorrectAnswer: z.boolean().default(true),
  questions: z.number().int().min(1).max(50).default(3),
  // Relance un quiz déjà créé : isole le coût de partie.lancer de celui de la création du quiz.
  quizId: z.string().min(1).optional(),
});

// Outil du script de charge : crée une partie sans passer par un compte. Réservé au développement local :
// MAIL_TRANSPORT vaut "console" uniquement dans les vars locales (preview et production envoient par Resend), et
// l'appelant doit en plus présenter PLAYER_TOKEN_SECRET, qui permettrait déjà de forger tous les jetons.
export const POST: APIRoute = async ({ request }) => {
  const secret = env.PLAYER_TOKEN_SECRET;
  if (env.MAIL_TRANSPORT !== "console" || !secret || request.headers.get("x-local-secret") !== secret) {
    return new Response(null, { status: 404 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const { questions, quizId, ...settings } = body.data;
  if (quizId) return Response.json(await launchGame(env, LOCAL_USER, quizId), { status: 201, headers: { "Cache-Control": "no-store" } });
  const generated: QuizQuestion[] = Array.from({ length: questions }, (_, i) => quizDemo.questions[i % quizDemo.questions.length]!);
  const game = await createLocalGame(env, { title: "Partie locale", ...settings, questions: generated.map((q, i) => ({ ...q, id: `g${i}` })) });
  return Response.json(game, { status: 201, headers: { "Cache-Control": "no-store" } });
};
