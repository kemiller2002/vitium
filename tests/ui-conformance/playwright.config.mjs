// Vitium UI conformance suite: visual-engineering UI-LAYOUT-INTERACTION@1.0.0.
// Run: npm run ui:conformance
// CI installs the pinned Chromium with `npx playwright install --with-deps chromium`.
// In a sandbox whose preinstalled Chromium revision differs from this
// Playwright release, set VITIUM_CHROMIUM_EXECUTABLE, or provide
// $PLAYWRIGHT_BROWSERS_PATH/chromium, and that executable is used instead.
import { chromium, defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.VITIUM_UI_PORT ?? 4180);
const ROOT = new URL("../../", import.meta.url).pathname;
// Override only to measure another build of the site (e.g. a baseline checkout).
const SITE_ROOT = process.env.VITIUM_UI_SITE_ROOT ?? "site";
const OUTPUT = new URL("./output/", import.meta.url).pathname;

const resolveExecutable = env => {
  if (env.VITIUM_CHROMIUM_EXECUTABLE) return env.VITIUM_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return undefined;
  const fallback = env.PLAYWRIGHT_BROWSERS_PATH ? join(env.PLAYWRIGHT_BROWSERS_PATH, "chromium") : null;
  return fallback && existsSync(fallback) ? fallback : undefined;
};
const executablePath = resolveExecutable(process.env);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs$/,
  outputDir: OUTPUT + "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: OUTPUT + "results.json" }]
  ],
  metadata: { standard: "visual-engineering/UI-LAYOUT-INTERACTION@1.0.0", chromium: executablePath ?? "playwright-managed" },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block"
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `node tests/ui-conformance/static-server.mjs --port=${PORT} --root=${SITE_ROOT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 15_000,
    cwd: ROOT
  }
});
