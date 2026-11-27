"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, CircleHelp, FolderKanban, LayoutGrid, ListChecks, MessagesSquare, MoreHorizontal, Plus, Radar, Search, Workflow, Settings2, ShieldCheck, type LucideIcon } from "lucide-react";
import { IconButton, Sheet, ToastProvider, cx } from "./ui";
import { useLive } from "./data";
import { ROLE_LABEL } from "@/lib/domain/labels";
import type { Plan, PlanAction } from "./types";
import { GuidePanel } from "./guide-panel";
import { ItemPanel } from "./item-panel";
import { ProjectPanel } from "./project-panel";
import { ScenarioPanel } from "./scenario-panel";
import { SettingsPanel } from "./settings-panel";

export type HuntUser = { name: string; role: string; tenantName: string; isPlatformAdmin?: boolean };

type PanelKind = "item" | "project" | "scenario" | "panel";

type HuntContextValue = {
  user: HuntUser;
  version: number;
  refresh: () => void;
  open: (kind: PanelKind, id: string, replace?: boolean) => void;
  close: () => void;
};

const HuntContext = createContext<HuntContextValue | null>(null);

export function useHunt() {
  const value = useContext(HuntContext);
  if (!value) throw new Error("useHunt вне HuntShell");
  return value;
}

type NavItem = { href: string; label: string; hint: string; icon: LucideIcon; step?: number };

/** Путь клиента по шагам (найти → отобрать → написать → воронка) и разделы вокруг него. Как в CRM: группы в боковом меню. */
const WORK: NavItem[] = [
  { href: "/hunt/search", label: "Поиск", hint: "ниша и города", icon: Search, step: 1 },
  { href: "/hunt", label: "Отбор", hint: "план и карточки", icon: ListChecks, step: 2 },
  { href: "/hunt/dialogs", label: "Диалоги", hint: "написать и вести", icon: MessagesSquare, step: 3 },
  { href: "/hunt/pipeline", label: "Воронка", hint: "весь цикл по шагам", icon: Workflow, step: 4 },
];
const MORE: NavItem[] = [
  { href: "/hunt/radar", label: "Радар", hint: "запросы из чатов", icon: Radar },
  { href: "/hunt/projects", label: "Проекты", hint: "сделки и сроки", icon: FolderKanban },
  { href: "/hunt/stats", label: "Цифры", hint: "итоги и таблица", icon: BarChart3 },
];
const ALL = [...WORK, ...MORE];

function isActive(href: string, pathname: string) {
  return href === "/hunt" ? pathname === "/hunt" : pathname.startsWith(href);
}

const KIND_SHORT: Record<PlanAction["kind"], string> = { task: "Задача", dialog: "Ответить", day4: "День 4", day8: "День 8", write: "Написать", new: "Новая" };

