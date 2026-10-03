// Applies ./drizzle migrations. Usage: DATABASE_URL=... pnpm --filter @satpad/db migrate
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connect } from "./index";

export async function runMigrations(url?: string): Promise<void> {
  const { db, close } = connect(url);
  try {
    await migrate(db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });
  } finally {
    await close();
  }
}

if (require.main === module) {
  runMigrations().then(() => console.log("migrations applied")).catch((e) => { console.error(e); process.exit(1); });
}
