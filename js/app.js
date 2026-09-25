/**
 * PoC de logística: Solicitante cria pedido -> Transporte analisa
 * (aprova escalando motorista/veículo/horário, ou rejeita) -> pedido vira
 * rota -> Portaria registra a saída (KM + horário) e depois a chegada
 * (KM + horário) do veículo, o que conclui a rota e libera motorista/veículo.
 */

const TABS_POR_PERFIL = {
  solicitante: [
    { id: "novoPedido", label: "Novo Pedido" },
    { id: "meusPedidos", label: "Meus Pedidos" },
  ],
  transporte: [
    { id: "analise", label: "Análise de Pedidos" },
    { id: "rotas", label: "Rotas Programadas" },
    { id: "cadastros", label: "Cadastros" },
  ],
  portaria: [
    { id: "portariaSaida", label: "Aguardando saída" },
    { id: "portariaChegada", label: "Em trânsito" },
    { id: "portariaHistorico", label: "Histórico" },
  ],
};

const ROTULO_STATUS_PEDIDO = {
  pendente: "Pendente",
  roteirizado: "Roteirizado",
  em_transito: "Em trânsito",
  rejeitado: "Rejeitado",
  concluido: "Concluído",
};

const ROTULO_PRIORIDADE = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

const estado = {
  perfil: localStorage.getItem("hemocar_perfil") || "solicitante",
  aba: null,
  analisando: null, // { pedidoId, acao: 'rejeitar' }
  selecionados: new Set(), // ids de pedidos pendentes marcados para aprovar juntos numa rota
  aprovandoLote: false, // true = mostrando o formulário de motorista/veículo/horário para a seleção
  editandoRota: null, // id da rota com o formulário de edição aberto, ou null
  registrandoRota: null, // { rotaId, acao: 'saida' | 'chegada' } — formulário da Portaria aberto, ou null
  notificacoesAbertas: false,
  menuPerfilAberto: false,
  notifOSAberto: false,
  pagina: 1, // página atual da lista paginada da aba em exibição
};

function limparSelecaoAnalise() {
  estado.selecionados.clear();
  estado.aprovandoLote = false;
}

// ---------- Paginação (client-side — os dados já estão todos no navegador) ----------

const ITENS_POR_PAGINA = 5;

function paginar(lista, pagina) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / ITENS_POR_PAGINA));
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
  return {
    itens: lista.slice(inicio, inicio + ITENS_POR_PAGINA),
    paginaAtual,
    totalPaginas,
    total: lista.length,
  };
}

function renderPaginacao({ paginaAtual, totalPaginas, total }) {
  if (totalPaginas <= 1) return "";
  return `
    <div class="paginacao">
      <button type="button" class="btn secundario pequeno" data-pagina="${paginaAtual - 1}" ${paginaAtual === 1 ? "disabled" : ""}>‹ Anterior</button>
      <span class="paginacao-info">Página ${paginaAtual} de ${totalPaginas} · ${total} ${total === 1 ? "item" : "itens"}</span>
      <button type="button" class="btn secundario pequeno" data-pagina="${paginaAtual + 1}" ${paginaAtual === totalPaginas ? "disabled" : ""}>Próxima ›</button>
    </div>
  `;
}

const ICONE_NOTIFICACAO = {
  novo_pedido: "📦",
  pedido_aprovado: "🚚",
  pedido_rejeitado: "⛔",
  rota_saiu: "🚦",
  rota_concluida: "🏁",
};

// ---------- Helpers ----------

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function formatarData(isoOuLocal) {
  if (!isoOuLocal) return "—";
  const d = new Date(isoOuLocal);
  if (Number.isNaN(d.getTime())) return isoOuLocal;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function pad(n) { return String(n).padStart(2, "0"); }

function paraDatetimeLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Dados do solicitante logado. Numa aplicação real viriam da sessão/autenticação;
 * aqui ficam salvos no localStorage para simular "meu perfil" sem tela de login.
 */
function obterPerfilSolicitante() {
  try {
    return JSON.parse(localStorage.getItem("hemocar_perfil_solicitante") || "{}");
  } catch (e) {
    return {};
  }
}

function salvarPerfilSolicitante({ nome, setor }) {
  localStorage.setItem("hemocar_perfil_solicitante", JSON.stringify({ nome: nome.trim(), setor: (setor || "").trim() }));
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- Render raiz ----------

function garantirAbaValida() {
  const abas = TABS_POR_PERFIL[estado.perfil];
  if (!abas.some((a) => a.id === estado.aba)) {
    estado.aba = abas[0].id;
  }
}

function render() {
  garantirAbaValida();
  renderTabs();
  renderConteudo();
  renderChipPerfil();
  sincronizarNotificacoes();
}

function renderTabs() {
  const nav = document.getElementById("tabs");
  const abas = TABS_POR_PERFIL[estado.perfil];
  nav.innerHTML = abas
    .map(
      (a) => `<button class="tab-btn${a.id === estado.aba ? " active" : ""}" data-aba="${a.id}">${a.label}</button>`
    )
    .join("");
  nav.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.aba = btn.dataset.aba;
      estado.analisando = null;
      estado.editandoRota = null;
      estado.registrandoRota = null;
      estado.pagina = 1;
      limparSelecaoAnalise();
      render();
    });
  });
}

function renderConteudo() {
  const main = document.getElementById("conteudo");
  switch (estado.aba) {
    case "novoPedido": main.innerHTML = viewNovoPedido(); break;
    case "meusPedidos": main.innerHTML = viewMeusPedidos(); break;
    case "analise": main.innerHTML = viewAnalise(); break;
    case "rotas": main.innerHTML = viewRotas(); break;
    case "cadastros": main.innerHTML = viewCadastros(); break;
    case "portariaSaida": main.innerHTML = viewPortariaSaida(); break;
    case "portariaChegada": main.innerHTML = viewPortariaChegada(); break;
    case "portariaHistorico": main.innerHTML = viewPortariaHistorico(); break;
    default: main.innerHTML = "";
  }
  ligarEventosDaAba();
}

// ---------- View: Novo Pedido (Solicitante) ----------

/** Formulário curto para configurar nome/setor uma única vez (simula dados do usuário logado). */
function viewSolicitarPerfil(mensagem) {
  return `
    <section class="painel">
      <h2>Antes de continuar, confirme seus dados</h2>
      <p class="sub">${escapeHtml(mensagem)}</p>
      <form id="formPerfilInicial">
        <div class="form-grid">
          <div class="campo">
            <label for="perfilInicialNome">Seu nome</label>
            <input id="perfilInicialNome" name="nome" required placeholder="Ex.: Maria Souza" />
          </div>
          <div class="campo">
            <label for="perfilInicialSetor">Setor / Unidade</label>
            <input id="perfilInicialSetor" name="setor" placeholder="Ex.: Unidade de Coleta - Centro" />
          </div>
        </div>
        <div class="form-acoes">
          <button type="submit" class="btn">Salvar e continuar</button>
        </div>
      </form>
    </section>
  `;
}

