"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown, Globe, MapPin, Play, RotateCcw, Send, Sparkles, Trash2 } from "lucide-react";
import { ApiClientError } from "@/lib/client";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { Button, Chip, Glass, Notice, cx, errorText, inputClass, useToast } from "@/components/hunt/ui";
import { BestQueries } from "@/components/hunt/insights";
import { isLive, type SearchRow } from "@/components/hunt/search-progress";
import { MapsQueueRow, TelegramQueueRow, useTelegramSearches } from "@/components/hunt/search-queue";
import { HUNT_CITIES, HUNT_NICHES, collectEtaMinutes, parseHuntQuery } from "@/lib/domain/hunt-query";
import { NICHE_GROUPS, defaultSources, nichePresetGroups, type NicheGroupId } from "@/lib/domain/niche-presets";
import type { SearchSource } from "@/lib/domain/search-queue";

type Template = { id: string; name: string; params: { city: string; category: string; searchQuery?: string; maxResults: number } };
type Size = "20" | "50" | "100" | "200";
type Tab = NicheGroupId | "other";
type Draft = { text: string; cities: string[]; size: Size; sources: SearchSource[]; tab: Tab };

const DRAFT_KEY = "hunt.search.draft.v2";
const EMPTY: Draft = { text: "", cities: ["Ростов-на-Дону"], size: "50", sources: ["maps", "sites"], tab: "В" };
const SIZES: Size[] = ["20", "50", "100", "200"];
/** Сколько городов показывать сразу на телефоне: остальные — по кнопке «Все города». */
const CITY_PREVIEW = 6;

const SOURCE_TILES: { key: SearchSource; title: string; hint: string; icon: typeof MapPin }[] = [
  { key: "maps", title: "Карты", hint: "Яндекс Карты", icon: MapPin },
  { key: "sites", title: "Сайты", hint: "скан сайтов", icon: Globe },
  { key: "telegram", title: "Telegram", hint: "открытые каналы", icon: Send },
];

const GROUPS = nichePresetGroups();
const PRESET_LABELS = new Set(GROUPS.flatMap((group) => group.niches.map((item) => item.label.toLowerCase())));
const OTHER_NICHES = HUNT_NICHES.map((item) => item.label).filter((label) => !PRESET_LABELS.has(label.toLowerCase()));

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function sizeOf(count: number): Size {
  return count >= 150 ? "200" : count >= 75 ? "100" : count >= 35 ? "50" : "20";
}

