import { env } from "cloudflare:workers";
import { getDb, type Db } from "../../../src/server/db/client";
import { user } from "../../../src/server/db/schema";
import type { QuestionInput } from "../../../src/server/db/quizzes";

const migrationFiles = import.meta.glob("../../../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

const TABLES = ["question_stats", "session_players", "game_sessions", "options", "questions", "quizzes", "account", "session", "verification", "user"];

let migrated = false;

// Applique les migrations Drizzle sur le D1 local de miniflare, puis vide les tables entre deux tests.
export async function freshDb(): Promise<Db> {
  if (!migrated) {
    const statements = Object.keys(migrationFiles)
      .sort()
      .flatMap((file) => migrationFiles[file]!.split("--> statement-breakpoint"))
      .map((s) => s.trim())
      .filter(Boolean);
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
    migrated = true;
  }
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  return getDb(env.DB);
}

export async function insertUser(db: Db, id: string): Promise<void> {
  await db.insert(user).values({ id, name: id, email: `${id}@example.invalid` });
}

export const sampleQuestion = (overrides: Partial<QuestionInput> = {}): QuestionInput => ({
  type: "single",
  prompt: "Combien de jours ?",
  durationSec: 20,
  options: [
    { label: "Trois", isCorrect: false },
    { label: "Six", isCorrect: true },
  ],
  ...overrides,
});
