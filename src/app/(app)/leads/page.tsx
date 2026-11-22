"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { PIPELINE, formatDate } from "@/lib/domain/labels";

type Lead = {
  id: string;
  value: string | number | null;
  nextActionAt: string | null;
  lostReason: string | null;
  organization: { id: string; name: string; city: string | null; leadScore: number | null };
  stage: { key: string; name: string };
};

export default function LeadsPage() {
  const leads = useResource<Lead[]>("/api/crm/leads");
  const members = useResource<{ members: { id: string; name: string }[] }>("/api/organizations/filters");
  const [error, setError] = useState("");

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    try {
      await api(`/api/crm/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await leads.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Лид не обновлён");
    }
  }

  return (
    <div>
      <PageTitle title="Лиды" text="Список организаций, которые уже стоят в воронке. Перенос на стадию «Не связываться» добавляет организацию в ограничения коммуникаций." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {leads.loading ? <Loading /> : leads.error ? <State title="Лиды недоступны" text={leads.error} /> : (leads.data ?? []).length === 0 ? <State title="Лидов пока нет" text="Они появляются вместе с организациями из поиска. Откройте базу и назначьте стадию." action={<Link className="text-teal-800" href="/organizations">Открыть базу</Link>} /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {["Организация", "Город", "Оценка", "Стадия", "Сумма", "Следующий шаг", "Причина отказа"].map((title) => <th key={title} className="px-3 py-2">{title}</th>)}
              </tr>
            </thead>
            <tbody>
              {(leads.data ?? []).map((lead) => (
                <tr key={lead.id} className="border-t border-line">
                  <td className="px-3 py-2"><Link className="text-teal-800" href={`/organizations/${lead.organization.id}`}>{lead.organization.name}</Link></td>
                  <td className="px-3 py-2">{lead.organization.city || "—"}</td>
                  <td className="px-3 py-2">{lead.organization.leadScore ?? "—"}</td>
                  <td className="px-3 py-2">
                    <select className={controlClass} value={lead.stage.key} onChange={(event) => patch(lead.id, { stageKey: event.target.value })}>
                      {PIPELINE.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2"><input className={controlClass} defaultValue={lead.value ?? ""} onBlur={(event) => patch(lead.id, { value: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                  <td className="px-3 py-2"><input type="datetime-local" className={controlClass} defaultValue={lead.nextActionAt ? lead.nextActionAt.slice(0, 16) : ""} onBlur={(event) => patch(lead.id, { nextActionAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></td>
                  <td className="px-3 py-2 text-xs text-slate-500">{lead.lostReason || formatDate(lead.nextActionAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Card className="mt-4">
        <h2 className="mb-2 font-semibold">Назначение</h2>
        <p className="text-sm text-slate-600">Ответственного можно сменить на карточке организации. В списке сотрудников: {(members.data?.members ?? []).map((member) => member.name).join(", ") || "загрузка или нет прав на фильтры"}.</p>
        <Field label="Причина отказа для выбранного лида">
          <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const id = String(form.get("id")); const lostReason = String(form.get("lostReason")); void patch(id, { lostReason, stageKey: "lost" }); }}>
            <select name="id" className={controlClass}>{(leads.data ?? []).map((lead) => <option key={lead.id} value={lead.id}>{lead.organization.name}</option>)}</select>
            <input name="lostReason" required className={controlClass} placeholder="Почему закрыто" />
            <Button type="submit" variant="secondary">Закрыть без сделки</Button>
          </form>
        </Field>
      </Card>
    </div>
  );
}
