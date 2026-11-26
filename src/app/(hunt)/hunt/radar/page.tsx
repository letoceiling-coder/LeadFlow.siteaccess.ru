"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink, MapPin, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { post, useLive } from "@/components/hunt/data";
import { Button, Chip, Empty, Field, Glass, Notice, Segmented, Skeleton, cx, errorText, inputClass, textareaClass, useToast } from "@/components/hunt/ui";

type Source = { id: string; username: string; title: string; type: string; members: number | null; active: boolean; lastPolledAt: string | null; lastError: string | null; readCount: number; matchCount: number };
type Project = {
  id: string; name: string; kind: "own" | "client"; target: string | null; keywords: string[]; minusWords: string[]; active: boolean; pollMinutes: number; minScore: number;
  lastPollAt: string | null; sources: Source[]; fresh: number;
  bot: { connected: boolean; username: string | null; linked: boolean; chatTitle: string | null; pending: boolean };
};
type Overview = { projects: Project[]; config: { readsPerMinute: number }; ready: { ai: boolean; telegram: boolean } };
type Finding = {
  id: string; projectId: string; projectName: string; projectKind: string; chatTitle: string; chatUsername: string; authorUsername: string | null; authorName: string | null; authorLink: string | null;
  text: string; link: string | null; postedAt: string; summary: string | null; intent: string; city: string | null; district: string | null; deadline: string | null; budget: string | null;
  score: number; penalty: number; reply: string | null; matched: string[]; status: string; itemId: string | null;
};
type Status = "new" | "later" | "taken" | "rejected";

function ago(value: string) {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} мин назад`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} ч назад`;
  return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function scoreTone(score: number) {
  return score >= 70 ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : score >= 40 ? "bg-[rgba(255,107,44,0.2)] text-[#ffb08a]" : "bg-white/10 text-[var(--h-muted)]";
}

export default function RadarPage() {
  const { version } = useHunt();
  const [tab, setTab] = useState<"feed" | "settings">("feed");
  // Тихое обновление: видно, что заказчик привязал бота и когда чаты проверены.
  const overview = useLive<Overview>("/api/hunt/radar", version, 20_000);
  const projects = overview.data?.projects ?? [];
  const fresh = projects.reduce((sum, item) => sum + item.fresh, 0);

  return (
    <div className="pt-2">
      <p className="text-sm text-[var(--h-faint)]">Запросы из открытых Telegram-чатов</p>
      <h1 className="mt-1 text-[32px] font-semibold leading-[38px] tracking-tight">Радар</h1>
      <div className="sticky top-[68px] z-20 -mx-4 mt-5 px-4 py-2 backdrop-blur-md">
        <Segmented value={tab} onChange={setTab} items={[{ key: "feed", label: "Лента", count: overview.data ? fresh : undefined }, { key: "settings", label: "Слова и чаты", count: overview.data ? projects.length : undefined }]} />
      </div>
      {overview.error ? <div className="mt-3"><Notice tone="error">{overview.error}</Notice></div> : !overview.data ? <div className="mt-3"><Skeleton rows={4} /></div> : (
        <>
          {!overview.data.ready.telegram ? <div className="mt-3"><Notice tone="warn">Telegram через парсер не подключён — радар не сможет читать чаты.</Notice></div> : null}
          {!overview.data.ready.ai ? <div className="mt-3"><Notice tone="warn">OpenRouter не подключён: находки будут только по словам, без сути, города и подсказки ответа.</Notice></div> : null}
          {tab === "feed" ? <Feed projects={projects} onSetup={() => setTab("settings")} /> : <Settings data={overview.data} reload={overview.reload} />}
        </>
      )}
    </div>
  );
}

/* ───────────── Лента ───────────── */

