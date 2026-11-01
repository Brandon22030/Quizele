import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

export const getDb = (d1: D1Database) => drizzle(d1, { schema });

export type Db = ReturnType<typeof getDb>;

// D1 refuse plus de 100 paramètres liés par requête : on découpe les insertions multi-lignes en conséquence.
export const D1_MAX_BOUND_PARAMS = 100;

export function chunkRows<T>(rows: readonly T[], columnCount: number): T[][] {
  const size = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / columnCount));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

// db.batch() exige un tuple non vide ; les appelants construisent une liste dynamique.
export async function runBatch(db: Db, statements: BatchItem<"sqlite">[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
