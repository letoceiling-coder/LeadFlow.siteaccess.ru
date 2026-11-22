"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Clock, Copy, PenLine, ExternalLink, FolderKanban, Mail, MessageCircle, Phone, Send, Sparkles, X } from "lucide-react";
import { ApiClientError } from "@/lib/client";
import { bannedIn, replyTemplates } from "@/lib/domain/pitch";
import { scenarioOf } from "@/lib/domain/scenarios";
import { useHunt } from "./shell";
import { post, useLive } from "./data";
import { Button, Chip, Notice, PriorityBadge, Sheet, Skeleton, cx, errorText, textareaClass, useToast } from "./ui";
import { SOURCE_LABEL, STATUS_LABEL, dayLabel, hookOf, type CardFact, type ObservationCard } from "./types";

type ContactLink = { kind: string; label: string; href: string; prefill: boolean };
type Item = {
  id: string;
  organization: { id: string; name: string; city: string | null; category: string | null; address: string | null; rating: number | null; reviewCount: number | null; website: string | null; sourceUrl: string | null; stage: string | null };
  blocked: string | null;
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
  followUpDue: boolean;
  actionDue?: boolean;
  segment: string | null;
  error: string | null;
  pitch: string;
  followUp: string | null;
  links: ContactLink[];
  projectId: string | null;
  lastChannel: string | null;
};

const CHANNELS = [
  { key: "telegram", label: "Telegram" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "vk", label: "VK" },
  { key: "email", label: "Почта" },
  { key: "phone", label: "Звонок" },
  { key: "instagram", label: "Instagram" },
  { key: "avito", label: "Авито" },
  { key: "other", label: "Другое" },
];
const KIND_TO_CHANNEL: Record<string, string> = { telegram: "telegram", whatsapp: "whatsapp", vk: "vk", email: "email", phone: "phone", instagram: "instagram", link: "other" };
/** Шаги после первого сообщения. Смета — только после созвона (§3), демо — между ответом и созвоном (§7). */
const NEXT: Record<string, string[]> = {
  sent: ["replied", "lost", "sleeping", "optout"],
  sleeping: ["replied", "lost", "optout"],
  replied: ["demo", "call", "lost", "optout"],
  demo: ["call", "lost", "optout"],
  call: ["estimate", "won", "lost"],
  estimate: ["call", "won", "lost"],
  lost: ["replied"],
};
const MONEY_CHIPS = ["2+ филиала", "Дорогой чек", "Реклама в Директе или Авито", "Много отзывов на других площадках", "Большая команда / много мастеров"];
const CHAOS_CHIPS = ["Заявки только по телефону", "Соцсеть вместо сайта", "Нет онлайн-записи", "Меню или прайс картинкой", "Заказы в мессенджере вручную"];
const REASONS = ["Нет денег", "Нет хаоса", "Уже есть сайт", "Не та ниша", "Факт неверный", "Нет контакта"];

function LinkIcon({ kind }: { kind: string }) {
  if (kind === "email") return <Mail className="h-5 w-5" />;
  if (kind === "phone") return <Phone className="h-5 w-5" />;
  if (kind === "telegram") return <Send className="h-5 w-5" />;
  if (kind === "link" || kind === "instagram") return <ExternalLink className="h-5 w-5" />;
  return <MessageCircle className="h-5 w-5" />;
}

