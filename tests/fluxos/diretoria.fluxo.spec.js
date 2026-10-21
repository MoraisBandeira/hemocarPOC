// Fluxo da DIRETORIA: aprova solicitações urgentes de coleta externa antes de seguirem para análise.
const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, abrirComoPerfil, emHoras, paraDatetimeLocal } = require("../helpers");
const { aceitarNaTela } = require("./passos");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Fluxo da Diretoria", () => {
  test("aprova uma coleta externa urgente e ela segue para o transporte aceitar", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request, {
      tipo: "coleta_externa",
      dataDesejada: paraDatetimeLocal(emHoras(4)),
    });
    expect(pedido.status).toBe("aguardando_diretoria");

    await test.step("a diretoria vê a solicitação aguardando aprovação", async () => {
      await abrirComoPerfil(page, "diretoria");
      await expect(page.locator(`[data-aprovar-diretoria="${pedido.id}"]`)).toBeVisible();
    });

    await test.step("aprova a solicitação", async () => {
      await page.locator(`[data-aprovar-diretoria="${pedido.id}"]`).click();
      await expect.poll(async () => (await lerEstado(request)).pedidos[0].status).toBe("pendente");
    });

    await test.step("a equipe de transporte passa a ver a solicitação para aceitar", async () => {
      await page.selectOption("#perfil", "transporte");
      await expect(page.locator(`[data-aceitar-hemoce="${pedido.id}"]`)).toBeVisible();
      await aceitarNaTela(page, pedido.id, "hemoce");
    });
  });

  test("coleta externa com mais de 24h não aparece para a diretoria", async ({ page, request }) => {
    await criarPedidoApi(request, { tipo: "coleta_externa", dataDesejada: paraDatetimeLocal(emHoras(72)) });
    await abrirComoPerfil(page, "diretoria");

    await expect(page.locator("#conteudo")).toContainText("Nenhuma solicitação aguardando aprovação da diretoria.");
  });
});
