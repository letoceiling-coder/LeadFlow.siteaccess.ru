"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bookmark, Check, ChevronRight, Loader2, Play, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { ApiClientError } from "@/lib/client";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { Button, Chip, Field, Glass, Notice, Segmented, cx, errorText, inputClass, useToast } from "@/components/hunt/ui";
import { dayLabel } from "@/components/hunt/types";
import { BestQueries } from "@/components/hunt/insights";
import { ProgressBar, foundOf, isLive, percentOf, phaseOf, statusText, targetOf, type SearchRow } from "@/components/hunt/search-progress";
import { HUNT_CITIES, HUNT_NICHES, collectEtaMinutes, parseHuntQuery } from "@/lib/domain/hunt-query";

type Template = { id: string; name: string; params: { city: string; category: string; searchQuery?: string; maxResults: number } };
type Search = SearchRow;
type Size = "20" | "50" | "100" | "200";
type Draft = { task: string; category: string; cities: string[]; size: Size; step: number };

const STEPS = [
  { title: "Кого ищем", hint: "ниша бизнеса" },
  { title: "Где", hint: "один или несколько городов" },
  { title: "Сколько", hint: "карточек на город" },
  { title: "Запуск", hint: "проверьте и запустите" },
];
const CHAIN = [
  ["Сбор", "Яндекс Карты: телефоны, мессенджеры, прайс, отзывы"],
  ["Скан сайта", "открываем сайт, ищем корзину, запись, CRM"],
  ["AI-скоринг", "деньги, хаос, ЛПР — класс A/B/C/D"],
  ["Карточка", "факты, расчёт потерь, крючок для письма"],
  ["Отбор", "готовые карточки появятся на шаге 2"],
] as const;
const DRAFT_KEY = "hunt.search.draft";
const EMPTY: Draft = { task: "", category: "", cities: [], size: "50", step: 0 };

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export default function HuntSearchPage() {
  const { refresh, version } = useHunt();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [ready, setReady] = useState(false);
  const [customCity, setCustomCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<null | { city: string; category: string; maxResults: number }>(null);
  const templates = useLive<Template[]>("/api/parser/templates", version);
  const router = useRouter();
  const [historyLimit, setHistoryLimit] = useState(10);
  const tasks = useLive<Search[]>(`/api/hunt/searches?limit=${historyLimit}`, version, 4000);
  const active = (tasks.data ?? []).filter(isLive);
  const running = active.length > 0;

  // Черновик переживает перезагрузку и переход между шагами.
  useEffect(() => { setDraft(loadDraft()); setReady(true); }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* приватный режим */ }
  }, [draft, ready]);

  const { task, category, cities, size, step } = draft;
  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));
  const canNext = [Boolean(category.trim()), cities.length > 0, true, Boolean(category.trim() && cities.length)];
  const maxStep = canNext.findIndex((ok) => !ok);
  const reachable = (index: number) => maxStep === -1 || index <= maxStep;

  function applyTask(value: string) {
    const parsed = parseHuntQuery(value);
    const next: Partial<Draft> = { task: value };
    if (parsed.cities.length) next.cities = parsed.cities;
    if (parsed.category) next.category = parsed.category;
    if (parsed.count) next.size = parsed.count >= 150 ? "200" : parsed.count >= 75 ? "100" : parsed.count >= 35 ? "50" : "20";
    patch(next);
  }
  function toggleCity(name: string) {
    patch({ cities: cities.includes(name) ? cities.filter((item) => item !== name) : [...cities, name] });
  }
  function addCustomCity() {
    const name = customCity.trim();
    if (name && !cities.includes(name)) patch({ cities: [...cities, name] });
    setCustomCity("");
  }

  async function launch(params: { city: string; category: string; maxResults: number; searchQuery?: string }, force = false) {
    setBusy(true);
    setError("");
    setDuplicate(null);
    try {
      const result = await post<{ duplicate?: boolean; task?: { id: string } }>("/api/parser/tasks", { ...params, searchQuery: params.searchQuery ?? "", force });
      if (result.duplicate) setDuplicate({ city: params.city, category: params.category, maxResults: params.maxResults });
      else toast({ text: `Ищем: ${params.category}, ${params.city}. Карточки сами пройдут скоринг` });
      await tasks.reload();
      refresh();
      return result.duplicate ? null : result.task?.id ?? null;
    } catch (reason) {
      setError(errorText(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Каждый город — отдельный сбор: парсер раздаёт их по своим компьютерам параллельно. */
  async function launchAll() {
    const started: string[] = [];
    for (const name of cities) {
      const id = await launch({ city: name, category: category.trim(), maxResults: Number(size) });
      if (id) started.push(id);
    }
    if (!started.length) return;
    patch({ ...EMPTY, category, cities });
    // Один город — сразу на экран хода поиска. Несколько — остаёмся: все видны в истории справа.
    if (started.length === 1) router.push(`/hunt/search/${started[0]}`);
  }

  async function qualify(path: string, body?: unknown, confirmed = false): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ queued: number }>(path, confirmed ? { ...(body as object), confirmLarge: true } : body);
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
    if (!cities.length || !category.trim()) return;
    try {
      await post("/api/parser/templates", { name: `${category.trim()} · ${cities[0]}`, params: { city: cities[0], category: category.trim(), searchQuery: "", maxResults: Number(size) } });
      await templates.reload();
      toast({ text: "Пресет сохранён" });
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function removePreset(id: string, name: string) {
    if (!window.confirm(`Удалить пресет «${name}»?`)) return;
    try {
      await post(`/api/parser/templates/${id}`, undefined, "DELETE");
      await templates.reload();
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  return (
    <div className="pt-2">
      <p className="text-sm text-[var(--h-faint)]">Шаг 1 из 5 · путь клиента</p>
      <h1 className="mt-1 text-[32px] font-semibold leading-[38px] tracking-tight">Найти клиентов</h1>
      <p className="mt-1 max-w-2xl text-[15px] text-[var(--h-muted)]">Заполните четыре коротких шага — система соберёт компании, проверит сайты, оценит каждую и подготовит карточку с поводом для письма.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {active.map((item) => (
            <Link key={item.id} href={`/hunt/search/${item.id}`} className="block">
              <Glass tint="yellow" className="anim-pop px-4 py-3.5 transition hover:brightness-125">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--h-accent)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">Идёт поиск: {item.category} · {item.city}</div>
                    <div className="truncate text-xs text-[var(--h-muted)]">{statusText(item)} · найдено {foundOf(item)}{targetOf(item) ? ` из ${targetOf(item)}` : ""}{item.funnel ? ` · в отборе ${item.funnel.ready}` : ""}</div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-[var(--h-accent)]">Смотреть</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--h-accent)]" />
                </div>
                <ProgressBar percent={percentOf(item)} live className="mt-3 h-1.5" />
              </Glass>
            </Link>
          ))}

          {/* Индикатор шагов мастера */}
          <ol className="grid grid-cols-4 gap-2">
            {STEPS.map((item, index) => {
              const done = index < step && canNext[index];
              const on = index === step;
              return (
                <li key={item.title}>
                  <button
                    disabled={!reachable(index)}
                    onClick={() => patch({ step: index })}
                    className={cx("w-full rounded-2xl border px-3 py-2.5 text-left transition disabled:opacity-40", on ? "border-[var(--h-accent)] bg-[rgba(255,214,10,0.08)]" : "border-[var(--h-line)] hover:bg-white/[0.05]")}
                  >
                    <span className={cx("grid h-6 w-6 place-items-center rounded-full text-xs font-semibold", done ? "bg-[var(--h-ok)] text-[#062]" : on ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : "bg-white/10")}>
                      {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                    </span>
                    <span className="mt-1.5 block truncate text-[13px] font-semibold">{item.title}</span>
                    <span className="block truncate text-[11px] text-[var(--h-faint)] max-sm:hidden">{item.hint}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          {error ? <Notice tone="error">{error}</Notice> : null}
          {duplicate ? (
            <Notice tone="warn">
              Такой поиск уже был за сутки — его карточки в базе. Если прошлый раз парсер вернул мало, можно повторить.
              <button className="mt-2 block font-semibold text-[var(--h-accent)]" onClick={() => launch(duplicate, true)}>Искать заново</button>
            </Notice>
          ) : null}

          <Glass className="p-5 md:p-6">
            <h2 className="text-xl font-semibold">{STEPS[step].title}</h2>

            {step === 0 ? (
              <div className="mt-4 space-y-4">
                <Field label="Задание одной фразой (необязательно)" hint="Ниша, города и число — поля заполнятся сами. Например: «автосервисы Ростов и Краснодар 50».">
                  <input className={inputClass} value={task} onChange={(event) => applyTask(event.target.value)} placeholder="доставка еды Казань 100" enterKeyHint="next" />
                </Field>
                <Field label="Ниша">
                  <input className={inputClass} value={category} onChange={(event) => patch({ category: event.target.value })} placeholder="Например, стоматология" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {HUNT_NICHES.map((item) => <Chip key={item.label} active={category === item.label} onClick={() => patch({ category: item.label })}>{item.label}</Chip>)}
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-[var(--h-muted)]">Каждый город — отдельный сбор, они идут параллельно. Выбрано: {cities.length ? cities.join(", ") : "ничего"}.</p>
                <div className="flex flex-wrap gap-2">
                  {[...HUNT_CITIES, ...cities.filter((item) => !HUNT_CITIES.includes(item))].map((item) => <Chip key={item} active={cities.includes(item)} onClick={() => toggleCity(item)}>{item}</Chip>)}
                </div>
                <div className="flex gap-2">
                  <input className={inputClass} value={customCity} onChange={(event) => setCustomCity(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addCustomCity(); }} placeholder="Другой город" />
                  <Button size="md" className="h-12 shrink-0" disabled={!customCity.trim()} onClick={addCustomCity}>Добавить</Button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-4 space-y-4">
                <Segmented<Size> value={size} onChange={(value) => patch({ size: value })} items={[{ key: "20", label: "20" }, { key: "50", label: "50" }, { key: "100", label: "100" }, { key: "200", label: "200" }]} />
                <p className="text-sm text-[var(--h-muted)]">
                  Около <b className="text-[var(--h-text)]">{collectEtaMinutes(Number(size))} мин</b> на город. Парсер делает паузы против капчи — примерно 20 секунд на карточку.
                  Начните с 50: этого хватает, чтобы понять, есть ли в нише «деньги и хаос».
                </p>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="mt-4 space-y-5">
                <dl className="grid grid-cols-3 gap-2">
                  {[["Ниша", category || "—"], ["Города", cities.join(", ") || "—"], ["Объём", `${size} × ${cities.length || 0}`]].map(([label, text]) => (
                    <div key={label} className="rounded-2xl bg-white/[0.04] px-3 py-2.5">
                      <dt className="text-xs text-[var(--h-faint)]">{label}</dt>
                      <dd className="mt-0.5 line-clamp-2 text-[15px] font-semibold">{text}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  <h3 className="mb-2 text-sm font-medium text-[var(--h-muted)]">Что произойдёт после запуска</h3>
                  <ol className="space-y-2">
                    {CHAIN.map(([title, text], index) => (
                      <li key={title} className="flex gap-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{index + 1}</span>
                        <span className="text-sm"><b>{title}</b> <span className="text-[var(--h-muted)]">— {text}</span></span>
                      </li>
                    ))}
                  </ol>
                </div>
                <button onClick={savePreset} className="inline-flex items-center gap-1.5 text-sm text-[var(--h-accent)]"><Bookmark className="h-4 w-4" /> Сохранить как пресет</button>
              </div>
            ) : null}

            <div className="mt-6 flex items-center gap-2 border-t border-[var(--h-line)] pt-4">
              {step > 0 ? <Button variant="ghost" onClick={() => patch({ step: step - 1 })}><ArrowLeft className="h-4 w-4" /> Назад</Button> : null}
              <div className="flex-1" />
              {step < 3 ? (
                <Button variant="accent" size="md" disabled={!canNext[step]} onClick={() => patch({ step: step + 1 })}>Далее <ArrowRight className="h-4 w-4" /></Button>
              ) : (
                <Button variant="accent" size="md" pending={busy} disabled={!canNext[3]} onClick={launchAll}>
                  <Play className="h-4 w-4" /> Искать<span className="max-sm:hidden">{cities.length > 1 ? ` в ${cities.length} городах` : ""}</span> · ~{collectEtaMinutes(Number(size), cities.length)} мин
                </Button>
              )}
            </div>
          </Glass>

          <div className="grid grid-cols-2 gap-2">
            <Button size="md" pending={busy} onClick={() => qualify("/api/hunt/qualify", { limit: 20 })}><Sparkles className="h-4 w-4" /> Скоринг новых</Button>
            <Button size="md" pending={busy} onClick={() => qualify("/api/hunt/retry-failed")}><RotateCcw className="h-4 w-4" /> Повторить сбои</Button>
          </div>
        </div>

        <aside className="min-w-0 space-y-6">
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-lg font-semibold">История поисков</h3>
              {running ? <span className="text-xs text-[var(--h-accent)]">обновляется…</span> : null}
            </div>
            {tasks.loading ? <p className="text-sm text-[var(--h-muted)]">Загрузка…</p> : (tasks.data ?? []).length === 0 ? <p className="text-sm text-[var(--h-muted)]">Поисков ещё не было. Запустите первый — он появится здесь, и за ним можно будет следить вживую.</p> : (
              <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
                {(tasks.data ?? []).map((item) => {
                  const phase = phaseOf(item);
                  const f = item.funnel;
                  return (
                    <Link key={item.id} href={`/hunt/search/${item.id}`} className="block px-4 py-3 transition hover:bg-white/[0.05]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-[15px] font-medium">{item.category} · {item.city}</div>
                        <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", phase.failed ? "bg-[rgba(255,100,100,0.15)] text-[#ff9b9b]" : phase.index === 3 ? "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]" : "bg-[rgba(255,214,10,0.14)] text-[var(--h-accent)]")}>
                          {statusText(item)}
                        </span>
                      </div>
                      {isLive(item) ? <ProgressBar percent={percentOf(item)} live className="mt-2 h-1.5" /> : null}
                      <div className="mt-1.5 text-xs text-[var(--h-faint)]">
                        {dayLabel(item.createdAt)} · найдено {foundOf(item)}{item.requested ? ` из ${item.requested}` : ""}{item.error ? ` · ${item.error}` : ""}
                      </div>
                      {f ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          {f.hot ? <span className="rounded-full bg-[var(--h-accent)] px-2 py-0.5 font-semibold text-[var(--h-accent-ink)]">A {f.hot}</span> : null}
                          <span className="rounded-full bg-[rgba(255,214,10,0.14)] px-2 py-0.5 text-[var(--h-accent)]">в отборе {f.ready}</span>
                          <span className="rounded-full bg-white/10 px-2 py-0.5">проверить {f.review}</span>
                          {f.queued ? <span className="rounded-full bg-white/10 px-2 py-0.5">в скоринге {f.queued}</span> : null}
                        </div>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            )}
            {(tasks.data ?? []).length >= historyLimit ? <button onClick={() => setHistoryLimit((n) => n + 20)} className="mt-2 text-sm text-[var(--h-accent)]">Показать ещё</button> : null}
          </section>

          {(templates.data ?? []).length ? (
            <section>
              <h3 className="mb-2 text-lg font-semibold">Пресеты</h3>
              <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
                {(templates.data ?? []).map((item) => (
                  <div key={item.id} className="flex min-h-14 items-center gap-2 pl-4 pr-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium">{item.name}</div><div className="text-xs text-[var(--h-faint)]">до {item.params.maxResults}</div></div>
                    <button disabled={busy} aria-label={`Запустить ${item.name}`} onClick={() => launch(item.params)} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--h-accent)] text-[var(--h-accent-ink)]"><Play className="h-4 w-4" /></button>
                    <button aria-label="Удалить пресет" onClick={() => removePreset(item.id, item.name)} className="grid h-11 w-11 place-items-center rounded-full text-[var(--h-faint)] hover:text-[var(--h-text)]"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <BestQueries busy={busy} onRun={(params) => launch(params, true)} />
        </aside>
      </div>
    </div>
  );
}
