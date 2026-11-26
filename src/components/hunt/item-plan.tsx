"use client";

import { useState } from "react";
import { Check, ChevronRight, Send } from "lucide-react";
import { post } from "./data";
import { copyAndOpen, saveTouch } from "./chat-open";
import { Button, Empty, cx, errorText, useToast } from "./ui";
import type { Plan, PlanAction } from "./types";

const KIND: Record<PlanAction["kind"], { label: string; tone: string }> = {
  task: { label: "Задача", tone: "tint-yellow" },
  dialog: { label: "Ответить", tone: "tint-green" },
  day4: { label: "День 4", tone: "tint-orange" },
  day8: { label: "День 8", tone: "tint-orange" },
  write: { label: "Написать", tone: "" },
  new: { label: "Новая A", tone: "" },
};

/** «Сегодня» по брифу: не больше 30 действий. Касания дня 4 и 8 отправляются прямо из списка — без захода в карточку. */
export function PlanList({ plan, role, onOpen, onChanged }: { plan: Plan; role: string; onOpen: (id: string) => void; onChanged: () => void }) {
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const hide = (key: string) => setDone((prev) => new Set(prev).add(key));
  const actions = plan.actions.filter((item) => !done.has(item.key));

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

  if (!actions.length) return <Empty title="На сегодня всё" text="Новые A, касания дня 4 и 8 и задачи на фрагмент или демо появятся здесь. Запустите поиск, чтобы были новые карточки." />;
  return (
    <div className="space-y-2">
      <p className="px-1 text-sm text-[var(--h-muted)]">{actions.length} из {plan.limit} действий{plan.more ? ` · ещё ${plan.more} ждут завтра` : ""} · первых сообщений сегодня: {plan.sentToday}</p>
      {actions.map((item) => (
        <div key={item.key} className={cx("glass rounded-[24px] border", KIND[item.kind].tone)}>
          <button onClick={() => onOpen(item.outreachId)} className="flex w-full items-start gap-3 px-4 pt-3.5 text-left">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--h-faint)]">{KIND[item.kind].label}{item.presetLabel ? <span className="font-normal normal-case tracking-normal">· {item.presetLabel}</span> : null}</div>
              <div className="mt-0.5 line-clamp-2 text-[17px] font-semibold leading-6">{item.name}</div>
              <p className="mt-0.5 line-clamp-2 text-[14px] leading-5 text-[var(--h-muted)]">{item.note}</p>
            </div>
            {item.grade ? <span className={cx("grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-2 text-[13px] font-semibold", item.grade === "A" ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : "bg-white/10 text-[var(--h-muted)]")}>{item.grade}</span> : <ChevronRight className="mt-1 h-5 w-5 text-[var(--h-faint)]" />}
          </button>
          {item.text ? <p className="mx-4 mt-2 line-clamp-3 rounded-2xl bg-black/20 px-3 py-2 text-[14px] leading-5">{item.text}</p> : null}
          <div className="flex justify-end gap-2 px-3 pb-3 pt-2">
            {(item.kind === "day4" || item.kind === "day8") && item.targets[0] ? (
              <Button size="md" variant="accent" onClick={() => touch(item)}><Send className="h-4 w-4" /> Скопировать и открыть</Button>
            ) : item.kind === "task" ? (
              <Button size="md" variant="light" onClick={() => finish(item)}><Check className="h-4 w-4" /> Готово</Button>
            ) : (
              <Button size="md" onClick={() => onOpen(item.outreachId)}>Открыть <ChevronRight className="h-4 w-4" /></Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
