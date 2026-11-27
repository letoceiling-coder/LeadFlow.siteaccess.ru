"use client";

import { useState } from "react";
import { ExternalLink, Sheet as SheetIcon } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { useLive } from "@/components/hunt/data";
import { Button, Glass, Notice, PageHeader, Ring, Skeleton, StatStrip, ViewSwitch } from "@/components/hunt/ui";
import { dayLabel, rub, type SheetStatus } from "@/components/hunt/types";
import { HealthCard } from "@/components/hunt/health-card";
import { InsightsCard } from "@/components/hunt/insights";
import { FunnelBoard } from "@/components/hunt/funnel-board";

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
    <div>
      <PageHeader
        title="Цифры"
        subtitle="итоги, воронка и таблица"
        actions={<ViewSwitch value={days} onChange={setDays} items={[{ key: "7", label: "7 дней" }, { key: "14", label: "14 дней" }, { key: "30", label: "30 дней" }]} />}
      />

      {stats.error ? <div className="mt-5"><Notice tone="error">{stats.error}</Notice></div> : !data ? <div className="mt-5"><Skeleton rows={3} /></div> : (
        <>
          <div className="mt-5">
            <StatStrip title={`За ${days} дней`} items={[
              { label: "ответы на касания", value: pct(data.replyRate), sub: `цель 15–25% · ${data.replies} из ${data.touches}`, tone: "accent" },
              { label: "созвоны", value: data.calls, sub: `сметы ${data.estimates}` },
              { label: "сделки", value: data.won, tone: data.won ? "ok" : null },
              { label: "проекты", value: data.projects.count, sub: `на ${rub(data.projects.amount)}` },
            ]} />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <FunnelBoard version={version} />
              <div id="health" className="scroll-mt-28"><HealthCard /></div>
            </div>

            <div className="min-w-0 space-y-3">
              <Glass className="p-5">
                <div className="mb-3 text-[15px] font-semibold">Воронка за период</div>
                <div className="space-y-3">
                  {funnel.map(([label, value]) => (
                    <div key={label}>
                      <div className="flex items-baseline justify-between text-[14px]"><span className="text-[var(--h-muted)]">{label}</span><span className="font-semibold tabular-nums">{value}</span></div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-white/10"><div className="h-1.5 rounded-full bg-[var(--h-accent)]" style={{ width: `${(value / max) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </Glass>

              <div className="grid grid-cols-2 gap-3">
                <Glass className="flex flex-col justify-between p-4">
                  <div className="text-[13px] text-[var(--h-muted)]">До решения по нише</div>
                  <div className="mt-2 flex items-center gap-3"><Ring done={Math.min(data.totalTouches, 400)} total={400} size={56} /><span className="text-xs text-[var(--h-faint)]">касаний из 400</span></div>
                </Glass>
                <Glass className="flex flex-col justify-between p-4">
                  <div className="text-[13px] text-[var(--h-muted)]">Скоринг 60+</div>
                  <div className="mt-2 text-[28px] font-semibold leading-8 tabular-nums">{pct(data.passRate)}</div>
                  <div className="text-xs text-[var(--h-faint)]">{data.passed} из {data.qualified} · норма от 40%</div>
                </Glass>
              </div>

              {data.bySegment.length ? (
                <Glass className="p-4">
                  <div className="mb-2 text-[15px] font-semibold">Касания по нишам</div>
                  {data.bySegment.map((item) => <div key={item.segment ?? "none"} className="flex justify-between border-t border-[var(--h-line)] py-2 text-[14px] first:border-0"><span className="text-[var(--h-muted)]">{item.label}</span><span className="tabular-nums">{item.count}</span></div>)}
                </Glass>
              ) : null}

              <Glass className="p-4">
                <div className="flex items-center gap-2"><SheetIcon className="h-5 w-5 text-[var(--h-ok)]" /><span className="font-semibold">Google Таблица</span></div>
                {sheets.data?.status === "connected" ? (
                  <p className="mt-2 text-sm text-[var(--h-muted)]">Лидов {sheets.data.leads}, проектов {sheets.data.projects}. Последняя запись {sheets.data.lastSyncAt ? dayLabel(sheets.data.lastSyncAt) : "—"}.</p>
                ) : <p className="mt-2 text-sm text-[var(--h-muted)]">Не подключена. Лиды, касания и проекты будут сами попадать в вашу таблицу.</p>}
                <Button size="sm" className="mt-3" onClick={() => open("panel", "settings")}><ExternalLink className="h-4 w-4" /> {sheets.data?.status === "connected" ? "Настроить" : "Подключить"}</Button>
              </Glass>

              <InsightsCard />

              <div className="space-y-2">
                <h2 className="px-1 pt-2 text-[17px] font-semibold">Диагностика</h2>
                {data.advice.length ? data.advice.map((text) => <Notice key={text} tone="warn">{text}</Notice>) : <p className="px-1 text-sm text-[var(--h-muted)]">Пока данных мало или всё в норме. Советы появятся после 20 касаний.</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
