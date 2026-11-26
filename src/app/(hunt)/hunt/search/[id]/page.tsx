"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Flame, ListChecks, Loader2, MapPin, RefreshCw, RotateCcw, Sheet as SheetIcon, Square, Star, Trash2, Trophy } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { Button, Chip, Empty, Glass, Notice, PriorityBadge, Skeleton, cx, errorText, useToast } from "@/components/hunt/ui";
import { STATUS_LABEL, dayLabel, type SheetStatus } from "@/components/hunt/types";
import { PhaseTrack, ProgressBar, etaText, foundOf, isLive, percentOf, phaseOf, statusText, targetOf, useCountUp, type SearchDetail, type SearchResult } from "@/components/hunt/search-progress";

type Filter = "all" | "ready" | "hot" | "review" | "noFact" | "incomplete" | "queued" | "failed";

const CARD_LABEL: Record<string, string> = { ready: "готова", no_fact: "без фактов", incomplete: "неполная", queued: "в скоринге", pending: "ждёт скоринга", failed: "сбой скоринга" };
const COUNTER_LABEL: Record<string, string> = { collected: "собрано", target: "цель", scanned: "просмотрено", skipped: "пропущено", duplicates: "дубли", errors: "ошибки", pages: "страниц", withPhone: "с телефоном", withSite: "с сайтом" };

function match(item: SearchResult, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "ready") return item.cardStatus === "ready" && ["A", "B"].includes(item.priority);
  if (filter === "hot") return item.cardStatus === "ready" && item.priority === "A";
  if (filter === "review") return item.cardStatus === "no_fact" && item.priority === "C";
  if (filter === "noFact") return item.cardStatus === "no_fact";
  if (filter === "incomplete") return item.cardStatus === "incomplete";
  if (filter === "queued") return ["queued", "pending"].includes(item.cardStatus);
  return item.cardStatus === "failed";
}

