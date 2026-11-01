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

// Enveloppe D1 qui trace chaque instruction préparée, ses paramètres liés et la taille de chaque batch().
// Chaque instruction préparée compte pour une requête sur l'offre gratuite, qu'elle soit seule ou dans un batch.
export function spiedDb() {
  const trace = { batches: [] as number[], bound: [] as number[], prepared: 0 };
  const proxy = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          trace.prepared++;
          const stmt = target.prepare(query);
          const bind = stmt.bind.bind(stmt);
          stmt.bind = ((...args: unknown[]) => {
            trace.bound.push(args.length);
            return bind(...args);
          }) as typeof stmt.bind;
          return stmt;
        };
      }
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          trace.batches.push(stmts.length);
          return target.batch(stmts);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
  return { db: getDb(proxy), trace };
}

export const fourOptions = (correct = "a") => ["a", "b", "c", "d"].map((label) => ({ label, isCorrect: label === correct }));
