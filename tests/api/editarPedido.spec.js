const { test, expect } = require("@playwright/test");
const { emHoras, paraDatetimeLocal, resetarBanco, criarPedidoApi, aceitarPedidoApi, PEDIDO_PADRAO } = require("../helpers");

const criarPedido = criarPedidoApi;

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

/** Dados completos de um pedido, como a tela de edição envia. */
function dadosEdicao(sobrescrever = {}) {
  return {
    ...PEDIDO_PADRAO,
    dataDesejada: paraDatetimeLocal(emHoras(72)),
    ...sobrescrever,
  };
}

async function editarPedidoApi(request, pedidoId, dados) {
  return request.post(`/api/pedidos/${pedidoId}/editar`, { data: dados });
}

test.describe("Edição de pedidos pelo solicitante (POST /api/pedidos/:id/editar)", () => {
  test("altera os dados de um pedido pendente", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao({ tipo: "medicamentos", prioridade: "alta", observacoes: "Nova observação" }));

    expect(resposta.ok()).toBeTruthy();
    const editado = await resposta.json();
    expect(editado.tipo).toBe("medicamentos");
    expect(editado.prioridade).toBe("alta");
    expect(editado.observacoes).toBe("Nova observação");
    expect(editado.status).toBe("pendente");
  });

  test("altera pedido aguardando aprovação da diretoria", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "coleta_externa", dataDesejada: paraDatetimeLocal(emHoras(5)) });
    expect(pedido.status).toBe("aguardando_diretoria");

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao({ tipo: "coleta_externa" }));

    expect(resposta.ok()).toBeTruthy();
  });

  test("guarda e devolve os campos específicos do tipo", async ({ request }) => {
    const pedido = await criarPedido(request, { camposEspecificos: { tipo_amostra: "Sangue", volume_amostra: "10" } });
    expect(pedido.camposEspecificos).toEqual({ tipo_amostra: "Sangue", volume_amostra: "10" });

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao({ camposEspecificos: { tipo_amostra: "Plasma" } }));

    expect((await resposta.json()).camposEspecificos).toEqual({ tipo_amostra: "Plasma" });
  });

  test("não altera depois que a diretoria aprovou", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "coleta_externa", dataDesejada: paraDatetimeLocal(emHoras(5)) });
    await request.post(`/api/pedidos/${pedido.id}/aprovar-diretoria`);

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao({ tipo: "coleta_externa" }));

    expect(resposta.status()).toBe(409);
  });

  test("não altera depois que o transporte aceitou", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    await aceitarPedidoApi(request, pedido.id);

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao());

    expect(resposta.status()).toBe(409);
  });

  test("recusa edição de quem não fez o pedido", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao({ solicitante: "Outra Pessoa" }));

    expect(resposta.status()).toBe(403);
  });

  test("reaplica a regra de diretoria se a nova data cair em menos de 24h", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "materiais" });
    expect(pedido.status).toBe("pendente");

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao({ tipo: "materiais", dataDesejada: paraDatetimeLocal(emHoras(3)) }));

    const editado = await resposta.json();
    expect(editado.status).toBe("aguardando_diretoria");
    expect(editado.requerAprovacaoDiretoria).toBe(true);
  });

  test("exige origem, destino, data e tipo", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await editarPedidoApi(request, pedido.id, dadosEdicao({ destino: "" }));

    expect(resposta.status()).toBe(400);
  });
});
