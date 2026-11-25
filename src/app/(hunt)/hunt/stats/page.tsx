"use client";

import { useState } from "react";
import { ExternalLink, Sheet as SheetIcon } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { useLive } from "@/components/hunt/data";
import { Button, Glass, Notice, Ring, Segmented, Skeleton } from "@/components/hunt/ui";
import { dayLabel, rub, type SheetStatus } from "@/components/hunt/types";
import { HealthCard } from "@/components/hunt/health-card";
import { InsightsCard } from "@/components/hunt/insights";

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
  projects: { count: number; amount: number };
  bySegment: { segment: string | null; label: string; count: number }[];
  advice: string[];
};

function pct(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export default function HuntStatsPage() {
  const { version, open } = useHunt();
  const [days, setDays] = useState<"7" | "14" | "30">("7");
  const stats = useLive<Stats>(`/api/hunt/stats?days=${days}`, version);
  const sheets = useLive<SheetStatus>("/api/hunt/sheets", version);
  const data = stats.data;
  const funnel = data ? [["Касания", data.touches], ["Ответы", data.replies], ["Созвоны", data.calls], ["Сметы", data.estimates], ["Сделки", data.won]] as const : [];
  const max = Math.max(1, data?.touches ?? 1);

  return (
    <div className="pt-2">
      <p className="text-sm text-[var(--h-faint)]">Шаг 5 из 5</p>
      <h1 className="mt-1 text-[32px] font-semibold leading-[38px] tracking-tight">Цифры</h1>
      <div className="sticky top-[68px] z-20 -mx-4 mt-5 px-4 py-2 backdrop-blur-md">
        <Segmented value={days} onChange={setDays} items={[{ key: "7", label: "7 дней" }, { key: "14", label: "14 дней" }, { key: "30", label: "30 дней" }]} />
      </div>

      <div id="health" className="mt-3 scroll-mt-28"><HealthCard /></div>

      {stats.error ? <Notice tone="error">{stats.error}</Notice> : !data ? <div className="mt-3"><Skeleton rows={3} /></div> : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Glass tint="yellow" className="col-span-2 p-5">
            <div className="text-sm text-[var(--h-muted)]">Отвечают на касания</div>
            <div className="mt-1 text-[56px] font-semibold leading-none tabular-nums">{pct(data.replyRate)}</div>
            <div className="mt-2 text-sm text-[var(--h-muted)]">Цель стратегии 15–25% · {data.replies} из {data.touches}</div>
          </Glass>

          <Glass className="col-span-2 p-5">
            <div className="mb-3 text-sm text-[var(--h-muted)]">Воронка</div>
            <div className="space-y-3">
              {funnel.map(([label, value]) => (
                <div key={label}>
                  <div className="flex items-baseline justify-between text-[15px]"><span>{label}</span><span className="font-semibold tabular-nums">{value}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/10"><div className="h-1.5 rounded-full bg-[var(--h-accent)]" style={{ width: `${(value / max) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </Glass>

          <Glass className="flex flex-col justify-between p-4">
            <div className="text-sm text-[var(--h-muted)]">Проекты</div>
            <div className="mt-3 text-[28px] font-semibold leading-8 tabular-nums">{data.projects.count}</div>
            <div className="text-xs text-[var(--h-faint)]">на {rub(data.projects.amount)}</div>
          </Glass>
          <Glass className="flex flex-col justify-between p-4">
            <div className="text-sm text-[var(--h-muted)]">До решения по нише</div>
            <div className="mt-2 flex items-center gap-3"><Ring done={Math.min(data.totalTouches, 400)} total={400} size={56} /><span className="text-xs text-[var(--h-faint)]">касаний из 400</span></div>
          </Glass>
          <Glass className="col-span-2 p-4">
            <div className="flex items-baseline justify-between"><span className="text-sm text-[var(--h-muted)]">Скоринг: 60+ баллов</span><span className="text-xl font-semibold tabular-nums">{pct(data.passRate)}</span></div>
            <div className="mt-1 text-xs text-[var(--h-faint)]">{data.passed} из {data.qualified} карточек за период · норма от 40%</div>
          </Glass>

          {data.bySegment.length ? (
            <Glass className="col-span-2 p-4">
              <div className="mb-2 text-sm text-[var(--h-muted)]">Касания по нишам</div>
              {data.bySegment.map((item) => <div key={item.segment ?? "none"} className="flex justify-between py-1.5 text-[15px]"><span>{item.label}</span><span className="tabular-nums">{item.count}</span></div>)}
            </Glass>
          ) : null}

          <div className="col-span-2"><InsightsCard /></div>

          <div className="col-span-2 space-y-2">
            <h2 className="pt-2 text-lg font-semibold">Диагностика</h2>
            {data.advice.length ? data.advice.map((text) => <Notice key={text} tone="warn">{text}</Notice>) : <p className="text-sm text-[var(--h-muted)]">Пока данных мало или всё в норме. Советы появятся после 20 касаний.</p>}
          </div>

          <Glass className="col-span-2 p-4">
            <div className="flex items-center gap-2"><SheetIcon className="h-5 w-5 text-[var(--h-ok)]" /><span className="font-semibold">Google Таблица</span></div>
            {sheets.data?.status === "connected" ? (
              <p className="mt-2 text-sm text-[var(--h-muted)]">Лидов {sheets.data.leads}, проектов {sheets.data.projects}. Последняя запись {sheets.data.lastSyncAt ? dayLabel(sheets.data.lastSyncAt) : "—"}.</p>
            ) : <p className="mt-2 text-sm text-[var(--h-muted)]">Не подключена. Лиды, касания и проекты будут сами попадать в вашу таблицу.</p>}
            <Button size="sm" className="mt-3" onClick={() => open("panel", "settings")}><ExternalLink className="h-4 w-4" /> {sheets.data?.status === "connected" ? "Настроить" : "Подключить"}</Button>
          </Glass>
        </div>
      )}
    </div>
  );
}
