"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Copy, Link2, Plus, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import { useResource } from "@/components/use-resource";
import { Badge, Button, Card, Field, Loading, PageTitle, State, cnJoin, controlClass } from "@/components/ui";
import { ROLE_HINT, ROLE_LABEL, formatDate } from "@/lib/domain/labels";

type Membership = { id: string; tenantId: string; tenantName: string; role: string };
type AdminUser = {
  id: string;
  name: string;
  email: string | null;
  contact: string;
  telegramUsername: string | null;
  hasTelegram: boolean;
  hasPassword: boolean;
  status: "active" | "pending" | "blocked";
  isPlatformAdmin: boolean;
  adminNote: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  memberships: Membership[];
};
type Tenant = { id: string; name: string; createdAt: string; members: number; organizations: number };
type Invite = { id: string; tenantId: string; tenantName: string; email: string | null; role: string; note: string | null; expiresAt: string };
type Overview = { users: AdminUser[]; tenants: Tenant[]; invitations: Invite[] };
type AccessSettings = {
  allowRequests: boolean;
  notifyAdmins: boolean;
  botUsername: string | null;
  botTokenSet: boolean;
  botFromEnv: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpFrom: string;
  smtpPasswordSet: boolean;
  smtpFromEnv: boolean;
  registrationLocked: boolean;
  emailReady: boolean;
  telegramReady: boolean;
};

const ROLES = ["OWNER", "ADMIN", "MANAGER", "ANALYST", "OPERATOR", "VIEWER"] as const;
const INVITE_ROLES = ROLES.filter((role) => role !== "OWNER");
type Tab = "requests" | "users" | "tenants" | "links" | "settings";

function RoleSelect({ value, onChange, roles = ROLES, className }: { value: string; onChange: (role: string) => void; roles?: readonly string[]; className?: string }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={cnJoin(controlClass, "h-10", className)} title={ROLE_HINT[value]}>
      {roles.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
    </select>
  );
}

function TenantSelect({ tenants, value, onChange, empty }: { tenants: Tenant[]; value: string; onChange: (id: string) => void; empty?: string }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={cnJoin(controlClass, "h-10")}>
      {empty !== undefined ? <option value="">{empty}</option> : null}
      {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
    </select>
  );
}

export default function AdminPage() {
  const overview = useResource<Overview>("/api/admin");
  const [tab, setTab] = useState<Tab>("requests");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(action: () => Promise<unknown>, success?: string) {
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      await overview.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Действие не выполнено");
    }
  }

  if (!overview.data && overview.loading) return <Loading />;
  if (!overview.data) return <State title="Админка недоступна" text={overview.error || "Нет ответа"} />;
  const data = overview.data;
  const pendingUsers = data.users.filter((user) => user.status === "pending");

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "requests", label: "Заявки", count: pendingUsers.length },
    { id: "users", label: "Люди", count: data.users.length },
    { id: "tenants", label: "Пространства", count: data.tenants.length },
    { id: "links", label: "Ссылки-приглашения", count: data.invitations.length },
    { id: "settings", label: "Настройки входа" },
  ];

  return (
    <div>
      <PageTitle
        title="Админка"
        text="Кто может войти в LeadFlow и что ему доступно. Пространство — отдельный аккаунт со своей базой, лидами и интеграциями; человек может состоять в нескольких."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-full bg-slate-100 p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => { setTab(item.id); setError(""); setNotice(""); }}
            className={cnJoin("flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition", tab === item.id ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink")}
          >
            {item.label}
            {item.count !== undefined ? <span className={cnJoin("rounded-full px-1.5 text-xs", item.id === "requests" && item.count ? "bg-amber-400 text-black" : "bg-slate-200/60")}>{item.count}</span> : null}
          </button>
        ))}
      </div>
      {error ? <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {notice ? <p className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}

      {tab === "requests" ? <Requests users={pendingUsers} tenants={data.tenants} run={run} /> : null}
      {tab === "users" ? <Users users={data.users} tenants={data.tenants} run={run} /> : null}
      {tab === "tenants" ? <Tenants tenants={data.tenants} users={data.users} run={run} /> : null}
      {tab === "links" ? <Links tenants={data.tenants} invitations={data.invitations} run={run} onError={setError} /> : null}
      {tab === "settings" ? <Settings /> : null}
    </div>
  );
}

