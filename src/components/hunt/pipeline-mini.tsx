"use client";

import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { useLive } from "./data";
import { Glass, Skeleton, cx } from "./ui";

type Steps = { steps: { key: string; label: string; hint: string; count: number }[] };

/** Мини-воронка для правой колонки: сколько лидов на каждом шаге, ссылка на доску. */
export function PipelineMini({ version }: { version: number }) {
  const res = useLive<Steps>("/api/hunt/pipeline?limit=1", version, 60000);
  const steps = (res.data?.steps ?? []).filter((item) => item.key !== "lost");
  const max = Math.max(1, ...steps.map((item) => item.count));
  return (
    <Glass className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Воронка</h2>
        <Link href="/hunt/pipeline" className="inline-flex items-center gap-1 text-[12px] text-[var(--h-muted)] hover:text-[var(--h-text)]">Доска <ArrowUpRight className="h-3.5 w-3.5" /></Link>
      </div>
      {!res.data ? <Skeleton rows={2} /> : (
        <div className="space-y-2">
          {steps.map((item, index) => (
            <Link key={item.key} href={`/hunt/pipeline?step=${item.key}`} title={item.hint} className="group block">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--h-muted)] group-hover:text-[var(--h-text)]">{item.label}</span>
                <span className={cx("font-semibold tabular-nums", !item.count && "text-[var(--h-faint)]")}>{item.count}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-white/[0.07]">
                <div className={cx("h-1 rounded-full", index >= 3 ? "bg-[var(--h-ok)]" : "bg-[var(--h-accent)]")} style={{ width: `${Math.max(item.count ? 4 : 0, (item.count / max) * 100)}%` }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Glass>
  );
}

/** Карточка-приглашение к новому поиску. */
export function NewSearchCard() {
  return (
    <Link href="/hunt/search" className="block">
      <Glass tint="yellow" className="flex items-center gap-3 p-4 transition hover:brightness-125">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--h-accent)] text-[var(--h-accent-ink)]"><Plus className="h-5 w-5" strokeWidth={2.6} /></span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">Новый поиск</span>
          <span className="block text-[12px] text-[var(--h-muted)]">ниша, города, карты и Telegram</span>
        </span>
      </Glass>
    </Link>
  );
}
