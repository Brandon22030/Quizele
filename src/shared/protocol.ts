import { z } from "zod";

// Protocole partagé entre le Durable Object et le navigateur. Une réponse est uniquement une liste
// d'identifiants d'options : aucun champ de texte libre n'existe.

export const QUESTION_KINDS = ["single", "multiple", "true_false"] as const;
export const questionKindSchema = z.enum(QUESTION_KINDS);
export type QuestionKind = z.infer<typeof questionKindSchema>;

export const PSEUDO_MAX_LENGTH = 20;
export const MAX_PLAYERS = 200;
export const MAX_OPTIONS = 8;
// Tolérance reprise de l'existant : latence réseau et décalage d'horloge d'un téléphone.
export const ANSWER_TOLERANCE_MS = 2000;
export const PLAYER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Sous-protocole WebSocket : le jeton voyage dans Sec-WebSocket-Protocol et non dans l'URL (journaux, historique).
export const WS_SUBPROTOCOL = "quizdeszeles.v1";
export const MAX_MESSAGE_BYTES = 2048;

const PSEUDO_RAW_MAX = 200;
const graphemes = new Intl.Segmenter("fr", { granularity: "grapheme" });
// Tout caractère de catégorie C (contrôle, zéro largeur, surcharge de sens d'écriture...) sauf U+200D,
// nécessaire aux emojis composés (famille, drapeaux).
const FORBIDDEN_PSEUDO_CHARS = /[^\P{C}\u200D]/u;

export function normalizePseudo(raw: string): string {
  return raw.normalize("NFKC").trim();
}

// Clé d'unicité : deux pseudos qui ne diffèrent que par la casse sont le même joueur.
export function pseudoKey(pseudo: string): string {
  return normalizePseudo(pseudo).toLocaleLowerCase("fr");
}

export const pseudoSchema = z
  .string()
  .max(PSEUDO_RAW_MAX)
  .transform(normalizePseudo)
  .pipe(
    z
      .string()
      .refine((valeur) => !FORBIDDEN_PSEUDO_CHARS.test(valeur))
      .refine((valeur) => {
        let count = 0;
        for (const _ of graphemes.segment(valeur)) count += 1;
        return count >= 1 && count <= PSEUDO_MAX_LENGTH;
      }),
  );

export const joinRequestSchema = z.object({ pseudo: pseudoSchema });
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const roleSchema = z.enum(["host", "screen", "player"]);
export type Role = z.infer<typeof roleSchema>;

const optionIdsSchema = z.array(z.string().min(1).max(64)).min(1).max(MAX_OPTIONS);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("resume") }),
  z.strictObject({ type: z.literal("answer"), questionId: z.string().min(1).max(64), optionIds: optionIdsSchema }),
  z.strictObject({ type: z.literal("start") }),
  z.strictObject({ type: z.literal("reveal") }),
  z.strictObject({ type: z.literal("next") }),
  z.strictObject({ type: z.literal("kick"), playerId: z.string().min(1).max(64) }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const phaseSchema = z.enum(["lobby", "question", "revealed", "finished"]);
export type Phase = z.infer<typeof phaseSchema>;

// Ne contient jamais la correction : seul `reveal` la porte.
export const questionPayloadSchema = z.object({
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  questionId: z.string(),
  kind: questionKindSchema,
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  startedAt: z.number(),
  durationMs: z.number(),
  serverNow: z.number(),
});
export type QuestionPayload = z.infer<typeof questionPayloadSchema>;

export const rankingEntrySchema = z.object({
  playerId: z.string(),
  pseudo: z.string(),
  score: z.number().int(),
  totalMs: z.number().int(),
});
export type RankingEntry = z.infer<typeof rankingEntrySchema>;

// `correctOptionIds`, `explanation` et `reference` sont absents pour les joueurs et l'écran
// quand le quiz masque la correction.
export const revealPayloadSchema = z.object({
  questionId: z.string(),
  correctOptionIds: z.array(z.string()).optional(),
  explanation: z.string().optional(),
  reference: z.string().optional(),
  // Absent pour les joueurs et l'écran quand la correction est masquée : le classement trahirait la réponse.
  ranking: z.array(rankingEntrySchema).optional(),
  you: z.object({ wasCorrect: z.boolean(), score: z.number().int(), rank: z.number().int() }).optional(),
});
export type RevealPayload = z.infer<typeof revealPayloadSchema>;

export const playerInfoSchema = z.object({ id: z.string(), pseudo: z.string() });
export type PlayerInfo = z.infer<typeof playerInfoSchema>;

export const snapshotSchema = z.object({
  type: z.literal("snapshot"),
  role: roleSchema,
  phase: phaseSchema,
  serverNow: z.number(),
  title: z.string(),
  playerCount: z.number().int(),
  question: questionPayloadSchema.optional(),
  reveal: revealPayloadSchema.optional(),
  ranking: z.array(rankingEntrySchema).optional(),
  me: z
    .object({
      playerId: z.string(),
      pseudo: z.string(),
      // Absent quand la correction est masquée et que la partie n'est pas finie.
      score: z.number().int().optional(),
      answered: z.boolean(),
      answeredOptionIds: z.array(z.string()).optional(),
    })
    .optional(),
  answeredCount: z.number().int().optional(),
  players: z.array(playerInfoSchema).optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const errorCodeSchema = z.enum([
  "invalid_message",
  "forbidden",
  "wrong_phase",
  "unknown_question",
  "invalid_options",
  "unknown_player",
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  snapshotSchema,
  z.object({ type: z.literal("question") }).extend(questionPayloadSchema.shape),
  z.object({ type: z.literal("reveal") }).extend(revealPayloadSchema.shape),
  z.object({ type: z.literal("finished"), ranking: z.array(rankingEntrySchema) }),
  z.object({
    type: z.literal("answer_ack"),
    questionId: z.string(),
    duplicate: z.boolean(),
    late: z.boolean(),
  }),
  z.object({ type: z.literal("answer_count"), questionId: z.string(), count: z.number().int(), total: z.number().int() }),
  z.object({ type: z.literal("player_joined"), player: playerInfoSchema, count: z.number().int() }),
  z.object({ type: z.literal("player_left"), playerId: z.string(), count: z.number().int() }),
  z.object({ type: z.literal("error"), code: errorCodeSchema }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const joinResponseSchema = z.object({ playerId: z.string(), token: z.string() });
export type JoinResponse = z.infer<typeof joinResponseSchema>;