type Run = (action: () => Promise<unknown>, success?: string) => Promise<void>;

function Contact({ user }: { user: AdminUser }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5 font-medium">
        {user.name}
        {user.isPlatformAdmin ? <Badge tone="teal">админ платформы</Badge> : null}
        {user.status === "blocked" ? <Badge tone="red">заблокирован</Badge> : null}
        {user.status === "pending" ? <Badge tone="amber">ждёт доступа</Badge> : null}
      </div>
      <div className="truncate text-sm text-slate-500">
        {user.email ?? ""}
        {user.email && user.hasTelegram ? " · " : ""}
        {user.hasTelegram ? <span>Telegram{user.telegramUsername ? ` @${user.telegramUsername}` : ""}</span> : null}
      </div>
    </div>
  );
}

function GrantForm({ user, tenants, run, compact }: { user: AdminUser; tenants: Tenant[]; run: Run; compact?: boolean }) {
  const free = tenants.filter((tenant) => !user.memberships.some((item) => item.tenantId === tenant.id));
  const [tenantId, setTenantId] = useState(free[0]?.id ?? "");
  const [role, setRole] = useState("MANAGER");
  if (!free.length) return compact ? null : <p className="text-sm text-slate-500">Доступ уже есть ко всем пространствам.</p>;
  const current = free.some((tenant) => tenant.id === tenantId) ? tenantId : free[0].id;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[180px] flex-1"><TenantSelect tenants={free} value={current} onChange={setTenantId} /></div>
      <div className="w-[170px]"><RoleSelect value={role} onChange={setRole} /></div>
      <Button onClick={() => run(() => api("/api/admin/memberships", { method: "POST", body: JSON.stringify({ userId: user.id, tenantId: current, role }) }), `${user.name}: доступ к «${free.find((tenant) => tenant.id === current)?.name}» выдан`)}>
        <Plus className="h-4 w-4" /> {compact ? "Добавить" : "Выдать доступ"}
      </Button>
    </div>
  );
}

function Requests({ users, tenants, run }: { users: AdminUser[]; tenants: Tenant[]; run: Run }) {
  if (!users.length) {
    return <State title="Новых заявок нет" text="Когда человек зарегистрируется по почте или через Telegram, он появится здесь. Ссылка на регистрацию — во вкладке «Настройки входа»." />;
  }
  return (
    <div className="space-y-3">
      {users.map((user) => (
        <Card key={user.id} className="!p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <Contact user={user} />
            <span className="text-xs text-slate-500">заявка от {formatDate(user.createdAt)}</span>
          </div>
          <GrantForm user={user} tenants={tenants} run={run} />
          <div className="mt-3 flex gap-3 text-sm">
            <button className="text-slate-500 hover:text-red-700" onClick={() => run(() => api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status: "blocked" }) }), "Заявка отклонена, вход закрыт")}>Отклонить</button>
            <button className="text-slate-500 hover:text-red-700" onClick={() => { if (window.confirm(`Удалить заявку ${user.contact}? Человек сможет зарегистрироваться заново.`)) run(() => api(`/api/admin/users/${user.id}`, { method: "DELETE" }), "Заявка удалена"); }}>Удалить</button>
          </div>
        </Card>
      ))}
      <div className="rounded-2xl border border-line p-4 text-sm">
        <p className="mb-2 text-slate-500">Человек получит сообщение в Telegram или письмо, что доступ открыт. Что умеют роли:</p>
        <ul className="space-y-1">{Object.entries(ROLE_HINT).map(([role, hint]) => <li key={role}><b>{ROLE_LABEL[role]}</b> — {hint}</li>)}</ul>
      </div>
    </div>
  );
}

