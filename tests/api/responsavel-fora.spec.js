const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi } = require("../helpers");

// Projeto "fora-do-expediente": o servidor está em sábado, 12:00.

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

async function responsavelDe(request, pedidoId) {
  const { pedidos } = await lerEstado(request);
  return pedidos.find((p) => p.id === pedidoId).responsavel;
}

test.describe("Responsável pelo pedido fora do expediente", () => {
  test("tipos da distribuição feitos fora do expediente ficam com a distribuição", async ({ request }) => {
    for (const tipo of ["amostras_pre_transfusionais", "amostras_outras", "hemocomponentes", "medicamentos"]) {
      const pedido = await criarPedidoApi(request, { tipo });
      expect(await responsavelDe(request, pedido.id), tipo).toBe("distribuicao");
    }
  });

  test("outros tipos continuam com o transporte mesmo fora do expediente", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos" });

    expect(await responsavelDe(request, pedido.id)).toBe("transporte");
  });

  test("pedido da distribuição não pode ser sugerido para união", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "medicamentos" });

    const resposta = await request.post(`/api/pedidos/${pedido.id}/sugerir-agrupamento`);

    expect(resposta.status()).toBe(409);
  });

  test("pedido do transporte não se junta a pedido da distribuição", async ({ request }) => {
    // mesmo destino e mesmo horário pedido: só a regra de responsável impede a união
    const transporte = await criarPedidoApi(request, { tipo: "equipamentos" });
    await criarPedidoApi(request, { tipo: "medicamentos" });

    const resposta = await request.post(`/api/pedidos/${transporte.id}/sugerir-agrupamento`);

    expect(resposta.status()).toBe(409);
  });
});
