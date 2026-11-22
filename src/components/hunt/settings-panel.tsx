"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Minus, Plus, RefreshCw, Sheet as SheetIcon } from "lucide-react";
import { appsScript } from "@/lib/domain/apps-script";
import { useHunt } from "./shell";
import { post, useLive } from "./data";
import { Button, Chip, Field, Glass, Notice, Sheet, Skeleton, cx, errorText, inputClass, useToast } from "./ui";
import { dayLabel, type HuntSettings, type SheetStatus } from "./types";

type Segment = { id: string; label: string; contour: string };

const ZONES = [
  { key: "Europe/Kaliningrad", label: "Калининград" },
  { key: "Europe/Moscow", label: "Москва" },
  { key: "Europe/Samara", label: "Самара" },
  { key: "Asia/Yekaterinburg", label: "Екатеринбург" },
  { key: "Asia/Novosibirsk", label: "Новосибирск" },
  { key: "Asia/Vladivostok", label: "Владивосток" },
  { key: "Asia/Makassar", label: "Бали" },
];

function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function SettingsPanel({ open }: { open: boolean }) {
  const { close, refresh, version, user } = useHunt();
  const toast = useToast();
  const admin = ["OWNER", "ADMIN"].includes(user.role);
  const settings = useLive<HuntSettings>(open && admin ? "/api/settings" : null, version);
  const segments = useLive<Segment[]>(open ? "/api/hunt/segments" : null);
  const sheets = useLive<SheetStatus>(open ? "/api/hunt/sheets" : null, version, open ? 8000 : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [token, setToken] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [projectWebhook, setProjectWebhook] = useState("");
  const hunt = settings.data?.hunt;

  useEffect(() => {
    if (hunt) { setSheetUrl(hunt.sheetUrl); setProjectWebhook(hunt.projectWebhookUrl); }
  }, [hunt]);
  useEffect(() => { if (open && !token) setToken(newToken()); }, [open, token]);

  const script = useMemo(() => (token ? appsScript(token) : ""), [token]);

  async function save(patch: Partial<HuntSettings["hunt"]>, ok = "Сохранено") {
    if (!hunt) return;
    setBusy(true);
    setError("");
    try {
      const next = await post<HuntSettings>("/api/settings", { hunt: { ...hunt, ...patch } }, "PATCH");
      settings.setData(next);
      refresh();
      toast({ text: ok });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function connectSheets() {
    setBusy(true);
    setError("");
    try {
      await post("/api/integrations/sheets", { secrets: { webhookUrl: webhookUrl.trim(), token } }, "PUT");
      await post("/api/integrations/sheets/test");
      await post("/api/hunt/sheets/sync");
      if (sheetUrl.trim() && hunt && sheetUrl.trim() !== hunt.sheetUrl) await post("/api/settings", { hunt: { ...hunt, sheetUrl: sheetUrl.trim() } }, "PATCH");
      setWebhookUrl("");
      await sheets.reload();
      refresh();
      toast({ text: "Таблица подключена — выгружаем все карточки и проекты" });
    } catch (reason) {
      setError(errorText(reason));
      await sheets.reload();
    } finally {
      setBusy(false);
    }
  }

  async function copyScript() {
    try { await navigator.clipboard.writeText(script); toast({ text: "Код скопирован — вставьте его в Apps Script" }); } catch { toast({ text: "Не удалось скопировать", tone: "error" }); }
  }

  const connected = sheets.data?.status === "connected";

  return (
    <Sheet open={open} onClose={close} title="Настройки охоты" subtitle={admin ? "Контур, лимиты, таблица и API" : "Настройки меняет владелец или администратор"}>
      <div className="space-y-7">
        {error ? <Notice tone="error">{error}</Notice> : null}

        {admin ? (!hunt ? <Skeleton rows={2} /> : (
          <>
            <section>
              <h3 className="text-lg font-semibold">Активный контур</h3>
              <p className="mb-3 mt-1 text-sm text-[var(--h-muted)]">Скоринг тратит AI только на эти ниши. Стратегия советует держать не больше трёх.</p>
              <div className="flex flex-wrap gap-2">
                {(segments.data ?? []).map((item) => {
                  const on = hunt.activeSegments.includes(item.id);
                  return (
                    <Chip key={item.id} active={on} disabled={busy} onClick={() => {
                      const next = on ? hunt.activeSegments.filter((key) => key !== item.id) : [...hunt.activeSegments, item.id];
                      if (next.length) void save({ activeSegments: next }, "Контур обновлён");
                    }}>
                      <span className="tabular-nums opacity-60">{item.id}</span> {item.label}
                    </Chip>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <Glass className="p-4">
                <div className="text-sm text-[var(--h-muted)]">Новых касаний в день</div>
                <div className="mt-2 flex items-center justify-between">
                  <button aria-label="Меньше" disabled={busy || hunt.dailyLimit <= 5} onClick={() => save({ dailyLimit: hunt.dailyLimit - 5 })} className="glass grid h-11 w-11 place-items-center rounded-full disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                  <span className="text-4xl font-semibold tabular-nums">{hunt.dailyLimit}</span>
                  <button aria-label="Больше" disabled={busy || hunt.dailyLimit >= 60} onClick={() => save({ dailyLimit: hunt.dailyLimit + 5 })} className="glass grid h-11 w-11 place-items-center rounded-full disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                </div>
                <p className="mt-2 text-xs text-[var(--h-faint)]">25–30 на аккаунт — дальше риск блокировки.</p>
              </Glass>
              <Glass className="p-4">
                <div className="text-sm text-[var(--h-muted)]">Скоринг после поиска</div>
                <button role="switch" aria-checked={hunt.autoQualify} disabled={busy} onClick={() => save({ autoQualify: !hunt.autoQualify })} className="mt-3 flex w-full items-center justify-between">
                  <span className="text-[15px]">{hunt.autoQualify ? `Сам, до ${hunt.autoQualifyMax} за поиск` : "Только вручную"}</span>
                  <span className={cx("relative h-8 w-14 rounded-full transition", hunt.autoQualify ? "bg-[var(--h-accent)]" : "bg-white/15")}>
                    <span className={cx("absolute top-1 h-6 w-6 rounded-full bg-white transition-all", hunt.autoQualify ? "left-7" : "left-1")} />
                  </span>
                </button>
              </Glass>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-semibold">Часовой пояс дня</h3>
              <p className="mb-3 text-sm text-[var(--h-muted)]">Когда обнуляется дневной лимит и наступает «сегодня» для напоминаний.</p>
              <div className="flex flex-wrap gap-2">
                {ZONES.map((zone) => <Chip key={zone.key} active={hunt.timezone === zone.key} disabled={busy} onClick={() => save({ timezone: zone.key })}>{zone.label}</Chip>)}
              </div>
            </section>
          </>
        )) : null}

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <SheetIcon className="h-5 w-5 text-[var(--h-ok)]" />
            <h3 className="text-lg font-semibold">Google Таблица</h3>
            {sheets.data ? <span className={cx("ml-auto rounded-full px-2.5 py-1 text-xs font-medium", connected ? "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]" : "bg-white/10 text-[var(--h-muted)]")}>{connected ? "подключена" : sheets.data.configured ? "не проверена" : "не подключена"}</span> : null}
          </div>
          {sheets.data && connected ? (
            <Glass className="space-y-1 p-4 text-sm">
              <p>Лидов в таблице: <b>{sheets.data.leads}</b> · проектов: <b>{sheets.data.projects}</b></p>
              <p className="text-[var(--h-muted)]">Последняя запись: {sheets.data.lastSyncAt ? dayLabel(sheets.data.lastSyncAt) : "ещё не было"}{sheets.data.pending ? ` · в очереди ${sheets.data.pending}` : ""}</p>
              {sheets.data.lastError ? <p className="text-[#ffb3b3]">{sheets.data.lastError}</p> : null}
              <div className="flex flex-wrap gap-2 pt-2">
                {hunt?.sheetUrl ? <a href={hunt.sheetUrl} target="_blank" rel="noreferrer" className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5"><ExternalLink className="h-4 w-4" /> Открыть таблицу</a> : null}
                {admin ? <Button size="sm" pending={busy} onClick={() => post("/api/hunt/sheets/sync").then(() => { toast({ text: "Выгружаем всё заново" }); void sheets.reload(); }).catch((reason) => setError(errorText(reason)))}><RefreshCw className="h-4 w-4" /> Выгрузить всё</Button> : null}
              </div>
            </Glass>
          ) : null}
          {admin ? (
            <>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[var(--h-muted)]">
                <li>Создайте Google Таблицу → Расширения → Apps Script.</li>
                <li>Удалите всё и вставьте код — токен уже внутри.</li>
                <li>Развернуть → Новое развёртывание → Веб-приложение. Выполнять как «Я», доступ «Все».</li>
                <li>Вставьте ссылку …/exec ниже и нажмите «Подключить».</li>
              </ol>
              <Button size="md" onClick={copyScript} className="w-full"><Copy className="h-4 w-4" /> Скопировать код для Apps Script</Button>
              <Field label="Ссылка веб-приложения" hint="Вида https://script.google.com/macros/s/…/exec"><input className={inputClass} value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://script.google.com/macros/s/…/exec" /></Field>
              <Field label="Ссылка на саму таблицу" hint="Для кнопки «Открыть таблицу»"><input className={inputClass} value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /></Field>
              <Button variant="accent" size="lg" className="w-full" pending={busy} disabled={!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(webhookUrl.trim())} onClick={connectSheets}>{connected ? "Переподключить" : "Подключить"}</Button>
              <p className="text-xs text-[var(--h-faint)]">Переподключаете? Скопируйте код заново — после перезагрузки страницы токен будет новым.</p>
            </>
          ) : null}
        </section>

        {admin && hunt ? (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">JSON проекта по API</h3>
            <p className="text-sm text-[var(--h-muted)]">Когда создаётся проект, LeadFlow отправит POST с полным JSON (схема leadflow.project.v1) на этот адрес — n8n, Make, Studio, ваша CRM.</p>
            <Field label="Адрес приёмника (https)"><input className={inputClass} value={projectWebhook} onChange={(event) => setProjectWebhook(event.target.value)} placeholder="https://…" /></Field>
            <Button size="md" pending={busy} disabled={projectWebhook.trim() === hunt.projectWebhookUrl} onClick={() => save({ projectWebhookUrl: projectWebhook.trim() }, projectWebhook.trim() ? "Адрес сохранён" : "Отправка по API выключена")}>Сохранить адрес</Button>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
