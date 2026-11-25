"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, ChevronRight, CircleHelp, FolderKanban, LayoutGrid, ListChecks, MessagesSquare, Search, Workflow, Settings2, ShieldCheck } from "lucide-react";
import { IconButton, ToastProvider, cx } from "./ui";
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

/** Путь клиента по шагам: найти → отобрать → написать и вести диалог → проект → цифры. На ПК — меню сверху, на телефоне — снизу. */
const NAV = [
  { href: "/hunt/search", label: "Поиск", hint: "ниша и города", icon: Search },
  { href: "/hunt", label: "Отбор", hint: "скоринг и карточки", icon: ListChecks },
  { href: "/hunt/dialogs", label: "Диалоги", hint: "написать и вести", icon: MessagesSquare },
  { href: "/hunt/pipeline", label: "Воронка", hint: "весь цикл по шагам", icon: Workflow },
  { href: "/hunt/projects", label: "Проекты", hint: "сделки и демо", icon: FolderKanban },
  { href: "/hunt/stats", label: "Цифры", hint: "воронка и таблица", icon: BarChart3 },
] as const;

function isActive(href: string, pathname: string) {
  return href === "/hunt" ? pathname === "/hunt" : pathname.startsWith(href);
}

export function HuntShell({ user, children }: { user: HuntUser; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [version, setVersion] = useState(0);
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

  // Старые ссылки «?panel=search» ведут на шаг «Поиск».
  useEffect(() => {
    if (panel === "search") router.replace("/hunt/search");
  }, [panel, router]);

  return (
    <HuntContext.Provider value={value}>
      <div className="hunt hunt-glow min-h-[100dvh]">
        <ToastProvider>
          <header className="sticky top-0 z-30 border-b border-transparent pt-[env(safe-area-inset-top)] backdrop-blur-xl md:border-[var(--h-line)] md:bg-[rgba(11,11,13,0.72)]">
            <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 md:max-w-6xl md:gap-4">
              <Link href="/hunt" className="flex shrink-0 items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--h-accent)] text-sm font-bold text-[var(--h-accent-ink)]">LF</span>
                <span className="text-[15px] font-semibold md:max-lg:hidden">Охота</span>
              </Link>

              {/* ПК: шаги пути клиента сверху, как меню. */}
              <nav aria-label="Шаги" className="hidden min-w-0 flex-1 items-center justify-center md:flex">
                {NAV.map((tab, index) => {
                  const on = isActive(tab.href, pathname);
                  const Icon = tab.icon;
                  return (
                    <div key={tab.href} className="flex items-center">
                      {index ? <ChevronRight className="mx-0.5 h-4 w-4 shrink-0 text-[var(--h-faint)] lg:mx-1" /> : null}
                      <Link
                        href={tab.href}
                        aria-current={on ? "page" : undefined}
                        title={tab.hint}
                        className={cx(
                          "flex h-11 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-sm font-medium transition",
                          on ? "bg-[var(--h-text)] text-[#111]" : "text-[var(--h-muted)] hover:bg-white/10 hover:text-[var(--h-text)]",
                        )}
                      >
                        <span className={cx("grid h-8 w-8 place-items-center rounded-full text-xs font-semibold tabular-nums", on ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : "bg-white/10")}>
                          <span className="lg:hidden"><Icon className="h-4 w-4" /></span>
                          <span className="max-lg:hidden">{index + 1}</span>
                        </span>
                        <span className="leading-tight">
                          {tab.label}
                          <span className={cx("block text-[11px] font-normal max-lg:hidden", on ? "text-[#111]/55" : "text-[var(--h-faint)]")}>{tab.hint}</span>
                        </span>
                      </Link>
                    </div>
                  );
                })}
              </nav>

              <div className="flex-1 md:hidden" />
              <IconButton label="Как работает охота" onClick={() => open("panel", "guide")}><CircleHelp className="h-5 w-5" /></IconButton>
              <IconButton label="Настройки и интеграции" onClick={() => open("panel", "settings")}><Settings2 className="h-5 w-5" /></IconButton>
              {user.isPlatformAdmin ? <IconButton label="Админка: люди и доступы" onClick={() => router.push("/admin")}><ShieldCheck className="h-5 w-5" /></IconButton> : null}
              <IconButton label="Полная версия LeadFlow" onClick={() => router.push("/overview")}><LayoutGrid className="h-5 w-5" /></IconButton>
            </div>
          </header>

          <main className="mx-auto max-w-3xl px-4 pb-[calc(104px+env(safe-area-inset-bottom))] md:max-w-6xl md:pb-16 md:pt-4">{children}</main>

          {/* Телефон: нижняя панель вкладок, как в приложении. */}
          <nav aria-label="Разделы" className="glass-sheet fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
            <div className="mx-auto grid max-w-lg grid-cols-6">
              {NAV.map((tab) => {
                const on = isActive(tab.href, pathname);
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={on ? "page" : undefined}
                    className={cx("flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition active:scale-95", on ? "text-[var(--h-accent)]" : "text-[var(--h-muted)]")}
                  >
                    <span className={cx("grid h-8 w-12 place-items-center rounded-full transition", on && "bg-[rgba(255,214,10,0.16)]")}>
                      <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.2 : 1.8} />
                    </span>
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          </nav>

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
