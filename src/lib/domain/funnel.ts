import { PRESETS } from "./segments";

/**
 * Воронка брифа 27.11 по сегментам и вариантам текста, правило решения на 50 контактов и итог дня.
 * Чистые функции — сервис только собирает записи из базы.
 */

export type FunnelRecord = {
  preset: string | null;
  variant: string | null;
  replied: boolean;
  interest: boolean;
  prototype: boolean;
  call: boolean;
  proposal: boolean;
  prepaid: boolean;
};

export type FunnelRow = {
  key: string;
  label: string;
  sent: number;
  replies: number;
  replyRate: number | null;
  interest: number;
  prototypes: number;
  calls: number;
  proposals: number;
  prepaid: number;
};

function row(key: string, label: string, list: FunnelRecord[]): FunnelRow {
  const n = (fn: (item: FunnelRecord) => boolean) => list.filter(fn).length;
  const sent = list.length;
  const replies = n((item) => item.replied);
  return { key, label, sent, replies, replyRate: sent ? replies / sent : null, interest: n((item) => item.interest), prototypes: n((item) => item.prototype), calls: n((item) => item.call), proposals: n((item) => item.proposal), prepaid: n((item) => item.prepaid) };
}

/** Строки: итого, по сегментам (А/Б/В/Г, без сегмента), по вариантам и по парам «сегмент × вариант». */
export function funnelRows(records: FunnelRecord[]) {
  const presets = [...PRESETS.map((item) => ({ id: item.id as string | null, label: `${item.id}. ${item.short}` })), { id: null, label: "Без сегмента" }];
  const bySegment = presets.map((preset) => row(preset.id ?? "none", preset.label, records.filter((item) => item.preset === preset.id))).filter((item) => item.sent > 0);
  const byVariant = ["A", "B", null].map((variant) => row(variant ?? "none", variant ? `Вариант ${variant}` : "Без варианта", records.filter((item) => item.variant === variant))).filter((item) => item.sent > 0);
  const cells = presets.flatMap((preset) => ["A", "B"].map((variant) => row(`${preset.id ?? "none"}:${variant}`, `${preset.id ?? "—"} · ${variant}`, records.filter((item) => item.preset === preset.id && item.variant === variant)))).filter((item) => item.sent > 0);
  return { total: row("total", "Всего", records), bySegment, byVariant, cells };
}

export type Decision = { status: "collect" | "continue" | "change" | "offer" | "watch"; title: string; text: string };

/**
 * Правило решения на 50 контактов (бриф, приложение A):
 * 10–15% ответов и 1–2 созвона — продолжаем; меньше 5% — меняем сегмент или текст; отвечают, но не созваниваются — не цепляет предложение.
 */
export function decision50(input: { sent: number; replies: number; calls: number }): Decision {
  const { sent, replies, calls } = input;
  const rate = sent ? replies / sent : 0;
  const pct = `${Math.round(rate * 100)}%`;
  if (sent < 50) {
    return { status: "collect", title: `Набираем: ${sent} из 50`, text: sent >= 20 && rate < 0.05 ? `Пока ${pct} ответов — рано решать, но проверьте зацепки: они точно про этих людей?` : `Решение — после 50 отправленных. Сейчас ${pct} ответов, созвонов ${calls}.` };
  }
  if (rate < 0.05) return { status: "change", title: "Меняем сегмент или текст", text: `${pct} ответов на ${sent} контактов — меньше 5%. Поменяйте одно: сегмент или первое сообщение.` };
  if (calls === 0 && replies > 0) return { status: "offer", title: "Не цепляет предложение", text: `Отвечают (${pct}), но до созвона не доходит. Меняйте конвертер: фрагмент или демо раньше, вопросы вместо описания услуги.` };
  if (rate >= 0.1 && calls >= 1) return { status: "continue", title: "Продолжаем", text: `${pct} ответов и ${calls} ${calls === 1 ? "созвон" : "созвона"} — сегмент и текст работают, набирайте следующие 50.` };
  return { status: "watch", title: "Пограничная зона", text: `${pct} ответов, созвонов ${calls}. Поменяйте одну вещь в тексте и сравните на следующих 50.` };
}

/** Одно изменение на завтра — по цифрам дня и всей воронке. Первое сработавшее правило. */
export function changeForTomorrow(input: { sentToday: number; openTasks: number; byVariant: FunnelRow[]; total: FunnelRow; target?: number }): string {
  const target = input.target ?? 30;
  if (input.openTasks > 0) return `Начните утро с ${input.openTasks} ${input.openTasks === 1 ? "задачи" : "задач"} на фрагмент или демо — интерес остывает за сутки.`;
  const a = input.byVariant.find((item) => item.key === "A");
  const b = input.byVariant.find((item) => item.key === "B");
  if (a && b && a.sent >= 10 && b.sent >= 10 && a.replyRate != null && b.replyRate != null && Math.abs(a.replyRate - b.replyRate) >= 0.05) {
    const [win, lose] = a.replyRate > b.replyRate ? [a, b] : [b, a];
    return `Завтра шлите только ${win.label.toLowerCase()}: ${Math.round(win.replyRate! * 100)}% ответов против ${Math.round(lose.replyRate! * 100)}%.`;
  }
  if (input.total.sent >= 20 && input.total.replies === 0) return "Ноль ответов на 20+ сообщений — завтра пишите только карточкам A с зацепкой из свежего поста.";
  if (input.sentToday < target) return `Сегодня отправлено ${input.sentToday} — завтра доведите до ${target}: сначала новые A.`;
  return "Темп нормальный — завтра то же самое, плюс ответьте всем, кто написал, в течение часа.";
}
