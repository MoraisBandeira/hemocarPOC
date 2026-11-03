const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi } = require("../helpers");

// Projeto "chromium": o servidor está em terça-feira, 10:00, dentro do expediente.

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

async function responsavelDe(request, pedidoId) {
  const { pedidos } = await lerEstado(request);
  return pedidos.find((p) => p.id === pedidoId).responsavel;
}

test.describe("Responsável pelo pedido em horário de expediente", () => {
  test("pedido da distribuição feito em horário de expediente fica com o transporte", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { tipo: "medicamentos" });

    expect(await responsavelDe(request, pedido.id)).toBe("transporte");
  });

  test("feriado cadastrado vira fora do expediente para os pedidos da distribuição", async ({ request }) => {
    const feriado = await request.post("/api/feriados", { data: { data: "2026-11-03", descricao: "Feriado de teste" } });
    expect(feriado.status()).toBe(201);

    const pedido = await criarPedidoApi(request, { tipo: "medicamentos" });
    const outro = await criarPedidoApi(request, { tipo: "equipamentos" });

    expect(await responsavelDe(request, pedido.id)).toBe("distribuicao");
    expect(await responsavelDe(request, outro.id)).toBe("transporte");
  });
});