function viewNovoPedido() {
  const perfil = obterPerfilSolicitante();
  if (!perfil.nome) {
    return viewSolicitarPerfil("Seu nome e setor identificam quem está solicitando o transporte. Depois disso você não precisa preenchê-los de novo.");
  }

  const hospitais = DB.listarHospitais();
  if (hospitais.length === 0) {
    return `
      <section class="painel">
        <h2>Novo pedido de transporte</h2>
        <div class="vazio">Nenhum endereço cadastrado ainda. Peça para a Equipe de Transporte cadastrar os locais (hospitais, hemocentros etc.) na aba "Cadastros" antes de criar um pedido.</div>
      </section>
    `;
  }

  const sugestaoData = paraDatetimeLocal(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const opcoesEndereco = hospitais
    .map((h) => `<option value="${escapeHtml(h.nome)}">${escapeHtml(h.nome)} — ${escapeHtml(h.cidade)}</option>`)
    .join("");

  return `
    <section class="painel">
      <h2>Novo pedido de transporte</h2>
      <p class="sub">
        Enviando como <strong>${escapeHtml(perfil.nome)}</strong>${perfil.setor ? ` · ${escapeHtml(perfil.setor)}` : ""}.
        <button type="button" id="linkEditarPerfil" class="link-btn">alterar meus dados</button>
      </p>
      <form id="formNovoPedido">
        <div class="form-grid">
          <div class="campo">
            <label for="origem">Origem</label>
            <select id="origem" name="origem" required>
              <option value="" disabled selected>Selecione o endereço</option>
              ${opcoesEndereco}
            </select>
          </div>
          <div class="campo">
            <label for="destino">Destino</label>
            <select id="destino" name="destino" required>
              <option value="" disabled selected>Selecione o endereço</option>
              ${opcoesEndereco}
            </select>
          </div>
          <div class="campo">
            <label for="dataDesejada">Data/hora desejada</label>
            <input id="dataDesejada" type="datetime-local" name="dataDesejada" required value="${sugestaoData}" />
          </div>
          <div class="campo">
            <label for="tipo">Tipo de transporte</label>
            <select id="tipo" name="tipo">
              <option value="coleta">Coleta</option>
              <option value="entrega">Entrega</option>
              <option value="transferencia">Transferência entre unidades</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div class="campo">
            <label for="prioridade">Prioridade</label>
            <select id="prioridade" name="prioridade">
              <option value="normal">Normal</option>
              <option value="baixa">Baixa</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div class="campo full">
            <label for="observacoes">Observações</label>
            <textarea id="observacoes" name="observacoes" placeholder="Detalhes relevantes para o transporte (ex.: carga refrigerada, ponto de referência, contato)"></textarea>
          </div>
        </div>
        <div class="form-acoes">
          <button type="submit" class="btn">Enviar pedido</button>
          <button type="reset" class="btn secundario">Limpar</button>
        </div>
      </form>
    </section>
  `;
}

async function tratarSubmitNovoPedido(ev) {
  ev.preventDefault();
  const form = ev.target;
  const dados = Object.fromEntries(new FormData(form).entries());

  if (!dados.origem || !dados.destino || !dados.dataDesejada) {
    toast("Preencha os campos obrigatórios.");
    return;
  }
  if (dados.origem === dados.destino) {
    toast("Origem e destino não podem ser o mesmo endereço.");
    return;
  }

  const perfil = obterPerfilSolicitante();
  try {
    await DB.criarPedido({ ...dados, solicitante: perfil.nome, setor: perfil.setor });
    toast("Pedido enviado para análise da equipe de transporte.");
    estado.aba = "meusPedidos";
    estado.pagina = 1;
    render();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- View: Meus Pedidos (Solicitante) ----------

function viewMeusPedidos() {
  const perfil = obterPerfilSolicitante();
  if (!perfil.nome) {
    return viewSolicitarPerfil("Confirme seus dados para localizarmos os pedidos feitos por você.");
  }

  const todos = DB.listarPedidos();
  const rotas = DB.listarRotas();
  const motoristas = DB.listarMotoristas();
  const veiculos = DB.listarVeiculos();

  const filtro = perfil.nome.trim().toLowerCase();
  const pedidos = todos.filter((p) => p.solicitante.toLowerCase() === filtro);
  const { itens, paginaAtual, totalPaginas, total } = paginar(pedidos, estado.pagina);

  const cards = itens.length
    ? itens.map((p) => cardPedidoSolicitante(p, rotas, motoristas, veiculos)).join("")
    : `<div class="vazio">Você ainda não tem pedidos de transporte.</div>`;

  return `
    <section class="painel">
      <h2>Meus pedidos</h2>
      <p class="sub">Pedidos feitos por <strong>${escapeHtml(perfil.nome)}</strong>${total ? ` (${total})` : ""}.</p>
      <div class="lista-cards">${cards}</div>
      ${renderPaginacao({ paginaAtual, totalPaginas, total })}
    </section>
  `;
}

/** Rótulo amigável para o status de uma rota (programada / em trânsito / concluída). */
function rotuloStatusRota(rota) {
  if (rota.status === "concluida") return "Concluída";
  if (rota.status === "em_transito") return "Em trânsito";
  return "Programada";
}

function cardPedidoSolicitante(pedido, rotas, motoristas, veiculos) {
  const rota = pedido.rotaId ? rotas.find((r) => r.id === pedido.rotaId) : null;
  const motorista = rota ? motoristas.find((m) => m.id === rota.motoristaId) : null;
  const veiculo = rota ? veiculos.find((v) => v.id === rota.veiculoId) : null;

  let extra = "";
  if (pedido.status === "rejeitado" && pedido.motivoRejeicao) {
    extra = `<p class="card-obs">Motivo da rejeição: ${escapeHtml(pedido.motivoRejeicao)}</p>`;
  }
  if (rota) {
    extra += `
      <dl class="card-corpo" style="margin-top:10px;">
        <div><dt>Motorista</dt><dd>${escapeHtml(motorista?.nome || "—")}</dd></div>
        <div><dt>Veículo</dt><dd>${escapeHtml(veiculo ? `${veiculo.placa} — ${veiculo.modelo}` : "—")}</dd></div>
        <div><dt>Horário de saída (previsto)</dt><dd>${formatarData(rota.horarioSaida)}</dd></div>
        <div><dt>Previsão de término</dt><dd>${formatarData(rota.previsaoTermino)}</dd></div>
        <div><dt>Status da rota</dt><dd>${rotuloStatusRota(rota)}</dd></div>
        ${rota.horarioSaidaReal ? `<div><dt>Saída registrada</dt><dd>${formatarData(rota.horarioSaidaReal)} · KM ${rota.kmSaida ?? "—"}</dd></div>` : ""}
        ${rota.horarioChegadaReal ? `<div><dt>Chegada registrada</dt><dd>${formatarData(rota.horarioChegadaReal)} · KM ${rota.kmChegada ?? "—"}</dd></div>` : ""}
      </dl>
    `;
  }

  return `
    <article class="card">
      <div class="card-topo">
        <div>
          <div class="card-titulo">${escapeHtml(pedido.origem)} → ${escapeHtml(pedido.destino)}</div>
          <div class="card-meta">Solicitado em ${formatarData(pedido.criadoEm)} · ${escapeHtml(pedido.setor || "sem setor informado")}</div>
        </div>
        <div>
          <span class="badge ${pedido.status}">${ROTULO_STATUS_PEDIDO[pedido.status]}</span>
          <span class="badge prioridade-${pedido.prioridade}">${ROTULO_PRIORIDADE[pedido.prioridade] || pedido.prioridade}</span>
        </div>
      </div>
      <dl class="card-corpo">
        <div><dt>Data desejada</dt><dd>${formatarData(pedido.dataDesejada)}</dd></div>
        <div><dt>Tipo</dt><dd>${escapeHtml(pedido.tipo)}</dd></div>
      </dl>
      ${pedido.observacoes ? `<p class="card-obs">${escapeHtml(pedido.observacoes)}</p>` : ""}
      ${extra}
    </article>
  `;
}

// ---------- View: Análise de Pedidos (Transporte) ----------

function normalizarTexto(s) {
  return (s || "").trim().toLowerCase();
}

/**
 * Regional do pedido, a partir do hospital cadastrado cujo nome bate com o
 * destino. A regional é uma zona administrativa mais ampla que a cidade —
 * pode juntar várias cidades próximas (ex.: "Regional Cariri" cobre Juazeiro
 * do Norte, Crato, Barbalha...) — por isso é a base do agrupamento "mesma
 * região", não a cidade isolada. Se o hospital não tiver regional preenchida,
 * cai para a cidade dele como aproximação.
 */
function regiaoDoPedido(pedido, hospitais) {
  const destino = normalizarTexto(pedido.destino);
  if (!destino) return null;
  const hospital = hospitais.find((h) => {
    const nome = normalizarTexto(h.nome);
    if (!nome) return false;
    if (nome === destino) return true;
    return nome.length >= 4 && destino.length >= 4 && (nome.includes(destino) || destino.includes(nome));
  });
  if (!hospital) return null;
  return hospital.regional || hospital.cidade || null;
}

// pedidos pra mesma rota não devem ter horário desejado muito distante entre
// si — não faz sentido sugerir juntar quem quer sair de manhã com quem quer
// sair à noite, mesmo indo pro mesmo lugar.
const JANELA_AGRUPAMENTO_MS = 3 * 60 * 60 * 1000; // 3 horas

/**
 * Quebra uma lista de pedidos (já filtrada por mesmo destino ou mesma
 * região) em grupos cujo horário desejado está próximo: ordena por
 * dataDesejada e abre um grupo novo sempre que o intervalo para o pedido
 * anterior passa da janela de agrupamento. Pedidos sem dataDesejada não
 * entram em nenhum grupo (não dá pra julgar proximidade sem ela).
 */
function agruparPorHorarioProximo(pedidos) {
  const comHorario = pedidos
    .filter((p) => p.dataDesejada)
    .slice()
    .sort((a, b) => new Date(a.dataDesejada) - new Date(b.dataDesejada));

  const grupos = [];
  let atual = [];
  comHorario.forEach((p) => {
    const anterior = atual[atual.length - 1];
    if (anterior && new Date(p.dataDesejada) - new Date(anterior.dataDesejada) > JANELA_AGRUPAMENTO_MS) {
      grupos.push(atual);
      atual = [];
    }
    atual.push(p);
  });
  if (atual.length) grupos.push(atual);
  return grupos;
}

/** Texto do intervalo de horário desejado coberto por um grupo de pedidos. */
function faixaHorario(pedidos) {
  const datas = pedidos.map((p) => p.dataDesejada).filter(Boolean).sort();
  if (!datas.length) return "";
  const inicio = formatarData(datas[0]);
  const fim = formatarData(datas[datas.length - 1]);
  return inicio === fim ? inicio : `${inicio} – ${fim}`;
}

/**
 * Agrupa os pedidos pendentes por destino e por região (cidade/regional do
 * hospital de destino) E por proximidade de horário desejado, pra ajudar a
 * equipe de transporte a enxergar quais pedidos dá pra juntar numa mesma
 * rota de verdade. Só entram grupos com 2+ pedidos.
 */
function agruparPendentesParaRota(pendentes, hospitais) {
  const gruposDestino = [];
  const gruposRegiao = [];

  const porDestino = new Map(); // chave normalizada -> { rotulo, pedidos: [] }
  pendentes.forEach((p) => {
    const chave = normalizarTexto(p.destino);
    if (!chave) return;
    if (!porDestino.has(chave)) porDestino.set(chave, { rotulo: p.destino, pedidos: [] });
    porDestino.get(chave).pedidos.push(p);
  });
  porDestino.forEach(({ rotulo, pedidos }) => {
    agruparPorHorarioProximo(pedidos)
      .filter((grupo) => grupo.length > 1)
      .forEach((grupo) => gruposDestino.push({ rotulo, faixa: faixaHorario(grupo), ids: grupo.map((p) => p.id) }));
  });

  // regional só entra na sugestão se juntar destinos DIFERENTES — senão é
  // redundante com o grupo de destino (ex.: 3 pedidos pro mesmo hospital já
  // aparecem no grupo de destino; regional só ajuda quando são hospitais
  // diferentes na mesma zona).
  const porRegiao = new Map();
  pendentes.forEach((p) => {
    const regiao = regiaoDoPedido(p, hospitais);
    if (!regiao) return;
    const chave = normalizarTexto(regiao);
    if (!porRegiao.has(chave)) porRegiao.set(chave, { rotulo: regiao, pedidos: [] });
    porRegiao.get(chave).pedidos.push(p);
  });
  porRegiao.forEach(({ rotulo, pedidos }) => {
    agruparPorHorarioProximo(pedidos)
      .filter((grupo) => grupo.length > 1)
      .filter((grupo) => new Set(grupo.map((p) => normalizarTexto(p.destino))).size > 1)
      .forEach((grupo) => gruposRegiao.push({ rotulo, faixa: faixaHorario(grupo), ids: grupo.map((p) => p.id) }));
  });

  gruposDestino.sort((a, b) => b.ids.length - a.ids.length);
  gruposRegiao.sort((a, b) => b.ids.length - a.ids.length);

  const infoPorPedido = new Map(); // pedidoId -> { destinoCount, regiao, regiaoCount }
  pendentes.forEach((p) => {
    const grupoDestino = gruposDestino.find((g) => g.ids.includes(p.id));
    const grupoRegiao = gruposRegiao.find((g) => g.ids.includes(p.id));
    infoPorPedido.set(p.id, {
      destinoCount: grupoDestino ? grupoDestino.ids.length : 1,
      regiao: regiaoDoPedido(p, hospitais),
      regiaoCount: grupoRegiao ? grupoRegiao.ids.length : 0,
    });
  });

  return { infoPorPedido, gruposDestino, gruposRegiao };
}

/** Painel com sugestões de agrupamento (mesmo destino / mesma região, com horários próximos), com atalho para selecionar todos de uma vez. */
function painelSugestoesAgrupamento(gruposDestino, gruposRegiao) {
  if (!gruposDestino.length && !gruposRegiao.length) return "";

  const chip = (grupo, icone) => `
    <div class="sugestao-grupo">
      <span>${icone} <strong>${escapeHtml(grupo.rotulo)}</strong>${grupo.faixa ? ` · ${escapeHtml(grupo.faixa)}` : ""} — ${grupo.ids.length} pedidos</span>
      <button type="button" class="btn secundario pequeno" data-selecionar-grupo="${grupo.ids.join(",")}">Selecionar todos</button>
    </div>
  `;

  return `
    <div class="sugestoes-agrupamento">
      <h3>Sugestões para agrupar numa rota</h3>
      <p class="card-obs" style="margin-top:0;">Só agrupamos pedidos com horário desejado próximo (até 3h de diferença) — não faz sentido levar quem quer sair de manhã junto com quem quer sair à noite, mesmo pro mesmo lugar.</p>
      ${gruposDestino.map((g) => chip(g, "📍")).join("")}
      ${gruposRegiao.map((g) => chip(g, "🗺️")).join("")}
    </div>
  `;
}

function viewAnalise() {
  const pedidos = DB.listarPedidos();
  const pendentes = pedidos.filter((p) => p.status === "pendente");

  // remove da seleção pedidos que não estão mais pendentes (ex.: outra pessoa já analisou)
  const idsPendentes = new Set(pendentes.map((p) => p.id));
  [...estado.selecionados].forEach((id) => {
    if (!idsPendentes.has(id)) estado.selecionados.delete(id);
  });
  if (estado.selecionados.size === 0) estado.aprovandoLote = false;

  const motoristas = DB.listarMotoristas();
  const veiculos = DB.listarVeiculos();

  const contadores = {
    pendente: pedidos.filter((p) => p.status === "pendente").length,
    roteirizado: pedidos.filter((p) => p.status === "roteirizado").length,
    concluido: pedidos.filter((p) => p.status === "concluido").length,
    rejeitado: pedidos.filter((p) => p.status === "rejeitado").length,
  };

  const barraSelecao = estado.selecionados.size
    ? barraSelecaoLote(pendentes, motoristas, veiculos)
    : "";

  const hospitais = DB.listarHospitais();
  const { infoPorPedido, gruposDestino, gruposRegiao } = agruparPendentesParaRota(pendentes, hospitais);
  const sugestoes = painelSugestoesAgrupamento(gruposDestino, gruposRegiao);

  const { itens, paginaAtual, totalPaginas, total } = paginar(pendentes, estado.pagina);
  const cards = itens.length
    ? itens.map((p) => cardPedidoAnalise(p, infoPorPedido.get(p.id))).join("")
    : `<div class="vazio">Nenhum pedido pendente de análise no momento.</div>`;

  return `
    <div class="stat-row">
      <div class="stat-card"><div class="valor">${contadores.pendente}</div><div class="rotulo">Pendentes</div></div>
      <div class="stat-card"><div class="valor">${contadores.roteirizado}</div><div class="rotulo">Roteirizados</div></div>
      <div class="stat-card"><div class="valor">${contadores.concluido}</div><div class="rotulo">Concluídos</div></div>
      <div class="stat-card"><div class="valor">${contadores.rejeitado}</div><div class="rotulo">Rejeitados</div></div>
    </div>
    <section class="painel">
      <h2>Pedidos pendentes de análise</h2>
      <p class="sub">Marque um ou mais pedidos para aprovar juntos numa mesma rota (mesmo motorista, veículo, horário de saída e previsão de término), ou rejeite individualmente.</p>
      ${sugestoes}
      ${barraSelecao}
      <div class="lista-cards">${cards}</div>
      ${renderPaginacao({ paginaAtual, totalPaginas, total })}
    </section>
  `;
}

/** Texto extra mostrado numa opção de <select> quando o recurso está ocupado agora. */
function rotuloDisponibilidade(recurso) {
  if (recurso.status === "em_rota" && recurso.ocupadoAte) {
    return ` — em rota até ${formatarData(recurso.ocupadoAte)}`;
  }
  return "";
}

/** Barra fixa que aparece quando há pedidos marcados, com o formulário para aprová-los juntos. */
function barraSelecaoLote(pendentes, motoristas, veiculos) {
  const selecionados = pendentes.filter((p) => estado.selecionados.has(p.id));
  const n = selecionados.length;

  let formulario = "";
  if (estado.aprovandoLote) {
    const semCadastro = motoristas.length === 0 || veiculos.length === 0;
    const datasDesejadas = selecionados.map((p) => p.dataDesejada).filter(Boolean).sort();
    const sugestaoSaida = datasDesejadas[0] || paraDatetimeLocal(new Date(Date.now() + 60 * 60 * 1000));
    const sugestaoTermino = paraDatetimeLocal(new Date(new Date(sugestaoSaida).getTime() + 2 * 60 * 60 * 1000));
    formulario = `
      <div class="analise-form">
        <h4>Aprovar ${n} pedido${n === 1 ? "" : "s"} numa rota</h4>
        ${semCadastro ? `<p class="card-obs">Cadastre ao menos um motorista e um veículo na aba "Cadastros" antes de aprovar.</p>` : `
          <p class="card-obs">Motoristas e veículos já em outra rota também aparecem na lista — pode escalar, desde que o horário não se sobreponha.</p>
        `}
        <form data-form="aprovar-lote">
          <div class="form-grid">
            <div class="campo">
              <label for="motoristaLote">Motorista</label>
              <select id="motoristaLote" name="motoristaId" required>
                ${motoristas.map((m) => `<option value="${m.id}">${escapeHtml(m.nome)}${rotuloDisponibilidade(m)}</option>`).join("")}
              </select>
            </div>
            <div class="campo">
              <label for="veiculoLote">Veículo</label>
              <select id="veiculoLote" name="veiculoId" required>
                ${veiculos.map((v) => `<option value="${v.id}">${escapeHtml(v.placa)} — ${escapeHtml(v.modelo)}${rotuloDisponibilidade(v)}</option>`).join("")}
              </select>
            </div>
            <div class="campo">
              <label for="horarioLote">Horário de saída</label>
              <input id="horarioLote" type="datetime-local" name="horarioSaida" required value="${sugestaoSaida}" />
            </div>
            <div class="campo">
              <label for="terminoLote">Previsão de término</label>
              <input id="terminoLote" type="datetime-local" name="previsaoTermino" required value="${sugestaoTermino}" />
            </div>
          </div>
          <div class="form-acoes">
            <button type="submit" class="btn sucesso" ${semCadastro ? "disabled" : ""}>Confirmar rota</button>
            <button type="button" class="btn secundario" data-cancelar-lote>Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  return `
    <div class="selecao-lote">
      <div class="selecao-lote-topo">
        <span>${n} pedido${n === 1 ? "" : "s"} selecionado${n === 1 ? "" : "s"} para uma mesma rota</span>
        <div class="form-acoes" style="margin-top:0;">
          ${!estado.aprovandoLote ? `<button type="button" class="btn sucesso pequeno" data-abrir-aprovar-lote>Aprovar selecionados</button>` : ""}
          <button type="button" class="btn secundario pequeno" data-limpar-selecao>Limpar seleção</button>
        </div>
      </div>
      ${formulario}
    </div>
  `;
}

function cardPedidoAnalise(pedido, infoGrupo) {
  const selecionado = estado.selecionados.has(pedido.id);
  const analisandoEste = estado.analisando?.pedidoId === pedido.id ? estado.analisando.acao : null;

  let selosGrupo = "";
  if (infoGrupo?.destinoCount > 1) {
    selosGrupo += `<span class="badge grupo" title="Outros pedidos com o mesmo destino e horário desejado próximo (até 3h)">📍 mesmo destino ×${infoGrupo.destinoCount}</span>`;
  } else if (infoGrupo?.regiaoCount > 1) {
    selosGrupo += `<span class="badge grupo" title="Outros pedidos na mesma região (${escapeHtml(infoGrupo.regiao)}) e horário desejado próximo (até 3h)">🗺️ mesma região ×${infoGrupo.regiaoCount}</span>`;
  }

  let formulario = "";
  if (analisandoEste === "rejeitar") {
    formulario = `
      <div class="analise-form">
        <h4>Rejeitar pedido</h4>
        <form data-form="rejeitar" data-pedido-id="${pedido.id}">
          <div class="campo full">
            <label for="motivo-${pedido.id}">Motivo da rejeição</label>
            <textarea id="motivo-${pedido.id}" name="motivo" required placeholder="Ex.: Sem disponibilidade de veículo para o horário solicitado"></textarea>
          </div>
          <div class="form-acoes">
            <button type="submit" class="btn perigo">Confirmar rejeição</button>
            <button type="button" class="btn secundario" data-cancelar-analise>Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  return `
    <article class="card${selecionado ? " card-selecionado" : ""}">
      <div class="card-topo">
        <label class="selecao-pedido">
          <input type="checkbox" data-selecionar-pedido="${pedido.id}" ${selecionado ? "checked" : ""} />
          <div>
            <div class="card-titulo">${escapeHtml(pedido.origem)} → ${escapeHtml(pedido.destino)}</div>
            <div class="card-meta">Solicitado por ${escapeHtml(pedido.solicitante)} · ${escapeHtml(pedido.setor || "sem setor informado")} · ${formatarData(pedido.criadoEm)}</div>
          </div>
        </label>
        <div>
          <span class="badge ${pedido.status}">${ROTULO_STATUS_PEDIDO[pedido.status]}</span>
          <span class="badge prioridade-${pedido.prioridade}">${ROTULO_PRIORIDADE[pedido.prioridade] || pedido.prioridade}</span>
          ${selosGrupo}
        </div>
      </div>
      <dl class="card-corpo">
        <div><dt>Data desejada</dt><dd>${formatarData(pedido.dataDesejada)}</dd></div>
        <div><dt>Tipo</dt><dd>${escapeHtml(pedido.tipo)}</dd></div>
      </dl>
      ${pedido.observacoes ? `<p class="card-obs">${escapeHtml(pedido.observacoes)}</p>` : ""}
      ${!analisandoEste ? `
        <div class="card-acoes">
          <button class="btn perigo pequeno" data-iniciar-analise="rejeitar" data-pedido-id="${pedido.id}">Rejeitar</button>
        </div>
      ` : ""}
      ${formulario}
    </article>
  `;
}

// ---------- View: Rotas Programadas (Transporte) ----------

/** Formulário inline para editar motorista/veículo/horário/previsão de uma rota programada. */
function formularioEditarRota(rota, motoristas, veiculos) {
  return `
    <div class="analise-form">
      <h4>Editar rota</h4>
      <p class="card-obs">Motoristas e veículos em outra rota também aparecem na lista — pode escalar, desde que o horário não se sobreponha.</p>
      <form data-form="editar-rota" data-rota-id="${rota.id}">
        <div class="form-grid">
          <div class="campo">
            <label for="motoristaEditar-${rota.id}">Motorista</label>
            <select id="motoristaEditar-${rota.id}" name="motoristaId" required>
              ${motoristas.map((m) => `<option value="${m.id}" ${m.id === rota.motoristaId ? "selected" : ""}>${escapeHtml(m.nome)}${rotuloDisponibilidade(m)}</option>`).join("")}
            </select>
          </div>
          <div class="campo">
            <label for="veiculoEditar-${rota.id}">Veículo</label>
            <select id="veiculoEditar-${rota.id}" name="veiculoId" required>
              ${veiculos.map((v) => `<option value="${v.id}" ${v.id === rota.veiculoId ? "selected" : ""}>${escapeHtml(v.placa)} — ${escapeHtml(v.modelo)}${rotuloDisponibilidade(v)}</option>`).join("")}
            </select>
          </div>
          <div class="campo">
            <label for="horarioEditar-${rota.id}">Horário de saída</label>
            <input id="horarioEditar-${rota.id}" type="datetime-local" name="horarioSaida" required value="${rota.horarioSaida}" />
          </div>
          <div class="campo">
            <label for="terminoEditar-${rota.id}">Previsão de término</label>
            <input id="terminoEditar-${rota.id}" type="datetime-local" name="previsaoTermino" required value="${rota.previsaoTermino || ""}" />
          </div>
        </div>
        <div class="form-acoes">
          <button type="submit" class="btn sucesso">Salvar alterações</button>
          <button type="button" class="btn secundario" data-cancelar-editar-rota>Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function viewRotas() {
  const rotas = DB.listarRotas();
  const pedidos = DB.listarPedidos();
  const motoristas = DB.listarMotoristas();
  const veiculos = DB.listarVeiculos();

  if (!rotas.length) {
    return `<section class="painel"><h2>Rotas programadas</h2><div class="vazio">Nenhuma rota escalada ainda.</div></section>`;
  }

  const { itens, paginaAtual, totalPaginas, total } = paginar(rotas, estado.pagina);

  const cards = itens.map((r) => {
    const motorista = motoristas.find((m) => m.id === r.motoristaId);
    const veiculo = veiculos.find((v) => v.id === r.veiculoId);
    const pedidosDaRota = r.pedidoIds.map((id) => pedidos.find((p) => p.id === id)).filter(Boolean);

    const paradas = pedidosDaRota.length
      ? pedidosDaRota.map((p) => `
          <li>
            <strong>${escapeHtml(p.origem)} → ${escapeHtml(p.destino)}</strong>
            <span class="parada-meta">${escapeHtml(p.solicitante)}${p.setor ? ` · ${escapeHtml(p.setor)}` : ""}</span>
          </li>
        `).join("")
      : `<li class="parada-meta">Nenhum pedido vinculado.</li>`;

    const editandoEsta = estado.editandoRota === r.id;
    const formularioEdicao = editandoEsta ? formularioEditarRota(r, motoristas, veiculos) : "";

    const registro = [];
    if (r.horarioSaidaReal) registro.push(`<div><dt>Saída registrada</dt><dd>${formatarData(r.horarioSaidaReal)} · KM ${r.kmSaida ?? "—"}</dd></div>`);
    if (r.horarioChegadaReal) registro.push(`<div><dt>Chegada registrada</dt><dd>${formatarData(r.horarioChegadaReal)} · KM ${r.kmChegada ?? "—"}</dd></div>`);
    const blocoRegistro = registro.length ? `<dl class="card-corpo" style="margin-top:8px;">${registro.join("")}</dl>` : "";

    const badgeStatus = r.status === "concluida" ? "concluido" : r.status === "em_transito" ? "em_transito" : "roteirizado";

    return `
      <article class="card">
        <div class="card-topo">
          <div>
            <div class="card-titulo">${pedidosDaRota.length} pedido${pedidosDaRota.length === 1 ? "" : "s"} nesta rota</div>
            <div class="card-meta">
              Saída prevista ${formatarData(r.horarioSaida)} · Previsão de término ${formatarData(r.previsaoTermino)}<br />
              Motorista ${escapeHtml(motorista?.nome || "—")} · Veículo ${escapeHtml(veiculo ? `${veiculo.placa} — ${veiculo.modelo}` : "—")}
            </div>
          </div>
          <span class="badge ${badgeStatus}">${rotuloStatusRota(r)}</span>
        </div>
        <ul class="lista-paradas">${paradas}</ul>
        ${blocoRegistro}
        <p class="card-obs">A saída e a chegada são registradas pela Portaria.</p>
        ${r.status === "programada" && !editandoEsta ? `
          <div class="card-acoes">
            <button class="btn secundario pequeno" data-editar-rota="${r.id}">Editar</button>
          </div>
        ` : ""}
        ${formularioEdicao}
      </article>
    `;
  }).join("");

  return `
    <section class="painel">
      <h2>Rotas programadas</h2>
      <p class="sub">Rotas geradas a partir dos pedidos aprovados — uma rota pode levar mais de um pedido (${total}).</p>
      <div class="lista-cards">${cards}</div>
      ${renderPaginacao({ paginaAtual, totalPaginas, total })}
    </section>
  `;
}

// ---------- Views: Portaria ----------

/** Card de uma rota no contexto da Portaria — ação de saída/chegada ou histórico, conforme o modo. */
function cardRotaPortaria(rota, pedidos, motoristas, veiculos, modo) {
  const motorista = motoristas.find((m) => m.id === rota.motoristaId);
  const veiculo = veiculos.find((v) => v.id === rota.veiculoId);
  const pedidosDaRota = rota.pedidoIds.map((id) => pedidos.find((p) => p.id === id)).filter(Boolean);

  const paradas = pedidosDaRota.length
    ? pedidosDaRota.map((p) => `
        <li>
          <strong>${escapeHtml(p.origem)} → ${escapeHtml(p.destino)}</strong>
          <span class="parada-meta">${escapeHtml(p.solicitante)}${p.setor ? ` · ${escapeHtml(p.setor)}` : ""}</span>
        </li>
      `).join("")
    : `<li class="parada-meta">Nenhum pedido vinculado.</li>`;

  const registrandoEsta = estado.registrandoRota?.rotaId === rota.id ? estado.registrandoRota.acao : null;

  let formulario = "";
  if (registrandoEsta === "saida") {
    formulario = `
      <div class="analise-form">
        <h4>Registrar saída</h4>
        <form data-form="registrar-saida" data-rota-id="${rota.id}">
          <div class="form-grid">
            <div class="campo">
              <label for="kmSaida-${rota.id}">KM de saída</label>
              <input id="kmSaida-${rota.id}" type="number" min="0" step="1" name="kmSaida" required placeholder="Ex.: 45210" />
            </div>
            <div class="campo">
              <label for="horarioSaidaReal-${rota.id}">Horário de saída</label>
              <input id="horarioSaidaReal-${rota.id}" type="datetime-local" name="horarioSaidaReal" required value="${paraDatetimeLocal(new Date())}" />
            </div>
          </div>
          <div class="form-acoes">
            <button type="submit" class="btn sucesso">Confirmar saída</button>
            <button type="button" class="btn secundario" data-cancelar-registro>Cancelar</button>
          </div>
        </form>
      </div>
    `;
  } else if (registrandoEsta === "chegada") {
    formulario = `
      <div class="analise-form">
        <h4>Registrar chegada</h4>
        <form data-form="registrar-chegada" data-rota-id="${rota.id}">
          <div class="form-grid">
            <div class="campo">
              <label for="kmChegada-${rota.id}">KM de chegada</label>
              <input id="kmChegada-${rota.id}" type="number" min="${rota.kmSaida ?? 0}" step="1" name="kmChegada" required placeholder="Ex.: 45260" />
            </div>
            <div class="campo">
              <label for="horarioChegadaReal-${rota.id}">Horário de chegada</label>
              <input id="horarioChegadaReal-${rota.id}" type="datetime-local" name="horarioChegadaReal" required value="${paraDatetimeLocal(new Date())}" />
            </div>
          </div>
          <div class="form-acoes">
            <button type="submit" class="btn sucesso">Confirmar chegada</button>
            <button type="button" class="btn secundario" data-cancelar-registro>Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  const registro = [];
  if (rota.horarioSaidaReal) registro.push(`<div><dt>Saída registrada</dt><dd>${formatarData(rota.horarioSaidaReal)} · KM ${rota.kmSaida ?? "—"}</dd></div>`);
  if (rota.horarioChegadaReal) registro.push(`<div><dt>Chegada registrada</dt><dd>${formatarData(rota.horarioChegadaReal)} · KM ${rota.kmChegada ?? "—"}</dd></div>`);
  const blocoRegistro = registro.length ? `<dl class="card-corpo" style="margin-top:8px;">${registro.join("")}</dl>` : "";

  const badgeStatus = rota.status === "concluida" ? "concluido" : rota.status === "em_transito" ? "em_transito" : "roteirizado";

  let acao = "";
  if (!registrandoEsta) {
    if (modo === "saida") {
      acao = `<div class="card-acoes"><button class="btn sucesso pequeno" data-iniciar-registro="saida" data-rota-id="${rota.id}">Registrar saída</button></div>`;
    } else if (modo === "chegada") {
      acao = `<div class="card-acoes"><button class="btn sucesso pequeno" data-iniciar-registro="chegada" data-rota-id="${rota.id}">Registrar chegada</button></div>`;
    }
  }

  return `
    <article class="card">
      <div class="card-topo">
        <div>
          <div class="card-titulo">${pedidosDaRota.length} pedido${pedidosDaRota.length === 1 ? "" : "s"} · Motorista ${escapeHtml(motorista?.nome || "—")}</div>
          <div class="card-meta">
            Veículo ${escapeHtml(veiculo ? `${veiculo.placa} — ${veiculo.modelo}` : "—")}<br />
            Saída prevista ${formatarData(rota.horarioSaida)} · Previsão de término ${formatarData(rota.previsaoTermino)}
          </div>
        </div>
        <span class="badge ${badgeStatus}">${rotuloStatusRota(rota)}</span>
      </div>
      <ul class="lista-paradas">${paradas}</ul>
      ${blocoRegistro}
      ${acao}
      ${formulario}
    </article>
  `;
}

function viewPortariaSaida() {
  const rotas = DB.listarRotas().filter((r) => r.status === "programada");
  const pedidos = DB.listarPedidos();
  const motoristas = DB.listarMotoristas();
  const veiculos = DB.listarVeiculos();

  const { itens, paginaAtual, totalPaginas, total } = paginar(rotas, estado.pagina);
  const cards = itens.length
    ? itens.map((r) => cardRotaPortaria(r, pedidos, motoristas, veiculos, "saida")).join("")
    : `<div class="vazio">Nenhuma rota aguardando saída no momento.</div>`;

  return `
    <section class="painel">
      <h2>Aguardando saída</h2>
      <p class="sub">Rotas já aprovadas pela Equipe de Transporte, prontas para sair. Registre o KM do odômetro e o horário de saída.</p>
      <div class="lista-cards">${cards}</div>
      ${renderPaginacao({ paginaAtual, totalPaginas, total })}
    </section>
  `;
}

function viewPortariaChegada() {
  const rotas = DB.listarRotas().filter((r) => r.status === "em_transito");
  const pedidos = DB.listarPedidos();
  const motoristas = DB.listarMotoristas();
  const veiculos = DB.listarVeiculos();

  const { itens, paginaAtual, totalPaginas, total } = paginar(rotas, estado.pagina);
  const cards = itens.length
    ? itens.map((r) => cardRotaPortaria(r, pedidos, motoristas, veiculos, "chegada")).join("")
    : `<div class="vazio">Nenhuma rota em trânsito no momento.</div>`;

  return `
    <section class="painel">
      <h2>Em trânsito</h2>
      <p class="sub">Rotas que já saíram e ainda não voltaram. Registre o KM do odômetro e o horário de chegada para concluir.</p>
      <div class="lista-cards">${cards}</div>
      ${renderPaginacao({ paginaAtual, totalPaginas, total })}
    </section>
  `;
}

function viewPortariaHistorico() {
  const rotas = DB.listarRotas().filter((r) => r.status === "concluida");
  const pedidos = DB.listarPedidos();
  const motoristas = DB.listarMotoristas();
  const veiculos = DB.listarVeiculos();

  const { itens, paginaAtual, totalPaginas, total } = paginar(rotas, estado.pagina);
  const cards = itens.length
    ? itens.map((r) => cardRotaPortaria(r, pedidos, motoristas, veiculos, null)).join("")
    : `<div class="vazio">Nenhuma rota concluída ainda.</div>`;

  return `
    <section class="painel">
      <h2>Histórico de saídas e chegadas</h2>
      <p class="sub">Rotas já concluídas, com o KM e horário reais de saída e chegada.</p>
      <div class="lista-cards">${cards}</div>
      ${renderPaginacao({ paginaAtual, totalPaginas, total })}
    </section>
  `;
}

// ---------- View: Cadastros (Transporte) ----------

function viewCadastros() {
  const motoristas = DB.listarMotoristas();
  const veiculos = DB.listarVeiculos();
  const hospitais = DB.listarHospitais();

  const linhasMotoristas = motoristas.length
    ? motoristas.map((m) => `
        <tr>
          <td>${escapeHtml(m.nome)}</td>
          <td>${escapeHtml(m.cnh)}</td>
          <td><span class="badge ${m.status}">${m.status === "disponivel" ? "Disponível" : `Em rota até ${formatarData(m.ocupadoAte)}`}</span></td>
          <td><button class="btn secundario pequeno" data-remover-motorista="${m.id}">Remover</button></td>
        </tr>
      `).join("")
    : `<tr><td colspan="4">Nenhum motorista cadastrado.</td></tr>`;

  const linhasVeiculos = veiculos.length
    ? veiculos.map((v) => `
        <tr>
          <td>${escapeHtml(v.placa)}</td>
          <td>${escapeHtml(v.modelo)}</td>
          <td>${escapeHtml(v.capacidade || "—")}</td>
          <td><span class="badge ${v.status}">${v.status === "disponivel" ? "Disponível" : `Em uso até ${formatarData(v.ocupadoAte)}`}</span></td>
          <td><button class="btn secundario pequeno" data-remover-veiculo="${v.id}">Remover</button></td>
        </tr>
      `).join("")
    : `<tr><td colspan="5">Nenhum veículo cadastrado.</td></tr>`;

  const linhasHospitais = hospitais.length
    ? hospitais.map((h) => `
        <tr>
          <td>${escapeHtml(h.nome)}</td>
          <td>${escapeHtml(h.cidade)}</td>
          <td>${escapeHtml(h.regional || "—")}</td>
          <td>${escapeHtml(h.endereco || "—")}</td>
          <td>${escapeHtml(h.telefone || "—")}</td>
          <td><button class="btn secundario pequeno" data-remover-hospital="${h.id}">Remover</button></td>
        </tr>
      `).join("")
    : `<tr><td colspan="6">Nenhum hospital cadastrado.</td></tr>`;

  return `
    <div class="duas-colunas">
      <section class="painel">
        <h2>Motoristas</h2>
        <div style="overflow-x:auto;">
          <table class="tabela-simples">
            <thead><tr><th>Nome</th><th>CNH</th><th>Status</th><th></th></tr></thead>
            <tbody>${linhasMotoristas}</tbody>
          </table>
        </div>
        <form id="formMotorista" class="form-grid" style="margin-top:16px;">
          <div class="campo">
            <label for="nomeMotorista">Nome</label>
            <input id="nomeMotorista" name="nome" required placeholder="Ex.: Ana Ribeiro" />
          </div>
          <div class="campo">
            <label for="cnhMotorista">Categoria CNH</label>
            <input id="cnhMotorista" name="cnh" required placeholder="Ex.: D" />
          </div>
          <div class="campo full form-acoes" style="margin-top:0;">
            <button type="submit" class="btn pequeno">Adicionar motorista</button>
          </div>
        </form>
      </section>

      <section class="painel">
        <h2>Veículos</h2>
        <div style="overflow-x:auto;">
          <table class="tabela-simples">
            <thead><tr><th>Placa</th><th>Modelo</th><th>Capacidade</th><th>Status</th><th></th></tr></thead>
            <tbody>${linhasVeiculos}</tbody>
          </table>
        </div>
        <form id="formVeiculo" class="form-grid" style="margin-top:16px;">
          <div class="campo">
            <label for="placaVeiculo">Placa</label>
            <input id="placaVeiculo" name="placa" required placeholder="Ex.: HMC-1A23" />
          </div>
          <div class="campo">
            <label for="modeloVeiculo">Modelo</label>
            <input id="modeloVeiculo" name="modelo" required placeholder="Ex.: Fiat Doblô" />
          </div>
          <div class="campo">
            <label for="capacidadeVeiculo">Capacidade</label>
            <input id="capacidadeVeiculo" name="capacidade" placeholder="Ex.: 8 caixas térmicas" />
          </div>
          <div class="campo full form-acoes" style="margin-top:0;">
            <button type="submit" class="btn pequeno">Adicionar veículo</button>
          </div>
        </form>
      </section>

      <section class="painel">
        <h2>Hospitais</h2>
        <div style="overflow-x:auto;">
          <table class="tabela-simples">
            <thead><tr><th>Nome</th><th>Cidade</th><th>Regional</th><th>Endereço</th><th>Telefone</th><th></th></tr></thead>
            <tbody>${linhasHospitais}</tbody>
          </table>
        </div>
        <form id="formHospital" class="form-grid" style="margin-top:16px;">
          <div class="campo">
            <label for="nomeHospital">Nome</label>
            <input id="nomeHospital" name="nome" required placeholder="Ex.: Hospital Geral de Fortaleza" />
          </div>
          <div class="campo">
            <label for="cidadeHospital">Cidade</label>
            <input id="cidadeHospital" name="cidade" required placeholder="Ex.: Fortaleza/CE" />
          </div>
          <div class="campo">
            <label for="regionalHospital">Regional</label>
            <input id="regionalHospital" name="regional" placeholder="Ex.: Regional 2" />
          </div>
          <div class="campo">
            <label for="enderecoHospital">Endereço</label>
            <input id="enderecoHospital" name="endereco" placeholder="Ex.: Av. Michel Alcolumbre, 1345" />
          </div>
          <div class="campo">
            <label for="telefoneHospital">Telefone</label>
            <input id="telefoneHospital" name="telefone" placeholder="Ex.: (85) 3101-2500" />
          </div>
          <div class="campo full form-acoes" style="margin-top:0;">
            <button type="submit" class="btn pequeno">Adicionar hospital</button>
          </div>
        </form>
        <p class="card-obs" style="margin-top:10px;">A regional é usada nas sugestões de agrupamento de rota (aba "Análise de Pedidos") como uma zona mais ampla que a cidade — hospitais de cidades diferentes na mesma regional entram na mesma sugestão.</p>
      </section>
    </div>
  `;
}

// ---------- Ligação de eventos por aba ----------

function ligarEventosDaAba() {
  const main = document.getElementById("conteudo");

  main.querySelectorAll("[data-pagina]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.pagina = Number(btn.dataset.pagina);
      renderConteudo();
    });
  });

  main.querySelector("#formNovoPedido")?.addEventListener("submit", tratarSubmitNovoPedido);

  main.querySelector("#formPerfilInicial")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target).entries());
    if (!dados.nome?.trim()) {
      toast("Informe seu nome para continuar.");
      return;
    }
    salvarPerfilSolicitante(dados);
    renderConteudo();
    renderChipPerfil();
  });

  main.querySelector("#linkEditarPerfil")?.addEventListener("click", () => {
    estado.menuPerfilAberto = true;
    renderChipPerfil();
  });

  main.querySelectorAll("[data-iniciar-analise]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.analisando = { pedidoId: btn.dataset.pedidoId, acao: btn.dataset.iniciarAnalise };
      renderConteudo();
    });
  });

  main.querySelectorAll("[data-cancelar-analise]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.analisando = null;
      renderConteudo();
    });
  });

  main.querySelectorAll("[data-selecionar-pedido]").forEach((chk) => {
    chk.addEventListener("change", () => {
      const id = chk.dataset.selecionarPedido;
      if (chk.checked) estado.selecionados.add(id);
      else estado.selecionados.delete(id);
      if (estado.selecionados.size === 0) estado.aprovandoLote = false;
      renderConteudo();
    });
  });

  main.querySelectorAll("[data-selecionar-grupo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.dataset.selecionarGrupo.split(",").filter(Boolean).forEach((id) => estado.selecionados.add(id));
      renderConteudo();
    });
  });

  main.querySelector("[data-abrir-aprovar-lote]")?.addEventListener("click", () => {
    estado.aprovandoLote = true;
    renderConteudo();
  });

  main.querySelector("[data-cancelar-lote]")?.addEventListener("click", () => {
    estado.aprovandoLote = false;
    renderConteudo();
  });

  main.querySelector("[data-limpar-selecao]")?.addEventListener("click", () => {
    limparSelecaoAnalise();
    renderConteudo();
  });

  main.querySelector('form[data-form="aprovar-lote"]')?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const dados = Object.fromEntries(new FormData(form).entries());
    if (!dados.motoristaId || !dados.veiculoId || !dados.horarioSaida || !dados.previsaoTermino) {
      toast("Selecione motorista, veículo, horário de saída e previsão de término.");
      return;
    }
    try {
      await DB.aprovarPedidos({ pedidoIds: [...estado.selecionados], ...dados });
      toast("Rota escalada com sucesso.");
      limparSelecaoAnalise();
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelector('form[data-form="rejeitar"]')?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const pedidoId = form.dataset.pedidoId;
    const { motivo } = Object.fromEntries(new FormData(form).entries());
    if (!motivo?.trim()) {
      toast("Informe o motivo da rejeição.");
      return;
    }
    try {
      await DB.rejeitarPedido(pedidoId, motivo.trim());
      toast("Pedido rejeitado.");
      estado.analisando = null;
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelectorAll("[data-iniciar-registro]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.registrandoRota = { rotaId: btn.dataset.rotaId, acao: btn.dataset.iniciarRegistro };
      renderConteudo();
    });
  });

  main.querySelector("[data-cancelar-registro]")?.addEventListener("click", () => {
    estado.registrandoRota = null;
    renderConteudo();
  });

  main.querySelector('form[data-form="registrar-saida"]')?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const rotaId = form.dataset.rotaId;
    const dados = Object.fromEntries(new FormData(form).entries());
    if (!dados.kmSaida || !dados.horarioSaidaReal) {
      toast("Informe o KM e o horário de saída.");
      return;
    }
    try {
      await DB.registrarSaidaRota(rotaId, dados);
      toast("Saída registrada.");
      estado.registrandoRota = null;
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelector('form[data-form="registrar-chegada"]')?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const rotaId = form.dataset.rotaId;
    const dados = Object.fromEntries(new FormData(form).entries());
    if (!dados.kmChegada || !dados.horarioChegadaReal) {
      toast("Informe o KM e o horário de chegada.");
      return;
    }
    try {
      await DB.registrarChegadaRota(rotaId, dados);
      toast("Chegada registrada. Rota concluída.");
      estado.registrandoRota = null;
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelectorAll("[data-editar-rota]").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.editandoRota = btn.dataset.editarRota;
      renderConteudo();
    });
  });

  main.querySelector("[data-cancelar-editar-rota]")?.addEventListener("click", () => {
    estado.editandoRota = null;
    renderConteudo();
  });

  main.querySelector('form[data-form="editar-rota"]')?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const rotaId = form.dataset.rotaId;
    const dados = Object.fromEntries(new FormData(form).entries());
    if (!dados.motoristaId || !dados.veiculoId || !dados.horarioSaida || !dados.previsaoTermino) {
      toast("Selecione motorista, veículo, horário de saída e previsão de término.");
      return;
    }
    try {
      await DB.editarRota(rotaId, dados);
      toast("Rota atualizada.");
      estado.editandoRota = null;
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelector("#formMotorista")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target).entries());
    if (!dados.nome || !dados.cnh) return;
    try {
      await DB.adicionarMotorista(dados);
      toast("Motorista cadastrado.");
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelectorAll("[data-remover-motorista]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await DB.removerMotorista(btn.dataset.removerMotorista);
      renderConteudo();
    });
  });

  main.querySelector("#formVeiculo")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target).entries());
    if (!dados.placa || !dados.modelo) return;
    try {
      await DB.adicionarVeiculo(dados);
      toast("Veículo cadastrado.");
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelectorAll("[data-remover-veiculo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await DB.removerVeiculo(btn.dataset.removerVeiculo);
      renderConteudo();
    });
  });

  main.querySelector("#formHospital")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target).entries());
    if (!dados.nome || !dados.cidade) return;
    try {
      await DB.adicionarHospital(dados);
      toast("Hospital cadastrado.");
      renderConteudo();
    } catch (e) {
      toast(e.message);
    }
  });

  main.querySelectorAll("[data-remover-hospital]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await DB.removerHospital(btn.dataset.removerHospital);
      renderConteudo();
    });
  });
}