function Feed({ projects, onSetup }: { projects: Project[]; onSetup: () => void }) {
  const [projectId, setProjectId] = useState<string>("");
  const [status, setStatus] = useState<Status>("new");
  const [tick, setTick] = useState(0);
  const query = new URLSearchParams({ status, ...(projectId ? { projectId } : {}) }).toString();
  const feed = useLive<Finding[]>(`/api/hunt/radar/feed?${query}`, tick, 60_000);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const list = (feed.data ?? []).filter((item) => !gone.has(item.id));

  if (!projects.length) {
    return <div className="mt-3"><Empty title="Радар ещё не настроен" text="Создайте проект: ключевые слова и открытые чаты. Радар будет читать новые сообщения каждые 15 минут и показывать здесь запросы с баллом и подсказкой ответа." action={<Button variant="accent" onClick={onSetup}>Настроить радар</Button>} /></div>;
  }

  return (
    <div className="mt-3 space-y-3">
      {projects.length > 1 ? (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <Chip active={!projectId} onClick={() => setProjectId("")}>Все</Chip>
          {projects.map((item) => <Chip key={item.id} active={projectId === item.id} onClick={() => setProjectId(item.id)}>{item.name}{item.fresh ? ` · ${item.fresh}` : ""}</Chip>)}
        </div>
      ) : null}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {([["new", "Новые"], ["later", "Позже"], ["taken", "Взятые"], ["rejected", "Не то"]] as const).map(([key, label]) => <Chip key={key} active={status === key} onClick={() => setStatus(key)}>{label}</Chip>)}
      </div>
      {feed.error ? <Notice tone="error">{feed.error}</Notice> : !feed.data ? <Skeleton rows={3} /> : list.length === 0 ? (
        <Empty title="Пока пусто" text={status === "new" ? "Свежих запросов нет. Радар проверяет чаты по расписанию — загляните позже или добавьте чатов и слов." : "Здесь ничего нет."} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((item) => <FindingCard key={item.id} item={item} onDone={(id) => { setGone((prev) => new Set(prev).add(id)); setTick((value) => value + 1); }} />)}
        </div>
      )}
    </div>
  );
}

function openChat(reply: string | null, href: string | null) {
  if (reply) void navigator.clipboard?.writeText(reply).catch(() => undefined);
  if (href) window.open(href, "_blank", "noopener");
}

