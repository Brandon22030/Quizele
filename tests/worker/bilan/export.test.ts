import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "../db/helpers";
import { authFetch, captureConsoleMail, ORIGIN, requestMagicLink, sessionCookie } from "../auth/helpers";

beforeEach(async () => {
  await freshDb();
  await env.DB.batch([env.DB.prepare("DELETE FROM rate_limit"), env.DB.prepare("DELETE FROM mail_quota")]);
});
afterEach(() => vi.restoreAllMocks());

async function signIn(email: string) {
  const mail = captureConsoleMail();
  expect((await requestMagicLink(email)).status).toBe(200);
  const link = new URL(mail.link());
  const cookie = sessionCookie(await authFetch(link.pathname + link.search));
  mail.spy.mockRestore();
  expect(cookie).toContain("session_token");
  const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  return { cookie, userId: row!.id };
}

async function insertPartie(ownerId: string, id: string, titre: string, joueurs: [string, number, number][]) {
  const statements = [
    env.DB.prepare(
      "INSERT INTO game_sessions (id, code, owner_id, quiz_id, quiz_title, mode, show_correct_answer, shuffle, status, created_at, ended_at) VALUES (?, 'ABC234', ?, NULL, ?, 'together', 1, 0, 'ended', 1793000000000, 1793003600000)",
    ).bind(id, ownerId, titre),
    env.DB.prepare(
      "INSERT INTO question_stats (id, session_id, position, prompt, correct_labels, reference, answer_count, correct_count, distribution) VALUES (?, ?, 1, 'Q', '[\"Six\"]', NULL, 2, 1, '{}')",
    ).bind(`${id}-q1`, id),
    ...joueurs.map(([pseudo, score, ms], i) =>
      env.DB.prepare("INSERT INTO session_players (id, session_id, pseudo, score, total_time_ms, rank) VALUES (?, ?, ?, ?, ?, ?)").bind(`${id}-j${i}`, id, pseudo, score, ms, i + 1),
    ),
  ];
  await env.DB.batch(statements);
}

const exporter = (id: string, cookie?: string) => SELF.fetch(`${ORIGIN}/partie/${id}/export.csv`, { redirect: "manual", headers: cookie ? { cookie } : {} });

describe("export CSV du bilan", () => {
  it("renvoie un CSV UTF-8 avec BOM, point-virgule, accents et en-têtes privés", async () => {
    const { cookie, userId } = await signIn("anim@example.invalid");
    await insertPartie(userId, "p1", "Les héros de la foi", [["Grâce", 5, 9000], ["Noé", 3, 12500]]);
    const res = await exporter("p1", cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="bilan-les-heros-de-la-foi-2026-1\d-\d\d\.csv"$/);
    const octets = new Uint8Array(await res.arrayBuffer());
    expect([...octets.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texte = new TextDecoder("utf-8", { ignoreBOM: true }).decode(octets);
    expect(texte).toBe("﻿Rang;Pseudo;Score;Questions;Temps total (s)\r\n1;Grâce;5;1;9,0\r\n2;Noé;3;1;12,5\r\n");
  });

  it("échappe les guillemets, points-virgules et retours à la ligne, et neutralise les formules", async () => {
    const { cookie, userId } = await signIn("anim@example.invalid");
    await insertPartie(userId, "p2", "Piège", [
      ['Le "roi"', 4, 1000],
      ["a;b", 3, 1000],
      ["x\ny", 2, 1000],
      ['=HYPERLINK("http://x")', 1, 1000],
      ["@cmd", 1, 1000],
      ["+1", 1, 1000],
      ["-1", 1, 1000],
    ]);
    const texte = await (await exporter("p2", cookie)).text();
    expect(texte).toContain('1;"Le ""roi"""');
    expect(texte).toContain('2;"a;b"');
    expect(texte).toContain('3;"x\ny"');
    expect(texte).toContain(`4;"'=HYPERLINK(""http://x"")"`);
    expect(texte).toContain("5;'@cmd;");
    expect(texte).toContain("6;'+1;");
    expect(texte).toContain("7;'-1;");
  });

  it("répond 404 privé à un autre animateur, sans fuite du contenu", async () => {
    const proprietaire = await signIn("proprio@example.invalid");
    await insertPartie(proprietaire.userId, "p3", "Secret", [["Grâce", 5, 9000]]);
    const autre = await signIn("autre@example.invalid");
    const res = await exporter("p3", autre.cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).not.toContain("Grâce");
  });

  it("répond 404 pour une partie inconnue ou purgée", async () => {
    const { cookie } = await signIn("anim@example.invalid");
    expect((await exporter("inconnue", cookie)).status).toBe(404);
  });

  it("redirige un visiteur non connecté vers la connexion", async () => {
    const res = await exporter("p1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/connexion\?retour=/);
  });

  it("la page de bilan d'un autre animateur est une 404 privée", async () => {
    const proprietaire = await signIn("proprio@example.invalid");
    await insertPartie(proprietaire.userId, "p4", "Secret", [["Grâce", 5, 9000]]);
    const autre = await signIn("autre@example.invalid");
    const res = await SELF.fetch(`${ORIGIN}/partie/p4/bilan`, { redirect: "manual", headers: { cookie: autre.cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).not.toContain("Secret");
  });
});
