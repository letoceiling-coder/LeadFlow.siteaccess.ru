"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, Clock, ExternalLink, Send, X } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Loading, State, cnJoin } from "@/components/ui";
import { CardFacts, OrgLine, PriorityBadge, hookOf, type HuntItem } from "@/components/hunt";

type Today = {
  items: HuntItem[];
  total: number;
  approved: number;
  followUps: number;
  queued: number;
  sentToday: number;
  dailyLimit: number;
};

const REASONS = ["Нет денег", "Нет хаоса", "Уже есть сайт", "Не та ниша", "Факт неверный", "Нет контакта"];

export default function HuntTodayPage() {
  const router = useRouter();
  const today = useResource<Today>("/api/hunt/today?limit=20");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);

  const data = today.data;
  const items = data?.items ?? [];
  const item = items[index] ?? null;

  async function decide(action: "approve" | "reject" | "snooze", reason?: string) {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/hunt/${item.id}/decide`, { method: "POST", body: JSON.stringify({ action, reason, days: action === "snooze" ? 3 : undefined }) });
      setRejecting(false);
      setNotice(action === "approve" ? `«${item.organization.name}» в работе` : action === "reject" ? "Отклонено" : "Отложено на 3 дня");
      if (action === "approve") {
        if (data) today.setData({ ...data, approved: data.approved + 1 });
      }
      setIndex((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не сохранилось");
    } finally {
      setBusy(false);
      setDx(0);
    }
  }

  async function qualify(confirmLarge = false) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ queued: number }>("/api/hunt/qualify", { method: "POST", body: JSON.stringify({ limit: 20, confirmLarge }) });
      setNotice(result.queued ? `Квалификация запущена: ${result.queued} карточек. Обновите через пару минут.` : "Новых карточек для квалификации нет — запустите поиск.");
      await today.reload();
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.code === "confirm_required" && window.confirm(`${reason.message}\n\nЗапустить?`)) {
        setBusy(false);
        return qualify(true);
      }
      setError(reason instanceof Error ? reason.message : "Не запустилось");
    } finally {
      setBusy(false);
    }
  }

  function onTouchStart(event: React.TouchEvent) {
    start.current = event.touches[0].clientX;
  }
  function onTouchMove(event: React.TouchEvent) {
    if (start.current == null) return;
    setDx(event.touches[0].clientX - start.current);
  }
  function onTouchEnd() {
    start.current = null;
    if (dx > 110) void decide("approve");
    else if (dx < -110) setRejecting(true);
    setDx(0);
  }

  if (today.loading && !data) return <Loading />;
  if (today.error) return <State title="Лента недоступна" text={today.error} />;
  if (!data) return null;

  const limitLeft = Math.max(0, data.dailyLimit - data.sentToday);

  return (
    <div className="mx-auto w-full max-w-xl pb-4">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight">Сегодня</h1>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Отправлено" value={`${data.sentToday}/${data.dailyLimit}`} tone={limitLeft === 0 ? "amber" : "plain"} />
        <Stat label="Написать" value={String(data.approved)} href="/hunt/dialogs" tone={data.approved ? "amber" : "plain"} />
        <Stat label="Follow-up" value={String(data.followUps)} href="/hunt/dialogs" tone={data.followUps ? "red" : "plain"} />
      </div>

      {notice ? <p className="mt-4 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-800">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      {item ? (
        <>
          <div className="mt-6 mb-2 flex items-center justify-between px-1 text-sm text-slate-500">
            <span>Карточка {index + 1} из {items.length}{data.total > items.length ? ` · всего ${data.total}` : ""}</span>
            <span className="hidden sm:inline">← отклонить · взять →</span>
          </div>
          <article
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined }}
            className={cnJoin(
              "touch-pan-y rounded-3xl border bg-white p-5 shadow-card transition-[border-color] duration-150",
              dx > 60 ? "border-teal-700" : dx < -60 ? "border-red-400" : "border-line",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold leading-7">{item.organization.name}</h2>
                <div className="mt-1"><OrgLine item={item} /></div>
              </div>
              <PriorityBadge priority={item.priority} score={item.score} />
            </div>

            {hookOf(item.card) ? (
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] leading-6 text-amber-950">{hookOf(item.card)}</p>
            ) : null}

            {item.card ? <div className="mt-4"><CardFacts card={item.card} /></div> : null}

            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              {item.organization.sourceUrl ? <a className="inline-flex items-center gap-1 text-teal-800" href={item.organization.sourceUrl} target="_blank" rel="noreferrer">Карточка в источнике <ExternalLink className="h-3.5 w-3.5" /></a> : null}
              {item.organization.website ? <a className="inline-flex items-center gap-1 text-teal-800" href={item.organization.website} target="_blank" rel="noreferrer">Сайт <ExternalLink className="h-3.5 w-3.5" /></a> : null}
              <Link className="text-slate-500" href={`/organizations/${item.organization.id}`}>Подробнее</Link>
            </div>
          </article>

          {rejecting ? (
            <div className="mt-4 rounded-2xl border border-line bg-white p-4">
              <div className="mb-3 text-sm font-medium">Почему не подходит?</div>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((reason) => (
                  <button key={reason} disabled={busy} onClick={() => decide("reject", reason)} className="h-10 rounded-full border border-line px-4 text-sm active:bg-slate-100">{reason}</button>
                ))}
              </div>
              <button className="mt-3 text-sm text-slate-500" onClick={() => setRejecting(false)}>Отмена</button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-[56px_56px_1fr] gap-2">
              <button aria-label="Отклонить" disabled={busy} onClick={() => setRejecting(true)} className="grid h-14 place-items-center rounded-2xl border border-line bg-white text-red-700 active:bg-red-50"><X className="h-6 w-6" /></button>
              <button aria-label="Отложить на 3 дня" disabled={busy} onClick={() => decide("snooze")} className="grid h-14 place-items-center rounded-2xl border border-line bg-white text-slate-600 active:bg-slate-100"><Clock className="h-5 w-5" /></button>
              <button disabled={busy} onClick={() => decide("approve")} className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-teal-700 text-base font-semibold text-white active:bg-teal-800 disabled:opacity-60"><Check className="h-5 w-5" /> Взять в работу</button>
            </div>
          )}
        </>
      ) : (
        <div className="mt-6 rounded-3xl border border-dashed border-line bg-white px-5 py-8 text-center">
          <h2 className="text-lg font-semibold">{items.length ? "Лента на сегодня разобрана" : "Карточек на проверку нет"}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
            {data.queued ? `Квалифицируются ещё ${data.queued} карточек — обновите через пару минут. ` : ""}
            В ленту попадают только карточки A и B с подтверждённым фактом денег и хаоса.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {data.approved ? (
              <button onClick={() => router.push("/hunt/dialogs")} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-teal-700 font-semibold text-white"><Send className="h-4 w-4" /> Написать взятым в работу ({data.approved})</button>
            ) : null}
            <button disabled={busy} onClick={() => qualify()} className={cnJoin("h-12 rounded-2xl font-semibold", data.approved ? "border border-line bg-white" : "bg-teal-700 text-white")}>Квалифицировать новые</button>
            <Link href="/hunt/search" className="h-12 leading-[48px] text-sm text-teal-800">Запустить поиск</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, href, tone = "plain" }: { label: string; value: string; href?: string; tone?: "plain" | "red" | "amber" }) {
  const body = (
    <div className="rounded-2xl border border-line bg-white px-3 py-3">
      <div className={cnJoin("text-2xl font-semibold tabular-nums", tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-ink")}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
