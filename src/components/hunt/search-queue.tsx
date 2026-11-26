"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, MapPin, Send, Trash2, X } from "lucide-react";
import { ApiClientError, api } from "@/lib/client";
import { post } from "./data";
import { cx, errorText, useToast } from "./ui";
import { dayLabel } from "./types";
import { ProgressBar, foundOf, isLive, percentOf, phaseOf, statusText, targetOf, type SearchRow } from "./search-progress";

/* ───────────── Telegram-каналы: поиск идёт у S2 (/api/hunt/telegram/searches), список — на этом устройстве ───────────── */

export type TgSearch = {
  /** Номер поиска у сервера; null — источник недоступен, запрос не ушёл. */
  id: string | null;
  key: string;
  niche: string;
  city: string | null;
  createdAt: string;
  status: "queued" | "running" | "completed" | "failed" | "unavailable";
  found: number;
  error: string | null;
};

const TG_KEY = "hunt.tg.searches";
const TG_LIVE = ["queued", "running"];

function loadTg(): TgSearch[] {
  try {
    const raw = localStorage.getItem(TG_KEY);
    const list = raw ? (JSON.parse(raw) as TgSearch[]) : [];
    return Array.isArray(list) ? list.slice(0, 30) : [];
  } catch {
    return [];
  }
}

/** Эндпоинта ещё нет (сессия S2 не выложена) — «источник недоступен», а не падение экрана. */
function unavailable(reason: unknown) {
  return reason instanceof ApiClientError && (reason.status === 404 || reason.status === 405 || reason.status === 501);
}

export function useTelegramSearches() {
  const [items, setItems] = useState<TgSearch[]>([]);
  const ready = useRef(false);

  useEffect(() => { setItems(loadTg()); ready.current = true; }, []);
  useEffect(() => {
    if (!ready.current) return;
    try { localStorage.setItem(TG_KEY, JSON.stringify(items.slice(0, 30))); } catch { /* приватный режим */ }
  }, [items]);

  const patch = useCallback((key: string, next: Partial<TgSearch>) => setItems((list) => list.map((item) => (item.key === key ? { ...item, ...next } : item))), []);

  const live = items.filter((item) => item.id && TG_LIVE.includes(item.status));
  const liveIds = live.map((item) => item.key).join(",");

  useEffect(() => {
    if (!liveIds) return;
    let stop = false;
    const tick = async () => {
      for (const item of loadTgLive()) {
        try {
          const st = await api<{ status?: string; found?: number; error?: string | null }>(`/api/hunt/telegram/searches/${encodeURIComponent(item.id!)}`);
          if (stop) return;
          const status = (["queued", "running", "completed", "failed"].includes(String(st.status)) ? st.status : "running") as TgSearch["status"];
          patch(item.key, { status, found: Number(st.found ?? 0), error: st.error ?? null });
        } catch (reason) {
          if (stop) return;
          if (unavailable(reason)) patch(item.key, { status: "failed", error: reason instanceof ApiClientError && reason.status === 404 ? "Поиск не найден на сервере" : "Источник недоступен" });
        }
      }
    };
    // Список живых читаем из хранилища: замыкание не держит устаревший список.
    const loadTgLive = () => loadTg().filter((item) => item.id && TG_LIVE.includes(item.status));
    void tick();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void tick(); }, 5000);
    return () => { stop = true; clearInterval(timer); };
  }, [liveIds, patch]);

  const start = useCallback(async (niche: string, city: string | null, limit: number) => {
    const base: TgSearch = { id: null, key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, niche, city, createdAt: new Date().toISOString(), status: "queued", found: 0, error: null };
    try {
      const result = await post<{ id?: string }>("/api/hunt/telegram/searches", { niche, ...(city ? { city } : {}), limit });
      if (!result?.id) throw new Error("Сервер не вернул номер поиска");
      const item = { ...base, id: result.id };
      setItems((list) => [item, ...list]);
      return item;
    } catch (reason) {
      const item: TgSearch = unavailable(reason) ? { ...base, status: "unavailable", error: "Источник «Telegram-каналы» пока недоступен" } : { ...base, status: "failed", error: errorText(reason) };
      setItems((list) => [item, ...list]);
      return item;
    }
  }, []);

  const remove = useCallback((key: string) => setItems((list) => list.filter((item) => item.key !== key)), []);

  return { items, live: live.length, start, remove };
}

/* ───────────── Общая очередь: карты + Telegram ───────────── */

const SOURCE_SHORT: Record<string, string> = { maps: "Карты", sites: "Сайты", telegram: "Telegram" };

function pill(tone: "live" | "ok" | "error" | "wait") {
  return {
    live: "bg-[rgba(255,214,10,0.14)] text-[var(--h-accent)]",
    wait: "bg-white/10 text-[var(--h-muted)]",
    ok: "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]",
    error: "bg-[rgba(255,100,100,0.15)] text-[#ff9b9b]",
  }[tone];
}

function mapsTone(row: SearchRow): "live" | "ok" | "error" | "wait" {
  const phase = phaseOf(row);
  if (phase.failed) return "error";
  if (phase.index === 3) return "ok";
  return row.queue?.state === "waiting" ? "wait" : "live";
}

