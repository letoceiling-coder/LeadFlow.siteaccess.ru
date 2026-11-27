"use client";

import { useState } from "react";
import { Check, ChevronRight, MapPin, Send } from "lucide-react";
import { post } from "./data";
import { copyAndOpen, saveTouch } from "./chat-open";
import { Button, Chip, Empty, cx, errorText, useToast } from "./ui";
import type { Plan, PlanAction } from "./types";

const KIND: Record<PlanAction["kind"], { label: string; tone: string; dot: string }> = {
  task: { label: "Задача", tone: "tint-yellow", dot: "bg-[var(--h-accent)]" },
  dialog: { label: "Ответить", tone: "tint-green", dot: "bg-[var(--h-ok)]" },
  day4: { label: "День 4", tone: "", dot: "bg-[var(--h-hot)]" },
  day8: { label: "День 8", tone: "", dot: "bg-[var(--h-hot)]" },
  write: { label: "Написать", tone: "", dot: "bg-[var(--h-info)]" },
  new: { label: "Новая A", tone: "", dot: "bg-white/50" },
};
const KIND_ORDER: PlanAction["kind"][] = ["dialog", "task", "day4", "day8", "write", "new"];

/** «Сегодня» по брифу: не больше 30 действий. Касания дня 4 и 8 отправляются прямо из списка — без захода в карточку. */
export function PlanList({ plan, role, onOpen, onChanged }: { plan: Plan; role: string; onOpen: (id: string) => void; onChanged: () => void }) {
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<PlanAction["kind"] | null>(null);
  const hide = (key: string) => setDone((prev) => new Set(prev).add(key));
  const left = plan.actions.filter((item) => !done.has(item.key));
  const actions = left.filter((item) => !kind || item.kind === kind);
  const kinds = KIND_ORDER.map((key) => ({ key, count: left.filter((item) => item.kind === key).length })).filter((item) => item.count);

  function touch(item: PlanAction) {
    const target = item.targets[0];
    if (!target || !item.text) return onOpen(item.outreachId);
    copyAndOpen(item.text, target);
    hide(item.key);
    saveTouch(item.outreachId, { kind: "followup", channel: target.channel, text: item.text }, role)
      .then((result) => {
        toast({ text: result.silent ? `«${item.name}»: день 8 записан, дальше «Тишина»` : `«${item.name}»: касание записано`, action: { label: "Отменить", run: () => { void post(`/api/hunt/touches/${result.touchId}/undo`).then(onChanged); } } });
        onChanged();
      })
      .catch((reason) => {
        setDone((prev) => { const next = new Set(prev); next.delete(item.key); return next; });
        toast({ text: errorText(reason), tone: "error" });
      });
  }

  async function finish(item: PlanAction) {
    if (!item.taskId) return;
    hide(item.key);
    try {
      await post(`/api/hunt/tasks/${item.taskId}/done`);
      toast({ text: "Задача закрыта — отправьте результат клиенту", action: { label: "Открыть", run: () => onOpen(item.outreachId) } });
      onChanged();
    } catch (reason) {
      toast({ text: errorText(reason), tone: "error" });
    }
  }

  if (!left.length) return <Empty title="На сегодня всё" text="Новые A, касания дня 4 и 8 и задачи на фрагмент или демо появятся здесь. Запустите поиск, чтобы были новые карточки." />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          <Chip active={!kind} onClick={() => setKind(null)}>Все <span className="tabular-nums opacity-60">{left.length}</span></Chip>
          {kinds.map((item) => (
            <Chip key={item.key} active={kind === item.key} onClick={() => setKind(kind === item.key ? null : item.key)}>
              <span className={cx("h-1.5 w-1.5 rounded-full", KIND[item.key].dot)} />{KIND[item.key].label} <span className="tabular-nums opacity-60">{item.count}</span>
            </Chip>
          ))}
        </div>
        <p className="px-1 text-[13px] text-[var(--h-faint)]">{left.length} из {plan.limit}{plan.more ? ` · ещё ${plan.more} завтра` : ""} · первых сегодня: {plan.sentToday}</p>
      </div>
      {actions.length === 0 ? <Empty title="Такого в плане нет" text="Выберите другой тип действия или «Все»." /> : null}
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {actions.map((item) => (
          <div key={item.key} className={cx("glass group flex flex-col rounded-[var(--h-radius)] border transition hover:bg-white/[0.08]", KIND[item.kind].tone)}>
            <button onClick={() => onOpen(item.outreachId)} className="flex w-full flex-1 flex-col px-4 pt-3.5 text-left">
              <div className="flex w-full items-center gap-2 text-[12px] text-[var(--h-faint)]">
                <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", KIND[item.kind].dot)} />
                <span className="font-semibold uppercase tracking-wider">{KIND[item.kind].label}</span>
                {item.presetLabel ? <span className="truncate">· {item.presetLabel}</span> : null}
                <span className="flex-1" />
                {item.grade ? <span className={cx("grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1.5 text-[12px] font-semibold", item.grade === "A" ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : "bg-white/10 text-[var(--h-muted)]")}>{item.grade}</span> : null}
              </div>
              <div className="mt-1.5 line-clamp-1 text-[16px] font-semibold leading-6">{item.name}</div>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-[var(--h-muted)]">{item.note}</p>
              {item.text ? <div className="mt-2 rounded-xl bg-black/20 px-3 py-2"><p className="line-clamp-2 text-[13px] leading-[18px] text-[var(--h-text)]/85">{item.text}</p></div> : null}
            </button>
            <div className="mt-auto flex items-center gap-2 px-4 pb-3 pt-3">
              {item.city ? <span className="inline-flex min-w-0 items-center gap-1 truncate text-[12px] text-[var(--h-faint)]"><MapPin className="h-3.5 w-3.5 shrink-0" />{item.city}</span> : null}
              <span className="flex-1" />
              {(item.kind === "day4" || item.kind === "day8") && item.targets[0] ? (
                <Button size="sm" variant="accent" onClick={() => touch(item)}><Send className="h-3.5 w-3.5" /> Скопировать и открыть</Button>
              ) : item.kind === "task" ? (
                <Button size="sm" variant="light" onClick={() => finish(item)}><Check className="h-3.5 w-3.5" /> Готово</Button>
              ) : (
                <Button size="sm" onClick={() => onOpen(item.outreachId)}>Открыть <ChevronRight className="h-3.5 w-3.5" /></Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
