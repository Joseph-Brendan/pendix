#!/usr/bin/env bun
import fs from "node:fs"
import path from "node:path"

export interface Violation {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly reason: string
}

const ROOT = path.resolve(import.meta.dirname, "..")

const SCAN_TARGETS = [
  "packages/cli/src",
  "packages/tui/src",
  "packages/core/src/session/runner/prompt",
  "packages/core/src/session/to-session-error.ts",
  "packages/core/src/plugin/skill",
  "sdks/vscode/package.json",
  "sdks/vscode/src",
  "install",
  "README.md",
]

const README_ALLOWED_NOTICE = "Pendix is built on OpenCode (MIT licence)."

// Internal technical identifiers, protocol keys, env vars, and compatibility constants
// that are never shown as user-facing product branding.
const INTERNAL_LINE_PATTERNS = [
  /^\s*(?:import|export)\s+.*from\s+["']/,
  /^\s*\/\/|^\s*\/\*|^\s*\*/,
  /\bOPENCODE_[A-Z0-9_]+\b/,
  /@opencode\/pty/,
  /virtual:opencode-app-assets/,
  /x-opencode-/,
  /opencode\.plugin\.v2\./,
  /opencode-pty/,
  /opencode-login/,
  /opencode-debug-/,
  /opencode-local/,
  /opencode\.local/,
  /opencode\/(?:child-session-updates|session\/child_update|compaction|retry)/,
  /opencode\.(?:acp|settings|mode|default|status|btw|diffs|notifications|plugins|storybook|simulation|home|prompt|sidebar)/,
  /\.startsWith\(["']opencode\.["']\)/,
  /integrationID\s*===?\s*["']opencode["']/,
  /providerID\s*===?\s*["']opencode(?:-go)?["']/,
  /\.id\s*===?\s*["']opencode(?:-go)?["']/,
  /["']opencode(?:-go)?["']\s*:/,
  /\[\s*["']opencode(?:-go)?["']\s*,/,
  /opencode-classic/,
  /["']opencode-theme["']/,
  /getOpenCode(?:Classic)?Theme/,
  /username:\s*["']opencode["']/,
  /sourceBinary|opencodeSourceBinary/,
  /client_id:\s*["']opencode/,
  /process\.env\./,
  /opencode-cli-test-/,
  /installedFormula\s*===\s*["']opencode["']/,
  /\["opencode",\s*"opencode-beta"/,
  /anomaly\.opencode_/i,
  /Anomaly\.OpenCode/,
  /opencode2(?:-node)?/,
  /Context\.Service<.*>\(\)\(["']@/,
  /schema\.org|json\.schemastore\.org/,
  /\$schema/,
  /example\.com\/opencode-demo/,
  /tree-sitter-(?:vue|clojure)/,
  /opencode-workerd-profile|opencode-slack|~\/src\/opencode/,
  /new\s+OpenCode|OpenCode\.make|OpenCodeClient|OpenCodeEvent|OpenCodeTools|OpenCodeError/,
  /^\s*OpenCode,?\s*$/,
  /^\s*opencode\??:/,
]

// User-visible patterns that MUST NOT appear anywhere in scanned files (except README notice).
const FORBIDDEN_VISIBLE_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly reason: string }> = [
  { pattern: /["'`][^"'`\n]*\bOpenCode\b[^"'`\n]*["'`]/, reason: "User-visible string containing 'OpenCode'" },
  { pattern: />\s*[^<\n]*\bOpenCode\b[^<\n]*</i, reason: "User-visible JSX text containing 'OpenCode'" },
  { pattern: /^\s*[^/\n]*\bOpenCode\b[^/\n]*</, reason: "User-visible JSX text containing 'OpenCode'" },
  { pattern: /^\s*OpenCode\b/i, reason: "User-visible JSX/text line containing 'OpenCode'" },
  { pattern: /https?:\/\/(?:[a-z0-9-]+\.)*opencode\.ai\b/i, reason: "OpenCode domain URL" },
  { pattern: /https?:\/\/(?:[a-z0-9-]+\.)*opncd\.ai\b/i, reason: "Legacy OpenCode domain URL" },
  {
    pattern: /["'`][^"'`\n]*\bopencode\s+(?:service|upgrade|models|mcp|pair|mini|acp|stats|run|auth|-s)\b/i,
    reason: "User-visible 'opencode' CLI command hint",
  },
  { pattern: /["'`][^"'`\n]*\bRun\s+.*opencode\b/i, reason: "User-visible 'Run opencode' hint" },
  { pattern: /["'`](?:Open|Run)\s+opencode\b/i, reason: "User-visible command title containing 'opencode'" },
  { pattern: /TERMINAL_NAME\s*=\s*["']opencode["']/, reason: "VS Code terminal name still 'opencode'" },
  { pattern: /sendText\(["']opencode["']\)/, reason: "VS Code extension launches 'opencode'" },
  { pattern: /^\s*(?:APP|SOURCE_APP)=opencode\b/, reason: "Install script APP still 'opencode'" },
  {
    pattern: /"name":\s*"opencode"|"displayName":\s*"opencode"|"description":\s*"opencode/i,
    reason: "Extension manifest still branded 'opencode'",
  },
]

function collectFiles(target: string): string[] {
  const full = path.join(ROOT, target)
  if (!fs.existsSync(full)) return []
  const stat = fs.statSync(full)
  if (stat.isFile()) return [full]
  const results: string[] = []
  const stack = [full]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "storybook") continue
        stack.push(entryPath)
      } else if (entry.isFile()) {
        if (/\.(?:test|stories)\.[tj]sx?$/.test(entry.name)) continue
        if (entry.name.endsWith(".json") && target !== "sdks/vscode/package.json") continue
        results.push(entryPath)
      }
    }
  }
  return results.sort()
}

export function checkBranding(): Violation[] {
  const violations: Violation[] = []
  for (const target of SCAN_TARGETS) {
    for (const file of collectFiles(target)) {
      const rel = path.relative(ROOT, file)
      const content = fs.readFileSync(file, "utf8")
      const lines = content.split("\n")

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (!/opencode|opncd\.ai/i.test(line)) continue

        if (rel === "README.md") {
          if (line.trim() === README_ALLOWED_NOTICE) continue
          violations.push({
            file: rel,
            line: i + 1,
            text: line.trim().slice(0, 140),
            reason: "README.md contains OpenCode outside the allowed attribution line",
          })
          continue
        }

        if (rel.endsWith(".txt") || rel.endsWith(".md")) {
          if (/\$\{OPENCODE_[A-Z0-9_]+\}/.test(line)) continue
          violations.push({
            file: rel,
            line: i + 1,
            text: line.trim().slice(0, 140),
            reason: "Prompt/skill markdown contains 'opencode'",
          })
          continue
        }

        if (INTERNAL_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue

        for (const check of FORBIDDEN_VISIBLE_PATTERNS) {
          if (check.pattern.test(line)) {
            violations.push({
              file: rel,
              line: i + 1,
              text: line.trim().slice(0, 140),
              reason: check.reason,
            })
            break
          }
        }
      }
    }
  }
  return violations
}

if (import.meta.main) {
  const violations = checkBranding()
  if (violations.length === 0) {
    console.log("check-branding: OK (0 user-visible OpenCode branding violations)")
    process.exit(0)
  }
  console.error(`check-branding: FAILED (${violations.length} violations found):`)
  for (const v of violations.slice(0, 60)) {
    console.error(`  ${v.file}:${v.line}: [${v.reason}] ${v.text}`)
  }
  if (violations.length > 60) {
    console.error(`  ... and ${violations.length - 60} more`)
  }
  process.exit(1)
}