function CreateUser({ tenants, run }: { tenants: Tenant[]; run: Run }) {
  const empty = { email: "", name: "", tenantId: tenants[0]?.id ?? "", role: "MANAGER", password: "", isPlatformAdmin: false, notify: true };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <div className="mb-3">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Новый пользователь</Button>
      </div>
    );
  }

  async function submit() {
    setPending(true);
    let ok = false;
    await run(async () => {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ ...form, password: form.password || null }) });
      ok = true;
    }, `Пользователь ${form.email} создан`);
    setPending(false);
    if (ok) {
      setForm(empty);
      setOpen(false);
    }
  }

  return (
    <Card className="mb-4 !p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Новый пользователь</h2>
        <button aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-1 text-sm text-slate-500">Регистрация закрыта — новые люди появляются только здесь. Без пароля человек входит по коду, который придёт на почту.</p>
      <form className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Field label="Почта"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" required autoComplete="off" className={controlClass} /></Field>
        <Field label="Имя"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={80} autoComplete="off" className={controlClass} /></Field>
        <Field label="Пароль (необязательно)"><input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" minLength={8} autoComplete="new-password" placeholder="вход по коду на почту" className={controlClass} /></Field>
        <Field label="Пространство"><TenantSelect tenants={tenants} value={form.tenantId} onChange={(tenantId) => setForm({ ...form, tenantId })} /></Field>
        <Field label="Роль"><RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} /></Field>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isPlatformAdmin} onChange={(event) => setForm({ ...form, isPlatformAdmin: event.target.checked })} /> Администратор платформы</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.notify} onChange={(event) => setForm({ ...form, notify: event.target.checked })} /> Отправить письмо о доступе</label>
        </div>
        <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" pending={pending} disabled={!form.email || !form.name || !form.tenantId}>Создать</Button></div>
      </form>
    </Card>
  );
}

function Users({ users, tenants, run }: { users: AdminUser[]; tenants: Tenant[]; run: Run }) {
  const [query, setQuery] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      if (tenantFilter && !user.memberships.some((item) => item.tenantId === tenantFilter)) return false;
      if (!q) return true;
      return `${user.name} ${user.email ?? ""} ${user.telegramUsername ?? ""}`.toLowerCase().includes(q);
    });
  }, [users, query, tenantFilter]);

  return (
    <div>
      <CreateUser tenants={tenants} run={run} />
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по имени, почте, @telegram" className={cnJoin(controlClass, "h-10 max-w-sm flex-1")} />
        <div className="w-56"><TenantSelect tenants={tenants} value={tenantFilter} onChange={setTenantFilter} empty="Все пространства" /></div>
      </div>
      <div className="space-y-3">
        {list.map((user) => (
          <Card key={user.id} className="!p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Contact user={user} />
              <div className="text-right text-xs text-slate-500">
                {user.lastLoginAt ? `вход ${formatDate(user.lastLoginAt)}` : "ещё не входил"}
                <button className="ml-3 text-teal-800" onClick={() => setOpen(open === user.id ? null : user.id)}>{open === user.id ? "Свернуть" : "Управление"}</button>
              </div>
            </div>
            {user.memberships.length ? (
              <div className="mt-3 space-y-2">
                {user.memberships.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <span className="min-w-[140px] flex-1 text-sm font-medium">{item.tenantName}</span>
                    <div className="w-[170px]">
                      <RoleSelect value={item.role} onChange={(role) => run(() => api(`/api/admin/memberships/${item.id}`, { method: "PATCH", body: JSON.stringify({ role }) }), `Роль в «${item.tenantName}»: ${ROLE_LABEL[role]}`)} />
                    </div>
                    <button aria-label="Убрать доступ" title="Убрать доступ к пространству" className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-700" onClick={() => { if (window.confirm(`Убрать у ${user.name} доступ к «${item.tenantName}»?`)) run(() => api(`/api/admin/memberships/${item.id}`, { method: "DELETE" }), "Доступ убран"); }}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-sm text-slate-500">Нет доступа ни к одному пространству.</p>}
            {open === user.id ? <UserControls user={user} tenants={tenants} run={run} /> : null}
          </Card>
        ))}
        {!list.length ? <p className="text-sm text-slate-500">Никого не нашли.</p> : null}
      </div>
    </div>
  );
}

function UserControls({ user, tenants, run }: { user: AdminUser; tenants: Tenant[]; run: Run }) {
  const [password, setPassword] = useState("");
  const [note, setNote] = useState(user.adminNote ?? "");
  const patch = (body: Record<string, unknown>, success: string) => run(() => api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) }), success);
  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      <div>
        <div className="mb-1.5 text-sm font-medium">Добавить доступ к пространству</div>
        <GrantForm user={user} tenants={tenants} run={run} compact />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Пароль для входа" hint={user.hasPassword ? "Пароль задан. Новый заменит старый." : "Не задан — вход только по коду или Telegram."}>
          <div className="flex gap-2">
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="text" autoComplete="off" placeholder="от 8 символов, буквы и цифры" className={cnJoin(controlClass, "h-10")} />
            <Button variant="secondary" disabled={password.length < 8} onClick={() => patch({ password }, "Пароль задан. Передайте его человеку лично.").then(() => setPassword(""))}>Задать</Button>
          </div>
        </Field>
        <Field label="Заметка (видна только админам)">
          <div className="flex gap-2">
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className={cnJoin(controlClass, "h-10")} />
            <Button variant="secondary" onClick={() => patch({ adminNote: note || null }, "Заметка сохранена")}>OK</Button>
          </div>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {user.status === "blocked"
          ? <Button variant="secondary" onClick={() => patch({ status: user.memberships.length ? "active" : "pending" }, "Вход снова открыт")}>Разблокировать</Button>
          : <Button variant="secondary" onClick={() => { if (window.confirm(`Закрыть вход для ${user.name}? Все его сессии завершатся.`)) patch({ status: "blocked" }, "Вход закрыт"); }}>Заблокировать</Button>}
        <Button variant="secondary" onClick={() => patch({ isPlatformAdmin: !user.isPlatformAdmin }, user.isPlatformAdmin ? "Права админа платформы сняты" : "Теперь это администратор платформы")}>
          <ShieldCheck className="h-4 w-4" /> {user.isPlatformAdmin ? "Снять админа платформы" : "Сделать админом платформы"}
        </Button>
        {user.hasPassword ? <Button variant="ghost" onClick={() => patch({ password: null }, "Пароль сброшен")}>Сбросить пароль</Button> : null}
        <Button variant="danger" onClick={() => { if (window.confirm(`Удалить ${user.name} насовсем? Данные пространств останутся.`)) run(() => api(`/api/admin/users/${user.id}`, { method: "DELETE" }), "Пользователь удалён"); }}>
          <Trash2 className="h-4 w-4" /> Удалить
        </Button>
      </div>
      <p className="text-xs text-slate-500">Зарегистрирован {formatDate(user.createdAt)}. Админ платформы видит эту страницу и раздаёт доступы во все пространства.</p>
    </div>
  );
}

