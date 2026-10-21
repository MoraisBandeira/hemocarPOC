const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, aceitarPedidoApi, aprovarRotaApi } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Reset (POST /api/reset)", () => {
  test("restaura os dados de exemplo e apaga pedidos, rotas e notificações", async ({ request }) => {
    await criarPedidoApi(request);

    const resposta = await request.post("/api/reset");

    expect(resposta.ok()).toBeTruthy();
    const estado = await lerEstado(request);
    expect(estado.pedidos).toHaveLength(0);
    expect(estado.rotas).toHaveLength(0);
    expect(estado.notificacoes).toHaveLength(0);
    expect(estado.motoristas).toHaveLength(3);
    expect(estado.veiculos).toHaveLength(3);
    expect(estado.hospitais).toHaveLength(5);
  });
});

test.describe("Motoristas", () => {
  test("cadastra e remove um motorista", async ({ request }) => {
    const criado = await request.post("/api/motoristas", { data: { nome: "Ana Ribeiro", cnh: "D" } });
    expect(criado.status()).toBe(201);
    const motorista = await criado.json();
    expect(motorista.id).toMatch(/^mot-/);

    const removido = await request.delete(`/api/motoristas/${motorista.id}`);

    expect(removido.ok()).toBeTruthy();
    const { motoristas } = await lerEstado(request);
    expect(motoristas.some((m) => m.id === motorista.id)).toBe(false);
  });

  test("exige nome e CNH", async ({ request }) => {
    const resposta = await request.post("/api/motoristas", { data: { nome: "Ana Ribeiro" } });

    expect(resposta.status()).toBe(400);
  });
});

test.describe("Veículos", () => {
  test("cadastra e remove um veículo", async ({ request }) => {
    const criado = await request.post("/api/veiculos", {
      data: { placa: "HMC-9Z99", modelo: "Fiat Fiorino", capacidade: "4 caixas térmicas" },
    });
    expect(criado.status()).toBe(201);
    const veiculo = await criado.json();

    await request.delete(`/api/veiculos/${veiculo.id}`);

    const { veiculos } = await lerEstado(request);
    expect(veiculos.some((v) => v.id === veiculo.id)).toBe(false);
  });

  test("exige placa e modelo", async ({ request }) => {
    const resposta = await request.post("/api/veiculos", { data: { placa: "HMC-9Z99" } });

    expect(resposta.status()).toBe(400);
  });
});

test.describe("Hospitais", () => {
  test("cadastra e remove um hospital", async ({ request }) => {
    const criado = await request.post("/api/hospitais", {
      data: { nome: "Hemocentro Regional", cidade: "Fortaleza/CE", regional: "Regional 5" },
    });
    expect(criado.status()).toBe(201);
    const hospital = await criado.json();
    expect(hospital.regional).toBe("Regional 5");

    await request.delete(`/api/hospitais/${hospital.id}`);

    const { hospitais } = await lerEstado(request);
    expect(hospitais.some((h) => h.id === hospital.id)).toBe(false);
  });

  test("exige nome e cidade", async ({ request }) => {
    const resposta = await request.post("/api/hospitais", { data: { nome: "Sem cidade" } });

    expect(resposta.status()).toBe(400);
  });
});

test.describe("Notificações", () => {
  test("marca uma notificação como lida", async ({ request }) => {
    await criarPedidoApi(request);
    const { notificacoes } = await lerEstado(request);

    const resposta = await request.post(`/api/notificacoes/${notificacoes[0].id}/lida`);

    expect(resposta.ok()).toBeTruthy();
    const atualizada = (await lerEstado(request)).notificacoes.find((n) => n.id === notificacoes[0].id);
    expect(atualizada.lida).toBe(true);
  });

  test("marca como lidas só as do público informado", async ({ request }) => {
    const pedido = await criarPedidoApi(request, { solicitante: "Maria Souza" });
    await aceitarPedidoApi(request, pedido.id);
    await aprovarRotaApi(request, [pedido.id]);

    await request.post("/api/notificacoes/marcar-todas-lidas?publico=solicitante&nome=Maria%20Souza");

    const { notificacoes } = await lerEstado(request);
    const daMaria = notificacoes.filter((n) => n.publico === "solicitante" && n.solicitanteNome === "Maria Souza");
    expect(daMaria.length).toBeGreaterThan(0);
    expect(daMaria.every((n) => n.lida)).toBe(true);
    expect(notificacoes.filter((n) => n.publico === "transporte").every((n) => !n.lida)).toBe(true);
  });

  test("limpa só as notificações do público informado", async ({ request }) => {
    await criarPedidoApi(request);
    const antes = (await lerEstado(request)).notificacoes.length;

    await request.delete("/api/notificacoes?publico=solicitante&nome=Ninguém");

    const depois = (await lerEstado(request)).notificacoes.length;
    expect(depois).toBe(antes);
  });

  test("limpa as notificações da equipe de transporte", async ({ request }) => {
    await criarPedidoApi(request);

    await request.delete("/api/notificacoes?publico=transporte");

    const { notificacoes } = await lerEstado(request);
    expect(notificacoes.some((n) => n.publico === "transporte")).toBe(false);
  });
});

test.describe("Rota desconhecida", () => {
  test("retorna 404 para caminhos inexistentes da API", async ({ request }) => {
    const resposta = await request.get("/api/inexistente");

    expect(resposta.status()).toBe(404);
  });
});
