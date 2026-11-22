"use client";

import { useState } from "react";
import { useResource } from "@/components/use-resource";
import { Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { money } from "@/lib/domain/labels";

type Report = {
  organizations: number;
  byCity: { city: string; count: number }[];
  byCategory: { category: string; count: number }[];
  stages: { key: string; name: string; count: number }[];
  sites: number;
  qaPassed: number;
  messages: { channel: string; status: string; _count: number }[];
  knownCostUsd: number | null;
  unknownCostCount: number;
  revenue: number | null;
  costPerQualified: number | null;
  costPerDemo: number | null;
  costPerSale: number | null;
  roi: number | null;
  note: string | null;
};

export default function AnalyticsPage() {
  const [query, setQuery] = useState("");
  const report = useResource<Report>(`/api/analytics${query ? `?${query}` : ""}`);
  if (report.loading) return <Loading />;
  if (report.error || !report.data) return <State title="Аналитика недоступна" text={report.error || "Нет ответа"} />;
  const data = report.data;
  const maxCity = Math.max(1, ...data.byCity.map((item) => item.count));
  return (
    <div>
      <PageTitle title="Аналитика" text="Считаются только организации этого пространства. Примеры и неизвестные расходы в деньги не подставляются." />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const next = new URLSearchParams(); ["from", "to", "city", "category", "source"].forEach((key) => { const value = String(form.get(key) || ""); if (value) next.set(key, value); }); setQuery(next.toString()); }}>
          <Field label="С"><input name="from" type="date" className={controlClass} /></Field>
          <Field label="По"><input name="to" type="date" className={controlClass} /></Field>
          <Field label="Город"><input name="city" className={controlClass} /></Field>
          <Field label="Категория"><input name="category" className={controlClass} /></Field>
          <div className="md:col-span-4"><button className="rounded-lg bg-teal-700 px-3 py-2 text-sm text-white">Показать</button></div>
        </form>
      </Card>
      {data.organizations === 0 ? <State title="За период данных нет" text="Измените фильтр или дождитесь результатов поиска. Пустые графики не заполняются примерными числами." /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Организаций" value={String(data.organizations)} />
        <Metric label="Демо-сайтов" value={String(data.sites)} />
        <Metric label="QA без критичных" value={String(data.qaPassed)} />
        <Metric label="Известные расходы" value={money(data.knownCostUsd, data.knownCostUsd == null)} />
        <Metric label="Выручка сделок" value={data.revenue == null ? "неизвестно" : new Intl.NumberFormat("ru-RU").format(data.revenue)} />
        <Metric label="Расход на квалифицированного" value={money(data.costPerQualified, data.costPerQualified == null)} />
        <Metric label="Расход на демо" value={money(data.costPerDemo, data.costPerDemo == null)} />
        <Metric label="Окупаемость" value={data.roi == null ? "неизвестно" : `${data.roi.toFixed(1)} %`} />
      </div>
      {data.note ? <p className="mt-3 text-sm text-amber-800">{data.note} Неизвестных записей: {data.unknownCostCount}.</p> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Bars title="По городам" rows={data.byCity.map((item) => ({ label: item.city, count: item.count }))} max={maxCity} />
        <Bars title="По категориям" rows={data.byCategory.map((item) => ({ label: item.category, count: item.count }))} max={Math.max(1, ...data.byCategory.map((item) => item.count))} />
        <Bars title="Воронка" rows={data.stages.map((item) => ({ label: item.name, count: item.count }))} max={Math.max(1, ...data.stages.map((item) => item.count))} />
        <Card>
          <h2 className="mb-3 font-semibold">Сообщения</h2>
          {data.messages.length === 0 ? <p className="text-sm text-slate-500">Отправок за период нет</p> : data.messages.map((item) => <p key={item.channel + item.status} className="text-sm">{item.channel} · {item.status}: {item._count}</p>)}
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><div className="text-2xl font-semibold">{value}</div><div className="mt-1 text-sm text-slate-500">{label}</div></Card>;
}

function Bars({ title, rows, max }: { title: string; rows: { label: string; count: number }[]; max: number }) {
  return (
    <Card>
      <h2 className="mb-3 font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-500">Нет данных</p> : rows.map((row) => (
        <div key={row.label} className="mb-2">
          <div className="mb-1 flex justify-between text-xs"><span>{row.label}</span><span>{row.count}</span></div>
          <div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} /></div>
        </div>
      ))}
    </Card>
  );
}
