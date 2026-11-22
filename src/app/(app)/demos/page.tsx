"use client";

import Link from "next/link";
import { useResource } from "@/components/use-resource";
import { Badge, Card, Loading, PageTitle, State } from "@/components/ui";
import { PreviewLink, canPreview } from "@/components/preview-link";
import { SITE_STATUS_LABEL, formatDate } from "@/lib/domain/labels";

type Project = { id: string; name: string; status: string; visibility: string; qaScore: number | null; criticalCount: number; createdAt: string; organization: { name: string; isDemo: boolean } };

export default function DemosPage() {
  const sites = useResource<Project[]>("/api/sites");
  if (sites.loading) return <Loading />;
  if (sites.error) return <State title="Демо-проекты недоступны" text={sites.error} />;
  const items = sites.data ?? [];
  return (
    <div>
      <PageTitle title="Демо-проекты" text="Ссылка на просмотр публичная: её можно отправить, страница открывается без входа в Studio." />
      {items.length === 0 ? <State title="Демо ещё нет" text="Создайте сайт из карточки организации. Генерация идёт через Website AI Studio и не копирует фотографии Яндекса." action={<Link className="text-teal-800" href="/sites">К генерации</Link>} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id}>
              <img alt="" className="mb-3 h-36 w-full rounded-xl bg-slate-100 object-cover" src={`/api/sites/${item.id}/thumbnail`} onError={(event) => { event.currentTarget.style.display = "none"; }} />
              <Link className="font-semibold text-teal-800" href={`/sites/${item.id}`}>{item.name}</Link>
              <p className="mt-1 text-sm text-slate-500">{item.organization.name} · {formatDate(item.createdAt)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge>{SITE_STATUS_LABEL[item.status] || item.status}</Badge>
                <Badge tone={item.visibility === "public" ? "green" : "slate"}>{item.visibility === "public" ? "публичный" : "не опубликован"}</Badge>
                {item.criticalCount ? <Badge tone="red">QA: есть критичные</Badge> : <Badge tone="teal">QA {item.qaScore ?? "не запускалась"}</Badge>}
              </div>
              {item.organization.isDemo ? <p className="mt-2 text-xs text-amber-800">Учебный пример, внешний сайт не создавался.</p> : canPreview(item.status) ? <PreviewLink siteId={item.id} auto={false} /> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
