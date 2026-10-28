const { test, expect } = require("@playwright/test");
const { emHoras, paraDatetimeLocal, resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, aprovarRotaApi } = require("../helpers");

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

async function cancelarPeloSolicitanteApi(request, pedidoId, solicitante, justificativa = "Mudou o horário da coleta.") {
  return request.post(`/api/pedidos/${pedidoId}/cancelar-solicitante`, { data: { solicitante, justificativa } });
}

test.describe("Cancelamento pelo solicitante (POST /api/pedidos/:id/cancelar-solicitante)", () => {
  test("cancela o próprio pedido ainda não roteirizado, com motivo do solicitante", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });

    const resposta = await cancelarPeloSolicitanteApi(request, pedido.id, "Maria Souza");

    expect(resposta.ok()).toBeTruthy();
    const cancelado = await resposta.json();
    expect(cancelado.status).toBe("cancelado");
    expect(cancelado.motivoCancelamento).toBe("solicitante");
    expect(cancelado.justificativaCancelamento).toBe("Mudou o horário da coleta.");
  });

  test("exige a justificativa do cancelamento", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });

    const resposta = await cancelarPeloSolicitanteApi(request, pedido.id, "Maria Souza", "   ");

    expect(resposta.status()).toBe(400);
    const { pedidos } = await lerEstado(request);
    expect(pedidos.find((p) => p.id === pedido.id).status).toBe("pendente");
  });

  test("cancela pedido já aceito pelo transporte e aguardando análise", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });
    await aceitarPedidoApi(request, pedido.id);

    const resposta = await cancelarPeloSolicitanteApi(request, pedido.id, "Maria Souza");

    expect(resposta.ok()).toBeTruthy();
  });

  test("cancela pedido roteirizado enquanto a saída não foi registrada e remove a rota vazia", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });
    await aceitarPedidoApi(request, pedido.id);
    await aprovarRotaApi(request, [pedido.id]);

    const resposta = await cancelarPeloSolicitanteApi(request, pedido.id, "Maria Souza");

    expect(resposta.ok()).toBeTruthy();
    const { pedidos, rotas } = await lerEstado(request);
    expect(pedidos.find((p) => p.id === pedido.id).status).toBe("cancelado");
    expect(rotas).toHaveLength(0);
  });

  test("ao cancelar um pedido de rota com outros pedidos, só tira esse pedido da rota", async ({ request }) => {
    const maria = await criarPedidoApi(request, { solicitante: "Maria Souza" });
    const joao = await criarPedidoApi(request, { solicitante: "João Lima" });
    await aceitarPedidoApi(request, maria.id);
    await aceitarPedidoApi(request, joao.id);
    const { rota } = await aprovarRotaApi(request, [maria.id, joao.id]);

    await cancelarPeloSolicitanteApi(request, maria.id, "Maria Souza");

    const { rotas } = await lerEstado(request);
    expect(rotas.find((r) => r.id === rota.id).pedidoIds).toEqual([joao.id]);
  });

  test("não cancela depois que a portaria registra a saída da rota", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });
    await aceitarPedidoApi(request, pedido.id);
    const { rota } = await aprovarRotaApi(request, [pedido.id]);
    const saida = await request.post(`/api/rotas/${rota.id}/saida`, {
      data: { kmSaida: 1000, horarioSaidaReal: paraDatetimeLocal(new Date().toISOString()) },
    });
    expect(saida.ok()).toBeTruthy();

    const resposta = await cancelarPeloSolicitanteApi(request, pedido.id, "Maria Souza");

    expect(resposta.status()).toBe(409);
    const { pedidos } = await lerEstado(request);
    expect(pedidos.find((p) => p.id === pedido.id).status).toBe("em_transito");
  });

  test("não permite cancelar pedido de outro solicitante", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });

    const resposta = await cancelarPeloSolicitanteApi(request, pedido.id, "João Lima");

    expect(resposta.status()).toBe(403);
  });
});
