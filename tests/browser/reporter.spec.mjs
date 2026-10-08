// Browser verification of the public reporter (legacy GitHub handoff path).
// Runs once per viewport project (320 / 375 / 1280). All external requests are
// aborted by the guard fixture; no GitHub issue can be created.
//
// Tests marked with test.fail(..., "VF-xxx") encode a REQUIRED behaviour that the
// baseline does not meet (a verification finding). They run and are expected to
// fail; once the owner fixes the defect Playwright reports "expected to fail but
// passed" and the marker must be removed — never weaken the assertion instead.
import {
  test, expect, snapshot, writeEvidence, activeId, tabTo, horizontalOverflow, runAxe, INTAKE_HOSTS
} from "./support.mjs";

const REPORT = Object.freeze({
  product: "Forma",
  impact: "Cannot use the feature",
  title: "Save button & \"quotes\" do nothing #1",
  actualLines: ["I pressed Save.", "Nothing changed: 100% reproducible?"],
  expectedText: "My changes should be saved + confirmed.",
  stepsLines: ["1. Open the editor", "2. Press Save"],
  pageUrl: "https://user:hunter2@example.com/app/edit page?access_token=SECRET123#frag",
  sanitizedUrl: "https://example.com/app/edit%20page"
});

async function fillValid(page, overrides = {}) {
  const r = { ...REPORT, ...overrides };
  await page.locator("#product").selectOption(r.product);
  await page.locator("#impact").selectOption(r.impact);
  await page.locator("#title").fill(r.title);
  await page.locator("#actual").fill(r.actualLines.join("\n"));
  await page.locator("#expected").fill(r.expectedText);
  await page.locator("details.optional > summary").click();
  await page.locator("#steps").fill(r.stepsLines.join("\n"));
  await page.locator("#pageUrl").fill(r.pageUrl);
  await page.locator("#privacyAcknowledged").check();
}

const formValues = page => page.evaluate(() => Object.fromEntries(
  ["product", "impact", "title", "actual", "expected", "steps", "pageUrl"]
    .map(id => [id, document.getElementById(id).value])
    .concat([["privacyAcknowledged", document.getElementById("privacyAcknowledged").checked]])
));

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#defect-form")).toBeVisible();
});

test.describe("VIT-AC-001 / VIT-UX-006 layout", () => {
  test("no horizontal scroll in initial, review and error states", async ({ page }, testInfo) => {
    const states = {};
    states.initial = await horizontalOverflow(page);
    await snapshot(page, testInfo, "initial");
    await page.locator("[data-testid=review-button]").click();
    states.nativeInvalid = await horizontalOverflow(page);
    await fillValid(page);
    await page.locator("#pageUrl").fill("ftp://example.com/");
    await page.locator("[data-testid=review-button]").click();
    await expect(page.locator("#feedback")).toBeVisible();
    states.error = await horizontalOverflow(page);
    await snapshot(page, testInfo, "error");
    await page.locator("#pageUrl").fill(REPORT.pageUrl);
    await page.locator("[data-testid=review-button]").click();
    await expect(page.locator("#review")).toBeVisible();
    states.review = await horizontalOverflow(page);
    await snapshot(page, testInfo, "review");
    writeEvidence("overflow-" + testInfo.project.name + ".json", states);
    for (const [name, s] of Object.entries(states)) {
      expect(s.scrollWidth, name + " overflow offenders: " + s.offenders.join(", ")).toBeLessThanOrEqual(s.clientWidth);
    }
  });

  test("long unbroken text at field limits does not overflow the review", async ({ page }, testInfo) => {
    await fillValid(page, {
      title: "W".repeat(120),
      actualLines: ["A".repeat(1200)],
      expectedText: "E".repeat(1200),
      stepsLines: ["S".repeat(900)],
      pageUrl: "https://example.com/" + "p".repeat(400)
    });
    await page.locator("[data-testid=review-button]").click();
    await expect(page.locator("#review")).toBeVisible();
    const s = await horizontalOverflow(page);
    await snapshot(page, testInfo, "review-long");
    expect(s.scrollWidth, s.offenders.join(", ")).toBeLessThanOrEqual(s.clientWidth);
    await expect(page.locator("#preview-actual")).toHaveText("A".repeat(1200));
  });

  test("page degrades acceptably when the Forma CDN stylesheet is unavailable", async ({ page, guard }, testInfo) => {
    testInfo.annotations.push({ type: "note", description: "Styling assertions are only meaningful where Forma loads (CI with VITIUM_ALLOW_FORMA_CDN=1, or VITIUM_FORMA_CSS_FILE)." });
    const forma = guard.requests.filter(r => r.url.includes("@echelon-foundry/design-system"));
    expect(forma.length, "the pinned Forma stylesheet is requested").toBeGreaterThan(0);
    for (const id of ["product", "impact", "title", "actual", "expected", "privacyAcknowledged"]) {
      await expect(page.locator("#" + id)).toBeVisible();
      expect(await page.locator("#" + id).evaluate(e => e.labels.length), id + " has a native label").toBeGreaterThan(0);
    }
    await expect(page.getByRole("button", { name: /Review my report/ })).toBeVisible();
  });
});

