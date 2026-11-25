"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Bell,
  Bot,
  Building2,
  ChartColumn,
  Crosshair,
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
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { NAV, ROLE_LABEL } from "@/lib/domain/labels";
import { api } from "@/lib/client";
import { cnJoin } from "./ui";

const ICONS = { LayoutDashboard, Crosshair, Bot, Search, Building2, Users, Sparkles, Globe, Monitor, Kanban, MessagesSquare, Ban, Megaphone, Workflow, ChartColumn, UserRound, Plug, Settings, ScrollText, ShieldCheck };

export type ShellUser = { name: string; email: string; role: string; tenantId: string; tenantName: string; isPlatformAdmin?: boolean };

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
  const current = useMemo(() => (pathname.startsWith("/admin") ? "Админка" : NAV.find((item) => pathname.startsWith(item.href))?.label ?? "LeadFlow"), [pathname]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex h-full flex-col border-r border-line bg-slate-950 text-slate-200">
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-teal-700 text-sm font-bold text-white">LF</div>
        <div>
          <div className="text-sm font-semibold text-white">LeadFlow</div>
          <div className="text-xs text-slate-400">Полная версия</div>
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {[...NAV, ...(user.isPlatformAdmin ? [{ href: "/admin", label: "Админка", icon: "ShieldCheck" }] : [])].map((item) => {
          const Icon = ICONS[item.icon as keyof typeof ICONS];
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={cnJoin("flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-[15px] transition", item.href === "/hunt" ? "mb-2 bg-teal-700 font-semibold" : active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5")}>
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
    <div className="hunt hunt-glow lf-dark h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden h-screen lg:block">{nav}</aside>
      {open ? <div className="fixed inset-0 z-40 lg:hidden"><button className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-label="Закрыть меню" /><div className="relative h-full w-72">{nav}<button className="absolute right-3 top-4 text-white" onClick={() => setOpen(false)}><X /></button></div></div> : null}
      <div className="flex h-[100dvh] min-w-0 flex-col">
        <header className="z-30 flex shrink-0 items-center gap-2 border-b border-line bg-white/90 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur sm:gap-3">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Открыть меню"><Menu /></button>
          <div className="hidden min-w-0 sm:block">
            <div className="truncate text-sm font-semibold">{user.tenantName}</div>
            <div className="text-xs text-slate-500">{current}</div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" aria-label="Поиск организаций и сайтов" className="h-9 w-full rounded-full border border-line bg-slate-50 px-3.5 text-base sm:text-sm" />
            {hits ? <div className="absolute z-20 mt-1 w-full rounded-xl border border-line bg-white p-2 shadow-card">
              {hits.organizations.map((item) => <Link key={item.id} href={`/organizations/${item.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{item.name} <span className="text-slate-500">{item.city}</span></Link>)}
              {hits.sites.map((item) => <Link key={item.id} href={`/sites/${item.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{item.name}</Link>)}
              {!hits.organizations.length && !hits.sites.length ? <div className="px-2 py-2 text-sm text-slate-500">Ничего не найдено</div> : null}
            </div> : null}
          </div>
          <Link href="/hunt" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-teal-700 px-3 text-sm font-semibold"><Crosshair className="h-4 w-4" /><span className="max-[359px]:hidden">Охота</span></Link>
          <button className="hidden rounded-lg border border-line px-2 py-1 text-xs sm:inline-block" onClick={() => router.push("/integrations")}>{connected} подключено</button>
          <button className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line" onClick={() => setNoteOpen((value) => !value)} aria-label="Уведомления">
            {unread > 0 ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-teal-700 px-1 text-[10px] text-white">{unread}</span> : null}
            <Bell className="h-4 w-4" />
          </button>
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="text-xs text-slate-500">{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
          <button onClick={logout} aria-label="Выйти" className="grid h-9 w-9 shrink-0 place-items-center rounded-full"><LogOut className="h-4 w-4" /></button>
        </header>
        {noteOpen ? <div className="border-b border-line bg-white px-4 py-3">
          {notes.length === 0 ? <p className="text-sm text-slate-500">Уведомлений нет</p> : notes.slice(0, 6).map((item) => <Link key={item.id} href={item.href || "/"} className="block py-1 text-sm"><b>{item.title}.</b> {item.body}</Link>)}
          <button className="mt-2 text-xs text-teal-800" onClick={() => api("/api/notifications/read", { method: "POST" }).then(() => setNotes(notes.map((item) => ({ ...item, readAt: new Date().toISOString() }))))}>Отметить прочитанными</button>
        </div> : null}
        <main className={cnJoin("flex min-h-0 flex-1 flex-col px-4 lg:px-6", agentScreen ? "overflow-hidden py-3" : "overflow-y-auto py-6")}>{children}</main>
      </div>
    </div>
  );
}
