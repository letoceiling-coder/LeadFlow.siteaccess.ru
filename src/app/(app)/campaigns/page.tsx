"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";

type Campaign = { id: string; name: string; channel: string; status: string; audienceCount: number; eligibleCount: number; excludedCount: number; legalBasisConfirmed: boolean };
type Preview = { audienceCount: number; eligibleCount: number; excludedCount: number; recipients: { name: string; contact: string | null; eligible: boolean; reason: string | null }[] };

export default function CampaignsPage() {
  const campaigns = useResource<Campaign[]>("/api/campaigns");
  const templates = useResource<{ id: string; name: string }[]>("/api/communications/templates");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useResource<Campaign & { recipients: { id: string; status: string; reason: string | null; contactValue: string | null }[] }>(open ? `/api/campaigns/${open}` : null);
  const [error, setError] = useState("");

  function filtersFrom(form: FormData) {
    return {
      city: String(form.get("city") || ""),
      category: String(form.get("category") || ""),
      noWebsite: form.get("noWebsite") === "on",
      minScore: form.get("minScore") ? Number(form.get("minScore")) : undefined,
    };
  }

  return (
    <div>
      <PageTitle title="Кампании" text="Старт возможен только после подтверждения правового основания. Получатели без контакта, из списка отказов и со стадией «Не связываться» исключаются. Частота по умолчанию — одно сообщение за 14 дней." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api("/api/campaigns", { method: "POST", body: JSON.stringify({ name: form.get("name"), channel: form.get("channel"), templateId: form.get("templateId") || undefined, filters: filtersFrom(form) }) }).then(() => campaigns.reload()).catch((reason) => setError(reason.message)); }}>
            <Field label="Название"><input name="name" required className={controlClass} /></Field>
            <Field label="Канал"><select name="channel" className={controlClass}><option>test</option><option>email</option><option>telegram</option><option>whatsapp</option><option>sms</option></select></Field>
            <Field label="Шаблон"><select name="templateId" className={controlClass}><option value="">Без шаблона</option>{(templates.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Город"><input name="city" className={controlClass} /></Field>
            <Field label="Категория"><input name="category" className={controlClass} /></Field>
            <Field label="Оценка от"><input name="minScore" type="number" className={controlClass} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="noWebsite" /> Только без сайта</label>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={(event) => { const form = new FormData(event.currentTarget.form!); const channel = String(form.get("channel") || "test"); api<Preview>("/api/campaigns/preview", { method: "POST", body: JSON.stringify({ filters: filtersFrom(form), channel }) }).then(setPreview).catch((reason) => setError(reason.message)); }}>Показать аудиторию</Button>
              <Button type="submit">Создать черновик</Button>
            </div>
          </form>
          {preview ? <p className="mt-3 text-sm">В выборке {preview.audienceCount}, можно написать {preview.eligibleCount}, исключено {preview.excludedCount}.</p> : null}
        </Card>
        <div className="space-y-3">
          {campaigns.loading ? <Loading /> : campaigns.error ? <State title="Кампании недоступны" text={campaigns.error} /> : (campaigns.data ?? []).length === 0 ? <State title="Кампаний нет" text="Сначала посмотрите аудиторию. Создание само по себе ничего не отправляет." /> : (campaigns.data ?? []).map((item) => (
            <Card key={item.id}>
              <div className="flex justify-between"><button className="font-medium" onClick={() => setOpen(item.id)}>{item.name}</button><Badge>{item.status}</Badge></div>
              <p className="mt-1 text-sm text-slate-600">{item.channel} · аудитория {item.audienceCount} · доступно {item.eligibleCount} · исключено {item.excludedCount} · основание {item.legalBasisConfirmed ? "подтверждено" : "не подтверждено"}</p>
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); api(`/api/campaigns/${item.id}/approve`, { method: "POST", body: JSON.stringify({ lawfulBasis: form.get("lawfulBasis"), basisNote: form.get("basisNote") }) }).then(() => campaigns.reload()).catch((reason) => setError(reason.message)); }}>
                <select name="lawfulBasis" className={controlClass + " max-w-[180px]"}><option value="consent">Согласие</option><option value="contract">Договор</option><option value="other_lawful">Иное основание</option></select>
                <input name="basisNote" className={controlClass + " max-w-xs"} placeholder="Пояснение" />
                <Button type="submit" variant="secondary">Подтвердить основание</Button>
                <Button type="button" onClick={() => api(`/api/campaigns/${item.id}/start`, { method: "POST" }).then(() => campaigns.reload()).catch((reason) => setError(reason.message))}>Запустить</Button>
                <Button type="button" variant="secondary" onClick={() => api(`/api/campaigns/${item.id}/pause`, { method: "POST" }).then(() => campaigns.reload()).catch((reason) => setError(reason.message))}>Пауза</Button>
                <Button type="button" variant="danger" onClick={() => api(`/api/campaigns/${item.id}/cancel`, { method: "POST" }).then(() => campaigns.reload()).catch((reason) => setError(reason.message))}>Отменить</Button>
              </form>
            </Card>
          ))}
          {detail.data ? <Card><h2 className="mb-2 font-semibold">Получатели</h2>{detail.data.recipients.map((item) => <p key={item.id} className="border-t border-line py-1 text-sm">{item.contactValue || "без контакта"} · {item.status} · {item.reason || ""}</p>)}</Card> : null}
          {preview ? <Card><h2 className="mb-2 font-semibold">Предпросмотр</h2>{preview.recipients.slice(0, 30).map((item) => <p key={item.name + (item.contact || "")} className="text-sm">{item.name}: {item.eligible ? "можно" : item.reason}</p>)}{preview.recipients.length > 30 ? <p className="text-xs text-slate-500">Показаны первые 30</p> : null}</Card> : null}
        </div>
      </div>
    </div>
  );
}
