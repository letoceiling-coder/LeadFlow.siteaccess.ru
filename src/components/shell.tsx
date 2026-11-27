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
    <nav className="glass-panel flex h-full flex-col rounded-[28px] p-3 text-[var(--h-text)]">
      <Link href="/hunt" className="flex items-center gap-3 px-1.5 pb-4 pt-1">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--h-accent)] text-sm font-bold text-[var(--h-accent-ink)]">LF</div>
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-5 tracking-tight">LeadFlow</div>
          <div className="truncate text-xs text-[var(--h-faint)]">Полная версия · {user.tenantName}</div>
        </div>
      </Link>
      <div className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto pb-2">
        {[...NAV, ...(user.isPlatformAdmin ? [{ href: "/admin", label: "Админка", icon: "ShieldCheck" }] : [])].map((item) => {
          const Icon = ICONS[item.icon as keyof typeof ICONS];
          const active = pathname.startsWith(item.href);
          const hunt = item.href === "/hunt";
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cnJoin(
                "flex min-h-10 items-center gap-3 rounded-2xl px-2.5 py-1.5 text-[14px] font-medium transition",
                hunt ? "mb-2 bg-[var(--h-accent)] text-[var(--h-accent-ink)] hover:brightness-105" : active ? "bg-[var(--h-text)] text-[#111]" : "text-[var(--h-muted)] hover:bg-white/[0.07] hover:text-[var(--h-text)]",
              )}
            >
              <span className={cnJoin("grid h-7 w-7 shrink-0 place-items-center rounded-xl", hunt ? "bg-black/10" : active ? "bg-[var(--h-accent)] text-[var(--h-accent-ink)]" : "bg-white/[0.06]")}><Icon className="h-4 w-4" /></span>
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5 rounded-2xl bg-white/[0.05] p-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.12] text-[13px] font-semibold">{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-5">{user.name}</span>
          <span className="block truncate text-[12px] text-[var(--h-faint)]">{ROLE_LABEL[user.role] ?? user.role}</span>
        </span>
        <button onClick={logout} aria-label="Выйти" title="Выйти" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--h-muted)] hover:bg-white/10 hover:text-[var(--h-text)]"><LogOut className="h-4 w-4" /></button>
      </div>
    </nav>
  );

  const agentScreen = pathname.startsWith("/agent");

  return (
    <div className="hunt hunt-glow lf-dark h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[268px_1fr]">
      <aside className="hidden h-[100dvh] p-3 pr-0 lg:block">{nav}</aside>
      {open ? <div className="fixed inset-0 z-40 lg:hidden"><button className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-label="Закрыть меню" /><div className="relative h-full w-72 p-3">{nav}<button className="absolute right-6 top-6 text-[var(--h-text)]" aria-label="Закрыть меню" onClick={() => setOpen(false)}><X /></button></div></div> : null}
      <div className="flex h-[100dvh] min-w-0 flex-col">
        <header className="z-30 flex shrink-0 items-center gap-2 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] sm:gap-3 lg:px-6 lg:pt-4">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Открыть меню"><Menu /></button>
          <div className="min-w-0 lg:hidden">
            <div className="truncate text-[16px] font-semibold leading-5">{current}</div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти организацию или сайт" aria-label="Поиск организаций и сайтов" className="h-10 w-full rounded-full border border-line bg-slate-50 px-4 text-base sm:text-sm" />
            {hits ? <div className="glass-sheet absolute z-20 mt-1 w-full rounded-2xl p-2">
              {hits.organizations.map((item) => <Link key={item.id} href={`/organizations/${item.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{item.name} <span className="text-slate-500">{item.city}</span></Link>)}
              {hits.sites.map((item) => <Link key={item.id} href={`/sites/${item.id}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">{item.name}</Link>)}
              {!hits.organizations.length && !hits.sites.length ? <div className="px-2 py-2 text-sm text-slate-500">Ничего не найдено</div> : null}
            </div> : null}
          </div>
          <Link href="/hunt" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-teal-700 px-4 text-sm font-semibold lg:hidden"><Crosshair className="h-4 w-4" /><span className="max-[359px]:hidden">Охота</span></Link>
          <button className="glass hidden h-10 items-center gap-2 rounded-full px-3.5 text-xs sm:inline-flex" onClick={() => router.push("/integrations")}><span className="h-1.5 w-1.5 rounded-full bg-[var(--h-ok)]" />{connected} подключено</button>
          <button className="glass relative grid h-10 w-10 shrink-0 place-items-center rounded-full" onClick={() => setNoteOpen((value) => !value)} aria-label="Уведомления">
            {unread > 0 ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-teal-700 px-1 text-[10px] text-white">{unread}</span> : null}
            <Bell className="h-4 w-4" />
          </button>
          <button onClick={logout} aria-label="Выйти" className="glass grid h-10 w-10 shrink-0 place-items-center rounded-full lg:hidden"><LogOut className="h-4 w-4" /></button>
        </header>
        {noteOpen ? <div className="glass-sheet mx-4 mb-2 rounded-2xl px-4 py-3 lg:mx-6">
          {notes.length === 0 ? <p className="text-sm text-slate-500">Уведомлений нет</p> : notes.slice(0, 6).map((item) => <Link key={item.id} href={item.href || "/"} className="block py-1 text-sm"><b>{item.title}.</b> {item.body}</Link>)}
          <button className="mt-2 text-xs text-teal-800" onClick={() => api("/api/notifications/read", { method: "POST" }).then(() => setNotes(notes.map((item) => ({ ...item, readAt: new Date().toISOString() }))))}>Отметить прочитанными</button>
        </div> : null}
        <main className={cnJoin("flex min-h-0 flex-1 flex-col px-4 lg:px-6", agentScreen ? "overflow-hidden py-3" : "overflow-y-auto pb-8 pt-2")}>{children}</main>
      </div>
    </div>
  );
}
