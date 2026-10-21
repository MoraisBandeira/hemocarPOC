// Fluxo do SOLICITANTE: cria pedidos pela tela e acompanha o andamento deles.
const { test, expect } = require("@playwright/test");
const {
  resetarBanco,
  lerEstado,
  criarPedidoApi,
  aceitarPedidoApi,
  aprovarRotaApi,
  abrirComoPerfil,
  irParaAba,
} = require("../helpers");
const { solicitarTransporte } = require("./passos");

const HGF = "Hospital Geral de Fortaleza (HGF)";
const HUWC = "Hospital Universitário Walter Cantídio";

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Fluxo do Solicitante", () => {
  test("cria um pedido pela tela e vê o status Pendente em Meus Pedidos", async ({ page, request }) => {
    await abrirComoPerfil(page, "solicitante");

    await test.step("preenche origem, destino e envia o pedido", async () => {
      await solicitarTransporte(page, { origem: HGF, destino: HUWC, observacoes: "Carga refrigerada" });
    });

    await test.step("acompanha o pedido em Meus Pedidos", async () => {
      await expect(page.locator("#conteudo")).toContainText(HUWC);
      await expect(page.locator(".badge.pendente")).toHaveText("Pendente");
    });

    await test.step("o servidor registrou o pedido com o nome do solicitante", async () => {
      const { pedidos } = await lerEstado(request);
      expect(pedidos[0].solicitante).toBe("Maria Souza");
      expect(pedidos[0].observacoes).toBe("Carga refrigerada");
    });
  });

  test("acompanha o pedido até o transporte ser concluído", async ({ page, request }) => {
    await abrirComoPerfil(page, "solicitante");
    await solicitarTransporte(page, { origem: HGF, destino: HUWC });
    const { pedidos } = await lerEstado(request);
    const pedido = pedidos[0];

    await test.step("transporte aceita e escala a rota (feito fora desta tela)", async () => {
      await aceitarPedidoApi(request, pedido.id);
      const { rota } = await aprovarRotaApi(request, [pedido.id]);
      await request.post(`/api/rotas/${rota.id}/saida`, { data: { kmSaida: 45210, horarioSaidaReal: new Date().toISOString() } });
      await request.post(`/api/rotas/${rota.id}/chegada`, { data: { kmChegada: 45260, horarioChegadaReal: new Date().toISOString() } });
    });

    await test.step("recarrega e vê o pedido como Concluído, com KM registrado", async () => {
      await page.reload();
      await page.locator("#tabs .tab-btn").first().waitFor();
      await irParaAba(page, "Meus Pedidos");
      await expect(page.locator(".badge.concluido")).toHaveText("Concluído");
      await expect(page.locator("#conteudo")).toContainText("KM 45260");
    });
  });

  test("vê o motivo quando o pedido é rejeitado", async ({ page, request }) => {
    await abrirComoPerfil(page, "solicitante");
    await solicitarTransporte(page, { origem: HGF, destino: HUWC });
    const { pedidos } = await lerEstado(request);

    await request.post(`/api/pedidos/${pedidos[0].id}/rejeitar`, { data: { motivo: "Sem veículo no horário" } });

    await page.reload();
    await page.locator("#tabs .tab-btn").first().waitFor();
    await irParaAba(page, "Meus Pedidos");
    await expect(page.locator(".badge.rejeitado")).toHaveText("Rejeitado");
    await expect(page.locator("#conteudo")).toContainText("Motivo da rejeição: Sem veículo no horário");
  });
});
