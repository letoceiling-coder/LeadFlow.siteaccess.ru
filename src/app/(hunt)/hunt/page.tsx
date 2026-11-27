"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { ItemCard } from "@/components/hunt/item-card";
import { HealthStrip } from "@/components/hunt/health-card";
import { LiveSearches } from "@/components/hunt/search-progress";
import { Button, Chip, Empty, Notice, PageHeader, SearchInput, Segmented, Skeleton, StatStrip, errorText, useToast } from "@/components/hunt/ui";
import { NewSearchCard, PipelineMini } from "@/components/hunt/pipeline-mini";
import { STATUS_LABEL, dayLabel, type Dialogs, type HuntItem, type Plan, type Today } from "@/components/hunt/types";
import { PlanList } from "@/components/hunt/item-plan";

type Tab = "plan" | "new" | "review" | "write" | "remind";

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("ru-RU", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  return hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
}

export default function HuntTodayPage() {
  const { version, refresh, open, user } = useHunt();
  const router = useRouter();
  const toast = useToast();
  const [picked, setTab] = useState<Tab | null>(null);
  const [segment, setSegment] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const todayRes = useLive<Today>("/api/hunt/today?limit=50", version, 15000);
  const dialogs = useLive<Dialogs>("/api/hunt/dialogs", version, 30000);
  const planRes = useLive<Plan>("/api/hunt/plan", version, 30000);
  const data = todayRes.data;
  // Сначала срочное: напоминания и сроки по диалогам — самые дешёвые ответы.
  // По брифу «Сегодня» — это план: до 30 действий (новые A, касания дня 4 и 8, задачи). Остальные вкладки — для разбора.
  const tab: Tab = picked ?? "plan";

  useEffect(() => { setHidden(new Set()); }, [data]);

  // Счётчик на иконке приложения (Android/Chrome, iOS 16.4+ для установленного PWA).
  useEffect(() => {
    if (!data) return;
    const badge = data.followUps + data.approved;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (badge && nav.setAppBadge) void nav.setAppBadge(badge).catch(() => undefined);
    else if (nav.clearAppBadge) void nav.clearAppBadge().catch(() => undefined);
  }, [data]);

  const segments = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data?.items ?? []) if (item.segment && item.segmentLabel) map.set(item.segment, item.segmentLabel);
    return [...map.entries()];
  }, [data]);
  const needle = q.trim().toLowerCase();
  const visible = (list: HuntItem[]) => list.filter((item) => !hidden.has(item.id) && (!needle || `${item.organization.name} ${item.organization.city ?? ""} ${item.organization.category ?? ""}`.toLowerCase().includes(needle)));
  const items = visible(data?.items ?? []).filter((item) => !segment || item.segment === segment);

  /** Оптимистично: строка исчезает сразу, при ошибке возвращается. */
  async function quick(id: string, action: "approve" | "reject", name: string) {
    setHidden((prev) => new Set(prev).add(id));
    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
    try {
      await post(`/api/hunt/${id}/decide`, { action, reason: action === "reject" ? "Быстрый отказ" : undefined });
      refresh();
      toast({
        text: action === "approve" ? `«${name}» — во «Написать»` : `«${name}» отклонена`,
        action: { label: "Отменить", run: () => { void post(`/api/hunt/${id}/decide`, { action: "undo" }).then(refresh); } },
      });
    } catch (reason) {
      setHidden((prev) => { const next = new Set(prev); next.delete(id); return next; });
      toast({ text: errorText(reason), tone: "error" });
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

  const first = user.name.split(" ")[0];
  return (
    <div>
      <PageHeader eyebrow={`${greeting(tz)}, ${first}`} title="Отбор" subtitle={`${date} · шаг 2 из 4`} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
      {data ? (
        <StatStrip
          title="Активность сегодня"
          items={[
            { label: "отправлено", value: <>{data.sentToday}<span className="text-[18px] text-[var(--h-faint)] md:text-[20px]">/{data.dailyLimit}</span></>, sub: left ? `осталось ${left}` : "лимит дня исчерпан", tone: left === 0 ? "hot" : null },
            { label: "написать", value: data.approved, sub: "взяты в работу", tone: data.approved ? "accent" : null, onClick: () => setTab("write"), active: tab === "write" },
            { label: "срочно", value: data.followUps, sub: "напоминания и сроки", tone: data.followUps ? "hot" : null, onClick: () => setTab("remind"), active: tab === "remind" },
            { label: "на проверке", value: data.reviewTotal, sub: "нужен факт", onClick: () => setTab("review"), active: tab === "review" },
          ]}
        />
      ) : <div className="skeleton h-[118px] rounded-[var(--h-radius)]" />}

      <div className="mt-3 space-y-2 xl:hidden"><HealthStrip /><LiveSearches /></div>

      <div className="sticky top-[68px] z-20 -mx-4 mt-4 px-4 py-2 backdrop-blur-md md:mx-0 md:px-0">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Segmented<Tab>
            className="md:flex-1"
            value={tab}
            onChange={setTab}
            items={[
              { key: "plan", label: "План", count: planRes.data ? Math.min(planRes.data.total, planRes.data.limit) : undefined },
              { key: "new", label: "Новые", count: data?.total },
              { key: "review", label: "Проверка", count: data?.reviewTotal },
              { key: "write", label: "Писать", count: data?.approved },
              { key: "remind", label: "Срочно", count: data?.followUps, alert: true },
            ]}
          />
          {tab !== "plan" ? <SearchInput value={q} onChange={setQ} placeholder="Название, город, ниша" className="md:w-64" /> : null}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {data?.queued ? <Notice><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Скоринг идёт: {data.queued} карточек. Лента обновится сама.</span></Notice> : null}
        {data && !data.ai.ready && tab === "new" ? <Notice tone="warn">AI-скоринг выключен: {data.ai.reason} Без AI «деньги» видны только по отзывам — проверьте карточки во вкладке «Проверить».</Notice> : null}
        {data?.failed ? <Notice tone="warn"><span className="flex items-center justify-between gap-3">Не прошли скоринг: {data.failed}. <button onClick={retry} className="inline-flex items-center gap-1 font-semibold text-[var(--h-accent)]"><RotateCcw className="h-4 w-4" /> Повторить</button></span></Notice> : null}

        {tab === "plan" ? (
          planRes.error ? <Notice tone="error">{planRes.error}</Notice> : !planRes.data ? <Skeleton rows={4} /> : <PlanList plan={planRes.data} role={user.role} onOpen={(id) => open("item", id)} onChanged={refresh} />
        ) : null}

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
                  title="Готовых карточек нет"
                  text={data?.reviewTotal ? `Есть ${data.reviewTotal} на проверку: хаос и контакт найдены, нужен факт «денег» — подтвердите его глазами.` : "Сюда попадают A и B с подтверждённым фактом денег и хаоса. Запустите поиск — карточки сами пройдут скоринг."}
                  action={data?.reviewTotal
                    ? <Button variant="accent" size="lg" onClick={() => setTab("review")}>Проверить {data.reviewTotal}</Button>
                    : <Button variant="accent" size="lg" onClick={() => router.push("/hunt/search")}><Plus className="h-5 w-5" /> Новый поиск</Button>}
                />
              ) : <div className="grid gap-3 md:grid-cols-2">{items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onOpen={() => open("item", item.id)}
                  actions={
                    <div className="flex gap-1.5">
                      <button aria-label={`Отклонить ${item.organization.name}`} onClick={() => quick(item.id, "reject", item.organization.name)} className="glass grid h-11 w-11 place-items-center rounded-full text-[#ff9b9b]"><X className="h-5 w-5" /></button>
                      <button aria-label={`Взять в работу ${item.organization.name}`} onClick={() => quick(item.id, "approve", item.organization.name)} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--h-accent)] text-[var(--h-accent-ink)]"><Check className="h-5 w-5" strokeWidth={2.6} /></button>
                    </div>
                  }
                />
              ))}</div>}
              {data?.incomplete ? <p className="px-1 text-xs text-[var(--h-faint)]">Неполных карточек от парсера: {data.incomplete} — без названия или контактов, в ленту не попадают.</p> : null}
            </>
          )
        ) : null}

        {tab === "review" ? (
          !data ? <Skeleton rows={3} /> : visible(data.review).length === 0 ? (
            <Empty title="Проверять нечего" text="Здесь появляются карточки класса C: хаос и контакт есть, а «денег» парсер не увидел. Вы подтверждаете факт одним касанием — карточка пересчитывается." />
          ) : (
            <>
              <p className="px-1 text-sm text-[var(--h-muted)]">Откройте карточку, посмотрите источник и отметьте недостающий факт, если он есть. Нет — отклоните.</p>
              <div className="grid gap-3 md:grid-cols-2">{visible(data.review).map((item) => <ItemCard key={item.id} item={item} onOpen={() => open("item", item.id)} meta={<span className="text-[#ffe680]">Нужен факт «{item.card?.money.length ? "хаоса" : "денег"}» · {item.score} баллов</span>} />)}</div>
            </>
          )
        ) : null}

        {tab === "write" ? (
          !dialogs.data ? <Skeleton rows={3} /> : visible(dialogs.data.approved).length === 0 ? (
            <Empty title="Писать некому" text="Возьмите карточки в работу во вкладке «Новые» — здесь появится готовый текст и кнопки мессенджеров." />
          ) : <div className="grid gap-3 md:grid-cols-2">{visible(dialogs.data.approved).map((item) => <ItemCard key={item.id} item={item} onOpen={() => open("item", item.id)} />)}</div>
        ) : null}

        {tab === "remind" ? (
          !dialogs.data ? <Skeleton rows={3} /> : visible(dialogs.data.due).length === 0 ? (
            <Empty title="Срочного нет" text="Здесь напоминания через 3, 7 и 14 дней и сроки по диалогам: ответить в течение суток, созвон, смета." />
          ) : <div className="grid gap-3 md:grid-cols-2">{visible(dialogs.data.due).map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onOpen={() => open("item", item.id)}
              meta={<span className="text-[#ffc3a6]">{item.status === "sent" ? `Напоминание ${item.followUpStep + 1} из 3 · написали ${dayLabel(item.sentAt)}` : `${STATUS_LABEL[item.status]} — пора следующий шаг`}</span>}
            />
          ))}</div>
        ) : null}
      </div>
      </div>

      <aside className="hidden space-y-3 xl:sticky xl:top-[84px] xl:block xl:self-start">
        <NewSearchCard />
        <HealthStrip />
        <LiveSearches />
        <PipelineMini version={version} />
      </aside>
      </div>
    </div>
  );
}
