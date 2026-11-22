"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useHunt } from "@/components/hunt/shell";
import { useLive } from "@/components/hunt/data";
import { useScenarios } from "@/components/hunt/scenario-panel";
import { Chip, Empty, Glass, Notice, Ring, Segmented, Skeleton, cx } from "@/components/hunt/ui";
import { PROJECT_STAGE_LABEL, dayLabel, rub, type Project } from "@/components/hunt/types";

type Tab = "projects" | "scenarios";
type ProjectList = { items: Project[]; byStage: { key: string; label: string; count: number; amount: number }[] };

export default function HuntProjectsPage() {
  const { version, open } = useHunt();
  const [tab, setTab] = useState<Tab>("projects");
  const [stage, setStage] = useState<string | null>(null);
  const projects = useLive<ProjectList>("/api/hunt/projects", version);
  const scenarios = useScenarios();
  const items = (projects.data?.items ?? []).filter((item) => (stage ? item.stage === stage : item.stage !== "cancelled"));
  const pipeline = (projects.data?.byStage ?? []).filter((item) => !["done", "cancelled"].includes(item.key)).reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="pt-2">
      <h1 className="text-[32px] font-semibold leading-[38px] tracking-tight">Проекты</h1>
      {projects.data ? <p className="mt-1 text-[15px] text-[var(--h-muted)]">В работе на <b className="text-[var(--h-text)] tabular-nums">{rub(pipeline)}</b></p> : null}

      <div className="sticky top-[68px] z-20 -mx-4 mt-5 px-4 py-2 backdrop-blur-md">
        <Segmented<Tab> value={tab} onChange={setTab} items={[{ key: "projects", label: "Проекты", count: projects.data?.items.length }, { key: "scenarios", label: "Сценарии ниш", count: scenarios.data?.scenarios.length }]} />
      </div>

      {tab === "projects" ? (
        <div className="mt-3 space-y-3">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Chip active={!stage} onClick={() => setStage(null)}>Все</Chip>
            {(projects.data?.byStage ?? []).filter((item) => item.count).map((item) => (
              <Chip key={item.key} active={stage === item.key} onClick={() => setStage(item.key)}>{item.label} <span className="tabular-nums opacity-60">{item.count}</span></Chip>
            ))}
          </div>
          {projects.error ? <Notice tone="error">{projects.error}</Notice> : !projects.data ? <Skeleton rows={3} /> : items.length === 0 ? (
            <Empty title="Проектов пока нет" text="Проект создаётся сам, когда лид доходит до «Сметы» или «Сделки». Или выберите сценарий ниши и создайте вручную." />
          ) : items.map((item) => (
            <button key={item.id} onClick={() => open("project", item.id)} className="w-full text-left">
              <Glass className="flex items-center gap-4 px-4 py-4 transition hover:bg-white/[0.07]">
                <Ring done={item.progress.done} total={item.progress.total} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[17px] font-semibold leading-6">{item.title}</div>
                  <div className="mt-0.5 truncate text-sm text-[var(--h-muted)]">{[item.scenarioTitle ?? item.product, item.organization?.city].filter(Boolean).join(" · ")}</div>
                  <div className="mt-1.5 flex items-center gap-2 text-[13px]">
                    <span className={cx("rounded-full px-2 py-0.5 font-medium", item.stage === "done" ? "bg-[rgba(59,224,138,0.14)] text-[#8ff0bd]" : "bg-white/10")}>{PROJECT_STAGE_LABEL[item.stage]}</span>
                    <span className="font-semibold tabular-nums min-[400px]:hidden">{rub(item.amount)}</span>
                    <span className="text-[var(--h-faint)] max-[399px]:hidden">обновлён {dayLabel(item.updatedAt)}</span>
                  </div>
                </div>
                <div className="text-right text-[15px] font-semibold tabular-nums max-[399px]:hidden">{rub(item.amount)}</div>
              </Glass>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          {scenarios.error ? <Notice tone="error">{scenarios.error}</Notice> : !scenarios.data ? <Skeleton rows={4} /> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {scenarios.data.scenarios.map((item, index) => (
                <button key={item.id} onClick={() => open("scenario", item.id)} className={cx("text-left", index === 0 && "col-span-2 sm:col-span-1")}>
                  <Glass tint={item.tone} className="flex h-full min-h-[148px] flex-col p-4 transition hover:brightness-125">
                    <div className="flex items-start justify-between">
                      <span className="text-xs font-semibold tabular-nums text-[var(--h-muted)]">{item.id}</span>
                      <ArrowUpRight className="h-4 w-4 text-[var(--h-faint)]" />
                    </div>
                    <div className="mt-auto pt-6">
                      <div className="text-[17px] font-semibold leading-6">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-[var(--h-muted)]">{item.product}</div>
                      <div className="mt-2 text-sm font-semibold tabular-nums">от {rub(item.priceFrom)}</div>
                    </div>
                  </Glass>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
