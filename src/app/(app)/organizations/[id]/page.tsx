"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { PreviewLink, canPreview } from "@/components/preview-link";
import { CreateOffer } from "@/components/create-offer";
import { PIPELINE, SITE_STATUS_LABEL, SITE_TYPES, WEBSITE_STATUS_LABEL, formatDate, money } from "@/lib/domain/labels";

type Detail = {
  organization: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    category: string | null;
    address: string | null;
    website: string | null;
    websiteStatus: string;
    rating: number | null;
    reviewCount: number | null;
    source: string;
    sourceUrl: string | null;
    isDemo: boolean;
    leadScore: number | null;
    assigneeId: string | null;
    contacts: { id: string; type: string; value: string; verified: boolean }[];
    notes: { id: string; body: string; createdAt: string }[];
    analyses: { id: string; status: string; report: { summary?: string } | null; createdAt: string; source: string; costUsd: number | null; costUnknown: boolean }[];
    scores: { id: string; score: number; factors: { reason: string; points: number; kind: string }[]; createdAt: string }[];
    sites: { id: string; name: string; status: string; visibility: string }[];
    lead: { id: string; stage: { key: string; name: string } } | null;
    activities: { id: string; message: string; createdAt: string }[];
  };
  costs: { id: string; operation: string; amountUsd: number | null; unknown: boolean; createdAt: string }[];
};

