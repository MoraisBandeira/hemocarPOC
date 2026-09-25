/**
 * Backend mínimo da PoC HemoCar — só módulos nativos do Node (http, fs, crypto),
 * sem dependências externas. Guarda o estado em data/db.json e transmite
 * atualizações em tempo real para todos os navegadores conectados via
 * Server-Sent Events, para que Solicitante e Equipe de Transporte enxerguem
 * os mesmos dados mesmo em navegadores/computadores diferentes.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = __dirname;
// permite apontar para uma pasta de dados isolada (ex.: em testes automatizados,
// para nunca disputar o mesmo data/db.json com uma instância real rodando em paralelo)
const PASTA_DADOS = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(RAIZ, "data");
const ARQUIVO_DB = path.join(PASTA_DADOS, "db.json");
const PORTA = process.env.PORT || 8000;

class ErroApi extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function agoraISO() {
  return new Date().toISOString();
}

function novoId(prefixo) {
  return `${prefixo}-${crypto.randomUUID()}`;
}

// Regional de cada hospital de Fortaleza, conforme o mapa oficial das 12
// Regionais (Prefeitura de Fortaleza, Secretaria de Urbanismo e Meio
// Ambiente) cruzado com o bairro real de cada endereço:
//  - HGF: Rua Ávila Goulart, 900 — bairro Papicu → Regional 2
//  - HU Walter Cantídio: Rua Pastor Samuel Munguba, 1290 — bairro Rodolfo Teófilo → Regional 3
//  - Hospital Infantil Albert Sabin: Rua Tertuliano Sales, 544 — bairro Vila União → Regional 4
// Juazeiro do Norte e Sobral são outros municípios, fora da divisão de
// Regionais de Fortaleza — mantidos com um rótulo descritivo próprio.
const HOSPITAIS_EXEMPLO = [
  { nome: "Hospital Geral de Fortaleza (HGF)", cidade: "Fortaleza/CE", regional: "Regional 2", endereco: "Rua Ávila Goulart, 900 - Papicu", telefone: "(85) 3101-2500" },
  { nome: "Hospital Universitário Walter Cantídio", cidade: "Fortaleza/CE", regional: "Regional 3", endereco: "Rua Pastor Samuel Munguba, 1290 - Rodolfo Teófilo", telefone: "(85) 3366-8000" },
  { nome: "Hospital Infantil Albert Sabin", cidade: "Fortaleza/CE", regional: "Regional 4", endereco: "Rua Tertuliano Sales, 544 - Vila União", telefone: "(85) 3101-2300" },
  { nome: "Hospital Regional do Cariri", cidade: "Juazeiro do Norte/CE", regional: "Regional Cariri", endereco: "Rua São José, 1000", telefone: "(88) 3572-1100" },
  { nome: "Hospital Regional Norte", cidade: "Sobral/CE", regional: "Regional Norte", endereco: "Av. Dom José, 500", telefone: "(88) 3677-2200" },
];

function estadoPadrao() {
  return {
    motoristas: [
      { id: novoId("mot"), nome: "Carlos Andrade", cnh: "D", criadoEm: agoraISO() },
      { id: novoId("mot"), nome: "Fernanda Lima", cnh: "D", criadoEm: agoraISO() },
      { id: novoId("mot"), nome: "João Pereira", cnh: "E", criadoEm: agoraISO() },
    ],
    veiculos: [
      { id: novoId("vei"), placa: "HMC-1A23", modelo: "Fiat Doblô (refrigerado)", capacidade: "8 caixas térmicas", criadoEm: agoraISO() },
      { id: novoId("vei"), placa: "HMC-4B56", modelo: "Renault Master (van)", capacidade: "20 caixas térmicas", criadoEm: agoraISO() },
      { id: novoId("vei"), placa: "HMC-7C89", modelo: "Fiat Strada", capacidade: "3 caixas térmicas", criadoEm: agoraISO() },
    ],
    hospitais: HOSPITAIS_EXEMPLO.map((h) => ({ id: novoId("hos"), ...h, criadoEm: agoraISO() })),
    pedidos: [],
    rotas: [],
    notificacoes: [],
  };
}

let estado;

function carregarEstado() {
  fs.mkdirSync(PASTA_DADOS, { recursive: true });
  if (!fs.existsSync(ARQUIVO_DB)) {
    estado = estadoPadrao();
    salvarEstado();
    return;
  }
  try {
    estado = JSON.parse(fs.readFileSync(ARQUIVO_DB, "utf8"));
  } catch (e) {
    console.error("data/db.json inválido, recriando com dados de exemplo:", e.message);
    estado = estadoPadrao();
    salvarEstado();
    return;
  }
  // migração simples: garante que todas as coleções existam
  estado.motoristas ??= [];
  estado.veiculos ??= [];
  estado.hospitais ??= [];
  estado.pedidos ??= [];
  estado.rotas ??= [];
  estado.notificacoes ??= [];
  if (estado.hospitais.length === 0) {
    estado.hospitais = HOSPITAIS_EXEMPLO.map((h) => ({ id: novoId("hos"), ...h, criadoEm: agoraISO() }));
  }
  // migração: hospitais cadastrados antes do campo "regional" existir (fica
  // em branco se não for um dos 5 de exemplo — cai pra cidade na hora de
  // agrupar). Além disso, ressincroniza os 5 hospitais de exemplo com os
  // dados mais atuais (regional/endereço), já que não são algo que se espera
  // o usuário personalizar manualmente — isso também corrige bases antigas
  // que ainda tinham o rótulo genérico "Regional Fortaleza" de antes de
  // cruzarmos com o mapa oficial das 12 Regionais.
  estado.hospitais.forEach((h) => {
    const exemplo = HOSPITAIS_EXEMPLO.find((e) => e.nome === h.nome);
    if (exemplo) {
      h.regional = exemplo.regional;
      h.endereco = exemplo.endereco;
    } else if (h.regional === undefined) {
      h.regional = "";
    }
  });
  // migração: rotas antigas guardavam um único pedidoId (+ origem/destino
  // copiados dele); agora uma rota pode levar vários pedidos, então guardamos
  // pedidoIds (lista) e derivamos origem/destino de cada pedido na hora de exibir.
  estado.rotas.forEach((rota) => {
    if (!Array.isArray(rota.pedidoIds)) {
      rota.pedidoIds = rota.pedidoId ? [rota.pedidoId] : [];
    }
    delete rota.pedidoId;
    delete rota.origem;
    delete rota.destino;
    // rotas antigas sem previsão de término ficam "ocupadas indefinidamente"
    // até serem concluídas (ver janelaRota) — comportamento anterior preservado.

    // migração: rotas de antes do controle de portaria (KM/horário real de
    // saída e chegada). Rotas que já estavam "concluida" na forma antiga não
    // têm como saber o KM real retroativamente — ficam com esses campos em
    // branco (mostrados como "—" na tela), sem tentar adivinhar um valor.
    if (rota.kmSaida === undefined) rota.kmSaida = null;
    if (rota.horarioSaidaReal === undefined) rota.horarioSaidaReal = null;
    if (rota.kmChegada === undefined) rota.kmChegada = null;
    if (rota.horarioChegadaReal === undefined) rota.horarioChegadaReal = null;
  });
  // migração: motorista/veículo não guardam mais um status fixo — a
  // disponibilidade agora é calculada a partir das rotas programadas (ver
  // anotarDisponibilidade), então o campo antigo fica obsoleto.
  estado.motoristas.forEach((m) => delete m.status);
  estado.veiculos.forEach((v) => delete v.status);
  salvarEstado();
}

function salvarEstado() {
  fs.writeFileSync(ARQUIVO_DB, JSON.stringify(estado, null, 2), "utf8");
}

// ---- Transmissão em tempo real (Server-Sent Events) ----
const clientesSSE = new Set();

function transmitirEstado() {
  const payload = `event: estado\ndata: ${JSON.stringify(estadoParaEnvio())}\n\n`;
  for (const res of clientesSSE) {
    res.write(payload);
  }
}

function persistirETransmitir() {
  salvarEstado();
  transmitirEstado();
}

// ---- Regras de negócio ----
function adicionarNotificacao({ tipo, titulo, mensagem, publico, solicitanteNome = null, pedidoId = null }) {
  const notificacao = {
    id: novoId("not"),
    tipo, // novo_pedido | pedido_aprovado | pedido_rejeitado | rota_saiu | rota_concluida
    titulo,
    mensagem,
    publico, // 'transporte' (visível à equipe de transporte) | 'solicitante' (visível só a quem pediu)
    solicitanteNome,
    pedidoId,
    lida: false,
    criadoEm: agoraISO(),
  };
  estado.notificacoes.push(notificacao);
  estado.notificacoes = estado.notificacoes.slice(-300);
  return notificacao;
}

function correspondeAoPublico(notif, publico, nome) {
  if (publico === "transporte") return notif.publico === "transporte";
  if (publico === "solicitante") {
    return notif.publico === "solicitante" && (notif.solicitanteNome || "").trim().toLowerCase() === (nome || "").trim().toLowerCase();
  }
  return false;
}

function criarPedido(dados) {
  if (!dados.solicitante || !dados.origem || !dados.destino || !dados.dataDesejada) {
    throw new ErroApi(400, "Preencha solicitante, origem, destino e data desejada.");
  }
  const pedido = {
    id: novoId("ped"),
    solicitante: dados.solicitante,
    setor: dados.setor || "",
    origem: dados.origem,
    destino: dados.destino,
    dataDesejada: dados.dataDesejada,
    tipo: dados.tipo || "outro",
    prioridade: dados.prioridade || "normal",
    observacoes: dados.observacoes || "",
    status: "pendente", // pendente | roteirizado | rejeitado | concluido
    motivoRejeicao: null,
    rotaId: null,
    criadoEm: agoraISO(),
    atualizadoEm: agoraISO(),
  };
  estado.pedidos.push(pedido);

  adicionarNotificacao({
    tipo: "novo_pedido",
    titulo: "Novo pedido de transporte",
    mensagem: `${pedido.solicitante} solicitou transporte: ${pedido.origem} → ${pedido.destino}.`,
    publico: "transporte",
    pedidoId: pedido.id,
  });

  return pedido;
}

function atualizarPedido(id, patch) {
  const pedido = estado.pedidos.find((p) => p.id === id);
  if (!pedido) return null;
  Object.assign(pedido, patch, { atualizadoEm: agoraISO() });
  return pedido;
}

/**
 * Janela de tempo [início, fim] de uma rota programada, em milissegundos.
 * Rotas antigas sem previsão de término (de antes desse campo existir) usam
 * Infinity como fim — ou seja, seguem "ocupando" o recurso até serem
 * concluídas manualmente, exatamente como funcionava antes.
 */
