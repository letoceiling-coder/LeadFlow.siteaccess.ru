"use client";

import { useState } from "react";
import { Check, Copy, MessageSquareQuote, Send } from "lucide-react";
import { post } from "./data";
import { copyAndOpen, CHANNEL_LABEL, TOUCH_LABEL } from "./chat-open";
import { Button, Notice, cx, errorText, textareaClass, useToast } from "./ui";
import { dayLabel, type ChatTarget, type ReplyNext } from "./types";

const TYPE_LABEL: Record<string, string> = { interested: "Интересно", price: "Цена", has_site: "Есть сайт", not_now: "Не сейчас", refusal: "Отказ" };
const TYPE_TONE: Record<string, string> = { interested: "tint-green", price: "tint-yellow", has_site: "tint-blue", not_now: "tint-violet", refusal: "border-[rgba(255,100,100,0.3)] bg-[rgba(255,100,100,0.08)]" };

type Reply = { id: string; type: string; quote: string; method: string; next: ReplyNext | null; createdAt: string };
type Task = { id: string; kind: string; title: string; status: string; dueAt: string | null; doneAt: string | null };
type Touch = { id: string; kind: string; channel: string; variant: string | null; text: string; sentAt: string };

function NextStep({ next, targets }: { next: ReplyNext; targets: ChatTarget[] }) {
  const toast = useToast();
  const [text, setText] = useState(next.text);
  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--h-muted)]">{next.hint}</p>
      {next.questions.length ? <ul className="list-disc space-y-0.5 pl-5 text-[15px]">{next.questions.map((q) => <li key={q}>{q}</li>)}</ul> : null}
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} className={textareaClass} aria-label="Ответ клиенту" />
      <div className="flex flex-wrap gap-2">
        {targets[0] ? (
          <Button size="md" variant="light" onClick={() => { copyAndOpen(text, targets[0]); toast({ text: targets[0].href ? "Текст скопирован — вставьте в чат" : targets[0].hint ?? "Текст скопирован" }); }}><Send className="h-4 w-4" /> Скопировать и открыть</Button>
        ) : null}
        <Button size="md" onClick={() => { copyAndOpen(text, null); toast({ text: "Текст скопирован" }); }}><Copy className="h-4 w-4" /> Копировать</Button>
      </div>
    </div>
  );
}

/** Сценарий 5: вставка ответа → тип, цитата, следующий шаг вопросами; задачи на фрагмент или демо; история касаний. */
export function ReplyBox({ itemId, replies, tasks, touches, targets, canReply, onChanged }: { itemId: string; replies: Reply[]; tasks: Task[]; touches: Touch[]; targets: ChatTarget[]; canReply: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<{ type: string; quote: string; next: ReplyNext; method: string } | null>(null);

  async function parse() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ type: string; quote: string; next: ReplyNext; method: string; taskId: string | null }>(`/api/hunt/${itemId}/reply`, { text });
      setFresh(result);
      setText("");
      toast({ text: `Ответ: ${TYPE_LABEL[result.type]}${result.taskId ? " · задача поставлена" : ""}` });
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function done(taskId: string) {
    try {
      await post(`/api/hunt/tasks/${taskId}/done`);
      toast({ text: "Задача закрыта — отправьте результат клиенту" });
      onChanged();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    }
  }

  const open = tasks.filter((task) => task.status === "open");
  const shown = fresh ?? (replies[0]?.next ? { type: replies[0].type, quote: replies[0].quote, next: replies[0].next, method: replies[0].method } : null);

  return (
    <section className="space-y-4">
      {open.length ? (
        <div className="space-y-2">
          {open.map((task) => (
            <div key={task.id} className="tint-yellow flex items-center gap-3 rounded-2xl border px-4 py-3">
              <div className="min-w-0 flex-1"><div className="font-medium">{task.title}</div><div className="text-xs text-[var(--h-muted)]">{task.dueAt ? `срок ${dayLabel(task.dueAt)}` : ""}</div></div>
              <Button size="md" variant="light" onClick={() => done(task.id)}><Check className="h-4 w-4" /> Готово</Button>
            </div>
          ))}
        </div>
      ) : null}

      {canReply ? (
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-lg font-semibold"><MessageSquareQuote className="h-5 w-5 text-[var(--h-accent)]" /> Ответ клиента</h3>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} className={textareaClass} placeholder="Вставьте ответ дословно, например: «сколько стоит?»" aria-label="Ответ клиента" />
          <Button size="md" variant="accent" className="w-full" pending={busy} disabled={!text.trim()} onClick={parse}>Разобрать ответ</Button>
        </div>
      ) : null}

      {shown ? (
        <div className={cx("space-y-3 rounded-2xl border p-4", TYPE_TONE[shown.type])}>
          <div className="flex items-baseline justify-between gap-3"><b className="font-semibold">{TYPE_LABEL[shown.type] ?? shown.type}</b><span className="text-xs text-[var(--h-faint)]">{shown.method === "ai" ? "AI" : "по словам"}</span></div>
          <blockquote className="border-l-2 border-[var(--h-line)] pl-3 text-[15px] italic">«{shown.quote}»</blockquote>
          <NextStep key={shown.quote} next={shown.next} targets={targets} />
        </div>
      ) : null}

      {replies.length > 1 ? (
        <details className="text-sm"><summary className="cursor-pointer text-[var(--h-muted)]">Все ответы ({replies.length})</summary>
          <ul className="mt-2 space-y-1.5">{replies.map((item) => <li key={item.id}><b>{TYPE_LABEL[item.type]}</b> · {dayLabel(item.createdAt)} — «{item.quote.slice(0, 160)}»</li>)}</ul>
        </details>
      ) : null}

      {touches.length ? (
        <details className="text-sm"><summary className="cursor-pointer text-[var(--h-muted)]">Касания ({touches.length})</summary>
          <ul className="mt-2 space-y-1.5">{touches.map((item) => <li key={item.id}><b>{TOUCH_LABEL[item.kind] ?? item.kind}</b> · {CHANNEL_LABEL[item.channel] ?? item.channel}{item.variant ? ` · вариант ${item.variant}` : ""} · {dayLabel(item.sentAt)}<div className="line-clamp-2 text-[var(--h-faint)]">{item.text}</div></li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
