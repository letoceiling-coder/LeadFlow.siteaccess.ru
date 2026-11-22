"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { AI_MODELS, taskModelId } from "@/lib/domain/models";
import type { TenantSettings } from "@/lib/domain/settings";

const WEIGHTS: { key: keyof TenantSettings["scoreWeights"]; label: string }[] = [
  { key: "noWebsite", label: "Нет сайта" },
  { key: "hasPhone", label: "Есть телефон" },
  { key: "hasEmail", label: "Есть email" },
  { key: "goodRating", label: "Рейтинг от 4" },
  { key: "manyReviews", label: "От 20 отзывов" },
  { key: "completeCard", label: "Полная карточка" },
  { key: "hasPhotos", label: "Есть фото" },
  { key: "clearServices", label: "Понятные услуги" },
  { key: "commercialPotential", label: "Коммерческий потенциал" },
];

export default function SettingsPage() {
  const settings = useResource<TenantSettings>("/api/settings");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (settings.loading) return <Loading />;
  if (settings.error || !settings.data) return <State title="Настройки недоступны" text={settings.error || "Нет ответа"} />;
  const current = settings.data;
  return (
    <div>
      <PageTitle title="Настройки" text="Лимиты останавливают дорогие вызовы. Сумма весов оценки не может быть больше 100. Коммерческие баллы не начисляются, пока потенциал явно не оценён." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-teal-800">{notice}</p> : null}
      <form className="grid gap-4 lg:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const scoreWeights = Object.fromEntries(WEIGHTS.map((item) => [item.key, Number(form.get(item.key) || 0)]));
        const next = {
          ...current,
          automationMode: form.get("automationMode"),
          budgets: { perOperationUsd: Number(form.get("perOperationUsd")), dailyUsd: Number(form.get("dailyUsd")), monthlyUsd: Number(form.get("monthlyUsd")) },
          scoreWeights,
          ai: { ...current.ai, qualifyModel: String(form.get("qualifyModel") || ""), briefModel: String(form.get("briefModel") || ""), messageModel: String(form.get("messageModel") || ""), agentModel: String(form.get("agentModel") || current.ai.agentModel || ""), maxCostPerAnalysisUsd: Number(form.get("maxCostPerAnalysisUsd")), maxCostPerBriefUsd: Number(form.get("maxCostPerBriefUsd")) },
          communication: { maxPerOrgPerDays: Number(form.get("maxPerOrgPerDays")), windowDays: Number(form.get("windowDays")) },
          reply: {
            phone: String(form.get("replyPhone") || ""),
            telegram: String(form.get("replyTelegram") || ""),
            max: String(form.get("replyMax") || ""),
            email: String(form.get("replyEmail") || ""),
          },
          retentionDays: Number(form.get("retentionDays")),
        };
        api("/api/settings", { method: "PATCH", body: JSON.stringify(next) }).then(() => { setNotice("Настройки сохранены"); setError(""); return settings.reload(); }).catch((reason) => setError(reason.message));
      }}>
        <Card>
          <Field label="Режим автоматизации">
            <select name="automationMode" defaultValue={current.automationMode} className={controlClass}>
              <option value="manual">Ручной: ничего само не запускается</option>
              <option value="semi">Полуавтомат: подготовка ждёт подтверждения коммерческих действий</option>
              <option value="auto">Авто: подготовка идёт сама, отправка и публикация всё равно подтверждаются</option>
            </select>
          </Field>
          <div className="mt-3 grid gap-3">
            <Field label="Лимит одной операции, USD"><input name="perOperationUsd" type="number" step="0.01" defaultValue={current.budgets.perOperationUsd} className={controlClass} /></Field>
            <Field label="Дневной лимит, USD"><input name="dailyUsd" type="number" step="0.01" defaultValue={current.budgets.dailyUsd} className={controlClass} /></Field>
            <Field label="Месячный лимит, USD"><input name="monthlyUsd" type="number" step="0.01" defaultValue={current.budgets.monthlyUsd} className={controlClass} /></Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Модели</h2>
          <p className="mb-3 text-xs text-slate-500">Агент — DeepSeek, анализ — GLM, тексты — Gemma. Claude и GPT в списке нет. Сохранённое имя вне списка заменяется моделью задачи.</p>
          <Field label="Агент">
            <select name="agentModel" defaultValue={taskModelId("agent", current.ai.agentModel)} className={controlClass}>
              {AI_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Анализ">
            <select name="qualifyModel" defaultValue={taskModelId("analysis", current.ai.qualifyModel)} className={controlClass}>
              {AI_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <div className="mt-3 space-y-3">
            <Field label="Бриф сайта">
              <select name="briefModel" defaultValue={taskModelId("brief", current.ai.briefModel)} className={controlClass}>
                {AI_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Черновик сообщения">
              <select name="messageModel" defaultValue={taskModelId("message", current.ai.messageModel)} className={controlClass}>
                {AI_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Потолок анализа, USD"><input name="maxCostPerAnalysisUsd" type="number" step="0.01" defaultValue={current.ai.maxCostPerAnalysisUsd} className={controlClass} /></Field>
            <Field label="Потолок брифа, USD"><input name="maxCostPerBriefUsd" type="number" step="0.01" defaultValue={current.ai.maxCostPerBriefUsd} className={controlClass} /></Field>
          </div>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Веса оценки</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEIGHTS.map((item) => <Field key={item.key} label={item.label}><input name={item.key} type="number" min={0} max={100} defaultValue={current.scoreWeights[item.key]} className={controlClass} /></Field>)}
          </div>
        </Card>
        <Card>
          <Field label="Сообщений на организацию"><input name="maxPerOrgPerDays" type="number" min={1} defaultValue={current.communication.maxPerOrgPerDays} className={controlClass} /></Field>
          <div className="mt-3 space-y-3">
            <Field label="Окно, дней"><input name="windowDays" type="number" min={1} defaultValue={current.communication.windowDays} className={controlClass} /></Field>
            <Field label="Хранить данные, дней"><input name="retentionDays" type="number" min={30} defaultValue={current.retentionDays} className={controlClass} /></Field>
          </div>
          <h2 className="mb-2 mt-5 font-semibold">Обратная связь в предложении</h2>
          <p className="mb-3 text-xs text-slate-500">Эти контакты попадают в коммерческое предложение рядом со ссылкой на сайт. Пустая почта означает адрес подключённой почты.</p>
          <div className="space-y-3">
            <Field label="Телефон"><input name="replyPhone" defaultValue={current.reply.phone} className={controlClass} placeholder="8XXXXXXXXXX" /></Field>
            <Field label="Telegram"><input name="replyTelegram" defaultValue={current.reply.telegram} className={controlClass} placeholder="@name" /></Field>
            <Field label="MAX"><input name="replyMax" defaultValue={current.reply.max} className={controlClass} placeholder="https://max.ru/..." /></Field>
            <Field label="Почта, если не адрес отправителя"><input name="replyEmail" defaultValue={current.reply.email} className={controlClass} placeholder="пусто — почта по умолчанию" /></Field>
          </div>
          <Button className="mt-4" type="submit">Сохранить</Button>
        </Card>
      </form>
      <Card className="mt-4">
        <h2 className="font-semibold">Демонстрационные примеры</h2>
        <p className="mt-1 text-sm text-slate-600">Две учебные карточки с пометкой «демо». Они не входят в показатели, не уходят в Studio и не получают живой AI-отчёт. Сейчас режим {current.demoMode ? "включён" : "выключен"}.</p>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => api("/api/demo", { method: "POST" }).then(() => settings.reload()).catch((reason) => setError(reason.message))}>Включить примеры</Button>
          <Button variant="danger" onClick={() => api("/api/demo", { method: "DELETE" }).then(() => settings.reload()).catch((reason) => setError(reason.message))}>Удалить примеры</Button>
        </div>
      </Card>
    </div>
  );
}