function Tenants({ tenants, users, run }: { tenants: Tenant[]; users: AdminUser[]; run: Run }) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [shareFrom, setShareFrom] = useState(tenants[0]?.id ?? "");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const membersOf = (tenantId: string) => users.flatMap((user) => user.memberships.filter((item) => item.tenantId === tenantId).map((item) => ({ user, role: item.role })));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {tenants.map((tenant) => (
          <Card key={tenant.id} className="!p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {editing?.id === tenant.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); run(() => api(`/api/admin/tenants/${tenant.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name }) }), "Название сохранено").then(() => setEditing(null)); }}>
                  <input autoFocus value={editing.name} onChange={(event) => setEditing({ id: tenant.id, name: event.target.value })} className={cnJoin(controlClass, "h-10")} />
                  <Button type="submit">Сохранить</Button>
                </form>
              ) : (
                <button className="text-left font-semibold hover:underline" title="Переименовать" onClick={() => setEditing({ id: tenant.id, name: tenant.name })}>{tenant.name}</button>
              )}
              <span className="text-xs text-slate-500">{tenant.organizations} организаций · создано {formatDate(tenant.createdAt)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {membersOf(tenant.id).map(({ user, role }) => (
                <span key={user.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{user.name} · {ROLE_LABEL[role]}</span>
              ))}
              {!tenant.members ? <span className="text-sm text-slate-500">Пока никого — выдайте доступ во вкладке «Заявки» или «Люди».</span> : null}
            </div>
          </Card>
        ))}
      </div>
      <Card className="h-fit">
        <h2 className="mb-1 font-semibold">Новое пространство</h2>
        <p className="mb-3 text-sm text-slate-500">Отдельный аккаунт: своя база, лиды, таблица, Telegram и почта. Чужие данные туда не попадают.</p>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); run(() => api("/api/admin/tenants", { method: "POST", body: JSON.stringify({ name, ownerUserId: owner || null, shareFrom: shareFrom || null }) }), `Пространство «${name}» создано`).then(() => { setName(""); setOwner(""); }); }}>
          <Field label="Название"><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} className={controlClass} /></Field>
          <Field label="Владелец" hint="Получит полный доступ к пространству">
            <select value={owner} onChange={(event) => setOwner(event.target.value)} className={controlClass}>
              <option value="">— назначу позже —</option>
              {users.filter((user) => user.status !== "blocked").map((user) => <option key={user.id} value={user.id}>{user.name} · {user.contact}</option>)}
            </select>
          </Field>
          <Field label="Скопировать ключи парсера и AI из" hint="Чтобы новый аккаунт искал через те же серверы. Данные не копируются.">
            <TenantSelect tenants={tenants} value={shareFrom} onChange={setShareFrom} empty="— не копировать —" />
          </Field>
          <Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Создать</Button>
        </form>
      </Card>
    </div>
  );
}

