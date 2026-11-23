import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Effect, Layer } from "effect"
import { NodeServices } from "@effect/platform-node"
import { Global } from "@pendix/util/global"
import { AppProcess } from "@pendix/util/process"
import { EffectFlock } from "@pendix/util/effect-flock"
import { LayerNode } from "@pendix/util/effect/layer-node"
import { databasePath } from "../src/database-path"
import { Updater } from "../src/services/updater"
import { checkBranding } from "../../../scripts/check-branding"

const ROOT = path.resolve(import.meta.dir, "../../..")
const OPENCODE_DOMAIN = /(?:^|\.)(?:opencode\.ai|opncd\.ai)$/i

function isOpenCodeHost(url: string) {
  try {
    return OPENCODE_DOMAIN.test(new URL(url).hostname)
  } catch {
    return /opencode\.ai|opncd\.ai/i.test(url)
  }
}

describe("Pendix CLI rebrand", () => {
  test("scripts/check-branding.ts finds no user-visible OpenCode strings outside README notice", () => {
    const violations = checkBranding()
    expect(violations).toEqual([])
  })

  test("CLI package is named pendix with pendix bin and internal packages use @pendix/ scope", () => {
    const cliPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/cli/package.json"), "utf8"))
    const corePkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/core/package.json"), "utf8"))
    const tuiPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/tui/package.json"), "utf8"))
    expect(cliPkg.name).toBe("pendix")
    expect(cliPkg.bin).toHaveProperty("pendix")
    expect(corePkg.name).toBe("@pendix/core")
    expect(tuiPkg.name).toBe("@pendix/tui")
  })

  test("CLI --version prints pendix and a version, and --help has no OpenCode references", () => {
    const cliEntry = path.join(ROOT, "packages/cli/src/index.ts")
    const versionResult = Bun.spawnSync([process.execPath, "run", cliEntry, "--version"], {
      cwd: path.join(ROOT, "packages/cli"),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(versionResult.exitCode).toBe(0)
    const versionOut = versionResult.stdout.toString("utf8").trim()
    expect(versionOut).toMatch(/^pendix v\S+/)

    const helpResult = Bun.spawnSync([process.execPath, "run", cliEntry, "--help"], {
      cwd: path.join(ROOT, "packages/cli"),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(helpResult.exitCode).toBe(0)
    expect(helpResult.stdout.toString("utf8").toLowerCase()).not.toContain("opencode")

    const platform = process.platform === "win32" ? "windows" : process.platform
    const binName = process.platform === "win32" ? "pendix.exe" : "pendix"
    const builtBinary = path.join(ROOT, "packages/cli/dist", `cli-${platform}-${process.arch}`, "bin", binName)
    if (fs.existsSync(builtBinary)) {
      const binVersion = Bun.spawnSync([builtBinary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(binVersion.exitCode).toBe(0)
      expect(binVersion.stdout.toString("utf8").trim()).toMatch(/^pendix v\S+/)
    }
  })

  test("config, data, cache, and state directories use pendix", () => {
    expect(path.basename(Global.Path.config)).toBe("pendix")
    expect(path.basename(Global.Path.data)).toBe("pendix")
    expect(path.basename(Global.Path.cache)).toBe("pendix")
    expect(path.basename(Global.Path.state)).toBe("pendix")
    expect(path.basename(databasePath(Global.Path.data))).toMatch(/^pendix.*\.db$/)
  })

  test("with networking stubbed, updater makes no request to any OpenCode domain", async () => {
    const requestedUrls: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      requestedUrls.push(url)
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch

    try {
      const updaterLayer = Updater.layer.pipe(
        Layer.provide(LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, EffectFlock.node]))),
        Layer.provide(NodeServices.layer),
      )
      await Effect.runPromise(
        Effect.gen(function* () {
          const updater = yield* Updater.Service
          const runResult = yield* updater.run()
          expect(runResult).toBeUndefined()
          const checkResult = yield* updater.check()
          expect(checkResult?.type).toBe("unavailable")
        }).pipe(Effect.provide(updaterLayer)),
      )

      const opencodeCalls = requestedUrls.filter(isOpenCodeHost)
      expect(opencodeCalls).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("LICENSE has both OpenCode and Dev and Design HQ copyright lines", () => {
    const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8")
    expect(license).toContain("MIT License")
    expect(license).toContain("Copyright (c) 2025 opencode")
    expect(license).toContain("Copyright (c) 2026 Dev and Design HQ")
  })

  test("README.md includes OpenCode MIT notice and UPSTREAM.md + scripts/upstream-sync.sh exist", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8")
    expect(readme).toContain("Pendix is built on OpenCode (MIT licence).")
    const upstream = fs.readFileSync(path.join(ROOT, "UPSTREAM.md"), "utf8")
    expect(upstream).toContain("git fetch upstream")
    expect(fs.existsSync(path.join(ROOT, "scripts/upstream-sync.sh"))).toBe(true)
  })
})
