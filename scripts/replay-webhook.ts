import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { FLUTTERWAVE_WEBHOOK_HEADER } from "../apps/cloud/src/billing/flutterwave.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const cloudEnvPath = path.join(repoRoot, "apps", "cloud", ".env")

function loadEnvMap(filePath: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!existsSync(filePath)) return result
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eqIdx = line.indexOf("=")
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    let value = line.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && value) result[key] = value
  }
  return result
}

async function main() {
  const [txRef, transactionId] = process.argv.slice(2)
  if (!txRef || !transactionId) {
    console.error("Usage: bun scripts/replay-webhook.ts <tx_ref> <flutterwave_transaction_id>")
    process.exit(1)
  }

  const fileEnv = loadEnvMap(cloudEnvPath)
  const apiUrl = (process.env.API_URL || fileEnv.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "")
  const webhookHash = process.env.FLW_WEBHOOK_HASH || fileEnv.FLW_WEBHOOK_HASH || ""

  if (!webhookHash) {
    console.error("FLW_WEBHOOK_HASH is not set in environment or apps/cloud/.env")
    process.exit(1)
  }

  const payload = {
    event: "charge.completed",
    data: {
      id: Number.isNaN(Number(transactionId)) ? transactionId : Number(transactionId),
      tx_ref: txRef,
      status: "successful",
    },
  }

  const response = await fetch(`${apiUrl}/webhooks/flutterwave`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [FLUTTERWAVE_WEBHOOK_HEADER]: webhookHash,
    },
    body: JSON.stringify(payload),
  })

  const text = await response.text()
  console.log(`POST ${apiUrl}/webhooks/flutterwave -> ${response.status}`)
  console.log(text)
  if (!response.ok) {
    process.exit(1)
  }
}

await main()
