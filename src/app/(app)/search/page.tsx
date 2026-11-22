"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError, isSetupError } from "@/lib/client";
import { Badge, Button, Card, Field, PageTitle, State, controlClass } from "@/components/ui";
import { TASK_STATUS, formatDate } from "@/lib/domain/labels";
import { useResource } from "@/components/use-resource";

type Task = { id: string; status: string; progress: number; error: string | null; organizationCount: number | null; createdAt: string; input: { city?: string; category?: string; searchQuery?: string; maxResults?: number } };

export default function SearchPage() {
  const tasks = useResource<Task[]>("/api/parser/tasks");
  const templates = useResource<{ id: string; name: string; params: Record<string, unknown> }[]>("/api/parser/templates");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const source = new EventSource(`/api/parser/tasks/${active}/events`);
    source.addEventListener("task", () => tasks.reload());
    source.addEventListener("end", () => { tasks.reload(); source.close(); });
    source.onerror = () => source.close();
    const poll = setInterval(() => tasks.reload(), 5000);
    return () => { source.close(); clearInterval(poll); };
  }, [active, tasks.reload]);

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    setMessage("");
    const maxResults = Number(formData.get("maxResults") || 20);
    const cities = String(formData.get("cities") || "").split(",").map((item) => item.trim()).filter(Boolean);
    const payload = {
      region: String(formData.get("region") || ""),
      category: String(formData.get("category") || ""),
      searchQuery: String(formData.get("searchQuery") || ""),
      maxResults,
      includePhotos: formData.get("includePhotos") === "on",
      outputFormat: "json",
      confirmLarge: formData.get("confirmLarge") === "on",
      force: formData.get("force") === "on",
    };
    try {
      if (cities.length > 1) {
        const result = await api<{ tasks: { task: Task; duplicate: boolean }[] }>("/api/parser/tasks/batch", { method: "POST", body: JSON.stringify({ ...payload, cities }) });
        setMessage(`Создано задач: ${result.tasks.length}. Одинаковые параметры за сутки не запускаются повторно.`);
        setActive(result.tasks[0]?.task.id ?? null);
      } else {
        const result = await api<{ task: Task; duplicate: boolean }>("/api/parser/tasks", { method: "POST", body: JSON.stringify({ ...payload, city: cities[0] || "" }) });
        setMessage(result.duplicate ? "Такой поиск уже есть за последние сутки. Открыта существующая задача." : "Поиск поставлен в очередь Parser API.");
        setActive(result.task.id);
      }
      await tasks.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Поиск не запущен");
    } finally {
      setPending(false);
    }
  }

  async function saveTemplate(formData: FormData) {
    const name = window.prompt("Название шаблона");
    if (!name) return;
    const cities = String(formData.get("cities") || "").split(",")[0]?.trim();
    await api("/api/parser/templates", { method: "POST", body: JSON.stringify({ name, params: { city: cities, region: formData.get("region") || "", category: formData.get("category"), searchQuery: formData.get("searchQuery") || "", maxResults: Number(formData.get("maxResults") || 20), includePhotos: false, outputFormat: "json" } }) });
    templates.reload();
  }

  return (
    <div>
      <PageTitle title="Поиск организаций" text="Запускает сбор Яндекс Карт через Parser API. Регион сохраняется у вас и не отправляется в API: у парсера в контракте нет такого поля. Повтор одинакового поиска за сутки блокируется." />
      {error && isSetupError(new ApiClientError(error, error.includes("не настроена") ? "integration_not_configured" : undefined)) ? <State title="Требуется настройка" text={error} action={<Link className="text-teal-800" href="/integrations">Открыть интеграции</Link>} /> : null}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <form action={submit} className="space-y-3">
            <Field label="Города" hint="Несколько городов через запятую создадут отдельную задачу на каждый"><input name="cities" required className={controlClass} placeholder="Казань" /></Field>
            <Field label="Регион"><input name="region" className={controlClass} /></Field>
            <Field label="Категория"><input name="category" required className={controlClass} placeholder="стоматология" /></Field>
            <Field label="Поисковый запрос"><input name="searchQuery" className={controlClass} placeholder="детская стоматология" /></Field>
            <Field label="Количество, 1–500"><input name="maxResults" type="number" min={1} max={500} defaultValue={30} required className={controlClass} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includePhotos" /> Сохранять признак фотографий, если парсер их вернёт</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmLarge" /> Подтверждаю большой или пакетный запуск</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="force" /> Запустить ещё раз, даже если такой поиск уже был</label>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {message ? <p className="text-sm text-teal-800">{message}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" pending={pending}>Запустить поиск</Button>
              <Button type="button" variant="secondary" onClick={(event) => saveTemplate(new FormData(event.currentTarget.form!))}>Сохранить шаблон</Button>
            </div>
          </form>
        </Card>
        <div className="space-y-3">
          {(tasks.data ?? []).map((task) => (
            <Card key={task.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{task.input.city} · {task.input.category}</div>
                  <div className="text-xs text-slate-500">{task.input.searchQuery || "без дополнительного запроса"} · до {task.input.maxResults} · {formatDate(task.createdAt)}</div>
                </div>
                <Badge tone={task.status === "failed" ? "red" : task.status === "completed" ? "green" : "teal"}>{TASK_STATUS[task.status] || task.status}</Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-teal-700" style={{ width: `${task.progress || (task.status === "completed" ? 100 : 8)}%` }} /></div>
              {task.error ? <p className="mt-2 text-sm text-red-700">{task.error}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span>Найдено записей: {task.organizationCount ?? "ещё нет"}</span>
                <button className="text-teal-800" onClick={() => setActive(task.id)}>Следить</button>
                {task.status === "completed" ? <Link className="text-teal-800" href={`/organizations?city=${encodeURIComponent(task.input.city || "")}`}>Открыть найденные организации</Link> : null}
                {task.status === "queued" || task.status === "running" ? <button className="text-red-700" onClick={() => api(`/api/parser/tasks/${task.id}/cancel`, { method: "POST" }).then(() => tasks.reload())}>Отменить</button> : null}
              </div>
            </Card>
          ))}
          {!tasks.loading && (tasks.data ?? []).length === 0 ? <State title="Поисков ещё не было" text="Укажите город и категорию. Если ключ Parser API не проверен, запуск остановится с понятной ошибкой и ничего не пометит как выполненное." /> : null}
          <Card>
            <h2 className="mb-2 font-semibold">Синхронизация уже собранной базы</h2>
            <p className="mb-3 text-sm text-slate-600">Новый сбор не нужен, если карточки уже есть у парсера. Этот запуск только читает общую базу.</p>
            <Button variant="secondary" onClick={() => api("/api/parser/sync", { method: "POST", body: JSON.stringify({}) }).then(() => setMessage("Синхронизация поставлена в очередь")).catch((reason) => setError(reason.message))}>Синхронизировать базу</Button>
          </Card>
          {(templates.data ?? []).length ? <Card><h2 className="mb-2 font-semibold">Шаблоны</h2>{templates.data?.map((item) => <div key={item.id} className="flex justify-between border-t border-line py-2 text-sm"><span>{item.name}</span><button onClick={() => api(`/api/parser/templates/${item.id}`, { method: "DELETE" }).then(() => templates.reload())}>Удалить</button></div>)}</Card> : null}
        </div>
      </div>
    </div>
  );
}