function clock(date: Date) {
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function HuntSearchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { version, open, refresh } = useHunt();
  const router = useRouter();
  const toast = useToast();
  const [poll, setPoll] = useState<number | false>(3000);
  const res = useLive<SearchDetail>(`/api/hunt/searches/${encodeURIComponent(id)}`, version, poll);
  const sheets = useLive<SheetStatus>("/api/hunt/sheets", version, poll ? 15000 : false);
  const data = res.data;
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<{ at: Date; text: string; tone?: "ok" | "hot" | "error" }[]>([]);
  const prev = useRef<SearchDetail | null>(null);

  const live = data ? isLive(data) : true;
  useEffect(() => { setPoll(live ? 3000 : false); }, [live]);

  // Лента событий собирается из изменений состояния: новый этап, новые карточки, итоги скоринга.
  useEffect(() => {
    if (!data) return;
    const before = prev.current;
    const add: { text: string; tone?: "ok" | "hot" | "error" }[] = [];
    if (!before) add.push({ text: `Поиск «${data.category}, ${data.city}» создан ${dayLabel(data.createdAt)}` });
    if (data.stage && data.stage !== before?.stage) add.push({ text: data.stage });
    const found = foundOf(data);
    if (before && found > foundOf(before)) add.push({ text: `+${found - foundOf(before)} компаний · всего ${found}`, tone: "ok" });
    if (data.syncedAt && !before?.syncedAt) add.push({ text: `Сбор завершён: сохранено ${data.received ?? 0} компаний. Начался скоринг`, tone: "ok" });
    const hot = data.funnel?.hot ?? 0;
    if (before?.funnel && hot > (before.funnel.hot ?? 0)) add.push({ text: `Горячая карточка! Класс A: уже ${hot}`, tone: "hot" });
    const ready = data.funnel?.ready ?? 0;
    if (before?.funnel && ready > before.funnel.ready) add.push({ text: `В отбор попало ещё ${ready - before.funnel.ready} · всего ${ready}`, tone: "ok" });
    if (before && isLive(before) && !isLive(data)) {
      if (phaseOf(data).failed) add.push({ text: `Поиск остановлен: ${data.error ?? statusText(data)}`, tone: "error" });
      else {
        add.push({ text: `Готово! В отбор: ${ready}, из них горячих ${hot}`, tone: "hot" });
        toast({ text: `Поиск готов: ${ready} карточек в отборе` });
        refresh();
      }
    }
    if (add.length) {
      const now = new Date();
      // Новое сверху. Разворот — вне функции обновления: React может вызвать её дважды.
      const fresh = [...add].reverse().map((item) => ({ ...item, at: now }));
      setFeed((list) => [...fresh, ...list].slice(0, 40));
    }
    prev.current = data;
  }, [data, toast, refresh]);

  const found = useCountUp(data ? foundOf(data) : 0);
  const readyShown = useCountUp(data?.funnel?.ready ?? 0);
  const items = useMemo(() => (data?.items ?? []).filter((item) => match(item, filter)), [data, filter]);

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await run();
      toast({ text: done });
      await res.reload();
      refresh();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function again() {
    if (!data) return;
    setBusy(true);
    try {
      const result = await post<{ task: { id: string } }>("/api/parser/tasks", { city: data.city, category: data.category, maxResults: data.requested ?? 50, searchQuery: "", force: true });
      router.push(`/hunt/search/${result.task.id}`);
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!data || !window.confirm(`Удалить «${data.category}, ${data.city}» из истории? Найденные компании и карточки останутся в базе.`)) return;
    setBusy(true);
    try {
      await post(`/api/hunt/searches/${data.id}`, undefined, "DELETE");
      toast({ text: "Поиск удалён из истории" });
      router.push("/hunt/search");
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
      setBusy(false);
    }
  }

  if (res.error && !data) return <div className="pt-4"><Notice tone="error">{res.error}</Notice><Link href="/hunt/search" className="mt-3 inline-block text-[var(--h-accent)]">← Все поиски</Link></div>;
  if (!data) return <div className="pt-4"><Skeleton rows={4} /></div>;

  const phase = phaseOf(data);
  const percent = percentOf(data);
  const target = targetOf(data);
  const f = data.funnel;
  const eta = etaText(data.eta);
  const extra = Object.entries(data.counters ?? {}).filter(([key, value]) => typeof value === "number" && !["collected", "target"].includes(key));
  const tiles: { key: Filter; label: string; value: number; tone?: string; icon?: typeof Flame }[] = f ? [
    { key: "hot", label: "Горячие A", value: f.hot ?? 0, tone: "tint-yellow", icon: Flame },
    { key: "ready", label: "В отбор (A+B)", value: f.ready, tone: "tint-orange", icon: Trophy },
    { key: "review", label: "Проверить", value: f.review },
    { key: "noFact", label: "Без фактов", value: f.noFact },
    { key: "incomplete", label: "Неполные", value: f.incomplete },
    { key: "queued", label: "В скоринге", value: f.queued },
    ...(f.failed ? [{ key: "failed" as const, label: "Сбой скоринга", value: f.failed }] : []),
  ] : [];

  return (
    <div className="pt-2">
      <Link href="/hunt/search" className="inline-flex items-center gap-1.5 text-sm text-[var(--h-muted)] hover:text-[var(--h-text)]"><ArrowLeft className="h-4 w-4" /> Все поиски</Link>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight md:text-[32px] md:leading-[38px]">{data.category} · {data.city}</h1>
          <p className="mt-1 text-sm text-[var(--h-faint)]">Запущен {dayLabel(data.createdAt)} · цель {data.requested ?? "—"} компаний</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["queued", "running"].includes(data.status) ? (
            <Button variant="danger" size="sm" pending={busy} onClick={() => window.confirm("Остановить сбор? Уже найденное не сохранится, если парсер не успел отдать результат.") && act(() => post(`/api/parser/tasks/${data.id}/cancel`), "Сбор остановлен")}><Square className="h-3.5 w-3.5" /> Остановить</Button>
          ) : null}
          {!live ? <Button size="sm" pending={busy} onClick={again}><RotateCcw className="h-4 w-4" /> Повторить</Button> : null}
          {f?.queued || f?.failed ? <Button size="sm" pending={busy} onClick={() => act(() => post("/api/hunt/retry-failed"), "Сбои отправлены на повторный скоринг")}><RefreshCw className="h-4 w-4" /> Дожать скоринг</Button> : null}
          {!live ? <Button variant="ghost" size="sm" pending={busy} onClick={remove}><Trash2 className="h-4 w-4" /> Удалить</Button> : null}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* Главный счётчик: «очки» поиска */}
          <Glass className={cx("p-5 md:p-6", phase.index === 3 && "tint-green anim-pop", phase.failed && "border-[rgba(255,100,100,0.3)]")}>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--h-faint)]">найдено компаний</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-[56px] font-semibold leading-none tabular-nums md:text-[72px]">{found}</span>
                  {target ? <span className="text-xl text-[var(--h-faint)] tabular-nums">/ {target}</span> : null}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--h-faint)]">в отборе</div>
                <div className="mt-1 text-[40px] font-semibold leading-none tabular-nums text-[var(--h-accent)]">{f ? readyShown : "—"}</div>
              </div>
              <div className="ml-auto text-right">
                <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium", phase.failed ? "bg-[rgba(255,100,100,0.15)] text-[#ff9b9b]" : phase.index === 3 ? "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]" : "bg-[rgba(255,214,10,0.14)] text-[var(--h-accent)]")}>
                  {live ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{statusText(data)}
                </span>
                <div className="mt-1 text-xs text-[var(--h-faint)] tabular-nums">{percent}%{eta ? ` · осталось ${eta}` : ""}</div>
              </div>
            </div>
            <ProgressBar percent={percent} live={live} failed={phase.failed} className="mt-5" />
            <div className="mt-5"><PhaseTrack row={data} /></div>
            {data.stage ? <p className="mt-4 text-sm text-[var(--h-accent)]">{data.stage}</p> : null}
            {data.error ? <div className="mt-4"><Notice tone="error">{data.error}</Notice></div> : null}
            {extra.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
                {extra.map(([key, value]) => <span key={key} className="rounded-full bg-white/10 px-2.5 py-1 tabular-nums">{COUNTER_LABEL[key] ?? key} {value}</span>)}
              </div>
            ) : null}
          </Glass>

          {/* Итоги скоринга — плитки-фильтры */}
          {tiles.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button key={tile.key} onClick={() => setFilter(filter === tile.key ? "all" : tile.key)} className="text-left">
                    <div className={cx("glass rounded-2xl px-3.5 py-3 transition hover:bg-white/[0.07]", tile.value ? tile.tone : null, filter === tile.key && "ring-2 ring-[var(--h-accent)]")}>
                      <div className="flex items-center gap-1.5 text-[26px] font-semibold leading-8 tabular-nums">{Icon && tile.value ? <Icon className="h-5 w-5 text-[var(--h-accent)]" /> : null}{tile.value}</div>
                      <div className="mt-0.5 text-xs text-[var(--h-muted)]">{tile.label}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Результаты */}
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Найденные компании</h2>
              <span className="text-sm text-[var(--h-faint)] tabular-nums">{items.length}{filter !== "all" ? ` из ${data.items.length}` : ""}</span>
              <div className="flex-1" />
              {filter !== "all" ? <Chip onClick={() => setFilter("all")}>Показать все</Chip> : null}
              {f?.ready ? <Link href="/hunt" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--h-accent)] px-3.5 text-sm font-semibold text-[var(--h-accent-ink)]"><ListChecks className="h-4 w-4" /> В отбор</Link> : null}
            </div>
            {data.items.length === 0 ? (
              <Empty
                title={live ? "Компании появятся после сбора" : "Компаний нет"}
                text={live ? "Парсер собирает карточки с карт. Когда сбор закончится, они сохранятся сюда и сразу пойдут в скоринг — список будет заполняться на глазах." : (phase.failed && data.error ? data.error : "Парсер ничего не вернул. Нажмите «Повторить» — сбор уйдёт на другой сервер парсера.")}
              />
            ) : items.length === 0 ? <p className="text-sm text-[var(--h-muted)]">В этой группе пусто.</p> : (
              <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
                {items.map((item) => (
                  <button key={item.id} onClick={() => open("item", item.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.05]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{item.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--h-faint)]">
                        {item.city ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{item.city}</span> : null}
                        {item.reviewCount != null ? <span className="inline-flex items-center gap-1 tabular-nums"><Star className="h-3 w-3" />{item.rating ?? "—"} · {item.reviewCount}</span> : null}
                        <span className={cx(item.cardStatus === "ready" ? "text-[#8ff0bd]" : ["queued", "pending"].includes(item.cardStatus) ? "text-[var(--h-accent)]" : undefined)}>{CARD_LABEL[item.cardStatus] ?? item.cardStatus}</span>
                        {item.status !== "new" ? <span>{STATUS_LABEL[item.status] ?? item.status}</span> : null}
                      </div>
                    </div>
                    {["queued", "pending"].includes(item.cardStatus) ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--h-faint)]" /> : <PriorityBadge priority={item.priority} score={item.score} />}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          {/* Таблица — последнее звено цепочки */}
          <Glass className="p-4">
            <div className="flex items-center gap-2">
              <SheetIcon className="h-5 w-5 text-[#8ff0bd]" />
              <h3 className="font-semibold">Google Таблица</h3>
              <div className="flex-1" />
              {sheets.data?.pending ? <Loader2 className="h-4 w-4 animate-spin text-[var(--h-accent)]" /> : null}
            </div>
            {!sheets.data ? <p className="mt-2 text-sm text-[var(--h-muted)]">Загрузка…</p> : !sheets.data.configured ? (
              <p className="mt-2 text-sm text-[var(--h-muted)]">Не подключена. Подключите в настройках — карточки будут выгружаться сами.</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-[var(--h-muted)]">
                  В таблице <b className="text-[var(--h-text)] tabular-nums">{sheets.data.leads}</b> карточек{sheets.data.lastSyncAt ? ` · обновлено ${dayLabel(sheets.data.lastSyncAt)}` : ""}{sheets.data.pending ? ` · в очереди ${sheets.data.pending}` : ""}
                </p>
                {sheets.data.lastError ? <p className="mt-1 text-xs text-[#ff9b9b]">{sheets.data.lastError}</p> : null}
              </>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {sheets.data?.configured ? <Button size="sm" pending={busy} onClick={() => act(() => post("/api/hunt/sheets/sync"), "Полная выгрузка в таблицу поставлена в очередь")}><RefreshCw className="h-4 w-4" /> Выгрузить сейчас</Button> : null}
              <Button variant="ghost" size="sm" onClick={() => open("panel", "settings")}><ExternalLink className="h-4 w-4" /> Настройки</Button>
            </div>
          </Glass>

          {/* Лента событий */}
          <Glass className="p-4">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Что происходит</h3>
              {live ? <span className="flex items-center gap-1.5 text-xs text-[var(--h-accent)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--h-accent)]" />вживую</span> : null}
            </div>
            <ol className="mt-3 space-y-2.5">
              {feed.map((event, index) => (
                <li key={`${event.at.getTime()}-${index}`} className={cx("flex gap-2.5 text-sm", index === 0 && "anim-pop")}>
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", event.tone === "hot" ? "bg-[var(--h-accent)]" : event.tone === "ok" ? "bg-[var(--h-ok)]" : event.tone === "error" ? "bg-[var(--h-danger)]" : "bg-white/30")} />
                  <span className="min-w-0 flex-1">
                    <span className={cx(event.tone === "hot" && "font-semibold text-[var(--h-accent)]")}>{event.text}</span>
                    <span className="block text-[11px] text-[var(--h-faint)] tabular-nums">{clock(event.at)}</span>
                  </span>
                </li>
              ))}
            </ol>
            {live ? <p className="mt-3 text-xs text-[var(--h-faint)]">Экран обновляется каждые 3 секунды. Можно закрыть — поиск идёт на сервере.</p> : null}
          </Glass>
        </aside>
      </div>
    </div>
  );
}
