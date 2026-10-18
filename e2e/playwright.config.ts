import { defineConfig } from "@playwright/test";

// Runs against the full Compose stack with the fake printer:
//   docker compose --profile dev up -d --build && pnpm e2e
export default defineConfig({
  testDir: "tests",
  // Every test shares one restaurant, one business day (a Z closes it) and one
  // fake printer folder (tests count its images), so they run one at a time.
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    locale: "ar",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
