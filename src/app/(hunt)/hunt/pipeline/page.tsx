"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, BarChart3, Columns3, ExternalLink, Globe, List, Loader2, SlidersHorizontal } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { Chip, Empty, Glass, Notice, PageHeader, PriorityBadge, SearchInput, Skeleton, ViewSwitch, cx, errorText, selectClass, useToast } from "@/components/hunt/ui";
import { FunnelBoard } from "@/components/hunt/funnel-board";
import { STATUS_LABEL, dayLabel } from "@/components/hunt/types";

type Step = { key: string; label: string; hint: string; count: number };
type Row = {
  id: string;
  organization: { id: string; name: string; city: string | null; category: string | null };
  segmentLabel: string | null;
  priority: string;
  score: number;
  status: string;
  channel: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  nextAt: string | null;
  overdue: boolean;
  rejectReason: string | null;
  demo: { status: string; url: string | null } | null;
  proposal: boolean;
  project: { id: string; stage: string; amount: number | null } | null;
};
type Pipeline = {
  step: string;
  steps: Step[];
  items: Row[];
  columns: { key: string; items: Row[] }[] | null;
  filters: { segments: { id: string; label: string; count: number }[]; cities: { city: string; count: number }[] };
};
type View = "board" | "list" | "numbers";

const CHANNEL: Record<string, string> = { telegram: "Telegram", max: "MAX", whatsapp: "WhatsApp", vk: "VK", email: "Почта", phone: "Звонок", instagram: "Instagram", avito: "Авито", other: "Другое" };
const DEMO_LABEL: Record<string, string> = {
  queued: "демо в очереди",
  building: "демо собирается",
  waiting_user: "агент ждёт ответа",
  preview_ready: "демо готово",
  published: "демо опубликовано",
  publish_requested: "публикуется",
  failed: "демо: ошибка",
};
/** Куда можно перетащить карточку: колонка → статус и из каких статусов туда пускает сервер (зеркало STATUS_FLOW в services/hunt). */
const DROP: Record<string, { status: string; from: string[] }> = {
  replied: { status: "replied", from: ["sent", "sleeping", "lost"] },
  demo: { status: "demo", from: ["replied"] },
  call: { status: "call", from: ["replied", "demo", "estimate"] },
  estimate: { status: "estimate", from: ["call"] },
  won: { status: "won", from: ["call", "estimate"] },
  lost: { status: "lost", from: ["sent", "replied", "demo", "call", "estimate", "sleeping"] },
};
const COLUMN_OF: Record<string, string> = { new: "found", snoozed: "found", approved: "approved", sent: "sent", sleeping: "sent", replied: "replied", demo: "demo", call: "call", estimate: "estimate", won: "won", rejected: "lost", lost: "lost" };
const NEXT: Record<string, string> = { replied: "demo", demo: "call", call: "estimate", estimate: "won" };
const DOT: Record<string, string> = { found: "bg-white/50", approved: "bg-[var(--h-info)]", sent: "bg-[var(--h-accent)]", replied: "bg-[var(--h-ok)]", demo: "bg-[var(--h-ok)]", call: "bg-[var(--h-ok)]", estimate: "bg-[var(--h-hot)]", won: "bg-[var(--h-ok)]", lost: "bg-[var(--h-danger)]" };

function canDrop(column: string, status: string) {
  const rule = DROP[column];
  return Boolean(rule && rule.from.includes(status));
}