function janelaRota(rota) {
  const inicio = new Date(rota.horarioSaida).getTime();
  const fim = rota.previsaoTermino ? new Date(rota.previsaoTermino).getTime() : Infinity;
  return { inicio, fim };
}

/** Rota que ainda ocupa motorista/veículo: aprovada e ainda não chegou de volta. */
function rotaAtiva(rota) {
  return rota.status === "programada" || rota.status === "em_transito";
}

/** true se [horarioSaida, previsaoTermino) esbarra em alguma das rotas dadas. */
function temConflitoAgenda(rotasDoRecurso, horarioSaida, previsaoTermino) {
  const novoInicio = new Date(horarioSaida).getTime();
  const novoFim = new Date(previsaoTermino).getTime();
  return rotasDoRecurso.some((rota) => {
    const { inicio, fim } = janelaRota(rota);
    return novoInicio < fim && inicio < novoFim;
  });
}

/**
 * Anota cada motorista/veículo com a disponibilidade calculada a partir das
 * rotas programadas: "em_rota" (com até quando) se há uma rota em andamento
 * agora, senão "disponivel". Usada só para exibição/resposta ao cliente — a
 * validação real de conflito, ao aprovar ou editar uma rota, usa a janela de
 * tempo completa (temConflitoAgenda), não esse status simplificado.
 */
