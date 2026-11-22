"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { formatDate } from "@/lib/domain/labels";

type Board = { id: string; key: string; name: string; leads: { id: string; organizationId: string; name: string; city: string | null; score: number | null; value: number | null }[] }[];
type Deal = { id: string; title: string; status: string; value: string | number | null; organization: { name: string } };
type Task = { id: string; title: string; status: string; dueAt: string | null; assigneeId: string | null };

export default function CrmPage() {
  const board = useResource<Board>("/api/crm/board");
  const deals = useResource<Deal[]>("/api/crm/deals");
  const tasks = useResource<Task[]>("/api/crm/tasks");
  const stages = useResource<{ id: string; key: string; name: string }[]>("/api/crm/stages");
  const [view, setView] = useState<"board" | "table">("board");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<string | null>(null);

  async function move(leadId: string, stageKey: string) {
    setError("");
    try {
      await api(`/api/crm/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ stageKey }) });
      await board.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Стадия не изменена");
    }
  }

  return (
    <div>
      <PageTitle title="CRM и сделки" text="Воронка строится по реальным лидам пространства. Перетаскивание и список меняют одну и ту же стадию." action={<Button variant="secondary" onClick={() => setView(view === "board" ? "table" : "board")}>{view === "board" ? "Таблица" : "Доска"}</Button>} />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {board.loading ? <Loading /> : board.error ? <State title="Воронка недоступна" text={board.error} /> : view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {(board.data ?? []).map((stage) => (
            <div key={stage.id} className="w-64 shrink-0 rounded-2xl bg-slate-100 p-3" onDragOver={(event) => event.preventDefault()} onDrop={() => { if (drag) void move(drag, stage.key); setDrag(null); }}>
              <div className="mb-2 flex justify-between text-sm font-semibold"><span>{stage.name}</span><span>{stage.leads.length}</span></div>
              {stage.leads.length === 0 ? <p className="text-xs text-slate-500">Пусто</p> : stage.leads.map((lead) => (
                <div key={lead.id} draggable onDragStart={() => setDrag(lead.id)} className="mb-2 cursor-grab rounded-xl border border-line bg-white p-3 text-sm">
                  <Link className="font-medium text-teal-800" href={`/organizations/${lead.organizationId}`}>{lead.name}</Link>
                  <p className="text-xs text-slate-500">{lead.city || "город не указан"} · оценка {lead.score ?? "—"}</p>
                  <select className="mt-2 w-full rounded-lg border border-line px-2 py-1 text-xs" value={stage.key} onChange={(event) => move(lead.id, event.target.value)}>
                    {(board.data ?? []).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Лид</th><th className="px-3 py-2 text-left">Стадия</th><th className="px-3 py-2 text-left">Оценка</th></tr></thead>
            <tbody>
              {(board.data ?? []).flatMap((stage) => stage.leads.map((lead) => (
                <tr key={lead.id} className="border-t border-line"><td className="px-3 py-2">{lead.name}</td><td className="px-3 py-2">{stage.name}</td><td className="px-3 py-2">{lead.score ?? "—"}</td></tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Сделки</h2>
          <form className="mb-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api("/api/crm/deals", { method: "POST", body: JSON.stringify({ organizationId: form.get("organizationId"), title: form.get("title"), value: form.get("value") ? Number(form.get("value")) : null }) }).then(() => deals.reload()).catch((reason) => setError(reason.message)); }}>
            <Field label="ID организации"><input name="organizationId" required className={controlClass} /></Field>
            <Field label="Название"><input name="title" required className={controlClass} /></Field>
            <Field label="Сумма"><input name="value" type="number" className={controlClass} /></Field>
            <Button type="submit">Создать сделку</Button>
          </form>
          {(deals.data ?? []).length === 0 ? <p className="text-sm text-slate-500">Сделок нет</p> : (deals.data ?? []).map((deal) => (
            <div key={deal.id} className="flex items-center justify-between border-t border-line py-2 text-sm">
              <span>{deal.title} · {deal.organization.name} · {deal.value ?? "сумма не указана"}</span>
              <select value={deal.status} className="rounded-lg border border-line px-2 py-1" onChange={(event) => api(`/api/crm/deals/${deal.id}`, { method: "PATCH", body: JSON.stringify({ status: event.target.value }) }).then(() => deals.reload())}>
                <option value="open">открыта</option><option value="won">выиграна</option><option value="lost">проиграна</option>
              </select>
            </div>
          ))}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Задачи</h2>
          <form className="mb-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api("/api/crm/tasks", { method: "POST", body: JSON.stringify({ title: form.get("title"), organizationId: form.get("organizationId") || undefined, dueAt: form.get("dueAt") || undefined }) }).then(() => tasks.reload()).catch((reason) => setError(reason.message)); }}>
            <Field label="Задача"><input name="title" required className={controlClass} /></Field>
            <Field label="ID организации"><input name="organizationId" className={controlClass} /></Field>
            <Field label="Срок"><input name="dueAt" type="datetime-local" className={controlClass} /></Field>
            <Button type="submit">Добавить</Button>
          </form>
          {tasks.error ? <p className="text-sm text-red-700">{tasks.error}</p> : (tasks.data ?? []).length === 0 ? <p className="text-sm text-slate-500">Задач нет</p> : (tasks.data ?? []).map((task) => (
            <div key={task.id} className="flex items-center justify-between border-t border-line py-2 text-sm">
              <span>{task.title}<span className="block text-xs text-slate-500">{task.dueAt ? formatDate(task.dueAt) : "без срока"}</span></span>
              <button className="text-teal-800" onClick={() => api(`/api/crm/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: task.status === "done" ? "open" : "done" }) }).then(() => tasks.reload())}>{task.status === "done" ? "Вернуть" : "Готово"}</button>
            </div>
          ))}
          <h3 className="mt-4 font-semibold">Свои стадии</h3>
          <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api("/api/crm/stages", { method: "POST", body: JSON.stringify({ key: form.get("key"), name: form.get("name") }) }).then(() => stages.reload()).catch((reason) => setError(reason.message)); }}>
            <input name="key" required className={controlClass} placeholder="ключ" />
            <input name="name" required className={controlClass} placeholder="название" />
            <Button type="submit" variant="secondary">Добавить</Button>
          </form>
          {(stages.data ?? []).map((stage) => <div key={stage.id} className="flex justify-between border-t border-line py-1 text-sm"><span>{stage.name}</span><button onClick={() => api(`/api/crm/stages/${stage.id}`, { method: "DELETE" }).then(() => { stages.reload(); board.reload(); }).catch((reason) => setError(reason.message))}>Удалить</button></div>)}
        </Card>
      </div>
    </div>
  );
}
