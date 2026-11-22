export type CardFact = { text: string; source: string; kind: "fact" | "assumption" };

export type ObservationCard = {
  segment: string | null;
  observation: string | null;
  money: CardFact[];
  chaos: CardFact[];
  growth: CardFact[];
  calc: { text: string; lostRub: number } | null;
  caseRef: string | null;
  contact: { kind: string; value: string }[];
  features: string[];
};

export type HuntItem = {
  id: string;
  organization: { id: string; name: string; city: string | null; category: string | null; rating: number | null; reviewCount: number | null; website: string | null; sourceUrl: string | null };
  segment: string | null;
  segmentLabel: string | null;
  score: number;
  priority: string;
  card: ObservationCard | null;
  cardStatus: string;
  status: string;
  rejectReason: string | null;
  sentAt: string | null;
  followUpStep: number;
  nextFollowUpAt: string | null;
  followUpDue: boolean;
  repliedAt: string | null;
  channel: string | null;
  error: string | null;
  projectId: string | null;
  updatedAt: string;
};

export type Today = {
  items: HuntItem[];
  total: number;
  approved: number;
  followUps: number;
  queued: number;
  failed: number;
  incomplete: number;
  ai: { ready: boolean; reason: string | null };
  sentToday: number;
  dailyLimit: number;
  activeSegments: string[];
  timezone: string;
};

export type Dialogs = { due: HuntItem[]; active: HuntItem[]; waiting: HuntItem[]; approved: HuntItem[]; closed: HuntItem[]; failed: number };

export type Scenario = {
  id: string;
  title: string;
  contour: "A" | "B";
  pain: string;
  product: string;
  features: string[];
  priceFrom: number;
  priceTo: number;
  days: [number, number];
  demo: string;
  caseRef: string | null;
  stages: string[];
  tone: "yellow" | "orange" | "pink" | "blue" | "green" | "violet";
};

export type Project = {
  id: string;
  title: string;
  product: string | null;
  stage: string;
  amount: number | null;
  deadlineAt: string | null;
  contactName: string | null;
  contactValue: string | null;
  notes: string | null;
  checklist: { id: string; title: string; done: boolean }[];
  progress: { done: number; total: number };
  scenarioId: string | null;
  scenarioTitle: string | null;
  organization: { id: string; name: string; city: string | null } | null;
  outreachId: string | null;
  source: string;
  sheetSyncedAt: string | null;
  webhookAt: string | null;
  webhookError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HuntSettings = {
  hunt: { activeSegments: string[]; dailyLimit: number; autoQualify: boolean; autoQualifyMax: number; timezone: string; projectWebhookUrl: string; sheetUrl: string };
};

export type SheetStatus = { configured: boolean; status: string; lastError: string | null; leads: number; projects: number; lastSyncAt: string | null; pending: number };

export const SOURCE_LABEL: Record<string, string> = {
  reviewCount: "отзывы",
  rating: "рейтинг",
  websiteStatus: "сайт",
  website: "сайт",
  description: "описание",
  services: "услуги",
  features: "особенности",
  phones: "телефоны",
  socials: "соцсети",
  emails: "почта",
  photoCount: "фото",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "Новая",
  approved: "Написать",
  rejected: "Отклонена",
  snoozed: "Отложена",
  sent: "Ждём ответа",
  replied: "Ответил",
  call: "Созвон",
  estimate: "Смета",
  won: "Сделка",
  lost: "Отказ",
  sleeping: "Спящий",
  optout: "Просит не писать",
};

export const PROJECT_STAGE_LABEL: Record<string, string> = {
  brief: "Бриф",
  estimate: "Смета",
  prepaid: "Аванс",
  in_work: "В работе",
  review: "Сдача",
  done: "Готово",
  cancelled: "Отменён",
};

export const SEGMENT_TONE: Record<string, Scenario["tone"]> = {
  A1: "yellow", A2: "orange", A3: "pink", A4: "violet", A5: "blue", A6: "green",
  B1: "yellow", B2: "blue", B3: "orange", B4: "green", B5: "violet", B6: "pink", B7: "blue",
};

export function rub(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

export function dayLabel(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start) / 86400000);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff === -1) return "вчера";
  if (diff < 0) return `${-diff} дн назад`;
  return `через ${diff} дн`;
}

/** Крючок, если он не повторяет дословно первый факт хаоса. */
export function hookOf(card: ObservationCard | null) {
  if (!card?.observation) return null;
  return card.chaos.some((item) => item.text === card.observation) ? null : card.observation;
}