function anotarDisponibilidade(lista, campoId) {
  const agora = Date.now();
  return lista.map((recurso) => {
    const rotasDoRecurso = estado.rotas.filter((r) => rotaAtiva(r) && r[campoId] === recurso.id);
    const emAndamento = rotasDoRecurso.find((r) => {
      const { inicio, fim } = janelaRota(r);
      return inicio <= agora && agora <= fim;
    });
    return {
      ...recurso,
      status: emAndamento ? "em_rota" : "disponivel",
      ocupadoAte: emAndamento ? emAndamento.previsaoTermino || null : null,
    };
  });
}

/** Estado com motoristas/veículos anotados — o que de fato vai para os clientes. */
function estadoParaEnvio() {
  return {
    ...estado,
    motoristas: anotarDisponibilidade(estado.motoristas, "motoristaId"),
    veiculos: anotarDisponibilidade(estado.veiculos, "veiculoId"),
  };
}

/**
 * Aprova um ou mais pedidos pendentes de uma vez, escalando UMA rota (um
 * motorista + um veículo + horário de saída/previsão de término) que atende
 * a todos eles. Motorista e veículo continuam podendo ser escalados para
 * OUTRAS rotas, desde que a janela de horário não se sobreponha a esta.
 */
function aprovarPedidos(pedidoIds, { motoristaId, veiculoId, horarioSaida, previsaoTermino }) {
  if (!Array.isArray(pedidoIds) || pedidoIds.length === 0) {
    throw new ErroApi(400, "Selecione ao menos um pedido para aprovar.");
  }
  if (!motoristaId || !veiculoId || !horarioSaida || !previsaoTermino) {
    throw new ErroApi(400, "Selecione motorista, veículo, horário de saída e previsão de término.");
  }
  if (new Date(previsaoTermino).getTime() <= new Date(horarioSaida).getTime()) {
    throw new ErroApi(400, "A previsão de término precisa ser depois do horário de saída.");
  }

  const idsUnicos = [...new Set(pedidoIds)];
  const pedidos = idsUnicos.map((id) => {
    const pedido = estado.pedidos.find((p) => p.id === id);
    if (!pedido) throw new ErroApi(404, "Um dos pedidos selecionados não foi encontrado.");
    if (pedido.status !== "pendente") throw new ErroApi(409, `O pedido de ${pedido.solicitante} não está mais pendente (outra pessoa pode ter analisado antes).`);
    return pedido;
  });

  const motorista = estado.motoristas.find((m) => m.id === motoristaId);
  const veiculo = estado.veiculos.find((v) => v.id === veiculoId);
  if (!motorista) throw new ErroApi(404, "Motorista não encontrado.");
  if (!veiculo) throw new ErroApi(404, "Veículo não encontrado.");

  const rotasMotorista = estado.rotas.filter((r) => rotaAtiva(r) && r.motoristaId === motoristaId);
  if (temConflitoAgenda(rotasMotorista, horarioSaida, previsaoTermino)) {
    throw new ErroApi(409, `${motorista.nome} já tem outra rota nesse período.`);
  }
  const rotasVeiculo = estado.rotas.filter((r) => rotaAtiva(r) && r.veiculoId === veiculoId);
  if (temConflitoAgenda(rotasVeiculo, horarioSaida, previsaoTermino)) {
    throw new ErroApi(409, `O veículo ${veiculo.placa} já tem outra rota nesse período.`);
  }

  const rota = {
    id: novoId("rot"),
    pedidoIds: idsUnicos,
    motoristaId,
    veiculoId,
    horarioSaida, // planejado
    previsaoTermino, // planejado
    status: "programada", // programada | em_transito | concluida
    kmSaida: null,
    horarioSaidaReal: null,
    kmChegada: null,
    horarioChegadaReal: null,
    criadoEm: agoraISO(),
  };
  estado.rotas.push(rota);

  pedidos.forEach((pedido) => {
    atualizarPedido(pedido.id, { status: "roteirizado", rotaId: rota.id });
    adicionarNotificacao({
      tipo: "pedido_aprovado",
      titulo: "Pedido aprovado",
      mensagem: `Seu pedido (${pedido.origem} → ${pedido.destino}) foi aprovado${pedidos.length > 1 ? ", numa rota que também leva outro(s) pedido(s)" : ""}. Motorista ${motorista.nome}, veículo ${veiculo.placa}.`,
      publico: "solicitante",
      solicitanteNome: pedido.solicitante,
      pedidoId: pedido.id,
    });
  });

  return { pedidos, rota };
}