/** «Ближайшие действия» в шапке: первые три пункта плана, одно касание — открыть карточку. */
function UpNext({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const plan = useLive<Plan>("/api/hunt/plan", version, 60000);
  const actions = plan.data?.actions.slice(0, 3) ?? [];
  if (!actions.length) return null;
  return (
    <div className="glass-panel hidden min-w-0 items-center gap-1 rounded-full p-1 xl:flex">
      <span className="shrink-0 px-3 text-[12px] font-medium text-[var(--h-muted)]">Ближайшее</span>
      {actions.map((item, index) => (
        <button
          key={item.key}
          onClick={() => onOpen(item.outreachId)}
          title={item.note}
          className={cx(
            "flex h-8 min-w-0 max-w-[220px] items-center gap-2 rounded-full px-3 text-[13px] transition",
            index === 0 ? "bg-[var(--h-accent)] font-medium text-[var(--h-accent-ink)]" : "bg-white/[0.07] text-[var(--h-text)] hover:bg-white/[0.12]",
          )}
        >
          <span className={cx("shrink-0 text-[11px] font-semibold uppercase tracking-wide", index === 0 ? "opacity-70" : "text-[var(--h-faint)]")}>{KIND_SHORT[item.kind]}</span>
          <span className="truncate">{item.name}</span>
        </button>
      ))}
      {plan.data && plan.data.total > 3 ? <Link href="/hunt" className="shrink-0 px-2.5 text-[12px] tabular-nums text-[var(--h-faint)] hover:text-[var(--h-text)]">+{plan.data.total - 3}</Link> : null}
    </div>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={`${item.label} — ${item.hint}`}
      className={cx(
        "group flex h-11 items-center gap-3 rounded-2xl px-2.5 text-[14px] font-medium transition max-lg:justify-center max-lg:px-0",
        active ? "bg-[var(--h-text)] text-[#111] shadow-[0_6px_20px_rgba(0,0,0,0.25)]" : "text-[var(--h-muted)] hover:bg-white/[0.07] hover:text-[var(--h-text)]",
      )}
    >
      <span className={cx("relative grid h-8 w-8 shrink-0 place-items-center rounded-xl transition", active ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : "bg-white/[0.06] group-hover:bg-white/[0.1]")}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.9} />
        {item.step ? <span className={cx("absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums lg:hidden", active ? "bg-[#111] text-[var(--h-accent)]" : "bg-white/20 text-[var(--h-text)]")}>{item.step}</span> : null}
      </span>
      <span className="min-w-0 flex-1 max-lg:hidden">
        <span className="block truncate leading-5">{item.label}</span>
        <span className={cx("block truncate text-[11px] font-normal leading-4", active ? "text-[#111]/55" : "text-[var(--h-faint)]")}>{item.hint}</span>
      </span>
      {item.step ? <span className={cx("text-[11px] font-semibold tabular-nums max-lg:hidden", active ? "text-[#111]/45" : "text-[var(--h-faint)]")}>{item.step}</span> : null}
    </Link>
  );
}

function SideButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} className="flex h-10 w-full items-center gap-3 rounded-2xl px-2.5 text-[14px] text-[var(--h-muted)] transition hover:bg-white/[0.07] hover:text-[var(--h-text)] max-lg:justify-center max-lg:px-0">
      <span className="grid h-8 w-8 shrink-0 place-items-center"><Icon className="h-[18px] w-[18px]" strokeWidth={1.9} /></span>
      <span className="truncate max-lg:hidden">{label}</span>
    </button>
  );
}

