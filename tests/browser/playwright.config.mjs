// Vitium browser verification suite (VIT-AC-001/002/004/008/015, VIT-UX-006/007).
// Run: npm run test:browser   (CI: after `npx playwright install --with-deps chromium`)
// Local without the Playwright CDN: see tests/verification/chromium-launch.mjs.
import { defineConfig } from "@playwright/test";
import { resolveChromium } from "../verification/chromium-launch.mjs";

const chromium = await resolveChromium(process.env);
if (!chromium.ok) throw new Error(chromium.error);

const PORT = Number(process.env.VITIUM_BROWSER_PORT ?? 4173);
const SITE_ROOT = process.env.VITIUM_SITE_ROOT ?? "site";
const OUTPUT = new URL("./.output", import.meta.url).pathname;

export const viewports = Object.freeze([
  { name: "w320", width: 320, height: 720 },
  { name: "w375", width: 375, height: 760 },
  { name: "w1280", width: 1280, height: 900 }
]);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs$/,
  outputDir: OUTPUT + "/test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: [
    ["list"],
    ["json", { outputFile: OUTPUT + "/results.json" }],
    ["html", { outputFolder: OUTPUT + "/html-report", open: "never" }]
  ],
  metadata: { chromiumSource: chromium.value.label },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    browserName: "chromium",
    launchOptions: chromium.value.launchOptions,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    serviceWorkers: "block"
  },
  projects: viewports.map(v => ({
    name: v.name,
    use: { viewport: { width: v.width, height: v.height } }
  })),
  webServer: {
    command: `node tests/verification/static-server.mjs --port=${PORT} --root=${SITE_ROOT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 15_000,
    cwd: new URL("../../", import.meta.url).pathname
  }
});
