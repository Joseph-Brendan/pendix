import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { entitlementsFor } from "@pendix/shared/plans"

// Each isolated home gets its own XDG_CACHE_HOME, where Bun would otherwise keep its transpiler cache,
// so every spawned CLI process would transpile the source from scratch. Share one cache instead.
export const transpilerCache = path.join(os.tmpdir(), "opencode-test-transpiler-cache")

// Seeds a real device token and fresh offline /me cache so tests of downstream agent commands pass through
// the normal offline auth path without bypassing sign-in checks in production code.
export function seedTestAuthSession(configDir: string) {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  writeFileSync(
    path.join(configDir, "auth.json"),
    JSON.stringify({
      device_token: "pdx_dev_test_fixture_token",
      refresh_token: "pdx_ref_test_fixture_token",
      device_id: "00000000-0000-4000-8000-000000000001",
      device_name: "Test fixture, terminal",
      api_url: "http://127.0.0.1:1",
    }) + "\n",
    { mode: 0o600 },
  )
  writeFileSync(
    path.join(configDir, "me-cache.json"),
    JSON.stringify({
      id: "00000000-0000-4000-8000-000000000002",
      display_name: "Test Learner",
      email: "test@example.com",
      account_kind: "adult",
      status: "active",
      plan: "free",
      entitlements: entitlementsFor("free"),
      teach_lock: "none",
      credits: 0,
      cached_at: Date.now(),
    }) + "\n",
    { mode: 0o600 },
  )
}

export function isolatedEnv(root: string, overrides: Record<string, string | undefined> = {}) {
  return {
    ...process.env,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: transpilerCache,
    HOME: root,
    OPENCODE_CLI_CONFIG_CONTENT: undefined,
    OPENCODE_CONFIG_CONTENT: "{}",
    OPENCODE_CONFIG_DIR: path.join(root, "config"),
    OPENCODE_DB: path.join(root, "opencode.db"),
    OPENCODE_DISABLE_FILEWATCHER: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_TEST_HOME: root,
    PENDIX_API_URL: "http://127.0.0.1:1",
    PENDIX_DISABLE_KEYCHAIN: "1",
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "xdg-config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    ...overrides,
  }
}
