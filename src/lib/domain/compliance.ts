export type SendDecisionInput = {
  approved: boolean;
  suppressed: boolean;
  doNotContact: boolean;
  channel: string;
  channelConnected: boolean;
  lawfulBasis: string | null;
  basisNote?: string | null;
  recentCount: number;
  limit: number;
  campaign: boolean;
  campaignApproved: boolean;
  legalBasisConfirmed: boolean;
};

export type SendDecision = { ok: true } | { ok: false; reason: string };

const BASES = new Set(["consent", "contract", "other_lawful"]);

export function decideSend(input: SendDecisionInput): SendDecision {
  if (input.doNotContact) {
    return { ok: false, reason: "У организации стоит статус «Не связываться»" };
  }
  if (input.suppressed) {
    return { ok: false, reason: "Контакт или организация есть в списке отказов" };
  }
  if (!input.approved) {
    return { ok: false, reason: "Сначала нужно явно подтвердить отправку" };
  }
  if (!input.lawfulBasis || !BASES.has(input.lawfulBasis)) {
    return { ok: false, reason: "Публичный контакт из карты не является основанием для рекламной отправки. Укажите согласие, договор или другое законное основание" };
  }
  if (input.lawfulBasis === "other_lawful" && (input.basisNote?.trim().length ?? 0) < 10) {
    return { ok: false, reason: "Для иного основания нужно коротко описать, почему отправка допустима" };
  }
  if (input.channel === "whatsapp" && input.lawfulBasis !== "consent") {
    return { ok: false, reason: "WhatsApp Business допускает шаблонные сообщения только при отдельном согласии получателя" };
  }
  if (input.channel !== "test" && !input.channelConnected) {
    return { ok: false, reason: "Канал не подключён или подключение не проверено" };
  }
  if (input.recentCount >= input.limit) {
    return { ok: false, reason: "Сработало ограничение частоты: этой организации уже отправляли сообщение в заданный период" };
  }
  if (input.campaign && (!input.campaignApproved || !input.legalBasisConfirmed)) {
    return { ok: false, reason: "Кампания не утверждена или не подтверждено правовое основание" };
  }
  return { ok: true };
}

export function personalizeTemplate(template: string, facts: Record<string, string | null | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = facts[key];
    if (!value) {
      missing.push(key);
      return "";
    }
    return value;
  });
  return { text: text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), missing };
}
