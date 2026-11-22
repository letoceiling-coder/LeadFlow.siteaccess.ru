"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { useHunt } from "./shell";
import { post, useLive } from "./data";
import { Button, Glass, Skeleton, cx, errorText, useToast } from "./ui";
import { dayLabel } from "./types";

export type Health = {
  checks: { key: string; label: string; ok: boolean; optional?: boolean; detail: string }[];
  jobs: { type: string; status: string; count: number }[];
  failures: { type: string; error: string | null; at: string | null; attempts: number }[];
  lastSearch: null | { category: string; city: string; requested: number; received: number; unnamed: number; withReviews: number; status: string; at: string; error: string | null };
};

const JOB_LABEL: Record<string, string> = {
  "hunt.qualify": "Скоринг",
  "parser.submit": "Поиск: запуск",
  "parser.poll": "Поиск: ожидание",
  "parser.sync": "Синхронизация базы",
  "sheets.push": "Google Таблица",
  "sheets.full": "Таблица: полная выгрузка",
  "project.webhook": "JSON по API",
  "analysis.run": "AI-анализ",
  "agent.turn": "Агент",
};

export function useHealth(poll = 30000) {
  const { version } = useHunt();
  return useLive<Health>("/api/hunt/health", version, poll);
}

/** Короткая строка для шапки ленты: показывается, только если что-то не работает. */
export function HealthStrip() {
  const health = useHealth(60000);
  const broken = (health.data?.checks ?? []).filter((item) => !item.ok && !item.optional);
  if (!broken.length) return null;
  return (
    <Link href="/hunt/stats#health" className="tint-orange flex w-full items-center gap-2 rounded-2xl border px-4 py-2.5 text-left text-sm">
      <Activity className="h-4 w-4 shrink-0 text-[var(--h-hot)]" />
      <span className="min-w-0 flex-1 truncate">Не работает: {broken.map((item) => item.label).join(", ")}</span>
      <span className="shrink-0 text-[var(--h-accent)]">Подробнее</span>
    </Link>
  );
}

export function HealthCard() {
  const { user, refresh, open } = useHunt();
  const toast = useToast();
  const health = useHealth();
  const [busy, setBusy] = useState(false);
  const admin = ["OWNER", "ADMIN"].includes(user.role);
  const data = health.data;

  async function check(provider: string) {
    setBusy(true);
    try {
      await post(`/api/integrations/${provider}/test`);
      toast({ text: "Проверка пройдена" });
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(false);
      await health.reload();
      refresh();
    }
  }

  if (!data) return health.error ? <Glass className="p-4 text-sm text-[#ffb3b3]">{health.error}</Glass> : <Skeleton rows={1} />;
  const failed = data.jobs.filter((item) => ["failed", "dead"].includes(item.status)).reduce((sum, item) => sum + item.count, 0);
  const done = data.jobs.filter((item) => item.status === "completed").reduce((sum, item) => sum + item.count, 0);
  const search = data.lastSearch;

  return (
    <Glass className="p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-[var(--h-accent)]" />
        <span className="font-semibold">Состояние системы</span>
        <button aria-label="Обновить" onClick={() => health.reload()} className="ml-auto grid h-9 w-9 place-items-center rounded-full text-[var(--h-muted)] hover:bg-white/10"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <ul className="mt-3 space-y-2.5">
        {data.checks.map((item) => (
          <li key={item.key} className="flex items-start gap-3">
            <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", item.ok ? "bg-[var(--h-ok)]" : item.optional ? "bg-white/30" : "bg-[var(--h-danger)]")} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px]">{item.label}</div>
              <div className="break-words text-xs text-[var(--h-muted)]">{item.detail}</div>
            </div>
            {admin && !item.ok && item.key === "ai" ? <Button size="sm" onClick={() => open("panel", "settings")}>Настроить</Button> : null}
            {admin && !item.ok && item.key === "parser" ? <Button size="sm" pending={busy} onClick={() => check("parser")}>Проверить</Button> : null}
          </li>
        ))}
      </ul>

      {search ? (
        <div className="mt-4 rounded-2xl bg-white/[0.04] p-3 text-sm">
          <div className="text-[var(--h-muted)]">Последний поиск · {dayLabel(search.at)}</div>
          <div className="mt-1">{search.category}, {search.city}: пришло <b className="tabular-nums">{search.received}</b> из {search.requested}</div>
          <div className="mt-0.5 text-xs text-[var(--h-faint)]">с отзывами {search.withReviews} · без названия {search.unnamed}{search.error ? ` · ${search.error}` : ""}</div>
          {search.requested && search.received < search.requested / 2 ? <div className="mt-1.5 text-xs text-[#ffc3a6]">Парсер вернул меньше половины — проверьте обработчик парсера или расширьте запрос.</div> : null}
          {search.received && search.withReviews === 0 ? <div className="mt-1 text-xs text-[#ffc3a6]">Ни у одной карточки нет отзывов — без них скоринг не видит «денег».</div> : null}
        </div>
      ) : null}

      <div className="mt-4 text-sm text-[var(--h-muted)]">За сутки задач: выполнено <b className="text-[var(--h-text)] tabular-nums">{done}</b>, со сбоем <b className={cx("tabular-nums", failed ? "text-[#ff9b9b]" : "text-[var(--h-text)]")}>{failed}</b></div>
      {data.failures.length ? (
        <ul className="mt-2 space-y-1.5">
          {data.failures.slice(0, 5).map((item, index) => (
            <li key={index} className="rounded-xl bg-[rgba(255,100,100,0.08)] px-3 py-2 text-xs">
              <span className="font-medium">{JOB_LABEL[item.type] ?? item.type}</span> · {dayLabel(item.at)} · {item.error ?? "без описания"}
            </li>
          ))}
        </ul>
      ) : null}
    </Glass>
  );
}
