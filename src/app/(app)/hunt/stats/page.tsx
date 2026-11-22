"use client";

import { useState } from "react";
import { useResource } from "@/components/use-resource";
import { Loading, State, cnJoin } from "@/components/ui";

type Stats = {
  days: number;
  touches: number;
  replies: number;
  calls: number;
  estimates: number;
  won: number;
  replyRate: number | null;
  qualified: number;
  passed: number;
  passRate: number | null;
  totalTouches: number;
  bySegment: { segment: string | null; label: string; count: number }[];
  advice: string[];
};

function pct(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export default function HuntStatsPage() {
  const [days, setDays] = useState(7);
  const stats = useResource<Stats>(`/api/hunt/stats?days=${days}`);
  const data = stats.data;

  return (
    <div className="mx-auto w-full max-w-xl pb-4">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight">Цифры</h1>
      <div className="mt-4 flex gap-1 rounded-full bg-slate-100 p-1">
        {[7, 14, 30].map((value) => (
          <button key={value} onClick={() => setDays(value)} className={cnJoin("h-9 flex-1 rounded-full text-sm font-medium", days === value ? "bg-white shadow-card" : "text-slate-600")}>{value} дней</button>
        ))}
      </div>

      {stats.loading && !data ? <div className="mt-5"><Loading /></div> : stats.error ? <div className="mt-5"><State title="Цифры недоступны" text={stats.error} /></div> : data ? (
        <>
          <section className="mt-5 rounded-3xl border border-line bg-white p-5">
            <div className="text-sm text-slate-500">Ответов на касания</div>
            <div className="mt-1 text-5xl font-semibold tabular-nums leading-none">{pct(data.replyRate)}</div>
            <div className="mt-2 text-sm text-slate-500">Цель стратегии — 15–25%</div>
          </section>

          <section className="mt-3 overflow-hidden rounded-3xl border border-line bg-white">
            {[
              ["Касания", data.touches],
              ["Ответы", data.replies],
              ["Созвоны", data.calls],
              ["Сметы", data.estimates],
              ["Сделки", data.won],
            ].map(([label, value], index, list) => {
              const max = Math.max(1, Number(list[0][1]));
              return (
                <div key={label} className="border-b border-line px-5 py-3 last:border-0">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[15px]">{label}</span>
                    <span className="text-lg font-semibold tabular-nums">{value}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-teal-700" style={{ width: `${(Number(value) / max) * 100}%` }} /></div>
                </div>
              );
            })}
          </section>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-line bg-white px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums">{pct(data.passRate)}</div>
              <div className="text-xs text-slate-500">карточек набрали 60+ ({data.passed} из {data.qualified})</div>
            </div>
            <div className="rounded-2xl border border-line bg-white px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums">{data.totalTouches}<span className="text-base text-slate-400">/400</span></div>
              <div className="text-xs text-slate-500">касаний всего до решения по нише</div>
            </div>
          </div>

          {data.bySegment.length ? (
            <section className="mt-6">
              <h2 className="mb-2 px-1 text-lg font-semibold">По нишам</h2>
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                {data.bySegment.map((item) => (
                  <div key={item.segment ?? "none"} className="flex justify-between px-4 py-3 text-[15px]"><span>{item.label}</span><span className="tabular-nums">{item.count}</span></div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-6">
            <h2 className="mb-2 px-1 text-lg font-semibold">Диагностика</h2>
            {data.advice.length ? (
              <ul className="space-y-2">
                {data.advice.map((text) => <li key={text} className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950">{text}</li>)}
              </ul>
            ) : <p className="px-1 text-sm text-slate-500">Пока данных мало или всё в норме. Советы появятся после 20 касаний.</p>}
          </section>
        </>
      ) : null}
    </div>
  );
}
