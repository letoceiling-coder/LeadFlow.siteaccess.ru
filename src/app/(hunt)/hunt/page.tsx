"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { ItemCard } from "@/components/hunt/item-card";
import { Button, Chip, Empty, Glass, Notice, Segmented, Skeleton, cx, errorText, useToast } from "@/components/hunt/ui";
import { dayLabel, type Dialogs, type Today } from "@/components/hunt/types";

type Tab = "new" | "write" | "remind";

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("ru-RU", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  return hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
}

export default function HuntTodayPage() {
  const { version, refresh, open, user } = useHunt();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("new");
  const [segment, setSegment] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const todayRes = useLive<Today>("/api/hunt/today?limit=50", version, 15000);
  const dialogs = useLive<Dialogs>("/api/hunt/dialogs", version);
  const data = todayRes.data;

  const segments = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data?.items ?? []) if (item.segment && item.segmentLabel) map.set(item.segment, item.segmentLabel);
    return [...map.entries()];
  }, [data]);
  const items = (data?.items ?? []).filter((item) => !segment || item.segment === segment);

  async function quick(id: string, action: "approve" | "reject", name: string) {
    setBusyId(id);
    try {
      await post(`/api/hunt/${id}/decide`, { action, reason: action === "reject" ? "Быстрый отказ" : undefined });
      refresh();
      toast({
        text: action === "approve" ? `«${name}» — во вкладке «Написать»` : `«${name}» отклонена`,
        action: { label: "Отменить", run: () => { void post(`/api/hunt/${id}/decide`, { action: "undo" }).then(refresh); } },
      });
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function retry() {
    try {
      const result = await post<{ queued: number }>("/api/hunt/retry-failed");
      toast({ text: `Повторный скоринг: ${result.queued}` });
      refresh();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    }
  }

  const tz = data?.timezone ?? "Europe/Moscow";
  const date = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: tz }).format(new Date());
  const left = data ? Math.max(0, data.dailyLimit - data.sentToday) : 0;

  return (
    <div className="pt-2">
      <p className="text-sm text-[var(--h-faint)] first-letter:uppercase">{date}</p>
      <h1 className="mt-1 text-[32px] font-semibold leading-[38px] tracking-tight">
        <span className="text-[var(--h-muted)]">{greeting(tz)},</span> {user.name.split(" ")[0]}
      </h1>

      {data ? (
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Glass className="px-4 py-3">
            <div className={cx("text-[28px] font-semibold leading-8 tabular-nums", left === 0 && "text-[var(--h-hot)]")}>{data.sentToday}<span className="text-base text-[var(--h-faint)]">/{data.dailyLimit}</span></div>
            <div className="mt-0.5 text-xs text-[var(--h-muted)]">отправлено</div>
          </Glass>
          <button onClick={() => setTab("write")} className="text-left"><Glass tint={data.approved ? "yellow" : null} className="px-4 py-3">
            <div className="text-[28px] font-semibold leading-8 tabular-nums">{data.approved}</div>
            <div className="mt-0.5 text-xs text-[var(--h-muted)]">написать</div>
          </Glass></button>
          <button onClick={() => setTab("remind")} className="text-left"><Glass tint={data.followUps ? "orange" : null} className="px-4 py-3">
            <div className="text-[28px] font-semibold leading-8 tabular-nums">{data.followUps}</div>
            <div className="mt-0.5 text-xs text-[var(--h-muted)]">напомнить</div>
          </Glass></button>
        </div>
      ) : null}

      <div className="sticky top-[68px] z-20 -mx-4 mt-5 px-4 py-2 backdrop-blur-md">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { key: "new", label: "Новые", count: data?.total },
            { key: "write", label: "Написать", count: data?.approved },
            { key: "remind", label: "Напомнить", count: data?.followUps, alert: true },
          ]}
        />
      </div>

      <div className="mt-3 space-y-3">
        {data?.queued ? <Notice><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Скоринг идёт: {data.queued} карточек. Лента обновится сама.</span></Notice> : null}
        {data?.incomplete && tab === "new" ? <p className="px-1 text-xs text-[var(--h-faint)]">Неполных карточек от парсера: {data.incomplete} — без названия или контактов, в ленту не попадают.</p> : null}
        {data?.failed ? <Notice tone="warn"><span className="flex items-center justify-between gap-3">Не прошли скоринг: {data.failed}. <button onClick={retry} className="inline-flex items-center gap-1 font-semibold text-[var(--h-accent)]"><RotateCcw className="h-4 w-4" /> Повторить</button></span></Notice> : null}

        {tab === "new" ? (
          todayRes.loading ? <Skeleton rows={4} /> : todayRes.error ? <Notice tone="error">{todayRes.error}</Notice> : (
            <>
              {segments.length > 1 ? (
                <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                  <Chip active={!segment} onClick={() => setSegment(null)}>Все</Chip>
                  {segments.map(([key, label]) => <Chip key={key} active={segment === key} onClick={() => setSegment(key)}>{label}</Chip>)}
                </div>
              ) : null}
              {items.length === 0 ? (
                <Empty
                  title="Новых карточек нет"
                  text="Сюда попадают только A и B с подтверждённым фактом денег и хаоса. Запустите поиск — карточки сами пройдут скоринг."
                  action={<Button variant="accent" size="lg" onClick={() => open("panel", "search")}><Plus className="h-5 w-5" /> Новый поиск</Button>}
                />
              ) : items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onOpen={() => open("item", item.id)}
                  actions={
                    <div className="flex gap-1.5">
                      <button aria-label={`Отклонить ${item.organization.name}`} disabled={busyId === item.id} onClick={() => quick(item.id, "reject", item.organization.name)} className="glass grid h-11 w-11 place-items-center rounded-full text-[#ff9b9b] disabled:opacity-40"><X className="h-5 w-5" /></button>
                      <button aria-label={`Взять в работу ${item.organization.name}`} disabled={busyId === item.id} onClick={() => quick(item.id, "approve", item.organization.name)} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--h-accent)] text-[var(--h-accent-ink)] disabled:opacity-40"><Check className="h-5 w-5" strokeWidth={2.6} /></button>
                    </div>
                  }
                />
              ))}
            </>
          )
        ) : null}

        {tab === "write" ? (
          !dialogs.data ? <Skeleton rows={3} /> : dialogs.data.approved.length === 0 ? (
            <Empty title="Писать некому" text="Возьмите карточки в работу во вкладке «Новые» — здесь появится готовый текст и кнопки мессенджеров." />
          ) : dialogs.data.approved.map((item) => <ItemCard key={item.id} item={item} onOpen={() => open("item", item.id)} />)
        ) : null}

        {tab === "remind" ? (
          !dialogs.data ? <Skeleton rows={3} /> : dialogs.data.due.length === 0 ? (
            <Empty title="Напоминать некому" text="Напоминания приходят через 3, 7 и 14 дней после первого сообщения, если клиент молчит." />
          ) : dialogs.data.due.map((item) => (
            <ItemCard key={item.id} item={item} onOpen={() => open("item", item.id)} meta={<span className="text-[#ffc3a6]">Напоминание {item.followUpStep + 1} из 3 · первое {dayLabel(item.sentAt)}</span>} />
          ))
        ) : null}
      </div>
    </div>
  );
}