test.describe("VIT-AC-001 / VIT-AC-002 keyboard-only legacy flow", () => {
  test("Tab/typing completes the form; Review, Edit preserves, Review, Continue href is a safe github.com/new-issue link", async ({ page, guard, context }, testInfo) => {
    const kb = page.keyboard;
    await page.locator("body").focus();
    await tabTo(page, "product");
    await kb.type("Forma");
    await expect(page.locator("#product")).toHaveValue("Forma");
    await kb.press("Tab");
    expect(await activeId(page)).toBe("impact");
    await kb.type("Cannot");
    await expect(page.locator("#impact")).toHaveValue(REPORT.impact);
    await kb.press("Tab");
    expect(await activeId(page)).toBe("title");
    await kb.type(REPORT.title);
    await kb.press("Tab");
    expect(await activeId(page)).toBe("actual");
    await kb.type(REPORT.actualLines[0]);
    await kb.press("Enter");
    await kb.type(REPORT.actualLines[1]);
    await kb.press("Tab");
    expect(await activeId(page)).toBe("expected");
    await kb.type(REPORT.expectedText);
    await kb.press("Tab");
    expect(await activeId(page)).toBe("summary");
    await kb.press("Enter");
    await kb.press("Tab");
    expect(await activeId(page)).toBe("steps");
    await kb.type(REPORT.stepsLines[0]);
    await kb.press("Enter");
    await kb.type(REPORT.stepsLines[1]);
    await kb.press("Tab");
    expect(await activeId(page)).toBe("pageUrl");
    await kb.type(REPORT.pageUrl);
    await kb.press("Tab");
    expect(await activeId(page)).toBe("privacyAcknowledged");
    await kb.press("Space");
    await expect(page.locator("#privacyAcknowledged")).toBeChecked();
    const typed = await formValues(page);
    await kb.press("Tab");
    await kb.press("Enter");

    await expect(page.locator("#review")).toBeVisible();
    expect(await activeId(page), "focus moves to the review region").toBe("review");
    await expect(page.locator("#progress")).toContainText("Step 2 of 2");
    await expect(page.locator("#preview-pageUrl")).toHaveText(REPORT.sanitizedUrl);
    await expect(page.locator("#preview-actual")).toHaveText(REPORT.actualLines.join("\n"));
    await snapshot(page, testInfo, "keyboard-review");

    await tabTo(page, "edit");
    await kb.press("Enter");
    await expect(page.locator("#defect-form")).toBeVisible();
    expect(await activeId(page)).toBe("title");
    expect(await formValues(page), "Edit preserves every typed value").toEqual(typed);

    await tabTo(page, "privacyAcknowledged");
    await kb.press("Tab");
    await kb.press("Enter");
    await expect(page.locator("#review")).toBeVisible();

    await tabTo(page, "submit-link");
    const href = await page.locator("#submit-link").getAttribute("href");
    const url = new URL(href);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/kemiller2002/vitium/issues/new");
    expect([...url.searchParams.keys()].sort()).toEqual(["body", "title"]);
    expect(url.searchParams.get("title")).toBe("[Forma] " + REPORT.title);
    const body = url.searchParams.get("body");
    expect(body).toContain("> " + REPORT.actualLines[0] + "\n> " + REPORT.actualLines[1]);
    expect(body).toContain("> " + REPORT.expectedText);
    expect(body).toContain("> " + REPORT.stepsLines[0] + "\n> " + REPORT.stepsLines[1]);
    expect(body).toContain(REPORT.sanitizedUrl);
    for (const secret of ["hunter2", "SECRET123", "access_token", "#frag", "user:"]) expect(href).not.toContain(secret);
    expect(href, "raw characters are percent-encoded").not.toMatch(/[ "<>]/);

    // Activate Continue by keyboard; the github.com navigation must be aborted.
    const popupPromise = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
    await kb.press("Enter");
    const popup = await popupPromise;
    if (popup) await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const github = guard.requests.filter(r => new URL(r.url).hostname === "github.com");
    expect(github.length, "Continue attempted to open GitHub").toBeGreaterThan(0);
    expect(github.every(r => r.kind === "abort"), "every github.com request was aborted").toBe(true);
    // VIT-AC-002: no "submitted/received" state is ever shown on the legacy path.
    await expect(page.locator("#private-success")).toBeHidden();
    await expect(page.locator("#progress")).not.toContainText(/received|submitted/i);
    await expect(page.locator("#github-destination")).toContainText("not yet submitted");
  });
});

test.describe("VIT-AC-004 / VIT-UX-007 validation", () => {
  test("client-side error is announced, focused, and typed content is preserved", async ({ page }) => {
    await fillValid(page, { pageUrl: "javascript:alert(document.domain)" });
    const before = await formValues(page);
    await page.locator("[data-testid=review-button]").click();
    const feedback = page.locator("#feedback");
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveAttribute("role", "alert");
    await expect(feedback).toContainText(/http or https/);
    expect(await activeId(page)).toBe("feedback");
    expect(await formValues(page)).toEqual(before);
    await expect(page.locator("#review")).toBeHidden();
  });

  test("empty submit keeps partial content and does not reach review", async ({ page }) => {
    await page.locator("#title").fill("Partially typed summary");
    await page.locator("[data-testid=review-button]").click();
    await expect(page.locator("#review")).toBeHidden();
    await expect(page.locator("#title")).toHaveValue("Partially typed summary");
    expect(await activeId(page), "focus moves to first invalid control").toBe("product");
  });

  test("empty submit focuses an error summary whose entries link to aria-describedby field errors", async ({ page }) => {
    await page.locator("#title").fill("Partially typed summary");
    await page.locator("[data-testid=review-button]").click();
    const summary = await page.evaluate(() => {
      const a = document.activeElement;
      const box = a?.closest("[role=alert],[data-testid=error-summary],#feedback,.error-summary");
      return box ? { text: box.textContent.trim(), links: [...box.querySelectorAll("a[href^='#']")].map(x => x.getAttribute("href")) } : null;
    });
    expect(summary, "focus is inside an error summary").not.toBeNull();
    expect(summary.links.length).toBeGreaterThan(0);
    for (const id of ["product", "impact", "actual", "expected", "privacyAcknowledged"]) {
      const field = page.locator("#" + id);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      const describedBy = await field.getAttribute("aria-describedby");
      expect(describedBy, id + " has aria-describedby").toBeTruthy();
      const text = await page.evaluate(ids => ids.split(/\s+/).map(i => document.getElementById(i)?.textContent ?? "").join(" ").trim(), describedBy);
      expect(text.length, id + " error message text").toBeGreaterThan(0);
      expect(summary.links).toContain("#" + id);
    }
    await expect(page.locator("#title")).toHaveValue("Partially typed summary");
  });

  test("hint text is programmatically associated with its field", async ({ page }) => {
    for (const id of ["title", "pageUrl"]) {
      const describedBy = await page.locator("#" + id).getAttribute("aria-describedby");
      expect(describedBy, id).toBeTruthy();
    }
  });
});

test.describe("VIT-AC-004 / VIT-UX-007 long text", () => {
  test("pasting 10,000 characters is never silently truncated", async ({ page }) => {
    const long = "x".repeat(10_000);
    await page.locator("#actual").focus();
    await page.keyboard.insertText(long);
    const kept = (await page.locator("#actual").inputValue()).length;
    const announced = await page.evaluate(() => {
      const f = document.getElementById("actual");
      const ids = (f.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      return ids.map(i => document.getElementById(i)?.textContent ?? "").join(" ") + " " + document.getElementById("feedback").textContent;
    });
    expect(kept === 10_000 || /1,?200|too long|limit|characters/i.test(announced), "either keeps all text (and validates) or tells the user it was cut").toBe(true);
  });

  test("encoded GitHub link overflow is refused with a focused error and content preserved", async ({ page }) => {
    await fillValid(page, { actualLines: ["🪲".repeat(550)], expectedText: "✔".repeat(1000), stepsLines: ["🐛".repeat(430)] });
    const before = await formValues(page);
    await page.locator("[data-testid=review-button]").click();
    await expect(page.locator("#feedback")).toContainText(/too long/);
    expect(await activeId(page)).toBe("feedback");
    expect(await formValues(page)).toEqual(before);
    await expect(page.locator("#review")).toBeHidden();
  });
});

test.describe("VIT-AC-004 / VIT-AC-008 / VIT-AC-015 hostile input", () => {
  const HOSTILE = Object.freeze({
    title: "<img src=x onerror=alert(1)>",
    actual: "\"><script>alert(2)</script><svg onload=alert(5)>",
    expected: "<a href=\"javascript:alert(6)\">click</a> {{constructor.constructor('alert(7)')()}}",
    steps: "javascript:alert(3)\n<iframe src=javascript:alert(8)>"
  });

  test("markup is rendered as text, never executed or parsed into the DOM", async ({ page, guard }, testInfo) => {
    await fillValid(page, {
      title: HOSTILE.title, actualLines: [HOSTILE.actual], expectedText: HOSTILE.expected,
      stepsLines: HOSTILE.steps.split("\n"), pageUrl: "https://example.com/ok"
    });
    await page.locator("[data-testid=review-button]").click();
    await expect(page.locator("#review")).toBeVisible();
    await expect(page.locator("#preview-title")).toHaveText(HOSTILE.title);
    await expect(page.locator("#preview-actual")).toHaveText(HOSTILE.actual);
    await expect(page.locator("#preview-steps")).toHaveText(HOSTILE.steps);
    const injected = await page.evaluate(() => document.querySelectorAll("#review img, #review script, #review svg, #review iframe, #review a[href^='javascript']").length);
    expect(injected).toBe(0);
    await page.waitForTimeout(300);
    expect(guard.dialogs).toEqual([]);
    expect(guard.pageErrors).toEqual([]);
    expect(guard.requests.filter(r => /\/x$/.test(new URL(r.url).pathname)), "no img src=x fetch").toEqual([]);
    const href = new URL(await page.locator("#submit-link").getAttribute("href"));
    expect(href.searchParams.get("title")).toBe("[Forma] " + HOSTILE.title);
    await snapshot(page, testInfo, "hostile-review");
  });

  for (const pageUrl of ["javascript:alert(4)", "JaVaScRiPt:alert(4)", " javascript:alert(4)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd"]) {
    test("page URL scheme is refused: " + JSON.stringify(pageUrl.slice(0, 20)), async ({ page, guard }) => {
      await fillValid(page, { pageUrl });
      await page.locator("[data-testid=review-button]").click();
      await expect(page.locator("#review")).toBeHidden();
      // Native type=url validation may block first; either way no review and no execution.
      const nativeInvalid = await page.locator("#pageUrl").evaluate(e => !e.validity.valid);
      if (!nativeInvalid) await expect(page.locator("#feedback")).toContainText(/http or https|valid page URL/);
      expect(guard.dialogs).toEqual([]);
    });
  }

  test("credential-looking text is refused or redacted before the public GitHub link is built", async ({ page }) => {
    const token = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    await fillValid(page, { actualLines: ["My token is " + token] });
    await page.locator("[data-testid=review-button]").click();
    const href = await page.locator("#submit-link").getAttribute("href");
    const refused = await page.locator("#feedback").isVisible();
    expect(refused || !href.includes(token), "token must not reach a public URL").toBe(true);
  });
});

test.describe("VIT-UX-006 reduced motion", () => {
  test("prefers-reduced-motion: reduce removes transitions and animations", async ({ page, guard }, testInfo) => {
    const motion = () => page.evaluate(() => {
      const secs = v => v.split(",").map(s => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1)).reduce((a, b) => Math.max(a, b), 0);
      return [...document.querySelectorAll("*")]
        .map(e => ({ el: e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.split(" ")[0] : ""), t: secs(getComputedStyle(e).transitionDuration), a: secs(getComputedStyle(e).animationDuration) }))
        // Forma's reduce rule uses 0.01ms; anything at or below 10ms is imperceptible.
        .filter(x => x.t > 0.01 || x.a > 0.01);
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const normal = await motion();
    // Sensitivity: the app's own button transition must be present without the preference.
    expect(normal.some(x => x.el.includes("primary-button")), "control: transitions exist without the preference").toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await motion();
    testInfo.annotations.push({ type: "forma-css", description: guard.formaMode });
    expect(reduced, "elements still moving under reduce").toEqual([]);
    const running = await page.evaluate(() => document.getAnimations().filter(a => (a.effect?.getTiming().duration ?? 0) > 10).length);
    expect(running).toBe(0);
  });
});

test.describe("VIT-UX-006 axe-core accessibility (no suppressions)", () => {
  for (const state of ["initial", "review"]) {
    test("axe WCAG 2.x A/AA + best-practice: " + state, async ({ page, guard }, testInfo) => {
      if (state === "review") {
        await fillValid(page);
        await page.locator("[data-testid=review-button]").click();
        await expect(page.locator("#review")).toBeVisible();
      }
      const result = await runAxe(page);
      writeEvidence("axe-" + testInfo.project.name + "-" + state + "-" + guard.formaMode + ".json", result);
      await testInfo.attach("axe.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
      if (guard.formaMode === "block") {
        testInfo.annotations.push({ type: "note", description: "Forma CSS blocked: colour-contrast results reflect site/styles.css only." });
      }
      expect(result.violations.map(v => `${v.id} [${v.impact}] ${v.nodes.join(" | ")}`)).toEqual([]);
    });
  }
});

test.describe("VIT-AC-003 gate / VIT-AC-015 private intake is unreachable while disabled", () => {
  test("enabled:false never contacts intake or challenge hosts across the full flow", async ({ page, guard }) => {
    await expect(page.locator("#submit-private")).toBeHidden();
    await expect(page.locator("#private-destination")).toBeHidden();
    await expect(page.locator("#github-foot")).toBeVisible();
    await fillValid(page);
    await page.locator("[data-testid=review-button]").click();
    await expect(page.locator("#review")).toBeVisible();
    await expect(page.locator("#submit-private")).toBeHidden();
    await expect(page.locator("#submit-link")).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll("script[src*='challenges.cloudflare.com']").length)).toBe(0);
    // Force-click the hidden private button: the handler must still refuse (fail closed).
    await page.locator("#submit-private").dispatchEvent("click");
    await page.waitForTimeout(300);
    await page.locator("#edit").click();
    const touched = guard.requests.filter(r => INTAKE_HOSTS.includes(new URL(r.url).hostname));
    expect(touched).toEqual([]);
    const nonSite = guard.external().map(r => new URL(r.url).hostname);
    expect(nonSite.every(h => h === "cdn.jsdelivr.net"), "only the pinned stylesheet host is requested: " + nonSite.join(",")).toBe(true);
    expect(guard.pageErrors).toEqual([]);
  });
});
