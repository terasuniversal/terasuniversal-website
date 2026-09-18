import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertVisibleCorporateShell, installRuntimeGuards } from "./support/guards";

test.describe("CRM authenticated staging smoke", () => {
  test.beforeEach(async () => {
    test.skip(!process.env.CRM_STORAGE_STATE, "CRM_STORAGE_STATE is required; no personal browser session is used.");
  });

  for (const route of ["/admin/dashboard", "/admin/sales", "/admin/participants", "/admin/schedules"]) {
    test(`${route} exposes the expected read-only UI surface`, async ({ page }) => {
      const finishGuards = installRuntimeGuards(page);
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForURL(/\/admin\/(dashboard|sales|participants|schedules|no-access)/, { timeout: 60000 });
      await expect(page).not.toHaveURL(/\/admin\/login/, { timeout: 15000 });
      if (page.url().includes("/admin/no-access")) {
        await expect(page.getByRole("heading", { name: "Insufficient permissions" })).toBeVisible();
        await expect(page.getByText("Your role doesn't have access to that section.")).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await finishGuards();
        return;
      }
      await assertVisibleCorporateShell(page);
      await expect(page.locator("aside.ta-sidebar")).toBeVisible();
      await expect(page.locator(".ta-topbar")).toBeVisible();
      await expect(page.locator("main").first()).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await finishGuards();
    });
  }

  test("preserves genuine empty states for filtered Sales lists", async ({ page }) => {
    test.setTimeout(120000);
    const finishGuards = installRuntimeGuards(page);
    for (const [route, emptyMessage] of [
      ["/admin/sales/leads?q=__qa_empty_state__", "No leads match this view."],
      ["/admin/sales/opportunities?q=__qa_empty_state__", "No opportunities match these filters."],
      ["/admin/sales/quotations?q=__qa_empty_state__", "No quotations yet. Create one from an Opportunity's detail page."],
    ] as const) {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForURL(/\/admin\/sales\/((leads)|(opportunities)|(quotations))/, { timeout: 60000 });
      await expect(page).not.toHaveURL(/\/admin\/login/, { timeout: 15000 });
      await expect(page.getByText(emptyMessage)).toBeVisible();
      await expect(page.locator('.ta-empty[role="alert"]')).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Unable to load this view" })).toHaveCount(0);
    }
    await assertNoHorizontalOverflow(page);
    await finishGuards();
  });

  test("explains the Lead to Opportunity handoff without opening a free-create path", async ({ page }) => {
    const finishGuards = installRuntimeGuards(page);
    await page.goto("/admin/sales/opportunities/new", { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(page.getByRole("heading", { name: "Create Opportunity" })).toBeVisible();
    await expect(page.getByText("Opportunities are created from a qualified Lead.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Leads" })).toHaveAttribute("href", "/admin/sales/leads");
    await expect(page.locator('input[name="title"]')).toHaveCount(0);
    await finishGuards();
  });

  test("exposes associated labels and unique IDs on quotation controls", async ({ page }) => {
    const finishGuards = installRuntimeGuards(page);
    await page.goto("/admin/sales/quotations/fe3de8cd-9989-4c22-9f8b-f17367e1984a");
    const association = await page.locator("label[for]").evaluateAll((labels) => {
      const ids = labels.map((label) => (label as HTMLLabelElement).htmlFor);
      const controls = new Set([...document.querySelectorAll("input[id], select[id], textarea[id]")].map((control) => control.id));
      return { labels: ids.length, uniqueLabels: new Set(ids).size, allControlsExist: ids.every((id) => controls.has(id)) };
    });
    expect(association.labels).toBeGreaterThan(0);
    expect(association.uniqueLabels).toBe(association.labels);
    expect(association.allControlsExist).toBeTruthy();
    await expect(page.locator("#quotation-customer-company")).toBeVisible();
    await expect(page.locator("#quotation-line-0-quantity")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await finishGuards();
  });
});
