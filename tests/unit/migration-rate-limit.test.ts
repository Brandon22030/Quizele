import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const statements = (file: string) => readFileSync(new URL(file, dir), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

describe("migration 0001_rate_limit", () => {
  it("vient après 0000 et s'applique sur une base vide", () => {
    expect(files.slice(0, 2)).toEqual([files[0], "0001_rate_limit.sql"]);
    expect(files[0]).toMatch(/^0000_/);
    const db = new DatabaseSync(":memory:");
    for (const file of files) for (const s of statements(file)) db.exec(s);
    const columns = db.prepare("PRAGMA table_info(rate_limit)").all().map((c) => (c as { name: string }).name);
    expect(columns).toEqual(["id", "key", "count", "last_request"]);
    db.prepare("INSERT INTO rate_limit VALUES ('1', 'k', 1, 1)").run();
    expect(() => db.prepare("INSERT INTO rate_limit VALUES ('2', 'k', 1, 1)").run()).toThrow(/UNIQUE/i);
  });

  it("0001 ne s'applique pas seule (elle ne recrée rien d'autre que rate_limit)", () => {
    const sql = statements("0001_rate_limit.sql").join("\n");
    expect(sql).toMatch(/CREATE TABLE `rate_limit`/);
    expect(sql).not.toMatch(/DROP|ALTER/i);
    expect((sql.match(/CREATE TABLE/g) ?? []).length).toBe(1);
  });
});
