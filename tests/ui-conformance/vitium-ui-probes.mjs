// Vitium-specific browser probes for the UI conformance suite. Generic,
// swappable assertions live in ui-conformance-helpers.mjs (Forma API mirror).
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, ROOT));

export const VIEWPORT_WIDTHS = Object.freeze([320, 390, 768, 1280]);
// 1280 CSS px at 200% browser zoom lays out at 640 CSS px (ULI-L05 zoom state).
export const ZOOM_200_WIDTH = 640;
// Content-driven breakpoint observed in the baseline: two-column field row
// where "How much does it affect you?" wraps (903-1015 CSS px).
export const LABEL_WRAP_WIDTH = 960;

export const GITHUB_ISSUES = "https://github.com/kemiller2002/vitium/issues";
export const INTAKE_ENDPOINT = "https://intake.vitium.echelonfoundry.com/api/v1/reports";
const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// The page pins Forma from the jsDelivr CDN. The suite serves the byte-identical
// npm release of that exact version so geometry does not depend on the network;
// the pin and the dev dependency must name the same version or the suite fails.
const formaVersion = () => {
  const html = read("site/index.html").toString();
  const match = html.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/@echelon-foundry\/design-system@([0-9.]+)\/dist\/all\.css/);
  const pinned = match?.[1];
  const installed = JSON.parse(read("package.json")).devDependencies?.["@echelon-foundry/design-system"];
  if (!pinned || pinned !== installed) {
    throw new Error(`Forma stylesheet pin (${pinned}) must equal the @echelon-foundry/design-system dev dependency (${installed}).`);
  }
  return { url: match[0], css: read("node_modules/@echelon-foundry/design-system/dist/all.css") };
};

const STUB_EXTERNAL = "<!doctype html><title>External destination (test stub)</title><p>Stubbed by the Vitium UI conformance suite; no external operation happened.</p>";

// Every test runs hermetically: unknown off-origin requests are refused, the
// pinned stylesheet is served locally, and GitHub destinations are stubbed so
// an external page load is never mistaken for a completed external operation.
export const test = base.extend({
  context: async ({ context }, use) => {
    const forma = formaVersion();
    await context.route(url => !url.href.startsWith("http://127.0.0.1"), route => route.abort("blockedbyclient"));
    await context.route(forma.url, route => route.fulfill({ status: 200, contentType: "text/css", body: forma.css }));
    await context.route(url => url.href.startsWith("https://github.com/"), route =>
      route.fulfill({ status: 200, contentType: "text/html", body: STUB_EXTERNAL }));
    await use(context);
  }
});
export { expect };

// Enable the feature-gated private intake candidate for one page, with a stub
// Turnstile that issues a fresh token on render and on every reset. The
// shipped configuration keeps this path disabled; tests exercise its honesty.
export const enablePrivateCandidate = async page => {
  await page.route("**/public-config.mjs", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `export const publicIntake = Object.freeze({ enabled: true, endpoint: ${JSON.stringify(INTAKE_ENDPOINT)}, turnstileSiteKey: "test-site-key-0000" });`
  }));
  await page.route(TURNSTILE_SCRIPT, route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `(() => {
      let issued = 0; let options = null;
      const issue = () => setTimeout(() => options.callback("stub-challenge-token-" + (++issued)), 0);
      window.turnstile = {
        render(selector, opts) { options = opts; document.querySelector(selector).textContent = "Verification (test stub)"; issue(); return "stub-widget"; },
        reset() { issue(); }
      };
    })();`
  }));
};

// Route the intake endpoint through `respond(request, attempt)`; CORS preflight
// is answered so only the real POSTs reach `respond`. Returns observed requests.
export const routeIntake = async (page, respond) => {
  const posts = [];
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, idempotency-key", "Access-Control-Allow-Methods": "POST" };
  await page.route(INTAKE_ENDPOINT, async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    posts.push({ idempotencyKey: request.headers()["idempotency-key"], body: request.postDataJSON() });
    return respond(route, posts.length, cors);
  });
  return posts;
};

export const control = Object.freeze({
  product: page => page.getByRole("combobox", { name: "Which application?" }),
  impact: page => page.getByRole("combobox", { name: "How much does it affect you?" }),
  title: page => page.getByRole("textbox", { name: "Short summary" }),
  actual: page => page.getByRole("textbox", { name: "What happened?" }),
  expected: page => page.getByRole("textbox", { name: "What did you expect?" }),
  steps: page => page.getByRole("textbox", { name: "How can we reproduce it?" }),
  pageUrl: page => page.getByRole("textbox", { name: "Page URL" }),
  privacy: page => page.getByRole("checkbox", { name: /I've removed passwords/ }),
  review: page => page.getByRole("button", { name: "Review my report" }),
  details: page => page.locator("summary", { hasText: "Additional details" }),
  reviewHeading: page => page.getByRole("heading", { name: "Does this look right?" }),
  edit: page => page.getByRole("button", { name: "← Edit report" }),
  github: page => page.getByRole("link", { name: "Continue to GitHub" }),
  sendPrivate: page => page.getByRole("button", { name: /^(Send private report|Sending…)$/ }),
  feedback: page => page.getByRole("alert"),
  progress: page => page.locator("#progress")
});

export const fillReport = async (page, overrides = {}) => {
  const report = {
    product: "Forma", impact: "Can use it with a workaround",
    title: "Save button does nothing on my phone",
    actual: "I tapped Save and nothing changed.",
    expected: "My changes are saved.",
    ...overrides
  };
  await control.product(page).selectOption(report.product);
  await control.impact(page).selectOption(report.impact);
  await control.title(page).fill(report.title);
  await control.actual(page).fill(report.actual);
  await control.expected(page).fill(report.expected);
  if (report.steps !== undefined || report.pageUrl !== undefined) {
    await control.details(page).click();
    if (report.steps !== undefined) await control.steps(page).fill(report.steps);
    if (report.pageUrl !== undefined) await control.pageUrl(page).fill(report.pageUrl);
  }
  if (report.privacy !== false) await control.privacy(page).check();
  return report;
};

// ULI-L05: page-level horizontal overflow and any visible element whose box
// escapes the viewport (absolute skip link excluded while off-screen by design).
export const measureOverflow = page => page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  const scroll = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const offenders = [...document.body.querySelectorAll("*")].filter(node => {
    if (node.closest(".skip-link")) return false;
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    return box.right > width + 1 || box.left < -1;
  }).map(node => `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}${node.className && typeof node.className === "string" ? "." + node.className.split(" ").join(".") : ""}`);
  // Text clipped inside its own box (e.g. a nav label cropped by overflow:hidden).
  const clipped = [...document.body.querySelectorAll("a, button, label, summary, h1, h2, h3, dt, dd, p, span, strong")].filter(node => {
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || node.closest(".skip-link")) return false;
    const style = getComputedStyle(node);
    return style.overflowX !== "visible" && node.scrollWidth > node.clientWidth + 1;
  }).map(node => node.textContent.trim().slice(0, 40));
  return { width, scroll, offenders: offenders.slice(0, 10), clipped };
});

export const expectNoOverflow = async (page, label) => {
  const result = await measureOverflow(page);
  expect(result.scroll, `${label}: page scrolls horizontally (${result.scroll} > ${result.width}); escaping: ${JSON.stringify(result.offenders)}`).toBeLessThanOrEqual(result.width);
  expect(result.offenders, `${label}: elements escape the viewport`).toEqual([]);
  expect(result.clipped, `${label}: text clipped inside its control`).toEqual([]);
  return result;
};
