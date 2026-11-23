import { loadEnv } from "../env.js"
import { runMigrations } from "./index.js"

const env = loadEnv()
await runMigrations(env.DATABASE_URL)
console.log("Migrations applied successfully.")
