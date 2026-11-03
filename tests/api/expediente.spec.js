const { test, expect } = require("@playwright/test");
const { foraDoExpediente, responsavelPelo } = require("../../expediente");

const TIPOS = ["amostras_pre_transfusionais", "amostras_outras", "hemocomponentes", "medicamentos"];
const SABADO_NOITE = "2026-11-07T20:00:00-03:00";
const QUINTA_NOITE = "2026-11-05T20:00:00-03:00";
const TERCA_10H = "2026-11-03T10:00:00-03:00";

/** Pedido de tipo da distribuição, feito no instante dado e ainda sem rota. */
function pedidoSemRota(criadoEm, tipo = "medicamentos") {
  return { tipo, criadoEm, rotaId: null };
}

// Regra pura do expediente (horário de Fortaleza, UTC-3), sem servidor.

test.describe("Expediente do transporte", () => {
  test("em dia útil, o corte é às 17:01 e volta às 07:00", () => {
    const casos = [
      ["2026-11-03T16:59:00-03:00", false],
      ["2026-11-03T17:00:00-03:00", false],
      ["2026-11-03T17:01:00-03:00", true],
      ["2026-11-03T06:59:00-03:00", true],
      ["2026-11-03T07:00:00-03:00", false],
      ["2026-11-03T12:00:00-03:00", false],
    ];
    for (const [instante, esperado] of casos) {
      expect(foraDoExpediente(new Date(instante), []), instante).toBe(esperado);
    }
  });

  test("fins de semana ficam fora do expediente o dia todo", () => {
    expect(foraDoExpediente(new Date("2026-11-07T12:00:00-03:00"), [])).toBe(true); // sábado
    expect(foraDoExpediente(new Date("2026-11-08T10:00:00-03:00"), [])).toBe(true); // domingo
  });

  test("feriado cadastrado fica fora do expediente o dia todo", () => {
    expect(foraDoExpediente(new Date("2026-11-03T10:00:00-03:00"), ["2026-11-03"])).toBe(true);
    expect(foraDoExpediente(new Date("2026-11-03T10:00:00-03:00"), ["2026-11-02"])).toBe(false);
  });

  test("usa o horário de Fortaleza, não o UTC", () => {
    expect(foraDoExpediente(new Date("2026-11-03T20:30:00Z"), [])).toBe(true); // 17:30 em Fortaleza
    expect(foraDoExpediente(new Date("2026-11-03T10:00:00Z"), [])).toBe(false); // 07:00 em Fortaleza
  });
});

test.describe("Responsável pelo pedido (divisão transporte / distribuição)", () => {
  test("pedido de tipo da distribuição feito fora do expediente fica com a distribuição", () => {
    const pedido = pedidoSemRota(SABADO_NOITE);
    expect(responsavelPelo(pedido, new Date(SABADO_NOITE), [], TIPOS)).toBe("distribuicao");
  });

  test("pedido feito em horário de expediente fica com o transporte", () => {
    const pedido = pedidoSemRota(TERCA_10H);
    expect(responsavelPelo(pedido, new Date(TERCA_10H), [], TIPOS)).toBe("transporte");
  });

  test("outros tipos ficam com o transporte mesmo feitos fora do expediente", () => {
    const pedido = pedidoSemRota(SABADO_NOITE, "equipamentos");
    expect(responsavelPelo(pedido, new Date(SABADO_NOITE), [], TIPOS)).toBe("transporte");
  });

  test("sem rota, o pedido é repassado ao transporte das 07:00 às 16:59 de seg–sex", () => {
    const pedido = pedidoSemRota(QUINTA_NOITE);
    const casos = [
      ["2026-11-06T06:59:00-03:00", "distribuicao"], // sexta de madrugada, ainda fora
      ["2026-11-06T07:00:00-03:00", "transporte"],
      ["2026-11-06T16:59:00-03:00", "transporte"],
      ["2026-11-06T17:00:00-03:00", "distribuicao"],
    ];
    for (const [instante, esperado] of casos) {
      expect(responsavelPelo(pedido, new Date(instante), [], TIPOS), instante).toBe(esperado);
    }
  });

  test("com rota, o pedido fica com a distribuição mesmo no expediente do transporte", () => {
    const pedido = { ...pedidoSemRota(QUINTA_NOITE), rotaId: "rot-1" };
    expect(responsavelPelo(pedido, new Date(TERCA_10H), [], TIPOS)).toBe("distribuicao");
  });

  test("feriado não tem repasse: segue com a distribuição o dia todo", () => {
    const pedido = pedidoSemRota(QUINTA_NOITE);
    expect(responsavelPelo(pedido, new Date(TERCA_10H), ["2026-11-03"], TIPOS)).toBe("distribuicao");
  });
});
