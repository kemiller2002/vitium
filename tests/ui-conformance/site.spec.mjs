// Vitium public reporting site (site/index.html), conformance with
// visual-engineering UI-LAYOUT-INTERACTION@1.0.0. Every test names the rule IDs
// it evidences. No fixed sleeps, no coordinates for interaction, role/name
// locators throughout; geometry is measured after fonts and frames settle.
import {
  test, expect, control, fillReport, enablePrivateCandidate, routeIntake, expectNoOverflow,
  VIEWPORT_WIDTHS, ZOOM_200_WIDTH, LABEL_WRAP_WIDTH, GITHUB_ISSUES
} from "./vitium-ui-probes.mjs";
import { STATUS, expectActionOutcome, expectPeerAlignment, measureAlignment, settleFontsAndFrames, formatReport } from "./ui-conformance-helpers.mjs";

const HEIGHT = 900;

test.describe("action inventory (ULI-A01, ULI-A06, ULI-A09)", () => {
  test("initial GitHub-handoff state exposes exactly the declared actions", async ({ page }) => {
    await page.goto("./");
    // Declared inventory: anything added later must be inventoried here too.
    const links = ["Skip to reporting form", "Vitium reporting home", "View existing reports"];
    const buttons = ["Review my report"];
    await expect(page.getByRole("link")).toHaveCount(links.length);
    for (const name of links) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(1);
    await expect(page.getByRole("button")).toHaveCount(buttons.length);
    for (const name of buttons) await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    await expect(page.getByRole("combobox")).toHaveCount(2);
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expect(page.locator("summary")).toHaveCount(1);
    // No placeholder destinations anywhere in the document, hidden states included.
    const hrefs = await page.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    for (const href of hrefs) expect(href, "placeholder or script link").not.toMatch(/^(#?$|javascript:)/i);
    // The feature-gated private path is not offered while disabled.
    await expect(control.sendPrivate(page)).toBeHidden();
  });

  test("review state exposes exactly Edit and Continue to GitHub", async ({ page }) => {
    await page.goto("./");
    await fillReport(page);
    await control.review(page).click();
    await expect(control.reviewHeading(page)).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(control.edit(page)).toBeEnabled();
    await expect(control.github(page)).toBeVisible();
    await expect(control.sendPrivate(page)).toBeHidden();
  });
});

test.describe("navigation and calls to action reach real destinations (ULI-A01, ULI-A02, ULI-L06)", () => {
  test("wordmark returns to the reporting home", async ({ page }) => {
    await page.goto("./#report");
    const home = page.getByRole("link", { name: "Vitium reporting home" });
    await expect(home).toHaveAttribute("href", "./");
    await home.click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
    await expect(page.getByRole("heading", { name: "Report a defect" })).toBeVisible();
  });

  test("View existing reports opens the public GitHub issue list in a new tab", async ({ page }) => {
    await page.goto("./");
    const link = page.getByRole("link", { name: "View existing reports" });
    await expect(link).toHaveAttribute("href", GITHUB_ISSUES);
    await expect(link).toHaveAttribute("rel", /noopener/);
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await expect(popup).toHaveURL(GITHUB_ISSUES);
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  });

  test("skip link moves the keyboard to the reporting form", async ({ page }) => {
    await page.goto("./");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to reporting form" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#report$/);
    await page.keyboard.press("Tab");
    await expect(control.product(page)).toBeFocused();
  });

  test("without scripting only the honest GitHub fallback is offered", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route(url => !url.href.startsWith("http://127.0.0.1"), route => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.goto(baseURL);
    const fallback = page.getByRole("link", { name: "report directly through GitHub" });
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute("href", GITHUB_ISSUES + "/new");
    // The guided form would POST to a destination the form-action policy
    // refuses, so its enabled-but-inert submit button must not be shown.
    await expect(page.getByRole("button", { name: "Review my report" })).toBeHidden();
    await context.close();
  });
});

test.describe("GitHub handoff workflow (ULI-A02, ULI-A05, ULI-A07, ULI-A10)", () => {
  test("Review shows the normalized report and Continue opens a prefilled, unsubmitted GitHub issue", async ({ page }) => {
    await page.goto("./");
    await expect(control.progress(page)).toHaveText("Step 1 of 2 · Describe the problem");
    await fillReport(page, { pageUrl: "https://example.com/app/items?token=secret#frag", steps: "1. Open\n2. Tap Save" });
    await expectActionOutcome(page, {
      ruleId: "ULI-A02",
      action: { role: "button", name: "Review my report" },
      outcome: { kind: "visible", target: { role: "heading", name: "Does this look right?" }, expected: true }
    });
    await expect(control.progress(page)).toHaveText("Step 2 of 2 · Review your report");
    await expect(page.locator("#review")).toBeFocused();
    await expect(page.locator("#preview-product")).toHaveText("Forma");
    await expect(page.locator("#preview-title")).toHaveText("Save button does nothing on my phone");
    // Query and fragment are removed before display and before handoff.
    await expect(page.locator("#preview-pageUrl")).toHaveText("https://example.com/app/items");
    await expect(page.getByText("The report is not yet submitted.")).toBeVisible();

    const github = control.github(page);
    const href = new URL(await github.getAttribute("href"));
    expect(href.origin + href.pathname).toBe(GITHUB_ISSUES + "/new");
    expect(href.searchParams.get("title")).toBe("[Forma] Save button does nothing on my phone");
    expect(href.searchParams.get("body")).toContain("I tapped Save and nothing changed.");
    expect(href.searchParams.get("body")).not.toContain("secret");

    const [popup] = await Promise.all([page.waitForEvent("popup"), github.click()]);
    await expect(popup).toHaveURL(href.toString());
    // Opening GitHub is not submission: Vitium must not claim receipt.
    await expect(control.reviewHeading(page)).toBeVisible();
    await expect(page.getByText("Report received")).toBeHidden();
  });

  test("missing required fields keep the user on the form with native validation", async ({ page }) => {
    await page.goto("./");
    await control.review(page).click();
    await expect(control.reviewHeading(page)).toBeHidden();
    await expect(control.product(page)).toBeFocused();
    expect(await control.product(page).evaluate(node => node.validity.valueMissing)).toBe(true);
    await expect(control.progress(page)).toHaveText("Step 1 of 2 · Describe the problem");
  });

  test("unsafe page URL is refused with a focused error, then recovers after correction", async ({ page }) => {
    await page.goto("./");
    await fillReport(page, { pageUrl: "javascript:alert(1)" });
    await control.review(page).click();
    await expect(control.feedback(page)).toHaveText("The page URL must start with http or https.");
    await expect(control.feedback(page)).toBeFocused();
    await expect(control.reviewHeading(page)).toBeHidden();
    await control.pageUrl(page).fill("https://example.com/ok");
    await control.review(page).click();
    await expect(control.reviewHeading(page)).toBeVisible();
    await expect(control.feedback(page)).toBeHidden();
    await expect(page.locator("#preview-pageUrl")).toHaveText("https://example.com/ok");
  });

  test("a report too long for a GitHub link is refused, then accepted once shortened", async ({ page }) => {
    await page.goto("./");
    await fillReport(page, { actual: "é".repeat(1200), expected: "è".repeat(1200) });
    await control.review(page).click();
    await expect(control.feedback(page)).toContainText("too long for GitHub's submission link");
    await expect(control.reviewHeading(page)).toBeHidden();
    await control.actual(page).fill("Short description.");
    await control.expected(page).fill("Short expectation.");
    await control.review(page).click();
    await expect(control.reviewHeading(page)).toBeVisible();
  });

  test("Edit returns to the form with the draft intact and focus on the summary", async ({ page }) => {
    await page.goto("./");
    await fillReport(page);
    await control.review(page).click();
    await expectActionOutcome(page, {
      ruleId: "ULI-A02",
      action: { role: "button", name: "← Edit report" },
      outcome: { kind: "visible", target: { role: "button", name: "Review my report" }, expected: true }
    });
    await expect(control.title(page)).toBeFocused();
    await expect(control.title(page)).toHaveValue("Save button does nothing on my phone");
    await expect(control.progress(page)).toHaveText("Step 1 of 2 · Describe the problem");
  });

  test("the whole workflow is operable by keyboard (ULI-A08)", async ({ page }) => {
    await page.goto("./");
    await control.product(page).focus();
    await control.product(page).selectOption("Ordo"); // native select; keyboard selection is browser-owned
    await page.keyboard.press("Tab");
    await expect(control.impact(page)).toBeFocused();
    await control.impact(page).selectOption("Not sure");
    await page.keyboard.press("Tab");
    await expect(control.title(page)).toBeFocused();
    await page.keyboard.type("Keyboard summary");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Actual");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Expected");
    await page.keyboard.press("Tab");
    await expect(control.details(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(control.steps(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(control.privacy(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(control.privacy(page)).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(control.review(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(control.reviewHeading(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(control.edit(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(control.github(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(control.title(page)).toBeFocused();
  });
});

test.describe("feature-gated private intake candidate (ULI-A03, ULI-A04, ULI-A07, ULI-A10)", () => {
  test("a failed send never shows success; retry reuses the request and confirms only a valid receipt", async ({ page }) => {
    await enablePrivateCandidate(page);
    let releaseFirst;
    const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
    const posts = await routeIntake(page, async (route, attempt, cors) => {
      if (attempt === 1) {
        await firstHeld;
        return route.fulfill({ status: 503, headers: cors, contentType: "application/json", body: JSON.stringify({ message: "The report could not be saved. Please retry." }) });
      }
      return route.fulfill({ status: 201, headers: cors, contentType: "application/json", body: JSON.stringify({ status: "received", reference: "VIT-TEST0001AB" }) });
    });
    await page.goto("./");
    await expect(page.getByRole("link", { name: "View existing reports" })).toBeHidden();
    await fillReport(page);
    await control.review(page).click();
    await expect(page.getByText("Review before sending")).toBeVisible();
    await expect(page.locator("#turnstile-challenge")).toHaveText("Verification (test stub)");

    const send = control.sendPrivate(page);
    await send.click();
    // In flight: both actions are disabled rather than enabled-but-inert.
    await expect(send).toHaveAccessibleName("Sending…");
    await expect(send).toBeDisabled();
    await expect(control.edit(page)).toBeDisabled();
    releaseFirst();

    await expect(control.feedback(page)).toHaveText("The report could not be saved. Please retry.");
    await expect(page.getByRole("heading", { name: "Thank you for reporting this." })).toBeHidden();
    await expect(send).toHaveAccessibleName("Send private report");
    await expect(send).toBeEnabled();
    await expect(control.edit(page)).toBeEnabled();

    await send.click();
    await expect(page.getByRole("heading", { name: "Thank you for reporting this." })).toBeVisible();
    await expect(page.locator("#report-reference")).toHaveText("VIT-TEST0001AB");
    await expect(control.progress(page)).toHaveText("Report received");
    expect(posts).toHaveLength(2);
    expect(posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[1].idempotencyKey, "a retry must replay the same request").toBe(posts[0].idempotencyKey);
    expect(posts[1].body.challengeToken, "a one-time challenge token is not reused").not.toBe(posts[0].body.challengeToken);

    await page.getByRole("button", { name: "Report another problem" }).click();
    await expect(control.product(page)).toBeFocused();
    await expect(control.title(page)).toHaveValue("");
    await expect(control.progress(page)).toHaveText("Step 1 of 2 · Describe the problem");
  });

  test("a 2xx response without a valid receipt is not treated as success", async ({ page }) => {
    await enablePrivateCandidate(page);
    await routeIntake(page, (route, attempt, cors) =>
      route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ status: "ok" }) }));
    await page.goto("./");
    await fillReport(page);
    await control.review(page).click();
    await expect(page.locator("#turnstile-challenge")).toHaveText("Verification (test stub)");
    await control.sendPrivate(page).click();
    await expect(control.feedback(page)).toHaveText("The service did not confirm receipt. Please retry.");
    await expect(page.getByRole("heading", { name: "Thank you for reporting this." })).toBeHidden();
  });

  test("a dropped connection reports that receipt is unconfirmed", async ({ page }) => {
    await enablePrivateCandidate(page);
    await routeIntake(page, route => route.abort("connectionreset"));
    await page.goto("./");
    await fillReport(page);
    await control.review(page).click();
    await expect(page.locator("#turnstile-challenge")).toHaveText("Verification (test stub)");
    await control.sendPrivate(page).click();
    await expect(control.feedback(page)).toContainText("your report has not been confirmed");
    await expect(page.getByRole("heading", { name: "Thank you for reporting this." })).toBeHidden();
    await expect(control.sendPrivate(page)).toBeEnabled();
  });
});

// Declared alignment groups. Peers are declared from product structure, never
// inferred from CSS coincidence.
const CLASSIFICATION_ROW = {
  ruleId: "ULI-L01",
  id: "classification-row-controls",
  edge: "top",
  peers: [
    { role: "combobox", name: "Which application?" },
    { role: "combobox", name: "How much does it affect you?" }
  ]
};
const REVIEW_ACTIONS_TOP = {
  ruleId: "ULI-L10",
  id: "review-actions-row",
  edge: "top",
  peers: [{ role: "button", name: "← Edit report" }, { role: "link", name: "Continue to GitHub" }]
};
const REVIEW_ACTIONS_STACKED = { ...REVIEW_ACTIONS_TOP, id: "review-actions-stacked", edge: "left" };

const twoColumn = width => width > 580; // site/styles.css stacks the row at <= 580 CSS px

test.describe("alignment groups (ULI-L01, ULI-L02, ULI-L07, ULI-L10)", () => {
  for (const width of [...VIEWPORT_WIDTHS, LABEL_WRAP_WIDTH]) {
    test(`classification row at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto("./");
      if (!twoColumn(width)) {
        // NOT_APPLICABLE: the fields are stacked, not peers in one visual row.
        // Assert that composition so the classification cannot silently change.
        const [a, b] = [await control.product(page).boundingBox(), await control.impact(page).boundingBox()];
        expect(b.y).toBeGreaterThan(a.y + a.height);
        test.info().annotations.push({ type: "ULI-L01", description: `NOT_APPLICABLE at ${width}px: stacked single-column composition` });
        return;
      }
      const report = await expectPeerAlignment(page, CLASSIFICATION_ROW);
      test.info().annotations.push({ type: "ULI-L01", description: formatReport(report) });
    });
  }

  for (const width of [768, LABEL_WRAP_WIDTH, 1280]) {
    test(`classification row stays aligned with a long translated label at ${width}px (ULI-L05)`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto("./");
      await page.locator("label[for=impact]").evaluate(label => {
        label.firstChild.textContent = "Wie stark beeinträchtigt Sie dieses Problem bei Ihrer täglichen Arbeit? ";
      });
      const labels = await page.locator(".form-grid label").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
      expect(labels[1], "the injected label must actually wrap for this to test anything").toBeGreaterThan(labels[0] + 1);
      // The label is the accessible name, so the declared peer follows it.
      await expectPeerAlignment(page, {
        ...CLASSIFICATION_ROW,
        id: "classification-row-controls-long-label",
        peers: [CLASSIFICATION_ROW.peers[0], { role: "combobox", name: "Wie stark beeinträchtigt Sie dieses Problem bei Ihrer täglichen Arbeit?" }]
      });
      await expectNoOverflow(page, `long label at ${width}px`);
    });
  }

  for (const width of VIEWPORT_WIDTHS) {
    test(`single-line controls share one block size at ${width}px (ULI-L02)`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto("./");
      await settleFontsAndFrames(page);
      const heights = await Promise.all([control.product(page), control.impact(page), control.title(page)].map(async locator => (await locator.boundingBox()).height));
      expect(Math.max(...heights) - Math.min(...heights), JSON.stringify(heights)).toBeLessThanOrEqual(1);
    });

    test(`review actions align and share geometry at ${width}px (ULI-L07, ULI-L10)`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto("./");
      await fillReport(page);
      await control.review(page).click();
      await expect(control.reviewHeading(page)).toBeVisible();
      const group = twoColumn(width) ? REVIEW_ACTIONS_TOP : REVIEW_ACTIONS_STACKED;
      await expectPeerAlignment(page, group);
      const [edit, github] = [await control.edit(page).boundingBox(), await control.github(page).boundingBox()];
      expect(Math.abs(edit.height - github.height), "equal button heights in one group").toBeLessThanOrEqual(1);
      // Predictable order: Edit precedes Continue in reading order at every width.
      if (twoColumn(width)) expect(edit.x).toBeLessThan(github.x);
      else expect(edit.y).toBeLessThan(github.y);
    });
  }

  test("an undeclared or missing peer is UNKNOWN, never PASS", async ({ page }) => {
    await page.goto("./");
    const report = await measureAlignment(page, REVIEW_ACTIONS_TOP); // review hidden in initial state
    expect(report.status).toBe(STATUS.UNKNOWN);
  });
});

test.describe("responsive overflow and state geometry (ULI-L05, ULI-L06, ULI-L08, ULI-L09)", () => {
  for (const width of [...VIEWPORT_WIDTHS, ZOOM_200_WIDTH]) {
    test(`no clipping or horizontal scroll across states at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto("./");
      await settleFontsAndFrames(page);
      await expectNoOverflow(page, `initial ${width}px`);
      // Navigation label integrity: readable name, fully inside the viewport.
      const nav = page.getByRole("link", { name: "View existing reports" });
      await expect(nav).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole("link", { name: "Vitium reporting home" })).toBeInViewport({ ratio: 1 });

      await fillReport(page, {
        title: "Averyveryveryverylongunbrokensummarywordthatmustwrapwithoutoverflow",
        pageUrl: "javascript:alert(1)"
      });
      await control.review(page).click();
      await expect(control.feedback(page)).toBeVisible();
      await control.review(page).scrollIntoViewIfNeeded();
      await expect(control.review(page)).toBeInViewport({ ratio: 1 }); // critical action fully reachable, not clipped offscreen
      await expectNoOverflow(page, `error state ${width}px`);

      await control.pageUrl(page).fill("https://example.com/" + "segment".repeat(40));
      await control.review(page).click();
      await expect(control.reviewHeading(page)).toBeVisible();
      await expectNoOverflow(page, `review state ${width}px`);
      await control.github(page).scrollIntoViewIfNeeded();
      await expect(control.github(page)).toBeInViewport({ ratio: 1 });
      await expect(control.edit(page)).toBeInViewport({ ratio: 1 });
    });
  }

  test("mobile keeps semantic order: guidance, form fields, consent, then the action (ULI-L09)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: HEIGHT });
    await page.goto("./");
    const order = await page.locator("h1, h2, select, input, textarea, button").evaluateAll(nodes =>
      nodes.filter(node => node.getBoundingClientRect().height > 0).map(node => node.id || node.textContent.trim().slice(0, 24)));
    expect(order.indexOf("product")).toBeLessThan(order.indexOf("impact"));
    expect(order.indexOf("impact")).toBeLessThan(order.indexOf("title"));
    expect(order.indexOf("privacyAcknowledged")).toBeLessThan(order.findIndex(text => text.startsWith("Review my report")));
  });
});

test.describe("motion preference (ULI-A06, ULI-L08)", () => {
  test("reduced motion removes button transitions; default keeps them short", async ({ browser, baseURL }) => {
    for (const [reducedMotion, expected] of [["reduce", "0s"], ["no-preference", "0.12s"]]) {
      const context = await browser.newContext({ reducedMotion });
      await context.route(url => !url.href.startsWith("http://127.0.0.1"), route => route.abort("blockedbyclient"));
      const page = await context.newPage();
      await page.goto(baseURL);
      await expect(page.getByRole("button", { name: "Review my report" })).toHaveCSS("transition-duration", expected);
      await context.close();
    }
  });
});