/**
 * Edita motorista/veículo/horário/previsão de término de uma rota ainda
 * programada (não concluída), reaplicando a mesma verificação de conflito de
 * agenda — sem contar a própria rota, já que ela está sendo reagendada.
 */
function editarRota(rotaId, { motoristaId, veiculoId, horarioSaida, previsaoTermino }) {
  const rota = estado.rotas.find((r) => r.id === rotaId);
  if (!rota) throw new ErroApi(404, "Rota não encontrada.");
  if (rota.status !== "programada") throw new ErroApi(409, "Só é possível editar rotas ainda não concluídas.");
  if (!motoristaId || !veiculoId || !horarioSaida || !previsaoTermino) {
    throw new ErroApi(400, "Selecione motorista, veículo, horário de saída e previsão de término.");
  }
  if (new Date(previsaoTermino).getTime() <= new Date(horarioSaida).getTime()) {
    throw new ErroApi(400, "A previsão de término precisa ser depois do horário de saída.");
  }

  const motorista = estado.motoristas.find((m) => m.id === motoristaId);
  const veiculo = estado.veiculos.find((v) => v.id === veiculoId);
  if (!motorista) throw new ErroApi(404, "Motorista não encontrado.");
  if (!veiculo) throw new ErroApi(404, "Veículo não encontrado.");

  const rotasMotorista = estado.rotas.filter((r) => rotaAtiva(r) && r.motoristaId === motoristaId && r.id !== rotaId);
  if (temConflitoAgenda(rotasMotorista, horarioSaida, previsaoTermino)) {
    throw new ErroApi(409, `${motorista.nome} já tem outra rota nesse período.`);
  }
  const rotasVeiculo = estado.rotas.filter((r) => rotaAtiva(r) && r.veiculoId === veiculoId && r.id !== rotaId);
  if (temConflitoAgenda(rotasVeiculo, horarioSaida, previsaoTermino)) {
    throw new ErroApi(409, `O veículo ${veiculo.placa} já tem outra rota nesse período.`);
  }

  const mudouHorario = rota.horarioSaida !== horarioSaida;
  const mudouMotorista = rota.motoristaId !== motoristaId;
  const mudouVeiculo = rota.veiculoId !== veiculoId;

  Object.assign(rota, { motoristaId, veiculoId, horarioSaida, previsaoTermino, atualizadoEm: agoraISO() });

  if (mudouHorario || mudouMotorista || mudouVeiculo) {
    const pedidosDaRota = rota.pedidoIds.map((id) => estado.pedidos.find((p) => p.id === id)).filter(Boolean);
    pedidosDaRota.forEach((pedido) => {
      adicionarNotificacao({
        tipo: "pedido_aprovado",
        titulo: "Rota atualizada",
        mensagem: `A rota do seu pedido (${pedido.origem} → ${pedido.destino}) foi alterada: saída ${horarioSaida}, motorista ${motorista.nome}, veículo ${veiculo.placa}.`,
        publico: "solicitante",
        solicitanteNome: pedido.solicitante,
        pedidoId: pedido.id,
      });
    });
  }

  return { rota };
}

