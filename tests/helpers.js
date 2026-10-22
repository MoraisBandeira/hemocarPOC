// Utilitários compartilhados pelos testes de API e de interface.
const { expect } = require("@playwright/test");

/** Data futura em ISO, a partir de agora. Datas no passado são auto-concluídas pelo servidor. */
function emHoras(horas) {
  return new Date(Date.now() + horas * 60 * 60 * 1000).toISOString();
}

/** Formato dos inputs datetime-local (horário local do navegador). */
function paraDatetimeLocal(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PEDIDO_PADRAO = {
  solicitante: "Maria Souza",
  setor: "Unidade de Coleta - Centro",
  origem: "Hospital Geral de Fortaleza (HGF)",
  destino: "Hospital Universitário Walter Cantídio",
  tipo: "amostras_pre_transfusionais",
  prioridade: "normal",
  observacoes: "",
};

/** Perfil de solicitante salvo no navegador, para pular a tela de primeiro acesso. */
const PERFIL_SOLICITANTE = { nome: "Maria Souza", setor: "Unidade de Coleta - Centro" };

/** Restaura os dados de exemplo do servidor (pedidos, rotas e notificações zerados). */
async function resetarBanco(request) {
  const resposta = await request.post("/api/reset");
  expect(resposta.ok()).toBeTruthy();
}

async function lerEstado(request) {
  const resposta = await request.get("/api/estado");
  expect(resposta.ok()).toBeTruthy();
  return resposta.json();
}

/** Cria um pedido via API (status inicial pendente, salvo se a regra de diretoria se aplicar). */
async function criarPedidoApi(request, sobrescrever = {}) {
  const resposta = await request.post("/api/pedidos", {
    // mesmo formato que a tela grava (datetime-local), para o formulário de rota conseguir pré-preencher o horário
    data: { ...PEDIDO_PADRAO, dataDesejada: paraDatetimeLocal(emHoras(48)), ...sobrescrever },
  });
  expect(resposta.status()).toBe(201);
  return resposta.json();
}

/** Aceita um pedido pendente como Transporte Hemoce ou Outros. */
async function aceitarPedidoApi(request, pedidoId, tipoTransporte = "hemoce") {
  const resposta = await request.post(`/api/pedidos/${pedidoId}/aceitar`, { data: { tipoTransporte } });
  expect(resposta.ok()).toBeTruthy();
  return resposta.json();
}

/** Aprova um ou mais pedidos numa rota, com os dados do primeiro motorista/veículo de exemplo. */
async function aprovarRotaApi(request, pedidoIds, { motoristaId, veiculoId, horas = 48, duracaoHoras = 2 } = {}) {
  const estado = await lerEstado(request);
  const saida = emHoras(horas);
  const termino = new Date(new Date(saida).getTime() + duracaoHoras * 60 * 60 * 1000).toISOString();
  const resposta = await request.post("/api/rotas", {
    data: {
      pedidoIds,
      motoristaId: motoristaId ?? estado.motoristas[0].id,
      veiculoId: veiculoId ?? estado.veiculos[0].id,
      horarioSaida: paraDatetimeLocal(saida),
      previsaoTermino: paraDatetimeLocal(termino),
    },
  });
  expect(resposta.status()).toBe(201);
  return resposta.json();
}

/** Abre o app já com o perfil escolhido (e, no solicitante, com nome e setor salvos). */
async function abrirComoPerfil(page, perfil) {
  await page.addInitScript(
    ({ perfil, solicitante }) => {
      localStorage.setItem("hemocar_perfil", perfil);
      localStorage.setItem("hemocar_perfil_solicitante", JSON.stringify(solicitante));
    },
    { perfil, solicitante: PERFIL_SOLICITANTE }
  );
  await page.goto("/");
  await page.locator("#tabs .tab-btn").first().waitFor();
}

/** Clica na aba de navegação pelo nome visível. */
async function irParaAba(page, nome) {
  await page.locator("#tabs .tab-btn", { hasText: nome }).click();
}

/** Preenche todos os campos obrigatórios do formulário dinâmico de tipo de pedido. */
async function preencherCamposDinamicos(page, seletor = "#containerCamposDinamicos") {
  const obrigatorios = page.locator(`${seletor} [required]`);
  const quantidade = await obrigatorios.count();
  for (let i = 0; i < quantidade; i++) {
    const campo = obrigatorios.nth(i);
    const tagName = await campo.evaluate((el) => el.tagName);
    const tipo = await campo.getAttribute("type");
    if (tagName === "SELECT") await campo.selectOption({ index: 1 });
    else if (tipo === "number") await campo.fill("2");
    else if (tipo === "date") await campo.fill("2026-12-01");
    else if (tipo === "tel") await campo.fill("85999990000");
    else await campo.fill("Teste automatizado");
  }
}

module.exports = {
  abrirComoPerfil,
  irParaAba,
  preencherCamposDinamicos,
  emHoras,
  paraDatetimeLocal,
  PEDIDO_PADRAO,
  PERFIL_SOLICITANTE,
  resetarBanco,
  lerEstado,
  criarPedidoApi,
  aceitarPedidoApi,
  aprovarRotaApi,
};
