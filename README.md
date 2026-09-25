# HemoCar — PoC de Logística de Transporte

Prova de conceito do fluxo: **Solicitante cria pedido → Equipe de Transporte analisa → aprova escalando motorista, veículo e horário de saída (gera a rota) ou rejeita → Portaria registra a saída e a chegada reais do veículo**.

Front-end em HTML/CSS/JS puro (sem frameworks) + um backend mínimo em Node.js usando **só módulos nativos** (`http`, `fs`, `crypto` — sem npm, sem dependências externas). Os dados ficam em `data/db.json` no servidor e são sincronizados em tempo real (Server-Sent Events) com todos os navegadores conectados — por isso funciona de verdade entre **navegadores diferentes** (Chrome, Firefox, abas anônimas, ou até computadores diferentes na mesma rede), e não só entre abas do mesmo navegador.

## Como rodar

1. Tenha o [Node.js](https://nodejs.org) instalado (qualquer versão recente; sem `npm install`, não há dependências).
2. Na pasta do projeto, rode:
   ```
   node server.js
   ```
3. Abra `http://localhost:3000` no navegador. Para simular Solicitante e Equipe de Transporte ao mesmo tempo, abra a mesma URL em **dois navegadores diferentes** (ou duas abas/janelas) — os dois falam com o mesmo servidor e se sincronizam automaticamente.

Para usar outra porta: `PORT=4000 node server.js`.

Para rodar uma segunda instância **sem interferir** nos dados da primeira (ex.: para testes), aponte para uma pasta de dados separada: `PORT=4000 DATA_DIR=./data-teste node server.js`. Sem isso, duas instâncias — mesmo em portas diferentes — leem e gravam o mesmo `data/db.json` e podem sobrescrever os dados uma da outra.

Depois de editar `server.js`, é preciso **reiniciar o processo** (parar com `Ctrl+C` e rodar `node server.js` de novo) para as mudanças valerem — o Node não recarrega o código sozinho.

## Como usar

1. No topo, selecione o **perfil ativo**: "Solicitante", "Equipe de Transporte" ou "Portaria".
2. **Como Solicitante:**
   - Na primeira vez, informe **nome e setor/unidade** (simula os dados do usuário logado). Esses dados ficam salvos no navegador e aparecem no chip "👤" no topo — clique nele a qualquer momento para alterá-los.
   - Aba "Novo Pedido": escolha **origem e destino em listas** (alimentadas pelo cadastro de Hospitais/endereços — não dá mais para digitar um texto livre), preencha data/hora desejada, tipo e prioridade, e envie. O solicitante e o setor já vêm do seu perfil, sem precisar digitar de novo. Se não houver nenhum endereço cadastrado, o formulário avisa e pede pra Equipe de Transporte cadastrar em "Cadastros" antes.
   - Aba "Meus Pedidos": acompanha o status (Pendente, Roteirizado, **Em trânsito**, Rejeitado, Concluído) dos pedidos feitos com o seu perfil atual, incluindo o KM e horário reais de saída/chegada assim que a Portaria os registra.
3. **Como Equipe de Transporte:**
   - Aba "Análise de Pedidos": veja a fila de pendentes — alimentada em tempo real por qualquer solicitante, em qualquer navegador. Marque (checkbox) um ou mais pedidos que podem ir na mesma viagem e **Aprove todos juntos numa única rota** (um motorista + um veículo + horário de saída + **previsão de término** para o grupo inteiro), ou **Rejeite** um pedido individualmente (com motivo).
   - **Sugestões de agrupamento**: quando dois ou mais pedidos pendentes têm o mesmo destino, ou destinos diferentes na mesma **regional** (uma zona administrativa mais ampla que a cidade — pode juntar várias cidades vizinhas, ex.: "Regional Cariri" cobrindo Juazeiro do Norte, Crato etc.), **e o horário desejado de cada um está a até 3h de diferença do próximo** (pedidos de manhã não se misturam com os da noite, mesmo pro mesmo lugar), aparece um painel "Sugestões para agrupar numa rota" no topo da lista — com a faixa de horário coberta e um botão "Selecionar todos" para marcar o grupo inteiro de uma vez. Cada pedido que faz parte de um grupo também ganha um selo (📍 mesmo destino / 🗺️ mesma região) direto no card. Como o destino agora vem sempre de um endereço cadastrado (ver acima), essa identificação é sempre exata; sem regional cadastrada para aquele hospital, cai para a cidade dele.
   - Aba "Rotas Programadas": lista as rotas geradas — cada rota mostra todos os pedidos (paradas) que ela atende, o horário de saída e a previsão de término, além do status (Programada / Em trânsito / Concluída) e do KM/horário reais assim que a Portaria os registra. Uma rota ainda não concluída pode ser **editada** (motorista, veículo, horário, previsão) a qualquer momento — os solicitantes envolvidos são avisados da mudança. A conclusão da rota em si (saída/chegada) é responsabilidade da Portaria, não mais um botão aqui.
   - **Escalar motorista/veículo já em rota**: ao aprovar ou editar, a lista mostra todo mundo, inclusive quem já está em outra rota (com a etiqueta "em rota até HH:mm") — dá pra escalar mesmo assim, desde que o novo horário não se sobreponha ao da rota existente. Se sobrepuser, o pedido é recusado com uma mensagem explicando o conflito.
   - Aba "Cadastros": CRUD simples de Motoristas, Veículos e **Hospitais** (nome, cidade, **regional**, endereço, telefone) usados na operação. O status de cada motorista/veículo (Disponível / Em rota até HH:mm) é calculado na hora, a partir das rotas programadas — não precisa mexer manualmente.
4. **Como Portaria:**
   - Aba "Aguardando saída": lista as rotas já aprovadas que ainda não saíram. **Registrar saída** pede o **KM do odômetro** e o **horário** reais de saída (o formulário já sugere o horário atual) — a partir daí a rota vira "Em trânsito" e o motorista/veículo somem da lista de disponíveis.
   - Aba "Em trânsito": lista as rotas que já saíram e ainda não voltaram. **Registrar chegada** pede o **KM** e o **horário** reais de chegada — o KM de chegada não pode ser menor que o de saída, nem o horário de chegada anterior ao de saída. Isso conclui a rota, libera motorista e veículo, e avisa cada solicitante envolvido.
   - Aba "Histórico": rotas já concluídas, com o registro completo de saída e chegada (KM e horário), para consulta/auditoria.

O botão "Restaurar dados de exemplo" no rodapé apaga tudo no servidor e recria a base inicial (3 motoristas, 3 veículos, 5 hospitais) para todo mundo conectado.

**Paginação**: as listas "Meus Pedidos", "Análise de Pedidos" e "Rotas Programadas" mostram 5 itens por página, com botões "Anterior/Próxima" quando há mais que isso. A página volta para 1 ao trocar de aba ou de perfil; na Análise, marcar pedidos numa página e navegar para outra não perde a seleção.

## Central de notificações (por destinatário) e alerta de novo pedido

- O sino no topo abre a **central de notificações**, mas cada perfil só vê as suas:
  - **Equipe de Transporte** vê só notificações de **novos pedidos** chegando (fila de trabalho).
  - **Solicitante** vê só as atualizações dos **próprios pedidos** (aprovado, rejeitado, saiu, concluído) — nunca os pedidos de outro solicitante, nem a fila do transporte.
  - **Portaria** não tem notificações próprias nesta PoC (o sino fica sempre zerado) — o trabalho é feito direto a partir das listas "Aguardando saída" / "Em trânsito".
- Sempre que um pedido é criado, aprovado, rejeitado ou concluído, o servidor registra uma notificação já marcada com o público-alvo (`transporte` ou o nome do solicitante específico) e transmite para todos os navegadores conectados.
- Com o perfil **Equipe de Transporte** ativo, todo **novo pedido** dispara automaticamente:
  - um **banner visual** no topo da tela (com pulso e auto-fechamento em ~6s, ou fechamento manual);
  - um **alerta sonoro** (dois tons curtos, gerados via Web Audio API — sem arquivo de áudio externo);
  - o **sino piscando/pulsando** e o **título da aba piscando** enquanto o alerta não é fechado.
- Isso funciona entre navegadores/computadores genuinamente diferentes (testado com dois processos de navegador isolados) — não depende de abas do mesmo navegador.
- Alertas sonoros exigem uma interação prévia do usuário na página (política dos navegadores); qualquer clique já habilita o áudio para os próximos alertas.

### Notificações do sistema operacional

Ativada **automaticamente ao abrir a página** — a aplicação já pede a permissão sozinha, sem exigir que o usuário procure e clique em nada. Uma vez concedida, qualquer notificação nova relevante para o perfil ativo dispara um alerta nativo do sistema operacional — **mesmo com a aba em segundo plano** (minimizada, outra aba em foco, outro monitor). Se a aba estiver visível, o alerta nativo não aparece (a página já mostra tudo por dentro); clicar na notificação nativa traz a aba de volta ao primeiro plano.

O chip "🖥️" no topo mostra o status (ativas / bloqueadas / pendente) e não precisa ser clicado para a ativação automática funcionar. Clicando nele, abre um painel de ajuda:
- **Ativas**: confirma que está funcionando e tem um botão "Enviar notificação de teste" para o usuário conferir na hora, sem precisar de uma segunda aba.
- **Pendente** (navegador ainda não perguntou): botão "Pedir permissão agora" + o mesmo passo a passo manual abaixo, caso nada apareça.
- **Bloqueadas**: o navegador não deixa pedir de novo por script, então o painel mostra o **passo a passo para liberar manualmente em cada navegador** (Chrome/Edge/Brave, Firefox, Safari) — abrir as configurações de permissão do site, encontrar "Notificações" e mudar para "Permitir".

Requisitos e limites (impostos pelo navegador, nenhum site consegue contornar):
- O **prompt de permissão em si é sempre do navegador**, não da página — nenhum site pode pré-conceder essa permissão a si mesmo. Na primeira visita, o navegador mostra seu próprio aviso nativo pedindo "Permitir/Bloquear"; depois de decidido uma vez, ele vale para as próximas visitas sem perguntar de novo.
- Alguns navegadores só deixam pedir essa permissão dentro de um gesto do usuário (um clique, por exemplo) — se for o caso, a aplicação tenta de novo, silenciosamente, no primeiro clique em qualquer lugar da página (não precisa ser no chip "🖥️").
- Precisa do navegador **aberto** (aba carregada em algum lugar, mesmo em segundo plano) — não funciona com o navegador totalmente fechado. Para isso seria necessário Service Worker + Web Push, bem mais complexo (fora do escopo desta PoC).
- Funciona em `http://localhost` sem HTTPS (exceção do navegador para desenvolvimento); numa implantação real, exigiria HTTPS.
- Se o usuário (ou o navegador) negar a permissão, não é possível perguntar de novo por script — é preciso liberar manualmente nas configurações do site.

## Estrutura

```
server.js       backend HTTP (só módulos nativos do Node) — API REST + SSE + arquivos estáticos
data/db.json    "banco de dados" em arquivo JSON, criado automaticamente na primeira execução
index.html      estrutura da página e das abas
css/style.css   estilos (sem libs externas)
js/api.js       cliente HTTP: fala com server.js, mantém cache local atualizado via SSE
js/app.js       estado da UI, renderização das telas e eventos
```

## Modelo de dados (simplificado)

- **Pedido**: solicitante, setor, origem, destino, data desejada, tipo, prioridade, observações, status (`pendente` → `roteirizado` → `em_transito` → `concluido`, ou `rejeitado`).
- **Rota**: motorista, veículo, horário de saída (planejado), **previsão de término** (planejada), status (`programada` → `em_transito` → `concluida`), e uma **lista de pedidos** (`pedidoIds`) — uma rota pode levar mais de um pedido (mesma viagem atendendo vários solicitantes); cada pedido individual guarda para qual rota foi (`rotaId`). Pode ser editada enquanto `programada`. Guarda também o registro real da Portaria: `kmSaida`, `horarioSaidaReal`, `kmChegada`, `horarioChegadaReal` (todos `null` até serem registrados).
- **Motorista** / **Veículo**: sem status fixo salvo — a disponibilidade (`disponivel` ou `em_rota` até tal horário) é **calculada a partir das rotas ativas** (`programada` ou `em_transito`) toda vez que o estado é enviado ao cliente, comparando a janela `[horarioSaida, previsaoTermino]` de cada rota com o horário atual (para exibição) ou com o horário da rota sendo criada/editada (para detectar conflito de agenda). Rotas antigas sem previsão de término (antes desse campo existir) contam como "ocupado indefinidamente" até serem concluídas ou editadas.
- **Hospital**: nome, cidade, **regional**, endereço, telefone — cadastro de apoio (5 exemplos já inclusos). Para os 3 hospitais de Fortaleza, a regional foi identificada cruzando o endereço/bairro real de cada um com o [mapa oficial das 12 Regionais da Prefeitura de Fortaleza](https://urbanismoemeioambiente.fortaleza.ce.gov.br/images/urbanismo-e-meio-ambiente/infocidade/mapas/MAPA_Regionais_12x12_m.pdf): HGF (bairro Papicu) → Regional 2; HU Walter Cantídio (bairro Rodolfo Teófilo) → Regional 3; Hospital Infantil Albert Sabin (bairro Vila União) → Regional 4. Juazeiro do Norte e Sobral são outros municípios (fora da divisão de Fortaleza), então o Hospital Regional do Cariri e o Hospital Regional Norte mantêm um rótulo descritivo próprio ("Regional Cariri" / "Regional Norte") em vez de um número oficial. A regional é o critério usado nas sugestões de agrupamento de rota por "mesma região".
- **Notificação**: tipo (`novo_pedido`, `pedido_aprovado`, `pedido_rejeitado`, `rota_saiu`, `rota_concluida`), título, mensagem, **público-alvo** (`transporte` ou o nome de um solicitante específico), lida/não lida, data/hora. A Portaria não tem central de notificações própria nesta PoC — trabalha direto a partir das listas "Aguardando saída" / "Em trânsito".

## API (para referência)

Todas as respostas em JSON; mutações retransmitem o estado atualizado por SSE em `GET /api/eventos`.

| Rota | Método | Descrição |
|---|---|---|
| `/api/estado` | GET | Estado completo (motoristas, veículos, hospitais, pedidos, rotas, notificações) |
| `/api/eventos` | GET | Stream SSE com o estado a cada mudança |
| `/api/pedidos` | POST | Cria pedido |
| `/api/pedidos/:id/rejeitar` | POST | Rejeita (`motivo`) |
| `/api/rotas` | POST | Aprova um ou mais pedidos numa rota só (`pedidoIds: []`, `motoristaId`, `veiculoId`, `horarioSaida`, `previsaoTermino`) |
| `/api/rotas/:id/editar` | POST | Edita motorista/veículo/horário/previsão de uma rota ainda programada (mesmos campos acima) |
| `/api/rotas/:id/saida` | POST | Portaria registra a saída (`kmSaida`, `horarioSaidaReal`) — rota vira `em_transito` |
| `/api/rotas/:id/chegada` | POST | Portaria registra a chegada (`kmChegada`, `horarioChegadaReal`) — conclui a rota, libera motorista/veículo, avisa cada solicitante envolvido |
| `/api/motoristas`, `/api/veiculos`, `/api/hospitais` | POST / DELETE `/:id` | CRUD dos cadastros |
| `/api/notificacoes/:id/lida` | POST | Marca uma notificação como lida |
| `/api/notificacoes/marcar-todas-lidas?publico=&nome=` | POST | Marca como lidas só as notificações daquele público |
| `/api/notificacoes?publico=&nome=` | DELETE | Limpa só as notificações daquele público |
| `/api/reset` | POST | Restaura os dados de exemplo |

## Limitações (é uma PoC)

- Sem autenticação real — o "perfil" do solicitante (nome/setor) fica salvo no navegador de quem preenche, sem senha ou verificação.
- Um único processo Node guarda tudo em memória e grava em `data/db.json` a cada mutação — não pensado para alta concorrência, só para demonstração.
- A previsão de término é só uma estimativa informada por quem aprova a rota — o sistema não sabe se o motorista realmente terminou; ele só fica livre de verdade quando alguém marca a rota como concluída (ou edita a previsão).
