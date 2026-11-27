"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock, Copy, ExternalLink, FolderKanban, Mail, MessageCircle, Phone, Send, Sparkles, X } from "lucide-react";
import { bannedIn } from "@/lib/domain/pitch";
import { buildDrafts, hasPlaceholder, MAX_WORDS } from "@/lib/domain/drafts";
import { wordCount } from "@/lib/domain/dossier";
import { DossierCard } from "./item-dossier";
import { ReplyBox } from "./item-reply";
import { copyAndOpen, saveTouch } from "./chat-open";
import { useHunt } from "./shell";
import { post, useLive } from "./data";
import { DemoSection } from "./demo-section";
import { Button, Chip, Notice, PriorityBadge, Segmented, Sheet, Skeleton, cx, errorText, textareaClass, useToast } from "./ui";
import { SOURCE_LABEL, STATUS_LABEL, dayLabel, hookOf, type CardFact, type ChatTarget, type Dossier, type ObservationCard, type ReplyNext } from "./types";

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
  site: { ok: boolean; error: string | null; viewport: boolean; booking: boolean; cart: boolean; prices: boolean; form: boolean; https: boolean; builder: string | null; copyrightYear: number | null; emails: string[]; links: { kind: string }[]; scannedAt: string } | null;
  proposal: { url: string; text: string; title: string; ai: boolean; createdAt: string } | null;
  preset: string | null;
  presetLabel: string | null;
  grade: string | null;
  dossier: Dossier | null;
  drafts: { A: string; B: string } | null;
  variant: string | null;
  touchKind: "day4" | "day8" | null;
  targets: ChatTarget[];
  touches: { id: string; kind: string; channel: string; variant: string | null; text: string; sentAt: string }[];
  replies: { id: string; type: string; quote: string; method: string; next: ReplyNext | null; createdAt: string }[];
  tasks: { id: string; kind: string; title: string; status: string; dueAt: string | null; doneAt: string | null }[];
};

type Variant = "A" | "B";

function SiteScanRow({ site }: { site: NonNullable<Item["site"]> }) {
  if (!site.ok) return <Notice tone="warn">Сайт не открылся при проверке{site.error ? `: ${site.error.slice(0, 80)}` : ""}.</Notice>;
  const marks: [string, boolean][] = [["Адаптив", site.viewport], ["Запись", site.booking], ["Корзина", site.cart], ["Цены", site.prices], ["Форма", site.form], ["https", site.https]];
  const found = site.emails.length + site.links.length;
  return (
    <div className="glass rounded-2xl p-3.5">
      <div className="mb-2 flex items-baseline justify-between text-sm"><span className="font-medium">Сайт проверен</span><span className="text-xs text-[var(--h-faint)]">{dayLabel(site.scannedAt)}</span></div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {marks.map(([label, ok]) => <span key={label} className={cx("rounded-full px-2 py-0.5", ok ? "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]" : "bg-[rgba(255,100,100,0.14)] text-[#ff9b9b]")}>{ok ? "✓" : "✗"} {label}</span>)}
        {site.builder ? <span className="rounded-full bg-white/10 px-2 py-0.5">конструктор {site.builder}</span> : null}
        {site.copyrightYear ? <span className="rounded-full bg-white/10 px-2 py-0.5">© {site.copyrightYear}</span> : null}
      </div>
      {found ? <p className="mt-2 text-xs text-[var(--h-muted)]">С сайта добавлено контактов: {found}{site.emails.length ? ` (почта: ${site.emails.join(", ")})` : ""}</p> : null}
    </div>
  );
}