function readDraft(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeDraft(key: string, value: string | null) {
  try { if (value == null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* приватный режим */ }
}

export function FactList({ label, items, tone }: { label: string; items: CardFact[]; tone: "money" | "chaos" | "growth" }) {
  if (!items.length) return null;
  const dot = tone === "money" ? "bg-[var(--h-ok)]" : tone === "chaos" ? "bg-[var(--h-hot)]" : "bg-[var(--h-info)]";
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--h-faint)]">{label}</div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.text} className="flex gap-2.5 text-[15px] leading-6">
            <span className={cx("mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
            <span>{item.text} <span className="text-xs text-[var(--h-faint)]">· {SOURCE_LABEL[item.source] ?? item.source}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ItemPanel({ id }: { id: string | null }) {
  const { close, refresh, open, version, user } = useHunt();
  const toast = useToast();
  const item = useLive<Item>(id ? `/api/hunt/${id}` : null, version);
  const data = item.data && item.data.id === id ? item.data : null;
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [showFactors, setShowFactors] = useState(false);
  const initFor = useRef("");
  const [awaiting, setAwaiting] = useState(false);
  const [returned, setReturned] = useState(false);

  // Вернулись из мессенджера — напоминаем отметить отправку, чтобы касание не потерялось.
  useEffect(() => {
    if (!awaiting) return;
    const onVisible = () => { if (document.visibilityState === "visible") { setReturned(true); setAwaiting(false); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [awaiting]);
  useEffect(() => { setReturned(false); setAwaiting(false); }, [id]);

  const firstContact = data ? ["new", "approved", "snoozed"].includes(data.status) : false;
  const writing = data?.status === "approved";
  const followUpMode = Boolean(data?.followUpDue);
  const draftKey = data ? `lf-pitch-${data.id}` : "";

  // Текст заполняется один раз на карточку и режим — перезагрузка данных не стирает правки.
  useEffect(() => {
    if (!data) return;
    const key = `${data.id}:${followUpMode ? `f${data.followUpStep}` : "p"}`;
    if (initFor.current === key) return;
    initFor.current = key;
    setText(followUpMode ? data.followUp ?? "" : readDraft(`lf-pitch-${data.id}`) ?? data.pitch);
    setChannel(data.lastChannel ?? (data.links[0] ? KIND_TO_CHANNEL[data.links[0].kind] ?? null : null));
    setRejecting(false);
    setError("");
  }, [data, followUpMode]);

  useEffect(() => { if (!id) initFor.current = ""; }, [id]);

  const banned = useMemo(() => bannedIn(text), [text]);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (reason) {
      setError(errorText(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "reject" | "snooze", reason?: string) {
    if (!data) return;
    const ok = await run(() => post(`/api/hunt/${data.id}/decide`, { action, reason, days: action === "snooze" ? 3 : undefined }));
    if (ok == null) return;
    refresh();
    const label = action === "approve" ? "Взято в работу" : action === "reject" ? "Отклонено" : "Отложено на 3 дня";
    toast({ text: label, action: { label: "Отменить", run: () => { void post(`/api/hunt/${data.id}/decide`, { action: "undo" }).then(refresh); } } });
    if (action !== "approve") await goNext();
  }

  /** После действия — сразу следующая карточка, без возврата в список. */
  async function goNext(doneText?: string) {
    if (!data) return close();
    try {
      const next = await post<{ id: string; kind: string } | null>(`/api/hunt/next?after=${encodeURIComponent(data.id)}`, undefined, "GET");
      if (next?.id) {
        if (doneText) toast({ text: `${doneText} · дальше следующая` });
        open("item", next.id, true);
        return;
      }
    } catch { /* нет следующей — просто закрываем */ }
    if (doneText) toast({ text: `${doneText} · карточки на сегодня закончились` });
    close();
  }

  const [factText, setFactText] = useState("");
  async function addFact(kind: "money" | "chaos", value: string) {
    if (!data || value.trim().length < 3) return;
    const result = await run(() => post<{ ready: boolean; priority: string; score: number }>(`/api/hunt/${data.id}/fact`, { kind, text: value.trim() }));
    if (!result) return;
    setFactText("");
    refresh();
    toast({ text: result.ready ? `Карточка готова: ${result.priority} ${result.score} — можно писать` : `Факт добавлен · ${result.priority} ${result.score}` });
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast({ text: "Текст скопирован" }); } catch { toast({ text: "Скопируйте текст вручную", tone: "error" }); }
  }

  async function openLink(link: ContactLink) {
    try { await navigator.clipboard.writeText(text); } catch { /* буфер недоступен */ }
    setChannel(KIND_TO_CHANNEL[link.kind] ?? "other");
    if (writing) writeDraft(draftKey, text);
    toast({ text: link.prefill ? "Текст подставлен — отправьте и вернитесь" : "Текст в буфере — вставьте в чат и отправьте" });
    if (link.kind !== "phone") setAwaiting(true);
    window.open(link.href, "_blank", "noopener");
  }

  async function rewrite() {
    if (!data) return;
    const result = await run(() => post<{ text: string; fallback: boolean }>(`/api/hunt/${data.id}/pitch/rewrite`));
    if (!result) return;
    setText(result.text);
    writeDraft(draftKey, result.text);
    toast({ text: result.fallback ? "AI написал запрещённую фразу — текст не изменён" : "AI переписал текст — проверьте" });
  }

  async function markSent() {
    if (!data || !channel) return;
    setBusy(true);
    setError("");
    try {
      try {
        await post(`/api/hunt/${data.id}/sent`, { channel, text });
      } catch (reason) {
        const canForce = ["OWNER", "ADMIN"].includes(user.role);
        if (!(reason instanceof ApiClientError && reason.code === "daily_limit" && canForce && window.confirm(`${reason.message}\n\nВсё равно отметить?`))) throw reason;
        await post(`/api/hunt/${data.id}/sent`, { channel, text, force: true });
      }
      writeDraft(draftKey, null);
      refresh();
      await goNext("Отмечено, напомню через 3 дня");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function followUp() {
    if (!data || !channel) return;
    const result = await run(() => post<{ next: string | null }>(`/api/hunt/${data.id}/followup`, { channel }));
    if (!result) return;
    refresh();
    await goNext(result.next ? `Напоминание отмечено, следующее ${dayLabel(result.next)}` : "Три напоминания без ответа — в «спящих»");
  }

  async function setStatus(next: string) {
    if (!data) return;
    if (next === "optout" && !window.confirm("Контакт попадёт в стоп-лист, писать ему больше будет нельзя. Продолжить?")) return;
    const result = await run(() => post<{ projectId: string | null }>(`/api/hunt/${data.id}/status`, { status: next }));
    if (!result) return;
    refresh();
    if (result.projectId && !data.projectId) {
      toast({ text: "Создан проект с чек-листом и JSON", action: { label: "Открыть", run: () => open("project", result.projectId!, true) } });
    } else toast({ text: `Статус: ${STATUS_LABEL[next]}` });
  }

  const hook = data ? hookOf(data.card) : null;
  const canWrite = data && data.cardStatus === "ready" && !data.blocked;

  const footer = data && canWrite ? (
    writing || followUpMode ? (
      <div className="space-y-3">
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
          {CHANNELS.map((item) => <Chip key={item.key} active={channel === item.key} onClick={() => setChannel(item.key)}>{item.label}</Chip>)}
        </div>
        <Button variant="accent" size="lg" className="w-full" pending={busy} disabled={!channel || banned.length > 0 || !text.trim()} onClick={() => (followUpMode ? followUp() : markSent())}>
          <Check className="h-5 w-5" /> {followUpMode ? "Напомнил" : "Отправил"}{channel ? ` · ${CHANNELS.find((item) => item.key === channel)?.label}` : ""}
        </Button>
      </div>
    ) : firstContact && !rejecting ? (
      <div className="grid grid-cols-[48px_48px_minmax(0,1fr)] gap-2 sm:grid-cols-[56px_56px_minmax(0,1fr)]">
        <Button variant="danger" size="lg" className="px-0" aria-label="Отклонить" onClick={() => setRejecting(true)}><X className="h-6 w-6" /></Button>
        <Button variant="glass" size="lg" className="px-0" aria-label="Отложить на 3 дня" pending={busy} onClick={() => decide("snooze")}><Clock className="h-5 w-5" /></Button>
        <Button variant="accent" size="lg" className="px-3" pending={busy} onClick={() => decide("approve")}><PenLine className="h-5 w-5 max-[359px]:hidden" /> Написать</Button>
      </div>
    ) : null
  ) : null;

  return (
    <Sheet
      open={Boolean(id)}
      onClose={close}
      title={data?.organization.name ?? "Карточка"}
      subtitle={data ? [data.organization.city, data.segmentLabel, STATUS_LABEL[data.status]].filter(Boolean).join(" · ") : null}
      badge={data ? <PriorityBadge priority={data.priority} score={data.score} /> : null}
      footer={footer}
    >
      {!data ? (item.error ? <Notice tone="error">{item.error}</Notice> : <Skeleton rows={3} />) : (
        <div className="space-y-5">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {returned && (writing || followUpMode) ? <Notice tone="ok">Вернулись из чата. Если сообщение ушло — нажмите «{followUpMode ? "Напомнил" : "Отправил"}» внизу, тогда напоминания пойдут по плану.</Notice> : null}
          {data.blocked ? <Notice tone="error">{data.blocked} Писать нельзя.</Notice> : null}
          {data.cardStatus !== "ready" ? <Notice tone="warn">Нет подтверждённого факта денег или хаоса — по стоп-правилу писать нельзя.</Notice> : null}

          {hook ? <div className="tint-orange rounded-2xl border px-4 py-3 text-[15px] leading-6">«{hook}»</div> : null}

          {data.card ? (
            <div className="space-y-4">
              <FactList label="Деньги" items={data.card.money} tone="money" />
              <FactList label="Хаос" items={data.card.chaos} tone="chaos" />
              <FactList label="Рост" items={data.card.growth} tone="growth" />
              {data.card.calc ? <p className="text-sm text-[var(--h-muted)]">{data.card.calc.text}</p> : null}
              {data.card.caseRef ? <p className="text-sm text-[var(--h-muted)]">Кейс NEEKLO: <b className="font-semibold text-[var(--h-text)]">{data.card.caseRef}</b></p> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {data.organization.sourceUrl ? <a className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm" href={data.organization.sourceUrl} target="_blank" rel="noreferrer">Источник <ExternalLink className="h-3.5 w-3.5" /></a> : null}
            {data.organization.website ? <a className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm" href={data.organization.website} target="_blank" rel="noreferrer">Сайт <ExternalLink className="h-3.5 w-3.5" /></a> : null}
            <button className="glass inline-flex h-9 items-center rounded-full px-3.5 text-sm" onClick={() => setShowFactors((value) => !value)}>{showFactors ? "Скрыть баллы" : "Из чего баллы"}</button>
            {data.projectId ? <button className="tint-yellow inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm" onClick={() => open("project", data.projectId!, true)}><FolderKanban className="h-4 w-4" /> Проект</button> : null}
          </div>

          {showFactors && data.factors ? (
            <ul className="glass space-y-1.5 rounded-2xl p-4 text-sm">
              {data.factors.map((factor) => (
                <li key={factor.key} className={cx("flex justify-between gap-3", !factor.hit && "text-[var(--h-faint)]")}>
                  <span>{factor.label}</span>
                  <span className="tabular-nums">{factor.hit ? (factor.points > 0 ? `+${factor.points}` : factor.points) : "0"}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {rejecting ? (
            <div className="glass rounded-2xl p-4">
              <div className="mb-3 text-sm font-medium">Почему не подходит?</div>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((reason) => <Chip key={reason} disabled={busy} onClick={() => decide("reject", reason)}>{reason}</Chip>)}
              </div>
              <button className="mt-3 text-sm text-[var(--h-muted)]" onClick={() => setRejecting(false)}>Отмена</button>
            </div>
          ) : null}

          {(writing || followUpMode) && canWrite ? (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold">{followUpMode ? `Напоминание ${data.followUpStep + 1} из 3` : "Сообщение"}</h3>
                {followUpMode ? <span className="text-sm text-[var(--h-muted)]">первое — {dayLabel(data.sentAt)}</span> : null}
              </div>
              <textarea value={text} onChange={(event) => { setText(event.target.value); if (writing) writeDraft(draftKey, event.target.value); }} rows={8} className={textareaClass} aria-label="Текст сообщения" />
              {banned.length ? <Notice tone="error">Уберите «{banned.join("», «")}» — такие сообщения игнорируют.</Notice> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={copy}><Copy className="h-4 w-4" /> Копировать</Button>
                {writing ? <Button size="sm" pending={busy} onClick={rewrite}><Sparkles className="h-4 w-4" /> Переписать AI</Button> : null}
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-[var(--h-muted)]">Открыть чат и отправить самому</div>
                {data.links.length ? (
                  <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
                    {data.links.map((link) => (
                      <button key={link.href} disabled={banned.length > 0} onClick={() => openLink(link)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition hover:bg-white/5 disabled:opacity-45">
                        <span className="text-[var(--h-accent)]"><LinkIcon kind={link.kind} /></span>
                        <span className="min-w-0 flex-1 truncate text-[15px]">{link.label}</span>
                        {link.prefill ? <span className="text-xs text-[var(--h-faint)]">с текстом</span> : null}
                      </button>
                    ))}
                  </div>
                ) : <p className="text-sm text-[var(--h-muted)]">Контактов нет — найдите их по ссылке на источник.</p>}
              </div>
            </section>
          ) : null}

          {data.status === "sent" && !followUpMode ? (
            <Notice>Отправлено {dayLabel(data.sentAt)}. {data.nextFollowUpAt ? `Напоминание ${data.followUpStep + 1} из 3 — ${dayLabel(data.nextFollowUpAt)}.` : ""}</Notice>
          ) : null}

          {data.cardStatus === "no_fact" && firstContact && data.card ? (
            <section className="tint-yellow space-y-3 rounded-2xl border p-4">
              <div>
                <h3 className="text-lg font-semibold">Проверьте карточку</h3>
                <p className="mt-1 text-sm text-[var(--h-muted)]">Парсер не нашёл {data.card.money.length ? "хаоса" : "признака денег"}. Откройте источник и, если видите факт, отметьте его — карточка пересчитается.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(data.card.money.length ? CHAOS_CHIPS : MONEY_CHIPS).map((chip) => <Chip key={chip} disabled={busy} onClick={() => addFact(data.card!.money.length ? "chaos" : "money", chip)}>{chip}</Chip>)}
              </div>
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void addFact(data.card!.money.length ? "chaos" : "money", factText); }}>
                <input value={factText} onChange={(event) => setFactText(event.target.value)} placeholder={data.card.money.length ? "Свой факт: «заказы только в директ»" : "Свой факт: «3 точки в городе»"} className="h-11 min-w-0 flex-1 rounded-full border border-[var(--h-line)] bg-white/[0.04] px-4 text-[15px] outline-none focus:border-[var(--h-accent)]" />
                <Button size="md" variant="light" disabled={busy || factText.trim().length < 3} aria-label="Добавить факт"><ArrowRight className="h-4 w-4" /></Button>
              </form>
            </section>
          ) : null}

          {data.actionDue ? <Notice tone="warn">Срок следующего шага по диалогу — сегодня. Ответьте клиенту или отметьте, что дальше.</Notice> : null}

          {["replied", "demo", "call"].includes(data.status) ? (
            <section>
              <h3 className="mb-2 text-lg font-semibold">Ответить клиенту</h3>
              <div className="space-y-2">
                {replyTemplates(scenarioOf(data.segment)).map((item) => (
                  <button key={item.key} onClick={() => navigator.clipboard.writeText(item.text).then(() => toast({ text: "Текст скопирован — вставьте в чат" })).catch(() => toast({ text: "Скопируйте вручную", tone: "error" }))} className="glass block w-full rounded-2xl p-3.5 text-left transition hover:bg-white/[0.07]">
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--h-accent)]">{item.label}<Copy className="h-3.5 w-3.5" /></div>
                    <p className="mt-1 text-[15px] leading-[21px] text-[var(--h-muted)]">{item.text}</p>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {NEXT[data.status] ? (
            <section>
              <h3 className="mb-2 text-lg font-semibold">Что дальше</h3>
              <div className="flex flex-wrap gap-2">
                {NEXT[data.status].map((key) => (
                  <Button key={key} size="md" variant={key === "replied" || key === "won" ? "light" : key === "optout" ? "danger" : "glass"} pending={busy} onClick={() => setStatus(key)}>{STATUS_LABEL[key]}</Button>
                ))}
              </div>
              {["replied", "call", "estimate"].includes(data.status) && data.links.some((link) => link.kind === "phone") ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.links.filter((link) => link.kind === "phone").map((link) => <a key={link.href} href={link.href} className="glass inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px]"><Phone className="h-4 w-4 text-[var(--h-accent)]" /> {link.label}</a>)}
                </div>
              ) : null}
              {["replied", "demo"].includes(data.status) ? <p className="mt-2 text-xs text-[var(--h-faint)]">Смета — после созвона, как в стратегии. «Смета» и «Сделка» сами создают проект с чек-листом и JSON.</p> : null}
            </section>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
