"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, Search, X } from "lucide-react";

/** Компоненты охоты: стекло, один акцент, шкала 4px, области нажатия от 44px. */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "yellow" | "orange" | "pink" | "blue" | "green" | "violet";

export function Glass({ children, className, tint, strong, onClick }: { children: ReactNode; className?: string; tint?: Tone | null; strong?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cx(strong ? "glass-strong" : "glass", tint && `tint-${tint}`, "rounded-[var(--h-radius)]", className)}>
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "accent" | "glass" | "ghost" | "danger" | "light"; size?: "lg" | "md" | "sm"; pending?: boolean };

export function Button({ variant = "glass", size = "md", pending, className, children, ...props }: ButtonProps) {
  const styles = {
    accent: "bg-[var(--h-accent)] text-[var(--h-accent-ink)] hover:brightness-105 active:brightness-95 font-semibold",
    light: "bg-[var(--h-text)] text-[#111] hover:brightness-95 font-semibold",
    glass: "glass text-[var(--h-text)] hover:bg-white/10",
    ghost: "text-[var(--h-muted)] hover:text-[var(--h-text)] hover:bg-white/5",
    danger: "bg-[rgba(255,100,100,0.14)] text-[#ff8a8a] border border-[rgba(255,100,100,0.3)] hover:bg-[rgba(255,100,100,0.2)]",
  }[variant];
  const sizes = { lg: "h-14 px-6 text-base rounded-2xl", md: "h-11 px-4 text-[15px] rounded-full md:h-10 md:text-sm", sm: "h-9 px-3 text-sm rounded-full md:h-8 md:text-[13px]" }[size];
  return (
    <button {...props} disabled={props.disabled || pending} className={cx("inline-flex items-center justify-center gap-2 whitespace-nowrap transition duration-150 disabled:cursor-not-allowed disabled:opacity-45", styles, sizes, className)}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, dot, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; dot?: boolean }) {
  return (
    <button {...props} aria-label={label} title={label} className={cx("glass relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--h-text)] transition hover:bg-white/10 disabled:opacity-40", className)}>
      {children}
      {dot ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--h-accent)]" /> : null}
    </button>
  );
}

export function Segmented<T extends string>({ items, value, onChange, className }: { items: { key: T; label: string; count?: number; alert?: boolean }[]; value: T; onChange: (key: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx("glass no-scrollbar flex gap-0.5 overflow-x-auto rounded-full p-1", className)}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(item.key)}
            className={cx("flex h-10 flex-auto shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition sm:gap-1.5 sm:px-3.5 sm:text-sm md:h-9", on ? "bg-[var(--h-text)] text-[#111]" : "text-[var(--h-muted)] hover:text-[var(--h-text)]")}
          >
            <span>{item.label}</span>
            {item.count != null ? (
              <span className={cx("tabular-nums", on ? "text-[#111]/55" : item.alert && item.count ? "text-[var(--h-hot)]" : "text-[var(--h-faint)]")}>{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ active, children, onClick, className, disabled }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition disabled:opacity-45 md:h-8 md:px-3 md:text-[13px]",
        active ? "border-transparent bg-[var(--h-accent)] font-medium text-[var(--h-accent-ink)]" : "border-[var(--h-line)] bg-white/[0.03] text-[var(--h-text)] hover:bg-white/[0.07]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PriorityBadge({ priority, score }: { priority: string; score: number }) {
  const tone = priority === "A" ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : priority === "B" ? "bg-[rgba(255,145,87,0.2)] text-[#ffbe98]" : "bg-white/10 text-[var(--h-muted)]";
  return (
    <span className={cx("inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold tabular-nums md:h-6 md:px-2 md:text-[12px]", tone)}>
      {priority}
      <span className="font-medium opacity-70">{score}</span>
    </span>
  );
}

export function Ring({ done, total, size = 44, label }: { done: number; total: number; size?: number; label?: string }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const part = total ? Math.min(1, done / total) : 0;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-label={label ?? `${done} из ${total}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={part >= 1 ? "var(--h-ok)" : "var(--h-accent)"} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c * part} ${c}`} />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums">{done}/{total}</span>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[var(--h-muted)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[var(--h-faint)]">{hint}</span> : null}
    </label>
  );
}

