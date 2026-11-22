"use client";

import { useState } from "react";
import { useHunt } from "@/components/hunt/shell";
import { useLive } from "@/components/hunt/data";
import { ItemCard } from "@/components/hunt/item-card";
import { Empty, Notice, Segmented, Skeleton } from "@/components/hunt/ui";
import { STATUS_LABEL, dayLabel, type Dialogs, type HuntItem } from "@/components/hunt/types";

type Tab = "active" | "waiting" | "closed";

export default function HuntDialogsPage() {
  const { version, open } = useHunt();
  const [tab, setTab] = useState<Tab>("active");
  const dialogs = useLive<Dialogs>("/api/hunt/dialogs", version);
  const data = dialogs.data;

  const list: Record<Tab, HuntItem[]> = { active: data?.active ?? [], waiting: [...(data?.due ?? []), ...(data?.waiting ?? [])], closed: data?.closed ?? [] };
  const empty: Record<Tab, string> = {
    active: "Когда клиент ответит, отметьте «Ответил» в карточке — диалог появится здесь, дальше созвон, смета и сделка.",
    waiting: "Здесь те, кому вы уже написали. Через 3, 7 и 14 дней без ответа появится напоминание.",
    closed: "Сделки, отказы и «спящие» после трёх напоминаний.",
  };

  return (
    <div className="pt-2">
      <h1 className="text-[32px] font-semibold leading-[38px] tracking-tight">Диалоги</h1>
      <div className="sticky top-[68px] z-20 -mx-4 mt-5 px-4 py-2 backdrop-blur-md">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { key: "active", label: "В диалоге", count: data?.active.length },
            { key: "waiting", label: "Ждём", count: data ? data.due.length + data.waiting.length : undefined },
            { key: "closed", label: "Итоги", count: data?.closed.length },
          ]}
        />
      </div>
      <div className="mt-3 space-y-3">
        {dialogs.error ? <Notice tone="error">{dialogs.error}</Notice> : !data ? <Skeleton rows={4} /> : list[tab].length === 0 ? (
          <Empty title="Пусто" text={empty[tab]} />
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
