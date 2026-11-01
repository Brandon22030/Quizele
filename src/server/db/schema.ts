import { relations, sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const QUESTION_TYPES = ["single", "multiple", "true_false"] as const;
export const QUESTION_DURATIONS = [10, 20, 30, 60] as const;
export const GAME_MODES = ["together", "own_pace"] as const;
export const SESSION_STATUSES = ["lobby", "running", "ended"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type QuestionDuration = (typeof QUESTION_DURATIONS)[number];
export type GameMode = (typeof GAME_MODES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
const inList = (column: string, values: readonly (string | number)[]) =>
  sql.raw(`"${column}" IN (${values.map((v) => (typeof v === "number" ? v : `'${v}'`)).join(", ")})`);

// Tables Better Auth (schéma core 1.7.x). Les clés JS restent en camelCase car l'adaptateur Drizzle les
// retrouve par nom de champ ; les colonnes SQL sont en snake_case.
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const quizzes = sqliteTable(
  "quizzes",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    description: text("description"),
    category: text("category"),
    mode: text("mode", { enum: GAME_MODES }).notNull().default("together"),
    showCorrectAnswer: integer("show_correct_answer", { mode: "boolean" }).notNull().default(true),
    shuffle: integer("shuffle", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("quizzes_owner_idx").on(t.ownerId, t.updatedAt),
    check("quizzes_mode_check", inList("mode", GAME_MODES)),
  ],
);

// Aucune colonne de texte libre côté joueur : une réponse est toujours une liste d'options.
export const questions = sqliteTable(
  "questions",
  {
    id: id(),
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: text("type", { enum: QUESTION_TYPES }).notNull(),
    prompt: text("prompt").notNull().default(""),
    durationSec: integer("duration_sec").$type<QuestionDuration>().notNull().default(20),
    reference: text("reference"),
    explanation: text("explanation"),
  },
  (t) => [
    index("questions_quiz_position_idx").on(t.quizId, t.position),
    check("questions_type_check", inList("type", QUESTION_TYPES)),
    check("questions_duration_check", inList("duration_sec", QUESTION_DURATIONS)),
  ],
);

// is_correct ne quitte jamais le serveur : aucune lecture depuis un îlot ou une réponse aux joueurs.
export const options = sqliteTable(
  "options",
  {
    id: id(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull().default(""),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("options_question_position_idx").on(t.questionId, t.position)],
);

// id = sid de la partie (nom du Durable Object) ; code = porte d'entrée courte, réutilisable une fois la partie terminée.
// quiz_id passe à NULL si le quiz est supprimé : le bilan reste lisible grâce au titre figé.
export const gameSessions = sqliteTable(
  "game_sessions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    quizId: text("quiz_id").references(() => quizzes.id, { onDelete: "set null" }),
    quizTitle: text("quiz_title").notNull(),
    mode: text("mode", { enum: GAME_MODES }).notNull(),
    showCorrectAnswer: integer("show_correct_answer", { mode: "boolean" }).notNull(),
    shuffle: integer("shuffle", { mode: "boolean" }).notNull(),
    status: text("status", { enum: SESSION_STATUSES }).notNull().default("lobby"),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [
    uniqueIndex("game_sessions_active_code_idx")
      .on(t.code)
      .where(sql`${t.status} <> 'ended'`),
    index("game_sessions_owner_idx").on(t.ownerId, t.createdAt),
    index("game_sessions_created_idx").on(t.createdAt),
    check("game_sessions_mode_check", inList("mode", GAME_MODES)),
    check("game_sessions_status_check", inList("status", SESSION_STATUSES)),
  ],
);

export const sessionPlayers = sqliteTable(
  "session_players",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    pseudo: text("pseudo").notNull(),
    score: integer("score").notNull().default(0),
    totalTimeMs: integer("total_time_ms").notNull().default(0),
    rank: integer("rank").notNull(),
  },
  (t) => [index("session_players_session_rank_idx").on(t.sessionId, t.rank)],
);

// Agrégats par question, figés à la fin de la partie : pas de ligne par réponse individuelle.
export const questionStats = sqliteTable(
  "question_stats",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    prompt: text("prompt").notNull(),
    correctLabels: text("correct_labels", { mode: "json" }).$type<string[]>().notNull(),
    reference: text("reference"),
    answerCount: integer("answer_count").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    distribution: text("distribution", { mode: "json" }).$type<Record<string, number>>().notNull(),
  },
  (t) => [index("question_stats_session_position_idx").on(t.sessionId, t.position)],
);

export const quizzesRelations = relations(quizzes, ({ many }) => ({ questions: many(questions) }));
export const questionsRelations = relations(questions, ({ one, many }) => ({
  quiz: one(quizzes, { fields: [questions.quizId], references: [quizzes.id] }),
  options: many(options),
}));
export const optionsRelations = relations(options, ({ one }) => ({
  question: one(questions, { fields: [options.questionId], references: [questions.id] }),
}));
export const gameSessionsRelations = relations(gameSessions, ({ many }) => ({
  players: many(sessionPlayers),
  stats: many(questionStats),
}));
export const sessionPlayersRelations = relations(sessionPlayers, ({ one }) => ({
  session: one(gameSessions, { fields: [sessionPlayers.sessionId], references: [gameSessions.id] }),
}));
export const questionStatsRelations = relations(questionStats, ({ one }) => ({
  session: one(gameSessions, { fields: [questionStats.sessionId], references: [gameSessions.id] }),
}));