export const inputClass = "h-12 w-full rounded-2xl border border-[var(--h-line)] bg-white/[0.04] px-4 text-base outline-none transition focus:border-[var(--h-accent)] focus:bg-white/[0.06]";
export const textareaClass = "w-full rounded-2xl border border-[var(--h-line)] bg-white/[0.04] p-4 text-base leading-6 outline-none transition focus:border-[var(--h-accent)]";

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, index) => <div key={index} className="skeleton h-[76px] rounded-[var(--h-radius)]" />)}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <Glass className="px-6 py-10 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--h-muted)]">{text}</p>
      {action ? <div className="mt-5 flex flex-col items-center gap-2">{action}</div> : null}
    </Glass>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "warn" | "ok"; children: ReactNode }) {
  const styles = {
    info: "border-[rgba(138,184,255,0.3)] bg-[rgba(138,184,255,0.08)] text-[#cfe0ff]",
    error: "border-[rgba(255,100,100,0.3)] bg-[rgba(255,100,100,0.1)] text-[#ffb3b3]",
    warn: "border-[rgba(255,145,87,0.3)] bg-[rgba(255,145,87,0.1)] text-[#ffc3a6]",
    ok: "border-[rgba(59,224,138,0.3)] bg-[rgba(59,224,138,0.08)] text-[#b5f5d2]",
  }[tone];
  return <div className={cx("rounded-2xl border px-4 py-3 text-sm leading-5", styles)}>{children}</div>;
}

/* ───────────── Каркас страницы: заголовок, полоса цифр, заголовок блока, поиск ───────────── */

/** Заголовок как в CRM: крупное название, рядом мелкая подпись (дата, шаг), справа действия страницы. */
export function PageHeader({ title, subtitle, eyebrow, actions }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pt-1">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[13px] text-[var(--h-faint)] first-letter:uppercase">{eyebrow}</p> : null}
        <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[28px] font-semibold leading-[34px] tracking-tight md:text-[34px] md:leading-[40px]">
          <span className="min-w-0 break-words">{title}</span>
          {subtitle ? <span className="text-[14px] font-medium leading-5 tracking-normal text-[var(--h-muted)] first-letter:uppercase">{subtitle}</span> : null}
        </h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Stat = { label: string; value: ReactNode; sub?: ReactNode; tone?: "hot" | "ok" | "accent" | null; onClick?: () => void; active?: boolean };

