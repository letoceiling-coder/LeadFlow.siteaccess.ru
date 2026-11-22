"use client";

import { useState } from "react";
import { useResource } from "@/components/use-resource";
import { Loading, State, cnJoin } from "@/components/ui";
import { ItemRow, STATUS_LABEL, Section, dayLabel, type HuntItem } from "@/components/hunt";

type Dialogs = { due: HuntItem[]; approved: HuntItem[]; active: HuntItem[]; waiting: HuntItem[]; sleeping: number };

const TABS = [
  { key: "todo", label: "Сделать" },
  { key: "active", label: "В диалоге" },
  { key: "waiting", label: "Ждём" },
] as const;

export default function HuntDialogsPage() {
  const dialogs = useResource<Dialogs>("/api/hunt/dialogs");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("todo");
  const data = dialogs.data;

  if (dialogs.loading && !data) return <Loading />;
  if (dialogs.error) return <State title="Диалоги недоступны" text={dialogs.error} />;
  if (!data) return null;

  const counts = { todo: data.due.length + data.approved.length, active: data.active.length, waiting: data.waiting.length };

  return (
    <div className="mx-auto w-full max-w-xl pb-4">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-tight">Диалоги</h1>

      <div className="mt-4 flex gap-1 rounded-full bg-slate-100 p-1">
        {TABS.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)} className={cnJoin("h-9 flex-1 rounded-full text-sm font-medium", tab === item.key ? "bg-white shadow-card" : "text-slate-600")}>
            {item.label} <span className="tabular-nums text-slate-400">{counts[item.key]}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "todo" ? (
          counts.todo === 0 ? <Empty text="Сегодня некому писать. Возьмите карточки в работу на экране «Сегодня»." /> : (
            <>
              {data.due.length ? (
                <Section title="Напомнить" count={data.due.length}>
                  {data.due.map((item) => <ItemRow key={item.id} item={item} meta={<span className="text-red-700">Напоминание {item.followUpStep + 1} · {dayLabel(item.nextFollowUpAt)}</span>} />)}
                </Section>
              ) : null}
              {data.approved.length ? (
                <Section title="Написать первым" count={data.approved.length}>
                  {data.approved.map((item) => <ItemRow key={item.id} item={item} />)}
                </Section>
              ) : null}
            </>
          )
        ) : null}

        {tab === "active" ? (
          data.active.length === 0 ? <Empty text="Пока никто не ответил. Когда ответят — отметьте «Ответил» в карточке." /> : (
            <Section title="Ответили" count={data.active.length}>
              {data.active.map((item) => <ItemRow key={item.id} item={item} meta={STATUS_LABEL[item.status]} />)}
            </Section>
          )
        ) : null}

        {tab === "waiting" ? (
          data.waiting.length === 0 ? <Empty text="Нет отправленных сообщений, которые ждут ответа." /> : (
            <Section title="Ждём ответа" count={data.waiting.length}>
              {data.waiting.map((item) => <ItemRow key={item.id} item={item} meta={`Отправлено ${dayLabel(item.sentAt)}${item.nextFollowUpAt ? ` · напомнить ${dayLabel(item.nextFollowUpAt)}` : ""}`} />)}
            </Section>
          )
        ) : null}

        {data.sleeping ? <p className="px-1 text-sm text-slate-500">Спящих после трёх напоминаний: {data.sleeping}</p> : null}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-line bg-white px-5 py-8 text-center text-sm text-slate-600">{text}</div>;
}
