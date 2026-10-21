// @ts-check
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

// Os testes sobem uma instância própria do servidor, numa porta e numa pasta de dados
// separadas — assim nunca disputam o data/db.json de uma instância real rodando.
const PORTA_TESTES = 4173;
const PASTA_TESTES = path.join(__dirname, "test-results", "servidor");

module.exports = defineConfig({
  testDir: "./tests",
  // todos os testes compartilham um único servidor e um único banco: roda um de cada vez
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORTA_TESTES}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node server.js",
    url: `http://localhost:${PORTA_TESTES}/api/estado`,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      PORT: String(PORTA_TESTES),
      DATA_DIR: PASTA_TESTES,
      LOG_DIR: path.join(PASTA_TESTES, "logs"),
    },
  },
});
