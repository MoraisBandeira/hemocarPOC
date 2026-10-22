const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, abrirComoPerfil, irParaAba } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Equipe de Transporte (interface)", () => {
  test("aceita a solicitação como Transporte Hemoce e escala uma rota", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request);
    await abrirComoPerfil(page, "transporte");

    await page.locator(`[data-aceitar-hemoce="${pedido.id}"]`).click();
    await expect(page.locator("#toast")).toHaveText("Solicitação aceita como Transporte Hemoce.");

    await irParaAba(page, "Análise de Pedidos");
    await page.locator(`input[data-selecionar-pedido="${pedido.id}"]`).check();
    await page.getByRole("button", { name: "Aprovar selecionados" }).click();
    await page.selectOption("#motoristaLote", { index: 0 });
    await page.selectOption("#veiculoLote", { index: 0 });
    await page.getByRole("button", { name: "Confirmar rota" }).click();

    await expect(page.locator("#toast")).toHaveText("Rota escalada com sucesso.");
    const { rotas } = await lerEstado(request);
    expect(rotas).toHaveLength(1);
    expect(rotas[0].pedidoIds).toEqual([pedido.id]);

    await irParaAba(page, "Rotas Programadas");
    await expect(page.locator("#conteudo")).toContainText("Hospital Universitário Walter Cantídio");
  });

  test("mostra Transporte Outros só para pessoal administrativo ou técnico", async ({ page, request }) => {
    const materiais = await criarPedidoApi(request, { tipo: "materiais" });
    const pessoal = await criarPedidoApi(request, { tipo: "pessoal_tecnico" });
    await abrirComoPerfil(page, "transporte");

    await expect(page.locator(`[data-aceitar-hemoce="${materiais.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-aceitar-outros="${materiais.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-aceitar-outros="${pessoal.id}"]`)).toBeVisible();
  });

  test("aceita a solicitação de pessoal como Transporte Outros", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "pessoal_administrativo" });
    await abrirComoPerfil(page, "transporte");

    await page.locator(`[data-aceitar-outros="${pedido.id}"]`).click();

    await expect(page.locator("#toast")).toHaveText("Solicitação aceita como Transporte Outros.");
    await expect.poll(async () => {
      const { pedidos } = await lerEstado(request);
      return pedidos.find((p) => p.id === pedido.id).tipoTransporte;
    }).toBe("outros");
  });

  test("rejeita uma solicitação na aba Aceitar Solicitações informando o motivo", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request);
    await abrirComoPerfil(page, "transporte");
    await irParaAba(page, "Aceitar Solicitações");

    await page.locator(`[data-iniciar-analise="rejeitar"][data-pedido-id="${pedido.id}"]`).click();
    await page.fill(`#motivo-${pedido.id}`, "Sem veículo disponível no horário");
    await page.getByRole("button", { name: "Confirmar rejeição" }).click();

    await expect(page.locator("#toast")).toHaveText("Pedido rejeitado.");
    await expect.poll(async () => {
      const { pedidos } = await lerEstado(request);
      return pedidos.find((p) => p.id === pedido.id).status;
    }).toBe("rejeitado");
  });

  test("cadastra e remove um motorista na aba Cadastros", async ({ page, request }) => {
    await abrirComoPerfil(page, "transporte");
    await irParaAba(page, "Cadastros");

    await page.fill("#nomeMotorista", "Ana Ribeiro");
    await page.fill("#cnhMotorista", "D");
    await page.getByRole("button", { name: "Adicionar motorista" }).click();

    await expect(page.locator("#toast")).toHaveText("Motorista cadastrado.");
    const linha = page.locator("tr", { hasText: "Ana Ribeiro" });
    await expect(linha).toBeVisible();

    await linha.getByRole("button", { name: "Remover" }).click();

    await expect(page.locator("tr", { hasText: "Ana Ribeiro" })).toHaveCount(0);
    const { motoristas } = await lerEstado(request);
    expect(motoristas.some((m) => m.nome === "Ana Ribeiro")).toBe(false);
  });
});

test.describe("Listagem de pedidos com campos específicos (interface)", () => {
  test("Aceitar Solicitações mostra os dados específicos do pedido", async ({ page, request }) => {
    await criarPedidoApi(request, { camposEspecificos: { tipo_amostra: "Plasma" } });
    await abrirComoPerfil(page, "transporte");
    await irParaAba(page, "Aceitar Solicitações");

    await expect(page.locator("#conteudo")).toContainText("Tipo de Amostra");
    await expect(page.locator("#conteudo")).toContainText("Plasma");
  });
});

test.describe("Cancelamento na análise (interface)", () => {
  test("cancela um pedido em análise informando o motivo", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });
    await aceitarPedidoApi(request, pedido.id);
    await abrirComoPerfil(page, "transporte");
    await irParaAba(page, "Análise de Pedidos");

    await page.getByRole("button", { name: "Cancelar pedido" }).click();
    await page.selectOption('form[data-form="cancelar"] select[name="motivo"]', "veiculo");
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();

    await expect(page.locator("#toast")).toHaveText("Pedido cancelado.");
    const { pedidos } = await lerEstado(request);
    expect(pedidos[0].status).toBe("cancelado");
  });
});
