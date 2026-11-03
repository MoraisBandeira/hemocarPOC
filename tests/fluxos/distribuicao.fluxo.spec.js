// Fluxo da DISTRIBUIÇÃO (Noite/Fds): analisa pedidos aceitos, escala e edita rotas.
const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, aprovarRotaApi, abrirComoPerfil, irParaAba } = require("../helpers");
const { escalarNaTela } = require("./passos");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Fluxo da Distribuição (Noite/Fds)", () => {
  test("vê apenas pedidos de amostras, hemocomponentes e medicamentos", async ({ page, request }) => {
    const visivel = await criarPedidoApi(request, { tipo: "medicamentos", solicitante: "Maria Souza" });
    const oculto = await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Carlos Lima" });
    await aceitarPedidoApi(request, visivel.id);
    await aceitarPedidoApi(request, oculto.id);
    await abrirComoPerfil(page, "distribuicao");
    await irParaAba(page, "Análise de Pedidos");

    await expect(page.locator(`[data-iniciar-analise="cancelar"][data-pedido-id="${visivel.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-iniciar-analise="cancelar"][data-pedido-id="${oculto.id}"]`)).toHaveCount(0);
  });

  test("tem só as abas de análise, rotas e cadastros", async ({ page }) => {
    await abrirComoPerfil(page, "distribuicao");

    await expect(page.locator("#tabs .tab-btn")).toHaveText(["Análise de Pedidos", "Rotas Programadas", "Cadastros"]);
  });

  test("escala um pedido de medicamentos sem o aceite do transporte", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "medicamentos" });
    await abrirComoPerfil(page, "distribuicao");

    await escalarNaTela(page, [pedido.id]);

    const { rotas } = await lerEstado(request);
    expect(rotas).toHaveLength(1);
    expect(rotas[0].pedidoIds).toEqual([pedido.id]);
  });

  test("escala um pedido aceito pelo transporte e vê a rota programada", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request);
    await request.post(`/api/pedidos/${pedido.id}/aceitar`, { data: { tipoTransporte: "hemoce" } });
    await abrirComoPerfil(page, "distribuicao");

    await test.step("escala o pedido em uma rota", async () => {
      await escalarNaTela(page, [pedido.id]);
    });

    await test.step("a rota aparece como Programada", async () => {
      await irParaAba(page, "Rotas Programadas");
      await expect(page.locator("#conteudo")).toContainText("Programada");
      await expect(page.locator("#conteudo")).toContainText("Hospital Universitário Walter Cantídio");
    });
  });

  test("edita o motorista de uma rota ainda programada", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request);
    await request.post(`/api/pedidos/${pedido.id}/aceitar`, { data: { tipoTransporte: "hemoce" } });
    const { rota } = await aprovarRotaApi(request, [pedido.id]);
    const { motoristas } = await lerEstado(request);
    await abrirComoPerfil(page, "distribuicao");
    await irParaAba(page, "Rotas Programadas");

    await test.step("abre a edição da rota e troca o motorista", async () => {
      await page.locator(`[data-editar-rota="${rota.id}"]`).click();
      await page.selectOption(`#motoristaEditar-${rota.id}`, motoristas[1].id);
      await page.getByRole("button", { name: "Salvar alterações" }).click();
      await expect(page.locator("#toast")).toHaveText("Rota atualizada.");
    });

    await test.step("o servidor guarda o novo motorista", async () => {
      const { rotas } = await lerEstado(request);
      expect(rotas.find((r) => r.id === rota.id).motoristaId).toBe(motoristas[1].id);
    });
  });

  test("consulta os motoristas e veículos cadastrados", async ({ page }) => {
    await abrirComoPerfil(page, "distribuicao");
    await irParaAba(page, "Cadastros");

    await expect(page.locator("#conteudo")).toContainText("Carlos Andrade");
    await expect(page.locator("#conteudo")).toContainText("HMC-1A23");
  });
});
