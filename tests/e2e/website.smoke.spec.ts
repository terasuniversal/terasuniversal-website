import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertVisibleCorporateShell, installRuntimeGuards } from "./support/guards";

const publicRoutes = ["/", "/training", "/services", "/about", "/contact", "/request-proposal"];

test.describe("TERAS public website smoke", () => {
  for (const route of publicRoutes) {
    test(`${route} loads with the corporate shell`, async ({ page }) => {
      const finishGuards = installRuntimeGuards(page);
      const response = await page.goto(route);
      expect(response?.ok(), `${route} did not return a successful response`).toBeTruthy();
      await assertVisibleCorporateShell(page);
      await expect(page.locator("header.site-header")).toBeVisible();
      await expect(page.getByAltText("TERAS UNIVERSAL logo")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await finishGuards();
    });
  }

  test("contact and proposal forms are visible but never submitted", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.locator("form").first()).toBeVisible();
    await expect(page.locator("form").first().locator("button[type='submit']")).toBeVisible();
    await page.goto("/request-proposal");
    await expect(page.locator("form").first()).toBeVisible();
  });
});
