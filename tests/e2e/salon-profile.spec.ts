import { expect, test } from "@playwright/test";

test("owner renames the salon from Settings; booking page, texts and share link follow", async ({ page, browser }, info) => {
  const name = info.project.name === "phone" ? "Lan's Hair Studio" : "Fade Factory";
  await page.goto("/app/settings");
  await page.getByLabel("Salon name").fill(name);
  await page.getByLabel("Owner first name").fill("Lan");
  await page.getByLabel("Vietnamese title").selectOption("chị");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Everything now shows “${name}”` })).toBeVisible();

  await page.goto("/book/demo?lang=en");
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // Missed-call text uses the new name and owner
  await page.goto("/app/receptionist");
  // Fresh number per run: the 12-hour rule would (correctly) skip a number texted by another test.
  await page.getByLabel("Caller phone").fill(info.project.name === "phone" ? "(763) 555-0161" : "(763) 555-0162");
  await page.getByRole("button", { name: /Simulate the call ending/ }).click();
  await page.getByRole("button", { name: "CALL", exact: true }).click();
  const short = name.split(/\s+(?:Barber|Salon|&)/)[0];
  await expect(page.getByRole("log").getByText(`${short}: Thanks! Lan will call you back soon.`)).toBeVisible();

  // Share link works in a completely fresh browser (the prospect's phone)
  await page.goto("/app/settings");
  const link = await page.getByLabel("Booking page share link").inputValue();
  const fresh = await browser.newContext();
  const prospect = await fresh.newPage();
  await prospect.goto(link.replace(/^https?:\/\/[^/]+/, info.project.use.baseURL!));
  await expect(prospect).toHaveURL(/\/book\/demo$/); // param removed after it's saved
  await expect(prospect.getByRole("heading", { level: 1, name })).toBeVisible();
  await fresh.close();

  // Reset back to the default demo salon
  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Back to the default demo salon" })).toBeVisible();
  await page.goto("/book/demo?lang=en");
  await expect(page.getByRole("heading", { level: 1, name: "Main Street Barber & Salon" })).toBeVisible();
});