const CHANNELS = [
  { key: "telegram", label: "Telegram" },
  { key: "max", label: "MAX" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "vk", label: "VK" },
  { key: "email", label: "Почта" },
  { key: "phone", label: "Звонок" },
  { key: "instagram", label: "Instagram" },
  { key: "avito", label: "Авито" },
  { key: "other", label: "Другое" },
];
const KIND_TO_CHANNEL: Record<string, string> = { telegram: "telegram", max: "max", whatsapp: "whatsapp", vk: "vk", email: "email", phone: "phone", instagram: "instagram", link: "other" };
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
  useEffect(() => { setReturned(false); setAwaiting(false); setTouched(null); }, [id]);

  const firstContact = data ? ["new", "approved", "snoozed"].includes(data.status) : false;
  const followUpMode = Boolean(data?.followUpDue);
  const [variant, setVariant] = useState<Variant>("A");
  const [targetIndex, setTargetIndex] = useState(0);
  const [touched, setTouched] = useState<{ touchId: string; label: string } | null>(null);
  const draftKey = data ? `lf-pitch-${data.id}-${variant}` : "";
  // Черновики A/B: из квалификации; у старых карточек — собираем на месте из крючка.
  const drafts = useMemo(() => (data ? data.drafts ?? buildDrafts({ preset: data.preset as "А" | null, hook: data.dossier?.hook ?? data.card?.observation ?? null, topic: data.dossier?.topic, category: data.organization.category, segment: data.segment }) : null), [data]);

  // Текст заполняется один раз на карточку и режим — перезагрузка данных не стирает правки.
  useEffect(() => {
    if (!data) return;
    const key = `${data.id}:${followUpMode ? `f${data.followUpStep}` : "p"}`;
    if (initFor.current === key) return;
    initFor.current = key;
    const v: Variant = data.variant === "B" ? "B" : "A";
    setVariant(v);
    setText(followUpMode ? data.followUp ?? "" : readDraft(`lf-pitch-${data.id}-${v}`) ?? drafts?.[v] ?? data.pitch);
    setChannel(data.lastChannel ?? (data.links[0] ? KIND_TO_CHANNEL[data.links[0].kind] ?? null : null));
    setTargetIndex(0);
    setRejecting(false);
    setError("");
  }, [data, followUpMode, drafts]);

  function switchVariant(next: Variant) {
    if (!data || next === variant) return;
    writeDraft(`lf-pitch-${data.id}-${variant}`, text);
    setVariant(next);
    setText(readDraft(`lf-pitch-${data.id}-${next}`) ?? drafts?.[next] ?? data.pitch);
  }

  /** Одно нажатие: копирует текст, открывает Telegram или MAX и записывает касание (канал, вариант, текст, время). */
  function sendTouch() {
    if (!data) return;
    const target = data.targets[targetIndex] ?? null;
    const sendChannel = target?.channel ?? channel;
    if (!sendChannel) { setError("Выберите, куда отправляете"); return; }
    copyAndOpen(text, target);
    if (target && !target.href && target.hint) toast({ text: target.hint });
    setBusy(true);
    setError("");
    const kind = followUpMode ? "followup" : "first";
    saveTouch(data.id, { kind, channel: sendChannel, variant: followUpMode ? null : variant, text }, user.role)
      .then((result) => {
        if (!followUpMode) { writeDraft(`lf-pitch-${data.id}-A`, null); writeDraft(`lf-pitch-${data.id}-B`, null); }
        const label = `${followUpMode ? (data.touchKind === "day8" ? "день 8" : "день 4") : `вариант ${variant}`} · ${sendChannel === "max" ? "MAX" : sendChannel === "telegram" ? "Telegram" : CHANNELS.find((item) => item.key === sendChannel)?.label ?? sendChannel}`;
        setTouched({ touchId: result.touchId, label });
        toast({ text: result.silent ? "Касание дня 8 записано — дальше пауза, статус «Тишина»" : "Касание записано", action: { label: "Отменить", run: () => { void post(`/api/hunt/touches/${result.touchId}/undo`).then(() => { setTouched(null); initFor.current = ""; refresh(); }).catch((reason) => toast({ text: errorText(reason), tone: "error" })); } } });
        refresh();
      })
      .catch((reason) => setError(errorText(reason)))
      .finally(() => setBusy(false));
  }

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
    if (firstContact) writeDraft(draftKey, text);
    toast({ text: link.prefill ? "Текст подставлен — отправьте и вернитесь" : "Текст в буфере — вставьте в чат и отправьте" });
    if (link.kind !== "phone") setAwaiting(true);
    window.open(link.href, "_blank", "noopener");
  }

  async function rewrite() {
    if (!data) return;
    const result = await run(() => post<{ text: string; fallback: boolean }>(`/api/hunt/${data.id}/pitch/rewrite`, { text, preset: data.preset }));
    if (!result) return;
    setText(result.text);
    writeDraft(draftKey, result.text);
    toast({ text: result.fallback ? "AI нарушил правила (длина или запрещённая фраза) — текст не изменён" : "AI переписал текст — проверьте" });
  }

  async function buildProposal() {
    if (!data) return;
    const result = await run(() => post<{ url: string }>(`/api/hunt/${data.id}/proposal`, {}));
    if (result) {
      toast({ text: "КП готово", action: { label: "Открыть", run: () => window.open(result.url, "_blank") } });
      await item.reload();
    }
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
  const composing = Boolean(canWrite && (firstContact || followUpMode));
  const words = wordCount(text);
  const placeholder = hasPlaceholder(text);
  const cannotSend = banned.length > 0 || !text.trim() || placeholder || Boolean(data && !data.targets.length && !channel);
  const sendButton = data ? (
    <Button variant="accent" size="lg" className="w-full min-w-0 px-2 text-[15px]" pending={busy} disabled={cannotSend} onClick={sendTouch}>
      <Send className="h-5 w-5 shrink-0 max-[339px]:hidden" /> <span className="truncate">{data.targets.length ? "Скопировать и открыть чат" : "Скопировать и отметить"}</span>
    </Button>
  ) : null;

  // Футер — одна большая кнопка на всю ширину: на 375 px подпись помещается целиком.
  const footer = data && composing && !touched && !rejecting ? sendButton : null;

  return (
    <Sheet
      open={Boolean(id)}
      onClose={close}
      title={data?.organization.name ?? "Карточка"}
      subtitle={data ? [data.organization.city, data.segmentLabel, STATUS_LABEL[data.status]].filter(Boolean).join(" · ") : null}
      badge={data ? <PriorityBadge priority={data.grade ?? data.priority} score={data.score} /> : null}
      footer={footer}
    >
      {!data ? (item.error ? <Notice tone="error">{item.error}</Notice> : <Skeleton rows={3} />) : (
        <div className="space-y-5">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {returned && composing && !touched ? <Notice tone="ok">Вернулись из чата. Если сообщение ушло — выберите канал и нажмите «Скопировать и отметить» внизу, тогда касания дня 4 и 8 пойдут по плану.</Notice> : null}
          {data.blocked ? <Notice tone="error">{data.blocked} Писать нельзя.</Notice> : null}
          {data.cardStatus !== "ready" ? (
            <Notice tone="warn">
              {data.preset && data.preset !== "В"
                ? data.grade === "C"
                  ? "Оценка C: нет зацепки или контакта, по которому можно написать. Найдите личный контакт руководителя в описании канала или на сайте."
                  : "Зацепки нет (NOT_FOUND) — без реального факта о них не пишем."
                : "Нет подтверждённого факта денег или хаоса — по стоп-правилу писать нельзя."}
            </Notice>
          ) : null}

          {touched ? (
            <Notice tone="ok">
              <span className="flex items-center justify-between gap-3">
                <span>Касание записано ({touched.label}). Отправьте сообщение в чате.</span>
                <Button size="sm" variant="light" onClick={() => goNext()}>Дальше <ArrowRight className="h-4 w-4" /></Button>
              </span>
            </Notice>
          ) : null}

          {data.dossier ? <DossierCard dossier={data.dossier} presetLabel={data.presetLabel} /> : hook ? <div className="tint-orange rounded-2xl border px-4 py-3 text-[15px] leading-6">«{hook}»</div> : null}

          {composing && !touched && firstContact && !rejecting ? (
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={() => setRejecting(true)}><X className="h-4 w-4" /> Не подходит</Button>
              <Button size="sm" pending={busy} onClick={() => decide("snooze")}><Clock className="h-4 w-4" /> Отложить на 3 дня</Button>
            </div>
          ) : null}

          {composing && !touched ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{followUpMode ? (data.touchKind === "day8" ? "День 8: польза без продажи" : "День 4: пример или кейс") : "Первое сообщение"}</h3>
                {followUpMode ? <span className="text-sm text-[var(--h-muted)]">первое — {dayLabel(data.sentAt)}</span> : (
                  <Segmented<Variant> value={variant} onChange={switchVariant} items={[{ key: "A", label: "Вариант A" }, { key: "B", label: "Вариант B" }]} />
                )}
              </div>
              <textarea value={text} onChange={(event) => { setText(event.target.value); if (firstContact) writeDraft(draftKey, event.target.value); }} rows={8} className={textareaClass} aria-label="Текст сообщения" />
              <div className={cx("text-xs", words > MAX_WORDS ? "text-[#ff9b9b]" : "text-[var(--h-faint)]")}>{words} из {MAX_WORDS} слов{words > MAX_WORDS ? " — сократите, длинное не дочитывают" : ""}</div>
              {placeholder ? <Notice tone="warn">Замените текст в [квадратных скобках] реальным фактом из досье — без зацепки не отправить.</Notice> : null}
              {banned.length ? <Notice tone="error">Уберите «{banned.join("», «")}» — такие сообщения игнорируют.</Notice> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={copy}><Copy className="h-4 w-4" /> Копировать</Button>
                {firstContact ? <Button size="sm" pending={busy} onClick={rewrite}><Sparkles className="h-4 w-4" /> Переписать AI</Button> : null}
              </div>
              {data.targets.length ? (
                <div>
                  <div className="mb-2 text-sm font-medium text-[var(--h-muted)]">Куда откроется чат</div>
                  <div className="flex flex-wrap gap-2">
                    {data.targets.map((target, index) => <Chip key={target.label} active={index === targetIndex} onClick={() => setTargetIndex(index)}>{target.label}</Chip>)}
                  </div>
                  {data.targets[targetIndex]?.hint ? <p className="mt-2 text-xs text-[var(--h-faint)]">{data.targets[targetIndex].hint}</p> : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-[var(--h-muted)]">Telegram и MAX не найдены. Откройте другой канал, отправьте сами и отметьте, куда:</p>
                  {data.links.length ? (
                    <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
                      {data.links.map((link) => (
                        <button key={link.href} disabled={banned.length > 0} onClick={() => openLink(link)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition hover:bg-white/5 disabled:opacity-45">
                          <span className="text-[var(--h-accent)]"><LinkIcon kind={link.kind} /></span>
                          <span className="min-w-0 flex-1 truncate text-[15px]">{link.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-sm text-[var(--h-muted)]">Контактов нет — найдите их по ссылке на источник.</p>}
                  <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
                    {CHANNELS.map((item) => <Chip key={item.key} active={channel === item.key} onClick={() => setChannel(item.key)}>{item.label}</Chip>)}
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {["sent", "sleeping", "replied", "demo", "call", "estimate", "lost", "won"].includes(data.status) || data.tasks.length || data.touches.length ? (
            <ReplyBox itemId={data.id} replies={data.replies} tasks={data.tasks} touches={data.touches} targets={data.targets} canReply={["sent", "sleeping", "replied", "demo", "call", "estimate", "lost"].includes(data.status) && !data.blocked} onChanged={refresh} />
          ) : null}

          {data.card ? (
            <details className="text-sm" open={!data.dossier}>
            <summary className="cursor-pointer text-[var(--h-muted)]">Факты скоринга</summary>
            <div className="mt-3 space-y-4">
              <FactList label="Деньги" items={data.card.money} tone="money" />
              <FactList label="Хаос" items={data.card.chaos} tone="chaos" />
              <FactList label="Рост" items={data.card.growth} tone="growth" />
              {data.card.calc ? <p className="text-sm text-[var(--h-muted)]">{data.card.calc.text}</p> : null}
              {data.card.caseRef ? <p className="text-sm text-[var(--h-muted)]">Кейс NEEKLO: <b className="font-semibold text-[var(--h-text)]">{data.card.caseRef}</b></p> : null}
            </div>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {data.organization.sourceUrl ? <a className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm" href={data.organization.sourceUrl} target="_blank" rel="noreferrer">Источник <ExternalLink className="h-3.5 w-3.5" /></a> : null}
            {data.organization.website ? <a className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm" href={data.organization.website} target="_blank" rel="noreferrer">Сайт <ExternalLink className="h-3.5 w-3.5" /></a> : null}
            <button className="glass inline-flex h-9 items-center rounded-full px-3.5 text-sm" onClick={() => setShowFactors((value) => !value)}>{showFactors ? "Скрыть баллы" : "Из чего баллы"}</button>
            {data.projectId ? <button className="tint-yellow inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm" onClick={() => open("project", data.projectId!, true)}><FolderKanban className="h-4 w-4" /> Проект</button> : null}
          </div>

          {data.site ? <SiteScanRow site={data.site} /> : null}

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

          {data.status === "sent" && !followUpMode ? (
            <Notice>Отправлено {dayLabel(data.sentAt)}. {data.nextFollowUpAt ? `Напоминание ${data.followUpStep + 1} из 3 — ${dayLabel(data.nextFollowUpAt)}.` : ""}</Notice>
          ) : null}

          {data.cardStatus === "no_fact" && firstContact && data.card && (!data.preset || data.preset === "В") ? (
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

          {["approved", "sent", "sleeping", "replied", "demo", "call", "estimate", "won"].includes(data.status) && !data.blocked ? (
            <DemoSection itemId={data.id} version={version} onChanged={refresh} highlight={data.status === "replied"} />
          ) : null}

          {["replied", "demo", "call", "estimate", "won"].includes(data.status) ? (
            <section className="tint-yellow space-y-3 rounded-2xl border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-semibold">КП-презентация</h3>
                {data.proposal ? <span className="text-xs text-[var(--h-muted)]">{data.proposal.ai ? "AI · " : ""}{dayLabel(data.proposal.createdAt)}</span> : null}
              </div>
              {data.proposal ? (
                <>
                  <p className="text-sm text-[var(--h-muted)]">{data.proposal.title}. Три варианта с ценами, факты о бизнесе, этапы и кнопки связи. Клиент открывает по ссылке, вы видите, что он открыл.</p>
                  <div className="flex flex-wrap gap-2">
                    <a href={data.proposal.url} target="_blank" rel="noreferrer" className="glass inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px]">Открыть <ExternalLink className="h-4 w-4" /></a>
                    <Button size="md" variant="light" onClick={() => navigator.clipboard.writeText(data.proposal!.text).then(() => toast({ text: "Текст со ссылкой на КП скопирован" })).catch(() => toast({ text: "Скопируйте вручную", tone: "error" }))}><Copy className="h-4 w-4" /> Текст со ссылкой</Button>
                    <Button size="md" pending={busy} onClick={buildProposal}><Sparkles className="h-4 w-4" /> Пересобрать</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--h-muted)]">Собирается сразу после ответа клиента: вилка цен по нише, что увидели у бизнеса, этапы. Если не появилось — соберите вручную.</p>
                  <Button size="md" variant="light" pending={busy} onClick={buildProposal}><Sparkles className="h-4 w-4" /> Собрать КП</Button>
                </>
              )}
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
