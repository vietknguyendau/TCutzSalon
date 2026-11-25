import { expect, test } from "@playwright/test";

test("missed call → text with link → caller replies CALL → shows on Today → owner marks done", async ({ page }, info) => {
  const phone = info.project.name === "phone" ? "(763) 555-0171" : "(763) 555-0172";
  await page.goto("/app/receptionist");
  await page.getByLabel("Caller phone").fill(phone);
  await page.getByRole("button", { name: /Simulate the call ending/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Text sent right away" })).toBeVisible();
  const thread = page.getByRole("log", { name: "Simulated text thread" });
  await expect(thread.getByText(/Sorry we missed your call! Book here: .*\/book\/demo\?r=m/)).toBeVisible();

  await page.getByRole("button", { name: "CALL", exact: true }).click();
  await expect(thread.getByText("Main Street: Thanks! Alex will call you back soon.")).toBeVisible();

  // Calling again right away doesn't text twice
  await page.getByRole("button", { name: /Simulate the call ending/ }).click();
  await expect(page.getByText(/Already texted this number/)).toBeVisible();

  await page.goto("/app/today");
  const row = page.locator("li", { hasText: "Asked for a call back" }).filter({ hasText: phone });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Mark done" }).click();
  await expect(row).toHaveCount(0);
});

test("landline caller is put on the call-back list instead of texted", async ({ page }) => {
  await page.goto("/app/today");
  await expect(page.locator("li", { hasText: "Robert Anderson" }).getByText(/landline/)).toBeVisible();
  await page.goto("/app/receptionist");
  await page.getByRole("button", { name: /Robert · landline/ }).click();
  await page.getByRole("button", { name: /Simulate the call ending/ }).click();
  await expect(page.getByText(/Landline — it can't receive texts/)).toBeVisible();
});

test("Vietnamese caller after hours gets a Vietnamese text held until 9 AM", async ({ page }, info) => {
  await page.goto("/app/receptionist");
  await page.getByLabel("Caller phone").fill(info.project.name === "phone" ? "(763) 555-0173" : "(763) 555-0174");
  await page.getByRole("radio", { name: /Tiếng Việt/ }).click();
  await page.getByRole("radio", { name: /9:45 PM tonight/ }).click();
  await page.getByRole("button", { name: /Simulate the call ending/ }).click();
  await expect(page.getByText(/quiet hours.*9:00 AM/)).toBeVisible();
  await expect(page.getByRole("log", { name: "Simulated text thread" }).getByText(/Xin lỗi đã lỡ cuộc gọi/)).toBeVisible();
});

test("booking from the text link is credited to missed-call texts", async ({ page }, info) => {
  await page.goto("/book/demo?r=m");
  await page.getByRole("button", { name: /English/ }).click();
  await page.getByRole("button", { name: /Beard trim/ }).click();
  await page.getByRole("button", { name: /First available/ }).click();
  await page.getByRole("option").nth(2).click();
  await page.locator("main button.h-14").nth(info.project.name === "phone" ? 1 : 2).click();
  await page.getByLabel("First name").fill("Kim");
  await page.getByLabel("Mobile number").fill(info.project.name === "phone" ? "763-555-0175" : "763-555-0176");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Confirm booking/ }).click();
  await expect(page.getByText("You're booked!")).toBeVisible();
  await page.goto("/app/analytics");
  const card = page.locator("div", { hasText: /^Booked from a missed-call text/ }).first();
  await expect(card).not.toContainText(/^Booked from a missed-call text0/);
});
