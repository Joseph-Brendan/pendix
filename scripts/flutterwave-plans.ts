import { createFlutterwaveClient } from "../apps/cloud/src/billing/flutterwave.js"
import { syncFlutterwavePlans } from "../apps/cloud/src/billing/plans-sync.js"
import { createDatabase } from "../apps/cloud/src/db/index.js"
import { loadEnv } from "../apps/cloud/src/env.js"

async function main() {
  const env = loadEnv()
  if (!env.FLW_SECRET_KEY) {
    console.error("FLW_SECRET_KEY is not set in environment or apps/cloud/.env")
    process.exit(1)
  }

  const database = createDatabase(env.DATABASE_URL, { max: 1 })
  const flutterwave = createFlutterwaveClient({ secretKey: env.FLW_SECRET_KEY })

  try {
    const result = await syncFlutterwavePlans({
      db: database.db,
      flutterwave,
      ngnPricesJson: env.NGN_PRICES_JSON,
    })

    console.log(
      `Synced ${result.plans.length} Flutterwave payment plans (${result.created} created, ${result.existing} existing):`,
    )
    for (const plan of result.plans) {
      console.log(
        `  - ${plan.plan} ${plan.period} (${plan.currency}, ${plan.amount_cents} minor units): id=${plan.flutterwave_plan_id}${plan.created ? " [created]" : " [existing]"}`,
      )
    }
    if (!env.NGN_PRICES_JSON?.trim()) {
      console.log("Note: NGN_PRICES_JSON is empty; set it to also sync NGN plans.")
    }
  } finally {
    await database.close()
  }
}

await main()