/** Полоса цифр в одной стеклянной карточке с разделителями — как «Активность сегодня». На телефоне 2×2. */
export function StatStrip({ title, items, action }: { title?: ReactNode; items: Stat[]; action?: ReactNode }) {
  return (
    <section>
      {title || action ? <SectionTitle title={title} action={action} /> : null}
      <div className="glass overflow-hidden rounded-[var(--h-radius)]">
        {/* Разделители: у каждой ячейки рамка слева и сверху, сетка сдвинута на 1px — лишние линии уходят за край. */}
        <div className={cx("-ml-px -mt-px grid", items.length > 3 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3")}>
        {items.map((item) => {
          const Tag = item.onClick ? "button" : "div";
          return (
            <Tag
              key={item.label}
              type={item.onClick ? "button" : undefined}
              onClick={item.onClick}
              aria-pressed={item.onClick ? Boolean(item.active) : undefined}
              className={cx(
                "relative min-w-0 border-l border-t border-[var(--h-line)] px-4 py-3.5 text-left transition md:px-5 md:py-4",
                item.onClick && "hover:bg-white/[0.05]",
                item.active && "bg-white/[0.06]",
              )}
            >
              <div className={cx("text-[28px] font-semibold leading-8 tracking-tight tabular-nums md:text-[34px] md:leading-10", item.tone === "hot" && "text-[var(--h-hot)]", item.tone === "ok" && "text-[var(--h-ok)]", item.tone === "accent" && "text-[var(--h-accent)]")}>{item.value}</div>
              <div className="mt-0.5 truncate text-[13px] text-[var(--h-muted)]">{item.label}</div>
              {item.sub ? <div className="truncate text-[12px] text-[var(--h-faint)]">{item.sub}</div> : null}
              {item.active ? <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[var(--h-accent)]" /> : null}
            </Tag>
          );
        })}
        </div>
      </div>
    </section>
  );
}

/** Заголовок блока: название, счётчик в кружке, справа ссылка или переключатель. */
export function SectionTitle({ title, count, action, className }: { title?: ReactNode; count?: number | null; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-2.5 flex min-h-8 items-center justify-between gap-3 px-1", className)}>
      <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
        {title}
        {count != null ? <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/[0.12] px-1.5 text-[12px] font-semibold tabular-nums text-[var(--h-text)]">{count}</span> : null}
      </h2>
      {action ? <div className="flex shrink-0 items-center gap-2 text-[13px] text-[var(--h-muted)]">{action}</div> : null}
    </div>
  );
}

/** Поле поиска-пилюля с крестиком очистки. */
export function SearchInput({ value, onChange, placeholder = "Найти", className, label }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string; label?: string }) {
  return (
    <label className={cx("relative block", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--h-faint)]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="h-10 w-full rounded-full border border-[var(--h-line)] bg-white/[0.05] pl-10 pr-9 text-base outline-none transition placeholder:text-[var(--h-faint)] focus:border-[var(--h-accent)] focus:bg-white/[0.07] sm:text-sm"
      />
      {value ? (
        <button type="button" aria-label="Очистить" onClick={() => onChange("")} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[var(--h-faint)] hover:bg-white/10 hover:text-[var(--h-text)]">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </label>
  );
}

export const selectClass = "[color-scheme:dark] h-10 max-w-full rounded-full border border-[var(--h-line)] bg-white/[0.05] px-3.5 text-base outline-none transition hover:bg-white/[0.07] focus:border-[var(--h-accent)] sm:text-sm";

/** Переключатель вида (доска / список / сроки) — маленький, для правого угла заголовка. */
export function ViewSwitch<T extends string>({ items, value, onChange }: { items: { key: T; label: string; icon?: ReactNode }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div role="tablist" className="glass flex gap-0.5 rounded-full p-1">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={item.key === value}
          onClick={() => onChange(item.key)}
          className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition", item.key === value ? "bg-[var(--h-text)] text-[#111]" : "text-[var(--h-muted)] hover:text-[var(--h-text)]")}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Панель: справа на планшете и ПК, снизу на телефоне ───────────── */

export function Sheet({ open, onClose, title, subtitle, badge, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeRef.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      // Фокус не уходит за пределы панели, пока она открыта.
      const focusable = panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      trigger?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button aria-hidden="true" tabIndex={-1} onClick={onClose} className="anim-fade absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cx(
          "glass-sheet absolute flex flex-col outline-none",
          "anim-sheet inset-x-0 bottom-0 max-h-[94dvh] rounded-t-[28px]",
          "md:inset-y-3 md:left-auto md:right-3 md:max-h-none md:w-[480px] md:rounded-[28px]",
        )}
        aria-label={typeof title === "string" ? title : undefined}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/20 md:hidden" />
        <header className="flex items-start gap-3 px-5 pb-3 pt-3 md:pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[22px] font-semibold leading-7 tracking-tight [overflow-wrap:anywhere]">{title}</h2>
            {subtitle ? <div className="mt-1 text-sm text-[var(--h-muted)]">{subtitle}</div> : null}
          </div>
          {badge}
          <IconButton label="Закрыть" onClick={onClose} className="h-10 w-10"><X className="h-5 w-5" /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
        {footer ? <footer className="border-t border-[var(--h-line)] px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ───────────── Тосты с «Отменить» ───────────── */

type Toast = { id: number; text: string; tone?: "ok" | "error"; action?: { label: string; run: () => void } };
const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = useCallback((next: Omit<Toast, "id">) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...next, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), next.action ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {toast ? (
        <div role="status" className="anim-toast glass-sheet fixed bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3 text-sm">
          <span className={cx("h-2 w-2 shrink-0 rounded-full", toast.tone === "error" ? "bg-[var(--h-danger)]" : "bg-[var(--h-ok)]")} />
          <span className="min-w-0 flex-1">{toast.text}</span>
          {toast.action ? (
            <button className="shrink-0 font-semibold text-[var(--h-accent)]" onClick={() => { toast.action?.run(); setToast(null); }}>{toast.action.label}</button>
          ) : null}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function errorText(reason: unknown, fallback = "Не получилось") {
  return reason instanceof Error ? reason.message : fallback;
}