function FindingCard({ item, onDone }: { item: Finding; onDone: (id: string) => void }) {
  const { open } = useHunt();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ itemId: string | null; chatLink: string | null } | null>(item.status === "taken" ? { itemId: item.itemId, chatLink: item.authorLink } : null);
  const [showText, setShowText] = useState(false);
  const place = [item.city, item.district].filter(Boolean).join(", ");
  const target = item.authorLink ?? item.link;

  async function act(action: "take" | "reject" | "later") {
    setBusy(action);
    try {
      const result = await post<{ itemId?: string | null; chatLink?: string | null }>(`/api/hunt/radar/findings/${item.id}/${action}`, action === "later" ? { hours: 24 } : {});
      if (action === "take") {
        setTaken({ itemId: result.itemId ?? null, chatLink: result.chatLink ?? null });
        toast({ text: item.projectKind === "client" ? "Взято" : "Взято: карточка в «Охоте», черновик — подсказка ответа", tone: "ok" });
      } else {
        toast({ text: action === "reject" ? "Учтём: похожие будут ниже" : "Вернём через сутки", tone: "ok" });
        onDone(item.id);
      }
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Glass className="min-w-0 p-4">
      <div className="flex items-start gap-3">
        <span className={cx("inline-flex h-8 min-w-[44px] shrink-0 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums", scoreTone(item.score))} title={item.penalty ? `Понижено на ${item.penalty} за сходство с «Не то»` : "Балл 0–100"}>{item.score}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-semibold leading-5">{item.summary ?? item.text.slice(0, 160)}</p>
          <p className="mt-1 break-words text-[13px] text-[var(--h-faint)]">{item.chatTitle} · {ago(item.postedAt)}{item.authorUsername ? ` · @${item.authorUsername}` : item.authorName ? ` · ${item.authorName}` : ""}</p>
        </div>
      </div>
      {place || item.deadline || item.budget ? (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[13px]">
          {place ? <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{place}</span></span> : null}
          {item.deadline ? <span className="max-w-full truncate rounded-full bg-[rgba(255,107,44,0.14)] px-2.5 py-1 text-[#ffc3a6]">⏱ {item.deadline}</span> : null}
          {item.budget ? <span className="max-w-full truncate rounded-full bg-white/[0.06] px-2.5 py-1">💰 {item.budget}</span> : null}
        </div>
      ) : null}
      <button type="button" onClick={() => setShowText((value) => !value)} className="mt-3 block w-full text-left text-[14px] leading-5 text-[var(--h-muted)]">
        <span className={cx("block whitespace-pre-wrap break-words", !showText && "line-clamp-3")}>{item.text}</span>
      </button>
      {item.reply ? (
        <div className="mt-3 rounded-2xl border border-[var(--h-line)] bg-white/[0.03] p-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--h-faint)]">Подсказка ответа</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-5">{item.reply}</p>
        </div>
      ) : null}
      {item.link ? <a href={item.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-11 items-center gap-1.5 text-sm text-[var(--h-accent)]"><ExternalLink className="h-4 w-4" />Оригинал в чате</a> : null}
      {taken ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Button variant="accent" onClick={() => openChat(item.reply, taken.chatLink ?? target)} disabled={!target}>
            <Copy className="h-4 w-4" />{taken.chatLink ? "Скопировать и открыть чат" : "Скопировать, ответить в чате"}
          </Button>
          {taken.itemId ? <Button onClick={() => open("item", taken.itemId!)}>Карточка в «Охоте»</Button> : null}
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Button variant="accent" className="px-2" pending={busy === "take"} disabled={Boolean(busy)} onClick={() => act("take")}>Взять</Button>
          <Button className="px-2" pending={busy === "reject"} disabled={Boolean(busy)} onClick={() => act("reject")}>Не то</Button>
          <Button className="px-2" pending={busy === "later"} disabled={Boolean(busy)} onClick={() => act("later")}>Позже</Button>
        </div>
      )}
    </Glass>
  );
}

/* ───────────── Настройки ───────────── */

function Settings({ data, reload }: { data: Overview; reload: () => Promise<void> }) {
  const toast = useToast();
  const [reads, setReads] = useState(String(data.config.readsPerMinute));
  const [saving, setSaving] = useState(false);

  async function saveReads() {
    setSaving(true);
    try {
      await post("/api/hunt/radar/config", { readsPerMinute: Number(reads) }, "PUT");
      toast({ text: "Лимит сохранён", tone: "ok" });
      await reload();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-4">
      {data.projects.map((project) => <ProjectEditor key={project.id} project={project} reload={reload} />)}
      <NewProject reload={reload} />
      <Glass className="p-4">
        <h2 className="text-base font-semibold">Бережём рабочий аккаунт</h2>
        <p className="mt-1 text-sm text-[var(--h-muted)]">Радар только читает открытые чаты, не вступает и никому не пишет. Ниже — сколько чтений чатов в минуту на все проекты. Если Telegram попросит паузу (FLOOD_WAIT), радар подождёт сам.</p>
        <div className="mt-3 flex gap-2">
          <input className={cx(inputClass, "w-24")} inputMode="numeric" value={reads} onChange={(event) => setReads(event.target.value.replace(/\D/g, ""))} aria-label="Чтений в минуту" />
          <Button onClick={saveReads} pending={saving} className="h-12">Сохранить</Button>
        </div>
      </Glass>
    </div>
  );
}

function NewProject({ reload }: { reload: () => Promise<void> }) {
  const toast = useToast();
  const [openForm, setOpenForm] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"own" | "client">("own");
  const [keywords, setKeywords] = useState("");
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    try {
      await post("/api/hunt/radar/projects", { name, kind, keywords });
      setName("");
      setKeywords("");
      setOpenForm(false);
      toast({ text: "Проект создан — добавьте открытые чаты", tone: "ok" });
      await reload();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setPending(false);
    }
  }

  if (!openForm) return <Button variant="light" className="w-full" onClick={() => setOpenForm(true)}><Plus className="h-4 w-4" />Новый проект радара</Button>;
  return (
    <Glass strong className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Новый проект</h2>
      <Field label="Название"><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Брокер складов" /></Field>
      <div className="flex flex-wrap gap-2">
        <Chip active={kind === "own"} onClick={() => setKind("own")}>Свой (студия)</Chip>
        <Chip active={kind === "client"} onClick={() => setKind("client")}>Для клиента (свой бот)</Chip>
      </div>
      <Field label="Ключевые слова" hint="По строкам или через запятую. Формы слов учитываются: «аренда склада» найдёт «ищу склад в аренду».">
        <textarea className={textareaClass} rows={3} value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder={"аренда склада\nответственное хранение\nпомещение под производство"} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setOpenForm(false)}>Отмена</Button>
        <Button variant="accent" pending={pending} disabled={name.trim().length < 2} onClick={create}>Создать</Button>
      </div>
    </Glass>
  );
}

