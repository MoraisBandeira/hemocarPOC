const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, abrirComoPerfil } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

const ABAS_POR_PERFIL = {
  solicitante: ["Novo Pedido", "Meus Pedidos"],
  transporte: ["Aceitar Solicitações", "Análise de Pedidos", "Rotas Programadas", "Cadastros"],
  distribuicao: ["Análise de Pedidos", "Rotas Programadas", "Cadastros"],
  portaria: ["Aguardando saída", "Em trânsito", "Histórico"],
  diretoria: ["Aprovação de Solicitações", "Análise Geral"],
};

test.describe("Perfis e navegação (interface)", () => {
  for (const [perfil, abas] of Object.entries(ABAS_POR_PERFIL)) {
    test(`perfil ${perfil} mostra as abas esperadas`, async ({ page }) => {
      await abrirComoPerfil(page, perfil);

      await expect(page.locator("#tabs .tab-btn")).toHaveText(abas);
    });
  }

  test("trocar o perfil ativo muda as abas exibidas", async ({ page }) => {
    await abrirComoPerfil(page, "solicitante");
    await expect(page.locator("#tabs .tab-btn")).toHaveText(ABAS_POR_PERFIL.solicitante);

    await page.selectOption("#perfil", "portaria");

    await expect(page.locator("#tabs .tab-btn")).toHaveText(ABAS_POR_PERFIL.portaria);
  });

  test("restaurar os dados de exemplo apaga os pedidos do servidor", async ({ page, request }) => {
    await criarPedidoApi(request);
    await abrirComoPerfil(page, "transporte");
    page.once("dialog", (dialogo) => dialogo.accept());

    await page.click("#resetDados");

    await expect.poll(async () => (await lerEstado(request)).pedidos.length).toBe(0);
  });
});
