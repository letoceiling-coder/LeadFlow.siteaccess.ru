"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useHunt } from "./shell";
import { post, useLive } from "./data";
import { Button, Field, Glass, Notice, Sheet, Skeleton, errorText, inputClass, useToast } from "./ui";
import { rub, type Project, type Scenario } from "./types";

export function useScenarios() {
  return useLive<{ scenarios: Scenario[]; stages: { key: string; label: string }[] }>("/api/hunt/scenarios");
}

export function ScenarioPanel({ id }: { id: string | null }) {
  const { close, open, refresh } = useHunt();
  const toast = useToast();
  const all = useScenarios();
  const scenario = all.data?.scenarios.find((item) => item.id === id) ?? null;
  const [title, setTitle] = useState("");
  const [contact, setContact] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (scenario) { setTitle(""); setContact(""); setAmount(String(scenario.priceFrom)); setError(""); }
  }, [scenario]);

  async function create() {
    if (!scenario) return;
    if (title.trim().length < 2) return setError("Как называется клиент или проект?");
    setBusy(true);
    setError("");
    try {
      const result = await post<{ project: Project }>("/api/hunt/projects", {
        scenarioId: scenario.id,
        title: title.trim(),
        contactValue: contact.trim() || undefined,
        amount: amount ? Math.round(Number(amount.replace(/\s/g, ""))) : undefined,
      });
      refresh();
      toast({ text: "Проект создан" });
      open("project", result.project.id, true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={Boolean(id)}
      onClose={close}
      title={scenario?.title ?? "Сценарий"}
      subtitle={scenario ? `${scenario.id} · ${scenario.contour === "A" ? "быстрая сделка" : "платформа"} · ${scenario.days[0]}–${scenario.days[1]} дн` : null}
      footer={scenario ? <Button variant="accent" size="lg" className="w-full" pending={busy} onClick={create}><Plus className="h-5 w-5" /> Создать проект</Button> : null}
    >
      {!scenario ? (all.error ? <Notice tone="error">{all.error}</Notice> : <Skeleton rows={3} />) : (
        <div className="space-y-5">
          <Glass tint={scenario.tone} className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--h-muted)]">Что болит</div>
            <p className="mt-1.5 text-[15px] leading-6">{scenario.pain}</p>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--h-muted)]">Что продаём</div>
            <p className="mt-1.5 text-lg font-semibold">{scenario.product}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{rub(scenario.priceFrom)} – {rub(scenario.priceTo)}</p>
          </Glass>

          <section>
            <h3 className="mb-2 text-lg font-semibold">В проекте</h3>
            <ul className="space-y-1.5 text-[15px]">
              {scenario.features.map((feature) => <li key={feature} className="flex gap-2.5"><span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--h-accent)]" />{feature}</li>)}
            </ul>
            <p className="mt-3 text-sm text-[var(--h-muted)]">Демо после ответа: {scenario.demo}{scenario.caseRef ? ` · кейс «${scenario.caseRef}»` : ""}</p>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-semibold">Этапы</h3>
            <ol className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl text-[15px]">
              {scenario.stages.map((stage, index) => <li key={stage} className="flex gap-3 px-4 py-3"><span className="w-5 tabular-nums text-[var(--h-faint)]">{index + 1}</span>{stage}</li>)}
            </ol>
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Новый проект по сценарию</h3>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Field label="Клиент или проект"><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Суши Мастер, Краснодар" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Контакт"><input className={inputClass} value={contact} onChange={(event) => setContact(event.target.value)} placeholder="+7… или @ник" /></Field>
              <Field label="Сумма, ₽"><input className={inputClass} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
            </div>
          </section>
        </div>
      )}
    </Sheet>
  );
}