// ---------- Chip "meus dados" do solicitante (topbar) ----------

function renderChipPerfil() {
  const wrap = document.getElementById("perfilWrap");
  wrap.hidden = estado.perfil !== "solicitante";
  if (wrap.hidden) {
    estado.menuPerfilAberto = false;
    return;
  }

  const perfil = obterPerfilSolicitante();
  document.getElementById("perfilResumo").textContent = perfil.nome
    ? `${perfil.nome}${perfil.setor ? ` · ${perfil.setor}` : ""}`
    : "Configurar meus dados";

  const painel = document.getElementById("painelPerfil");
  painel.hidden = !estado.menuPerfilAberto;
  if (!estado.menuPerfilAberto) return;

  painel.innerHTML = `
    <form id="formPerfilSolicitante">
      <div class="campo">
        <label for="perfilNome">Nome</label>
        <input id="perfilNome" name="nome" required value="${escapeHtml(perfil.nome || "")}" placeholder="Seu nome" />
      </div>
      <div class="campo">
        <label for="perfilSetor">Setor / Unidade</label>
        <input id="perfilSetor" name="setor" value="${escapeHtml(perfil.setor || "")}" placeholder="Ex.: Unidade de Coleta - Centro" />
      </div>
      <div class="form-acoes">
        <button type="submit" class="btn pequeno">Salvar</button>
      </div>
    </form>
  `;

  painel.querySelector("#formPerfilSolicitante").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const dados = Object.fromEntries(new FormData(ev.target).entries());
    if (!dados.nome?.trim()) {
      toast("Informe seu nome.");
      return;
    }
    salvarPerfilSolicitante(dados);
    estado.menuPerfilAberto = false;
    toast("Dados atualizados.");
    render();
  });
}

