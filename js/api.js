/**
 * Cliente do backend HTTP (server.js). Substitui o antigo armazenamento em
 * localStorage: os dados agora ficam no servidor (data/db.json) e chegam a
 * TODOS os navegadores conectados em tempo real via Server-Sent Events.
 *
 * Para as telas continuarem lendo os dados de forma síncrona (como antes),
 * mantemos uma cópia local do estado do servidor, atualizada a cada evento.
 */
const DB = (() => {
  let estado = { motoristas: [], veiculos: [], hospitais: [], pedidos: [], rotas: [], notificacoes: [] };
  let aoAtualizarCb = null;

  async function requisitar(caminho, opcoes = {}) {
    let resposta;
    try {
      resposta = await fetch(caminho, {
        headers: { "Content-Type": "application/json" },
        ...opcoes,
      });
    } catch (e) {
      throw new Error("Não foi possível falar com o servidor. Ele está rodando (node server.js)?");
    }
    if (!resposta.ok) {
      let mensagem = `Erro ${resposta.status}`;
      try {
        const corpo = await resposta.json();
        if (corpo?.erro) mensagem = corpo.erro;
      } catch (e) {
        // corpo não era JSON, mantém mensagem genérica
      }
      throw new Error(mensagem);
    }
    if (resposta.status === 204) return null;
    return resposta.json();
  }

  async function conectar(aoAtualizar) {
    aoAtualizarCb = aoAtualizar;
    estado = await requisitar("/api/estado");
    abrirFonteEventos();
  }

  function abrirFonteEventos() {
    const fonte = new EventSource("/api/eventos");
    fonte.addEventListener("estado", (ev) => {
      estado = JSON.parse(ev.data);
      aoAtualizarCb?.();
    });
    // o EventSource reconecta sozinho em caso de queda; nada a fazer aqui.
  }

  // ---- Leituras síncronas a partir do cache local (mantido pelo SSE) ----
  function listarMotoristas() {
    return [...estado.motoristas];
  }
  function listarVeiculos() {
    return [...estado.veiculos];
  }
  function listarHospitais() {
    return [...estado.hospitais].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }
  function listarPedidos() {
    return [...estado.pedidos].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  }
  function listarRotas() {
    return [...estado.rotas].sort((a, b) => new Date(a.horarioSaida) - new Date(b.horarioSaida));
  }
  function listarNotificacoes() {
    return [...estado.notificacoes].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  }

  // ---- Mutações assíncronas (via API); o servidor transmite o novo estado por SSE ----
  function criarPedido(dados) {
    return requisitar("/api/pedidos", { method: "POST", body: JSON.stringify(dados) });
  }
  function aprovarPedidos(dados) {
    return requisitar("/api/rotas", { method: "POST", body: JSON.stringify(dados) });
  }
  function rejeitarPedido(pedidoId, motivo) {
    return requisitar(`/api/pedidos/${pedidoId}/rejeitar`, { method: "POST", body: JSON.stringify({ motivo }) });
  }
  function registrarSaidaRota(rotaId, dados) {
    return requisitar(`/api/rotas/${rotaId}/saida`, { method: "POST", body: JSON.stringify(dados) });
  }
  function registrarChegadaRota(rotaId, dados) {
    return requisitar(`/api/rotas/${rotaId}/chegada`, { method: "POST", body: JSON.stringify(dados) });
  }
  function editarRota(rotaId, dados) {
    return requisitar(`/api/rotas/${rotaId}/editar`, { method: "POST", body: JSON.stringify(dados) });
  }
  function adicionarMotorista(dados) {
    return requisitar("/api/motoristas", { method: "POST", body: JSON.stringify(dados) });
  }
  function removerMotorista(id) {
    return requisitar(`/api/motoristas/${id}`, { method: "DELETE" });
  }
  function adicionarVeiculo(dados) {
    return requisitar("/api/veiculos", { method: "POST", body: JSON.stringify(dados) });
  }
  function removerVeiculo(id) {
    return requisitar(`/api/veiculos/${id}`, { method: "DELETE" });
  }
  function adicionarHospital(dados) {
    return requisitar("/api/hospitais", { method: "POST", body: JSON.stringify(dados) });
  }
  function removerHospital(id) {
    return requisitar(`/api/hospitais/${id}`, { method: "DELETE" });
  }
  function marcarNotificacaoLida(id) {
    return requisitar(`/api/notificacoes/${id}/lida`, { method: "POST" });
  }
  function marcarTodasNotificacoesLidas({ publico, nome }) {
    const params = new URLSearchParams({ publico, ...(nome ? { nome } : {}) });
    return requisitar(`/api/notificacoes/marcar-todas-lidas?${params}`, { method: "POST" });
  }
  function limparNotificacoes({ publico, nome }) {
    const params = new URLSearchParams({ publico, ...(nome ? { nome } : {}) });
    return requisitar(`/api/notificacoes?${params}`, { method: "DELETE" });
  }
  function limparTudo() {
    return requisitar("/api/reset", { method: "POST" });
  }

  return {
    conectar,
    listarMotoristas,
    adicionarMotorista,
    removerMotorista,
    listarVeiculos,
    adicionarVeiculo,
    removerVeiculo,
    listarHospitais,
    adicionarHospital,
    removerHospital,
    listarPedidos,
    criarPedido,
    listarRotas,
    aprovarPedidos,
    rejeitarPedido,
    registrarSaidaRota,
    registrarChegadaRota,
    editarRota,
    listarNotificacoes,
    marcarNotificacaoLida,
    marcarTodasNotificacoesLidas,
    limparNotificacoes,
    limparTudo,
  };
})();