function Chips({ row }: { row: Row }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
      {row.channel ? <span className="rounded-full bg-white/10 px-2 py-0.5">{CHANNEL[row.channel] ?? row.channel}</span> : null}
      {row.nextAt ? <span className={cx("rounded-full px-2 py-0.5", row.overdue ? "bg-[rgba(255,145,87,0.18)] text-[#ffc8a8]" : "bg-white/10")}>{row.overdue ? "пора " : "след. "}{dayLabel(row.nextAt)}</span> : row.sentAt ? <span className="rounded-full bg-white/10 px-2 py-0.5">написали {dayLabel(row.sentAt)}</span> : null}
      {row.demo ? (
        <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5", row.demo.status === "published" ? "bg-[rgba(116,224,168,0.14)] text-[#a6efc8]" : row.demo.status === "failed" ? "bg-[rgba(255,123,123,0.14)] text-[#ffadad]" : "bg-[rgba(156,195,255,0.16)] text-[#bcd5ff]")}>
          {["queued", "building", "publish_requested"].includes(row.demo.status) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
          {DEMO_LABEL[row.demo.status] ?? `демо: ${row.demo.status}`}
        </span>
      ) : null}
      {row.proposal ? <span className="rounded-full bg-white/10 px-2 py-0.5">КП</span> : null}
      {row.rejectReason ? <span className="max-w-full truncate rounded-full bg-white/10 px-2 py-0.5">{row.rejectReason}</span> : null}
    </div>
  );
}

export default function HuntPipelinePage() {
  const { version, open, refresh } = useHunt();
  const toast = useToast();
  const params = useSearchParams();
  const [view, setView] = useState<View>("board");
  const [step, setStep] = useState<string | null>(params.get("step"));
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [priority, setPriority] = useState("");
  const [channel, setChannel] = useState("");
  const [demo, setDemo] = useState("");
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [dragging, setDragging] = useState<Row | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});

  // Пришли по ссылке «?step=…» (из мини-воронки) — сразу список этого шага.
  useEffect(() => {
    const fromLink = params.get("step");
    if (fromLink) { setStep(fromLink); setView("list"); }
  }, [params]);

  const filterParams = useMemo(() => {
    const next = new URLSearchParams();
    if (segment) next.set("segment", segment);
    if (city) next.set("city", city);
    if (priority) next.set("priority", priority);
    if (channel) next.set("channel", channel);
    if (demo) next.set("demo", demo);
    if (q.trim().length >= 2) next.set("q", q.trim());
    return next;
  }, [segment, city, priority, channel, demo, q]);
  const url = useMemo(() => {
    const next = new URLSearchParams(filterParams);
    if (view === "board") next.set("board", "1");
    else if (step) next.set("step", step);
    return `/api/hunt/pipeline?${next}`;
  }, [filterParams, view, step]);
  // Демо собирается в фоне — тихо обновляем, чтобы статусы менялись без перезагрузки.
  const live = useLive<Pipeline>(view === "numbers" ? null : url, version, 20000);
  const data = live.data;
  useEffect(() => { setMoved({}); }, [data]);
  const current = data?.steps.find((item) => item.key === (step ?? data.step)) ?? null;
  const filtered = Boolean(segment || city || priority || channel || demo || q.trim());
  const activeFilters = [segment, city, priority, channel, demo].filter(Boolean).length;

  async function move(row: Row, column: string) {
    const rule = DROP[column];
    if (!rule) return;
    if (!rule.from.includes(row.status)) {
      toast({ text: `«${STATUS_LABEL[row.status] ?? row.status}» → «${data?.steps.find((item) => item.key === column)?.label}» нельзя: так шаги не идут`, tone: "error" });
      return;
    }
    const before = row.status;
    setMoved((prev) => ({ ...prev, [row.id]: column }));
    try {
      await post(`/api/hunt/${row.id}/status`, { status: rule.status });
      const back = COLUMN_OF[before];
      const undo = back && canDrop(back, rule.status) ? { label: "Вернуть", run: () => { void post(`/api/hunt/${row.id}/status`, { status: DROP[back].status }).then(refresh).catch((reason) => toast({ text: errorText(reason), tone: "error" })); } } : undefined;
      toast({ text: `«${row.organization.name}» → ${data?.steps.find((item) => item.key === column)?.label}`, action: undo });
      refresh();
    } catch (reason) {
      setMoved((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
      toast({ text: errorText(reason), tone: "error" });
    }
  }

  const resetFilters = () => { setSegment(""); setCity(""); setPriority(""); setChannel(""); setDemo(""); setQ(""); };

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex w-full gap-2 sm:w-auto">
        <SearchInput value={q} onChange={setQ} placeholder="Найти лид" className="flex-1 sm:w-56" />
        <button onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters} className={cx("glass inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm md:hidden", activeFilters > 0 && "tint-yellow")}>
          <SlidersHorizontal className="h-4 w-4" /> Фильтры{activeFilters ? ` · ${activeFilters}` : ""}
        </button>
      </div>
      <div className={cx("flex flex-wrap items-center gap-2", !showFilters && "max-md:hidden")}>
      <select value={segment} onChange={(event) => setSegment(event.target.value)} className={selectClass} aria-label="Ниша">
        <option value="">Все ниши</option>
        {data?.filters.segments.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.count}</option>)}
      </select>
      <select value={city} onChange={(event) => setCity(event.target.value)} className={selectClass} aria-label="Город">
        <option value="">Все города</option>
        {data?.filters.cities.map((item) => <option key={item.city} value={item.city}>{item.city} · {item.count}</option>)}
      </select>
      <select value={channel} onChange={(event) => setChannel(event.target.value)} className={selectClass} aria-label="Канал">
        <option value="">Любой канал</option>
        {Object.entries(CHANNEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <select value={demo} onChange={(event) => setDemo(event.target.value)} className={selectClass} aria-label="Демо-сайт">
        <option value="">Демо: любое</option>
        <option value="yes">Есть демо</option>
        <option value="published">Демо опубликовано</option>
        <option value="no">Без демо</option>
      </select>
      <div className="flex gap-1.5">
        {["A", "B", "C"].map((item) => <Chip key={item} active={priority === item} onClick={() => setPriority(priority === item ? "" : item)}>{item}</Chip>)}
      </div>
      </div>
      {filtered ? <button className="h-8 rounded-full px-3 text-[13px] text-[var(--h-muted)] hover:bg-white/[0.07] hover:text-[var(--h-text)]" onClick={resetFilters}>Сбросить</button> : null}
      <span className="ml-auto text-[13px] text-[var(--h-faint)] max-sm:hidden">{data ? `Всего ${data.steps.reduce((sum, item) => sum + item.count, 0)}` : ""}</span>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Воронка"
        subtitle="весь цикл лида · шаг 4 из 4"
        actions={<ViewSwitch<View> value={view} onChange={setView} items={[{ key: "board", label: "Доска", icon: <Columns3 className="h-4 w-4" /> }, { key: "list", label: "Список", icon: <List className="h-4 w-4" /> }, { key: "numbers", label: "Цифры", icon: <BarChart3 className="h-4 w-4" /> }]} />}
      />

      {view === "numbers" ? <div className="mt-5"><FunnelBoard version={version} /></div> : (
        <>
          <div className="mt-5">{filterBar}</div>

          {view === "board" ? (
            <div className="mt-4">
              {live.error ? <Notice tone="error">{live.error}</Notice> : !data?.columns ? <Skeleton rows={3} /> : (
                <>
                  <p className="mb-3 px-1 text-[13px] text-[var(--h-faint)] md:hidden">Кнопка со стрелкой на карточке переносит лид на следующий шаг. Колонки листаются вбок.</p>
                  <p className="mb-3 px-1 text-[13px] text-[var(--h-faint)] max-md:hidden">Перетащите карточку в следующую колонку — статус сменится, проект на «Смете» и «Сделке» создастся сам. Найденных и «Написать» ведите из карточки.</p>
                  <div className="board-scroll no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
                    {data.steps.map((col) => {
                      const items = [
                        ...data.columns!.flatMap((item) => item.items).filter((row) => moved[row.id] === col.key),
                        ...(data.columns!.find((item) => item.key === col.key)?.items ?? []).filter((row) => !moved[row.id]),
                      ];
                      const droppable = dragging ? canDrop(col.key, dragging.status) : false;
                      const amount = items.reduce((sum, row) => sum + (row.project?.amount ?? 0), 0);
                      return (
                        <section
                          key={col.key}
                          aria-label={col.label}
                          onDragOver={(event: DragEvent) => { if (droppable) { event.preventDefault(); setOver(col.key); } }}
                          onDragLeave={() => setOver((value) => (value === col.key ? null : value))}
                          onDrop={(event: DragEvent) => { event.preventDefault(); setOver(null); if (dragging) void move(dragging, col.key); setDragging(null); }}
                          className={cx(
                            "glass flex max-h-[calc(100dvh-260px)] min-h-[320px] w-[80vw] shrink-0 flex-col rounded-[var(--h-radius)] p-2 transition sm:w-[290px]",
                            dragging && !droppable && "opacity-45",
                            droppable && "ring-1 ring-[var(--h-accent)]/50",
                            over === col.key && "bg-[var(--h-accent-soft)]",
                          )}
                        >
                          <header className="px-2 pb-2 pt-1.5" title={col.hint}>
                            <div className="flex items-center gap-2">
                              <span className={cx("h-2 w-2 rounded-full", DOT[col.key])} />
                              <h3 className="flex-1 truncate text-[14px] font-semibold">{col.label}</h3>
                              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/[0.1] px-1.5 text-[12px] font-semibold tabular-nums">{col.count}</span>
                            </div>
                            <p className="mt-0.5 truncate pl-4 text-[12px] text-[var(--h-faint)]">{amount ? `${amount.toLocaleString("ru-RU")} ₽` : col.hint}</p>
                          </header>
                          <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto">
                            {items.length === 0 ? <div className="grid h-24 place-items-center rounded-2xl border border-dashed border-[var(--h-line)] text-[12px] text-[var(--h-faint)]">{droppable ? "Отпустите здесь" : "Пусто"}</div> : null}
                            {items.map((row) => (
                              <article
                                key={row.id}
                                draggable
                                onDragStart={(event: DragEvent) => { event.dataTransfer.effectAllowed = "move"; setDragging(row); }}
                                onDragEnd={() => { setDragging(null); setOver(null); }}
                                onClick={() => open("item", row.id)}
                                className={cx("group cursor-pointer rounded-2xl border border-[var(--h-line)] bg-white/[0.06] p-3 transition hover:border-[var(--h-line-strong)] hover:bg-white/[0.1] active:cursor-grabbing", row.overdue && "border-[rgba(255,145,87,0.4)]")}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-[14px] font-semibold">{row.organization.name}</div>
                                    <div className="truncate text-[12px] text-[var(--h-muted)]">{[row.segmentLabel ?? row.organization.category, row.organization.city].filter(Boolean).join(" · ")}</div>
                                  </div>
                                  <PriorityBadge priority={row.priority} score={row.score} />
                                </div>
                                {row.project?.amount ? <div className="mt-1.5 text-[15px] font-semibold tabular-nums">{row.project.amount.toLocaleString("ru-RU")} ₽</div> : null}
                                <Chips row={row} />
                                {NEXT[col.key] ? (
                                  <button
                                    onClick={(event) => { event.stopPropagation(); void move(row, NEXT[col.key]); }}
                                    className="mt-2 inline-flex h-7 items-center gap-1 rounded-full bg-white/[0.08] px-2.5 text-[12px] text-[var(--h-muted)] transition hover:bg-[var(--h-accent)] hover:text-[var(--h-accent-ink)] md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                                  >
                                    {data.steps.find((item) => item.key === NEXT[col.key])?.label} <ArrowRight className="h-3 w-3" />
                                  </button>
                                ) : null}
                              </article>
                            ))}
                            {col.count > items.length && !Object.keys(moved).length ? (
                              <button onClick={() => { setStep(col.key); setView("list"); }} className="w-full rounded-2xl py-2 text-[12px] text-[var(--h-muted)] hover:bg-white/[0.06]">Ещё {col.count - items.length} — открыть списком</button>
                            ) : null}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
                {(data?.steps ?? []).map((item, index) => (
                  <button
                    key={item.key}
                    onClick={() => setStep(item.key)}
                    className={cx(
                      "flex min-w-[112px] shrink-0 flex-col items-start rounded-2xl border px-3.5 py-2.5 text-left transition",
                      data?.step === item.key ? "tint-yellow ring-1 ring-[var(--h-accent)]" : "glass hover:bg-white/[0.06]",
                      item.key === "lost" && "opacity-75",
                    )}
                  >
                    <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--h-faint)]">{item.key === "lost" ? "итог" : `шаг ${index + 1}`}</span>
                    <span className="text-[14px] font-medium">{item.label}</span>
                    <span className="text-2xl font-semibold tabular-nums leading-8">{item.count}</span>
                  </button>
                ))}
                {!data ? <div className="h-[92px] w-full"><Skeleton rows={1} /></div> : null}
              </div>

              {current ? <p className="mt-4 px-1 text-sm text-[var(--h-muted)]"><b className="font-semibold text-[var(--h-text)]">{current.label}:</b> {current.hint}</p> : null}

              <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {live.error ? <div className="md:col-span-2 2xl:col-span-3"><Notice tone="error">{live.error}</Notice></div> : !data ? <div className="md:col-span-2 2xl:col-span-3"><Skeleton rows={4} /></div> : data.items.length === 0 ? (
                  <div className="md:col-span-2 2xl:col-span-3"><Empty title="На этом шаге пусто" text={filtered ? "С такими фильтрами лидов нет — сбросьте часть фильтров." : "Лиды появятся здесь, когда дойдут до этого шага."} /></div>
                ) : data.items.map((row) => (
                  <Glass key={row.id} className="cursor-pointer p-4 transition hover:bg-white/[0.08]" onClick={() => open("item", row.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[16px] font-semibold">{row.organization.name}</div>
                        <div className="truncate text-[13px] text-[var(--h-muted)]">{[row.organization.city, row.segmentLabel ?? row.organization.category].filter(Boolean).join(" · ")}</div>
                      </div>
                      <PriorityBadge priority={row.priority} score={row.score} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px]"><span className="rounded-full bg-white/10 px-2 py-0.5">{STATUS_LABEL[row.status] ?? row.status}</span>{row.project?.amount ? <span className="rounded-full bg-[var(--h-accent-soft)] px-2 py-0.5">{row.project.amount.toLocaleString("ru-RU")} ₽</span> : null}</div>
                    <Chips row={row} />
                    {row.demo?.url ? (
                      <a href={row.demo.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--h-accent)]">
                        Открыть демо <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </Glass>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
