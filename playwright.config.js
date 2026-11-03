// @ts-check
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

// Cada servidor de teste tem porta, pasta de dados e relógio próprios, para não disputar o
// data/db.json de uma instância real. O relógio fixo torna a regra de expediente determinística:
// - suíte principal: terça-feira, 10:00 (dentro do expediente);
// - projeto "fora-do-expediente": sábado, 12:00.
const RELOGIO_EXPEDIENTE = "2026-11-03T10:00:00-03:00";
const RELOGIO_FORA = "2026-11-07T12:00:00-03:00";
const PORTA_TESTES = 4173;
const PORTA_FORA = 4174;
const ESPECIFICOS_FORA = ["**/fluxos/distribuicao.fluxo.spec.js", "**/api/responsavel-fora.spec.js"];

/** Servidor de teste isolado, com seu relógio e sua pasta de dados. */
function servidor(porta, relogio, pasta) {
  const pastaDados = path.join(__dirname, "test-results", pasta);
  return {
    command: "node server.js",
    url: `http://localhost:${porta}/api/estado`,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      PORT: String(porta),
      DATA_DIR: pastaDados,
      LOG_DIR: path.join(pastaDados, "logs"),
      HEMOCAR_AGORA: relogio,
    },
  };
}

module.exports = defineConfig({
  testDir: "./tests",
  // todos os testes de um projeto compartilham um único servidor e um único banco: roda um de cada vez
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: ESPECIFICOS_FORA,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORTA_TESTES}` },
    },
    {
      name: "fora-do-expediente",
      testMatch: ESPECIFICOS_FORA,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORTA_FORA}` },
    },
  ],
  webServer: [
    servidor(PORTA_TESTES, RELOGIO_EXPEDIENTE, "servidor"),
    servidor(PORTA_FORA, RELOGIO_FORA, "servidor-fora"),
  ],
});
