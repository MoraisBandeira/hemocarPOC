/**
 * Expediente do transporte: seg–sex das 07:00 às 17:00 (horário de Fortaleza). Fora dele,
 * aos fins de semana e nos feriados cadastrados, os pedidos de tipos da distribuição
 * são tratados pela distribuição.
 */

const FUSO = "America/Fortaleza";

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

module.exports = { foraDoExpediente, partesEmFortaleza };
