import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  formatGoldenReportMarkdown,
  gradeGoldenPrompts,
  type GoldenPromptItem,
} from "../packages/grader/src/index.js"
import type { GraderTier } from "../packages/shared/src/models.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const goldenPath = path.join(repoRoot, "golden", "golden-prompts.json")
const reportsDir = path.join(repoRoot, "golden", "reports")
const cloudEnvPath = path.join(repoRoot, "apps", "cloud", ".env")

function loadEnvFile(filePath: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  if (!existsSync(filePath)) return parsed
  const raw = readFileSync(filePath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && value.length > 0) {
      parsed[key] = value
    }
  }
  return parsed
}

function parseRequestedTiers(argv: readonly string[]): GraderTier[] {
  const tierFlagIdx = argv.indexOf("--tier")
  if (tierFlagIdx !== -1) {
    const value = argv[tierFlagIdx + 1]
    if (value === "credit" || value === "subscriber") {
      return [value]
    }
    throw new Error(`Invalid --tier value "${value ?? ""}". Expected "credit" or "subscriber".`)
  }
  return ["credit", "subscriber"]
}

function isoDateUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  const tiers = parseRequestedTiers(process.argv.slice(2))
  const fileEnv = loadEnvFile(cloudEnvPath)
  const mergedEnv: Record<string, string | undefined> = {
    ...fileEnv,
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => typeof value === "string" && value.length > 0),
    ),
  }

  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenPromptItem[]
  const workedCount = golden.filter((g) => g.worked_example).length
  const evalCount = golden.length - workedCount
  console.log(`Loaded ${golden.length} golden prompts (skipping ${workedCount} worked examples, grading ${evalCount}).`)

  mkdirSync(reportsDir, { recursive: true })
  const date = isoDateUtc()
  let allPassed = true

  for (const tier of tiers) {
    console.log(`\nRunning golden check for tier: ${tier}...`)
    try {
      const result = await gradeGoldenPrompts(golden, tier, { env: mergedEnv })
      const markdown = formatGoldenReportMarkdown({
        date,
        tier,
        modelsUsed: result.modelsUsed,
        report: result.report,
      })

      const reportPath = path.join(reportsDir, `${date}-${tier}.md`)
      writeFileSync(reportPath, markdown, "utf8")

      console.log(`Saved report to ${path.relative(repoRoot, reportPath)}\n`)
      console.log(markdown)

      if (!result.report.passed) {
        allPassed = false
      }
    } catch (error) {
      allPassed = false
      const message = error instanceof Error ? error.message : String(error)
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ""
      const failureMarkdown = [
        `# Golden Agreement Report: ${tier} (${date})`,
        "",
        "- Status: **ERROR**",
        `- Tier: \`${tier}\``,
        `- Error: ${message}${cause}`,
        "",
      ].join("\n")
      const reportPath = path.join(reportsDir, `${date}-${tier}.md`)
      writeFileSync(reportPath, failureMarkdown, "utf8")
      console.error(`Saved error report to ${path.relative(repoRoot, reportPath)}\n`)
      console.error(failureMarkdown)
    }
  }

  if (!allPassed) {
    process.exitCode = 1
  }
}

await main()
