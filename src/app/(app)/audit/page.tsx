"use client";

import { useState } from "react";
import { useResource } from "@/components/use-resource";
import { Button, Loading, PageTitle, State } from "@/components/ui";
import { formatDate } from "@/lib/domain/labels";

type Row = { id: string; action: string; entityType: string | null; entityId: string | null; actorId: string | null; createdAt: string };
type Page = { total: number; page: number; items: Row[] };

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const log = useResource<Page>(`/api/audit?page=${page}`);
  if (log.loading) return <Loading />;
  if (log.error || !log.data) return <State title="Журнал недоступен" text={log.error || "Нет ответа"} />;
  return (
    <div>
      <PageTitle title="Журнал действий" text="Записи этого рабочего пространства: кто запустил поиск, изменил настройки, одобрил сообщение или публикацию. Секреты в журнал не пишутся." />
      {log.data.items.length === 0 ? <State title="Записей нет" text="Журнал появится после первых действий команды." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Когда</th><th className="px-3 py-2">Действие</th><th className="px-3 py-2">Объект</th><th className="px-3 py-2">Кто</th></tr></thead>
            <tbody>
              {log.data.items.map((item) => (
                <tr key={item.id} className="border-t border-line">
                  <td className="px-3 py-2">{formatDate(item.createdAt)}</td>
                  <td className="px-3 py-2">{item.action}</td>
                  <td className="px-3 py-2">{item.entityType || "—"} {item.entityId || ""}</td>
                  <td className="px-3 py-2">{item.actorId || "система"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-sm">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Назад</Button>
        <span>Страница {log.data.page} из {Math.max(1, Math.ceil(log.data.total / 50))}</span>
        <Button variant="secondary" disabled={page * 50 >= log.data.total} onClick={() => setPage((value) => value + 1)}>Дальше</Button>
      </div>
    </div>
  );
}
