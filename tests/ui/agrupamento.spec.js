const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, abrirComoPerfil, irParaAba, emHoras, paraDatetimeLocal } = require("../helpers");

const HUWC = "Hospital Universitário Walter Cantídio";

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Sugestão de agrupamento (interface)", () => {
  test("solicitante responde Sim e a equipe de transporte vê a resposta", async ({ page, request }) => {
    await criarPedidoApi(request, { solicitante: "Outra Pessoa", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await abrirComoPerfil(page, "solicitante");
    await irParaAba(page, "Meus Pedidos");

    await expect(page.locator("#conteudo")).toContainText("Pode juntar sua solicitação?");
    await expect(page.locator("#conteudo")).toContainText(HUWC);
    await page.getByRole("button", { name: "Sim, pode juntar" }).click();
    await expect(page.locator("#toast")).toContainText("aceitou juntar");

    await page.selectOption("#perfil", "transporte");
    await page.locator(`[data-aceitar-hemoce="${pedido.id}"]`).click();
    await page.locator("#tabs .tab-btn", { hasText: "Análise de Pedidos" }).click();
    await expect(page.locator("#conteudo")).toContainText("Solicitante aceitou juntar");
    expect((await lerEstado(request)).pedidos.find((p) => p.id === pedido.id).agrupamento.estado).toBe("aceito");
  });

  test("Não registra a recusa direto, sem pedir justificativa", async ({ page, request }) => {
    await criarPedidoApi(request, { solicitante: "Outra Pessoa", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await abrirComoPerfil(page, "solicitante");
    await irParaAba(page, "Meus Pedidos");

    await page.getByRole("button", { name: "Não", exact: true }).click();

    await expect(page.locator("#conteudo")).toContainText("Você não quis juntar esta solicitação.");
    await expect(page.locator("textarea")).toHaveCount(0);
    expect((await lerEstado(request)).pedidos.find((p) => p.id === pedido.id).agrupamento.estado).toBe("recusado");
  });
});
