// Fluxo da EQUIPE DE TRANSPORTE: aceita, escala em rota e rejeita solicitações.
const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, criarPedidoApi, abrirComoPerfil, irParaAba } = require("../helpers");
const { aceitarNaTela, escalarNaTela } = require("./passos");

const HGF = "Hospital Geral de Fortaleza (HGF)";
const HUWC = "Hospital Universitário Walter Cantídio";

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Fluxo da Equipe de Transporte", () => {
  test("aceita solicitações como Hemoce e Outros e a fila de aceite esvazia", async ({ page, request }) => {
    const a = await criarPedidoApi(request, { origem: HGF, destino: HUWC });
    const b = await criarPedidoApi(request, { origem: HGF, destino: "Hospital Infantil Albert Sabin", tipo: "pessoal_tecnico" });
    await abrirComoPerfil(page, "transporte");

    await test.step("vê as duas solicitações pendentes", async () => {
      await expect(page.locator("[data-aceitar-hemoce]")).toHaveCount(2);
    });

    await test.step("aceita a primeira como Transporte Hemoce", async () => {
      await aceitarNaTela(page, a.id, "hemoce");
    });

    await test.step("aceita a segunda (pessoal) como Transporte Outros", async () => {
      await aceitarNaTela(page, b.id, "outros");
    });

    await test.step("a fila de aceite fica vazia e os pedidos seguem para análise", async () => {
      await expect(page.locator("[data-aceitar-hemoce]")).toHaveCount(0);
      await expect(page.locator("#conteudo")).toContainText("Nenhuma solicitação aguardando aceitação.");
      await irParaAba(page, "Análise de Pedidos");
      await expect(page.locator("input[data-selecionar-pedido]")).toHaveCount(2);
    });
  });

  test("agrupa dois pedidos aceitos numa mesma rota", async ({ page, request }) => {
    const a = await criarPedidoApi(request);
    const b = await criarPedidoApi(request, { destino: "Hospital Infantil Albert Sabin" });
    await request.post(`/api/pedidos/${a.id}/aceitar`, { data: { tipoTransporte: "hemoce" } });
    await request.post(`/api/pedidos/${b.id}/aceitar`, { data: { tipoTransporte: "hemoce" } });
    await abrirComoPerfil(page, "transporte");

    await test.step("seleciona os dois pedidos e escala numa rota só", async () => {
      await escalarNaTela(page, [a.id, b.id]);
    });

    await test.step("a rota aparece em Rotas Programadas com os dois destinos", async () => {
      const { rotas } = await lerEstado(request);
      expect(rotas).toHaveLength(1);
      expect(rotas[0].pedidoIds.sort()).toEqual([a.id, b.id].sort());
      await irParaAba(page, "Rotas Programadas");
      await expect(page.locator("#conteudo")).toContainText("Hospital Infantil Albert Sabin");
      await expect(page.locator("#conteudo")).toContainText(HUWC);
    });
  });

  test("rejeita uma solicitação em Aceitar Solicitações informando o motivo", async ({ page, request }) => {
    const pedido = await criarPedidoApi(request);
    await abrirComoPerfil(page, "transporte");
    await irParaAba(page, "Aceitar Solicitações");

    await test.step("abre a rejeição da solicitação e informa o motivo", async () => {
      await page.locator(`[data-iniciar-analise="rejeitar"][data-pedido-id="${pedido.id}"]`).click();
      await page.fill(`#motivo-${pedido.id}`, "Sem motorista disponível");
      await page.getByRole("button", { name: "Confirmar rejeição" }).click();
      await expect(page.locator("#toast")).toHaveText("Pedido rejeitado.");
    });

    await test.step("a solicitação sai da fila e o contador de rejeitados aumenta", async () => {
      await expect(page.locator("#conteudo")).toContainText("Nenhuma solicitação aguardando aceitação.");
      await irParaAba(page, "Análise de Pedidos");
      await expect(page.locator(".stat-card", { hasText: "Rejeitados" }).locator(".valor")).toHaveText("1");
    });
  });

  test("cadastra um hospital novo na aba Cadastros", async ({ page, request }) => {
    await abrirComoPerfil(page, "transporte");
    await irParaAba(page, "Cadastros");

    await page.fill("#nomeHospital", "Hemocentro de Teste");
    await page.fill("#cidadeHospital", "Fortaleza/CE");
    await page.getByRole("button", { name: "Adicionar hospital" }).click();

    await expect(page.locator("#toast")).toHaveText("Hospital cadastrado.");
    const { hospitais } = await lerEstado(request);
    expect(hospitais.some((h) => h.nome === "Hemocentro de Teste")).toBe(true);
  });
});
