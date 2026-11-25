"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { Glass, cx } from "./ui";
import { useHunt } from "./shell";
import { useLive } from "./data";

export type SearchFunnel = { total?: number; incomplete: number; noFact: number; review: number; ready: number; hot?: number; queued: number; failed?: number };

export type SearchRow = {
  id: string;
  city: string;
  category: string;
  requested: number | null;
  status: string;
  progress?: number;
  syncedAt: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error: string | null;
  received: number | null;
  stage?: string | null;
  stageLabel?: string | null;
  eta?: number | null;
  counters?: Record<string, number> | null;
  collected?: number | null;
  imported?: number | null;
  funnel: SearchFunnel | null;
};

export type SearchResult = { id: string; priority: string; score: number; cardStatus: string; status: string; name: string; city: string | null; rating: number | null; reviewCount: number | null; website: string | null };
export type SearchDetail = SearchRow & { items: SearchResult[] };

/** Этапы цепочки одного поиска: очередь → сбор с карт → сохранение и скоринг → готово. */
export const PHASES = ["В очереди", "Сбор с карт", "Скоринг карточек", "Готово"] as const;

export function phaseOf(row: SearchRow): { index: number; failed: boolean } {
  if (["failed", "cancelled"].includes(row.status)) return { index: row.syncedAt ? 2 : row.status === "failed" && row.startedAt ? 1 : 0, failed: true };
  if (row.status === "queued") return { index: 0, failed: false };
  if (row.status === "running") return { index: 1, failed: false };
  if (!row.syncedAt || row.funnel?.queued) return { index: 2, failed: false };
  return { index: 3, failed: false };
}

export function isLive(row: SearchRow) {
  return phaseOf(row).index < 3 && !phaseOf(row).failed;
}

/** Сколько найдено сейчас: во время сбора — счётчик парсера, после — сохранённые компании. */
export function foundOf(row: SearchRow) {
  return row.received ?? row.collected ?? row.counters?.collected ?? 0;
}

export function targetOf(row: SearchRow) {
  return row.counters?.target ?? row.requested ?? 0;
}

/** Общий процент по всей цепочке, чтобы полоса не стояла на месте между этапами. */
export function percentOf(row: SearchRow) {
  const { index, failed } = phaseOf(row);
  if (index === 3) return 100;
  const target = targetOf(row);
  const found = foundOf(row);
  if (index === 0) return 3;
  if (index === 1) {
    const part = target ? Math.min(1, found / target) : (row.progress ?? 0) / 100;
    return Math.round(5 + part * 65);
  }
  const f = row.funnel;
  const scored = f?.total ? Math.min(1, (f.total - f.queued) / f.total) : 0;
  return failed ? Math.round(70 + scored * 30) : Math.round(72 + scored * 27);
}

export const STATUS_TEXT: Record<string, string> = { queued: "в очереди", running: "идёт сбор", completed: "готово", failed: "ошибка", cancelled: "остановлен" };

export function statusText(row: SearchRow) {
  const { index, failed } = phaseOf(row);
  if (failed) return STATUS_TEXT[row.status] ?? row.status;
  if (index === 2) return row.syncedAt ? "скоринг" : "сохраняем";
  return STATUS_TEXT[row.status] ?? row.status;
}

/** Плавный счётчик: число «набегает», как очки в игре. */
export function useCountUp(value: number, ms = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    if (begin === value) return;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(begin + (value - begin) * eased);
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = value; };
  }, [value, ms]);
  return shown;
}

export function ProgressBar({ percent, live, failed, className }: { percent: number; live?: boolean; failed?: boolean; className?: string }) {
  return (
    <div className={cx("relative h-2.5 overflow-hidden rounded-full bg-white/10", className)} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out", failed ? "bg-[var(--h-danger)]" : percent >= 100 ? "bg-[var(--h-ok)]" : "bg-[var(--h-accent)]", live && "progress-live")}
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </div>
  );
}

export function PhaseTrack({ row }: { row: SearchRow }) {
  const { index, failed } = phaseOf(row);
  return (
    <ol className="grid grid-cols-4 gap-1.5">
      {PHASES.map((label, step) => {
        const done = step < index || (step === 3 && index === 3);
        const on = step === index && index < 3;
        const broken = failed && step === index;
        return (
          <li key={label} className="min-w-0">
            <div className={cx("h-1.5 rounded-full", broken ? "bg-[var(--h-danger)]" : done ? "bg-[var(--h-ok)]" : on ? "progress-live bg-[var(--h-accent)]" : "bg-white/10")} />
            <div className={cx("mt-2 flex items-start gap-1 text-xs font-medium", broken ? "text-[#ff9b9b]" : done ? "text-[#8ff0bd]" : on ? "text-[var(--h-accent)]" : "text-[var(--h-faint)]")}>
              {broken ? <X className="h-3.5 w-3.5 shrink-0" /> : done ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} /> : on ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--h-accent)]" /> : null}
              <span className="leading-tight max-sm:text-[11px]">{label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function etaText(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "меньше минуты" : `~${minutes} мин`;
}

/** Плашка «идёт поиск» для любого экрана: видно, что парсер работает, и одно касание до хода поиска. */
export function LiveSearches() {
  const { version } = useHunt();
  const list = useLive<SearchRow[]>("/api/hunt/searches?limit=5", version, 5000);
  const active = (list.data ?? []).filter(isLive);
  if (!active.length) return null;
  return (
    <div className="space-y-2">
      {active.map((item) => (
        <Link key={item.id} href={`/hunt/search/${item.id}`} className="block">
          <Glass tint="yellow" className="px-4 py-3 transition hover:brightness-125">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--h-accent)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">Идёт поиск: {item.category} · {item.city}</div>
                <div className="truncate text-xs text-[var(--h-muted)]">{statusText(item)} · найдено {foundOf(item)}{targetOf(item) ? ` из ${targetOf(item)}` : ""}{item.funnel ? ` · в отборе ${item.funnel.ready}` : ""}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--h-accent)]" />
            </div>
            <ProgressBar percent={percentOf(item)} live className="mt-2.5 h-1.5" />
          </Glass>
        </Link>
      ))}
    </div>
  );
}