function rejeitarPedido(pedidoId, motivo) {
  const pedido = estado.pedidos.find((p) => p.id === pedidoId);
  if (!pedido) throw new ErroApi(404, "Pedido não encontrado.");
  if (!motivo || !motivo.trim()) throw new ErroApi(400, "Informe o motivo da rejeição.");

  atualizarPedido(pedidoId, { status: "rejeitado", motivoRejeicao: motivo.trim() });

  adicionarNotificacao({
    tipo: "pedido_rejeitado",
    titulo: "Pedido rejeitado",
    mensagem: `Seu pedido (${pedido.origem} → ${pedido.destino}) foi rejeitado: ${motivo.trim()}`,
    publico: "solicitante",
    solicitanteNome: pedido.solicitante,
    pedidoId,
  });

  return pedido;
}

/**
 * Portaria registra a saída física do veículo: KM do odômetro e horário reais
 * (podem diferir do planejado na aprovação da rota). A partir daqui a rota
 * fica "em_transito" até a portaria registrar a chegada.
 */
function registrarSaidaRota(rotaId, { kmSaida, horarioSaidaReal }) {
  const rota = estado.rotas.find((r) => r.id === rotaId);
  if (!rota) throw new ErroApi(404, "Rota não encontrada.");
  if (rota.status !== "programada") throw new ErroApi(409, "Essa rota não está aguardando saída (a saída já foi registrada ou a rota já foi concluída).");

  const km = Number(kmSaida);
  if (!Number.isFinite(km) || km < 0) throw new ErroApi(400, "Informe o KM de saída (número válido).");
  if (!horarioSaidaReal) throw new ErroApi(400, "Informe o horário de saída.");

  rota.status = "em_transito";
  rota.kmSaida = km;
  rota.horarioSaidaReal = horarioSaidaReal;

  const pedidos = rota.pedidoIds.map((id) => atualizarPedido(id, { status: "em_transito" })).filter(Boolean);
  pedidos.forEach((pedido) => {
    adicionarNotificacao({
      tipo: "rota_saiu",
      titulo: "Transporte saiu",
      mensagem: `Seu pedido (${pedido.origem} → ${pedido.destino}) saiu às ${horarioSaidaReal} (KM ${km}).`,
      publico: "solicitante",
      solicitanteNome: pedido.solicitante,
      pedidoId: pedido.id,
    });
  });

  return { pedidos, rota };
}

