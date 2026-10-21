const { test, expect } = require("@playwright/test");
const {
  resetarBanco,
  lerEstado,
  criarPedidoApi,
  aceitarPedidoApi,
  aprovarRotaApi,
  abrirComoPerfil,
  irParaAba,
  emHoras,
  paraDatetimeLocal,
} = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Portaria (interface)", () => {
  test("registra a saída e a chegada de uma rota até o histórico", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request);
    await aceitarPedidoApi(request, pedido.id);
    const { rota } = await aprovarRotaApi(request, [pedido.id]);
    await abrirComoPerfil(page, "portaria");

    await expect(page.locator("#conteudo")).toContainText("Hospital Universitário Walter Cantídio");
    await page.locator(`[data-iniciar-registro="saida"][data-rota-id="${rota.id}"]`).click();
    await page.fill('form[data-form="registrar-saida"] input[name="kmSaida"]', "45210");
    await page.getByRole("button", { name: "Confirmar saída" }).click();

    await irParaAba(page, "Em trânsito");
    await page.locator(`[data-iniciar-registro="chegada"][data-rota-id="${rota.id}"]`).click();
    await page.fill('form[data-form="registrar-chegada"] input[name="kmChegada"]', "45260");
    await page.getByRole("button", { name: "Confirmar chegada" }).click();

    await irParaAba(page, "Histórico");
    await expect(page.locator("#conteudo")).toContainText("Hospital Universitário Walter Cantídio");
    const { rotas, pedidos } = await lerEstado(request);
    expect(rotas.find((r) => r.id === rota.id).status).toBe("concluida");
    expect(pedidos.find((p) => p.id === pedido.id).status).toBe("concluido");
  });
});

test.describe("Diretoria (interface)", () => {
  test("aprova uma solicitação urgente de coleta externa aguardando diretoria", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "coleta_externa", dataDesejada: paraDatetimeLocal(emHoras(4)) });
    expect(pedido.status).toBe("aguardando_diretoria");
    await abrirComoPerfil(page, "diretoria");

    await page.locator(`[data-aprovar-diretoria="${pedido.id}"]`).click();

    await expect.poll(async () => {
      const { pedidos } = await lerEstado(request);
      return pedidos.find((p) => p.id === pedido.id).status;
    }).toBe("pendente");
    await expect(page.locator("#conteudo")).not.toContainText(pedido.solicitante);
  });
});
