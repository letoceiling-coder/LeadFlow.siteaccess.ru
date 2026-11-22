"use client";

import { useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Loading, cnJoin } from "@/components/ui";
import { dayLabel } from "@/components/hunt";

type Template = { id: string; name: string; params: { city: string; category: string; searchQuery?: string; maxResults: number } };
type Task = { id: string; status: string; input: { city?: string; category?: string }; organizationCount: number | null; createdAt: string; error: string | null };
type Segment = { id: string; label: string; contour: string };
type Settings = { hunt: { activeSegments: string[]; dailyLimit: number; autoQualify: boolean; autoQualifyMax: number } };

/** Пресеты под активный контур стратегии: доставка, автосервисы. */
const SUGGESTED = [
  { name: "Доставка еды", category: "Доставка еды" },
  { name: "Суши и роллы", category: "Суши-бар" },
  { name: "Автосервисы", category: "Автосервис" },
  { name: "Шиномонтаж", category: "Шиномонтаж" },
  { name: "Натяжные потолки", category: "Натяжные потолки" },
];

const TASK_STATUS: Record<string, string> = { queued: "в очереди", running: "идёт", completed: "готово", failed: "ошибка", cancelled: "отменён" };

export default function HuntSearchPage() {
  const templates = useResource<Template[]>("/api/parser/templates");
  const tasks = useResource<Task[]>("/api/parser/tasks");
  const segments = useResource<Segment[]>("/api/hunt/segments");
  const settings = useResource<Settings>("/api/settings");
  const [city, setCity] = useState("Краснодар");
  const [category, setCategory] = useState("");
  const [max, setMax] = useState(50);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(ok);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  async function launch(params: { city: string; category: string; maxResults: number; searchQuery?: string }) {
    await act(async () => {
      const result = await api<{ duplicate?: boolean }>("/api/parser/tasks", { method: "POST", body: JSON.stringify({ ...params, searchQuery: params.searchQuery ?? "" }) });
      if (result.duplicate) throw new ApiClientError("Такой поиск уже был за последние сутки — результаты в базе.");
      await tasks.reload();
    }, `Поиск запущен: ${params.category}, ${params.city}. Новые карточки квалифицируются сами.`);
  }

  async function save() {
    if (!city.trim() || !category.trim()) return setError("Укажите город и категорию");
    await act(async () => {
      await api("/api/parser/templates", { method: "POST", body: JSON.stringify({ name: `${category} · ${city}`, params: { city, category, searchQuery: "", maxResults: max } }) });
      await templates.reload();
    }, "Пресет сохранён");
  }

  async function toggleSegment(id: string) {
    if (!settings.data) return;
    const current = settings.data.hunt.activeSegments;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    if (!next.length) return;
    await act(async () => {
      const saved = await api<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify({ hunt: { ...settings.data!.hunt, activeSegments: next } }) });
      settings.setData(saved);
    }, "Активный контур обновлён");
  }

  const active = settings.data?.hunt.activeSegments ?? [];

  return (
    <div className="mx-auto w-full max-w-xl pb-4">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight">Охота</h1>
      <p className="mt-1 text-sm text-slate-500">Поиск в Яндекс Картах. Новые карточки сами проходят скоринг, в ленту «Сегодня» попадают только A и B.</p>

      {notice ? <p className="mt-4 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-800">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <section className="mt-5 rounded-3xl border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Новый поиск</h2>
        <div className="mt-3 space-y-3">
          <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Город" className="h-12 w-full rounded-2xl border border-line bg-slate-50 px-4 text-base" />
          <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Что ищем: доставка еды, автосервис…" className="h-12 w-full rounded-2xl border border-line bg-slate-50 px-4 text-base" />
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((item) => (
              <button key={item.name} onClick={() => setCategory(item.category)} className={cnJoin("h-9 rounded-full border px-3 text-sm", category === item.category ? "border-ink bg-ink text-white" : "border-line")}>{item.name}</button>
            ))}
          </div>
          <label className="flex items-center justify-between text-sm">
            <span>Сколько карточек</span>
            <select value={max} onChange={(event) => setMax(Number(event.target.value))} className="h-10 rounded-xl border border-line bg-white px-3 text-base">
              {[20, 50, 100, 200].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button disabled={busy || !city.trim() || !category.trim()} onClick={() => launch({ city, category, maxResults: max })} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-teal-700 font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" /> Искать</button>
            <button disabled={busy} onClick={save} aria-label="Сохранить пресет" className="grid h-12 w-12 place-items-center rounded-2xl border border-line"><Plus className="h-5 w-5" /></button>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-lg font-semibold">Пресеты</h2>
        {templates.loading ? <Loading /> : (templates.data ?? []).length === 0 ? <p className="px-1 text-sm text-slate-500">Сохраните поиск кнопкой «+», чтобы запускать его в одно касание.</p> : (
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {(templates.data ?? []).map((item) => (
              <div key={item.id} className="flex min-h-14 items-center gap-2 px-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{item.name}</div>
                  <div className="text-xs text-slate-500">до {item.params.maxResults} карточек</div>
                </div>
                <button disabled={busy} onClick={() => launch(item.params)} aria-label="Запустить" className="grid h-11 w-11 place-items-center rounded-full bg-teal-50 text-teal-800"><Play className="h-4 w-4" /></button>
                <button disabled={busy} onClick={() => act(async () => { await api(`/api/parser/templates/${item.id}`, { method: "DELETE" }); await templates.reload(); }, "Пресет удалён")} aria-label="Удалить" className="grid h-11 w-11 place-items-center rounded-full text-slate-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-lg font-semibold">Последние поиски</h2>
        {tasks.loading ? <Loading /> : (tasks.data ?? []).length === 0 ? <p className="px-1 text-sm text-slate-500">Поисков ещё не было.</p> : (
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
            {(tasks.data ?? []).slice(0, 8).map((task) => (
              <div key={task.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{task.input.category} · {task.input.city}</div>
                  <div className="text-xs text-slate-500">{dayLabel(task.createdAt)}{task.organizationCount != null ? ` · ${task.organizationCount} карточек` : ""}</div>
                </div>
                <span className={cnJoin("text-xs font-medium", task.status === "failed" ? "text-red-700" : task.status === "completed" ? "text-emerald-700" : "text-amber-700")}>{TASK_STATUS[task.status] ?? task.status}</span>
              </div>
            ))}
          </div>
        )}
        <button disabled={busy} onClick={() => tasks.reload()} className="mt-2 h-10 px-1 text-sm text-teal-800">Обновить</button>
      </section>

      {settings.data && segments.data ? (
        <section className="mt-6">
          <h2 className="mb-1 px-1 text-lg font-semibold">Активный контур</h2>
          <p className="mb-3 px-1 text-sm text-slate-500">Квалифицируем только эти ниши. Стратегия советует не больше 3 сразу.</p>
          <div className="flex flex-wrap gap-2">
            {segments.data.map((item) => (
              <button key={item.id} disabled={busy} onClick={() => toggleSegment(item.id)} className={cnJoin("h-9 rounded-full border px-3 text-sm", active.includes(item.id) ? "border-teal-700 bg-teal-700 text-white" : "border-line bg-white")}>
                {item.id} {item.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