/**
 * Portaria registra a chegada de volta: KM do odômetro e horário reais.
 * Só depois disso a rota conta como concluída de fato, e motorista/veículo
 * voltam a aparecer como disponíveis.
 */
function registrarChegadaRota(rotaId, { kmChegada, horarioChegadaReal }) {
  const rota = estado.rotas.find((r) => r.id === rotaId);
  if (!rota) throw new ErroApi(404, "Rota não encontrada.");
  if (rota.status !== "em_transito") throw new ErroApi(409, "Registre a saída antes de registrar a chegada.");

  const km = Number(kmChegada);
  if (!Number.isFinite(km) || km < 0) throw new ErroApi(400, "Informe o KM de chegada (número válido).");
  if (rota.kmSaida != null && km < rota.kmSaida) {
    throw new ErroApi(400, `O KM de chegada não pode ser menor que o KM de saída (${rota.kmSaida}).`);
  }
  if (!horarioChegadaReal) throw new ErroApi(400, "Informe o horário de chegada.");
  if (rota.horarioSaidaReal && new Date(horarioChegadaReal).getTime() < new Date(rota.horarioSaidaReal).getTime()) {
    throw new ErroApi(400, "O horário de chegada não pode ser antes do horário de saída.");
  }

  rota.status = "concluida";
  rota.kmChegada = km;
  rota.horarioChegadaReal = horarioChegadaReal;
  // motorista/veículo ficam livres automaticamente: a disponibilidade é
  // calculada a partir de rotas ativas (ver anotarDisponibilidade/rotaAtiva).

  const pedidos = rota.pedidoIds.map((id) => atualizarPedido(id, { status: "concluido" })).filter(Boolean);
  pedidos.forEach((pedido) => {
    adicionarNotificacao({
      tipo: "rota_concluida",
      titulo: "Transporte concluído",
      mensagem: `Seu pedido (${pedido.origem} → ${pedido.destino}) foi concluído. Chegada às ${horarioChegadaReal} (KM ${km}).`,
      publico: "solicitante",
      solicitanteNome: pedido.solicitante,
      pedidoId: pedido.id,
    });
  });

  return { pedidos, rota };
}

