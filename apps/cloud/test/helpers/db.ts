import crypto from "node:crypto"
import postgres from "postgres"
import { createDatabase, runMigrations, type CloudDatabase } from "../../src/db/index.js"
import { loadEnv } from "../../src/env.js"

export interface TestDatabase {
  readonly db: CloudDatabase
  readonly sql: ReturnType<typeof postgres>
  readonly schemaName: string
  readonly close: () => Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const env = loadEnv()
  const connectionString = env.TEST_DATABASE_URL
  const schemaName = `test_${crypto.randomBytes(8).toString("hex")}`

  const admin = postgres(connectionString, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
  } finally {
    await admin.end({ timeout: 5 })
  }

  await runMigrations(connectionString, { schemaName })
  const client = createDatabase(connectionString, { searchPath: schemaName, max: 5 })

  return {
    db: client.db,
    sql: client.sql,
    schemaName,
    close: async () => {
      await client.close()
      const cleanup = postgres(connectionString, { max: 1, onnotice: () => {} })
      try {
        await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      } finally {
        await cleanup.end({ timeout: 5 })
      }
    },
  }
}
