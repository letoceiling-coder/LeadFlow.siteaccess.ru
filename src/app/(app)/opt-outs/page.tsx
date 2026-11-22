"use client";

import Link from "next/link";
import { useResource } from "@/components/use-resource";
import { Card, Loading, PageTitle, State } from "@/components/ui";
import { formatDate } from "@/lib/domain/labels";

type OptOutRow = {
  id: string;
  createdAt: string;
  organizationId: string;
  name: string;
  city: string | null;
  category: string | null;
};

export default function OptOutsPage() {
  const rows = useResource<OptOutRow[]>("/api/opt-outs");
  return (
    <div>
      <PageTitle title="Не беспокоить" text="Здесь клиенты, которые нажали ссылку в предложении. Агент и рассылки больше им не пишут." />
      <Card>
        {rows.loading ? <Loading /> : rows.error ? <State title="Список недоступен" text={rows.error} /> : (rows.data ?? []).length === 0 ? <p className="text-sm text-slate-500">Пока никто не отказывался.</p> : (
          <div className="divide-y divide-line">
            {(rows.data ?? []).map((item) => (
              <div key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
                <div>
                  <Link href={`/organizations/${item.organizationId}`} className="font-medium">{item.name}</Link>
                  <div className="text-slate-500">{[item.category, item.city].filter(Boolean).join(" · ") || "Без города"}</div>
                </div>
                <div className="text-slate-500">{formatDate(item.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
