import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env";
import * as schema from "./schema";

const file = env.DATABASE_URL;
if (file !== ":memory:") {
  mkdirSync(dirname(resolve(file)), { recursive: true });
}

export const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// Transactions take the write lock up front (BEGIN IMMEDIATE). A deferred one
// that reads first and then writes fails at once with SQLITE_BUSY_SNAPSHOT
// ("database is locked", no busy wait) whenever another connection, such as
// Litestream, committed in between; an immediate one waits its turn instead.
const transaction = db.transaction.bind(db);
db.transaction = ((run, config) =>
  transaction(run, { behavior: "immediate", ...config })) as typeof db.transaction;