function CopyButton({ text, children }: { text: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="secondary" onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
      <Copy className="h-4 w-4" /> {copied ? "Скопировано" : children}
    </Button>
  );
}

function Links({ tenants, invitations, run, onError }: { tenants: Tenant[]; invitations: Invite[]; run: Run; onError: (text: string) => void }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [role, setRole] = useState("MANAGER");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState(7);
  const [sendEmail, setSendEmail] = useState(false);
  const [created, setCreated] = useState<{ url: string; message: string; emailed: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    onError("");
    try {
      const row = await api<{ url: string; message: string; emailed: boolean }>("/api/admin/invitations", { method: "POST", body: JSON.stringify({ tenantId, role, email: email || null, note: note || null, days, sendEmail: Boolean(email) && sendEmail }) });
      setCreated(row);
      setEmail("");
      setNote("");
      await run(async () => undefined);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Ссылка не создана");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit">
        <h2 className="mb-1 font-semibold">Пригласить человека</h2>
        <p className="mb-3 text-sm text-slate-500">Создайте ссылку и отправьте её на почту или в Telegram. Человек откроет её, войдёт по почте или через Telegram и сразу получит доступ — без заявки.</p>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); create(); }}>
          <Field label="Пространство"><TenantSelect tenants={tenants} value={tenantId} onChange={setTenantId} /></Field>
          <Field label="Роль" hint={ROLE_HINT[role]}><RoleSelect value={role} onChange={setRole} roles={INVITE_ROLES} /></Field>
          <Field label="Почта (необязательно)" hint="Если указать — принять ссылку сможет только эта почта. Пусто — любой, кому вы её отправите (удобно для Telegram).">
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className={controlClass} />
          </Field>
          {email ? (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} /> Сразу отправить письмо с ссылкой</label>
          ) : null}
          <Field label="Для кого (заметка)"><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="например, Иван — менеджер" className={controlClass} /></Field>
          <Field label="Срок действия">
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} className={controlClass}>
              {[1, 3, 7, 14, 30].map((value) => <option key={value} value={value}>{value} дн.</option>)}
            </select>
          </Field>
          <Button type="submit" pending={pending} disabled={!tenantId} className="w-full"><Link2 className="h-4 w-4" /> Создать ссылку</Button>
        </form>
      </Card>
      <div className="space-y-4">
        {created ? (
          <Card className="!border-emerald-300">
            <h2 className="font-semibold">Ссылка готова{created.emailed ? " и отправлена письмом" : ""}</h2>
            <p className="mt-1 text-sm text-slate-500">Ссылка одноразовая и показывается один раз — скопируйте или отправьте сейчас.</p>
            <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm [overflow-wrap:anywhere]">{created.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton text={created.message}>Скопировать сообщение</CopyButton>
              <CopyButton text={created.url}>Только ссылку</CopyButton>
              <a className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#229ED9] px-4 text-sm font-medium text-white" href={`https://t.me/share/url?url=${encodeURIComponent(created.url)}&text=${encodeURIComponent(created.message.replace(created.url, "").trim())}`} target="_blank" rel="noreferrer">
                <Send className="h-4 w-4" /> Отправить в Telegram
              </a>
            </div>
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-2 font-semibold">Действующие ссылки</h2>
          {!invitations.length ? <p className="text-sm text-slate-500">Открытых ссылок нет.</p> : invitations.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 text-sm last:border-0">
              <div>
                <div className="font-medium">{item.tenantName} · {ROLE_LABEL[item.role]}</div>
                <div className="text-slate-500">{item.email ?? "любой по ссылке"}{item.note ? ` · ${item.note}` : ""} · до {formatDate(item.expiresAt)}</div>
              </div>
              <button className="text-slate-500 hover:text-red-700" onClick={() => run(() => api(`/api/admin/invitations/${item.id}`, { method: "DELETE" }), "Ссылка отозвана")}>Отозвать</button>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function Settings() {
  const settings = useResource<AccessSettings>("/api/admin/access-settings");
  const [botToken, setBotToken] = useState("");
  const [smtp, setSmtp] = useState<{ host: string; port: number; user: string; from: string; password: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [link, setLink] = useState<{ code: string; url: string } | null>(null);

  if (!settings.data) return settings.error ? <State title="Настройки недоступны" text={settings.error} /> : <Loading />;
  const data = settings.data;
  const form = smtp ?? { host: data.smtpHost, port: data.smtpPort, user: data.smtpUser, from: data.smtpFrom, password: "" };
  const registerUrl = typeof window === "undefined" ? "/register" : `${window.location.origin}/register`;

  async function save(body: Record<string, unknown>, ok: string) {
    setMessage(null);
    try {
      settings.setData(await api<AccessSettings>("/api/admin/access-settings", { method: "PATCH", body: JSON.stringify(body) }));
      setMessage({ tone: "ok", text: ok });
      return true;
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Не сохранено" });
      return false;
    }
  }

  async function linkMyTelegram() {
    setMessage(null);
    try {
      const row = await api<{ code: string; link: string }>("/api/auth/telegram/start", { method: "POST", body: JSON.stringify({}) });
      setLink({ code: row.code, url: row.link });
      const started = Date.now();
      const tick = async () => {
        const result = await api<{ linked: boolean }>("/api/auth/telegram/link", { method: "POST", body: JSON.stringify({ code: row.code }) }).catch((reason) => {
          setMessage({ tone: "error", text: reason.message });
          setLink(null);
          return null;
        });
        if (!result) return;
        if (result.linked) {
          setLink(null);
          setMessage({ tone: "ok", text: "Telegram привязан: заявки будут приходить вам в бота, и вы сможете входить через Telegram." });
        } else if (Date.now() - started < 10 * 60 * 1000) setTimeout(tick, 2000);
        else setLink(null);
      };
      setTimeout(tick, 2000);
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Не получилось" });
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {message ? <p className={cnJoin("rounded-xl p-3 text-sm lg:col-span-2", message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>{message.text}</p> : null}
      <Card>
        <h2 className="font-semibold">Регистрация</h2>
        {data.registrationLocked ? (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <b>Регистрация закрыта на сервере</b> (ALLOW_REGISTRATION=false). Новых людей создаёт администратор: вкладка «Люди» → «Новый пользователь», или ссылка-приглашение.
          </p>
        ) : null}
        {data.registrationLocked ? null : <>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={data.allowRequests} onChange={(event) => save({ allowRequests: event.target.checked }, event.target.checked ? "Приём заявок включён" : "Приём заявок выключен")} />
          <span><b>Принимать заявки от новых людей.</b> Человек регистрируется по почте или Telegram и ждёт, пока вы выдадите доступ во вкладке «Заявки». Выключено — войти смогут только те, кому вы дали доступ или ссылку-приглашение.</span>
        </label>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={data.notifyAdmins} onChange={(event) => save({ notifyAdmins: event.target.checked }, "Сохранено")} />
          <span><b>Сообщать мне о новых заявках</b> — в Telegram (если привязан) или письмом.</span>
        </label>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="text-slate-500">Ссылка на регистрацию, которую можно давать людям:</div>
          <div className="mt-1 flex flex-wrap items-center gap-2"><code className="break-all">{registerUrl}</code><CopyButton text={registerUrl}>Копировать</CopyButton></div>
        </div>
        </>}
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Badge tone={data.emailReady ? "green" : "amber"}>Вход по почте: {data.emailReady ? "работает" : "нужна почта ниже"}</Badge>
          <Badge tone={data.telegramReady ? "green" : "amber"}>Вход через Telegram: {data.telegramReady ? "работает" : "нужен бот"}</Badge>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Бот для входа через Telegram</h2>
        <p className="mt-1 text-sm text-slate-500">Создайте отдельного бота в @BotFather (команда /newbot) и вставьте токен. Не используйте бота уведомлений об ошибках или бота с webhook.</p>
        {data.botUsername || data.botFromEnv ? (
          <p className="mt-3 text-sm">Подключён: <b>{data.botUsername ? `@${data.botUsername}` : "бот из .env (AUTH_TELEGRAM_BOT_TOKEN)"}</b></p>
        ) : null}
        <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); save({ botToken }, "Бот подключён").then((ok) => ok && setBotToken("")); }}>
          <input value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder={data.botTokenSet ? "токен сохранён — вставьте новый, чтобы заменить" : "123456789:AA…"} autoComplete="off" className={cnJoin(controlClass, "h-10")} />
          <Button type="submit" disabled={!botToken}>Сохранить</Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.telegramReady ? <Button variant="secondary" onClick={linkMyTelegram}><Send className="h-4 w-4" /> Привязать мой Telegram</Button> : null}
          {data.telegramReady ? <Button variant="secondary" onClick={() => api("/api/admin/test-bot", { method: "POST" }).then(() => setMessage({ tone: "ok", text: "Бот прислал тестовое сообщение" })).catch((reason) => setMessage({ tone: "error", text: reason.message }))}>Проверить</Button> : null}
          {data.botTokenSet ? <Button variant="ghost" onClick={() => { if (window.confirm("Отключить бота входа?")) save({ botToken: null }, "Бот отключён"); }}>Отключить</Button> : null}
        </div>
        {link ? (
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
            Откройте бота, нажмите «Start» и «Подтвердить вход»: <a className="font-medium text-teal-800" href={link.url} target="_blank" rel="noreferrer">открыть Telegram</a>
          </div>
        ) : null}
      </Card>

      <Card className="lg:col-span-2">
        <h2 className="font-semibold">Почта для кодов входа и приглашений</h2>
        <p className="mt-1 text-sm text-slate-500">
          SMTP любого почтового сервиса (Beget: smtp.beget.com, порт 465; Яндекс: smtp.yandex.ru, порт 465, пароль приложения). {data.smtpFromEnv ? "Сейчас используется почта из .env сервера — заполните, чтобы заменить." : ""}
        </p>
        <form className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); save({ smtpHost: form.host, smtpPort: Number(form.port), smtpUser: form.user, smtpFrom: form.from, ...(form.password ? { smtpPassword: form.password } : {}) }, "Почта сохранена").then((ok) => ok && setSmtp(null)); }}>
          <Field label="Сервер"><input value={form.host} onChange={(event) => setSmtp({ ...form, host: event.target.value })} placeholder="smtp.yandex.ru" className={controlClass} /></Field>
          <Field label="Порт"><input value={form.port} onChange={(event) => setSmtp({ ...form, port: Number(event.target.value) || 0 })} inputMode="numeric" className={controlClass} /></Field>
          <Field label="Логин"><input value={form.user} onChange={(event) => setSmtp({ ...form, user: event.target.value })} autoComplete="off" className={controlClass} /></Field>
          <Field label="Пароль"><input value={form.password} onChange={(event) => setSmtp({ ...form, password: event.target.value })} type="password" autoComplete="new-password" placeholder={data.smtpPasswordSet ? "сохранён" : ""} className={controlClass} /></Field>
          <Field label="От кого"><input value={form.from} onChange={(event) => setSmtp({ ...form, from: event.target.value })} placeholder="LeadFlow <no-reply@…>" className={controlClass} /></Field>
          <div className="sm:col-span-2 lg:col-span-5"><Button type="submit" disabled={!smtp}>Сохранить почту</Button></div>
        </form>
      </Card>
    </div>
  );
}