// ---------- Central de notificações (tempo real via SSE) ----------

/**
 * Cada notificação tem um "publico" alvo: 'transporte' (fila de novos pedidos,
 * visível à equipe de transporte) ou 'solicitante' (atualizações de status,
 * visíveis só a quem fez aquele pedido específico). Isso evita que um
 * solicitante veja notificações destinadas ao transporte (ou de outro
 * solicitante), e vice-versa.
 */
function notificacoesDoPerfilAtual(lista) {
  if (estado.perfil === "transporte") {
    return lista.filter((n) => n.publico === "transporte");
  }
  if (estado.perfil === "solicitante") {
    const nome = (obterPerfilSolicitante().nome || "").trim().toLowerCase();
    if (!nome) return [];
    return lista.filter((n) => n.publico === "solicitante" && (n.solicitanteNome || "").trim().toLowerCase() === nome);
  }
  return []; // portaria: sem central de notificações própria por enquanto
}

function escopoNotificacoesAtual() {
  if (estado.perfil === "transporte") return { publico: "transporte" };
  if (estado.perfil === "solicitante") return { publico: "solicitante", nome: obterPerfilSolicitante().nome || "" };
  return { publico: "nenhum" };
}

let idsNotificacoesConhecidas = null; // null = ainda não inicializado

