"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Bot,
  Building2,
  ChartColumn,
  Crosshair,
  Inbox,
  Globe,
  Kanban,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  Monitor,
  Plug,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { NAV, ROLE_LABEL } from "@/lib/domain/labels";
import { api } from "@/lib/client";
import { cnJoin } from "./ui";

const ICONS = { LayoutDashboard, Crosshair, Bot, Search, Building2, Users, Sparkles, Globe, Monitor, Kanban, MessagesSquare, Ban, Megaphone, Workflow, ChartColumn, UserRound, Plug, Settings, ScrollText };

const TABS = [
  { href: "/hunt", label: "Сегодня", icon: Crosshair, exact: true },
  { href: "/hunt/dialogs", label: "Диалоги", icon: Inbox, exact: false },
  { href: "/hunt/search", label: "Охота", icon: Search, exact: false },
  { href: "/hunt/stats", label: "Цифры", icon: ChartColumn, exact: false },
] as const;

export type ShellUser = { name: string; email: string; role: string; tenantId: string; tenantName: string };

export function Shell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ organizations: { id: string; name: string; city: string | null }[]; sites: { id: string; name: string }[] } | null>(null);
  const [notes, setNotes] = useState<{ id: string; title: string; body: string; href: string | null; readAt: string | null }[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [integrations, setIntegrations] = useState<{ status: string }[]>([]);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    api<{ status: string }[]>("/api/integrations").then(setIntegrations).catch(() => setIntegrations([]));
    api<{ id: string; title: string; body: string; href: string | null; readAt: string | null }[]>("/api/notifications").then(setNotes).catch(() => undefined);
  }, [pathname]);

  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); return; }
    const timer = setTimeout(() => { api<typeof hits>("/api/search?q=" + encodeURIComponent(query)).then(setHits).catch(() => setHits(null)); }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const unread = notes.filter((item) => !item.readAt).length;
  const connected = integrations.filter((item) => item.status === "connected").length;
  const current = useMemo(() => NAV.find((item) => item.href === "/" ? pathname === "/" : pathname.startsWith(item.href))?.label ?? "LeadFlow", [pathname]);
  const tabActive = (tab: (typeof TABS)[number]) => (tab.exact ? pathname === tab.href || (/^\/hunt\/[^/]+$/.test(pathname) && !TABS.some((item) => item.href === pathname)) : pathname.startsWith(tab.href));

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex h-full flex-col bg-slate-950 text-slate-200">
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-teal-700 text-sm font-bold text-white">LF</div>
        <div>
          <div className="text-sm font-semibold text-white">LeadFlow</div>
          <div className="text-xs text-slate-400">Поиск и демо-сайты</div>
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {NAV.map((item) => {
          const Icon = ICONS[item.icon as keyof typeof ICONS];
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={cnJoin("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition", active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5")}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );

  const agentScreen = pathname.startsWith("/agent");

  return (
    <div className="h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden h-screen lg:block">{nav}</aside>
      {open ? <div className="fixed inset-0 z-40 lg:hidden"><button className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-label="Закрыть меню" /><div className="relative h-full w-72">{nav}<button className="absolute right-3 top-4 text-white" onClick={() => setOpen(false)}><X /></button></div></div> : null}
      <div className="flex h-[100dvh] min-w-0 flex-col">
        <header className="z-30 flex shrink-0 items-center gap-3 border-b border-line bg-white/90 px-4 py-3 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Открыть меню"><Menu /></button>
          <div className="hidden min-w-0 sm:block">
            <div className="truncate text-sm font-semibold">{user.tenantName}</div>
            <div className="text-xs text-slate-500">{current}</div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск организаций и сайтов" className="w-full rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm" />
            {hits ? <div className="absolute z-20 mt-1 w-full rounded-xl border border-line bg-white p-2 shadow-card">
              {hits.organizations.map((item) => <Link key={item.id} href={`/organizations/${item.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{item.name} <span className="text-slate-500">{item.city}</span></Link>)}
              {hits.sites.map((item) => <Link key={item.id} href={`/sites/${item.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{item.name}</Link>)}
              {!hits.organizations.length && !hits.sites.length ? <div className="px-2 py-2 text-sm text-slate-500">Ничего не найдено</div> : null}
            </div> : null}
          </div>
          <button className="hidden rounded-lg border border-line px-2 py-1 text-xs sm:inline-block" onClick={() => router.push("/integrations")}>{connected} подключено</button>
          <button className="relative rounded-lg border border-line px-2 py-1 text-sm" onClick={() => setNoteOpen((value) => !value)} aria-label="Уведомления">
            {unread > 0 ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-teal-700 px-1 text-[10px] text-white">{unread}</span> : null}
            ●
          </button>
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="text-xs text-slate-500">{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
          <button onClick={logout} aria-label="Выйти"><LogOut className="h-4 w-4" /></button>
        </header>
        {noteOpen ? <div className="border-b border-line bg-white px-4 py-3">
          {notes.length === 0 ? <p className="text-sm text-slate-500">Уведомлений нет</p> : notes.slice(0, 6).map((item) => <Link key={item.id} href={item.href || "/"} className="block py-1 text-sm"><b>{item.title}.</b> {item.body}</Link>)}
          <button className="mt-2 text-xs text-teal-800" onClick={() => api("/api/notifications/read", { method: "POST" }).then(() => setNotes(notes.map((item) => ({ ...item, readAt: new Date().toISOString() }))))}>Отметить прочитанными</button>
        </div> : null}
        <main className={cnJoin("flex min-h-0 flex-1 flex-col px-4 lg:px-6", agentScreen ? "overflow-hidden py-3" : "overflow-y-auto py-6 pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-6")}>{children}</main>
        {agentScreen ? null : (
          <nav aria-label="Охота" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
            <div className="mx-auto grid h-16 max-w-xl grid-cols-5">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const on = tabActive(tab);
                return (
                  <Link key={tab.href} href={tab.href} className={cnJoin("flex flex-col items-center justify-center gap-1 text-[11px] font-medium", on ? "text-teal-800" : "text-slate-500")}>
                    <span className={cnJoin("grid h-7 w-12 place-items-center rounded-full", on ? "bg-teal-50" : "")}><Icon className="h-[22px] w-[22px]" strokeWidth={1.9} /></span>
                    {tab.label}
                  </Link>
                );
              })}
              <button onClick={() => setOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500">
                <span className="grid h-7 w-12 place-items-center rounded-full"><Menu className="h-[22px] w-[22px]" strokeWidth={1.9} /></span>
                Ещё
              </button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
