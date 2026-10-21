const { test, expect } = require("@playwright/test");
const { emHoras, resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, aprovarRotaApi } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

async function rotaDoPedido(request, pedido) {
  const { rotas } = await lerEstado(request);
  return rotas.find((r) => r.pedidoIds.includes(pedido.id));
}

test.describe("Aprovação em rota (POST /api/rotas)", () => {
  test("escala um pedido aceito numa rota programada", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    await aceitarPedidoApi(request, pedido.id);

    const { rota } = await aprovarRotaApi(request, [pedido.id]);

    expect(rota.status).toBe("programada");
    expect(rota.pedidoIds).toEqual([pedido.id]);
    const estado = await lerEstado(request);
    expect(estado.pedidos.find((p) => p.id === pedido.id).status).toBe("roteirizado");
    expect(estado.pedidos.find((p) => p.id === pedido.id).rotaId).toBe(rota.id);
  });

  test("agrupa vários pedidos numa mesma rota", async ({ request }) => {
    const primeiro = await criarPedidoApi(request);
    const segundo = await criarPedidoApi(request, { destino: "Hospital Infantil Albert Sabin" });

    const { rota } = await aprovarRotaApi(request, [primeiro.id, segundo.id]);

    expect(rota.pedidoIds).toEqual([primeiro.id, segundo.id]);
    expect((await rotaDoPedido(request, segundo)).id).toBe(rota.id);
  });

  test("gera uma notificação de aprovação para cada solicitante", async ({ request }) => {
    const pedido = await criarPedidoApi(request);

    await aprovarRotaApi(request, [pedido.id]);

    const { notificacoes } = await lerEstado(request);
    const aviso = notificacoes.find((n) => n.tipo === "pedido_aprovado" && n.pedidoId === pedido.id);
    expect(aviso.publico).toBe("solicitante");
    expect(aviso.solicitanteNome).toBe(pedido.solicitante);
  });

  test("recusa término antes ou igual ao horário de saída", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    const estado = await lerEstado(request);

    const resposta = await request.post("/api/rotas", {
      data: {
        pedidoIds: [pedido.id],
        motoristaId: estado.motoristas[0].id,
        veiculoId: estado.veiculos[0].id,
        horarioSaida: emHoras(10),
        previsaoTermino: emHoras(5),
      },
    });

    expect(resposta.status()).toBe(400);
  });

  test("recusa pedido inexistente", async ({ request }) => {
    const estado = await lerEstado(request);

    const resposta = await request.post("/api/rotas", {
      data: {
        pedidoIds: ["ped-inexistente"],
        motoristaId: estado.motoristas[0].id,
        veiculoId: estado.veiculos[0].id,
        horarioSaida: emHoras(10),
        previsaoTermino: emHoras(12),
      },
    });

    expect(resposta.status()).toBe(404);
  });

  test("impede o mesmo motorista em duas rotas no mesmo período", async ({ request }) => {
    const primeiro = await criarPedidoApi(request);
    const segundo = await criarPedidoApi(request);
    const estado = await lerEstado(request);
    await aprovarRotaApi(request, [primeiro.id], { motoristaId: estado.motoristas[0].id, veiculoId: estado.veiculos[0].id });

    const resposta = await request.post("/api/rotas", {
      data: {
        pedidoIds: [segundo.id],
        motoristaId: estado.motoristas[0].id,
        veiculoId: estado.veiculos[1].id,
        horarioSaida: emHoras(49),
        previsaoTermino: emHoras(50),
      },
    });

    expect(resposta.status()).toBe(409);
    expect((await resposta.json()).erro).toContain("já tem outra rota");
  });

  test("impede o mesmo veículo em duas rotas no mesmo período", async ({ request }) => {
    const primeiro = await criarPedidoApi(request);
    const segundo = await criarPedidoApi(request);
    const estado = await lerEstado(request);
    await aprovarRotaApi(request, [primeiro.id], { motoristaId: estado.motoristas[0].id, veiculoId: estado.veiculos[0].id });

    const resposta = await request.post("/api/rotas", {
      data: {
        pedidoIds: [segundo.id],
        motoristaId: estado.motoristas[1].id,
        veiculoId: estado.veiculos[0].id,
        horarioSaida: emHoras(49),
        previsaoTermino: emHoras(50),
      },
    });

    expect(resposta.status()).toBe(409);
  });
});

