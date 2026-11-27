"use client";

import { useMemo, useState, type DragEvent } from "react";
import { ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight, Columns3, List, Plus } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { useScenarios } from "@/components/hunt/scenario-panel";
import { Button, Chip, Empty, Glass, Notice, PageHeader, Ring, SearchInput, Segmented, Skeleton, StatStrip, ViewSwitch, cx, errorText, useToast } from "@/components/hunt/ui";
import { PROJECT_STAGE_LABEL, dayLabel, rub, type Project } from "@/components/hunt/types";

type Tab = "projects" | "scenarios";
type View = "board" | "list" | "timeline";
type ProjectList = { items: Project[]; byStage: { key: string; label: string; count: number; amount: number }[] };

const STAGES = ["brief", "estimate", "prepaid", "in_work", "review", "done"] as const;
const STAGE_DOT: Record<string, string> = { brief: "bg-white/50", estimate: "bg-[var(--h-info)]", prepaid: "bg-[var(--h-accent)]", in_work: "bg-[var(--h-hot)]", review: "bg-[#c6a8ff]", done: "bg-[var(--h-ok)]", cancelled: "bg-[var(--h-danger)]" };
const DAY = 86400000;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function ProjectCard({ item, onOpen, compact }: { item: Project; onOpen: () => void; compact?: boolean }) {
  const overdue = item.deadlineAt && new Date(item.deadlineAt) < new Date() && item.stage !== "done";
  return (
    <button onClick={onOpen} className={cx("w-full rounded-2xl border border-[var(--h-line)] bg-white/[0.06] p-3 text-left transition hover:border-[var(--h-line-strong)] hover:bg-white/[0.1]", compact ? "" : "")}>
      <div className="truncate text-[14px] font-semibold">{item.organization?.name ?? item.title}</div>
      <div className="truncate text-[12px] text-[var(--h-muted)]">{item.scenarioTitle ?? item.product ?? item.title}</div>
      <div className="mt-2 text-[15px] font-semibold tabular-nums">{item.amount ? rub(item.amount) : <span className="text-[13px] font-normal text-[var(--h-faint)]">Без оценки</span>}</div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--h-faint)]">
        <span className="tabular-nums">{item.progress.done}/{item.progress.total}</span>
        <span className="h-1 flex-1 rounded-full bg-white/[0.08]"><span className="block h-1 rounded-full bg-[var(--h-accent)]" style={{ width: `${item.progress.total ? (item.progress.done / item.progress.total) * 100 : 0}%` }} /></span>
        {item.deadlineAt ? <span className={cx("tabular-nums", overdue && "text-[var(--h-hot)]")}>{new Date(item.deadlineAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span> : null}
      </div>
    </button>
  );
}

