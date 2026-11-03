/**
 * Expediente do transporte e divisão com a distribuição (horário de Fortaleza).
 *
 * - Pedido de tipo da distribuição feito fora do expediente (seg–sex 17:01 às 06:59, fins de
 *   semana e feriados cadastrados o dia todo) fica com a distribuição.
 * - Enquanto a distribuição não o roteiriza, esse pedido é repassado ao transporte no
 *   expediente dele (seg–sex 07:00 às 16:59) e volta à distribuição depois.
 */

const FUSO = "America/Fortaleza";
const INICIO_REPASSE = 7 * 60; // 07:00
const FIM_REPASSE = 16 * 60 + 59; // 16:59

/** Data (YYYY-MM-DD) e minutos do dia de um instante, no horário de Fortaleza. */
function partesEmFortaleza(instante) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instante)
      .map((parte) => [parte.type, parte.value]),
  );
  return { data: `${partes.year}-${partes.month}-${partes.day}`, minutos: Number(partes.hour) * 60 + Number(partes.minute) };
}

/** true se o instante cai fora do expediente: fim de semana, feriado cadastrado, ou antes das 07:00 / depois das 17:00. */
function foraDoExpediente(instante, datasFeriados) {
  const { data, minutos } = partesEmFortaleza(instante);
  const [ano, mes, dia] = data.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return true;
  if (datasFeriados.includes(data)) return true;
  return minutos >= 17 * 60 + 1 || minutos <= 6 * 60 + 59;
}

/** true se, nesse instante, pedidos sem atendimento da distribuição são do transporte. */
function noRepasseAoTransporte(instante, datasFeriados) {
  if (foraDoExpediente(instante, datasFeriados)) return false;
  const { minutos } = partesEmFortaleza(instante);
  return minutos >= INICIO_REPASSE && minutos <= FIM_REPASSE;
}

/**
 * Quem trata o pedido no instante dado: "transporte" ou "distribuicao".
 * O pedido precisa de: tipo, criadoEm e rotaId (sem rota = não atendido pela distribuição).
 */
function responsavelPelo(pedido, instante, datasFeriados, tiposDistribuicao) {
  if (!tiposDistribuicao.includes(pedido.tipo)) return "transporte";
  if (!foraDoExpediente(new Date(pedido.criadoEm), datasFeriados)) return "transporte";
  if (!pedido.rotaId && noRepasseAoTransporte(instante, datasFeriados)) return "transporte";
  return "distribuicao";
}

module.exports = { foraDoExpediente, partesEmFortaleza, responsavelPelo };
