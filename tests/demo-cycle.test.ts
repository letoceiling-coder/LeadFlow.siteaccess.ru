import { describe, expect, it } from "vitest";
import { bannedIn, contactLinks } from "../src/lib/domain/pitch";
import { demoMessage } from "../src/lib/domain/demo-text";
import { PIPELINE_STEPS } from "../src/lib/domain/pipeline-steps";

describe("канал MAX", () => {
  it("ссылка max.ru становится отдельным каналом сразу после Telegram", () => {
    const links = contactLinks(
      [
        { kind: "phone", value: "+7 900 000-00-00" },
        { kind: "social", value: "https://max.ru/u/abc123" },
        { kind: "social", value: "https://t.me/shop" },
      ],
      "Привет",
    );
    expect(links.map((item) => item.kind).slice(0, 3)).toEqual(["telegram", "max", "whatsapp"]);
    expect(links.find((item) => item.kind === "max")?.label).toBe("MAX u/abc123");
  });
});

describe("сообщение со ссылкой на демо", () => {
  it("содержит демо и КП и не нарушает стоп-слова", () => {
    const text = demoMessage({ name: "Пицца Рай", demoUrl: "https://demo.example/pizza", proposalUrl: "https://lf.example/kp/t" });
    expect(text).toContain("https://demo.example/pizza");
    expect(text).toContain("https://lf.example/kp/t");
    expect(bannedIn(text)).toEqual([]);
  });
  it("без КП нет пустой строки про цены", () => {
    expect(demoMessage({ name: "X", demoUrl: "https://d", proposalUrl: null })).not.toContain("Варианты и цены");
  });
});

describe("шаги воронки", () => {
  it("каждый статус охоты попадает ровно в один шаг", () => {
    const statuses = ["new", "snoozed", "approved", "sent", "sleeping", "replied", "demo", "call", "estimate", "won", "rejected", "lost"];
    for (const status of statuses) expect(PIPELINE_STEPS.filter((step) => (step.statuses as readonly string[]).includes(status))).toHaveLength(1);
  });
});