function sincronizarNotificacoes() {
  const todas = DB.listarNotificacoes();

  if (idsNotificacoesConhecidas === null) {
    // primeira execução: só estabelece a base, não dispara alerta para histórico existente
    idsNotificacoesConhecidas = new Set(todas.map((n) => n.id));
    renderSino(notificacoesDoPerfilAtual(todas));
    return;
  }

  // a comparação usa TODAS as notificações (não só as visíveis no perfil atual),
  // para que trocar de perfil nunca "descubra" notificações antigas e dispare
  // um alerta falso — só o que realmente chegou depois do último sync conta.
  const novas = todas.filter((n) => !idsNotificacoesConhecidas.has(n.id));
  todas.forEach((n) => idsNotificacoesConhecidas.add(n.id));

  if (novas.length) {
    const novasVisiveis = notificacoesDoPerfilAtual(novas);

    if (estado.perfil === "transporte") {
      const novosPedidos = novasVisiveis.filter((n) => n.tipo === "novo_pedido");
      if (novosPedidos.length) {
        dispararAlertaNovoPedido(novosPedidos[novosPedidos.length - 1], novosPedidos.length);
      }
    }

    // notificação nativa do sistema operacional: só quando a aba não está
    // em primeiro plano (se estiver visível, o alerta/sino na própria página já basta)
    if (novasVisiveis.length && document.hidden) {
      dispararNotificacaoOS(novasVisiveis[novasVisiveis.length - 1], novasVisiveis.length);
    }
  }

  renderSino(notificacoesDoPerfilAtual(todas));
}

