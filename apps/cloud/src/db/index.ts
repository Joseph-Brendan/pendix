import path from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
export { schema } from "./schema.js"

const currentDir = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(currentDir, "../../migrations")

export interface DatabaseOptions {
  readonly searchPath?: string
  readonly max?: number
}

export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const sql = postgres(connectionString, {
    max: options.max ?? 10,
    onnotice: () => {},
    ...(options.searchPath ? { connection: { search_path: options.searchPath } } : {}),
  })
  const db = drizzle({ client: sql })
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  }
}

export type CloudDatabase = ReturnType<typeof createDatabase>["db"]

export async function runMigrations(
  connectionString: string,
  options: { readonly schemaName?: string; readonly migrationsFolder?: string } = {},
) {
  const folder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER
  const client = createDatabase(connectionString, {
    max: 1,
    searchPath: options.schemaName,
  })
  try {
    await migrate(client.db, {
      migrationsFolder: folder,
      ...(options.schemaName ? { migrationsSchema: options.schemaName } : {}),
    })
  } finally {
    await client.close()
  }
}
