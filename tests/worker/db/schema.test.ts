/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, insertUser } from "./helpers";

beforeEach(async () => {
  const db = await freshDb();
  await insertUser(db, "alice");
  await env.DB.prepare("INSERT INTO quizzes (id, owner_id, title, created_at, updated_at) VALUES ('z', 'alice', 't', 0, 0)").run();
});

const insertQuestion = (type: string, duration = 20) =>
  env.DB.prepare("INSERT INTO questions (id, quiz_id, position, type, duration_sec) VALUES (?, 'z', 0, ?, ?)")
    .bind(crypto.randomUUID(), type, duration)
    .run();

describe("schéma D1 : contraintes", () => {
  it("accepte les 3 types de question et refuse tout autre type", async () => {
    for (const type of ["single", "multiple", "true_false"]) await expect(insertQuestion(type)).resolves.toBeDefined();
    await expect(insertQuestion("text")).rejects.toThrow(/CHECK constraint failed/);
    await expect(insertQuestion("written")).rejects.toThrow(/CHECK constraint failed/);
  });

  it("refuse une durée hors 10/20/30/60", async () => {
    await expect(insertQuestion("single", 15)).rejects.toThrow(/CHECK constraint failed/);
  });

  it("n'a aucune colonne de texte libre de joueur", async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%cf_%' AND name NOT LIKE 'sqlite_%'").all<{ name: string }>();
    const columns: string[] = [];
    for (const { name } of tables.results) {
      const info = await env.DB.prepare(`SELECT name FROM pragma_table_info('${name}')`).all<{ name: string }>();
      columns.push(...info.results.map((c) => `${name}.${c.name}`));
    }
    expect(columns).toContain("question_stats.distribution");
    expect(columns.filter((c) => /reponse|texte|saisi|free_text|written/i.test(c))).toEqual([]);
  });

  it("expose les tables Better Auth attendues", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["user", "session", "account", "verification"]));
    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info('user')").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "name", "email", "email_verified", "image", "created_at", "updated_at"]),
    );
  });
});
