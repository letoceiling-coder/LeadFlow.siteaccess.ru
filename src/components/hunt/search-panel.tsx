"use client";

import { useState } from "react";
import { Bookmark, Play, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { ApiClientError } from "@/lib/client";
import { useHunt } from "./shell";
import { post, useLive } from "./data";
import { Button, Chip, Field, Notice, Segmented, Sheet, cx, errorText, inputClass, useToast } from "./ui";
import { dayLabel } from "./types";

type Template = { id: string; name: string; params: { city: string; category: string; searchQuery?: string; maxResults: number } };
type Task = { id: string; status: string; input: { city?: string; category?: string }; organizationCount: number | null; createdAt: string; error: string | null; syncedAt: string | null };

/** Категории под активный контур стратегии: доставка еды и автосервисы, плюс мастера. */
const CATEGORIES = ["Доставка еды", "Суши-бар", "Пиццерия", "Автосервис", "Шиномонтаж", "Натяжные потолки", "Стоматология", "База отдыха"];
const TASK_STATUS: Record<string, string> = { queued: "в очереди", running: "идёт", completed: "готово", failed: "ошибка", cancelled: "отменён" };

export function SearchPanel({ open }: { open: boolean }) {
  const { close, refresh, version } = useHunt();
  const toast = useToast();
  const [city, setCity] = useState("Краснодар");
  const [category, setCategory] = useState("Доставка еды");
  const [size, setSize] = useState<"20" | "50" | "100">("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const templates = useLive<Template[]>(open ? "/api/parser/templates" : null, version);
  const tasksUrl = open ? "/api/parser/tasks" : null;
  const tasks = useLive<Task[]>(tasksUrl, version, 5000);
  const running = (tasks.data ?? []).some((task) => ["queued", "running"].includes(task.status) || (task.status === "completed" && !task.syncedAt));

  async function launch(params: { city: string; category: string; maxResults: number; searchQuery?: string }) {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ duplicate?: boolean }>("/api/parser/tasks", { ...params, searchQuery: params.searchQuery ?? "" });
      if (result.duplicate) toast({ text: "Такой поиск уже был за сутки — карточки в базе" });
      else toast({ text: `Ищем: ${params.category}, ${params.city}. Карточки сами пройдут скоринг` });
      await tasks.reload();
      refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function qualify(path: string, body?: unknown, confirmed = false): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ queued: number; left?: number }>(path, confirmed ? { ...(body as object), confirmLarge: true } : body);
      toast({ text: result.queued ? `В скоринг: ${result.queued} карточек. Лента обновится сама` : "Новых карточек для скоринга нет" });
      refresh();
    } catch (reason) {
      if (reason instanceof ApiClientError && reason.code === "confirm_required" && window.confirm(`${reason.message}\n\nЗапустить?`)) {
        setBusy(false);
        return qualify(path, body, true);
      }
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function savePreset() {
    if (!city.trim() || !category.trim()) return;
    try {
      await post("/api/parser/templates", { name: `${category.trim()} · ${city.trim()}`, params: { city: city.trim(), category: category.trim(), searchQuery: "", maxResults: Number(size) } });
      await templates.reload();
      toast({ text: "Пресет сохранён" });
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Новый поиск"
      subtitle="Яндекс Карты → скоринг по стратегии → лента «Сегодня»"
      footer={<Button variant="accent" size="lg" className="w-full" pending={busy} disabled={!city.trim() || !category.trim()} onClick={() => launch({ city: city.trim(), category: category.trim(), maxResults: Number(size) })}><Play className="h-5 w-5" /> Искать</Button>}
    >
      <div className="space-y-6">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="space-y-4">
          <Field label="Город"><input className={inputClass} value={city} onChange={(event) => setCity(event.target.value)} /></Field>
          <Field label="Что ищем"><input className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Например, доставка еды" /></Field>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((item) => <Chip key={item} active={category === item} onClick={() => setCategory(item)}>{item}</Chip>)}
          </div>
          <Field label="Сколько карточек">
            <Segmented value={size} onChange={setSize} items={[{ key: "20", label: "20" }, { key: "50", label: "50" }, { key: "100", label: "100" }]} />
          </Field>
          <button onClick={savePreset} className="inline-flex items-center gap-1.5 text-sm text-[var(--h-accent)]"><Bookmark className="h-4 w-4" /> Сохранить как пресет</button>
        </div>

        {(templates.data ?? []).length ? (
          <section>
            <h3 className="mb-2 text-lg font-semibold">Пресеты</h3>
            <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
              {(templates.data ?? []).map((item) => (
                <div key={item.id} className="flex min-h-14 items-center gap-2 pl-4 pr-2">
                  <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium">{item.name}</div><div className="text-xs text-[var(--h-faint)]">до {item.params.maxResults}</div></div>
                  <button disabled={busy} aria-label={`Запустить ${item.name}`} onClick={() => launch(item.params)} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--h-accent)] text-[var(--h-accent-ink)]"><Play className="h-4 w-4" /></button>
                  <button aria-label="Удалить пресет" onClick={() => post(`/api/parser/templates/${item.id}`, undefined, "DELETE").then(() => templates.reload())} className="grid h-11 w-11 place-items-center rounded-full text-[var(--h-faint)] hover:text-[var(--h-text)]"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-lg font-semibold">Последние поиски</h3>
            {running ? <span className="text-xs text-[var(--h-accent)]">обновляется…</span> : null}
          </div>
          {(tasks.data ?? []).length === 0 ? <p className="text-sm text-[var(--h-muted)]">Поисков ещё не было.</p> : (
            <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
              {(tasks.data ?? []).slice(0, 6).map((task) => {
                const saving = task.status === "completed" && !task.syncedAt;
                return (
                  <div key={task.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[15px]">{task.input.category} · {task.input.city}</div>
                      <div className="text-xs text-[var(--h-faint)]">{dayLabel(task.createdAt)}{task.organizationCount != null ? ` · ${task.organizationCount} карточек` : ""}{task.error ? ` · ${task.error}` : ""}</div>
                    </div>
                    <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", task.status === "failed" ? "bg-[rgba(255,100,100,0.15)] text-[#ff9b9b]" : task.status === "completed" && !saving ? "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]" : "bg-[rgba(255,214,10,0.14)] text-[var(--h-accent)]")}>
                      {saving ? "сохраняем" : TASK_STATUS[task.status] ?? task.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-2">
          <Button size="md" pending={busy} onClick={() => qualify("/api/hunt/qualify", { limit: 20 })}><Sparkles className="h-4 w-4" /> Скоринг новых</Button>
          <Button size="md" pending={busy} onClick={() => qualify("/api/hunt/retry-failed")}><RotateCcw className="h-4 w-4" /> Повторить сбои</Button>
        </section>
      </div>
    </Sheet>
  );
}
