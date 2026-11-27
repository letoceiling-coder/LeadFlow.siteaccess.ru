"use client";

import { useMemo, useState } from "react";
import { useHunt } from "@/components/hunt/shell";
import { useLive } from "@/components/hunt/data";
import { ItemCard } from "@/components/hunt/item-card";
import { Chip, Empty, Notice, PageHeader, SearchInput, Segmented, Skeleton, StatStrip } from "@/components/hunt/ui";
import { STATUS_LABEL, dayLabel, type Dialogs, type HuntItem } from "@/components/hunt/types";

type Tab = "active" | "waiting" | "closed";

export default function HuntDialogsPage() {
  const { version, open } = useHunt();
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<string | null>(null);
  const dialogs = useLive<Dialogs>("/api/hunt/dialogs", version);
  const data = dialogs.data;

  const raw: Record<Tab, HuntItem[]> = { active: data?.active ?? [], waiting: [...(data?.due ?? []), ...(data?.waiting ?? [])], closed: data?.closed ?? [] };
  const segments = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of raw[tab]) { const label = item.presetLabel ?? item.segmentLabel; const key = item.preset ?? item.segment; if (key && label) map.set(key, label); }
    return [...map.entries()];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab]);
  const needle = q.trim().toLowerCase();
  const filter = (items: HuntItem[]) => items.filter((item) => (!needle || `${item.organization.name} ${item.organization.city ?? ""}`.toLowerCase().includes(needle)) && (!segment || (item.preset ?? item.segment) === segment));
  const list: Record<Tab, HuntItem[]> = { active: filter(raw.active), waiting: filter(raw.waiting), closed: filter(raw.closed) };
  const empty: Record<Tab, string> = {
    active: "Когда клиент ответит, отметьте «Ответил» в карточке — диалог появится здесь, дальше созвон, смета и сделка.",
    waiting: "Здесь те, кому вы уже написали. Через 3, 7 и 14 дней без ответа появится напоминание.",
    closed: "Сделки, отказы и «спящие» после трёх напоминаний.",
  };

  return (
    <div>
      <PageHeader title="Диалоги" subtitle="написали, ответили, итоги · шаг 3 из 4" />
      {data ? (
        <div className="mt-5">
          <StatStrip items={[
            { label: "в диалоге", value: data.active.length, sub: "ответили — ведём к созвону", tone: data.active.length ? "ok" : null, onClick: () => setTab("active"), active: tab === "active" },
            { label: "пора напомнить", value: data.due.length, sub: "дни 3, 7 и 14", tone: data.due.length ? "hot" : null, onClick: () => setTab("waiting"), active: tab === "waiting" && data.due.length > 0 },
            { label: "ждём ответа", value: data.waiting.length, sub: "напоминания по плану", onClick: () => setTab("waiting") },
            { label: "итоги", value: data.closed.length, sub: "сделки, отказы, тишина", onClick: () => setTab("closed"), active: tab === "closed" },
          ]} />
        </div>
      ) : null}
      <div className="sticky top-[68px] z-20 -mx-4 mt-4 px-4 py-2 backdrop-blur-md md:mx-0 md:px-0">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Segmented<Tab>
            className="md:flex-1"
            value={tab}
            onChange={(next) => { setTab(next); setSegment(null); }}
            items={[
              { key: "active", label: "В диалоге", count: data?.active.length },
              { key: "waiting", label: "Ждём", count: data ? data.due.length + data.waiting.length : undefined, alert: Boolean(data?.due.length) },
              { key: "closed", label: "Итоги", count: data?.closed.length },
            ]}
          />
          <SearchInput value={q} onChange={setQ} placeholder="Название или город" className="md:w-64" />
        </div>
      </div>
      {segments.length > 1 ? (
        <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <Chip active={!segment} onClick={() => setSegment(null)}>Все</Chip>
          {segments.map(([key, label]) => <Chip key={key} active={segment === key} onClick={() => setSegment(segment === key ? null : key)}>{label}</Chip>)}
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {dialogs.error ? <div className="md:col-span-2 2xl:col-span-3"><Notice tone="error">{dialogs.error}</Notice></div> : !data ? <div className="md:col-span-2 2xl:col-span-3"><Skeleton rows={4} /></div> : list[tab].length === 0 ? (
          <div className="md:col-span-2 2xl:col-span-3"><Empty title={needle || segment ? "Ничего не нашлось" : "Пусто"} text={needle || segment ? "Сбросьте поиск или фильтр ниши." : empty[tab]} /></div>
        ) : list[tab].map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            onOpen={() => open("item", item.id)}
            meta={
              <span className={item.followUpDue ? "text-[#ffc3a6]" : undefined}>
                {item.followUpDue ? `Пора напомнить · ${item.followUpStep + 1} из 3` : STATUS_LABEL[item.status]}
                {item.sentAt ? ` · написали ${dayLabel(item.sentAt)}` : ""}
                {item.projectId ? " · есть проект" : ""}
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}
