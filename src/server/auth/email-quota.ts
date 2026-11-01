// Compteur par clé dans la table rate_limit de Better Auth, en une seule instruction D1 atomique :
// la fenêtre repart à zéro une fois écoulée, sinon le compteur monte jusqu'au plafond.
// Au plafond, la clause WHERE de l'upsert écarte la mise à jour : SQLite ne renvoie alors aucune ligne.
// L'acceptation se lit donc sur la présence de la ligne, jamais sur un horodatage (deux demandes peuvent
// partager la même milliseconde).
export async function consumeEmailQuota(
  d1: D1Database,
  key: string,
  rule: { window: number; max: number },
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - rule.window * 1000;
  const row = await d1
    .prepare(
      `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN last_request <= ?4 THEN 1 ELSE count + 1 END,
         last_request = ?3
       WHERE last_request <= ?4 OR count < ?5
       RETURNING 1 AS accepted`,
    )
    .bind(crypto.randomUUID(), key, now, windowStart, rule.max)
    .first<{ accepted: number }>();
  return row?.accepted === 1;
}

// Une même boîte se cache derrière la casse, des espaces ou un sous-adressage (victime+1@, victime+2@...) :
// la clé de limite les ramène toutes à une seule. L'envoi, lui, garde l'adresse saisie.
export function normalizeEmailKey(email: string): string {
  const compact = email.replace(/\s+/g, "").toLowerCase();
  const at = compact.lastIndexOf("@");
  const local = compact.slice(0, at);
  const plus = local.indexOf("+");
  return `${plus === -1 ? local : local.slice(0, plus)}${compact.slice(at)}`;
}

// Seule l'empreinte est stockée : rate_limit ne doit pas devenir un annuaire d'adresses.
export async function hashEmailKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeEmailKey(email)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const dailyMailQuotaKey = (now: number) => `magic-link:global:${new Date(now).toISOString().slice(0, 10)}`;

// Compteur du jour UTC dans mail_quota, hors de rate_limit (que Better Auth purge après 60 s d'inactivité).
// Même principe que plus haut : au plafond, l'upsert n'écrit rien et ne renvoie aucune ligne.
// Les compteurs des jours passés partent dans le même batch : pas de dépendance au cron.
export async function consumeDailyMailQuota(d1: D1Database, max: number, now = Date.now()): Promise<boolean> {
  const key = dailyMailQuotaKey(now);
  const [upsert] = await d1.batch<{ accepted: number }>([
    d1
      .prepare(
        `INSERT INTO mail_quota (key, count) VALUES (?1, 1)
         ON CONFLICT (key) DO UPDATE SET count = count + 1 WHERE count < ?2
         RETURNING 1 AS accepted`,
      )
      .bind(key, max),
    d1.prepare("DELETE FROM mail_quota WHERE key < ?1").bind(key),
  ]);
  return upsert?.results[0]?.accepted === 1;
}
