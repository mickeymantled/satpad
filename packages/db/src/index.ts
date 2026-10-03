import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * from "./schema";
export type Db = NodePgDatabase<typeof schema>;

export const DEFAULT_LOCAL_DATABASE_URL = "postgres://satpad:satpad@127.0.0.1:55433/satpad";

/** Creates a pooled Drizzle client. Callers own the pool's lifetime (`close`). */
export function connect(url = process.env["DATABASE_URL"] ?? DEFAULT_LOCAL_DATABASE_URL): { db: Db; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: url, max: 5 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
