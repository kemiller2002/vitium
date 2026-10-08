// Shared browser-suite fixtures. Every test runs behind a network guard that
// lets only the local static server through and aborts everything else, so a
// real GitHub issue, intake call or Turnstile load can never happen.
import { test as base, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export { expect };

export const FORMA_CSS_URL = "https://cdn.jsdelivr.net/npm/@echelon-foundry/design-system@0.3.0/dist/all.css";
export const INTAKE_HOSTS = Object.freeze(["intake.vitium.echelonfoundry.com", "challenges.cloudflare.com"]);
const OUTPUT = fileURLToPath(new URL("./.output/", import.meta.url));

/**
 * Pure: classify a request URL against the guard policy.
 * mode: "block" (default local), "cdn" (CI: allow the exact pinned Forma
 * stylesheet only), or {file} (fulfil the pinned URL from a local copy).
 */
export function classifyRequest(url, { siteOrigin, formaMode }) {
  if (url.startsWith(siteOrigin)) return "site";
  if (url === FORMA_CSS_URL) {
    if (formaMode === "cdn") return "forma-cdn";
    if (formaMode === "file") return "forma-file";
  }
  return "abort";
}

/** Pure: read the Forma mode from the environment. */
export const formaModeFrom = env =>
  env.VITIUM_FORMA_CSS_FILE ? "file" : env.VITIUM_ALLOW_FORMA_CDN === "1" ? "cdn" : "block";

export const axeSource = () =>
  readFileSync(fileURLToPath(new URL("../../node_modules/axe-core/axe.min.js", import.meta.url)), "utf8");

export const test = base.extend({
  // Network/dialog/console guard. Exposes an immutable-append log via getters.
  guard: [async ({ context, baseURL }, use, testInfo) => {
    const formaMode = formaModeFrom(process.env);
    const formaBody = formaMode === "file" ? readFileSync(process.env.VITIUM_FORMA_CSS_FILE) : null;
    let requests = [];
    let dialogs = [];
    let consoleMessages = [];
    let pageErrors = [];
    await context.route("**/*", route => {
      const url = route.request().url();
      const kind = classifyRequest(url, { siteOrigin: baseURL, formaMode });
      requests = [...requests, { url, method: route.request().method(), kind }];
      if (kind === "site" || kind === "forma-cdn") return route.continue();
      if (kind === "forma-file") return route.fulfill({ status: 200, contentType: "text/css", body: formaBody });
      return route.abort("blockedbyclient");
    });
    const watch = page => {
      page.on("dialog", d => { dialogs = [...dialogs, { type: d.type(), message: d.message() }]; return d.dismiss(); });
      page.on("console", m => { consoleMessages = [...consoleMessages, { type: m.type(), text: m.text() }]; });
      page.on("pageerror", e => { pageErrors = [...pageErrors, String(e?.message ?? e)]; });
    };
    context.pages().forEach(watch);
    context.on("page", watch);
    testInfo.annotations.push({ type: "forma-css", description: formaMode });
    await use({
      get requests() { return requests; },
      get dialogs() { return dialogs; },
      get console() { return consoleMessages; },
      get pageErrors() { return pageErrors; },
      external: () => requests.filter(r => r.kind !== "site"),
      formaMode
    });
    await testInfo.attach("network-log.json", { body: JSON.stringify(requests, null, 2), contentType: "application/json" });
    await testInfo.attach("console-log.json", { body: JSON.stringify({ consoleMessages, pageErrors, dialogs }, null, 2), contentType: "application/json" });
  }, { auto: true }]
});

/** Save a named full-page screenshot under the gitignored output dir. */
export async function snapshot(page, testInfo, state) {
  const dir = OUTPUT + "screenshots/";
  mkdirSync(dir, { recursive: true });
  const path = dir + testInfo.project.name + "-" + state + ".png";
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(state, { path, contentType: "image/png" });
  return path;
}

export function writeEvidence(name, data) {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(OUTPUT + name, JSON.stringify(data, null, 2));
}

export const activeId = page => page.evaluate(() => {
  const a = document.activeElement;
  return a?.id || (a?.tagName === "SUMMARY" ? "summary" : a?.tagName?.toLowerCase() ?? "");
});

/** Keyboard-only: press Tab until the focused element matches, failing after max presses. */
export async function tabTo(page, id, max = 40) {
  for (let i = 0; i < max; i += 1) {
    if (await activeId(page) === id) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus never reached #" + id + " within " + max + " Tab presses");
}

export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter(e => e.getClientRects().length && e.getBoundingClientRect().right > width + 0.5)
      .map(e => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : ""))
      .slice(0, 10);
    return { scrollWidth: doc.scrollWidth, clientWidth: width, bodyScrollWidth: document.body.scrollWidth, offenders };
  });
}

/** Inject axe through CDP evaluation (the page CSP correctly forbids inline script tags). */
export async function runAxe(page) {
  await page.evaluate(axeSource());
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
      resultTypes: ["violations", "incomplete"]
    });
    const shape = v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => n.target.join(" ")) });
    return { violations: result.violations.map(shape), incomplete: result.incomplete.map(shape) };
  });
}
