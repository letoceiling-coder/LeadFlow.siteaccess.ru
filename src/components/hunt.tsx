"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, MapPin, Star } from "lucide-react";
import { cnJoin } from "./ui";

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
  repliedAt: string | null;
  channel: string | null;
  error: string | null;
};

export const SOURCE_LABEL: Record<string, string> = {
  reviewCount: "отзывы",
  rating: "рейтинг",
  websiteStatus: "сайт",
  website: "сайт",
  description: "описание",
  services: "услуги",
  features: "особенности",
  categories: "категории",
  category: "категория",
  phones: "телефоны",
  socials: "соцсети",
  emails: "почта",
  photoCount: "фото",
  address: "адрес",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "Новая",
  approved: "В работе",
  rejected: "Отклонена",
  snoozed: "Отложена",
  sent: "Отправлено",
  replied: "Ответил",
  call: "Созвон",
  estimate: "Смета",
  won: "Сделка",
  lost: "Отказ",
  sleeping: "Спящий",
};

export function PriorityBadge({ priority, score }: { priority: string; score: number }) {
  const tone = priority === "A" ? "bg-teal-700 text-white" : priority === "B" ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600";
  return (
    <span className={cnJoin("inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold tabular-nums", tone)}>
      {priority}
      <span className="font-medium opacity-80">· {score}</span>
    </span>
  );
}

function FactBlock({ label, items, tone }: { label: string; items: CardFact[]; tone: "money" | "chaos" | "growth" }) {
  if (!items.length) return null;
  const dot = tone === "money" ? "bg-emerald-600" : tone === "chaos" ? "bg-amber-500" : "bg-sky-600";
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.text} className="flex gap-2 text-[15px] leading-6">
            <span className={cnJoin("mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
            <span>
              {item.text}
              <span className="ml-1.5 text-xs text-slate-400">{SOURCE_LABEL[item.source] ?? item.source}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CardFacts({ card }: { card: ObservationCard }) {
  return (
    <div className="space-y-3">
      <FactBlock label="Деньги" items={card.money} tone="money" />
      <FactBlock label="Хаос" items={card.chaos} tone="chaos" />
      <FactBlock label="Рост" items={card.growth} tone="growth" />
      {card.calc ? (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{card.calc.text}</div>
      ) : null}
      {card.caseRef ? <div className="text-sm text-slate-600">Кейс NEEKLO: <b className="font-medium text-ink">{card.caseRef}</b></div> : null}
    </div>
  );
}

export function OrgLine({ item }: { item: HuntItem }) {
  const org = item.organization;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-500">
      {org.city ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{org.city}</span> : null}
      {org.rating != null ? <span className="inline-flex items-center gap-1 tabular-nums"><Star className="h-3.5 w-3.5" />{org.rating}{org.reviewCount != null ? ` · ${org.reviewCount} отз.` : ""}</span> : null}
      {item.segmentLabel ? <span>{item.segmentLabel}</span> : null}
    </div>
  );
}

export function ItemRow({ item, meta, href }: { item: HuntItem; meta?: ReactNode; href?: string }) {
  return (
    <Link href={href ?? `/hunt/${item.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-semibold">{item.organization.name}</span>
        </div>
        <div className="mt-0.5 truncate text-sm text-slate-500">{meta ?? item.card?.observation ?? item.organization.category}</div>
      </div>
      <PriorityBadge priority={item.priority} score={item.score} />
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </Link>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-lg font-semibold">
        {title}
        {count != null ? <span className="text-sm font-medium text-slate-400 tabular-nums">{count}</span> : null}
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">{children}</div>
    </section>
  );
}

/** Наблюдение-крючок, если оно не повторяет первый факт хаоса дословно. */
export function hookOf(card: ObservationCard | null) {
  if (!card?.observation) return null;
  return card.chaos.some((item) => item.text === card.observation) ? null : card.observation;
}

export function dayLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start) / 86400000);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff === -1) return "вчера";
  if (diff < 0) return `${-diff} дн. назад`;
  return `через ${diff} дн.`;
}
