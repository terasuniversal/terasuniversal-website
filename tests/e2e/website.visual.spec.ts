import { test, expect } from "@playwright/test";

test.describe("TERAS website visual QA", () => {
  for (const route of ["/", "/training", "/services", "/contact"]) {
    test(`${route} matches the approved screenshot baseline`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveScreenshot(`${route === "/" ? "home" : route.slice(1)}.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
