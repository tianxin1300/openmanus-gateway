const { defineConfig, devices } = require("@playwright/test");
const { defaultBrowserType: _iphone14Default, ...iphone14 } = devices["iPhone 14"];
const { defaultBrowserType: _iphone13Default, ...iphone13Pro } = devices["iPhone 13 Pro"];
const { defaultBrowserType: _ipadDefault, ...ipad9 } = devices["iPad (gen 7)"];

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
    { name: "webkit-iphone", use: { ...iphone14, browserName: "webkit" } },
    { name: "webkit-iphone13pro", use: { ...iphone13Pro, browserName: "webkit" } },
    { name: "webkit-ipad9", use: { ...ipad9, browserName: "webkit" } }
  ]
});
