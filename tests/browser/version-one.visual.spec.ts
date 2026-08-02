import { expect, test, type Page } from "@playwright/test";

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "warning") failures.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", error => failures.push(`page error: ${error.message}`));
  return failures;
}

async function openReadyScenario(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#scenario-title")).not.toHaveText("Loading…");
  await expect(page.locator("#scenario-status")).toHaveText("Valid");
  await expect(page.locator("#validation-list .error")).toHaveCount(0);
}

test("authoring surface matches the accepted desktop and tablet baselines", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await openReadyScenario(page);
  await expect(page.locator("[data-panel=author]")).toBeVisible();
  await expect(page.locator("[data-tool]")).toHaveCount(9);
  expect(failures).toEqual([]);
  await expect(page).toHaveScreenshot("author-desktop.png", { fullPage: false });

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator(".tool-group")).toBeVisible();
  await expect(page).toHaveScreenshot("author-tablet.png", { fullPage: false });
});

test("deterministic replay and observation overlays match the accepted baseline", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await openReadyScenario(page);
  await page.locator("#run-scenario").click();
  await expect(page.locator("[data-panel=replay]")).toBeVisible();
  await expect(page.locator("#replay-heading")).not.toHaveText("No run loaded");
  await page.locator("#observation-overlay").check();
  await page.locator("#replay-tick").evaluate((element: HTMLInputElement) => {
    element.value = element.max;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#event-list .event-item").first()).toBeVisible();
  expect(failures).toEqual([]);
  await expect(page).toHaveScreenshot("replay-overlay.png", { fullPage: false });
});

test("paired comparison results match the accepted baseline", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await openReadyScenario(page);
  await page.locator('[data-view="compare"]').click();
  await expect(page.locator("[data-panel=compare]")).toBeVisible();
  await page.locator("#compare-seeds").fill("101, 102");
  await page.locator("#run-comparison").click();
  await expect(page.locator("#comparison-results .metric-card").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#comparison-results .comparison-table tbody tr")).toHaveCount(2);
  expect(failures).toEqual([]);
  await expect(page).toHaveScreenshot("comparison-results.png", { fullPage: false });
});
