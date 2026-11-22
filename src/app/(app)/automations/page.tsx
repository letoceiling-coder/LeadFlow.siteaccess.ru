"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { ALLOWED_ACTIONS, ALLOWED_TRIGGERS } from "@/lib/domain/automation";
import { PIPELINE, formatDate } from "@/lib/domain/labels";

type Rule = { id: string; name: string; description: string | null; active: boolean; trigger: string; conditions: { all?: { field: string; op: string; value?: string }[] }; actions: { type: string }[]; intervalMinutes: number | null };
type Run = { id: string; status: string; dryRun: boolean; error: string | null; startedAt: string };

const TRIGGER_LABEL: Record<string, string> = {
  "organization.created": "Появилась организация",
  "analysis.completed": "Анализ завершён",
  "score.updated": "Оценка изменилась",
  "site.created": "Создан демо-сайт",
  "qa.completed": "QA завершена",
  "demo.approved": "Демо одобрено",
  "message.replied": "Пришёл ответ",
  "deal.won": "Сделка выиграна",
  "schedule.tick": "По расписанию",
};

const ACTION_LABEL: Record<string, string> = {
  compute_score: "Посчитать оценку",
  enqueue_analysis: "Поставить анализ в очередь",
  create_task: "Создать задачу",
  notify: "Внутреннее уведомление",
  move_stage: "Сменить стадию",
  prepare_draft: "Подготовить черновик",
  suggest_demo: "Предложить демо",
};

export default function AutomationsPage() {
  const rules = useResource<Rule[]>("/api/automations");
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [trigger, setTrigger] = useState<string>(ALLOWED_TRIGGERS[0]);

  return (
    <div>
      <PageTitle title="Автоматизации" text="Правило может посчитать оценку, поставить анализ, создать задачу, уведомить команду или подготовить черновик. Отправка, публикация и запуск кампании здесь недоступны и остаются за человеком." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card>
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const action = String(form.get("action"));
            const body = {
              name: form.get("name"),
              description: form.get("description") || undefined,
              active: false,
              trigger,
              conditions: form.get("field") ? { all: [{ field: String(form.get("field")), op: String(form.get("op") || "eq"), value: String(form.get("value") || "") }] } : {},
              actions: [{ type: action, params: action === "move_stage" ? { stageKey: form.get("stageKey") } : action === "notify" ? { title: "Автоматизация", body: String(form.get("note") || form.get("name")) } : {} }],
              intervalMinutes: trigger === "schedule.tick" ? Number(form.get("intervalMinutes") || 60) : null,
            };
            api("/api/automations", { method: "POST", body: JSON.stringify(body) }).then(() => rules.reload()).catch((reason) => setError(reason.message));
          }}>
            <Field label="Название"><input name="name" required className={controlClass} /></Field>
            <Field label="Описание"><input name="description" className={controlClass} /></Field>
            <Field label="Когда">
              <select className={controlClass} value={trigger} onChange={(event) => setTrigger(event.target.value)}>
                {ALLOWED_TRIGGERS.map((item) => <option key={item} value={item}>{TRIGGER_LABEL[item]}</option>)}
              </select>
            </Field>
            <Field label="Что сделать">
              <select name="action" className={controlClass}>
                {(trigger === "schedule.tick" ? ["notify"] : ALLOWED_ACTIONS).map((item) => <option key={item} value={item}>{ACTION_LABEL[item]}</option>)}
              </select>
            </Field>
            <Field label="Стадия, если действие — смена стадии">
              <select name="stageKey" className={controlClass}>{PIPELINE.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}</select>
            </Field>
            <Field label="Текст уведомления"><input name="note" className={controlClass} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <input name="field" className={controlClass} placeholder="поле" />
              <select name="op" className={controlClass}><option value="eq">равно</option><option value="gte">не меньше</option><option value="exists">есть</option></select>
              <input name="value" className={controlClass} placeholder="значение" />
            </div>
            {trigger === "schedule.tick" ? <Field label="Интервал, минут" hint="Не меньше 15. По расписанию доступно только уведомление."><input name="intervalMinutes" type="number" min={15} defaultValue={60} className={controlClass} /></Field> : null}
            <Button type="submit">Сохранить выключенным</Button>
          </form>
        </Card>
        <div className="space-y-3">
          {rules.loading ? <Loading /> : rules.error ? <State title="Правила недоступны" text={rules.error} /> : (rules.data ?? []).length === 0 ? <State title="Правил нет" text="Новое правило создаётся выключенным. Включите его после проверки сухого прогона." /> : (rules.data ?? []).map((rule) => (
            <Card key={rule.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{rule.name}</div>
                  <p className="text-sm text-slate-600">{TRIGGER_LABEL[rule.trigger] || rule.trigger} → {(rule.actions ?? []).map((action) => ACTION_LABEL[action.type] || action.type).join(", ")}</p>
                  {rule.description ? <p className="text-sm text-slate-500">{rule.description}</p> : null}
                </div>
                <Badge tone={rule.active ? "green" : "slate"}>{rule.active ? "включено" : "выключено"}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => api(`/api/automations/${rule.id}`, { method: "PATCH", body: JSON.stringify({ active: !rule.active }) }).then(() => rules.reload()).catch((reason) => setError(reason.message))}>{rule.active ? "Выключить" : "Включить"}</Button>
                <Button variant="secondary" onClick={() => api<Run>(`/api/automations/${rule.id}/dry-run`, { method: "POST", body: JSON.stringify({ payload: { city: "Казань", leadScore: 70 } }) }).then((run) => setRuns(run ? [run] : [])).catch((reason) => setError(reason.message))}>Сухой прогон</Button>
                <Button variant="secondary" onClick={() => api<Run[]>(`/api/automations/${rule.id}/runs`).then(setRuns).catch((reason) => setError(reason.message))}>Журнал</Button>
                <Button variant="danger" onClick={() => api(`/api/automations/${rule.id}/stop`, { method: "POST" }).then(() => rules.reload())}>Остановить</Button>
                <button className="text-sm text-red-700" onClick={() => api(`/api/automations/${rule.id}`, { method: "DELETE" }).then(() => rules.reload())}>Удалить</button>
              </div>
            </Card>
          ))}
          {runs.length ? <Card><h2 className="mb-2 font-semibold">Последние запуски</h2>{runs.map((run) => <p key={run.id} className="text-sm">{formatDate(run.startedAt)} · {run.status}{run.dryRun ? " · без изменений" : ""} {run.error || ""}</p>)}</Card> : null}
        </div>
      </div>
    </div>
  );
}
