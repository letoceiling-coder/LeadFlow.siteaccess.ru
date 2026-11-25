"use client";

import { Lightbulb, Play } from "lucide-react";
import { useHunt } from "./shell";
import { useLive } from "./data";
import { Glass, Notice, Skeleton, cx } from "./ui";

export type Insights = {
  searches: { key: string; city: string; category: string; runs: number; received: number; ready: number; review: number; incomplete: number; withReviews: number; usefulPer100: number; maxResults: number }[];
  bySegment: { key: string; label: string; sent: number; replied: number; rate: number }[];
  byChannel: { key: string; sent: number; replied: number; rate: number }[];
  hooks: string[];
  rejectReasons: { reason: string; count: number }[];
  manualFacts: { text: string; count: number }[];
  advice: string[];
};

const CHANNEL: Record<string, string> = { telegram: "Telegram", max: "MAX", whatsapp: "WhatsApp", vk: "VK", email: "Почта", phone: "Звонок", instagram: "Instagram", avito: "Авито", other: "Другое" };

export function useInsights(enabled = true) {
  const { version } = useHunt();
  return useLive<Insights>(enabled ? "/api/hunt/insights" : null, version);
}

/** Лучшие запросы для панели поиска: запуск в одно касание. */
export function BestQueries({ onRun, busy }: { onRun: (params: { city: string; category: string; maxResults: number }) => void; busy: boolean }) {
  const data = useInsights().data;
  const top = (data?.searches ?? []).filter((item) => item.received > 0).slice(0, 5);
  if (!top.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-lg font-semibold">Лучшие запросы</h3>
      <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
        {top.map((item) => (
          <div key={item.key} className="flex min-h-14 items-center gap-2 py-2 pl-4 pr-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{item.category} · {item.city}</div>
              <div className="text-xs text-[var(--h-faint)]">{item.usefulPer100} полезных на 100 · в ленте {item.ready}, проверить {item.review} из {item.received}</div>
            </div>
            <button disabled={busy} aria-label={`Повторить ${item.category}, ${item.city}`} onClick={() => onRun({ city: item.city, category: item.category, maxResults: Math.max(20, item.maxResults || 20) })} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--h-accent)] text-[var(--h-accent-ink)] disabled:opacity-40"><Play className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Rate({ sent, replied }: { sent: number; replied: number }) {
  const rate = sent ? Math.round((replied / sent) * 100) : 0;
  return <span className={cx("tabular-nums", rate >= 15 ? "text-[#8ff0bd]" : rate > 0 ? "text-[var(--h-text)]" : "text-[var(--h-faint)]")}>{replied}/{sent} · {rate}%</span>;
}

/** «Чему научились»: выводы из истории для экрана «Цифры». */
export function InsightsCard() {
  const insights = useInsights();
  const data = insights.data;
  if (!data) return insights.error ? <Notice tone="error">{insights.error}</Notice> : <Skeleton rows={2} />;
  return (
    <Glass className="space-y-4 p-4">
      <div className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-[var(--h-accent)]" /><span className="font-semibold">Чему научились</span></div>
      {data.advice.length ? <div className="space-y-2">{data.advice.map((text, index) => <Notice key={`${index}-${text}`}>{text}</Notice>)}</div> : <p className="text-sm text-[var(--h-muted)]">Выводы появятся после первых поисков и отправок.</p>}

      {data.searches.length ? (
        <div>
          <div className="mb-1.5 text-sm text-[var(--h-muted)]">Поиски по полезности</div>
          <div className="space-y-1.5">
            {data.searches.slice(0, 8).map((item) => (
              <div key={item.key} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{item.category} · {item.city}</span>
                <span className="w-24 shrink-0"><span className="block h-1.5 rounded-full bg-white/10"><span className="block h-1.5 rounded-full bg-[var(--h-accent)]" style={{ width: `${Math.min(100, item.usefulPer100)}%` }} /></span></span>
                <span className="w-10 shrink-0 text-right tabular-nums">{item.usefulPer100}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-[var(--h-faint)]">Полезных карточек на 100 найденных: готовые к ленте + 0,4 за «на проверку».</p>
        </div>
      ) : null}

      {data.bySegment.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-sm text-[var(--h-muted)]">Ответы по нишам</div>
            {data.bySegment.map((item) => <div key={item.key} className="flex justify-between py-1 text-sm"><span>{item.label}</span><Rate sent={item.sent} replied={item.replied} /></div>)}
          </div>
          <div>
            <div className="mb-1.5 text-sm text-[var(--h-muted)]">Ответы по каналам</div>
            {data.byChannel.map((item) => <div key={item.key} className="flex justify-between py-1 text-sm"><span>{CHANNEL[item.key] ?? item.key}</span><Rate sent={item.sent} replied={item.replied} /></div>)}
          </div>
        </div>
      ) : null}

      {data.hooks.length ? (
        <div>
          <div className="mb-1.5 text-sm text-[var(--h-muted)]">Крючки, на которые ответили</div>
          <ul className="space-y-1.5">{data.hooks.map((hook, index) => <li key={`${index}-${hook}`} className="rounded-xl bg-white/[0.04] px-3 py-2 text-sm">«{hook}»</li>)}</ul>
        </div>
      ) : null}

      {data.rejectReasons.length || data.manualFacts.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.rejectReasons.length ? (
            <div>
              <div className="mb-1.5 text-sm text-[var(--h-muted)]">Почему отклоняем</div>
              {data.rejectReasons.map((item) => <div key={item.reason} className="flex justify-between py-1 text-sm"><span className="min-w-0 truncate">{item.reason}</span><span className="tabular-nums">{item.count}</span></div>)}
            </div>
          ) : null}
          {data.manualFacts.length ? (
            <div>
              <div className="mb-1.5 text-sm text-[var(--h-muted)]">Какие факты вы подтверждаете</div>
              {data.manualFacts.map((item) => <div key={item.text} className="flex justify-between py-1 text-sm"><span className="min-w-0 truncate">{item.text}</span><span className="tabular-nums">{item.count}</span></div>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </Glass>
  );
}
