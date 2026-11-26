import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { eq } from "drizzle-orm"
import { getCreditBalance, insertCreditEntry } from "../apps/cloud/src/credits.js"
import { createDatabase } from "../apps/cloud/src/db/index.js"
import { schema } from "../apps/cloud/src/db/schema.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const cloudEnvPath = path.join(repoRoot, "apps", "cloud", ".env")

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim()
  }
  if (existsSync(cloudEnvPath)) {
    const raw = readFileSync(cloudEnvPath, "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      if (key !== "DATABASE_URL") continue
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (value) return value
    }
  }
  throw new Error("DATABASE_URL is not set in environment or apps/cloud/.env")
}

async function main() {
  const [rawEmail, rawAmount] = process.argv.slice(2)
  const email = rawEmail?.trim().toLowerCase()
  const amount = Number(rawAmount)

  if (!email || !Number.isInteger(amount) || amount <= 0) {
    console.error("Usage: bun scripts/grant-credits.ts <email> <positive-integer-amount>")
    process.exit(1)
  }

  const databaseUrl = loadDatabaseUrl()
  const client = createDatabase(databaseUrl, { max: 1 })

  try {
    const [user] = await client.db
      .select({ id: schema.users.id, display_name: schema.users.display_name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, email))

    if (!user) {
      console.error(`User not found: ${email}`)
      process.exit(1)
    }

    await insertCreditEntry(client.db, {
      userId: user.id,
      amount,
      reason: "admin_grant",
      referenceId: "cli:grant-credits",
    })

    const balance = await getCreditBalance(client.db, user.id)
    console.log(`Granted ${amount} credits to ${user.display_name} (${user.email}). New balance: ${balance}.`)
  } finally {
    await client.close()
  }
}

await main()
