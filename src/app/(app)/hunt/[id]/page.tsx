"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, ExternalLink, Mail, MessageCircle, Phone, Send, Sparkles } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Loading, State, cnJoin } from "@/components/ui";
import { CardFacts, PriorityBadge, STATUS_LABEL, dayLabel, hookOf, type ObservationCard } from "@/components/hunt";
import { bannedIn } from "@/lib/domain/pitch";

type Link_ = { kind: string; label: string; href: string; prefill: boolean };
type Item = {
  id: string;
  organization: { id: string; name: string; city: string | null; category: string | null; address: string | null; rating: number | null; reviewCount: number | null; website: string | null; sourceUrl: string | null; optedOut: boolean; stage: string | null };
  segmentLabel: string | null;
  score: number;
  priority: string;
  factors: { key: string; label: string; points: number; hit: boolean; reason: string }[] | null;
  card: ObservationCard | null;
  cardStatus: string;
  status: string;
  sentAt: string | null;
  followUpStep: number;
  nextFollowUpAt: string | null;
  error: string | null;
  pitch: string;
  followUp: string | null;
  links: Link_[];
};

const CHANNEL_OF: Record<string, string> = { telegram: "telegram", whatsapp: "whatsapp", vk: "vk", email: "email", phone: "phone", instagram: "instagram", link: "other" };
const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", vk: "VK", email: "почту", phone: "звонок", instagram: "Instagram", avito: "Avito", other: "другой канал" };

function LinkIcon({ kind }: { kind: string }) {
  if (kind === "email") return <Mail className="h-5 w-5" />;
  if (kind === "phone") return <Phone className="h-5 w-5" />;
  if (kind === "telegram") return <Send className="h-5 w-5" />;
  if (kind === "link") return <ExternalLink className="h-5 w-5" />;
  return <MessageCircle className="h-5 w-5" />;
}