test.describe("Edição de rota (POST /api/rotas/:id/editar)", () => {
  test("altera horário e previsão de uma rota programada", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    const { rota } = await aprovarRotaApi(request, [pedido.id]);
    const estado = await lerEstado(request);
    const novaSaida = emHoras(72);
    const novoTermino = emHoras(75);

    const resposta = await request.post(`/api/rotas/${rota.id}/editar`, {
      data: {
        motoristaId: estado.motoristas[1].id,
        veiculoId: estado.veiculos[1].id,
        horarioSaida: novaSaida,
        previsaoTermino: novoTermino,
      },
    });

    expect(resposta.ok()).toBeTruthy();
    const editada = (await lerEstado(request)).rotas.find((r) => r.id === rota.id);
    expect(editada.motoristaId).toBe(estado.motoristas[1].id);
    expect(editada.horarioSaida).toBe(novaSaida);
  });

  test("não edita rota que já está em trânsito", async ({ request }) => {
    const pedido = await criarPedidoApi(request);
    const { rota } = await aprovarRotaApi(request, [pedido.id]);
    await request.post(`/api/rotas/${rota.id}/saida`, { data: { kmSaida: 1000, horarioSaidaReal: emHoras(0) } });

    const estado = await lerEstado(request);
    const resposta = await request.post(`/api/rotas/${rota.id}/editar`, {
      data: {
        motoristaId: estado.motoristas[0].id,
        veiculoId: estado.veiculos[0].id,
        horarioSaida: emHoras(60),
        previsaoTermino: emHoras(62),
      },
    });

    expect(resposta.status()).toBe(409);
  });
});

test.describe("Portaria: saída e chegada (POST /api/rotas/:id/saida e /chegada)", () => {
  async function rotaProgramada(request) {
    const pedido = await criarPedidoApi(request);
    await aceitarPedidoApi(request, pedido.id);
    return aprovarRotaApi(request, [pedido.id]).then((r) => r.rota);
  }

  test("registra a saída e coloca a rota em trânsito", async ({ request }) => {
    const rota = await rotaProgramada(request);

    const resposta = await request.post(`/api/rotas/${rota.id}/saida`, {
      data: { kmSaida: 45210, horarioSaidaReal: emHoras(0) },
    });

    expect(resposta.ok()).toBeTruthy();
    const emTransito = (await lerEstado(request)).rotas.find((r) => r.id === rota.id);
    expect(emTransito.status).toBe("em_transito");
    expect(emTransito.kmSaida).toBe(45210);
  });

  test("recusa KM de saída inválido", async ({ request }) => {
    const rota = await rotaProgramada(request);

    const resposta = await request.post(`/api/rotas/${rota.id}/saida`, {
      data: { kmSaida: -5, horarioSaidaReal: emHoras(0) },
    });

    expect(resposta.status()).toBe(400);
  });

  test("não registra chegada antes da saída", async ({ request }) => {
    const rota = await rotaProgramada(request);

    const resposta = await request.post(`/api/rotas/${rota.id}/chegada`, {
      data: { kmChegada: 45260, horarioChegadaReal: emHoras(1) },
    });

    expect(resposta.status()).toBe(409);
  });

  test("não aceita KM de chegada menor que o de saída", async ({ request }) => {
    const rota = await rotaProgramada(request);
    await request.post(`/api/rotas/${rota.id}/saida`, { data: { kmSaida: 45210, horarioSaidaReal: emHoras(0) } });

    const resposta = await request.post(`/api/rotas/${rota.id}/chegada`, {
      data: { kmChegada: 45000, horarioChegadaReal: emHoras(1) },
    });

    expect(resposta.status()).toBe(400);
  });

  test("ciclo completo conclui a rota e os pedidos", async ({ request }) => {
    const rota = await rotaProgramada(request);
    await request.post(`/api/rotas/${rota.id}/saida`, { data: { kmSaida: 45210, horarioSaidaReal: emHoras(0) } });

    const resposta = await request.post(`/api/rotas/${rota.id}/chegada`, {
      data: { kmChegada: 45260, horarioChegadaReal: emHoras(1) },
    });

    expect(resposta.ok()).toBeTruthy();
    const estado = await lerEstado(request);
    const concluida = estado.rotas.find((r) => r.id === rota.id);
    expect(concluida.status).toBe("concluida");
    expect(concluida.kmChegada).toBe(45260);
    expect(estado.pedidos.find((p) => p.id === rota.pedidoIds[0]).status).toBe("concluido");
    expect(estado.notificacoes.some((n) => n.tipo === "rota_concluida")).toBe(true);
  });

  test("após a conclusão o motorista volta a ficar disponível", async ({ request }) => {
    const rota = await rotaProgramada(request);
    await request.post(`/api/rotas/${rota.id}/saida`, { data: { kmSaida: 45210, horarioSaidaReal: emHoras(0) } });
    await request.post(`/api/rotas/${rota.id}/chegada`, { data: { kmChegada: 45260, horarioChegadaReal: emHoras(1) } });

    const outro = await criarPedidoApi(request);
    const estado = await lerEstado(request);
    const resposta = await request.post("/api/rotas", {
      data: {
        pedidoIds: [outro.id],
        motoristaId: estado.motoristas[0].id,
        veiculoId: estado.veiculos[0].id,
        horarioSaida: rota.horarioSaida,
        previsaoTermino: rota.previsaoTermino,
      },
    });

    expect(resposta.status()).toBe(201);
  });
});
