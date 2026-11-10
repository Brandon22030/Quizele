import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { z } from "astro/zod";
import { gameModeSchema, questionKindSchema } from "../../../shared/protocol";
import { LOCAL_USER, createLocalGame } from "../../../server/game/local";
import { launchGame } from "../../../server/game/launch";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const questionSchema = z.object({
  kind: questionKindSchema,
  prompt: z.string().min(1),
  durationSec: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(60)]),
  reference: z.string().optional(),
  explanation: z.string().optional(),
  options: z.array(z.object({ label: z.string().min(1), isCorrect: z.boolean() })).min(2).max(4),
});

const bodySchema = z.object({
  mode: gameModeSchema.default("together"),
  shuffle: z.boolean().default(false),
  showCorrectAnswer: z.boolean().default(true),
  // Les questions viennent de l'appelant : aucun contenu de démonstration ne part dans le bundle de production.
  questions: z.array(questionSchema).min(1).max(50).optional(),
  // Relance un quiz déjà créé : isole le coût de partie.lancer de celui de la création du quiz.
  quizId: z.string().min(1).optional(),
});

function localToolsEnabled(): boolean {
  // LOCAL_TOOLS n'est déclaré que dans les vars locales (wrangler.jsonc, QZ-002-18) : preview et production ne l'ont pas.
  const flag = (env as unknown as Record<string, string | undefined>).LOCAL_TOOLS;
  if (flag !== "true" || env.MAIL_TRANSPORT !== "console") return false;
  try {
    return LOCAL_HOSTS.has(new URL(env.BETTER_AUTH_URL).hostname);
  } catch {
    return false;
  }
}

// Comparaison en temps constant : verify() compare les deux condensats HMAC sans court-circuit.
async function sameSecret(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(provided));
  return crypto.subtle.verify("HMAC", key, mac, encoder.encode(expected));
}

// Outil du script de charge : crée une partie sans passer par un compte. Réservé au développement local : trois
// conditions cumulées (LOCAL_TOOLS, transport de courriel « console », BETTER_AUTH_URL en localhost), et l'appelant
// doit en plus présenter PLAYER_TOKEN_SECRET, qui permettrait déjà de forger tous les jetons.
export const POST: APIRoute = async ({ request }) => {
  const secret = env.PLAYER_TOKEN_SECRET;
  if (!localToolsEnabled() || !secret || !(await sameSecret(request.headers.get("x-local-secret") ?? "", secret))) {
    return new Response(null, { status: 404 });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const { questions, quizId, ...settings } = body.data;
  const headers = { "Cache-Control": "no-store" };
  if (quizId) return Response.json(await launchGame(env, LOCAL_USER, quizId, { unlimited: true }), { status: 201, headers });
  if (!questions) return Response.json({ error: "invalid_body" }, { status: 400 });
  const game = await createLocalGame(env, {
    title: "Partie locale",
    ...settings,
    questions: questions.map((question, i) => ({
      ...question,
      id: `g${i}`,
      options: question.options.map((option, j) => ({ ...option, id: `g${i}o${j}` })),
    })),
  });
  return Response.json(game, { status: 201, headers });
};
