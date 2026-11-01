export const LAUNCH_QUOTA_PER_HOUR = 20;

const HOUR_MS = 60 * 60 * 1000;

// Plafond de lancements par heure et par animateur, en une seule instruction D1 atomique (même principe que
// consumeDailyMailQuota) : au plafond, la clause WHERE de l'upsert écarte la mise à jour et SQLite ne renvoie aucune
// ligne, donc deux lancements simultanés ne peuvent pas dépasser le plafond ensemble.
// Les compteurs des heures passées de cet animateur partent dans le même batch, par plage de clés (comparaison binaire,
// donc sensible à la casse, contrairement à LIKE) : les clés de la forme `partie-lancer:<id>:<heure>` d'un même
// identifiant se suivent, et l'heure courante borne la plage.
export async function consumeLaunchQuota(d1: D1Database, userId: string, now = Date.now(), max = LAUNCH_QUOTA_PER_HOUR): Promise<boolean> {
  const hour = new Date(Math.floor(now / HOUR_MS) * HOUR_MS).toISOString().slice(0, 13);
  const prefix = `partie-lancer:${userId}:`;
  const key = `${prefix}${hour}`;
  const [upsert] = await d1.batch<{ accepted: number }>([
    d1
      .prepare(
        `INSERT INTO quota (key, count, updated_at) VALUES (?1, 1, ?3)
         ON CONFLICT (key) DO UPDATE SET count = count + 1, updated_at = ?3 WHERE count < ?2
         RETURNING 1 AS accepted`,
      )
      .bind(key, max, now),
    d1.prepare("DELETE FROM quota WHERE key >= ?1 AND key < ?2").bind(prefix, key),
  ]);
  return upsert?.results[0]?.accepted === 1;
}
