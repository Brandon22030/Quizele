// Compteur par clé dans la table rate_limit de Better Auth, en une seule instruction D1 atomique :
// la fenêtre repart à zéro une fois écoulée, sinon le compteur monte jusqu'au plafond.
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
         count = CASE WHEN last_request <= ?4 THEN 1 WHEN count < ?5 THEN count + 1 ELSE count END,
         last_request = CASE WHEN last_request <= ?4 OR count < ?5 THEN ?3 ELSE last_request END
       RETURNING count, last_request`,
    )
    .bind(crypto.randomUUID(), key, now, windowStart, rule.max)
    .first<{ count: number; last_request: number }>();
  // Plafond atteint sans nouvelle prise en compte : last_request n'a pas bougé et le compteur n'a pas augmenté.
  return row !== null && row.last_request === now;
}
