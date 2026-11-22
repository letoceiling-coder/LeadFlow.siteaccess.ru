"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Button, controlClass } from "@/components/ui";

type Thread = { id: string; title: string; status: string; error: string | null; updatedAt: string };
type Message = { id: string; role: string; content: string; toolName: string | null; createdAt: string };
type OpenThread = Thread & { messages: Message[] };

const TOOL_LABEL: Record<string, string> = {
  search_memory: "Смотрю прошлые диалоги",
  parsing_coverage: "Смотрю, где уже был поиск",
  find_organizations: "Отбираю организации",
  start_search: "Запускаю парсер",
  wait_search: "Жду результат парсера",
  start_sites: "Запускаю генерацию сайтов",
  site_status: "Проверяю ссылки",
  publish_sites: "Публикую сайты",
};

export default function AgentPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [current, setCurrent] = useState<OpenThread | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const follow = useRef(true);
  const composer = useRef<HTMLTextAreaElement | null>(null);

  async function loadThreads() {
    const data = await api<{ threads: Thread[] }>("/api/agent");
    setThreads(data.threads);
  }

  async function openThread(id: string) {
    const data = await api<OpenThread>(`/api/agent/${id}`);
    setCurrent(data);
    setThreads((items) => items.map((item) => (item.id === id ? { ...item, status: data.status, title: data.title } : item)));
  }

  useEffect(() => { loadThreads().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Агент недоступен")); }, []);
  useEffect(() => {
    const node = scroller.current;
    if (!node || !follow.current) return;
    node.scrollTop = node.scrollHeight;
  }, [current?.id, current?.messages.length, current?.status]);

  function onChatScroll() {
    const node = scroller.current;
    if (!node) return;
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  function growComposer(node: HTMLTextAreaElement) {
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 128)}px`;
  }
  useEffect(() => {
    if (!current || current.status !== "running") return;
    const timer = setInterval(() => { openThread(current.id).catch(() => undefined); }, 2000);
    return () => clearInterval(timer);
  }, [current?.id, current?.status]);

  async function createThread() {
    setError("");
    const thread = await api<Thread>("/api/agent", { method: "POST" });
    setThreads((items) => [thread, ...items]);
    await openThread(thread.id);
  }

  async function send() {
    if (!current || !text.trim()) return;
    setPending(true);
    setError("");
    const message = text;
    setText("");
    if (composer.current) composer.current.style.height = "";
    try {
      await api(`/api/agent/${current.id}/messages`, { method: "POST", body: JSON.stringify({ text: message }) });
      await openThread(current.id);
    } catch (reason) {
      setText(message);
      setError(reason instanceof Error ? reason.message : "Сообщение не отправлено");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Агент</h1>
      </div>
      {error ? <p className="mb-2 shrink-0 text-sm text-red-700">{error}</p> : null}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,12rem)_minmax(0,1fr)] gap-3 lg:grid-cols-[240px_1fr] lg:grid-rows-1">
        <aside className="flex min-h-0 flex-col gap-2">
          <Button className="w-full shrink-0" onClick={() => createThread().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Диалог не создан"))}>Новый диалог</Button>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {threads.map((thread) => (
              <button key={thread.id} onClick={() => { follow.current = true; openThread(thread.id).catch(() => undefined); }} className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${current?.id === thread.id ? "border-teal-700 bg-teal-50" : "border-line bg-white"}`}>
                <span className="line-clamp-2">{thread.title}</span>
                <span className="mt-1 block text-xs text-slate-500">{thread.status === "running" ? "выполняет" : thread.status === "failed" ? "ошибка" : "готов"}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-white">
          <div ref={scroller} onScroll={onChatScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {!current ? <p className="text-sm text-slate-500">Откройте диалог и поставьте задачу своими словами. Например: найти организации без сайта, но с почтой или соцсетями, а затем собрать для них демо.</p> : null}
            {current?.messages.filter((item) => item.role !== "assistant" || item.content).map((item) => (
              <div key={item.id} className={item.role === "user" ? "ml-8 rounded-2xl bg-slate-900 px-3 py-2 text-sm text-white" : item.role === "tool" ? "text-xs text-slate-500" : "mr-8 rounded-2xl bg-slate-50 px-3 py-2 text-sm"}>
                {item.role === "tool" ? (TOOL_LABEL[item.toolName || ""] || item.toolName) : <span className="whitespace-pre-wrap">{item.content}</span>}
              </div>
            ))}
            {current?.status === "running" ? <p className="text-sm text-teal-800">Агент работает. Поле внизу остаётся доступным: Enter отправляет, Shift+Enter переносит строку.</p> : null}
            {current?.error && current.status === "failed" ? <p className="text-sm text-red-700">{current.error}</p> : null}
          </div>
          <form className="flex shrink-0 items-end gap-2 border-t border-line p-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea
              ref={composer}
              value={text}
              rows={1}
              placeholder={current ? "Напишите задание" : "Сначала откройте диалог"}
              className={`${controlClass} max-h-32 min-h-11 flex-1 resize-none`}
              onChange={(event) => { setText(event.target.value); growComposer(event.target); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Button type="submit" pending={pending} disabled={!current || !text.trim()}>Отправить</Button>
          </form>
        </section>
      </div>
    </div>
  );
}
