const { test, expect } = require("@playwright/test");
const { emHoras, resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, PEDIDO_PADRAO } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Criação de pedidos (POST /api/pedidos)", () => {
  test("cria pedido pendente com os dados enviados", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    expect(pedido.id).toMatch(/^ped-/);
    expect(pedido.status).toBe("pendente");
    expect(pedido.solicitante).toBe(PEDIDO_PADRAO.solicitante);
    expect(pedido.requerAprovacaoDiretoria).toBe(false);
    expect(pedido.rotaId).toBeNull();
  });

  test("recusa pedido sem solicitante, origem, destino ou data", async ({ request }) => {
    const resposta = await request.post("/api/pedidos", {
      data: { ...PEDIDO_PADRAO, solicitante: "", dataDesejada: emHoras(48) },
    });

    expect(resposta.status()).toBe(400);
    expect((await resposta.json()).erro).toContain("Preencha");
  });

  test("coleta externa com menos de 24h exige aprovação de diretoria", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "coleta_externa", dataDesejada: emHoras(5) });

    expect(pedido.status).toBe("aguardando_diretoria");
    expect(pedido.requerAprovacaoDiretoria).toBe(true);
  });

  test("coleta externa com mais de 24h segue direto para pendente", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "coleta_externa", dataDesejada: emHoras(72) });

    expect(pedido.status).toBe("pendente");
    expect(pedido.requerAprovacaoDiretoria).toBe(false);
  });

  test("tipo que não exige diretoria não vai para aprovação mesmo com menos de 24h", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "hemocomponentes", dataDesejada: emHoras(2) });

    expect(pedido.status).toBe("pendente");
  });

  test("gera notificação para a equipe de transporte", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    const { notificacoes } = await lerEstado(request);

    const notificacao = notificacoes.find((n) => n.pedidoId === pedido.id);
    expect(notificacao.publico).toBe("transporte");
    expect(notificacao.lida).toBe(false);
  });
});

test.describe("Diretoria (POST /api/pedidos/:id/aprovar-diretoria)", () => {
  test("aprova pedido aguardando diretoria e o envia para análise", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "coleta_externa", dataDesejada: emHoras(3) });

    const resposta = await request.post(`/api/pedidos/${pedido.id}/aprovar-diretoria`);

    expect(resposta.ok()).toBeTruthy();
    expect((await resposta.json()).status).toBe("pendente");
  });

  test("não aprova pedido que não está aguardando diretoria", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/aprovar-diretoria`);

    expect(resposta.status()).toBe(409);
  });
});

test.describe("Aceite de solicitações (POST /api/pedidos/:id/aceitar)", () => {
  test("aceita como Transporte Hemoce", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const aceito = await aceitarPedidoApi(request, pedido.id, "hemoce");

    expect(aceito.status).toBe("aceito");
    expect(aceito.tipoTransporte).toBe("hemoce");
  });

  test("aceita como Transporte Outros quando o tipo é pessoal administrativo", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "pessoal_administrativo" });

    const aceito = await aceitarPedidoApi(request, pedido.id, "outros");

    expect(aceito.tipoTransporte).toBe("outros");
  });

  test("aceita como Transporte Outros quando o tipo é pessoal técnico", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "pessoal_tecnico" });

    const aceito = await aceitarPedidoApi(request, pedido.id, "outros");

    expect(aceito.tipoTransporte).toBe("outros");
  });

  test("recusa Transporte Outros para tipos que não são pessoal", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "materiais" });

    const resposta = await request.post(`/api/pedidos/${pedido.id}/aceitar`, { data: { tipoTransporte: "outros" } });

    expect(resposta.status()).toBe(400);
    expect((await resposta.json()).erro).toContain("pessoal administrativo e pessoal técnico");
  });

  test("aceita como Hemoce qualquer tipo de solicitação", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "materiais" });

    const aceito = await aceitarPedidoApi(request, pedido.id, "hemoce");

    expect(aceito.tipoTransporte).toBe("hemoce");
  });

  test("recusa tipo de transporte inválido", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/aceitar`, { data: { tipoTransporte: "avião" } });

    expect(resposta.status()).toBe(400);
  });

  test("não aceita pedido que já foi aceito", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    await aceitarPedidoApi(request, pedido.id);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/aceitar`, { data: { tipoTransporte: "hemoce" } });

    expect(resposta.status()).toBe(409);
  });

  test("pedido inexistente retorna 404", async ({ request }) => {
    const resposta = await request.post("/api/pedidos/ped-inexistente/aceitar", { data: { tipoTransporte: "hemoce" } });

    expect(resposta.status()).toBe(404);
  });
});

test.describe("Rejeição de pedidos (POST /api/pedidos/:id/rejeitar)", () => {
  test("rejeita pedido com motivo", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/rejeitar`, {
      data: { motivo: "Sem veículo disponível" },
    });

    expect(resposta.ok()).toBeTruthy();
    const rejeitado = await resposta.json();
    expect(rejeitado.status).toBe("rejeitado");
    expect(rejeitado.motivoRejeicao).toBe("Sem veículo disponível");
  });

  test("exige o motivo da rejeição", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/rejeitar`, { data: { motivo: "   " } });

    expect(resposta.status()).toBe(400);
  });
});
