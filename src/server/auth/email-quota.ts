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
