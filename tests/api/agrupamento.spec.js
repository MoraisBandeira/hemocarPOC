const { test, expect } = require("@playwright/test");
const { emHoras, paraDatetimeLocal, resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, aprovarRotaApi } = require("../helpers");

const HGF = "Hospital Geral de Fortaleza (HGF)"; // Regional 2
const HUWC = "Hospital Universitário Walter Cantídio"; // Regional 3

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Sugestão de agrupamento (POST /api/pedidos/:id/agrupamento)", () => {
  test("pergunta ao solicitante quando há pedido para o mesmo destino e horário a até 1h", async ({ request }) => {
    const outro = await criarPedidoApi(request, { solicitante: "Outra Pessoa", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.5)) });

    expect(pedido.agrupamento.estado).toBe("aguardando");
    expect(pedido.agrupamento.coincidencias).toHaveLength(1);
    expect(pedido.agrupamento.coincidencias[0].local).toBe(HUWC);
    expect(pedido.agrupamento.coincidencias[0].data).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(pedido.agrupamento.coincidencias[0].hora).toMatch(/^\d{2}:\d{2}$/);
    // a pergunta não revela quem fez a outra solicitação
    expect(JSON.stringify(pedido.agrupamento)).not.toContain(outro.solicitante);

    const { notificacoes } = await lerEstado(request);
    const aviso = notificacoes.find((n) => n.tipo === "agrupamento_sugerido");
    expect(aviso.publico).toBe("solicitante");
    expect(aviso.solicitanteNome).toBe("Maria Souza");
    expect(aviso.pedidoId).toBe(pedido.id);
  });

  test("não pergunta quando o horário difere mais de 1h", async ({ request }) => {
    await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(50)) });

    expect(pedido.agrupamento).toBeNull();
  });

  test("pergunta também quando o destino é outro, mas da mesma região", async ({ request }) => {
    // HGF e este hemocentro estão ambos na Regional 2
    const hemocentro = await request.post("/api/hospitais", {
      data: { nome: "Hemocentro Regional 2 (teste)", cidade: "Fortaleza/CE", regional: "Regional 2" },
    });
    const local = await hemocentro.json();
    await criarPedidoApi(request, { destino: HGF, dataDesejada: paraDatetimeLocal(emHoras(48)) });

    const pedido = await criarPedidoApi(request, { destino: local.nome, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    expect(pedido.agrupamento.estado).toBe("aguardando");
    expect(pedido.agrupamento.coincidencias[0].local).toBe(HGF);
  });

  test("não considera pedidos já roteirizados", async ({ request }) => {
    const antigo = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    await aceitarPedidoApi(request, antigo.id);
    await aprovarRotaApi(request, [antigo.id]);

    const pedido = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    expect(pedido.agrupamento).toBeNull();
  });

  test("solicitante aceita juntar", async ({ request }) => {
    await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    const resposta = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "sim" } });

    expect(resposta.ok()).toBeTruthy();
    expect((await resposta.json()).agrupamento.estado).toBe("aceito");
  });

  test("solicitante recusa juntar", async ({ request }) => {
    await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    const resposta = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "nao" } });

    expect((await resposta.json()).agrupamento.estado).toBe("recusado");
  });

  test("resposta inválida retorna 400 e resposta repetida retorna 409", async ({ request }) => {
    await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    const invalida = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "talvez" } });
    expect(invalida.status()).toBe(400);

    await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "sim" } });
    const repetida = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "sim" } });
    expect(repetida.status()).toBe(409);
  });
});