const TG_TEXT: Record<TgSearch["status"], string> = { queued: "в очереди", running: "ищет каналы", completed: "готово", failed: "ошибка", unavailable: "источник недоступен" };

function ActionButton({ label, onClick, busy, children }: { label: string; onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClick(); }}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--h-faint)] transition hover:bg-white/10 hover:text-[var(--h-text)] disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}

export function MapsQueueRow({ row, onChanged }: { row: SearchRow; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const live = isLive(row);
  const open = ["queued", "running"].includes(row.status);
  const waiting = row.queue?.state === "waiting";
  const f = row.funnel;

  async function cancel() {
    if (!waiting && !window.confirm(`Остановить сбор «${row.category}, ${row.city}»? Следующий в очереди уйдёт в парсер.`)) return;
    setBusy(true);
    try {
      await post(`/api/parser/tasks/${row.id}/cancel`);
      toast({ text: waiting ? "Убрано из очереди" : "Сбор остановлен" });
      onChanged();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await post(`/api/hunt/queue/${row.id}`, undefined, "DELETE");
      toast({ text: "Поиск удалён из списка. Найденные карточки остались" });
      onChanged();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const error = phaseOf(row).failed && row.status === "failed" ? row.error : null;
  return (
    <li className="flex items-start gap-1 py-2.5 pl-4 pr-1.5">
      <Link href={`/hunt/search/${row.id}`} className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-[var(--h-faint)]" />
          <span className="line-clamp-2 min-w-0 text-[15px] font-medium leading-5">{row.category} · {row.city}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium", pill(mapsTone(row)))}>
            {live && !waiting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {statusText(row)}
          </span>
          {(row.sources ?? ["maps", "sites"]).filter((source) => source !== "telegram").map((source) => <span key={source} className="text-[var(--h-faint)]">{SOURCE_SHORT[source]}</span>)}
          <span className="text-[var(--h-faint)]">· {dayLabel(row.createdAt)}</span>
        </div>
        {live && !waiting ? <ProgressBar percent={percentOf(row)} live className="mt-2 h-1.5" /> : null}
        <div className="mt-1.5 text-xs text-[var(--h-faint)]">
          {waiting ? "Уйдёт в парсер сам, когда закончится предыдущий сбор" : <>найдено {foundOf(row)}{targetOf(row) ? ` из ${targetOf(row)}` : ""}{f ? ` · в отборе ${f.ready}${f.hot ? ` · A ${f.hot}` : ""}` : ""}</>}
        </div>
        {error ? <div className="mt-1 text-xs leading-4 text-[#ff9b9b]">{error}</div> : null}
      </Link>
      {open ? (
        <ActionButton label={waiting ? "Убрать из очереди" : "Остановить сбор"} onClick={cancel} busy={busy}><X className="h-5 w-5" /></ActionButton>
      ) : (
        <ActionButton label="Удалить из списка" onClick={remove} busy={busy}><Trash2 className="h-4 w-4" /></ActionButton>
      )}
      <Link href={`/hunt/search/${row.id}`} aria-label="Открыть поиск" className="grid h-11 w-8 shrink-0 place-items-center text-[var(--h-faint)]"><ChevronRight className="h-4 w-4" /></Link>
    </li>
  );
}

export function TelegramQueueRow({ item, onRemove }: { item: TgSearch; onRemove: () => void }) {
  const live = TG_LIVE.includes(item.status) && Boolean(item.id);
  const tone = item.status === "completed" ? "ok" : item.status === "failed" || item.status === "unavailable" ? "error" : "live";
  const body = (
    <>
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 shrink-0 text-[#8ab8ff]" />
        <span className="line-clamp-2 min-w-0 text-[15px] font-medium leading-5">{item.niche}{item.city ? ` · ${item.city}` : ""}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium", pill(tone))}>
          {live ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {TG_TEXT[item.status]}
        </span>
        <span className="text-[var(--h-faint)]">Telegram-каналы · {dayLabel(item.createdAt)}</span>
      </div>
      <div className="mt-1.5 text-xs text-[var(--h-faint)]">{item.status === "unavailable" ? "Поиск каналов ещё не подключён на сервере — карты и сайты работают" : `найдено каналов ${item.found}${item.status === "completed" && item.found ? " · карточки в «Сегодня»" : ""}`}</div>
      {item.error && item.status !== "unavailable" ? <div className="mt-1 text-xs leading-4 text-[#ff9b9b]">{item.error}</div> : null}
    </>
  );
  return (
    <li className="flex items-start gap-1 py-2.5 pl-4 pr-1.5">
      {item.status === "completed" && item.found ? <Link href="/hunt" className="min-w-0 flex-1 py-0.5">{body}</Link> : <div className="min-w-0 flex-1 py-0.5">{body}</div>}
      <ActionButton label={live ? "Скрыть из очереди" : "Удалить из списка"} onClick={onRemove}>{live ? <X className="h-5 w-5" /> : <Trash2 className="h-4 w-4" />}</ActionButton>
    </li>
  );
}
