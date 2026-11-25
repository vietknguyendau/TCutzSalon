import { expect, test } from "@playwright/test";

test("customer books a men's haircut in Vietnamese and gets a manage link", async ({ page }) => {
  await page.goto("/book/demo");
  await expect(page.getByText("DEMO")).toBeVisible();
  await page.getByRole("button", { name: /Tiếng Việt/ }).click();
  await page.getByRole("button", { name: /Cắt tóc nam\s/ }).first().click();
  // Two stylists do men's cuts → stylist step
  await page.getByRole("button", { name: /Thợ nào rảnh trước/ }).click();
  // Pick a day 3 days out, then the first time
  await page.getByRole("option").nth(3).click();
  const firstTime = page.locator("main button.h-14").first();
  await expect(firstTime).toBeVisible();
  await firstTime.click();
  await page.getByLabel("Tên", { exact: true }).fill("Hằng");
  await page.getByLabel("Số điện thoại di động").fill("763-555-0142");
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.getByText("Xem lại lịch hẹn")).toBeVisible();
  await page.getByRole("button", { name: /Xác nhận đặt lịch/ }).click();
  await expect(page.getByText("Đã đặt lịch xong!")).toBeVisible();
  await page.getByRole("link", { name: "Đổi hoặc hủy lịch" }).click();
  await expect(page.getByText("Lịch hẹn của anh/chị")).toBeVisible();
});

test("returning customer verifies phone and books their usual", async ({ page }) => {
  await page.goto("/book/demo?lang=en");
  await page.getByRole("button", { name: /Book my usual/ }).click();
  await page.getByPlaceholder("Mobile number").fill("(763) 555-0103"); // Linh — single profile
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = (await page.locator("strong.tracking-widest").textContent())!.trim();
  await page.getByLabel("Enter the 6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/Women's haircut/)).toBeVisible(); // usual service preselected
  await page.getByRole("option").nth(4).click();
  await page.locator("main button.h-14").first().click();
  await expect(page.getByText("Review your appointment")).toBeVisible();
  await page.getByRole("button", { name: /Confirm booking/ }).click();
  await expect(page.getByText("You're booked!")).toBeVisible();
});

test("owner moves an appointment through arrived → in chair → done", async ({ page }, info) => {
  // Projects share one in-memory server, so each uses a different customer.
  const who = info.project.name === "phone" ? "Marcus" : "David";
  await page.goto("/app/today");
  await expect(page.getByText("DEMO MODE")).toBeVisible();
  const card = page.locator("article", { hasText: who });
  await card.getByRole("button", { name: /Arrived/ }).click();
  await expect(card.getByText("Arrived", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: /Start/ }).click();
  await card.getByRole("button", { name: /Done/ }).click();
  await expect(page.locator("article", { hasText: who }).getByText("Done", { exact: true })).toBeVisible();
});

test("customer profile shows haircut memory and Same as last time", async ({ page }) => {
  await page.goto("/app/customers");
  await page.getByRole("link", { name: /Minh Nguyen/ }).click();
  await expect(page.getByText("Low skin fade, textured crop").first()).toBeVisible();
  await expect(page.getByText(/Shares phone with/)).toBeVisible();
  await page.getByRole("link", { name: /Same as last time/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Minh Nguyen")).toBeVisible();
});