function renderSino(lista) {
  const badge = document.getElementById("badgeNotificacoes");
  const painel = document.getElementById("painelNotificacoes");
  const naoLidas = lista.filter((n) => !n.lida);

  badge.hidden = naoLidas.length === 0;
  badge.textContent = naoLidas.length > 99 ? "99+" : String(naoLidas.length);

  painel.hidden = !estado.notificacoesAbertas;
  if (!estado.notificacoesAbertas) return;

  const itens = lista.length
    ? lista.map((n) => `
        <div class="notif-item${n.lida ? "" : " nao-lida"}" data-notif-id="${n.id}">
          <div class="notif-titulo">
            ${!n.lida ? '<span class="ponto"></span>' : ""}
            <span>${ICONE_NOTIFICACAO[n.tipo] || "🔔"} ${escapeHtml(n.titulo)}</span>
          </div>
          <div class="notif-msg">${escapeHtml(n.mensagem)}</div>
          <div class="notif-hora">${formatarData(n.criadoEm)}</div>
        </div>
      `).join("")
    : `<div class="notif-vazio">Nenhuma notificação por aqui.</div>`;

  painel.innerHTML = `
    <div class="painel-cabecalho">
      <span>Notificações</span>
      <span>${naoLidas.length} não lida${naoLidas.length === 1 ? "" : "s"}</span>
    </div>
    <div class="painel-acoes">
      <button type="button" data-marcar-todas-lidas>Marcar todas como lidas</button>
      <button type="button" data-limpar-notificacoes>Limpar tudo</button>
    </div>
    ${itens}
  `;

  painel.querySelector("[data-marcar-todas-lidas]")?.addEventListener("click", async () => {
    await DB.marcarTodasNotificacoesLidas(escopoNotificacoesAtual());
    renderSino(notificacoesDoPerfilAtual(DB.listarNotificacoes()));
  });
  painel.querySelector("[data-limpar-notificacoes]")?.addEventListener("click", async () => {
    await DB.limparNotificacoes(escopoNotificacoesAtual());
    renderSino(notificacoesDoPerfilAtual(DB.listarNotificacoes()));
  });
  painel.querySelectorAll("[data-notif-id]").forEach((item) => {
    item.addEventListener("click", async () => {
      await DB.marcarNotificacaoLida(item.dataset.notifId);
      renderSino(notificacoesDoPerfilAtual(DB.listarNotificacoes()));
    });
  });
}

