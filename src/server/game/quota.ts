export const LAUNCH_QUOTA_PER_HOUR = 20;

const HOUR_MS = 60 * 60 * 1000;

// Plafond de lancements par heure et par animateur, en une seule instruction D1 atomique (même principe que
// consumeDailyMailQuota) : au plafond, la clause WHERE de l'upsert écarte la mise à jour et SQLite ne renvoie aucune
// ligne, donc deux lancements simultanés ne peuvent pas dépasser le plafond ensemble.
// Réutilise mail_quota plutôt qu'une nouvelle table : rate_limit est purgée par Better Auth après 60 s, trop court pour
// une heure. Le préfixe de clé « partie-lancer: » trie après « magic-link: », donc le nettoyage par comparaison de clé
// de consumeDailyMailQuota (key < jour courant) ne touche jamais ces compteurs ; les compteurs des heures passées de
// cet animateur partent dans le même batch.
export async function consumeLaunchQuota(d1: D1Database, userId: string, now = Date.now(), max = LAUNCH_QUOTA_PER_HOUR): Promise<boolean> {
  const hour = new Date(Math.floor(now / HOUR_MS) * HOUR_MS).toISOString().slice(0, 13);
  const key = `partie-lancer:${userId}:${hour}`;
  const [upsert] = await d1.batch<{ accepted: number }>([
    d1
      .prepare(
        `INSERT INTO mail_quota (key, count) VALUES (?1, 1)
         ON CONFLICT (key) DO UPDATE SET count = count + 1 WHERE count < ?2
         RETURNING 1 AS accepted`,
      )
      .bind(key, max),
    d1
      .prepare("DELETE FROM mail_quota WHERE key LIKE ?1 AND key < ?2")
      .bind(`partie-lancer:${userId.replace(/[\\%_]/g, "\\$&")}:%`, key),
  ]);
  return upsert?.results[0]?.accepted === 1;
}