export default function HuntItemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const item = useResource<Item>(`/api/hunt/${id}`);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showFactors, setShowFactors] = useState(false);

  const data = item.data;
  const firstContact = data ? ["new", "approved", "snoozed"].includes(data.status) : false;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const followUpMode = data?.status === "sent" && Boolean(data.nextFollowUpAt) && new Date(data.nextFollowUpAt!) <= endOfToday;
  const waitingFollowUp = data?.status === "sent" && !followUpMode;

  useEffect(() => {
    if (data) setText(followUpMode ? data.followUp ?? "" : data.pitch);
  }, [data, followUpMode]);

  const banned = useMemo(() => bannedIn(text), [text]);

  async function run<T>(fn: () => Promise<T>, ok?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if (ok) setNotice(ok);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не получилось");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Текст скопирован");
    } catch {
      setNotice("Скопируйте текст вручную");
    }
  }

  async function open(link: Link_) {
    try { await navigator.clipboard.writeText(text); } catch { /* буфер может быть недоступен */ }
    setChannel(CHANNEL_OF[link.kind] ?? "other");
    setNotice(link.prefill ? "Текст подставлен в сообщение. Отправьте его и вернитесь сюда." : "Текст в буфере — вставьте его в чат, отправьте и вернитесь сюда.");
    window.open(link.href, "_blank", "noopener");
  }

  async function rewrite() {
    const result = await run(() => api<{ text: string; fallback: boolean }>(`/api/hunt/${id}/pitch/rewrite`, { method: "POST" }));
    if (result) {
      setText(result.text);
      setNotice(result.fallback ? "AI написал запрещённую фразу — оставили прежний текст." : "AI переписал текст. Проверьте и сохраните.");
    }
  }

  async function markSent(ch: string) {
    const send = (force: boolean) => api(`/api/hunt/${id}/sent`, { method: "POST", body: JSON.stringify({ channel: ch, text, force }) });
    setBusy(true);
    setError("");
    try {
      try {
        await send(false);
      } catch (reason) {
        if (!(reason instanceof ApiClientError && reason.code === "daily_limit" && window.confirm(`${reason.message}\n\nВсё равно отметить?`))) throw reason;
        await send(true);
      }
      setNotice("Отмечено. Напомню написать ещё раз через 3 дня.");
      await item.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  async function followUp(ch: string) {
    const result = await run(() => api<{ next: string | null }>(`/api/hunt/${id}/followup`, { method: "POST", body: JSON.stringify({ channel: ch }) }));
    if (result) {
      setNotice(result.next ? `Отмечено. Следующее напоминание ${dayLabel(result.next)}.` : "Цепочка закончилась — карточка переехала в «спящие».");
      await item.reload();
    }
  }

  async function status(next: string) {
    const result = await run(() => api(`/api/hunt/${id}/status`, { method: "POST", body: JSON.stringify({ status: next }) }), `Статус: ${STATUS_LABEL[next]}`);
    if (result) await item.reload();
  }

  if (item.loading && !data) return <Loading />;
  if (item.error) return <State title="Карточка недоступна" text={item.error} />;
  if (!data) return null;

  const org = data.organization;

  return (
    <div className="mx-auto w-full max-w-xl pb-28">
      <button onClick={() => router.back()} className="-ml-2 mb-2 inline-flex h-11 items-center gap-1 px-2 text-sm text-slate-600"><ArrowLeft className="h-4 w-4" /> Назад</button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-8">{org.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{[org.city, data.segmentLabel, STATUS_LABEL[data.status]].filter(Boolean).join(" · ")}</p>
        </div>
        <PriorityBadge priority={data.priority} score={data.score} />
      </div>

      {notice ? <p className="mt-4 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-800">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {org.optedOut ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">Организация отказалась от сообщений. Писать нельзя.</p> : null}

      {data.card ? (
        <section className="mt-5 rounded-3xl border border-line bg-white p-5">
          {hookOf(data.card) ? <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] leading-6 text-amber-950">{hookOf(data.card)}</p> : null}
          <CardFacts card={data.card} />
          {data.cardStatus !== "ready" ? <p className="mt-3 text-sm text-amber-800">Нет подтверждённого факта денег или хаоса — писать по этой карточке нельзя.</p> : null}
          {data.error ? <p className="mt-3 text-xs text-slate-500">{data.error}</p> : null}
          <button className="mt-3 text-sm text-teal-800" onClick={() => setShowFactors((value) => !value)}>{showFactors ? "Скрыть баллы" : "Из чего баллы"}</button>
          {showFactors && data.factors ? (
            <ul className="mt-2 space-y-1 text-sm">
              {data.factors.map((factor) => (
                <li key={factor.key} className={cnJoin("flex justify-between gap-3", factor.hit ? "text-ink" : "text-slate-400")}>
                  <span>{factor.label}</span>
                  <span className="tabular-nums">{factor.hit ? (factor.points > 0 ? `+${factor.points}` : factor.points) : "0"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {(firstContact || followUpMode) && data.cardStatus === "ready" && !org.optedOut ? (
        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="text-lg font-semibold">{followUpMode ? `Напоминание ${data.followUpStep + 1} из 3` : "Сообщение"}</h2>
            {followUpMode && data.nextFollowUpAt ? <span className="text-sm text-slate-500">по плану {dayLabel(data.nextFollowUpAt)}</span> : null}
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={9}
            className="w-full rounded-2xl border border-line bg-white p-4 text-base leading-6 outline-none ring-teal-700/30 focus:ring-2"
          />
          {banned.length ? <p className="mt-2 text-sm text-red-700">Уберите: {banned.join(", ")} — такие сообщения игнорируют.</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={copy} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-sm"><Copy className="h-4 w-4" /> Копировать</button>
            {firstContact ? <button disabled={busy} onClick={rewrite} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-sm"><Sparkles className="h-4 w-4" /> Переписать AI</button> : null}
            {firstContact ? <button disabled={busy || banned.length > 0} onClick={() => run(() => api(`/api/hunt/${id}/pitch`, { method: "PUT", body: JSON.stringify({ text }) }), "Текст сохранён")} className="h-10 rounded-full border border-line bg-white px-4 text-sm">Сохранить</button> : null}
          </div>

          <h3 className="mb-2 mt-6 px-1 text-sm font-medium text-slate-500">Открыть и отправить самому</h3>
          {data.links.length ? (
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
              {data.links.map((link) => (
                <button key={link.href} disabled={banned.length > 0} onClick={() => open(link)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left active:bg-slate-50 disabled:opacity-50">
                  <span className="text-teal-800"><LinkIcon kind={link.kind} /></span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{link.label}</span>
                  {link.prefill ? <span className="text-xs text-slate-400">с текстом</span> : null}
                </button>
              ))}
            </div>
          ) : <p className="px-1 text-sm text-slate-500">Контактов для открытия нет.</p>}
        </section>
      ) : null}

      {waitingFollowUp ? (
        <p className="mt-5 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-slate-600">
          Сообщение отправлено {dayLabel(data.sentAt)}. {data.nextFollowUpAt ? `Напоминание ${data.followUpStep + 1} из 3 — ${dayLabel(data.nextFollowUpAt).replace(/\.$/, "")}.` : ""} Если ответили раньше — отметьте ниже.
        </p>
      ) : null}

      {["replied", "call", "estimate", "sent"].includes(data.status) ? (
        <section className="mt-6">
          <h2 className="mb-2 px-1 text-lg font-semibold">Что дальше</h2>
          <div className="flex flex-wrap gap-2">
            {(data.status === "sent" ? ["replied", "lost", "sleeping"] : ["call", "estimate", "won", "lost"]).filter((key) => key !== data.status).map((key) => (
              <button key={key} disabled={busy} onClick={() => status(key)} className={cnJoin("h-11 rounded-full px-5 text-sm font-medium", key === "replied" || key === "won" ? "bg-teal-700 text-white" : "border border-line bg-white")}>{STATUS_LABEL[key]}</button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-6 px-1 text-sm">
        <Link className="text-teal-800" href={`/organizations/${org.id}`}>Карточка организации</Link>
        {org.sourceUrl ? <a className="ml-4 text-teal-800" href={org.sourceUrl} target="_blank" rel="noreferrer">Источник</a> : null}
      </div>

      {(firstContact || followUpMode) && data.cardStatus === "ready" && !org.optedOut ? (
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-[260px]">
          <div className="mx-auto flex max-w-xl gap-2">
            <select value={channel ?? ""} onChange={(event) => setChannel(event.target.value || null)} aria-label="Канал" className="h-12 rounded-2xl border border-line bg-white px-3 text-base">
              <option value="">Канал…</option>
              {Object.entries(CHANNEL_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button
              disabled={busy || !channel || banned.length > 0}
              onClick={() => (followUpMode ? followUp(channel!) : markSent(channel!))}
              className="h-12 flex-1 rounded-2xl bg-teal-700 text-base font-semibold text-white disabled:opacity-50"
            >
              {followUpMode ? "Напомнил" : "Отправил"}{channel ? ` в ${CHANNEL_LABEL[channel]}` : ""}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