export function HuntShell({ user, children }: { user: HuntUser; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [version, setVersion] = useState(0);
  const [more, setMore] = useState(false);
  const openedHere = useRef(false);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const open = useCallback((kind: PanelKind, id: string, replace = false) => {
    const next = new URLSearchParams();
    next.set(kind, id);
    const url = `${pathname}?${next.toString()}`;
    // Переход из панели в панель (сценарий → проект, карточка → проект) заменяет шаг истории: «Назад» закрывает, а не листает панели.
    if (replace && openedHere.current) router.replace(url, { scroll: false });
    else {
      openedHere.current = true;
      router.push(url, { scroll: false });
    }
  }, [pathname, router]);

  const close = useCallback(() => {
    // Открыли панель здесь — «назад» закрывает её (и жест «назад» на телефоне тоже). Пришли по ссылке — просто убираем параметр.
    if (openedHere.current && window.history.length > 1) {
      openedHere.current = false;
      router.back();
    } else router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const value = useMemo(() => ({ user, version, refresh, open, close }), [user, version, refresh, open, close]);
  const item = params.get("item");
  const project = params.get("project");
  const scenario = params.get("scenario");
  const panel = params.get("panel");
  const current = ALL.find((tab) => isActive(tab.href, pathname));
  const inMore = MORE.some((tab) => isActive(tab.href, pathname));
  const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "LF";

  // Старые ссылки «?panel=search» ведут на шаг «Поиск».
  useEffect(() => {
    if (panel === "search") router.replace("/hunt/search");
  }, [panel, router]);
  useEffect(() => { setMore(false); }, [pathname]);

  return (
    <HuntContext.Provider value={value}>
      <div className="hunt hunt-glow min-h-[100dvh]">
        <ToastProvider>
          {/* Планшет и ПК: стеклянное боковое меню. Планшет — только иконки, ПК — с подписями и группами. */}
          <aside aria-label="Разделы" className="glass-panel fixed bottom-3 left-3 top-3 z-40 hidden w-[72px] flex-col rounded-[28px] p-2 md:flex lg:w-[244px] lg:p-3">
            <Link href="/hunt" className="mb-3 flex items-center gap-2.5 px-1 pt-1 max-lg:justify-center lg:px-1.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--h-accent)] text-sm font-bold text-[var(--h-accent-ink)] shadow-[0_6px_18px_rgba(242,220,107,0.25)]">LF</span>
              <span className="min-w-0 max-lg:hidden">
                <span className="block text-[17px] font-semibold leading-5 tracking-tight">LeadFlow</span>
                <span className="block truncate text-[12px] text-[var(--h-faint)]">{user.tenantName}</span>
              </span>
            </Link>
            <nav className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--h-faint)] max-lg:hidden">Рабочий цикл</p>
              {WORK.map((tab) => <SideLink key={tab.href} item={tab} active={isActive(tab.href, pathname)} />)}
              <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--h-faint)] max-lg:hidden">Каналы и итоги</p>
              <div className="my-2 h-px bg-[var(--h-line)] lg:hidden" />
              {MORE.map((tab) => <SideLink key={tab.href} item={tab} active={isActive(tab.href, pathname)} />)}
            </nav>
            <div className="mt-2 space-y-0.5 border-t border-[var(--h-line)] pt-2">
              <SideButton label="Настройки" icon={Settings2} onClick={() => open("panel", "settings")} />
              {user.isPlatformAdmin ? <SideButton label="Админка" icon={ShieldCheck} onClick={() => router.push("/admin")} /> : null}
              <SideButton label="Полная версия" icon={LayoutGrid} onClick={() => router.push("/overview")} />
              <div className="mt-2 flex items-center gap-2.5 rounded-2xl bg-white/[0.05] p-2 max-lg:justify-center max-lg:bg-transparent max-lg:p-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.12] text-[13px] font-semibold" title={user.name}>{initials}</span>
                <span className="min-w-0 max-lg:hidden">
                  <span className="block truncate text-[14px] font-semibold leading-5">{user.name}</span>
                  <span className="block truncate text-[12px] text-[var(--h-faint)]">{ROLE_LABEL[user.role] ?? user.role}</span>
                </span>
              </div>
            </div>
          </aside>

          <div className="md:pl-[84px] lg:pl-[256px]">
            <header className="sticky top-0 z-30 pt-[env(safe-area-inset-top)] backdrop-blur-xl max-md:bg-[rgba(12,18,22,0.55)] md:backdrop-blur-none">
              <div className="mx-auto flex h-[68px] max-w-[1440px] items-center gap-2 px-4 md:px-6">
                <Link href="/hunt" className="flex min-w-0 items-center gap-2.5 md:hidden">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--h-accent)] text-sm font-bold text-[var(--h-accent-ink)]">LF</span>
                  <span className="min-w-0 leading-tight"><span className="block truncate text-[16px] font-semibold">LeadFlow</span><span className="block truncate text-[11px] text-[var(--h-faint)]">{current?.step ? `шаг ${current.step} из 4 · ${current.hint}` : current?.hint ?? user.tenantName}</span></span>
                </Link>
                <div className="flex-1 md:hidden" />
                <div className="hidden min-w-0 flex-1 items-center md:flex">
                  <span className="glass-panel hidden items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-[var(--h-muted)] lg:inline-flex xl:hidden">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--h-ok)]" />{current?.label ?? "Охота"}{current?.step ? ` · шаг ${current.step} из 4` : ""}
                  </span>
                </div>
                <UpNext version={version} onOpen={(id) => open("item", id)} />
                <div className="hidden flex-1 md:block" />
                {pathname !== "/hunt/search" ? (
                  <Link href="/hunt/search" className="hidden h-10 shrink-0 items-center gap-1.5 rounded-full bg-[var(--h-accent)] px-4 text-[14px] font-semibold text-[var(--h-accent-ink)] transition hover:brightness-105 sm:inline-flex">
                    <Plus className="h-4 w-4" strokeWidth={2.6} /> Новый поиск
                  </Link>
                ) : null}
                <IconButton label="Как работает охота" onClick={() => open("panel", "guide")} className="h-10 w-10"><CircleHelp className="h-5 w-5" /></IconButton>
                <IconButton label="Настройки и интеграции" onClick={() => open("panel", "settings")} className="h-10 w-10 md:hidden"><Settings2 className="h-5 w-5" /></IconButton>
              </div>
            </header>

            <main className="mx-auto max-w-[1440px] px-4 pb-[calc(104px+env(safe-area-inset-bottom))] md:px-6 md:pb-16">{children}</main>
          </div>

          {/* Телефон: нижняя панель — четыре шага цикла и «Ещё». */}
          <nav aria-label="Разделы" className="glass-sheet fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
            <div className="mx-auto grid max-w-lg grid-cols-5">
              {WORK.map((tab) => {
                const on = isActive(tab.href, pathname);
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={on ? "page" : undefined}
                    className={cx("flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition active:scale-95", on ? "text-[var(--h-accent)]" : "text-[var(--h-muted)]")}
                  >
                    <span className={cx("grid h-8 w-12 place-items-center rounded-full transition", on && "bg-[var(--h-accent-soft)]")}>
                      <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.2 : 1.8} />
                    </span>
                    {tab.label}
                  </Link>
                );
              })}
              <button
                onClick={() => setMore(true)}
                aria-expanded={more}
                className={cx("flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition active:scale-95", inMore ? "text-[var(--h-accent)]" : "text-[var(--h-muted)]")}
              >
                <span className={cx("grid h-8 w-12 place-items-center rounded-full transition", inMore && "bg-[var(--h-accent-soft)]")}>
                  <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={inMore ? 2.2 : 1.8} />
                </span>
                {inMore ? MORE.find((tab) => isActive(tab.href, pathname))?.label : "Ещё"}
              </button>
            </div>
          </nav>

          <Sheet open={more} onClose={() => setMore(false)} title="Разделы" subtitle={`${user.name} · ${user.tenantName}`}>
            <div className="space-y-2">
              {MORE.map((tab) => {
                const Icon = tab.icon;
                const on = isActive(tab.href, pathname);
                return (
                  <Link key={tab.href} href={tab.href} className={cx("glass flex items-center gap-3 rounded-2xl px-4 py-3", on && "tint-yellow")}>
                    <Icon className="h-5 w-5 shrink-0 text-[var(--h-accent)]" />
                    <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold">{tab.label}</span><span className="block text-[13px] text-[var(--h-muted)]">{tab.hint}</span></span>
                  </Link>
                );
              })}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button onClick={() => { setMore(false); open("panel", "settings", true); }} className="glass flex h-12 items-center justify-center gap-2 rounded-2xl text-sm"><Settings2 className="h-4 w-4" /> Настройки</button>
                <button onClick={() => { setMore(false); open("panel", "guide", true); }} className="glass flex h-12 items-center justify-center gap-2 rounded-2xl text-sm"><CircleHelp className="h-4 w-4" /> Как работает</button>
                {user.isPlatformAdmin ? <Link href="/admin" className="glass flex h-12 items-center justify-center gap-2 rounded-2xl text-sm"><ShieldCheck className="h-4 w-4" /> Админка</Link> : null}
                <Link href="/overview" className="glass flex h-12 items-center justify-center gap-2 rounded-2xl text-sm"><LayoutGrid className="h-4 w-4" /> Полная версия</Link>
              </div>
            </div>
          </Sheet>

          {/* Одна панель за раз: ссылка вида ?item=a&project=b откроет только первую по важности. */}
          <ItemPanel id={item} />
          <ProjectPanel id={item ? null : project} />
          <ScenarioPanel id={item || project ? null : scenario} />
          <SettingsPanel open={!item && !project && !scenario && panel === "settings"} />
          <GuidePanel open={!item && !project && !scenario && panel === "guide"} />
        </ToastProvider>
      </div>
    </HuntContext.Provider>
  );
}