/** «Сроки»: диаграмма Ганта по дням — полоса от создания до дедлайна, сегодня подсвечено. */
function Timeline({ items, onOpen }: { items: Project[]; onOpen: (id: string) => void }) {
  const [offset, setOffset] = useState(0);
  const span = 14;
  const today = startOfDay(new Date());
  const from = new Date(today.getTime() + (offset - 3) * DAY);
  const days = Array.from({ length: span }, (_, index) => new Date(from.getTime() + index * DAY));
  const to = new Date(from.getTime() + span * DAY);
  const rows = items.filter((item) => item.stage !== "cancelled").sort((a, b) => new Date(a.deadlineAt ?? a.createdAt).getTime() - new Date(b.deadlineAt ?? b.createdAt).getTime());
  const fmt = (date: Date) => date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return (
    <Glass className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--h-line)] px-4 py-3">
        <button aria-label="Раньше" onClick={() => setOffset(offset - 7)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-[150px] text-center text-[14px] font-semibold">{fmt(from)} — {fmt(new Date(to.getTime() - DAY))}</span>
        <button aria-label="Позже" onClick={() => setOffset(offset + 7)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
        <Button size="sm" onClick={() => setOffset(0)} disabled={offset === 0}>Сегодня</Button>
        <span className="ml-auto text-[12px] text-[var(--h-faint)]">полоса — от создания до дедлайна</span>
      </div>
      <div className="no-scrollbar overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid border-b border-[var(--h-line)] text-[12px] text-[var(--h-faint)]" style={{ gridTemplateColumns: `240px repeat(${span}, minmax(0, 1fr))` }}>
            <div className="px-4 py-2">Проект / этап</div>
            {days.map((date) => {
              const isToday = date.getTime() === today.getTime();
              return <div key={date.toISOString()} className={cx("py-2 text-center tabular-nums", isToday && "rounded-t-lg bg-[var(--h-accent-soft)] font-semibold text-[var(--h-accent)]", [0, 6].includes(date.getDay()) && !isToday && "text-[var(--h-faint)]/60")}>{date.getDate()}</div>;
            })}
          </div>
          {rows.length === 0 ? <p className="px-4 py-6 text-sm text-[var(--h-muted)]">Нет проектов со сроками.</p> : rows.map((item) => {
            const start = startOfDay(new Date(item.createdAt)).getTime();
            const end = item.deadlineAt ? startOfDay(new Date(item.deadlineAt)).getTime() + DAY : start + DAY;
            const left = Math.max(0, (start - from.getTime()) / DAY);
            const right = Math.min(span, (end - from.getTime()) / DAY);
            const visible = right > 0 && left < span;
            const overdue = item.deadlineAt && new Date(item.deadlineAt) < new Date() && item.stage !== "done";
            return (
              <div key={item.id} className="grid items-center border-b border-[var(--h-line)] last:border-0 hover:bg-white/[0.03]" style={{ gridTemplateColumns: `240px repeat(${span}, minmax(0, 1fr))` }}>
                <button onClick={() => onOpen(item.id)} className="min-w-0 px-4 py-2.5 text-left">
                  <div className="truncate text-[14px] font-semibold">{item.organization?.name ?? item.title}</div>
                  <div className="flex items-center gap-1.5 truncate text-[12px] text-[var(--h-muted)]"><span className={cx("h-1.5 w-1.5 rounded-full", STAGE_DOT[item.stage])} />{PROJECT_STAGE_LABEL[item.stage]} · {rub(item.amount)}</div>
                </button>
                <div className="relative h-11" style={{ gridColumn: `2 / span ${span}` }}>
                  <div className="absolute inset-y-0" style={{ left: `${((today.getTime() - from.getTime()) / DAY / span) * 100}%`, width: `${100 / span}%` }}><div className="h-full bg-[var(--h-accent-soft)]" /></div>
                  {visible ? (
                    <button
                      onClick={() => onOpen(item.id)}
                      className={cx("absolute top-2 flex h-7 items-center truncate rounded-full px-3 text-[12px] font-medium transition hover:brightness-110", item.stage === "done" ? "bg-[rgba(116,224,168,0.5)] text-[#0d2a1b]" : overdue ? "bg-[rgba(255,145,87,0.75)] text-[#2b1205]" : ["brief", "estimate"].includes(item.stage) ? "border border-[var(--h-line-strong)] bg-white/[0.12] text-[var(--h-text)]" : "bg-[var(--h-accent)] text-[var(--h-accent-ink)]")}
                      style={{ left: `calc(${(left / span) * 100}% + 2px)`, width: `calc(${((right - left) / span) * 100}% - 4px)` }}
                      title={`${new Date(item.createdAt).toLocaleDateString("ru-RU")} → ${item.deadlineAt ? new Date(item.deadlineAt).toLocaleDateString("ru-RU") : "без срока"}`}
                    >
                      {item.deadlineAt ? `до ${new Date(item.deadlineAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}` : "без срока"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Glass>
  );
}

export default function HuntProjectsPage() {
  const { version, open, refresh } = useHunt();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("projects");
  const [view, setView] = useState<View>("board");
  const [stage, setStage] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dragging, setDragging] = useState<Project | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const projects = useLive<ProjectList>("/api/hunt/projects", version);
  const scenarios = useScenarios();
  const needle = q.trim().toLowerCase();
  const all = (projects.data?.items ?? []).filter((item) => !needle || `${item.title} ${item.organization?.name ?? ""} ${item.product ?? ""}`.toLowerCase().includes(needle));
  const items = all.filter((item) => (stage ? item.stage === stage : item.stage !== "cancelled"));
  const byStage = projects.data?.byStage ?? [];
  const sum = (keys: string[]) => byStage.filter((item) => keys.includes(item.key)).reduce((total, item) => total + item.amount, 0);
  const pipeline = sum(["brief", "estimate", "prepaid", "in_work", "review"]);
  const confirmed = sum(["prepaid", "in_work", "review", "done"]);
  const soon = useMemo(() => (projects.data?.items ?? []).filter((item) => item.deadlineAt && item.stage !== "done" && item.stage !== "cancelled" && new Date(item.deadlineAt).getTime() - Date.now() < 3 * DAY).length, [projects.data]);

  async function moveStage(item: Project, next: string) {
    if (item.stage === next) return;
    const before = item.stage;
    try {
      await post(`/api/hunt/projects/${item.id}`, { stage: next }, "PATCH");
      toast({ text: `«${item.organization?.name ?? item.title}» → ${PROJECT_STAGE_LABEL[next]}`, action: { label: "Вернуть", run: () => { void post(`/api/hunt/projects/${item.id}`, { stage: before }, "PATCH").then(refresh); } } });
      refresh();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    }
  }

  return (
    <div>
      <PageHeader
        title="Проекты"
        subtitle="сделки, этапы и сроки"
        actions={tab === "projects" ? <ViewSwitch<View> value={view} onChange={setView} items={[{ key: "board", label: "Доска", icon: <Columns3 className="h-4 w-4" /> }, { key: "list", label: "Список", icon: <List className="h-4 w-4" /> }, { key: "timeline", label: "Сроки", icon: <CalendarRange className="h-4 w-4" /> }]} /> : null}
      />

      {projects.data ? (
        <div className="mt-5">
          <StatStrip items={[
            { label: "в работе", value: rub(pipeline), sub: `${items.filter((item) => item.stage !== "done").length} проектов` },
            { label: "с авансом", value: rub(confirmed), tone: confirmed ? "ok" : null },
            { label: "сдать за 3 дня", value: soon, tone: soon ? "hot" : null, onClick: () => setView("timeline"), active: view === "timeline" },
            { label: "готово", value: byStage.find((item) => item.key === "done")?.count ?? 0, sub: rub(sum(["done"])), onClick: () => { setView("list"); setStage("done"); }, active: stage === "done" },
          ]} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
        <Segmented<Tab> className="md:w-[360px]" value={tab} onChange={setTab} items={[{ key: "projects", label: "Проекты", count: projects.data?.items.length }, { key: "scenarios", label: "Сценарии ниш", count: scenarios.data?.scenarios.length }]} />
        {tab === "projects" ? <SearchInput value={q} onChange={setQ} placeholder="Найти проект" className="md:ml-auto md:w-64" /> : null}
      </div>

      {tab === "projects" ? (
        projects.error ? <div className="mt-4"><Notice tone="error">{projects.error}</Notice></div> : !projects.data ? <div className="mt-4"><Skeleton rows={3} /></div> : projects.data.items.length === 0 ? (
          <div className="mt-4"><Empty title="Проектов пока нет" text="Проект создаётся сам, когда лид доходит до «Сметы» или «Сделки». Или выберите сценарий ниши и создайте вручную." action={<Button variant="accent" onClick={() => setTab("scenarios")}><Plus className="h-4 w-4" /> Создать из сценария</Button>} /></div>
        ) : view === "board" ? (
          <div className="board-scroll no-scrollbar -mx-4 mt-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
            {STAGES.map((key) => {
              const list = all.filter((item) => item.stage === key);
              const amount = list.reduce((total, item) => total + (item.amount ?? 0), 0);
              return (
                <section
                  key={key}
                  aria-label={PROJECT_STAGE_LABEL[key]}
                  onDragOver={(event: DragEvent) => { if (dragging && dragging.stage !== key) { event.preventDefault(); setOver(key); } }}
                  onDragLeave={() => setOver((value) => (value === key ? null : value))}
                  onDrop={(event: DragEvent) => { event.preventDefault(); setOver(null); if (dragging) void moveStage(dragging, key); setDragging(null); }}
                  className={cx("glass flex min-h-[260px] w-[78vw] shrink-0 flex-col rounded-[var(--h-radius)] p-2 transition sm:w-[250px] xl:w-auto xl:min-w-[172px] xl:flex-1 xl:shrink", over === key && "bg-[var(--h-accent-soft)] ring-1 ring-[var(--h-accent)]/50")}
                >
                  <header className="px-2 pb-2 pt-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cx("h-2 w-2 rounded-full", STAGE_DOT[key])} />
                      <h3 className="flex-1 text-[14px] font-semibold">{PROJECT_STAGE_LABEL[key]}</h3>
                      <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/[0.1] px-1.5 text-[12px] font-semibold tabular-nums">{list.length}</span>
                    </div>
                    <p className="mt-0.5 pl-4 text-[12px] tabular-nums text-[var(--h-faint)]">{amount ? rub(amount) : "Без оценки"}</p>
                  </header>
                  <div className="space-y-2">
                    {list.length === 0 ? <div className="grid h-20 place-items-center rounded-2xl border border-dashed border-[var(--h-line)] text-[12px] text-[var(--h-faint)]">{dragging ? "Отпустите здесь" : "Пусто"}</div> : null}
                    {list.map((item) => (
                      <div key={item.id} draggable onDragStart={(event: DragEvent) => { event.dataTransfer.effectAllowed = "move"; setDragging(item); }} onDragEnd={() => { setDragging(null); setOver(null); }}>
                        <ProjectCard item={item} onOpen={() => open("project", item.id)} />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : view === "timeline" ? (
          <div className="mt-4"><Timeline items={all} onOpen={(id) => open("project", id)} /></div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
              <Chip active={!stage} onClick={() => setStage(null)}>Все</Chip>
              {byStage.filter((item) => item.count).map((item) => (
                <Chip key={item.key} active={stage === item.key} onClick={() => setStage(stage === item.key ? null : item.key)}><span className={cx("h-1.5 w-1.5 rounded-full", STAGE_DOT[item.key])} />{item.label} <span className="tabular-nums opacity-60">{item.count}</span></Chip>
              ))}
            </div>
            {items.length === 0 ? <Empty title="Ничего не нашлось" text="Сбросьте этап или поиск." /> : (
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((item) => (
                  <button key={item.id} onClick={() => open("project", item.id)} className="w-full text-left">
                    <Glass className="flex items-center gap-4 px-4 py-4 transition hover:bg-white/[0.08]">
                      <Ring done={item.progress.done} total={item.progress.total} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-1 text-[16px] font-semibold leading-6">{item.title}</div>
                        <div className="mt-0.5 truncate text-[13px] text-[var(--h-muted)]">{[item.scenarioTitle ?? item.product, item.organization?.city].filter(Boolean).join(" · ")}</div>
                        <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 font-medium"><span className={cx("h-1.5 w-1.5 rounded-full", STAGE_DOT[item.stage])} />{PROJECT_STAGE_LABEL[item.stage]}</span>
                          <span className="text-[var(--h-faint)]">обновлён {dayLabel(item.updatedAt)}</span>
                        </div>
                      </div>
                      <div className="text-right text-[15px] font-semibold tabular-nums">{rub(item.amount)}</div>
                    </Glass>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="mt-4">
          {scenarios.error ? <Notice tone="error">{scenarios.error}</Notice> : !scenarios.data ? <Skeleton rows={4} /> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {scenarios.data.scenarios.map((item, index) => (
                <button key={item.id} onClick={() => open("scenario", item.id)} className={cx("text-left", index === 0 && "col-span-2 sm:col-span-1")}>
                  <Glass tint={item.tone} className="flex h-full min-h-[148px] flex-col p-4 transition hover:brightness-125">
                    <div className="flex items-start justify-between">
                      <span className="text-xs font-semibold tabular-nums text-[var(--h-muted)]">{item.id}</span>
                      <ArrowUpRight className="h-4 w-4 text-[var(--h-faint)]" />
                    </div>
                    <div className="mt-auto pt-6">
                      <div className="text-[16px] font-semibold leading-6">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-[var(--h-muted)]">{item.product}</div>
                      <div className="mt-2 text-sm font-semibold tabular-nums">от {rub(item.priceFrom)}</div>
                    </div>
                  </Glass>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
