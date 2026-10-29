const { test, expect } = require("@playwright/test");
const { emHoras, paraDatetimeLocal, resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, aprovarRotaApi } = require("../helpers");

const HGF = "Hospital Geral de Fortaleza (HGF)"; // Regional 2
const HUWC = "Hospital Universitário Walter Cantídio"; // Regional 3

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

/** A equipe de transporte sugere juntar o pedido a outro próximo (não é automático). */
function sugerirApi(request, pedidoId) {
  return request.post(`/api/pedidos/${pedidoId}/sugerir-agrupamento`);
}

test.describe("Sugestão de agrupamento feita pelo transporte (POST /api/pedidos/:id/sugerir-agrupamento)", () => {
  test("criar um pedido não gera sugestão de agrupamento sozinho", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    expect(pedido.agrupamento).toBeNull();
    const { notificacoes } = await lerEstado(request);
    expect(notificacoes.some((n) => n.tipo === "agrupamento_sugerido")).toBeFalsy();
  });

  test("transporte sugere juntar com pedido para o mesmo destino e horário a até 1h", async ({ request }) => {
    const outro = await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Outra Pessoa", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Maria Souza", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.5)) });

    const resposta = await sugerirApi(request, pedido.id);

    expect(resposta.ok()).toBeTruthy();
    const sugerido = await resposta.json();
    expect(sugerido.agrupamento.estado).toBe("aguardando");
    expect(sugerido.agrupamento.coincidencias).toHaveLength(1);
    expect(sugerido.agrupamento.coincidencias[0].local).toBe(HUWC);
    expect(sugerido.agrupamento.coincidencias[0].data).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(sugerido.agrupamento.coincidencias[0].hora).toMatch(/^\d{2}:\d{2}$/);
    // a pergunta não revela quem fez a outra solicitação
    expect(JSON.stringify(sugerido.agrupamento)).not.toContain(outro.solicitante);

    const { notificacoes } = await lerEstado(request);
    const aviso = notificacoes.find((n) => n.tipo === "agrupamento_sugerido");
    expect(aviso.publico).toBe("solicitante");
    expect(aviso.solicitanteNome).toBe("Maria Souza");
    expect(aviso.pedidoId).toBe(pedido.id);
  });

  test("a solicitação mais antiga não é notificada; as demais do grupo são", async ({ request }) => {
    const maisAntiga = await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Antiga", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const meio = await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Meio", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    const ultimo = await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Ultimo", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.5)) });

    expect((await sugerirApi(request, ultimo.id)).ok()).toBeTruthy();

    const { pedidos, notificacoes } = await lerEstado(request);
    expect(pedidos.find((p) => p.id === maisAntiga.id).agrupamento).toBeNull();
    expect(pedidos.find((p) => p.id === meio.id).agrupamento.estado).toBe("aguardando");
    expect(pedidos.find((p) => p.id === ultimo.id).agrupamento.estado).toBe("aguardando");
    const avisados = notificacoes.filter((n) => n.tipo === "agrupamento_sugerido").map((n) => n.solicitanteNome).sort();
    expect(avisados).toEqual(["Meio", "Ultimo"]);
  });

  test("o estado indica união disponível só quando há outra solicitação para juntar", async ({ request }) => {
    const sozinho = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    expect((await lerEstado(request)).pedidos.find((p) => p.id === sozinho.id).podeSugerirUniao).toBe(false);

    const outro = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    const { pedidos } = await lerEstado(request);
    expect(pedidos.find((p) => p.id === sozinho.id).podeSugerirUniao).toBe(true); // há a mais recente para consultar
    expect(pedidos.find((p) => p.id === outro.id).podeSugerirUniao).toBe(true);

    await sugerirApi(request, outro.id);
    const depois = (await lerEstado(request)).pedidos;
    expect(depois.find((p) => p.id === sozinho.id).podeSugerirUniao).toBe(false); // nada mais a consultar
    expect(depois.find((p) => p.id === outro.id).podeSugerirUniao).toBe(false);
  });

  test("sem pedido próximo para juntar, a sugestão retorna 409", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });

    const resposta = await sugerirApi(request, pedido.id);

    expect(resposta.status()).toBe(409);
  });

  test("não sugere quando o horário difere mais de 1h", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(50)) });

    expect((await sugerirApi(request, pedido.id)).status()).toBe(409);
  });

  test("sugere também quando o destino é outro, mas da mesma região", async ({ request }) => {
    // HGF e este hemocentro estão ambos na Regional 2
    const hemocentro = await request.post("/api/hospitais", {
      data: { nome: "Hemocentro Regional 2 (teste)", cidade: "Fortaleza/CE", regional: "Regional 2" },
    });
    const local = await hemocentro.json();
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HGF, dataDesejada: paraDatetimeLocal(emHoras(48)) });

    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: local.nome, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    const sugerido = await (await sugerirApi(request, pedido.id)).json();

    expect(sugerido.agrupamento.estado).toBe("aguardando");
    expect(sugerido.agrupamento.coincidencias[0].local).toBe(HGF);
  });

  test("não considera pedidos já roteirizados", async ({ request }) => {
    const antigo = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    await aceitarPedidoApi(request, antigo.id);
    await aprovarRotaApi(request, [antigo.id]);

    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    expect((await sugerirApi(request, pedido.id)).status()).toBe(409);
  });

  test("não sugere de novo enquanto a resposta do solicitante está pendente", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await sugerirApi(request, pedido.id);

    expect((await sugerirApi(request, pedido.id)).status()).toBe(409);
  });

  test("editar o pedido apaga a sugestão anterior", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await sugerirApi(request, pedido.id);

    const editado = await request.post(`/api/pedidos/${pedido.id}/editar`, {
      data: { ...pedido, solicitante: pedido.solicitante, observacoes: "Nova observação" },
    });

    expect(editado.ok()).toBeTruthy();
    expect((await editado.json()).agrupamento).toBeNull();
  });

  test("pedido de outro tipo é unido pelo transporte sem notificar o solicitante", async ({ request }) => {
    const antigo = await criarPedidoApi(request, { tipo: "medicamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "medicamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    const resposta = await sugerirApi(request, pedido.id);

    expect(resposta.ok()).toBeTruthy();
    expect((await resposta.json()).agrupamento.estado).toBe("unido");
    const { pedidos, notificacoes } = await lerEstado(request);
    expect(pedidos.find((p) => p.id === antigo.id).agrupamento).toBeNull();
    expect(notificacoes.some((n) => n.tipo === "agrupamento_sugerido")).toBeFalsy();
  });

  test("pedido de equipamentos é notificado mesmo quando a mais antiga é de outro tipo", async ({ request }) => {
    const antigo = await criarPedidoApi(request, { tipo: "medicamentos", solicitante: "Antiga", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", solicitante: "Recente", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });

    const resposta = await sugerirApi(request, pedido.id);

    expect((await resposta.json()).agrupamento.estado).toBe("aguardando");
    const { pedidos, notificacoes } = await lerEstado(request);
    expect(pedidos.find((p) => p.id === antigo.id).agrupamento).toBeNull();
    expect(notificacoes.find((n) => n.tipo === "agrupamento_sugerido").solicitanteNome).toBe("Recente");
  });

  test("solicitante aceita juntar", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await sugerirApi(request, pedido.id);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "sim" } });

    expect(resposta.ok()).toBeTruthy();
    expect((await resposta.json()).agrupamento.estado).toBe("aceito");
  });

  test("solicitante recusa juntar informando a justificativa", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await sugerirApi(request, pedido.id);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "nao", justificativa: "Preciso sair antes" } });

    const { agrupamento } = await resposta.json();
    expect(agrupamento.estado).toBe("recusado");
    expect(agrupamento.justificativa).toBe("Preciso sair antes");
  });

  test("recusa sem justificativa retorna 400 e não registra a resposta", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await sugerirApi(request, pedido.id);

    const resposta = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "nao", justificativa: "  " } });

    expect(resposta.status()).toBe(400);
    expect((await lerEstado(request)).pedidos.find((p) => p.id === pedido.id).agrupamento.estado).toBe("aguardando");
  });

  test("resposta inválida retorna 400 e resposta repetida retorna 409", async ({ request }) => {
    await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48)) });
    const pedido = await criarPedidoApi(request, { tipo: "equipamentos", destino: HUWC, dataDesejada: paraDatetimeLocal(emHoras(48.25)) });
    await sugerirApi(request, pedido.id);

    const invalida = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "talvez" } });
    expect(invalida.status()).toBe(400);

    await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "sim" } });
    const repetida = await request.post(`/api/pedidos/${pedido.id}/agrupamento`, { data: { resposta: "sim" } });
    expect(repetida.status()).toBe(409);
  });
});
