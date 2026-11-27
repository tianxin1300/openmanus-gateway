const { defineConfig, devices } = require("@playwright/test");
const { defaultBrowserType, ...iphone14 } = devices["iPhone 14"];

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "workbench-ui.spec.cjs",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 12000 },
  retries: 1,
  reporter: [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "chromium-iphone", use: { ...iphone14, browserName: "chromium" } },
    { name: "webkit-iphone", use: { ...iphone14, browserName: "webkit" } }
  ]
});