// ---- Corpo da requisição ----
function lerCorpoJson(req) {
  return new Promise((resolve, reject) => {
    let corpo = "";
    req.on("data", (pedaco) => {
      corpo += pedaco;
      if (corpo.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!corpo) return resolve({});
      try {
        resolve(JSON.parse(corpo));
      } catch (e) {
        reject(new ErroApi(400, "JSON inválido no corpo da requisição."));
      }
    });
    req.on("error", reject);
  });
}

function responderJson(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(texto);
}

function responderErro(res, e) {
  const status = e instanceof ErroApi ? e.status : 500;
  if (status === 500) console.error(e);
  responderJson(res, status, { erro: e.message || "Erro interno do servidor." });
}

// ---- Roteador da API ----
async function tratarApi(req, res, url) {
  const partes = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const metodo = req.method;

  if (partes[1] === "estado" && metodo === "GET") {
    return responderJson(res, 200, estadoParaEnvio());
  }

  if (partes[1] === "pedidos") {
    if (partes.length === 2 && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      const pedido = criarPedido(dados);
      persistirETransmitir();
      return responderJson(res, 201, pedido);
    }
    if (partes.length === 4 && partes[3] === "rejeitar" && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      const pedido = rejeitarPedido(partes[2], dados.motivo);
      persistirETransmitir();
      return responderJson(res, 200, pedido);
    }
  }

  if (partes[1] === "rotas") {
    if (partes.length === 2 && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      const resultado = aprovarPedidos(dados.pedidoIds, dados);
      persistirETransmitir();
      return responderJson(res, 201, resultado);
    }
    if (partes.length === 4 && partes[3] === "saida" && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      const resultado = registrarSaidaRota(partes[2], dados);
      persistirETransmitir();
      return responderJson(res, 200, resultado);
    }
    if (partes.length === 4 && partes[3] === "chegada" && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      const resultado = registrarChegadaRota(partes[2], dados);
      persistirETransmitir();
      return responderJson(res, 200, resultado);
    }
    if (partes.length === 4 && partes[3] === "editar" && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      const resultado = editarRota(partes[2], dados);
      persistirETransmitir();
      return responderJson(res, 200, resultado);
    }
  }

  if (partes[1] === "motoristas") {
    if (partes.length === 2 && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      if (!dados.nome || !dados.cnh) throw new ErroApi(400, "Nome e CNH são obrigatórios.");
      const motorista = { id: novoId("mot"), nome: dados.nome, cnh: dados.cnh, criadoEm: agoraISO() };
      estado.motoristas.push(motorista);
      persistirETransmitir();
      return responderJson(res, 201, motorista);
    }
    if (partes.length === 3 && metodo === "DELETE") {
      estado.motoristas = estado.motoristas.filter((m) => m.id !== partes[2]);
      persistirETransmitir();
      return responderJson(res, 200, { ok: true });
    }
  }

  if (partes[1] === "veiculos") {
    if (partes.length === 2 && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      if (!dados.placa || !dados.modelo) throw new ErroApi(400, "Placa e modelo são obrigatórios.");
      const veiculo = { id: novoId("vei"), placa: dados.placa, modelo: dados.modelo, capacidade: dados.capacidade || "", criadoEm: agoraISO() };
      estado.veiculos.push(veiculo);
      persistirETransmitir();
      return responderJson(res, 201, veiculo);
    }
    if (partes.length === 3 && metodo === "DELETE") {
      estado.veiculos = estado.veiculos.filter((v) => v.id !== partes[2]);
      persistirETransmitir();
      return responderJson(res, 200, { ok: true });
    }
  }

  if (partes[1] === "hospitais") {
    if (partes.length === 2 && metodo === "POST") {
      const dados = await lerCorpoJson(req);
      if (!dados.nome || !dados.cidade) throw new ErroApi(400, "Nome e cidade são obrigatórios.");
      const hospital = { id: novoId("hos"), nome: dados.nome, cidade: dados.cidade, regional: dados.regional || "", endereco: dados.endereco || "", telefone: dados.telefone || "", criadoEm: agoraISO() };
      estado.hospitais.push(hospital);
      persistirETransmitir();
      return responderJson(res, 201, hospital);
    }
    if (partes.length === 3 && metodo === "DELETE") {
      estado.hospitais = estado.hospitais.filter((h) => h.id !== partes[2]);
      persistirETransmitir();
      return responderJson(res, 200, { ok: true });
    }
  }

  if (partes[1] === "notificacoes") {
    if (partes.length === 4 && partes[3] === "lida" && metodo === "POST") {
      const notificacao = estado.notificacoes.find((n) => n.id === partes[2]);
      if (notificacao) notificacao.lida = true;
      persistirETransmitir();
      return responderJson(res, 200, { ok: true });
    }
    if (partes.length === 3 && partes[2] === "marcar-todas-lidas" && metodo === "POST") {
      const publico = url.searchParams.get("publico");
      const nome = url.searchParams.get("nome");
      estado.notificacoes.forEach((n) => {
        if (correspondeAoPublico(n, publico, nome)) n.lida = true;
      });
      persistirETransmitir();
      return responderJson(res, 200, { ok: true });
    }
    if (partes.length === 2 && metodo === "DELETE") {
      const publico = url.searchParams.get("publico");
      const nome = url.searchParams.get("nome");
      estado.notificacoes = estado.notificacoes.filter((n) => !correspondeAoPublico(n, publico, nome));
      persistirETransmitir();
      return responderJson(res, 200, { ok: true });
    }
  }

  if (partes[1] === "reset" && metodo === "POST") {
    estado = estadoPadrao();
    persistirETransmitir();
    return responderJson(res, 200, estadoParaEnvio());
  }

  throw new ErroApi(404, "Rota da API não encontrada.");
}

function tratarSSE(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: estado\ndata: ${JSON.stringify(estadoParaEnvio())}\n\n`);
  clientesSSE.add(res);
  req.on("close", () => clientesSSE.delete(res));
}

// ---- Arquivos estáticos (front-end) ----
const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
};

function tratarEstatico(req, res, url) {
  const relativo = url.pathname === "/" ? "/index.html" : url.pathname;
  const caminho = path.normalize(path.join(RAIZ, relativo));
  if (!caminho.startsWith(RAIZ)) {
    res.writeHead(403);
    return res.end("Proibido");
  }
  fs.readFile(caminho, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Não encontrado");
    }
    const ext = path.extname(caminho);
    res.writeHead(200, { "Content-Type": TIPOS_MIME[ext] || "application/octet-stream" });
    res.end(conteudo);
  });
}

carregarEstado();

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/eventos") return tratarSSE(req, res);
    if (url.pathname.startsWith("/api/")) return await tratarApi(req, res, url);
    return tratarEstatico(req, res, url);
  } catch (e) {
    responderErro(res, e);
  }
});

servidor.listen(PORTA, () => {
  console.log(`HemoCar rodando em http://localhost:${PORTA}`);
  console.log(`Dados persistidos em ${ARQUIVO_DB}`);
});
