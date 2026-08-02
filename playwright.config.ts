import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "allow",
      caret: "initial",
      threshold: 0.25,
      maxDiffPixelRatio: 0.015,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 1000 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: `LIVING_HERE_PORT=${port} LIVING_HERE_DATA=.living-here/playwright npm run api`,
    url: `http://127.0.0.1:${port}/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
