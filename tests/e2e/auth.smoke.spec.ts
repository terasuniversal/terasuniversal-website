import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, installRuntimeGuards } from "./support/guards";

test.describe("CRM authentication boundary", () => {
  test("renders the sign-in boundary without submitting credentials", async ({ page }) => {
    const finishGuards = installRuntimeGuards(page);
    await page.goto("/admin/login");
    await expect(page).toHaveTitle(/TERAS|Admin/i);
    await expect(page.getByRole("heading", { name: "Admin Sign In" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute("type", "email");
    await expect(page.getByRole("textbox", { name: "Password", exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await finishGuards();
  });

  test("does not claim authenticated readiness without a staging storageState", async () => {
    test.skip(!process.env.CRM_STORAGE_STATE, "CRM_STORAGE_STATE is required for authenticated staging checks.");
    expect(process.env.CRM_STORAGE_STATE).toBeTruthy();
  });
});
