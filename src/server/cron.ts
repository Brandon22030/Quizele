import { getDb } from "./db/client";
import { purgeOldSessions } from "./db/purge";

// Un seul batch de trois instructions vers D1 : très en dessous des 50 requêtes et des 10 ms CPU de l'offre gratuite.
export async function runScheduled(env: Env): Promise<void> {
  await purgeOldSessions(getDb(env.DB));
}
