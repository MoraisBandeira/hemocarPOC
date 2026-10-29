const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, abrirComoPerfil, irParaAba, emHoras, paraDatetimeLocal } = require("../helpers");

const HUWC = "Hospital Universitário Walter Cantídio";

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Sugestão de agrupamento (interface)", () => {
  test("solicitante responde Sim e a equipe de transporte vê a resposta", async ({ page, request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Outra Pessoa", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await request.post(`/api/pedidos/${pedido.id}/sugerir-agrupamento`);
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

  test("Não pede a justificativa antes de registrar a recusa", async ({ page, request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Outra Pessoa", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await request.post(`/api/pedidos/${pedido.id}/sugerir-agrupamento`);
    await abrirComoPerfil(page, "solicitante");
    await irParaAba(page, "Meus Pedidos");

    await page.getByRole("button", { name: "Não", exact: true }).click();
    await expect(page.locator("textarea")).toHaveCount(1);
    expect((await lerEstado(request)).pedidos.find((p) => p.id === pedido.id).agrupamento.estado).toBe("aguardando");

    await page.locator("textarea").fill("Preciso sair antes do horário sugerido");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();

    await expect(page.locator("#conteudo")).toContainText("Você não quis juntar esta solicitação.");
    await expect(page.locator("#conteudo")).toContainText("Justificativa: Preciso sair antes do horário sugerido");
    const { agrupamento } = (await lerEstado(request)).pedidos.find((p) => p.id === pedido.id);
    expect(agrupamento.estado).toBe("recusado");
    expect(agrupamento.justificativa).toBe("Preciso sair antes do horário sugerido");
  });

  test("transporte sugere juntar pelo botão em Análise de Pedidos e o solicitante responde", async ({ page, request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Outra Pessoa", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await request.post(`/api/pedidos/${pedido.id}/aceitar`, { data: { tipoTransporte: "hemoce" } });
    await abrirComoPerfil(page, "transporte");
    await irParaAba(page, "Análise de Pedidos");

    await page.locator(`[data-sugerir-agrupamento="${pedido.id}"]`).click();
    await expect(page.locator("#toast")).toContainText("Sugestão enviada ao solicitante.");
    await expect(page.locator(`[data-sugerir-agrupamento="${pedido.id}"]`)).toHaveCount(0);

    await page.selectOption("#perfil", "solicitante");
    await irParaAba(page, "Meus Pedidos");
    await expect(page.locator("#conteudo")).toContainText("Pode juntar sua solicitação?");
  });
});
