import { getDb } from "./db/client";
import { purgeOldSessions } from "./db/purge";

// Une seule requête groupée vers D1 : reste très en dessous des 50 requêtes et des 10 ms CPU de l'offre gratuite.
export async function runScheduled(env: Env): Promise<void> {
  await purgeOldSessions(getDb(env.DB));
}
