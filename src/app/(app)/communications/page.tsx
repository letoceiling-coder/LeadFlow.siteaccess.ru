"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { formatDate } from "@/lib/domain/labels";

type Conversation = { id: string; channel: string; organization: { name: string }; messages: { body: string; status: string; createdAt: string }[] };
type Template = { id: string; name: string; channel: string; body: string };
type Suppression = { id: string; value: string; channel: string; reason: string };

const CHANNELS = ["email", "telegram", "whatsapp", "sms", "test"] as const;

export default function CommunicationsPage() {
  const conversations = useResource<Conversation[]>("/api/communications/conversations");
  const templates = useResource<Template[]>("/api/communications/templates");
  const suppression = useResource<Suppression[]>("/api/communications/suppression");
  const [open, setOpen] = useState<string | null>(null);
  const thread = useResource<{ messages: { id: string; direction: string; body: string; status: string; createdAt: string }[] }>(open ? `/api/communications/conversations/${open}` : null);
  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);

  return (
    <div>
      <PageTitle title="Коммуникации" text="Черновик не уходит, пока его не одобрят и не укажут основание. Публичный телефон с карты основанием не является. Канал «тест» остаётся внутри платформы." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Новый черновик</h2>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api<{ message: { id: string } }>("/api/communications/messages", { method: "POST", body: JSON.stringify({ organizationId: form.get("organizationId"), channel: form.get("channel"), templateId: form.get("templateId") || undefined, body: form.get("body") || undefined }) }).then((created) => { setDraftId(created.message.id); conversations.reload(); }).catch((reason) => setError(reason.message)); }}>
            <Field label="ID организации"><input name="organizationId" required className={controlClass} /></Field>
            <Field label="Канал"><select name="channel" className={controlClass}>{CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select></Field>
            <Field label="Шаблон"><select name="templateId" className={controlClass}><option value="">Без шаблона</option>{(templates.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Текст" hint="Переменные: {{name}}, {{city}}, {{category}}, {{site}}. Отсутствующая переменная останавливает отправку."><textarea name="body" rows={4} className={controlClass} /></Field>
            <Button type="submit">Сохранить черновик</Button>
          </form>
          {draftId ? (
            <form className="mt-4 space-y-2 border-t border-line pt-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api(`/api/communications/messages/${draftId}/approve`, { method: "POST", body: JSON.stringify({ lawfulBasis: form.get("lawfulBasis"), basisNote: form.get("basisNote") || undefined }) }).then(() => api(`/api/communications/messages/${draftId}/send`, { method: "POST" })).then(() => { setDraftId(null); conversations.reload(); }).catch((reason) => setError(reason.message)); }}>
              <Field label="Основание"><select name="lawfulBasis" className={controlClass}><option value="consent">Согласие</option><option value="contract">Договор</option><option value="other_lawful">Иное законное основание</option></select></Field>
              <Field label="Пояснение"><textarea name="basisNote" className={controlClass} rows={2} /></Field>
              <Button type="submit">Одобрить и отправить</Button>
            </form>
          ) : null}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Диалоги</h2>
          {conversations.loading ? <Loading /> : conversations.error ? <State title="Диалоги недоступны" text={conversations.error} /> : (conversations.data ?? []).length === 0 ? <p className="text-sm text-slate-500">Диалогов нет</p> : (conversations.data ?? []).map((item) => (
            <button key={item.id} className="block w-full border-t border-line py-2 text-left text-sm" onClick={() => setOpen(item.id)}>
              <span className="font-medium">{item.organization?.name || "Без организации"}</span> · {item.channel}
              <span className="mt-1 block text-xs text-slate-500">{item.messages[0]?.body || "пусто"} · {item.messages[0]?.status}</span>
            </button>
          ))}
          {thread.data ? <div className="mt-3 space-y-2">{thread.data.messages.map((message) => <p key={message.id} className="rounded-lg bg-slate-50 p-2 text-sm"><Badge>{message.direction}</Badge> {message.body}<span className="mt-1 block text-xs text-slate-500">{message.status} · {formatDate(message.createdAt)}</span></p>)}</div> : null}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Шаблоны</h2>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api("/api/communications/templates", { method: "POST", body: JSON.stringify({ name: form.get("name"), channel: form.get("channel"), body: form.get("body") }) }).then(() => templates.reload()).catch((reason) => setError(reason.message)); }}>
            <input name="name" required className={controlClass} placeholder="Название" />
            <select name="channel" className={controlClass}>{CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select>
            <textarea name="body" required rows={3} className={controlClass} />
            <Button type="submit" variant="secondary">Сохранить шаблон</Button>
          </form>
          {(templates.data ?? []).map((item) => <div key={item.id} className="mt-2 flex justify-between text-sm"><span>{item.name} · {item.channel}</span><button onClick={() => api(`/api/communications/templates/${item.id}`, { method: "DELETE" }).then(() => templates.reload())}>Удалить</button></div>)}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Отказы и согласие</h2>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api("/api/communications/suppression", { method: "POST", body: JSON.stringify({ value: form.get("value"), reason: form.get("reason"), channel: form.get("channel") || "*" }) }).then(() => suppression.reload()).catch((reason) => setError(reason.message)); }}>
            <input name="value" required className={controlClass} placeholder="email или телефон" />
            <input name="reason" required className={controlClass} placeholder="причина" />
            <select name="channel" className={controlClass}><option value="*">все каналы</option>{CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select>
            <Button type="submit" variant="secondary">Добавить в отказ</Button>
          </form>
          {(suppression.data ?? []).map((item) => <div key={item.id} className="mt-2 flex justify-between text-sm"><span>{item.value} · {item.channel} · {item.reason}</span><button onClick={() => api(`/api/communications/suppression/${item.id}`, { method: "DELETE" }).then(() => suppression.reload())}>Снять</button></div>)}
          <form className="mt-4 space-y-2 border-t border-line pt-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api("/api/communications/consent", { method: "POST", body: JSON.stringify({ organizationId: form.get("organizationId"), lawfulBasis: form.get("lawfulBasis"), basisNote: form.get("basisNote") }) }).then(() => setError("")).catch((reason) => setError(reason.message)); }}>
            <Field label="Зафиксировать основание"><input name="organizationId" required className={controlClass} placeholder="ID организации" /></Field>
            <select name="lawfulBasis" className={controlClass}><option value="consent">Согласие</option><option value="contract">Договор</option><option value="other_lawful">Иное</option></select>
            <textarea name="basisNote" className={controlClass} rows={2} placeholder="Кто, когда и на что согласился" />
            <Button type="submit" variant="secondary">Записать</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
