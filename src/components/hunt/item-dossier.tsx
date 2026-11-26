"use client";

import { ExternalLink } from "lucide-react";
import { cx } from "./ui";
import { dayLabel, type Dossier } from "./types";

const SITE: Record<Dossier["site"]["verdict"], { label: string; tone: string }> = {
  none: { label: "Сайта нет", tone: "text-[#8ff0bd]" },
  weak: { label: "Сайт слабый", tone: "text-[#ffe680]" },
  ok: { label: "Сайт нормальный", tone: "text-[var(--h-muted)]" },
};

/** Досье по брифу: сайт, каналы связи, последний пост, повод, зацепка или NOT_FOUND, почему такая оценка. */
export function DossierCard({ dossier, presetLabel }: { dossier: Dossier; presetLabel: string | null }) {
  const notFound = !dossier.hook || dossier.hook === "NOT_FOUND";
  return (
    <section className="space-y-3">
      <div className={cx("rounded-2xl border px-4 py-3", notFound ? "border-[rgba(255,100,100,0.3)] bg-[rgba(255,100,100,0.08)]" : "tint-orange")}>
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--h-faint)]">Зацепка{dossier.hookSource === "post" ? " · из поста" : dossier.hookSource === "reviews" ? " · из отзывов" : ""}</div>
        <p className="mt-1 text-[15px] leading-6">{notFound ? "NOT_FOUND — проверяемого факта нет. Найдите его в источнике и впишите в текст вместо [зацепки]." : dossier.hook}</p>
      </div>

      <dl className="glass divide-y divide-[var(--h-line)] overflow-hidden rounded-2xl text-[15px]">
        <div className="flex gap-3 px-4 py-2.5">
          <dt className="w-[92px] shrink-0 text-[var(--h-faint)]">Оценка</dt>
          <dd className="min-w-0"><b className="font-semibold">{dossier.grade}</b>{presetLabel ? <span className="text-[var(--h-muted)]"> · {presetLabel}</span> : null}<div className="text-xs text-[var(--h-faint)]">{dossier.gradeWhy.join(" · ")}</div></dd>
        </div>
        <div className="flex gap-3 px-4 py-2.5">
          <dt className="w-[92px] shrink-0 text-[var(--h-faint)]">Сайт</dt>
          <dd className="min-w-0"><span className={SITE[dossier.site.verdict].tone}>{SITE[dossier.site.verdict].label}</span><div className="text-xs text-[var(--h-faint)]">{dossier.site.why}</div></dd>
        </div>
        <div className="flex gap-3 px-4 py-2.5">
          <dt className="w-[92px] shrink-0 text-[var(--h-faint)]">Связь</dt>
          <dd className="min-w-0 break-words">
            {dossier.channels.length ? dossier.channels.map((item) => (
              <span key={`${item.kind}:${item.value}`} className={cx("mr-2 inline-block", item.direct ? "text-[var(--h-text)]" : "text-[var(--h-faint)]")}>{item.direct ? "● " : "○ "}{item.label}</span>
            )) : <span className="text-[var(--h-faint)]">нет</span>}
            <div className="text-xs text-[var(--h-faint)]">● — напрямую владельцу</div>
          </dd>
        </div>
        {dossier.lastPost ? (
          <div className="flex gap-3 px-4 py-2.5">
            <dt className="w-[92px] shrink-0 text-[var(--h-faint)]">Пост</dt>
            <dd className="min-w-0">
              <p className="line-clamp-3">{dossier.lastPost.text}</p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--h-faint)]">
                {dossier.lastPost.date ? dayLabel(dossier.lastPost.date) : null}
                {dossier.lastPost.link ? <a href={dossier.lastPost.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--h-accent)]">открыть <ExternalLink className="h-3 w-3" /></a> : null}
              </div>
            </dd>
          </div>
        ) : null}
        <div className="flex gap-3 px-4 py-2.5">
          <dt className="w-[92px] shrink-0 text-[var(--h-faint)]">Повод</dt>
          <dd className="min-w-0">{dossier.reason?.text ?? <span className="text-[var(--h-faint)]">не найден</span>}</dd>
        </div>
      </dl>
    </section>
  );
}
