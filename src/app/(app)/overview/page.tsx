"use client";

import Link from "next/link";
import { useResource } from "@/components/use-resource";
import { Card, Loading, PageTitle, State } from "@/components/ui";
import { formatDate } from "@/lib/domain/labels";

type Dashboard = {
  cards: Record<string, number>;
  searches: { id: string; status: string; createdAt: string; input: { city?: string; category?: string } }[];
  errors: { id: string; error: string | null; createdAt: string }[];
  activities: { id: string; message: string; createdAt: string }[];
  workerOnline: boolean;
};

const CARDS: { key: string; label: string }[] = [
  { key: "total", label: "Организаций в базе" },
  { key: "recent", label: "Новых за 30 дней" },
  { key: "noWebsite", label: "Без сайта" },
  { key: "withPhone", label: "С телефоном" },
  { key: "qualified", label: "Квалифицированных лидов" },
  { key: "analyses", label: "AI-анализов" },
  { key: "sites", label: "Демо-сайтов" },
  { key: "readySites", label: "Готовых демо" },
  { key: "sent", label: "Отправленных сообщений" },
  { key: "replies", label: "Входящих ответов" },
  { key: "activeDeals", label: "Активных сделок" },
  { key: "wonDeals", label: "Выигранных сделок" },
];

export default function DashboardPage() {
  const { data, error, loading } = useResource<Dashboard>("/api/dashboard");
  if (loading) return <Loading />;
  if (error || !data) return <State title="Обзор недоступен" text={error || "Нет ответа сервера"} />;
  const empty = data.cards.total === 0;
  return (
    <div>
      <PageTitle title="Обзор" text="Здесь только цифры из вашей базы. Демонстрационные карточки в показатели не входят." />
      {!data.workerOnline ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Фоновый обработчик не запущен. Поиск можно создать, но долгие задачи AI и сайтов ждут команду npm run worker или контейнер worker.</div> : null}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {CARDS.map((card) => <Card key={card.key}><div className="text-2xl font-semibold">{data.cards[card.key] ?? 0}</div><div className="mt-1 text-sm text-slate-500">{card.label}</div></Card>)}
      </div>
      {empty ? <div className="mt-5"><State title="База ещё пустая" text="Подключите Parser API и запустите поиск или включите явно помеченные примеры в настройках. Примеры не считаются реальными клиентами." action={<Link className="text-sm text-teal-800" href="/search">Перейти к поиску</Link>} /></div> : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">Последние поиски</h2>
          {data.searches.length === 0 ? <p className="text-sm text-slate-500">Поисков ещё не было</p> : data.searches.map((item) => <Link key={item.id} href="/search" className="block border-t border-line py-2 text-sm">{item.input?.city} · {item.input?.category}<div className="text-xs text-slate-500">{item.status} · {formatDate(item.createdAt)}</div></Link>)}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Ошибки поиска</h2>
          {data.errors.length === 0 ? <p className="text-sm text-slate-500">Ошибок нет</p> : data.errors.map((item) => <p key={item.id} className="border-t border-line py-2 text-sm text-red-800">{item.error || "Ошибка без текста"}</p>)}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Действия</h2>
          {data.activities.length === 0 ? <p className="text-sm text-slate-500">История появится после первых действий</p> : data.activities.map((item) => <p key={item.id} className="border-t border-line py-2 text-sm">{item.message}<span className="mt-1 block text-xs text-slate-500">{formatDate(item.createdAt)}</span></p>)}
        </Card>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        <Link className="rounded-lg bg-teal-700 px-3 py-2 text-white" href="/search">Новый поиск</Link>
        <Link className="rounded-lg border border-line bg-white px-3 py-2" href="/organizations">База организаций</Link>
        <Link className="rounded-lg border border-line bg-white px-3 py-2" href="/analysis">AI-анализ</Link>
        <Link className="rounded-lg border border-line bg-white px-3 py-2" href="/sites">Демо-сайт</Link>
        <Link className="rounded-lg border border-line bg-white px-3 py-2" href="/crm">CRM</Link>
        <Link className="rounded-lg border border-line bg-white px-3 py-2" href="/automations">Автоматизация</Link>
      </div>
    </div>
  );
}
