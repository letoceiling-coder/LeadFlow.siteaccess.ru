"use client";

import { useState } from "react";
import { useLive } from "./data";
import { Glass, Notice, Segmented, Skeleton, cx } from "./ui";
import type { Funnel, FunnelRow } from "./types";

function pct(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

const DECISION_TONE: Record<string, "yellow" | "green" | "orange" | "pink" | null> = { continue: "green", change: "pink", offer: "orange", watch: "yellow", collect: null };

/** Строка воронки: 7 цифр в сетке 4×2 — помещается в 390 px без горизонтального скролла. */
function Row({ row, strong }: { row: FunnelRow; strong?: boolean }) {
  const cells: [string, string | number][] = [["отправл.", row.sent], ["ответы", pct(row.replyRate)], ["интерес", row.interest], ["прототип", row.prototypes], ["созвоны", row.calls], ["КП", row.proposals], ["авансы", row.prepaid]];
  return (
    <div className={cx("py-3", strong && "font-semibold")}>
      <div className="flex items-baseline justify-between text-[15px]"><span>{row.label}</span><span className="text-xs text-[var(--h-faint)]">{row.replies} отв.</span></div>
      <div className="mt-1.5 grid grid-cols-4 gap-x-2 gap-y-1">
        {cells.map(([label, value]) => (
          <div key={label} className="min-w-0"><div className="text-[17px] font-semibold leading-6 tabular-nums">{value}</div><div className="truncate text-[11px] text-[var(--h-faint)]">{label}</div></div>
        ))}
      </div>
    </div>
  );
}

/** Сценарий 7 и «Воронка» брифа: по сегментам и вариантам, правило 50 контактов, итог дня с одним изменением на завтра. */
export function FunnelBoard({ version, showDay = true }: { version: number; showDay?: boolean }) {
  const [view, setView] = useState<"segment" | "variant" | "cells">("segment");
  const res = useLive<Funnel>("/api/hunt/funnel", version, 60000);
  const data = res.data;
  if (res.error) return <Notice tone="error">{res.error}</Notice>;
  if (!data) return <Skeleton rows={3} />;
  const rows = view === "segment" ? data.bySegment : view === "variant" ? data.byVariant : data.cells;
  return (
    <div className="space-y-3">
      {showDay ? (
        <Glass tint="yellow" className="p-4">
          <div className="text-sm text-[var(--h-muted)]">Итог дня</div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {([["отправлено", data.day.sent], ["касания 4/8", data.day.followUps], ["ответы", data.day.replies], ["интерес", data.day.interest]] as const).map(([label, value]) => (
              <div key={label}><div className="text-[24px] font-semibold leading-7 tabular-nums">{value}</div><div className="text-[11px] text-[var(--h-muted)]">{label}</div></div>
            ))}
          </div>
          {data.day.bySegmentVariant.length ? <p className="mt-2 text-xs text-[var(--h-muted)]">{data.day.bySegmentVariant.map((item) => `${item.label}: ${item.count}`).join(" · ")}</p> : null}
          {data.day.replyTypes.length ? <p className="mt-1 text-xs text-[var(--h-muted)]">Ответы: {data.day.replyTypes.map((item) => `${item.label} ${item.count}`).join(", ")}</p> : null}
          <div className="mt-3 rounded-2xl bg-black/20 px-3.5 py-2.5 text-[15px] leading-6"><b className="font-semibold">Завтра одно изменение:</b> {data.day.change}</div>
        </Glass>
      ) : null}

      <div className="space-y-2">
        {data.decisions.map((item) => (
          <Glass key={item.key} tint={DECISION_TONE[item.status] ?? null} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3"><span className="text-sm text-[var(--h-muted)]">{item.label}</span><b className="text-[15px] font-semibold">{item.title}</b></div>
            <p className="mt-1 text-sm leading-5">{item.text}</p>
          </Glass>
        ))}
        <p className="px-1 text-xs text-[var(--h-faint)]">Правило на 50 контактов: 10–15% ответов и 1–2 созвона — продолжаем; меньше 5% — меняем сегмент или текст; отвечают, но не созваниваются — не цепляет предложение.</p>
      </div>

      <Glass className="p-4">
        <Segmented value={view} onChange={setView} items={[{ key: "segment", label: "Сегменты" }, { key: "variant", label: "Варианты" }, { key: "cells", label: "Сегмент × вариант" }]} />
        <div className="mt-1 divide-y divide-[var(--h-line)]">
          <Row row={data.total} strong />
          {rows.length ? rows.map((row) => <Row key={row.key} row={row} />) : <p className="py-3 text-sm text-[var(--h-muted)]">Пока нет отправленных сообщений.</p>}
        </div>
      </Glass>
    </div>
  );
}
