const { test, expect } = require("@playwright/test");
const { resetarBanco, lerEstado, abrirComoPerfil, irParaAba, preencherCamposDinamicos } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Solicitante (interface)", () => {
  test("no primeiro acesso pede nome e setor antes de criar pedidos", async ({ page }) => {
    await page.goto("/");
    await page.locator("#tabs .tab-btn").first().waitFor();

    await expect(page.getByRole("heading", { name: "Antes de continuar, confirme seus dados" })).toBeVisible();
    await page.fill("#perfilInicialNome", "Carlos Lima");
    await page.fill("#perfilInicialSetor", "Unidade de Coleta - Sul");
    await page.getByRole("button", { name: "Salvar e continuar" }).click();

    await expect(page.locator("#conteudo")).toContainText("Carlos Lima");
    await expect(page.locator("#conteudo")).toContainText("Unidade de Coleta - Sul");
  });

  test("envia um pedido pela tela e o acompanha em Meus Pedidos", async ({ page, request }) => {
    await abrirComoPerfil(page, "solicitante");

    await page.selectOption("#origem", "Hospital Geral de Fortaleza (HGF)");
    await page.selectOption("#destino", "Hospital Universitário Walter Cantídio");
    await page.selectOption("#tipo", "amostras_pre_transfusionais");
    await preencherCamposDinamicos(page);
    await page.fill("#observacoes", "Carga refrigerada");
    await page.getByRole("button", { name: "Enviar pedido" }).click();

    await expect(page.locator("#toast")).toHaveText("Pedido enviado para análise da equipe de transporte.");

    const { pedidos } = await lerEstado(request);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].solicitante).toBe("Maria Souza");
    expect(pedidos[0].status).toBe("pendente");
    await expect(page.locator("#conteudo")).toContainText("Hospital Universitário Walter Cantídio");
  });

  test("não envia pedido com origem igual ao destino", async ({ page, request }) => {
    await abrirComoPerfil(page, "solicitante");

    await page.selectOption("#origem", "Hospital Geral de Fortaleza (HGF)");
    await page.selectOption("#destino", "Hospital Geral de Fortaleza (HGF)");
    await preencherCamposDinamicos(page);
    await page.getByRole("button", { name: "Enviar pedido" }).click();

    await expect(page.locator("#toast")).toHaveText("Origem e destino não podem ser o mesmo endereço.");
    const { pedidos } = await lerEstado(request);
    expect(pedidos).toHaveLength(0);
  });

  test("Meus Pedidos identifica o solicitante logado", async ({ page }) => {
    await abrirComoPerfil(page, "solicitante");

    await irParaAba(page, "Meus Pedidos");

    await expect(page.locator("#conteudo")).toContainText("Maria Souza");
  });
});
