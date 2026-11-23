"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, controlClass } from "@/components/ui";
import { PIPELINE, SITE_TYPES, WEBSITE_STATUS_LABEL } from "@/lib/domain/labels";

type Item = {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  contactKinds?: string[];
  website: string | null;
  websiteStatus: string;
  rating: number | null;
  reviewCount: number | null;
  leadScore: number | null;
  stage: string | null;
  aiStatus: string;
  hasDemo: boolean;
  assigneeName: string | null;
  updatedAt: string;
  isDemo: boolean;
};

type List = { total: number; page: number; pageSize: number; items: Item[] };
type Filters = { cities: string[]; categories: string[]; members: { id: string; name: string; membershipId: string }[] };

const CONTACT_LABEL: Record<string, string> = {
  email: "почта",
  phone: "телефон",
  telegram: "Telegram",
  vk: "VK",
  max: "MAX",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  social: "соцсеть",
};

function Organizations() {
  const initial = useSearchParams();
  const [params, setParams] = useState(() => {
    const next = new URLSearchParams({ page: "1", pageSize: "25", sort: "createdAt", order: "desc" });
    const city = initial.get("city");
    if (city) next.set("city", city);
    return next;
  });
  const list = useResource<List>(`/api/organizations?${params.toString()}`);
  const filters = useResource<Filters>("/api/organizations/filters");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  function update(patch: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.set("page", "1");
    setParams(next);
    setSelected([]);
  }

  function toggleSort(key: string) {
    const sortable = ["name", "city", "rating", "reviewCount", "createdAt", "updatedAt", "leadScore"];
    if (!sortable.includes(key)) return;
    const order = params.get("sort") === key && params.get("order") === "desc" ? "asc" : "desc";
    update({ sort: key, order }, false);
  }

  async function bulk(action: "assign" | "score" | "analyze" | "create_demo", extra: Record<string, unknown> = {}) {
    setError("");
    setNotice("");
    try {
      await api("/api/organizations/bulk", { method: "POST", body: JSON.stringify({ ids: selected, action, confirmLarge: selected.length > 5, ...extra }) });
      setNotice(action === "analyze" ? "Анализ поставлен в очередь. Результат появится после обработчика." : "Действие выполнено.");
      setSelected([]);
      await list.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Действие не выполнено");
    }
  }

  async function createManual(formData: FormData) {
    setError("");
    try {
      const created = await api<{ organization: { id: string } }>("/api/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          city: formData.get("city") || undefined,
          category: formData.get("category") || undefined,
          address: formData.get("address") || undefined,
          phone: formData.get("phone") || undefined,
          email: formData.get("email") || "",
          website: formData.get("website") || undefined,
        }),
      });
      setManual(false);
      window.location.href = `/organizations/${created.organization.id}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Карточка не создана");
    }
  }

  const pages = useMemo(() => Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? 25))), [list.data]);

  return (
    <div>
      <PageTitle
        title="База организаций"
        text="Карточки этого пространства. Демонстрационные примеры скрыты, пока не включён отдельный фильтр. Публичный телефон на карте не означает согласие на рекламу."
        action={<Button variant="secondary" onClick={() => setManual((value) => !value)}>Добавить вручную</Button>}
      />
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-teal-800">{notice}</p> : null}
      {manual ? (
        <Card className="mb-4">
          <form action={createManual} className="grid gap-3 md:grid-cols-2">
            <Field label="Название"><input name="name" required className={controlClass} /></Field>
            <Field label="Город"><input name="city" className={controlClass} /></Field>
            <Field label="Категория"><input name="category" className={controlClass} /></Field>
            <Field label="Адрес"><input name="address" className={controlClass} /></Field>
            <Field label="Телефон"><input name="phone" className={controlClass} /></Field>
            <Field label="Email"><input name="email" type="email" className={controlClass} /></Field>
            <Field label="Сайт"><input name="website" className={controlClass} /></Field>
            <div className="flex items-end"><Button type="submit">Сохранить карточку</Button></div>
          </form>
        </Card>
      ) : null}
      <Card className="mb-4">
        <form
          className="lf-filters grid gap-3 md:grid-cols-4"
          data-open={moreFilters ? "true" : "false"}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            update({
              q: String(form.get("q") || ""),
              city: String(form.get("city") || ""),
              category: String(form.get("category") || ""),
              websiteStatus: String(form.get("websiteStatus") || ""),
              hasPhone: String(form.get("hasPhone") || ""),
              minRating: String(form.get("minRating") || ""),
              minReviews: String(form.get("minReviews") || ""),
              minScore: String(form.get("minScore") || ""),
              stage: String(form.get("stage") || ""),
              aiStatus: String(form.get("aiStatus") || ""),
              hasDemo: String(form.get("hasDemo") || ""),
              assigneeId: String(form.get("assigneeId") || ""),
              includeDemo: form.get("includeDemo") === "on" ? "true" : "",
            });
          }}
        >
          <Field label="Поиск"><input name="q" defaultValue={params.get("q") || ""} className={controlClass} /></Field>
          <Field label="Город">
            <input name="city" list="cities" defaultValue={params.get("city") || ""} className={controlClass} />
            <datalist id="cities">{(filters.data?.cities ?? []).map((city) => <option key={city} value={city} />)}</datalist>
          </Field>
          <Field label="Категория">
            <input name="category" list="categories" defaultValue={params.get("category") || ""} className={controlClass} />
            <datalist id="categories">{(filters.data?.categories ?? []).map((category) => <option key={category} value={category} />)}</datalist>
          </Field>
          <Field label="Сайт">
            <select name="websiteStatus" defaultValue={params.get("websiteStatus") || ""} className={controlClass}>
              <option value="">Любой</option>
              {Object.entries(WEBSITE_STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </Field>
          <Field label="Телефон">
            <select name="hasPhone" defaultValue="" className={controlClass}><option value="">Неважно</option><option value="true">Есть</option><option value="false">Нет</option></select>
          </Field>
          <Field label="Рейтинг от"><input name="minRating" type="number" min={0} max={5} step="0.1" className={controlClass} /></Field>
          <Field label="Отзывов от"><input name="minReviews" type="number" min={0} className={controlClass} /></Field>
          <Field label="Оценка от"><input name="minScore" type="number" min={0} max={100} className={controlClass} /></Field>
          <Field label="Стадия">
            <select name="stage" defaultValue="" className={controlClass}><option value="">Любая</option>{PIPELINE.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}</select>
          </Field>
          <Field label="AI">
            <select name="aiStatus" defaultValue="" className={controlClass}><option value="">Любой</option><option value="none">Нет отчёта</option><option value="completed">Готов</option><option value="failed">Ошибка</option><option value="queued">В очереди</option></select>
          </Field>
          <Field label="Демо">
            <select name="hasDemo" defaultValue="" className={controlClass}><option value="">Неважно</option><option value="true">Есть</option><option value="false">Нет</option></select>
          </Field>
          <Field label="Ответственный">
            <select name="assigneeId" defaultValue="" className={controlClass}><option value="">Любой</option>{(filters.data?.members ?? []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="includeDemo" /> Показать примеры</label>
          <div className="flex items-end gap-2">
            <Button type="button" variant="secondary" className="md:hidden" onClick={() => setMoreFilters((value) => !value)}>{moreFilters ? "Скрыть фильтры" : "Все фильтры"}</Button>
            <Button type="submit">Применить</Button>
            <a className="rounded-lg border border-line px-3 py-2 text-sm" href={`/api/organizations/export?${params.toString()}`}>CSV</a>
          </div>
        </form>
      </Card>
      {selected.length ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3 text-sm">
          <span>Выбрано: {selected.length}</span>
          <select className={controlClass + " max-w-xs"} defaultValue="" onChange={(event) => { if (event.target.value) void bulk("assign", { assigneeId: event.target.value }); }}>
            <option value="">Назначить</option>
            {(filters.data?.members ?? []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
          <Button variant="secondary" onClick={() => bulk("score")}>Посчитать оценку</Button>
          <Button variant="secondary" onClick={() => bulk("analyze")}>Запустить AI</Button>
          <select className={controlClass + " max-w-xs"} defaultValue="" onChange={(event) => { if (event.target.value) void bulk("create_demo", { siteType: event.target.value }); }}>
            <option value="">Создать демо</option>
            {SITE_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
        </div>
      ) : null}
      {list.loading ? <Loading /> : list.error ? <State title="База недоступна" text={list.error} /> : (list.data?.items.length ?? 0) === 0 ? <State title="Организаций нет" text="Запустите поиск, синхронизируйте уже собранную базу парсера или добавьте карточку вручную." action={<Link className="text-teal-800" href="/search">Открыть поиск</Link>} /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-[4%] px-3 py-2"><input type="checkbox" checked={selected.length === list.data?.items.length} onChange={(event) => setSelected(event.target.checked ? list.data?.items.map((item) => item.id) ?? [] : [])} /></th>
                <th className="w-[30%] px-3 py-2"><button className="font-medium" onClick={() => toggleSort("name")}>Организация</button></th>
                <th className="w-[16%] px-3 py-2"><button className="font-medium" onClick={() => toggleSort("city")}>Город</button></th>
                <th className="w-[18%] px-3 py-2 font-medium">Сайт</th>
                <th className="w-[18%] px-3 py-2 font-medium">Контакты</th>
                <th className="w-[14%] px-3 py-2 font-medium">Стадия</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((item) => (
                <tr key={item.id} className="border-t border-line">
                  <td className="px-3 py-2 align-top"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td>
                  <td className="px-3 py-2 align-top">
                    <Link className="block truncate font-medium text-teal-800" href={`/organizations/${item.id}`}>{item.name}</Link>
                    <p className="truncate text-xs text-slate-500">{[item.category, item.hasDemo ? "демо готово" : ""].filter(Boolean).join(" · ") || "категория не указана"}</p>
                  </td>
                  <td className="truncate px-3 py-2 align-top">{item.city || "—"}</td>
                  <td className="px-3 py-2 align-top"><Badge tone={item.websiteStatus === "NO_WEBSITE" || item.websiteStatus === "SOCIAL_ONLY" ? "amber" : item.websiteStatus === "BROKEN_WEBSITE" ? "red" : "slate"}>{WEBSITE_STATUS_LABEL[item.websiteStatus] || item.websiteStatus}</Badge></td>
                  <td className="truncate px-3 py-2 align-top text-slate-600">{contactSummary(item)}</td>
                  <td className="truncate px-3 py-2 align-top">{item.stage || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-sm">
        <span>Всего: {list.data?.total ?? 0}</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={Number(params.get("page")) <= 1} onClick={() => update({ page: String(Number(params.get("page")) - 1) }, false)}>Назад</Button>
          <span>{params.get("page")} / {pages}</span>
          <Button variant="secondary" disabled={Number(params.get("page")) >= pages} onClick={() => update({ page: String(Number(params.get("page")) + 1) }, false)}>Дальше</Button>
        </div>
      </div>
    </div>
  );
}

function contactSummary(item: Item) {
  const kinds = item.contactKinds?.length
    ? item.contactKinds
    : [item.phone ? "phone" : "", item.email ? "email" : ""].filter(Boolean);
  if (!kinds.length) return "нет";
  return kinds.map((kind) => CONTACT_LABEL[kind] || kind).join(", ");
}

export default function OrganizationsPage() {
  return <Suspense fallback={<Loading />}><Organizations /></Suspense>;
}
