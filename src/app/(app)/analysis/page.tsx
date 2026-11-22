"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Loading, PageTitle, State } from "@/components/ui";
import { formatDate, money } from "@/lib/domain/labels";

type Report = {
  id: string;
  status: string;
  source: string;
  model: string | null;
  report: Record<string, unknown> | null;
  organizationId: string;
  error: string | null;
  costUsd: number | null;
  costUnknown: boolean;
  createdAt: string;
  organization: { name: string; city: string | null; isDemo?: boolean };
};

function kindLabel(kind: string) {
  if (kind === "fact") return "факт";
  if (kind === "assumption") return "оценка";
  return "неизвестно";
}

function Analysis() {
  const selected = useSearchParams().get("id");
  const reports = useResource<Report[]>("/api/analysis");
  const one = useResource<Report>(selected ? `/api/analysis/${selected}` : null);
  const [error, setError] = useState("");
  const report = one.data;
  const result = (report?.report ?? null) as {
    summary?: string;
    activities?: string[];
    services?: string[];
    problems?: { text: string; kind: string }[];
    opportunities?: { text: string; kind: string }[];
    unknowns?: string[];
    confidence?: number;
    commercialPotential?: boolean | null;
    reasoning?: { text: string; kind: string }[];
  } | null;

  return (
    <div>
      <PageTitle title="AI-анализ" text="Отчёт сохраняется только после корректного ответа модели. Если стоимость не пришла от API, она остаётся неизвестной." />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          {reports.loading ? <Loading /> : reports.error ? <State title="Список недоступен" text={reports.error} /> : (reports.data ?? []).length === 0 ? <State title="Отчётов нет" text="Запустите анализ из базы организаций. Для демонстрационных примеров модель не вызывается." /> : (reports.data ?? []).map((item) => (
            <Link key={item.id} href={`/analysis?id=${item.id}`} className="block border-b border-line py-2 text-sm">
              <div className="font-medium">{item.organization.name}</div>
              <div className="text-xs text-slate-500">{item.status} · {item.source} · {formatDate(item.createdAt)}</div>
            </Link>
          ))}
        </Card>
        {!selected ? <State title="Выберите отчёт" text="Слева список реальных попыток анализа этого пространства." /> : one.loading ? <Loading /> : one.error || !report ? <State title="Отчёт недоступен" text={one.error || "Нет данных"} /> : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{report.organization.name}</h2>
                <p className="text-sm text-slate-500">{report.organization.city || "город не указан"} · модель {report.model || "не указана"} · {money(report.costUsd, report.costUnknown)}</p>
              </div>
              <Badge tone={report.status === "completed" ? "green" : report.status === "failed" ? "red" : "amber"}>{report.status}</Badge>
            </div>
            {report.organization.isDemo ? <p className="mt-3 text-sm text-amber-800">Источник «demo»: это учебный текст, а не ответ модели.</p> : null}
            {report.error ? <p className="mt-3 text-sm text-red-700">{report.error}</p> : null}
            {report.status === "failed" && !report.organization.isDemo ? <Button className="mt-3" variant="secondary" onClick={() => api("/api/analysis", { method: "POST", body: JSON.stringify({ organizationIds: [report.organizationId], confirmLarge: false }) }).then(() => reports.reload()).catch((reason) => setError(reason instanceof Error ? reason.message : "Повтор не запущен"))}>Повторить анализ</Button> : null}
            <p className="mt-4 text-sm">{result?.summary || "Содержательного отчёта нет."}</p>
            <Section title="Чем занимается" items={result?.activities} />
            <Section title="Услуги из фактов" items={result?.services} />
            <Labeled title="Проблемы" items={result?.problems} />
            <Labeled title="Возможности" items={result?.opportunities} />
            <Labeled title="Обоснование" items={result?.reasoning} />
            <Section title="Что осталось неизвестным" items={result?.unknowns} />
            <p className="mt-3 text-sm">Уверенность: {result?.confidence == null ? "не указана" : Math.round(result.confidence * 100) + "%"}. Коммерческий потенциал: {result?.commercialPotential == null ? "не оценён" : result.commercialPotential ? "есть признаки" : "не подтверждён"}.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div className="mt-4"><h3 className="font-semibold">{title}</h3><ul className="mt-1 list-disc pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function Labeled({ title, items }: { title: string; items?: { text: string; kind: string }[] }) {
  if (!items?.length) return null;
  return <div className="mt-4"><h3 className="font-semibold">{title}</h3>{items.map((item) => <p key={item.text} className="mt-1 text-sm">{item.text} <span className="text-slate-500">({kindLabel(item.kind)})</span></p>)}</div>;
}

export default function AnalysisPage() {
  return <Suspense fallback={<Loading />}><Analysis /></Suspense>;
}
