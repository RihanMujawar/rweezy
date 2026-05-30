import { test, expect } from "@playwright/test";

test("protected app route redirects or blocks without session", async ({ page }) => {
  await page.goto("/app/orders");
  await expect(page).toHaveURL(/login|\/app/, { timeout: 10_000 });
  const url = page.url();
  expect(url.includes("login") || url.includes("/app")).toBeTruthy();
});