function alternarPainelNotificacoes() {
  estado.notificacoesAbertas = !estado.notificacoesAbertas;
  renderSino(notificacoesDoPerfilAtual(DB.listarNotificacoes()));
}

// Alerta visual: banner flutuante + pulso no sino + piscada no título da aba.
let timerAlertaVisual = null;

function mostrarAlertaVisual(titulo, mensagem) {
  const banner = document.getElementById("alertaFlutuante");
  document.getElementById("alertaTitulo").textContent = titulo;
  document.getElementById("alertaMensagem").textContent = mensagem;
  banner.hidden = false;
  requestAnimationFrame(() => banner.classList.add("mostrar"));

  const sino = document.getElementById("btnNotificacoes");
  sino.classList.remove("sino-pulsando");
  void sino.offsetWidth; // reinicia a animação se já estiver rodando
  sino.classList.add("sino-pulsando");

  clearTimeout(timerAlertaVisual);
  timerAlertaVisual = setTimeout(esconderAlertaVisual, 6000);
}

function esconderAlertaVisual() {
  const banner = document.getElementById("alertaFlutuante");
  banner.classList.remove("mostrar");
  clearTimeout(timerAlertaVisual);
  setTimeout(() => { banner.hidden = true; }, 250);
  pararFlashTitulo();
}

// Alerta sonoro: toca o mp3 cadastrado em assets/. Se por algum motivo não
// der pra tocar (arquivo ausente, navegador bloqueando áudio etc.), cai para
// um bipe sintético via Web Audio API como reserva, sem depender de arquivo.
const SOM_ALERTA_URL = "assets/alerta-novo-pedido.mp3";
let elementoAudioAlerta = null;

function garantirElementoAudioAlerta() {
  if (!elementoAudioAlerta) {
    elementoAudioAlerta = new Audio(SOM_ALERTA_URL);
    elementoAudioAlerta.preload = "auto";
  }
  return elementoAudioAlerta;
}

let audioCtx = null;

function garantirAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/** Desbloqueia o áudio (elemento <audio> + AudioContext) a partir do primeiro gesto do usuário. */
function desbloquearAudio() {
  garantirAudioContext();
  try {
    const audio = garantirElementoAudioAlerta();
    audio.play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
      })
      .catch(() => {}); // sem gesto suficiente ainda; tenta de novo no próximo clique
  } catch (e) {
    // ignora — o bipe sintético de reserva ainda funciona
  }
}

function tocarBipeSintetico() {
  try {
    const ctx = garantirAudioContext();
    if (!ctx) return;
    const tocarTom = (freq, inicio, duracao) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + inicio + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + duracao);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + duracao + 0.03);
    };
    tocarTom(880, 0, 0.14);
    tocarTom(1180, 0.16, 0.18);
  } catch (e) {
    console.warn("Não foi possível tocar o bipe sintético de reserva:", e);
  }
}

function tocarAlertaSonoro() {
  try {
    const audio = garantirElementoAudioAlerta();
    audio.currentTime = 0;
    const promessa = audio.play();
    if (promessa?.catch) {
      promessa.catch((e) => {
        console.warn("Não foi possível tocar o som do alerta, usando bipe de reserva:", e);
        tocarBipeSintetico();
      });
    }
  } catch (e) {
    console.warn("Não foi possível tocar o som do alerta, usando bipe de reserva:", e);
    tocarBipeSintetico();
  }
}

// Título da aba piscando enquanto o alerta não é visto.
const tituloOriginal = document.title;
let timerFlashTitulo = null;

function iniciarFlashTitulo(mensagem) {
  pararFlashTitulo();
  let piscando = false;
  timerFlashTitulo = setInterval(() => {
    document.title = piscando ? tituloOriginal : mensagem;
    piscando = !piscando;
  }, 1000);
}

function pararFlashTitulo() {
  if (timerFlashTitulo) {
    clearInterval(timerFlashTitulo);
    timerFlashTitulo = null;
    document.title = tituloOriginal;
  }
}

function dispararAlertaNovoPedido(notificacao, quantidade) {
  const titulo = quantidade > 1 ? `${quantidade} novos pedidos de transporte` : "Novo pedido de transporte";
  mostrarAlertaVisual(titulo, notificacao.mensagem);
  tocarAlertaSonoro();
  iniciarFlashTitulo("🔔 Novo pedido!");
}

// ---------- Notificações nativas do sistema operacional ----------
// Usa a Notification API do navegador: funciona com a aba aberta em segundo
// plano (minimizada, outra aba em foco, outro monitor), sem precisar que a
// página esteja visível. Não funciona com o navegador totalmente fechado.

