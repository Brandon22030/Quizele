import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { consumeDailyMailQuota } from "../../../src/server/auth/email-quota";
import { LAUNCH_QUOTA_PER_HOUR, consumeLaunchQuota } from "../../../src/server/game/quota";
import { freshDb } from "../db/helpers";

// QA indépendante : la migration 0003 sur une base vide, et l'étanchéité entre quota de lancement et mail_quota.
beforeAll(freshDb);

describe("table quota (migration 0003)", () => {
  it("existe après application de toutes les migrations sur une base vide, à côté de mail_quota", async () => {
    const names = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('quota', 'mail_quota')").all<{ name: string }>()).results.map((r) => r.name).sort();
    expect(names).toEqual(["mail_quota", "quota"]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM quota").first<{ n: number }>())!.n).toBe(0);
  });

  it("les lancements n'écrivent que dans quota, les e-mails que dans mail_quota", async () => {
    const now = Date.UTC(2031, 5, 1, 12, 0);
    const count = (table: string) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>().then((r) => r!.n);
    const mailBefore = await count("mail_quota");
    for (let i = 0; i < LAUNCH_QUOTA_PER_HOUR; i += 1) await consumeLaunchQuota(env.DB, "qa-user", now);
    expect(await consumeLaunchQuota(env.DB, "qa-user", now)).toBe(false);
    expect(await count("mail_quota")).toBe(mailBefore);
    const quotaBefore = await count("quota");
    await consumeDailyMailQuota(env.DB, 100, now);
    expect(await count("quota")).toBe(quotaBefore);
    expect(await consumeLaunchQuota(env.DB, "qa-user", now)).toBe(false);
  });
});
