const { test, expect } = require("@playwright/test");
const { foraDoExpediente } = require("../../expediente");

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