function atualizarBotaoNotifOS() {
  const btn = document.getElementById("btnNotifOS");
  if (!("Notification" in window)) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const resumo = document.getElementById("notifOSResumo");
  btn.classList.remove("chip-ativo", "chip-bloqueado");

  if (Notification.permission === "granted") {
    resumo.textContent = "Notificações do sistema ativas";
    btn.classList.add("chip-ativo");
  } else if (Notification.permission === "denied") {
    resumo.textContent = "Notificações bloqueadas pelo navegador";
    btn.classList.add("chip-bloqueado");
  } else {
    // ainda não resolvido: a tentativa automática (ver garantirNotificacoesOS)
    // pode não ter conseguido mostrar o prompt sem um gesto do usuário —
    // este texto serve de reserva, clicável, para esse caso.
    resumo.textContent = "Clique para ativar notificações do sistema";
  }
}

/**
 * Pede a permissão de notificação automaticamente, sem exigir que o usuário
 * ache e clique em um botão. O próprio navegador ainda mostra o prompt nativo
 * dele (nenhum site pode pular essa etapa) — a diferença é que tentamos
 * disparar esse prompt sozinhos assim que a página carrega. Alguns navegadores
 * só permitem esse pedido dentro de um gesto do usuário (clique, tecla etc.);
 * por isso também tentamos de novo no primeiro clique em qualquer lugar da
 * página, como reserva silenciosa.
 */
async function garantirNotificacoesOS() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch (e) {
    // navegador recusou o pedido fora de um gesto do usuário; a reserva no
    // primeiro clique (ver bootstrap) tenta de novo.
  }
  atualizarBotaoNotifOS();
  renderPainelNotifOS();
}

/** Passo a passo para reativar notificações manualmente, por navegador. */
function trechoInstrucoesNavegadores() {
  return `
    <details class="notifos-navegador">
      <summary>Google Chrome / Microsoft Edge / Brave (baseados em Chromium)</summary>
      <ol>
        <li>Clique no ícone de cadeado (ou "ⓘ") à esquerda do endereço do site.</li>
        <li>Abra "Permissões do site" (ou "Configurações do site").</li>
        <li>Encontre "Notificações" e mude para "Permitir".</li>
        <li>Recarregue a página.</li>
      </ol>
    </details>
    <details class="notifos-navegador">
      <summary>Mozilla Firefox</summary>
      <ol>
        <li>Clique no ícone de cadeado à esquerda do endereço do site.</li>
        <li>Em "Permissões", encontre "Enviar notificações" e remova o bloqueio (ou mude para "Permitir").</li>
        <li>Recarregue a página.</li>
      </ol>
    </details>
    <details class="notifos-navegador">
      <summary>Safari (macOS)</summary>
      <ol>
        <li>Menu Safari → Ajustes (ou Preferências) → Sites → Notificações.</li>
        <li>Encontre este site na lista e mude para "Permitir".</li>
        <li>Recarregue a página.</li>
      </ol>
    </details>
  `;
}

/** Conteúdo do painel que abre ao clicar no chip "🖥️", conforme o estado atual da permissão. */
function conteudoPainelNotifOS() {
  if (!("Notification" in window)) {
    return `
      <div class="painel-cabecalho"><span>Notificações do sistema</span></div>
      <p class="notifos-texto">Este navegador não suporta notificações do sistema.</p>
    `;
  }

  if (Notification.permission === "granted") {
    return `
      <div class="painel-cabecalho"><span>Notificações do sistema</span></div>
      <p class="notifos-texto">✅ Ativas neste navegador. Você recebe um alerta nativo do sistema quando chegar algo novo e esta aba estiver em segundo plano.</p>
      <div class="form-acoes">
        <button type="button" class="btn pequeno" data-testar-notif-os>Enviar notificação de teste</button>
      </div>
    `;
  }

  if (Notification.permission === "denied") {
    return `
      <div class="painel-cabecalho"><span>Notificações bloqueadas</span></div>
      <p class="notifos-texto">Você (ou o navegador) bloqueou as notificações deste site, e por segurança nenhum site pode pedir de novo sozinho. Para reativar, siga os passos abaixo e recarregue a página:</p>
      ${trechoInstrucoesNavegadores()}
    `;
  }

  // "default": ainda não decidido
  return `
    <div class="painel-cabecalho"><span>Notificações do sistema</span></div>
    <p class="notifos-texto">A HemoCar já tentou pedir a permissão automaticamente. Se o seu navegador mostrou um aviso, basta clicar em "Permitir" nele.</p>
    <div class="form-acoes">
      <button type="button" class="btn pequeno" data-pedir-notif-os>Pedir permissão agora</button>
    </div>
    <hr class="notifos-separador" />
    <p class="notifos-texto notifos-texto-mini">Se nenhum aviso apareceu (o navegador pode exigir um clique antes de perguntar), veja como ativar manualmente:</p>
    ${trechoInstrucoesNavegadores()}
  `;
}

function renderPainelNotifOS() {
  const painel = document.getElementById("painelNotifOS");
  painel.hidden = !estado.notifOSAberto;
  if (!estado.notifOSAberto) return;

  painel.innerHTML = conteudoPainelNotifOS();

  painel.querySelector("[data-pedir-notif-os]")?.addEventListener("click", async () => {
    const resultado = await Notification.requestPermission();
    atualizarBotaoNotifOS();
    renderPainelNotifOS();
    toast(resultado === "granted" ? "Notificações do sistema ativadas." : "Permissão não concedida.");
  });

  painel.querySelector("[data-testar-notif-os]")?.addEventListener("click", () => {
    dispararNotificacaoOS(
      { titulo: "Notificação de teste", mensagem: "Se você está vendo isso, as notificações do sistema estão funcionando! 🎉" },
      1
    );
    toast("Notificação de teste enviada.");
  });
}

function alternarPainelNotifOS() {
  estado.notifOSAberto = !estado.notifOSAberto;
  renderPainelNotifOS();
}

function dispararNotificacaoOS(notificacao, quantidade) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const titulo = quantidade > 1 ? `${quantidade} novas notificações — HemoCar` : `${notificacao.titulo} — HemoCar`;
  try {
    const notif = new Notification(titulo, {
      body: notificacao.mensagem,
      tag: "hemocar-notificacao",
      renotify: true,
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch (e) {
    console.warn("Não foi possível exibir a notificação do sistema:", e);
  }
}

// ---------- Bootstrap ----------

document.addEventListener("DOMContentLoaded", () => {
  const seletorPerfil = document.getElementById("perfil");
  seletorPerfil.value = estado.perfil;
  seletorPerfil.addEventListener("change", () => {
    estado.perfil = seletorPerfil.value;
    localStorage.setItem("hemocar_perfil", estado.perfil);
    estado.analisando = null;
    estado.editandoRota = null;
    estado.registrandoRota = null;
    estado.pagina = 1;
    limparSelecaoAnalise();
    render();
  });

  document.getElementById("resetDados").addEventListener("click", async () => {
    if (confirm("Isso vai apagar todos os pedidos, rotas e cadastros salvos no servidor e recriar os dados de exemplo. Continuar?")) {
      await DB.limparTudo();
      idsNotificacoesConhecidas = null;
      estado.analisando = null;
      estado.editandoRota = null;
      estado.registrandoRota = null;
      estado.pagina = 1;
      limparSelecaoAnalise();
      toast("Dados restaurados.");
      render();
    }
  });

  document.getElementById("btnNotificacoes").addEventListener("click", (ev) => {
    ev.stopPropagation();
    alternarPainelNotificacoes();
  });

  document.getElementById("btnPerfilSolicitante").addEventListener("click", (ev) => {
    ev.stopPropagation();
    estado.menuPerfilAberto = !estado.menuPerfilAberto;
    renderChipPerfil();
  });

  document.getElementById("fecharAlerta").addEventListener("click", esconderAlertaVisual);

  document.getElementById("btnNotifOS").addEventListener("click", (ev) => {
    ev.stopPropagation();
    alternarPainelNotifOS();
  });
  atualizarBotaoNotifOS();
  garantirNotificacoesOS(); // tenta ativar sozinho, sem exigir clique do usuário

  // reserva: se o navegador não deixou pedir permissão sem gesto do usuário,
  // tenta de novo silenciosamente no primeiro clique em qualquer lugar da página
  document.addEventListener("click", () => {
    if ("Notification" in window && Notification.permission === "default") {
      garantirNotificacoesOS();
    }
  });

  // fecha os painéis flutuantes (notificações / meus dados) ao clicar fora deles
  document.addEventListener("click", (ev) => {
    if (estado.notificacoesAbertas && !document.getElementById("notificacoesWrap").contains(ev.target)) {
      estado.notificacoesAbertas = false;
      renderSino(notificacoesDoPerfilAtual(DB.listarNotificacoes()));
    }
    if (estado.menuPerfilAberto && !document.getElementById("perfilWrap").contains(ev.target)) {
      estado.menuPerfilAberto = false;
      renderChipPerfil();
    }
    if (estado.notifOSAberto && !document.getElementById("notifOSWrap").contains(ev.target)) {
      estado.notifOSAberto = false;
      renderPainelNotifOS();
    }
  });

  // desbloqueia o áudio a partir do primeiro gesto do usuário (política dos navegadores)
  document.addEventListener("click", desbloquearAudio);

  // conecta ao servidor: carrega o estado inicial e escuta atualizações em
  // tempo real (SSE) — cada `render()` seguinte reflete o que TODOS os
  // navegadores conectados ao mesmo servidor estão vendo.
  DB.conectar(render)
    .then(render)
    .catch((e) => {
      console.error(e);
      toast(e.message || "Não foi possível conectar ao servidor.");
    });
});