export default function HuntSearchPage() {
  const { refresh, version } = useHunt();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [ready, setReady] = useState(false);
  const [customCity, setCustomCity] = useState("");
  const [allCities, setAllCities] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<null | { city: string; category: string; maxResults: number; sources: SearchSource[] }>(null);
  const [historyLimit, setHistoryLimit] = useState(15);
  const [poll, setPoll] = useState<number | false>(false);
  const queueRef = useRef<HTMLElement>(null);
  const templates = useLive<Template[]>("/api/parser/templates", version);
  const tasks = useLive<SearchRow[]>(`/api/hunt/queue?limit=${historyLimit}`, version, poll);
  const tg = useTelegramSearches();
  const rows = useMemo(() => {
    // Сначала живая очередь по порядку (№1 у парсера, №2 следующий…), потом история — новые сверху.
    const list = tasks.data ?? [];
    const pos = (row: SearchRow) => (isLive(row) ? row.queue?.position ?? 1 : Number.POSITIVE_INFINITY);
    return [...list].sort((a, b) => pos(a) - pos(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tasks.data]);
  const activeMaps = rows.filter(isLive);
  const waiting = rows.filter((row) => row.queue?.state === "waiting").length;
  const busyParser = rows.some((row) => row.queue && row.queue.state !== "waiting" && row.queue.state !== "done");

  // Опрос только пока что-то идёт: готовая история не дёргает сервер.
  useEffect(() => { setPoll(activeMaps.length ? 4000 : false); }, [activeMaps.length]);

  // Черновик переживает перезагрузку: город и источники запоминаются для следующей ниши.
  useEffect(() => { setDraft(loadDraft()); setReady(true); }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* приватный режим */ }
  }, [draft, ready]);

  const { text, cities, size, sources, tab } = draft;
  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));
  const parsed = useMemo(() => parseHuntQuery(text), [text]);
  const category = parsed.category.trim();
  const useMaps = sources.includes("maps");
  const useTg = sources.includes("telegram");
  const canLaunch = Boolean(category) && sources.length > 0 && (!useMaps || cities.length > 0);

  function onText(value: string) {
    const next = parseHuntQuery(value);
    const update: Partial<Draft> = { text: value };
    if (next.cities.length) update.cities = next.cities;
    if (next.count) update.size = sizeOf(next.count);
    patch(update);
  }
  function pickNiche(label: string) {
    patch({ text: label, sources: defaultSources(label) });
  }
  function toggleSource(key: SearchSource) {
    let next = sources.includes(key) ? sources.filter((item) => item !== key) : [...sources, key];
    // Сайты — это скан сайтов найденных на картах: без карт им нечего открывать.
    if (key === "maps" && !next.includes("maps")) next = next.filter((item) => item !== "sites");
    if (key === "sites" && next.includes("sites") && !next.includes("maps")) next = [...next, "maps"];
    patch({ sources: SOURCE_TILES.map((item) => item.key).filter((item) => next.includes(item)) });
  }
  function toggleCity(name: string) {
    patch({ cities: cities.includes(name) ? cities.filter((item) => item !== name) : [...cities, name] });
  }
  function addCustomCity() {
    const name = customCity.trim();
    if (name && !cities.includes(name)) patch({ cities: [...cities, name] });
    setCustomCity("");
  }

  async function launchMaps(params: { city: string; category: string; maxResults: number; sources?: SearchSource[] }, force = false) {
    try {
      const result = await post<{ duplicate?: boolean; position?: number | null; task?: { id: string } }>("/api/parser/tasks", { ...params, searchQuery: "", force, sources: params.sources ?? ["maps", "sites"] });
      if (result.duplicate) {
        setDuplicate({ city: params.city, category: params.category, maxResults: params.maxResults, sources: params.sources ?? ["maps", "sites"] });
        return null;
      }
      return result.position ?? 1;
    } catch (reason) {
      setError(`${params.category}, ${params.city}: ${errorText(reason)}`);
      return null;
    }
  }

  /** Одно нажатие: каждый город — отдельный сбор в очереди карт, Telegram — отдельный поиск в той же очереди. */
  async function launch() {
    if (!canLaunch || busy) return;
    setBusy(true);
    setError("");
    setDuplicate(null);
    const niche = category;
    const queued: number[] = [];
    try {
      if (useMaps) {
        for (const city of cities) {
          const position = await launchMaps({ city, category: niche, maxResults: Number(size), sources: sources.filter((item) => item !== "telegram") });
          if (position != null) queued.push(position);
        }
      }
      let tgNote = "";
      let tgOk = false;
      if (useTg) {
        const item = await tg.start(niche, cities.length === 1 ? cities[0] : null, Number(size));
        tgOk = item.status === "queued" || item.status === "running";
        tgNote = item.status === "unavailable" ? " · Telegram-каналы пока недоступны" : item.status === "failed" ? ` · Telegram: ${item.error}` : " · Telegram-каналы ищутся";
      }
      if (!queued.length && !tgOk) {
        // Ничего не ушло — нишу не стираем, причина уже на экране.
        if (useTg && !useMaps) toast({ text: `${niche}${tgNote}`, tone: "error" });
        return;
      }
      {
        const last = queued.length ? Math.max(...queued) : 0;
        toast({ text: `${niche}: ${queued.length ? (last > 1 ? `в очереди №${last}` : "сбор начался") : "поставлено"}${tgNote}` });
        // Ниша ушла — поле чистое для следующей; город и источники остаются.
        patch({ text: "" });
        await tasks.reload();
        refresh();
        queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function relaunch(params: { city: string; category: string; maxResults: number; sources?: SearchSource[] }, force = false) {
    setBusy(true);
    setError("");
    setDuplicate(null);
    const position = await launchMaps(params, force);
    if (position != null) toast({ text: `${params.category}, ${params.city}: ${position > 1 ? `в очереди №${position}` : "сбор начался"}` });
    await tasks.reload();
    refresh();
    setBusy(false);
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
    if (!cities.length || !category) return;
    try {
      await post("/api/parser/templates", { name: `${category} · ${cities[0]}`, params: { city: cities[0], category, searchQuery: "", maxResults: Number(size) } });
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

  const niches = tab === "other" ? OTHER_NICHES : GROUPS.find((group) => group.id === tab)?.niches.map((item) => item.label) ?? [];
  const groupInfo = NICHE_GROUPS.find((group) => group.id === tab);
  const cityList = [...HUNT_CITIES, ...cities.filter((item) => !HUNT_CITIES.includes(item))];
  const shownCities = allCities ? cityList : [...cities, ...cityList.filter((item) => !cities.includes(item))].slice(0, Math.max(CITY_PREVIEW, cities.length));
  const eta = useMaps ? collectEtaMinutes(Number(size), 1) : 0;
  const nextPosition = (busyParser ? 1 : 0) + waiting + 1;
  const launchText = !category ? "Выберите нишу" : !sources.length ? "Выберите источник" : useMaps && !cities.length ? "Выберите город" : useMaps && nextPosition > 1 ? `В очередь · №${nextPosition}` : "Искать";
  const liveCount = activeMaps.length + tg.live;

  return (
    <div className="pt-2">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight md:text-[32px] md:leading-[38px]">Найти клиентов</h1>
      <p className="mt-1 max-w-2xl text-[15px] text-[var(--h-muted)]">Ниша → город → «Искать». Ниши можно ставить подряд: парсер берёт по одной, остальные ждут в очереди.</p>

      {/* Телефон: очередь ниже формы — короткая ссылка на неё сверху, чтобы видеть ход без прокрутки. */}
      {liveCount ? (
        <button type="button" onClick={() => queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="mt-3 flex h-11 w-full items-center gap-2 rounded-2xl bg-[rgba(255,214,10,0.1)] px-4 text-left text-sm lg:hidden">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--h-accent)]" />
          <span className="min-w-0 flex-1 truncate">Очередь: идёт {liveCount - waiting}{waiting ? ` · ждут ${waiting}` : ""}</span>
          <span className="shrink-0 font-semibold text-[var(--h-accent)]">Смотреть ↓</span>
        </button>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Glass className="space-y-5 p-4 md:p-6">
            {/* Ниша: из списка или своя фраза */}
            <section>
              <label htmlFor="niche" className="mb-1.5 block text-[13px] font-medium text-[var(--h-muted)]">Ниша или фраза</label>
              <input
                id="niche"
                className={inputClass}
                value={text}
                onChange={(event) => onText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void launch(); }}
                placeholder="музей · или «автосервисы Казань 50»"
                enterKeyHint="search"
                autoComplete="off"
              />
              {text && category && category.toLowerCase() !== text.trim().toLowerCase() ? <p className="mt-1 text-xs text-[var(--h-faint)]">Ищем: <b className="text-[var(--h-text)]">{category}</b>{parsed.cities.length ? ` · ${parsed.cities.join(", ")}` : ""}{parsed.count ? ` · ${parsed.count}` : ""}</p> : null}
              <div role="tablist" className="mt-3 grid grid-cols-5 gap-1 rounded-2xl bg-white/[0.04] p-1">
                {[...NICHE_GROUPS.map((group) => ({ key: group.id as Tab, label: group.id })), { key: "other" as Tab, label: "Ещё" }].map((item) => (
                  <button key={item.key} role="tab" aria-selected={tab === item.key} onClick={() => patch({ tab: item.key })} className={cx("h-11 rounded-xl text-[15px] font-semibold transition", tab === item.key ? "bg-[var(--h-text)] text-[#111]" : "text-[var(--h-muted)] hover:text-[var(--h-text)]")}>
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--h-faint)]">{groupInfo ? <><b className="text-[var(--h-muted)]">{groupInfo.title}</b> · {groupInfo.offer}</> : "Ниши малого бизнеса из прошлых поисков"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {niches.map((label) => <Chip key={label} className="!h-11 max-w-full" active={category.toLowerCase() === label.toLowerCase()} onClick={() => pickNiche(label)}><span className="truncate">{label}</span></Chip>)}
              </div>
            </section>

            {/* Источники */}
            <section>
              <h2 className="mb-1.5 text-[13px] font-medium text-[var(--h-muted)]">Где искать</h2>
              <div className="grid grid-cols-3 gap-2">
                {SOURCE_TILES.map((item) => {
                  const on = sources.includes(item.key);
                  const Icon = item.icon;
                  return (
                    <button key={item.key} type="button" aria-pressed={on} onClick={() => toggleSource(item.key)} className={cx("relative flex min-h-[60px] flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left transition", on ? "border-[var(--h-accent)] bg-[rgba(255,214,10,0.1)]" : "border-[var(--h-line)] bg-white/[0.03] hover:bg-white/[0.06]")}>
                      <span className="flex min-w-0 items-center gap-1 text-[14px] font-semibold sm:gap-1.5 sm:text-[15px]"><Icon className={cx("h-4 w-4 shrink-0", on ? "text-[var(--h-accent)]" : "text-[var(--h-faint)]")} /><span className="truncate">{item.title}</span></span>
                      <span className={cx("mt-0.5 flex items-center gap-1 text-[11px] leading-tight", on ? "text-[var(--h-accent)]" : "text-[var(--h-faint)]")}>{on ? <Check className="h-3 w-3 shrink-0" strokeWidth={3} /> : null}{item.hint}</span>
                    </button>
                  );
                })}
              </div>
              {!useMaps && useTg ? <p className="mt-1.5 text-xs text-[var(--h-faint)]">Только Telegram: город необязателен, количество — сколько каналов найти.</p> : null}
            </section>

            {/* Города */}
            <section>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h2 className="text-[13px] font-medium text-[var(--h-muted)]">Город{useMaps ? "" : " (необязательно)"}</h2>
                {cities.length > 1 ? <span className="text-xs text-[var(--h-faint)]">{cities.length} города — {cities.length} сбора в очереди</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {shownCities.map((item) => <Chip key={item} className="!h-11" active={cities.includes(item)} onClick={() => toggleCity(item)}>{item}</Chip>)}
                {!allCities && cityList.length > shownCities.length ? <Chip className="!h-11" onClick={() => setAllCities(true)}>Все города <ChevronDown className="h-4 w-4" /></Chip> : null}
              </div>
              {allCities ? (
                <div className="mt-2 flex gap-2">
                  <input className={inputClass} value={customCity} onChange={(event) => setCustomCity(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addCustomCity(); }} placeholder="Другой город" enterKeyHint="done" />
                  <Button size="md" className="h-12 shrink-0" disabled={!customCity.trim()} onClick={addCustomCity}>Добавить</Button>
                </div>
              ) : null}
            </section>

            {/* Сколько */}
            <section>
              <h2 className="mb-1.5 text-[13px] font-medium text-[var(--h-muted)]">Сколько{useMaps ? " карточек на город" : " каналов"}</h2>
              <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white/[0.04] p-1">
                {SIZES.map((item) => (
                  <button key={item} type="button" aria-pressed={size === item} onClick={() => patch({ size: item })} className={cx("h-11 rounded-xl text-[15px] font-semibold tabular-nums transition", size === item ? "bg-[var(--h-text)] text-[#111]" : "text-[var(--h-muted)] hover:text-[var(--h-text)]")}>{item}</button>
                ))}
              </div>
              {useMaps ? <p className="mt-1.5 text-xs text-[var(--h-faint)]">Сбор с карт ≈ {eta} мин на город: парсер делает паузы против капчи.</p> : null}
            </section>

            {error ? <Notice tone="error">{error}</Notice> : null}
            {duplicate ? (
              <Notice tone="warn">
                «{duplicate.category}, {duplicate.city}» уже искали за сутки — карточки в базе.
                <button className="mt-1 flex h-11 items-center font-semibold text-[var(--h-accent)]" onClick={() => relaunch(duplicate, true)}>Искать заново</button>
              </Notice>
            ) : null}

            <Button variant="accent" size="lg" className="w-full" pending={busy} disabled={!canLaunch} onClick={launch}>
              <Play className="h-5 w-5" /> {launchText}
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-[var(--h-faint)]">
              <span>{useMaps ? `${cities.length || 0} ${cities.length === 1 ? "город" : "города"} × ${size}` : ""}{useTg ? `${useMaps ? " · " : ""}Telegram-каналы` : ""}</span>
              {category && cities.length ? <button onClick={savePreset} className="inline-flex h-11 items-center gap-1.5 text-[var(--h-accent)]"><Bookmark className="h-4 w-4" /> В пресеты</button> : null}
            </div>
          </Glass>

          <div className="grid grid-cols-2 gap-2">
            <Button size="md" pending={busy} onClick={() => qualify("/api/hunt/qualify", { limit: 20 })}><Sparkles className="h-4 w-4" /> Скоринг новых</Button>
            <Button size="md" pending={busy} onClick={() => qualify("/api/hunt/retry-failed")}><RotateCcw className="h-4 w-4" /> Повторить сбои</Button>
          </div>
        </div>

        <aside className="min-w-0 space-y-6">
          <section ref={queueRef} className="scroll-mt-20">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Очередь и история</h2>
              {liveCount ? <span className="text-xs text-[var(--h-accent)]">идёт {liveCount - waiting}{waiting ? ` · ждут ${waiting}` : ""}</span> : null}
            </div>
            {tasks.loading ? <p className="text-sm text-[var(--h-muted)]">Загрузка…</p> : !rows.length && !tg.items.length ? (
              <p className="text-sm text-[var(--h-muted)]">Поисков ещё не было. Выберите нишу и нажмите «Искать» — поиск появится здесь со статусом.</p>
            ) : (
              <ul className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
                {tg.items.filter((item) => ["queued", "running"].includes(item.status)).map((item) => <TelegramQueueRow key={item.key} item={item} onRemove={() => tg.remove(item.key)} />)}
                {rows.map((row) => <MapsQueueRow key={row.id} row={row} onChanged={() => { void tasks.reload(); refresh(); }} />)}
                {tg.items.filter((item) => !["queued", "running"].includes(item.status)).map((item) => <TelegramQueueRow key={item.key} item={item} onRemove={() => tg.remove(item.key)} />)}
              </ul>
            )}
            {rows.length >= historyLimit ? <button onClick={() => setHistoryLimit((n) => n + 20)} className="mt-1 flex h-11 items-center text-sm text-[var(--h-accent)]">Показать ещё</button> : null}
          </section>

          {(templates.data ?? []).length ? (
            <section>
              <h3 className="mb-2 text-lg font-semibold">Пресеты</h3>
              <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
                {(templates.data ?? []).map((item) => (
                  <div key={item.id} className="flex min-h-14 items-center gap-2 pl-4 pr-2">
                    <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium">{item.name}</div><div className="text-xs text-[var(--h-faint)]">до {item.params.maxResults}</div></div>
                    <button disabled={busy} aria-label={`Запустить ${item.name}`} onClick={() => relaunch(item.params)} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--h-accent)] text-[var(--h-accent-ink)]"><Play className="h-4 w-4" /></button>
                    <button aria-label="Удалить пресет" onClick={() => removePreset(item.id, item.name)} className="grid h-11 w-11 place-items-center rounded-full text-[var(--h-faint)] hover:text-[var(--h-text)]"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <BestQueries busy={busy} onRun={(params) => relaunch(params, true)} />
        </aside>
      </div>
    </div>
  );
}
