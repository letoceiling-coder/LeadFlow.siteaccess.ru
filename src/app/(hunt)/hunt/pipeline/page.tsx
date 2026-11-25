"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Globe, Loader2, Search } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { useLive } from "@/components/hunt/data";
import { Chip, Empty, Glass, Notice, PriorityBadge, Skeleton, cx } from "@/components/hunt/ui";
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
  filters: { segments: { id: string; label: string; count: number }[]; cities: { city: string; count: number }[] };
};

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
const selectClass = "[color-scheme:dark] h-10 rounded-full border border-[var(--h-line)] bg-white/[0.04] px-3.5 text-sm outline-none focus:border-[var(--h-accent)]";

export default function HuntPipelinePage() {
  const { version, open } = useHunt();
  const [step, setStep] = useState<string | null>(null);
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [priority, setPriority] = useState("");
  const [channel, setChannel] = useState("");
  const [demo, setDemo] = useState("");
  const [q, setQ] = useState("");

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (step) params.set("step", step);
    if (segment) params.set("segment", segment);
    if (city) params.set("city", city);
    if (priority) params.set("priority", priority);
    if (channel) params.set("channel", channel);
    if (demo) params.set("demo", demo);
    if (q.trim().length >= 2) params.set("q", q.trim());
    return `/api/hunt/pipeline?${params}`;
  }, [step, segment, city, priority, channel, demo, q]);
  // Демо собирается в фоне — тихо обновляем, чтобы статусы менялись без перезагрузки.
  const live = useLive<Pipeline>(url, version, 20000);
  const data = live.data;
  const current = data?.steps.find((item) => item.key === data.step) ?? null;
  const filtered = Boolean(segment || city || priority || channel || demo || q.trim());

  return (
    <div className="pt-2">
      <p className="text-sm text-[var(--h-faint)]">Весь цикл</p>
      <h1 className="mt-1 text-[32px] font-semibold leading-[38px] tracking-tight">Воронка</h1>
      <p className="mt-1 text-[15px] text-[var(--h-muted)]">От находки парсером до сделки. Нажмите шаг — внизу лиды на нём, карточка открывается с действиями.</p>

      <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1">
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
            <span className="text-[15px] font-medium">{item.label}</span>
            <span className="text-2xl font-semibold tabular-nums leading-8">{item.count}</span>
          </button>
        ))}
        {!data ? <div className="h-[92px] w-full"><Skeleton rows={1} /></div> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--h-faint)]" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Название" className={cx(selectClass, "w-44 pl-9")} aria-label="Поиск по названию" />
        </label>
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
        {filtered ? <button className="text-sm text-[var(--h-muted)] underline-offset-4 hover:underline" onClick={() => { setSegment(""); setCity(""); setPriority(""); setChannel(""); setDemo(""); setQ(""); }}>Сбросить</button> : null}
      </div>

      {current ? <p className="mt-4 text-sm text-[var(--h-muted)]"><b className="font-semibold text-[var(--h-text)]">{current.label}:</b> {current.hint}</p> : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {live.error ? <div className="lg:col-span-2"><Notice tone="error">{live.error}</Notice></div> : !data ? <div className="lg:col-span-2"><Skeleton rows={4} /></div> : data.items.length === 0 ? (
          <div className="lg:col-span-2"><Empty title="На этом шаге пусто" text={filtered ? "С такими фильтрами лидов нет — сбросьте часть фильтров." : "Лиды появятся здесь, когда дойдут до этого шага."} /></div>
        ) : data.items.map((row) => (
          <Glass key={row.id} className="cursor-pointer p-4 transition hover:bg-white/[0.06]" onClick={() => open("item", row.id)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[17px] font-semibold">{row.organization.name}</div>
                <div className="truncate text-sm text-[var(--h-muted)]">{[row.organization.city, row.segmentLabel ?? row.organization.category].filter(Boolean).join(" · ")}</div>
              </div>
              <PriorityBadge priority={row.priority} score={row.score} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-full bg-white/10 px-2 py-0.5">{STATUS_LABEL[row.status] ?? row.status}</span>
              {row.channel ? <span className="rounded-full bg-white/10 px-2 py-0.5">{CHANNEL[row.channel] ?? row.channel}</span> : null}
              {row.sentAt ? <span className="rounded-full bg-white/10 px-2 py-0.5">написали {dayLabel(row.sentAt)}</span> : null}
              {row.nextAt ? <span className={cx("rounded-full px-2 py-0.5", row.overdue ? "bg-[rgba(255,120,60,0.18)] text-[#ffc3a6]" : "bg-white/10")}>{row.overdue ? "пора: " : "след. шаг "}{dayLabel(row.nextAt)}</span> : null}
              {row.demo ? (
                <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5", row.demo.status === "published" ? "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]" : row.demo.status === "failed" ? "bg-[rgba(255,100,100,0.14)] text-[#ff9b9b]" : "bg-[rgba(90,160,255,0.16)] text-[#a9c8ff]")}>
                  {["queued", "building", "publish_requested"].includes(row.demo.status) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                  {DEMO_LABEL[row.demo.status] ?? `демо: ${row.demo.status}`}
                </span>
              ) : null}
              {row.proposal ? <span className="rounded-full bg-white/10 px-2 py-0.5">КП</span> : null}
              {row.project?.amount ? <span className="rounded-full bg-[rgba(255,214,10,0.16)] px-2 py-0.5">{row.project.amount.toLocaleString("ru-RU")} ₽</span> : null}
              {row.rejectReason ? <span className="rounded-full bg-white/10 px-2 py-0.5">{row.rejectReason}</span> : null}
            </div>
            {row.demo?.url ? (
              <a href={row.demo.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--h-accent)]">
                Открыть демо <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </Glass>
        ))}
      </div>
    </div>
  );
}
