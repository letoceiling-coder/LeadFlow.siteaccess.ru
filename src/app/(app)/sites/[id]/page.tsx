"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { PreviewLink, canPreview } from "@/components/preview-link";
import { CreateOffer } from "@/components/create-offer";
import { SITE_STATUS_LABEL, formatDate } from "@/lib/domain/labels";

type Run = { id: string; status: string; replyText: string | null; replyMeta: { kind?: string; questions?: string[]; actions?: string[] } | null; error: string | null; createdAt: string };
type Project = {
  id: string;
  name: string;
  status: string;
  visibility: string;
  brief: string | null;
  error: string | null;
  qaScore: number | null;
  qaSummary: string | null;
  criticalCount: number;
  previewUrl: string | null;
  studioProjectId: string | null;
  organization: { id: string; name: string; isDemo: boolean };
  runs: Run[];
  audits: { id: string; status: string; score: number | null; criticalCount: number; error: string | null; createdAt: string }[];
  versions: { id: string; sha: string | null; message: string | null; createdAt: string }[];
};

export default function SitePage() {
  const params = useParams<{ id: string }>();
  const resource = useResource<Project>(`/api/sites/${params.id}`);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const project = resource.data;
  const active = project?.status === "queued" || project?.status === "building" || project?.runs[0]?.status === "running";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void resource.reload(), 4000);
    return () => clearInterval(timer);
  }, [active, resource.reload]);

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
  if (resource.error || !project) return <State title="Проект недоступен" text={resource.error || "Нет данных"} />;
  const meta = project.runs[0]?.replyMeta;
  return (
    <div>
      <PageTitle title={project.name} text={`${project.organization.name} · ${SITE_STATUS_LABEL[project.status] || project.status} · ${project.visibility === "public" ? "опубликован" : "не опубликован"}`} action={<Link className="text-sm text-teal-800" href={`/organizations/${project.organization.id}`}>Карточка организации</Link>} />
      {project.organization.isDemo ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">Это пример. Внешний Studio не вызывается.</div> : null}
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-teal-800">{notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap gap-2"><Badge>{project.status}</Badge>{project.criticalCount ? <Badge tone="red">Критических замечаний: {project.criticalCount}</Badge> : <Badge tone="green">Критичных QA нет</Badge>}</div>
            {project.error ? <p className="mt-3 text-sm text-red-700">{project.error}</p> : null}
            {project.runs[0]?.replyText ? <p className="mt-3 whitespace-pre-wrap text-sm">{project.runs[0].replyText}</p> : <p className="mt-3 text-sm text-slate-500">Ответа агента ещё нет. Если обработчик выключен, задача будет ждать.</p>}
            {meta?.questions?.length ? <ul className="mt-3 list-disc pl-5 text-sm">{meta.questions.map((question) => <li key={question}>{question}</li>)}</ul> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {meta?.actions?.map((action) => <Button key={action} variant="secondary" onClick={() => run(() => api(`/api/sites/${project.id}/reply`, { method: "POST", body: JSON.stringify({ text: action }) }), "Ответ отправлен агенту")}>{action}</Button>)}
            </div>
            {project.status === "waiting_user" ? (
              <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); const text = String(new FormData(event.currentTarget).get("text") || ""); void run(() => api(`/api/sites/${project.id}/reply`, { method: "POST", body: JSON.stringify({ text }) }), "Ответ отправлен"); }}>
                <input name="text" required className={controlClass} placeholder="Ответ агенту" />
                <Button type="submit">Ответить</Button>
              </form>
            ) : null}
          </Card>
          <Card>
            <h2 className="font-semibold">Ссылка на просмотр</h2>
            {canPreview(project.status) ? <PreviewLink siteId={project.id} /> : <p className="mt-2 text-sm text-slate-500">Ссылка появится, когда демо будет собрано. Сейчас статус: {SITE_STATUS_LABEL[project.status] || project.status}.</p>}
            {project.studioProjectId ? <img alt="Миниатюра проекта" className="mt-4 max-h-64 rounded-xl border border-line" src={`/api/sites/${project.id}/thumbnail`} /> : null}
          </Card>
          <Card>
            <h2 className="font-semibold">Бриф, который ушёл в Studio</h2>
            <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{project.brief || "Бриф появится после постановки задачи"}</pre>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 font-semibold">Проверка</h2>
            <p className="text-sm">QA: {project.qaScore ?? "не запускалась"}. {project.qaSummary || ""}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => run(() => api(`/api/sites/${project.id}/qa`, { method: "POST" }), "QA запрошена")}>QA Studio</Button>
              <Button variant="secondary" onClick={() => run(() => api(`/api/sites/${project.id}/audit`, { method: "POST" }), "Аудит поставлен в очередь")}>Аудит Parser</Button>
              <Button variant="secondary" onClick={() => run(() => api(`/api/sites/${project.id}/fix`, { method: "POST" }), "Исправление отправлено агенту")}>Исправить замечания</Button>
              <Button onClick={() => run(() => api(`/api/sites/${project.id}/approve`, { method: "POST", body: JSON.stringify({ comment: "Проверено в LeadFlow" }) }), "Проект одобрен")}>Одобрить</Button>
            </div>
            {project.audits.map((audit) => <p key={audit.id} className="mt-2 text-sm">{formatDate(audit.createdAt)} · {audit.status} · оценка {audit.score ?? "—"} · критичных {audit.criticalCount}. {audit.error || ""}</p>)}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Публикация</h2>
            <p className="mb-3 text-sm text-slate-600">По умолчанию сайт не публикуется. Публикация требует отдельного подтверждения, права и отсутствия критичных замечаний.</p>
            <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => api(`/api/sites/${project.id}/publish`, { method: "POST", body: JSON.stringify({ confirm: true, acknowledgeDemo: true, visibility: form.get("visibility") }) }), "Запрос на публикацию отправлен"); }}>
              <select name="visibility" className={controlClass}><option value="private">Оставить приватным</option><option value="public">Сделать публичным</option></select>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" required name="ack" /> Понимаю, что это демо и публикация станет доступна по выбранной видимости</label>
              <Button type="submit">Опубликовать</Button>
            </form>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Версии</h2>
            <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); const message = String(new FormData(event.currentTarget).get("message") || ""); void run(() => api(`/api/sites/${project.id}/checkpoint`, { method: "POST", body: JSON.stringify({ message }) }), "Версия сохранена"); }}>
              <input name="message" className={controlClass} placeholder="Комментарий к версии" />
              <Button type="submit" variant="secondary">Сохранить</Button>
            </form>
            {project.versions.length === 0 ? <p className="text-sm text-slate-500">Локальных версий нет</p> : project.versions.map((version) => (
              <div key={version.id} className="flex items-center justify-between border-t border-line py-2 text-sm">
                <span>{version.message || "без комментария"} · {version.sha || "sha появится из Studio"}</span>
                {version.sha ? <button className="text-teal-800" onClick={() => { if (!window.confirm("Откатить проект к этой версии?")) return; void run(() => api(`/api/sites/${project.id}/restore`, { method: "POST", body: JSON.stringify({ sha: version.sha, confirm: true }) }), "Откат запрошен"); }}>Откатить</button> : null}
              </div>
            ))}
            <Button className="mt-3" variant="danger" onClick={() => { if (!window.confirm("Удалить проект сайта?")) return; void run(() => api(`/api/sites/${project.id}`, { method: "DELETE", body: JSON.stringify({ confirm: true }) }).then(() => { window.location.href = "/sites"; }), "Удалено"); }}>Удалить проект</Button>
          </Card>
        </div>
      </div>
      {project.organization.isDemo ? null : <CreateOffer organizationId={project.organization.id} />}
    </div>
  );
}
