import { defineConfig, devices } from "@playwright/test"

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4173)
const API_PORT = Number(process.env.E2E_API_PORT ?? 4301)

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `E2E_API_PORT=${API_PORT} E2E_WEB_URL=http://127.0.0.1:${WEB_PORT} bun --cwd ../cloud test/helpers/e2e-server.ts`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `VITE_API_URL=http://127.0.0.1:${API_PORT} bunx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
