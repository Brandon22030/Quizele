import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { consumeDailyMailQuota } from "../../../src/server/auth/email-quota";
import { closeStaleSessions, STALE_SESSION_MS } from "../../../src/server/cron";
import { getDb } from "../../../src/server/db/client";
import { createQuiz } from "../../../src/server/db/quizzes";
import { createGameSession, findActiveSessionByCode } from "../../../src/server/db/sessions";
import { LaunchError, launchGame } from "../../../src/server/game/launch";
import { LAUNCH_QUOTA_PER_HOUR, consumeLaunchQuota } from "../../../src/server/game/quota";
import { OWNER_ID, prepareDb, sessionRow } from "./helpers";

beforeAll(prepareDb);

describe("quota de lancements par heure", () => {
  it("accepte 20 lancements puis refuse, par utilisateur, et repart à l'heure suivante", async () => {
    const now = Date.UTC(2030, 0, 1, 10, 30);
    for (let i = 0; i < LAUNCH_QUOTA_PER_HOUR; i += 1) expect(await consumeLaunchQuota(env.DB, "u1", now)).toBe(true);
    expect(await consumeLaunchQuota(env.DB, "u1", now + 60_000)).toBe(false);
    expect(await consumeLaunchQuota(env.DB, "u2", now)).toBe(true);
    expect(await consumeLaunchQuota(env.DB, "u1", now + 60 * 60 * 1000)).toBe(true);
  });

  it("des lancements simultanés ne dépassent jamais le plafond", async () => {
    const now = Date.UTC(2030, 0, 1, 11, 0);
    const results = await Promise.all(Array.from({ length: 30 }, () => consumeLaunchQuota(env.DB, "u3", now)));
    expect(results.filter(Boolean)).toHaveLength(LAUNCH_QUOTA_PER_HOUR);
  });

  it("ne touche pas à mail_quota : le quota quotidien d'e-mails et celui des lancements sont indépendants", async () => {
    const now = Date.UTC(2030, 0, 2, 9, 0);
    for (let i = 0; i < LAUNCH_QUOTA_PER_HOUR; i += 1) await consumeLaunchQuota(env.DB, "u4", now);
    await consumeDailyMailQuota(env.DB, 100, now);
    expect(await consumeLaunchQuota(env.DB, "u4", now)).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_quota WHERE key LIKE 'partie-lancer:%'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("l'heure suivante efface les compteurs passés de cet animateur, sans toucher à un identifiant qui ne diffère que par la casse", async () => {
    const now = Date.UTC(2030, 0, 3, 8, 0);
    for (let i = 0; i < LAUNCH_QUOTA_PER_HOUR; i += 1) {
      await consumeLaunchQuota(env.DB, "Abc", now);
      await consumeLaunchQuota(env.DB, "abc", now);
    }
    await consumeLaunchQuota(env.DB, "abc", now + 60 * 60 * 1000);
    const keys = (await env.DB.prepare("SELECT key FROM quota WHERE key LIKE 'partie-lancer:_bc:%' ORDER BY key").all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(["partie-lancer:Abc:2030-01-03T08", "partie-lancer:abc:2030-01-03T09"]);
    // Le compteur de « Abc » est intact : toujours au plafond.
    expect(await consumeLaunchQuota(env.DB, "Abc", now)).toBe(false);
  });

  it("partie.lancer refuse le 21e lancement de l'heure avec un message en français, sans créer de partie", async () => {
    const quizId = await createQuiz(getDb(env.DB), OWNER_ID, {
      title: "Quiz",
      questions: [{ type: "single", prompt: "Un ?", durationSec: 20, options: [{ label: "Oui", isCorrect: true }, { label: "Non", isCorrect: false }] }],
    });
    const owner = { id: OWNER_ID, name: null, email: "animateur@example.invalid" };
    for (let i = 0; i < LAUNCH_QUOTA_PER_HOUR; i += 1) await launchGame(env, owner, quizId);
    const error = await launchGame(env, owner, quizId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LaunchError);
    expect((error as LaunchError).code).toBe("TOO_MANY_REQUESTS");
    expect((error as LaunchError).message).toMatch(/Trop de parties/);
    // L'outillage local (script de charge) n'est pas soumis au plafond.
    await expect(launchGame(env, owner, quizId, { unlimited: true })).resolves.toMatchObject({ code: expect.any(String) });
  });
});

describe("cron : clôture des parties abandonnées", () => {
  it("clôture les parties non terminées depuis plus de 48 h et libère leur code, sans toucher aux récentes", async () => {
    const db = getDb(env.DB);
    const quizId = await createQuiz(db, OWNER_ID, {
      title: "Quiz",
      questions: [{ type: "single", prompt: "Un ?", durationSec: 20, options: [{ label: "Oui", isCorrect: true }, { label: "Non", isCorrect: false }] }],
    });
    const base = { ownerId: OWNER_ID, quizId, quizTitle: "Quiz", mode: "together" as const, showCorrectAnswer: true, shuffle: false };
    const old = await createGameSession(db, { id: "ancienne", ...base });
    const recent = await createGameSession(db, { id: "recente", ...base });
    await env.DB.prepare("UPDATE game_sessions SET created_at = ? WHERE id = 'ancienne'").bind(Date.now() - STALE_SESSION_MS - 1000).run();

    await closeStaleSessions(db);
    expect((await sessionRow("ancienne"))?.status).toBe("ended");
    expect(await findActiveSessionByCode(db, old.code)).toBeNull();
    expect((await sessionRow("recente"))?.status).toBe("lobby");
    expect(await findActiveSessionByCode(db, recent.code)).not.toBeNull();
  });
});
