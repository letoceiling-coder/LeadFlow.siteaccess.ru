"use client";

import type { ReactNode } from "react";
import { MapPin, Star } from "lucide-react";
import { PriorityBadge, cx } from "./ui";
import { SEGMENT_TONE, hookOf, type HuntItem } from "./types";

/** Строка-карточка в стиле «Up next»: тонированная по приоритету, одно касание — открыть панель. */
export function ItemCard({ item, onOpen, meta, actions }: { item: HuntItem; onOpen: () => void; meta?: ReactNode; actions?: ReactNode }) {
  const grade = item.grade ?? item.priority;
  const tint = grade === "A" ? "tint-yellow" : grade === "B" ? "tint-orange" : "";
  const hook = (item.hook && item.hook !== "NOT_FOUND" ? item.hook : null) ?? hookOf(item.card) ?? item.card?.chaos[0]?.text ?? item.organization.category;
  const tone = item.segment ? SEGMENT_TONE[item.segment] : null;
  return (
    <div className={cx("glass flex items-stretch rounded-[24px] transition hover:bg-white/[0.07]", tint)}>
      <button onClick={onOpen} className="min-w-0 flex-1 px-4 py-3.5 text-left">
        <div className="flex items-center gap-2">
          <span className="line-clamp-2 text-[17px] font-semibold leading-6">{item.organization.name}</span>
        </div>
        {hook ? <p className="mt-0.5 line-clamp-2 text-[15px] leading-[21px] text-[var(--h-muted)]">{hook}</p> : null}
        {item.card?.money[0] ? <p className="mt-1 truncate text-[13px] text-[#8ff0bd]">₽ {item.card.money[0].text}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--h-faint)]">
          {meta ?? (
            <>
              {item.organization.city ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{item.organization.city}</span> : null}
              {item.organization.reviewCount != null ? <span className="inline-flex items-center gap-1 tabular-nums"><Star className="h-3.5 w-3.5" />{item.organization.rating ?? "—"} · {item.organization.reviewCount}</span> : null}
              {item.presetLabel || item.segmentLabel ? <span className={cx("rounded-full border px-2 py-0.5", tone && `tint-${tone}`)}>{item.presetLabel ?? item.segmentLabel}</span> : null}
            </>
          )}
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end justify-between gap-2 py-3.5 pr-3">
        <PriorityBadge priority={grade} score={item.score} />
        {actions}
      </div>
    </div>
  );
}
