const { test, expect } = require("@playwright/test");
const { resetarBanco, abrirComoPerfil, irParaAba } = require("../helpers");

test.beforeEach(async ({ request }) => {
  await resetarBanco(request);
});

test.describe("Paginação nos Cadastros (interface)", () => {
  test("a lista de motoristas pagina em 5 itens por página, sem afetar as outras listas", async ({ page, request }) => {
    // o seed já traz 3 motoristas; com mais 6 são 9 (2 páginas)
    for (let i = 1; i <= 6; i++) {
      const resposta = await request.post("/api/motoristas", { data: { nome: `Motorista Teste ${i}`, cnh: "D" } });
      expect(resposta.status()).toBe(201);
    }
    await abrirComoPerfil(page, "administrador");
    await irParaAba(page, "Cadastros");

    const painelMotoristas = page.locator("section.painel", { has: page.locator("h2", { hasText: "Motoristas" }) });
    const painelVeiculos = page.locator("section.painel", { has: page.locator("h2", { hasText: "Veículos" }) });

    await expect(painelMotoristas.locator(".paginacao-info")).toHaveText("Página 1 de 2 · 9 itens");
    await expect(painelMotoristas.locator("tbody tr")).toHaveCount(5);

    await painelMotoristas.getByRole("button", { name: "Próxima ›" }).click();
    await expect(painelMotoristas.locator(".paginacao-info")).toHaveText("Página 2 de 2 · 9 itens");
    await expect(painelMotoristas.locator("tbody tr")).toHaveCount(4);

    // veículos têm só 3 itens: sem paginação, e a página de motoristas não afeta a deles
    await expect(painelVeiculos.locator(".paginacao")).toHaveCount(0);
    await expect(painelVeiculos.locator("tbody tr")).toHaveCount(3);
  });
});

test.describe("Busca nos Cadastros (interface)", () => {
  test("filtra motoristas, veículos e hospitais, sem diferenciar maiúsculas nem acentos", async ({ page }) => {
    await abrirComoPerfil(page, "administrador");
    await irParaAba(page, "Cadastros");

    const painelMotoristas = page.locator("section.painel", { has: page.locator("h2", { hasText: "Motoristas" }) });
    const painelVeiculos = page.locator("section.painel", { has: page.locator("h2", { hasText: "Veículos" }) });
    const painelHospitais = page.locator("section.painel", { has: page.locator("h2", { hasText: "Hospitais" }) });

    // "joao" acha "João Pereira" (sem acento)
    await painelMotoristas.getByPlaceholder("Buscar por nome ou CNH").fill("JOAO");
    await expect(painelMotoristas.locator("tbody tr")).toHaveCount(1);
    await expect(painelMotoristas.locator("tbody")).toContainText("João Pereira");

    // o foco continua no campo enquanto se digita
    await expect(painelMotoristas.getByPlaceholder("Buscar por nome ou CNH")).toBeFocused();

    await painelMotoristas.getByPlaceholder("Buscar por nome ou CNH").fill("inexistente");
    await expect(painelMotoristas.locator("tbody")).toContainText("Nenhum resultado para a busca.");

    await painelVeiculos.getByPlaceholder("Buscar por placa, modelo ou capacidade").fill("hmc-1a");
    await expect(painelVeiculos.locator("tbody tr")).toHaveCount(1);

    await painelHospitais.getByPlaceholder("Buscar por nome, cidade, regional, endereço ou telefone").fill("sobral");
    await expect(painelHospitais.locator("tbody tr")).toHaveCount(1);
    await expect(painelHospitais.locator("tbody")).toContainText("Sobral");
  });
});
