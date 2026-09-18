import { test, expect } from "@playwright/test";

test.describe("CRM visual QA", () => {
  test.beforeEach(async () => {
    test.skip(!process.env.CRM_STORAGE_STATE, "CRM_STORAGE_STATE is required for authenticated CRM screenshots.");
  });

  for (const route of ["/admin/dashboard", "/admin/sales", "/admin/participants", "/admin/schedules"]) {
    test(`${route} matches the CRM screenshot baseline`, async ({ page }) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/admin\/login/);
      await expect(page).toHaveScreenshot(`${route.replaceAll("/", "-").replace(/^-/, "")}.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