export default function OrganizationPage() {
  const params = useParams<{ id: string }>();
  const resource = useResource<Detail>(`/api/organizations/${params.id}`);
  const members = useResource<{ members: { id: string; name: string }[] }>("/api/organizations/filters");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(action: () => Promise<unknown>, ok: string) {
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(ok);
      await resource.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Действие не выполнено");
    }
  }

  if (resource.loading) return <Loading />;
  if (resource.error || !resource.data) return <State title="Карточка недоступна" text={resource.error || "Нет ответа"} />;
  const org = resource.data.organization;
  return (
    <div>
      <PageTitle title={org.name} text={[org.category, org.city, org.address].filter(Boolean).join(" · ") || "Адрес и категория не указаны"} action={<Link className="text-sm text-teal-800" href="/organizations">К списку</Link>} />
      {org.isDemo ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">Это демонстрационный пример. Он не входит в показатели и не отправляется во внешние сервисы AI и Studio.</div> : null}
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-teal-800">{notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap gap-2">
              <Badge>{WEBSITE_STATUS_LABEL[org.websiteStatus] || org.websiteStatus}</Badge>
              <Badge tone="teal">Оценка {org.leadScore ?? "не считалась"}</Badge>
              <Badge tone="slate">{org.lead?.stage.name || "Без стадии"}</Badge>
              <Badge>{org.source}</Badge>
            </div>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Сайт</dt><dd>{org.website || "не указан"}</dd></div>
              <div><dt className="text-slate-500">Источник</dt><dd>{org.sourceUrl ? <a className="text-teal-800" href={org.sourceUrl} target="_blank" rel="noreferrer">Карточка</a> : "нет ссылки"}</dd></div>
              <div><dt className="text-slate-500">Рейтинг</dt><dd>{org.rating ?? "неизвестен"} · отзывов {org.reviewCount ?? "неизвестно"}</dd></div>
              <div><dt className="text-slate-500">Регион</dt><dd>{org.region || "не указан"}</dd></div>
            </dl>
            <h2 className="mt-4 font-semibold">Контакты</h2>
            {org.contacts.length === 0 ? <p className="text-sm text-slate-500">Контактов нет. Система их не выдумывает.</p> : org.contacts.map((contact) => <p key={contact.id} className="text-sm">{contact.type}: {contact.value} {contact.verified ? "· проверен" : "· не проверен"}</p>)}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => run(() => api(`/api/organizations/${org.id}/check-website`, { method: "POST" }), "Проверка сайта выполнена")}>Проверить сайт</Button>
              <Button variant="secondary" onClick={() => run(() => api("/api/organizations/bulk", { method: "POST", body: JSON.stringify({ ids: [org.id], action: "score" }) }), "Оценка пересчитана по правилам")}>Пересчитать оценку</Button>
            </div>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Заметки</h2>
            <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); const body = String(new FormData(event.currentTarget).get("body") || ""); void run(() => api(`/api/organizations/${org.id}/notes`, { method: "POST", body: JSON.stringify({ body }) }), "Заметка сохранена"); event.currentTarget.reset(); }}>
              <input name="body" required className={controlClass} placeholder="Внутренняя заметка" />
              <Button type="submit">Добавить</Button>
            </form>
            {org.notes.length === 0 ? <p className="text-sm text-slate-500">Заметок нет</p> : org.notes.map((note) => <p key={note.id} className="border-t border-line py-2 text-sm">{note.body}<span className="mt-1 block text-xs text-slate-500">{formatDate(note.createdAt)}</span></p>)}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">AI-отчёты</h2>
            {org.analyses.length === 0 ? <p className="text-sm text-slate-500">Анализа ещё не было</p> : org.analyses.map((report) => <div key={report.id} className="border-t border-line py-2 text-sm"><div className="flex justify-between"><span>{report.status} · {report.source}</span><span>{money(report.costUsd, report.costUnknown)}</span></div><p className="mt-1">{report.report?.summary || "Текст отчёта появится после успешного ответа модели"}</p><Link className="text-teal-800" href={`/analysis?id=${report.id}`}>Открыть</Link></div>)}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">История</h2>
            {org.activities.length === 0 ? <p className="text-sm text-slate-500">Действий ещё не было</p> : org.activities.map((item) => <p key={item.id} className="border-t border-line py-2 text-sm">{item.message}<span className="mt-1 block text-xs text-slate-500">{formatDate(item.createdAt)}</span></p>)}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-semibold">Работа с карточкой</h2>
            <Field label="Ответственный">
              <select className={controlClass} value={org.assigneeId || ""} onChange={(event) => run(() => api(`/api/organizations/${org.id}`, { method: "PATCH", body: JSON.stringify({ assigneeId: event.target.value || null }) }), "Ответственный обновлён")}>
                <option value="">Не назначен</option>
                {(members.data?.members ?? []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </Field>
            <div className="mt-3">
              <Field label="Стадия воронки">
                <select className={controlClass} value={org.lead?.stage.key || ""} onChange={(event) => run(() => api(`/api/organizations/${org.id}`, { method: "PATCH", body: JSON.stringify({ stageKey: event.target.value }) }), "Стадия обновлена")}>
                  {PIPELINE.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
                </select>
              </Field>
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Демо-сайт</h2>
            {org.sites.length === 0 ? <p className="text-sm text-slate-500">Демо ещё не создавалось.</p> : org.sites.map((site) => (
              <div key={site.id} className="border-t border-line py-3 text-sm">
                <Link href={`/sites/${site.id}`} className="font-medium text-teal-800">{site.name}</Link>
                <p className="text-slate-500">{SITE_STATUS_LABEL[site.status] || site.status} · {site.visibility === "public" ? "опубликован" : "не опубликован"}</p>
                {canPreview(site.status) ? <PreviewLink siteId={site.id} /> : <p className="mt-1 text-slate-500">Ссылка появится, когда демо будет собрано.</p>}
              </div>
            ))}
            <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => api("/api/sites", { method: "POST", body: JSON.stringify({ organizationId: org.id, siteType: form.get("siteType"), language: "ru", pages: String(form.get("pages") || "").split(",").map((item) => item.trim()).filter(Boolean), wishes: form.get("wishes") || undefined, style: form.get("style") || undefined, confirm: true }) }), "Создание сайта поставлено в очередь"); }}>
              <select name="siteType" className={controlClass}>{SITE_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
              <input name="style" className={controlClass} placeholder="Стиль, если известен" />
              <input name="pages" className={controlClass} placeholder="Страницы через запятую" />
              <textarea name="wishes" className={controlClass} rows={3} placeholder="Пожелания. Не просите выдумывать цены и лицензии." />
              <Button type="submit" disabled={org.isDemo}>Создать демо</Button>
              {org.isDemo ? <p className="text-xs text-slate-500">Для примера Studio не вызывается.</p> : null}
            </form>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Оценка</h2>
            <p className="mb-2 text-xs text-slate-500">Баллы не обещают покупку. Неизвестные факторы не получают коммерческих очков.</p>
            {(org.scores[0]?.factors ?? []).map((factor, index) => <p key={index} className="text-sm">{factor.reason}: {factor.points} · {factor.kind}</p>)}
            {!org.scores.length ? <p className="text-sm text-slate-500">Оценка ещё не считалась</p> : null}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Расходы</h2>
            {resource.data.costs.length === 0 ? <p className="text-sm text-slate-500">Расходов нет</p> : resource.data.costs.map((cost) => <p key={cost.id} className="text-sm">{cost.operation}: {money(cost.amountUsd, cost.unknown)}</p>)}
            <Button className="mt-3" variant="danger" onClick={() => { if (!window.confirm("Удалить организацию и связанные данные этого пространства?")) return; void run(() => api(`/api/organizations/${org.id}`, { method: "DELETE", body: JSON.stringify({ confirm: true }) }).then(() => { window.location.href = "/organizations"; }), "Удалено"); }}>Удалить карточку</Button>
          </Card>
        </div>
      </div>
      {org.isDemo ? null : <CreateOffer organizationId={org.id} />}
    </div>
  );
}
