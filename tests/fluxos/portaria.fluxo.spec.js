// Fluxo da PORTARIA: registra a saída e a chegada das rotas e confere o histórico.
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
const { registrarSaidaNaTela, registrarChegadaNaTela } = require("./passos");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

async function rotaPronta(request) {
  const pedido = await criarPedidoApi(request);
  await aceitarPedidoApi(request, pedido.id);
  const { rota } = await aprovarRotaApi(request, [pedido.id]);
  return rota;
}

test.describe("Fluxo da Portaria", () => {
  test("registra saída, depois chegada, e a rota vai para o histórico", async ({ page, request }) => {
    const rota = await rotaPronta(request);
    await abrirComoPerfil(page, "portaria");

    await test.step("a rota aparece em Aguardando saída", async () => {
      await expect(page.locator("#conteudo")).toContainText("Hospital Universitário Walter Cantídio");
    });

    await test.step("registra a saída com o KM do odômetro", async () => {
      await registrarSaidaNaTela(page, rota.id, 45210);
    });

    await test.step("a rota passa para Em trânsito e registra a chegada", async () => {
      await irParaAba(page, "Em trânsito");
      await registrarChegadaNaTela(page, rota.id, 45260);
    });

    await test.step("a rota aparece no histórico com os KM de saída e chegada", async () => {
      await irParaAba(page, "Histórico");
      await expect(page.locator("#conteudo")).toContainText("KM 45210");
      await expect(page.locator("#conteudo")).toContainText("KM 45260");
    });
  });

  test("o formulário de chegada não aceita KM menor que o da saída", async ({ page, request }) => {
    const rota = await rotaPronta(request);
    await request.post(`/api/rotas/${rota.id}/saida`, { data: { kmSaida: 45210, horarioSaidaReal: new Date().toISOString() } });
    await abrirComoPerfil(page, "portaria");
    await irParaAba(page, "Em trânsito");

    await page.locator(`[data-iniciar-registro="chegada"][data-rota-id="${rota.id}"]`).click();
    const kmChegada = page.locator('form[data-form="registrar-chegada"] input[name="kmChegada"]');
    await kmChegada.fill("100");

    await test.step("o navegador bloqueia o campo: o mínimo é o KM de saída", async () => {
      expect(await kmChegada.evaluate((el) => el.checkValidity())).toBe(false);
    });
    await page.getByRole("button", { name: "Confirmar chegada" }).click();

    const { rotas } = await lerEstado(request);
    expect(rotas.find((r) => r.id === rota.id).status).toBe("em_transito");
  });
});
