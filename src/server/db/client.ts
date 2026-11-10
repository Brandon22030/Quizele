import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

export const getDb = (d1: D1Database) => drizzle(d1, { schema });

export type Db = ReturnType<typeof getDb>;

// Offre gratuite D1 : 100 paramètres liés par requête, 50 requêtes par invocation, chaque instruction d'un batch
// comptant pour une requête. Les écritures multi-lignes sont donc découpées au plus près de 100 paramètres.
export const D1_MAX_BOUND_PARAMS = 100;

// fixedParams : paramètres présents une seule fois par instruction (garde, identifiant commun).
export function chunkRows<T>(rows: readonly T[], paramsPerRow: number, fixedParams = 0): T[][] {
  const size = Math.max(1, Math.floor((D1_MAX_BOUND_PARAMS - fixedParams) / paramsPerRow));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

// db.batch() exige un tuple non vide ; les appelants construisent une liste dynamique.
export async function runBatch(db: Db, statements: BatchItem<"sqlite">[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
