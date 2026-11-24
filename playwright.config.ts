import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses an installed Chrome when available (CI: run `npx playwright install chromium` and drop this).
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "tablet", use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
  ],
  webServer: {
    command: `PORT=${PORT} NEXT_PUBLIC_APP_URL=http://localhost:${PORT} E2E_DISABLE_RATE_LIMIT=1 npm start`,
    url: `http://localhost:${PORT}/app/today`,
    reuseExistingServer: false, // fresh in-memory demo state each run
    timeout: 60_000,
  },
});
