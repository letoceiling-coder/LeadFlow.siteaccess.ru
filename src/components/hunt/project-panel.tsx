"use client";

import { useEffect, useState } from "react";
import { Check, Download, Plus, Send, UserRound } from "lucide-react";
import { useHunt } from "./shell";
import { post, useLive } from "./data";
import { Button, Chip, Field, Notice, Ring, Sheet, Skeleton, cx, errorText, inputClass, textareaClass, useToast } from "./ui";
import { PROJECT_STAGE_LABEL, dayLabel, rub, type Project } from "./types";

const STAGES = ["brief", "estimate", "prepaid", "in_work", "review", "done", "cancelled"];

export function ProjectPanel({ id }: { id: string | null }) {
  const { close, refresh, version, open } = useHunt();
  const toast = useToast();
  const project = useLive<Project>(id ? `/api/hunt/projects/${id}` : null, version);
  const data = project.data && project.data.id === id ? project.data : null;
  const [form, setForm] = useState({ title: "", amount: "", deadlineAt: "", contactName: "", contactValue: "", notes: "", product: "" });
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data) return;
    setForm({
      title: data.title,
      amount: data.amount == null ? "" : String(data.amount),
      deadlineAt: data.deadlineAt ? data.deadlineAt.slice(0, 10) : "",
      contactName: data.contactName ?? "",
      contactValue: data.contactValue ?? "",
      notes: data.notes ?? "",
      product: data.product ?? "",
    });
    // Форма заполняется при открытии проекта, а не при каждом обновлении — иначе затирались бы правки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  async function patch(body: Record<string, unknown>, ok?: string) {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const next = await post<Project>(`/api/hunt/projects/${data.id}`, body, "PATCH");
      project.setData(next);
      refresh();
      if (ok) toast({ text: ok });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function saveField(key: keyof typeof form) {
    if (!data) return;
    const raw = form[key].trim();
    const current = key === "amount" ? (data.amount == null ? "" : String(data.amount)) : key === "deadlineAt" ? (data.deadlineAt ?? "").slice(0, 10) : String((data as Record<string, unknown>)[key] ?? "");
    if (raw === current) return;
    if (key === "title" && raw.length < 2) return setError("Название — минимум 2 символа");
    const value = key === "amount" ? (raw ? Math.max(0, Math.round(Number(raw.replace(/\s/g, "")))) : null) : raw || null;
    if (key === "amount" && value !== null && !Number.isFinite(value as number)) return setError("Сумма — числом");
    void patch({ [key]: value }, "Сохранено");
  }

  async function webhook() {
    if (!data) return;
    setBusy(true);
    try {
      await post(`/api/hunt/projects/${data.id}/webhook`);
      toast({ text: "JSON поставлен в отправку" });
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => setForm((prev) => ({ ...prev, [key]: event.target.value })),
    onBlur: () => saveField(key),
  });

  return (
    <Sheet
      open={Boolean(id)}
      onClose={close}
      title={data?.title ?? "Проект"}
      subtitle={data ? [data.organization?.name !== data.title ? data.organization?.name : null, data.scenarioTitle, rub(data.amount)].filter(Boolean).join(" · ") : null}
      badge={data ? <Ring done={data.progress.done} total={data.progress.total} /> : null}
      footer={data ? (
        <div className="grid grid-cols-2 gap-2">
          <a href={`/api/hunt/projects/${data.id}/json`} download className="glass inline-flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-medium"><Download className="h-4 w-4" /> JSON</a>
          <Button variant="accent" className="h-12 rounded-2xl" pending={busy} onClick={webhook}><Send className="h-4 w-4" /> Отправить по API</Button>
        </div>
      ) : null}
    >
      {!data ? (project.error ? <Notice tone="error">{project.error}</Notice> : <Skeleton rows={4} />) : (
        <div className="space-y-6">
          {error ? <Notice tone="error">{error}</Notice> : null}

          <section>
            <h3 className="mb-2 text-sm font-medium text-[var(--h-muted)]">Этап</h3>
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
              {STAGES.map((stage) => <Chip key={stage} active={data.stage === stage} disabled={busy} onClick={() => data.stage !== stage && patch({ stage }, `Этап: ${PROJECT_STAGE_LABEL[stage]}`)}>{PROJECT_STAGE_LABEL[stage]}</Chip>)}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-lg font-semibold">Чек-лист</h3>
              <span className="text-sm tabular-nums text-[var(--h-muted)]">{data.progress.done} из {data.progress.total}</span>
            </div>
            <div className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl">
              {data.checklist.map((item) => (
                <button key={item.id} disabled={busy} onClick={() => patch({ toggle: item.id })} className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition hover:bg-white/5">
                  <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full border", item.done ? "border-transparent bg-[var(--h-ok)] text-[#062b16]" : "border-[var(--h-line-strong)]")}>{item.done ? <Check className="h-4 w-4" strokeWidth={3} /> : null}</span>
                  <span className={cx("text-[15px]", item.done && "text-[var(--h-faint)] line-through")}>{item.title}</span>
                </button>
              ))}
              <form className="flex items-center gap-2 px-3 py-2" onSubmit={(event) => { event.preventDefault(); if (newItem.trim().length >= 2) { void patch({ addItem: newItem.trim() }); setNewItem(""); } }}>
                <input value={newItem} onChange={(event) => setNewItem(event.target.value)} placeholder="Добавить пункт" className="h-11 flex-1 bg-transparent px-1 text-[15px] outline-none" />
                <button aria-label="Добавить пункт" className="grid h-10 w-10 place-items-center rounded-full text-[var(--h-accent)] disabled:opacity-40" disabled={newItem.trim().length < 2}><Plus className="h-5 w-5" /></button>
              </form>
            </div>
          </section>

          <section className="space-y-4">
            <Field label="Название"><input className={inputClass} {...field("title")} /></Field>
            <Field label="Продукт"><input className={inputClass} {...field("product")} placeholder="Сайт доставки, кабинет дилера…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Сумма, ₽"><input className={inputClass} inputMode="numeric" {...field("amount")} /></Field>
              <Field label="Дедлайн"><input type="date" className={inputClass} {...field("deadlineAt")} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Контакт"><input className={inputClass} {...field("contactName")} placeholder="Имя" /></Field>
              <Field label="Телефон / ник"><input className={inputClass} {...field("contactValue")} /></Field>
            </div>
            <Field label="Заметки"><textarea rows={4} className={textareaClass} {...field("notes")} placeholder="Договорённости, доступы, пожелания" /></Field>
          </section>

          <section className="space-y-2 text-sm text-[var(--h-muted)]">
            {data.outreachId ? <button className="inline-flex items-center gap-1.5 text-[var(--h-accent)]" onClick={() => open("item", data.outreachId!, true)}><UserRound className="h-4 w-4" /> Карточка лида и переписка</button> : null}
            <p>Создан {dayLabel(data.createdAt)} · {data.source === "hunt" ? "из охоты" : "вручную"}</p>
            <p>Google Таблица: {data.sheetSyncedAt ? `обновлено ${dayLabel(data.sheetSyncedAt)}` : "ещё не выгружен (подключите в настройках)"}</p>
            <p>API: {data.webhookError ? <span className="text-[#ffb3b3]">{data.webhookError}</span> : data.webhookAt ? `доставлено ${dayLabel(data.webhookAt)}` : "адрес не задан или ещё не отправлялся"}</p>
          </section>
        </div>
      )}
    </Sheet>
  );
}
