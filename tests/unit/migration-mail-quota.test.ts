import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const statements = (file: string) => readFileSync(new URL(file, dir), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0002_mail_quota", () => {
  it("vient après 0001 et s'applique sur une base vide", () => {
    expect(files.slice(1, 3)).toEqual(["0001_rate_limit.sql", "0002_mail_quota.sql"]);
    const db = new DatabaseSync(":memory:");
    for (const file of files) for (const s of statements(file)) db.exec(s);
    const columns = db.prepare("PRAGMA table_info(mail_quota)").all().map((c) => (c as { name: string }).name);
    expect(columns).toEqual(["key", "count"]);
    db.prepare("INSERT INTO mail_quota VALUES ('k', 1)").run();
    expect(() => db.prepare("INSERT INTO mail_quota VALUES ('k', 1)").run()).toThrow(/UNIQUE/i);
  });

  it("ne crée que mail_quota, sans rien supprimer ni modifier", () => {
    const sql = statements("0002_mail_quota.sql").join("\n");
    expect(sql).toMatch(/CREATE TABLE `mail_quota`/);
    expect(sql).not.toMatch(/DROP|ALTER|DELETE|UPDATE/i);
    expect((sql.match(/CREATE TABLE/g) ?? []).length).toBe(1);
  });

  it("l'upsert plafonné n'accepte plus rien une fois le maximum atteint", () => {
    const db = new DatabaseSync(":memory:");
    for (const file of files) for (const s of statements(file)) db.exec(s);
    const upsert = db.prepare(
      "INSERT INTO mail_quota (key, count) VALUES (?1, 1) ON CONFLICT (key) DO UPDATE SET count = count + 1 WHERE count < ?2 RETURNING 1 AS accepted",
    );
    const accepted = Array.from({ length: 4 }, () => upsert.get("jour", 3) !== undefined);
    expect(accepted).toEqual([true, true, true, false]);
  });
});
