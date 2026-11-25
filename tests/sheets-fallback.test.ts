import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const requestJson = vi.fn();
vi.mock("@/lib/http", () => ({ requestJson: (...args: unknown[]) => requestJson(...args), safeDetail: () => null }));

const secrets = { webhookUrl: "https://script.google.com/macros/s/AKfycbxAAAAAAAAAAAAAAAAAAAAAAAA/exec", token: "t".repeat(32) };
const sent = () => requestJson.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body).sheet);
const reply = (body: unknown) => ({ response: { ok: true, status: 200 }, body });

describe("upsertRows: запасной лист для старого скрипта", () => {
  beforeEach(() => { vi.resetModules(); requestJson.mockReset(); });

  it("при «unknown sheet» пишет лидов в «Лиды» и запоминает старый скрипт", async () => {
    const { upsertRows } = await import("@/lib/integrations/sheets");
    requestJson.mockResolvedValueOnce(reply({ ok: false, error: "unknown sheet" })).mockResolvedValue(reply({ ok: true, written: 1 }));
    const first = await upsertRows(secrets, "Автосервисы", ["id"], [{ id: "a" }], ["Автосервисы", "Лиды"]);
    expect(first).toMatchObject({ sheet: "Лиды", legacy: true });
    await upsertRows(secrets, "Доставка еды", ["id"], [{ id: "b" }], ["Доставка еды", "Лиды"]);
    expect(sent()).toEqual(["Автосервисы", "Лиды", "Лиды"]);
  });

  it("новый скрипт — пишет в лист ниши, проекты без подмены", async () => {
    const { upsertRows } = await import("@/lib/integrations/sheets");
    requestJson.mockResolvedValue(reply({ ok: true, written: 1 }));
    await upsertRows(secrets, "Автосервисы", ["id"], [{ id: "a" }], ["Автосервисы", "Лиды"]);
    expect(sent()).toEqual(["Автосервисы"]);
  });

  it("«Проекты» с ошибкой не перенаправляются", async () => {
    const { upsertRows } = await import("@/lib/integrations/sheets");
    requestJson.mockResolvedValue(reply({ ok: false, error: "unknown sheet" }));
    await expect(upsertRows(secrets, "Проекты", ["id"], [{ id: "p" }])).rejects.toThrow(/unknown sheet/);
    expect(sent()).toEqual(["Проекты"]);
  });
});
