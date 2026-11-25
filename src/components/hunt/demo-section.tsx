"use client";

import { useState } from "react";
import { Copy, Eye, Globe, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { post, useLive } from "./data";
import { Button, Notice, cx, errorText, textareaClass, useToast } from "./ui";
import { dayLabel } from "./types";

type Demo = {
  siteId: string;
  status: string;
  busy: boolean;
  error: string | null;
  question: string | null;
  questionKind: string | null;
  lastReply: string | null;
  lastPrompt: string | null;
  publicUrl: string | null;
  stale: boolean;
  message: string | null;
  createdAt: string;
  updatedAt: string;
} | null;

const STATUS: Record<string, string> = {
  queued: "В очереди на сборку",
  building: "Агент Studio собирает сайт",
  waiting_user: "Агент ждёт ответа",
  preview_ready: "Готово — посмотрите и опубликуйте",
  qa_passed: "Готово — посмотрите и опубликуйте",
  approved: "Готово — посмотрите и опубликуйте",
  publish_requested: "Публикуется",
  published: "Опубликовано — ссылку можно отправлять",
  failed: "Сборка не удалась",
};
const QUICK_EDITS = ["Сделай светлее и спокойнее", "Добавь блок с ценами-ориентирами", "Сократи тексты на первом экране", "Сделай акцент на кнопке записи"];

/** Демо-сайт лида: собрать в Studio → поправить словами → опубликовать → текст клиенту со ссылкой. */
export function DemoSection({ itemId, version, onChanged, highlight }: { itemId: string; version: number; onChanged: () => void; highlight: boolean }) {
  const toast = useToast();
  const [poll, setPoll] = useState(false);
  const live = useLive<Demo>(`/api/hunt/${itemId}/demo`, version, poll ? 6000 : false);
  const demo = live.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [wishes, setWishes] = useState("");
  const [askWishes, setAskWishes] = useState(false);

  // Пока агент работает — опрашиваем; как закончил — перестаём.
  const working = Boolean(demo?.busy);
  if (working !== poll) setPoll(working);

  async function run(path: string, body?: unknown, done?: string) {
    setBusy(true);
    setError("");
    try {
      const next = await post<Demo>(`/api/hunt/${itemId}/demo${path}`, body ?? {});
      live.setData(next);
      if (done) toast({ text: done });
      onChanged();
      return next;
    } catch (reason) {
      setError(errorText(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setBusy(true);
    setError("");
    // Окно открываем сразу, иначе браузер заблокирует всплывающее окно после await.
    const win = window.open("about:blank", "_blank");
    try {
      const result = await post<{ url: string }>(`/api/hunt/${itemId}/demo/preview`);
      if (win) win.location.href = result.url;
      else window.open(result.url, "_blank");
    } catch (reason) {
      win?.close();
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); toast({ text: label }); } catch { toast({ text: "Скопируйте вручную", tone: "error" }); }
  }

  async function sendEdit(value: string) {
    if (value.trim().length < 3) return;
    const next = await run("/edit", { text: value.trim() }, demo?.question ? "Ответ отправлен агенту" : "Правка отправлена — агент пересобирает");
    if (next) setText("");
  }

  const ready = demo && ["preview_ready", "qa_passed", "approved", "published"].includes(demo.status);

  return (
    <section className={cx("space-y-3 rounded-2xl border p-4", highlight ? "tint-blue" : "glass")}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold"><Globe className="h-5 w-5 text-[var(--h-accent)]" /> Демо-сайт</h3>
        {demo ? <span className="text-xs text-[var(--h-muted)]">обновлено {dayLabel(demo.updatedAt)}</span> : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {live.loading ? <p className="text-sm text-[var(--h-muted)]">Загрузка…</p> : !demo ? (
        <>
          <p className="text-sm text-[var(--h-muted)]">Studio соберёт сайт по фактам с карт, скану старого сайта и болям из карточки. Без вашего нажатия «Опубликовать» клиент его не увидит.</p>
          {askWishes ? <textarea value={wishes} onChange={(event) => setWishes(event.target.value)} rows={3} className={textareaClass} placeholder="Пожелания агенту: «тёмный, премиальный, акцент на доставке»" aria-label="Пожелания к демо" /> : null}
          <div className="flex flex-wrap gap-2">
            <Button size="md" variant="light" pending={busy} onClick={() => run("", { wishes: wishes.trim() || undefined }, "Сборка запущена — обычно 3–10 минут")}><Sparkles className="h-4 w-4" /> Собрать демо</Button>
            {!askWishes ? <Button size="md" onClick={() => setAskWishes(true)}>С пожеланиями</Button> : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[15px]">
            {demo.busy ? <Loader2 className="h-4 w-4 animate-spin text-[var(--h-accent)]" /> : null}
            <span className="font-medium">{STATUS[demo.status] ?? demo.status}</span>
          </div>
          {demo.busy ? <p className="text-sm text-[var(--h-muted)]">Можно закрыть карточку — сборка идёт на сервере, статус обновится сам.</p> : null}
          {demo.status === "failed" && demo.error ? <Notice tone="error">{demo.error.slice(0, 300)}</Notice> : null}
          {demo.stale ? <Notice tone="warn">После правки на публичной ссылке ещё старая версия — опубликуйте заново.</Notice> : null}

          {demo.question ? (
            <div className="rounded-2xl border border-[var(--h-line)] bg-white/[0.04] p-3.5">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--h-faint)]">Агент спрашивает</div>
              <p className="whitespace-pre-wrap text-[15px] leading-6">{demo.question}</p>
              {demo.questionKind === "plan" || demo.questionKind === "confirm" ? (
                <Button className="mt-3" size="sm" variant="light" pending={busy} onClick={() => sendEdit("Да, делай так. Собирай.")}>Да, собирай</Button>
              ) : null}
            </div>
          ) : null}

          {demo.publicUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <a href={demo.publicUrl} target="_blank" rel="noreferrer" className="glass inline-flex h-11 max-w-full items-center gap-1.5 truncate rounded-full px-4 text-[15px]">{demo.publicUrl.replace(/^https?:\/\//, "")}</a>
              <Button size="md" onClick={() => copy(demo.publicUrl!, "Ссылка скопирована")}><Copy className="h-4 w-4" /> Ссылка</Button>
            </div>
          ) : null}

          {demo.message ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--h-faint)]">Сообщение клиенту</div>
              <p className="whitespace-pre-wrap rounded-2xl border border-[var(--h-line)] bg-white/[0.04] p-3.5 text-[15px] leading-6">{demo.message}</p>
              <Button size="md" variant="light" onClick={() => copy(demo.message!, "Текст со ссылкой на демо скопирован — вставьте в MAX или другой чат")}><Send className="h-4 w-4" /> Скопировать текст</Button>
            </div>
          ) : null}

          {!demo.busy ? (
            <div className="flex flex-wrap gap-2">
              {demo.status !== "failed" ? <Button size="md" pending={busy} onClick={preview}><Eye className="h-4 w-4" /> Превью</Button> : null}
              {ready && (!demo.publicUrl || demo.stale) ? <Button size="md" variant="accent" pending={busy} onClick={() => run("/publish", {}, "Демо опубликовано")}><Globe className="h-4 w-4" /> {demo.publicUrl ? "Опубликовать заново" : "Опубликовать"}</Button> : null}
              <Button size="md" pending={busy} onClick={() => { if (window.confirm("Собрать демо заново с нуля? Текущая версия останется в Studio, но в карточке её заменит новая.")) void run("/rebuild", {}, "Пересборка запущена"); }}><RefreshCw className="h-4 w-4" /> Заново</Button>
            </div>
          ) : null}

          {!demo.busy ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--h-faint)]">{demo.question ? "Ответ агенту" : "Правка словами"}</div>
              {!demo.question && ready ? (
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_EDITS.map((item) => <button key={item} disabled={busy} onClick={() => setText(item)} className="rounded-full bg-white/10 px-2.5 py-1 text-xs transition hover:bg-white/15 disabled:opacity-50">{item}</button>)}
                </div>
              ) : null}
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void sendEdit(text); }}>
                <input value={text} onChange={(event) => setText(event.target.value)} placeholder={demo.question ? "Ответьте агенту" : "Например: поменяй цвет на зелёный, добавь отзывы"} className="h-11 min-w-0 flex-1 rounded-full border border-[var(--h-line)] bg-white/[0.04] px-4 text-[15px] outline-none focus:border-[var(--h-accent)]" />
                <Button size="md" variant="light" pending={busy} disabled={text.trim().length < 3} aria-label="Отправить агенту"><Send className="h-4 w-4" /></Button>
              </form>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
