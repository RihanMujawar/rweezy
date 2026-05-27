import { test, expect } from "@playwright/test";

const demoEmail = process.env.DEMO_CUSTOMER_EMAIL ?? "demo.customer@rweezy.test";
const demoPassword = process.env.DEMO_PASSWORD ?? "Demo123456";

test.describe("authentication", () => {
  test("login page renders sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("demo customer can sign in when seeded", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(demoEmail);
    await page.getByLabel(/password/i).fill(demoPassword);
    await page.getByRole("button", { name: /sign in|login/i }).click();

    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /hello/i })).toBeVisible();
    await expect(page.getByText(/What would you like to do today\\?/i)).toBeVisible();
  });

  test("support page is reachable when logged in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(demoEmail);
    await page.getByLabel(/password/i).fill(demoPassword);
    await page.getByRole("button", { name: /sign in|login/i }).click();
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });

    await page.goto("/app/support");
    await expect(page.getByRole("heading", { name: /help|support/i })).toBeVisible();
  });

  test("orders page loads when logged in (empty state)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(demoEmail);
    await page.getByLabel(/password/i).fill(demoPassword);
    await page.getByRole("button", { name: /sign in|login/i }).click();
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });

    await page.goto("/app/orders");
    await expect(
      page.getByText(/No food orders yet|No grocery orders yet/i),
    ).toBeVisible();
  });
});
