"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { PreviewLink, canPreview } from "@/components/preview-link";
import { SITE_STATUS_LABEL, SITE_TYPES, formatDate } from "@/lib/domain/labels";

type Project = { id: string; name: string; status: string; siteType: string; visibility: string; error: string | null; createdAt: string; organization: { name: string; city: string | null; isDemo: boolean } };

export default function SitesPage() {
  const sites = useResource<Project[]>("/api/sites");
  const [error, setError] = useState("");
  const [organizationId, setOrganizationId] = useState("");

  async function create(formData: FormData) {
    setError("");
    try {
      const created = await api<{ project: { id: string } }>("/api/sites", {
        method: "POST",
        body: JSON.stringify({
          organizationId: String(formData.get("organizationId") || organizationId),
          siteType: formData.get("siteType"),
          language: "ru",
          style: formData.get("style") || undefined,
          pages: String(formData.get("pages") || "").split(",").map((item) => item.trim()).filter(Boolean),
          wishes: formData.get("wishes") || undefined,
          confirm: true,
        }),
      });
      window.location.href = `/sites/${created.project.id}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Сайт не поставлен в очередь");
    }
  }

  return (
    <div>
      <PageTitle title="Генерация сайтов" text="Один агент Studio работает над одним проектом. Вопросы и план ждут вашего ответа. Ссылка, которую можно отправить, публичная и открывается без входа в Studio." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <form action={create} className="space-y-3">
            <Field label="ID организации" hint="Его можно скопировать из адреса карточки"><input name="organizationId" required value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className={controlClass} /></Field>
            <Field label="Тип"><select name="siteType" className={controlClass}>{SITE_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></Field>
            <Field label="Стиль"><input name="style" className={controlClass} /></Field>
            <Field label="Страницы"><input name="pages" className={controlClass} placeholder="Главная, Услуги, Контакты" /></Field>
            <Field label="Пожелания"><textarea name="wishes" rows={4} className={controlClass} /></Field>
            <Button type="submit">Поставить в очередь</Button>
          </form>
        </Card>
        <div className="space-y-3">
          {sites.loading ? <Loading /> : sites.error ? <State title="Проекты недоступны" text={sites.error} /> : (sites.data ?? []).length === 0 ? <State title="Проектов нет" text="Создайте демо из карточки организации или укажите её идентификатор слева." /> : (sites.data ?? []).map((project) => (
            <Card key={project.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link className="font-medium text-teal-800" href={`/sites/${project.id}`}>{project.name}</Link>
                  <p className="text-sm text-slate-500">{project.organization.name}{project.organization.city ? ` · ${project.organization.city}` : ""} · {formatDate(project.createdAt)}</p>
                </div>
                <Badge tone={project.status === "failed" || project.status === "qa_failed" ? "red" : project.status === "preview_ready" || project.status === "approved" ? "green" : "teal"}>{SITE_STATUS_LABEL[project.status] || project.status}</Badge>
              </div>
              <p className="mt-2 text-sm">{project.visibility === "public" ? "Опубликован" : "Не опубликован"}. {project.organization.isDemo ? "Пример, Studio не вызывается." : ""}</p>
              {canPreview(project.status) && !project.organization.isDemo ? <PreviewLink siteId={project.id} auto={false} /> : null}
              {project.error ? <p className="mt-2 text-sm text-red-700">{project.error}</p> : null}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
