// Passos reutilizáveis pelos fluxos de ponta a ponta. Cada função faz uma ação
// que um usuário faria na tela, para o fluxo ler como uma história.
const { expect } = require("@playwright/test");
const { irParaAba, preencherCamposDinamicos } = require("../helpers");

/** Solicitante preenche e envia um pedido pela tela. */
async function solicitarTransporte(page, { origem, destino, tipo = "amostras_pre_transfusionais", observacoes = "" } = {}) {
  await page.selectOption("#origem", origem);
  await page.selectOption("#destino", destino);
  await page.selectOption("#tipo", tipo);
  await preencherCamposDinamicos(page);
  if (observacoes) await page.fill("#observacoes", observacoes);
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(page.locator("#toast")).toHaveText("Pedido enviado para análise da equipe de transporte.");
}

/** Equipe de Transporte aceita um pedido como Hemoce ou Outros, pela aba Aceitar Solicitações. */
async function aceitarNaTela(page, pedidoId, tipo = "hemoce") {
  const rotulo = tipo === "hemoce" ? "data-aceitar-hemoce" : "data-aceitar-outros";
  await page.locator(`[${rotulo}="${pedidoId}"]`).click();
  await expect(page.locator("#toast")).toContainText("Solicitação aceita");
}

/** Escala um ou mais pedidos aceitos numa mesma rota, pela aba Análise de Pedidos. */
async function escalarNaTela(page, pedidoIds) {
  await irParaAba(page, "Análise de Pedidos");
  for (const id of pedidoIds) {
    await page.locator(`input[data-selecionar-pedido="${id}"]`).check();
  }
  await page.getByRole("button", { name: "Aprovar selecionados" }).click();
  await page.selectOption("#motoristaLote", { index: 0 });
  await page.selectOption("#veiculoLote", { index: 0 });
  await page.getByRole("button", { name: "Confirmar rota" }).click();
  await expect(page.locator("#toast")).toHaveText("Rota escalada com sucesso.");
}

/** Portaria registra a saída de uma rota programada (KM e horário preenchidos pela tela). */
async function registrarSaidaNaTela(page, rotaId, kmSaida) {
  await page.locator(`[data-iniciar-registro="saida"][data-rota-id="${rotaId}"]`).click();
  await page.fill('form[data-form="registrar-saida"] input[name="kmSaida"]', String(kmSaida));
  await page.getByRole("button", { name: "Confirmar saída" }).click();
  await expect(page.locator("#toast")).toHaveText("Saída registrada.");
}

/** Portaria registra a chegada de uma rota em trânsito. */
async function registrarChegadaNaTela(page, rotaId, kmChegada) {
  await page.locator(`[data-iniciar-registro="chegada"][data-rota-id="${rotaId}"]`).click();
  await page.fill('form[data-form="registrar-chegada"] input[name="kmChegada"]', String(kmChegada));
  await page.getByRole("button", { name: "Confirmar chegada" }).click();
  await expect(page.locator("#toast")).toHaveText("Chegada registrada. Rota concluída.");
}

/** Troca o perfil ativo pelo seletor do cabeçalho. */
async function trocarPerfil(page, perfil) {
  await page.selectOption("#perfil", perfil);
}

module.exports = {
  solicitarTransporte,
  aceitarNaTela,
  escalarNaTela,
  registrarSaidaNaTela,
  registrarChegadaNaTela,
  trocarPerfil,
};