function ProjectEditor({ project, reload }: { project: Project; reload: () => Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: project.name, target: project.target ?? "", keywords: project.keywords.join("\n"), minusWords: project.minusWords.join("\n"), minScore: String(project.minScore), pollMinutes: String(project.pollMinutes) });
  const [busy, setBusy] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ username: string; title: string; type: string; members: number | null }[] | null>(null);
  // Сбрасываем форму только когда изменились сохранённые значения, а не при каждом тихом обновлении.
  const savedKey = JSON.stringify([project.name, project.target, project.keywords, project.minusWords, project.minScore, project.pollMinutes]);
  useEffect(() => setForm({ name: project.name, target: project.target ?? "", keywords: project.keywords.join("\n"), minusWords: project.minusWords.join("\n"), minScore: String(project.minScore), pollMinutes: String(project.pollMinutes) }), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, task: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await task();
      if (ok) toast({ text: ok, tone: "ok" });
      await reload();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const save = () => run("save", () => post(`/api/hunt/radar/projects/${project.id}`, { name: form.name, target: form.target, keywords: form.keywords, minusWords: form.minusWords, minScore: Number(form.minScore) || 0, pollMinutes: Math.max(10, Number(form.pollMinutes) || 15) }, "PATCH"), "Сохранено");
  const addSource = (value: string) => run("add", async () => { await post(`/api/hunt/radar/projects/${project.id}/sources`, { ref: value }); setRef(""); }, "Чат добавлен — радар прочитает его в ближайшую минуту");

  async function search() {
    setBusy("search");
    try {
      setFound(await post<{ username: string; title: string; type: string; members: number | null }[]>(`/api/hunt/radar/search?q=${encodeURIComponent(q)}`, undefined, "GET"));
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Glass className="min-w-0 space-y-4 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold">{project.name}</h2>
          <p className="text-[13px] text-[var(--h-faint)]">{project.kind === "client" ? "Проект-клиент · находки уходят в его бот" : "Свой проект студии"} · {project.lastPollAt ? `проверено ${ago(project.lastPollAt)}` : "ещё не проверялся"}</p>
        </div>
        <Chip active={project.active} onClick={() => run("active", () => post(`/api/hunt/radar/projects/${project.id}`, { active: !project.active }, "PATCH"))}>{project.active ? "Включён" : "Выключен"}</Chip>
      </div>

      <Field label="Название"><input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
      <Field label="Кого ищем (своими словами, для модели)" hint="Например: «люди и компании, которые ищут склад в аренду от 200 м² в Москве и области».">
        <textarea className={textareaClass} rows={2} value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} />
      </Field>
      <Field label="Ключевые слова" hint="По строкам. Сообщение проходит, если в нём есть все слова хотя бы одной строки (в любой форме).">
        <textarea className={textareaClass} rows={4} value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} />
      </Field>
      <Field label="Минус-слова" hint="Сообщения с ними отбрасываются сразу: «сдам», «продам», «вакансия»…">
        <textarea className={textareaClass} rows={2} value={form.minusWords} onChange={(event) => setForm({ ...form, minusWords: event.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Мин. балл в ленте"><input className={inputClass} inputMode="numeric" value={form.minScore} onChange={(event) => setForm({ ...form, minScore: event.target.value.replace(/\D/g, "") })} /></Field>
        <Field label="Проверять, мин"><input className={inputClass} inputMode="numeric" value={form.pollMinutes} onChange={(event) => setForm({ ...form, pollMinutes: event.target.value.replace(/\D/g, "") })} /></Field>
      </div>
      <Button variant="accent" className="w-full" pending={busy === "save"} onClick={save}>Сохранить</Button>

      <div className="border-t border-[var(--h-line)] pt-4">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 font-semibold">Открытые чаты · {project.sources.length}</h3>
          <Button size="sm" pending={busy === "poll"} disabled={!project.sources.length} onClick={() => run("poll", () => post(`/api/hunt/radar/projects/${project.id}/poll`), "Проверим чаты в ближайшую минуту")}><RefreshCw className="h-4 w-4" />Проверить</Button>
        </div>
        <ul className="mt-2 space-y-2">
          {project.sources.map((source) => (
            <li key={source.id} className="flex min-w-0 items-center gap-2 rounded-2xl bg-white/[0.03] p-2 pl-3">
              <div className="min-w-0 flex-1">
                <a href={`https://t.me/${source.username}`} target="_blank" rel="noopener noreferrer" className={cx("block truncate text-sm font-medium", !source.active && "opacity-50")}>{source.title}</a>
                <p className={cx("truncate text-xs", source.lastError ? "text-[#ffb3b3]" : "text-[var(--h-faint)]")}>
                  {source.lastError ?? `@${source.username}${source.members ? ` · ${source.members.toLocaleString("ru-RU")} уч.` : ""} · запросов ${source.matchCount}`}
                </p>
              </div>
              <Chip active={source.active} onClick={() => run(`s:${source.id}`, () => post(`/api/hunt/radar/sources/${source.id}`, { active: !source.active }, "PATCH"))}>{source.active ? "Вкл" : "Выкл"}</Chip>
              <button type="button" aria-label="Убрать чат" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--h-muted)] hover:bg-white/10" onClick={() => run(`d:${source.id}`, () => post(`/api/hunt/radar/sources/${source.id}`, undefined, "DELETE"))}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <input className={cx(inputClass, "min-w-0 flex-1")} value={ref} onChange={(event) => setRef(event.target.value)} placeholder="@chat или t.me/chat" autoCapitalize="none" />
          <Button className="h-12 shrink-0" pending={busy === "add"} disabled={ref.trim().length < 3} onClick={() => addSource(ref)}>Добавить</Button>
        </div>
        <div className="mt-2 flex gap-2">
          <input className={cx(inputClass, "min-w-0 flex-1")} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Найти чаты: аренда склад москва" onKeyDown={(event) => { if (event.key === "Enter" && q.trim().length >= 3) void search(); }} />
          <Button className="h-12 shrink-0" pending={busy === "search"} disabled={q.trim().length < 3} onClick={search} aria-label="Найти чаты"><Search className="h-4 w-4" /></Button>
        </div>
        {found ? (
          <ul className="mt-2 space-y-1.5">
            {found.length === 0 ? <li className="text-sm text-[var(--h-faint)]">Открытых чатов не нашлось — попробуйте другие слова.</li> : found.map((peer) => (
              <li key={peer.username} className="flex min-w-0 items-center gap-2 rounded-2xl bg-white/[0.03] p-2 pl-3">
                <div className="min-w-0 flex-1">
                  <a href={`https://t.me/${peer.username}`} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium">{peer.title}</a>
                  <p className="truncate text-xs text-[var(--h-faint)]">@{peer.username} · {peer.type === "channel" ? "канал" : "чат"}{peer.members ? ` · ${peer.members.toLocaleString("ru-RU")}` : ""}</p>
                </div>
                <Button size="sm" disabled={project.sources.some((item) => item.username === peer.username) || busy === "add"} onClick={() => addSource(peer.username)}>{project.sources.some((item) => item.username === peer.username) ? "Есть" : "Добавить"}</Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {project.kind === "client" ? <BotBlock project={project} run={run} busy={busy} /> : null}

      <div className="border-t border-[var(--h-line)] pt-3">
        <Button variant="danger" size="sm" pending={busy === "delete"} onClick={() => { if (window.confirm(`Удалить проект «${project.name}» со всеми находками?`)) void run("delete", () => post(`/api/hunt/radar/projects/${project.id}`, undefined, "DELETE"), "Проект удалён"); }}>Удалить проект</Button>
      </div>
    </Glass>
  );
}

function BotBlock({ project, run, busy }: { project: Project; run: (key: string, task: () => Promise<unknown>, ok?: string) => Promise<void>; busy: string | null }) {
  const [token, setToken] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const bot = project.bot;

  return (
    <div className="space-y-3 border-t border-[var(--h-line)] pt-4">
      <h3 className="font-semibold">Бот заказчика</h3>
      {!bot.connected ? (
        <>
          <p className="text-sm text-[var(--h-muted)]">Заказчик создаёт бота в @BotFather и даёт токен. Находки придут ему в этот бот с кнопками «Взять / Не то / Позже». Токен хранится зашифрованным.</p>
          <div className="flex gap-2">
            <input className={cx(inputClass, "min-w-0 flex-1")} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="123456789:AA…" />
            <Button className="h-12 shrink-0" pending={busy === "bot"} disabled={token.trim().length < 20} onClick={() => run("bot", async () => { const result = await post<{ link: string }>(`/api/hunt/radar/projects/${project.id}/bot`, { token }); setToken(""); setLink(result.link); }, "Бот подключён")}>Подключить</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--h-muted)]">@{bot.username} · {bot.linked ? `получатель: ${bot.chatTitle}` : "получатель ещё не привязан"}</p>
          {link || !bot.linked ? (
            <Notice tone="info">
              Отправьте заказчику ссылку — он нажмёт «Start», и запросы пойдут ему.{" "}
              {link ? <a className="break-all font-medium underline" href={link} target="_blank" rel="noopener noreferrer">{link}</a> : null}
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" pending={busy === "bind"} onClick={() => run("bind", async () => setLink((await post<{ link: string }>(`/api/hunt/radar/projects/${project.id}/bot/bind`)).link))}>{bot.linked ? "Сменить получателя" : "Ссылка привязки"}</Button>
            <Button size="sm" pending={busy === "btest"} disabled={!bot.linked} onClick={() => run("btest", () => post(`/api/hunt/radar/projects/${project.id}/bot/test`), "Тест отправлен")}>Тест</Button>
            <Button size="sm" pending={busy === "report"} disabled={!bot.linked} onClick={() => run("report", () => post(`/api/hunt/radar/projects/${project.id}/bot/report`), "Отчёт отправлен")}>Отчёт за неделю</Button>
            <Button size="sm" variant="danger" pending={busy === "unbot"} onClick={() => run("unbot", () => post(`/api/hunt/radar/projects/${project.id}/bot`, undefined, "DELETE"), "Бот отключён")}>Отключить</Button>
          </div>
        </>
      )}
    </div>
  );
}
