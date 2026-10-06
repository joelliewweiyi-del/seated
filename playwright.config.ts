import { defineConfig, devices } from '@playwright/test';

// Runs against the demo server: fake restaurants, in-memory database, no real requests.
const PORT = 4399;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx tsx --disable-warning=ExperimentalWarning src/server/main.ts --demo',
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/api/state`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
