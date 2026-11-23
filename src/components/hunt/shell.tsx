"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, CircleHelp, FolderKanban, House, LayoutGrid, MessagesSquare, Plus, Settings2 } from "lucide-react";
import { IconButton, ToastProvider, cx } from "./ui";
import { GuidePanel } from "./guide-panel";
import { ItemPanel } from "./item-panel";
import { ProjectPanel } from "./project-panel";
import { ScenarioPanel } from "./scenario-panel";
import { SearchPanel } from "./search-panel";
import { SettingsPanel } from "./settings-panel";

export type HuntUser = { name: string; role: string; tenantName: string };

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

const NAV = [
  { href: "/hunt", label: "Сегодня", icon: House },
  { href: "/hunt/dialogs", label: "Диалоги", icon: MessagesSquare },
  { href: "/hunt/projects", label: "Проекты", icon: FolderKanban },
  { href: "/hunt/stats", label: "Цифры", icon: BarChart3 },
] as const;

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

  return (
    <HuntContext.Provider value={value}>
      <div className="hunt hunt-glow min-h-[100dvh]">
        <ToastProvider>
          <header className="sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
            <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
              <Link href="/hunt" className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--h-accent)] text-sm font-bold text-[var(--h-accent-ink)]">LF</span>
                <span className="text-[15px] font-semibold">Охота</span>
              </Link>
              <div className="flex-1" />
              <IconButton label="Как работает охота" onClick={() => open("panel", "guide")}><CircleHelp className="h-5 w-5" /></IconButton>
              <IconButton label="Настройки охоты" onClick={() => open("panel", "settings")}><Settings2 className="h-5 w-5" /></IconButton>
              <IconButton label="Полная версия LeadFlow" onClick={() => router.push("/overview")}><LayoutGrid className="h-5 w-5" /></IconButton>
            </div>
          </header>

          <main className="mx-auto max-w-3xl px-4 pb-[calc(120px+env(safe-area-inset-bottom))]">{children}</main>

          <nav aria-label="Разделы" className="fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 flex justify-center px-3">
            <div className="flex items-center gap-2">
              <div className="glass-strong flex items-center gap-1 rounded-full p-1.5">
                {NAV.map((tab) => {
                  const on = tab.href === "/hunt" ? pathname === "/hunt" : pathname.startsWith(tab.href);
                  const Icon = tab.icon;
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      aria-label={tab.label}
                      aria-current={on ? "page" : undefined}
                      className={cx(
                        "flex h-12 items-center justify-center gap-2 rounded-full transition-all duration-200",
                        on ? "bg-[var(--h-text)] px-3.5 text-[#111] max-[359px]:w-12 max-[359px]:px-0" : "w-11 text-[var(--h-muted)] hover:bg-white/10 hover:text-[var(--h-text)] min-[360px]:w-12",
                      )}
                    >
                      <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.2 : 1.8} />
                      {on ? <span className="text-[15px] font-semibold max-[359px]:hidden">{tab.label}</span> : null}
                    </Link>
                  );
                })}
              </div>
              <button
                aria-label="Новый поиск"
                onClick={() => open("panel", "search")}
                className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[var(--h-accent)] min-[360px]:h-[60px] min-[360px]:w-[60px] text-[var(--h-accent-ink)] shadow-[0_10px_30px_rgba(255,214,10,0.35)] transition hover:brightness-105 active:scale-95"
              >
                <Plus className="h-7 w-7" strokeWidth={2.4} />
              </button>
            </div>
          </nav>

          {/* Одна панель за раз: ссылка вида ?item=a&project=b откроет только первую по важности. */}
          <ItemPanel id={item} />
          <ProjectPanel id={item ? null : project} />
          <ScenarioPanel id={item || project ? null : scenario} />
          <SearchPanel open={!item && !project && !scenario && panel === "search"} />
          <SettingsPanel open={!item && !project && !scenario && panel === "settings"} />
          <GuidePanel open={!item && !project && !scenario && panel === "guide"} />
        </ToastProvider>
      </div>
    </HuntContext.Provider>
  );
}
