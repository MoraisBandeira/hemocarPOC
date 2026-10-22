const { test, expect } = require("@playwright/test");
const { emHoras, paraDatetimeLocal, resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

async function cancelarApi(request, pedidoId, motivo) {
  return request.post(`/api/pedidos/${pedidoId}/cancelar`, { data: { motivo } });
}

test.describe("Cancelamento de pedidos aguardando análise (POST /api/pedidos/:id/cancelar)", () => {
  test("cancela um pedido aguardando análise com o motivo escolhido e avisa o solicitante", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });
    await aceitarPedidoApi(request, pedido.id);

    const resposta = await cancelarApi(request, pedido.id, "motorista");

    expect(resposta.ok()).toBeTruthy();
    const cancelado = await resposta.json();
    expect(cancelado.status).toBe("cancelado");
    expect(cancelado.motivoCancelamento).toBe("motorista");
    const { notificacoes } = await lerEstado(request);
    expect(notificacoes.some((n) => n.tipo === "pedido_cancelado" && n.solicitanteNome === "Maria Souza")).toBeTruthy();
  });

  test("não aceita motivo fora da lista de cancelamento manual", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    await aceitarPedidoApi(request, pedido.id);

    const resposta = await cancelarApi(request, pedido.id, "sem_resposta");

    expect(resposta.status()).toBe(400);
  });

  test("não cancela pedido que ainda não foi aceito pelo transporte", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await cancelarApi(request, pedido.id, "solicitante");

    expect(resposta.status()).toBe(409);
  });

  test("não cancela automaticamente pedido aguardando análise dentro das 24h", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { dataDesejada: paraDatetimeLocal(emHoras(2)) });
    await aceitarPedidoApi(request, pedido.id);

    const { pedidos } = await lerEstado(request);

    expect(pedidos.find((p) => p.id === pedido.id).status).toBe("aceito");
  });
});
