export const NAV = [
  { href: "/", label: "Обзор", icon: "LayoutDashboard" },
  { href: "/agent", label: "Агент", icon: "Bot" },
  { href: "/search", label: "Поиск организаций", icon: "Search" },
  { href: "/organizations", label: "База организаций", icon: "Building2" },
  { href: "/leads", label: "Лиды", icon: "Users" },
  { href: "/analysis", label: "AI-анализ", icon: "Sparkles" },
  { href: "/sites", label: "Генерация сайтов", icon: "Globe" },
  { href: "/demos", label: "Демо-проекты", icon: "Monitor" },
  { href: "/crm", label: "CRM и сделки", icon: "Kanban" },
  { href: "/communications", label: "Коммуникации", icon: "MessagesSquare" },
  { href: "/opt-outs", label: "Не беспокоить", icon: "Ban" },
  { href: "/campaigns", label: "Кампании", icon: "Megaphone" },
  { href: "/automations", label: "Автоматизации", icon: "Workflow" },
  { href: "/analytics", label: "Аналитика", icon: "ChartColumn" },
  { href: "/team", label: "Команда", icon: "UserRound" },
  { href: "/integrations", label: "Интеграции", icon: "Plug" },
  { href: "/settings", label: "Настройки", icon: "Settings" },
  { href: "/audit", label: "Журнал действий", icon: "ScrollText" },
] as const;

export const PIPELINE: { key: string; name: string; terminal?: boolean }[] = [
  { key: "new", name: "Новый" },
  { key: "review", name: "На проверке" },
  { key: "qualified", name: "Квалифицирован" },
  { key: "analyzed", name: "Анализ завершен" },
  { key: "demo_planned", name: "Демо запланировано" },
  { key: "demo_creating", name: "Демо создается" },
  { key: "demo_ready", name: "Демо готово" },
  { key: "awaiting_review", name: "Ожидает проверки" },
  { key: "ready_to_contact", name: "Готов к контакту" },
  { key: "contacted", name: "Контакт установлен" },
  { key: "replied", name: "Получен ответ" },
  { key: "meeting", name: "Назначена встреча" },
  { key: "proposal", name: "Отправлено предложение" },
  { key: "negotiation", name: "Переговоры" },
  { key: "won", name: "Успешная сделка", terminal: true },
  { key: "lost", name: "Закрыто без сделки", terminal: true },
  { key: "do_not_contact", name: "Не связываться", terminal: true },
];

export const SITE_TYPES = [
  { id: "card", label: "Сайт-визитка" },
  { id: "corporate", label: "Корпоративный сайт" },
  { id: "services", label: "Сайт услуг" },
  { id: "clinic", label: "Сайт клиники" },
  { id: "restaurant", label: "Сайт ресторана" },
  { id: "construction", label: "Сайт строительной компании" },
  { id: "beauty", label: "Сайт салона красоты" },
  { id: "legal", label: "Сайт юридической компании" },
  { id: "education", label: "Сайт образовательной организации" },
  { id: "landing", label: "Лендинг" },
  { id: "custom", label: "Индивидуальный вариант" },
];

export const SITE_STATUS_LABEL: Record<string, string> = {
  queued: "в очереди",
  building: "собирается",
  waiting_user: "ждёт ответа",
  preview_ready: "готово к просмотру",
  qa_running: "идёт проверка",
  qa_passed: "проверка пройдена",
  qa_failed: "есть замечания",
  approved: "одобрено",
  publish_requested: "публикация запрошена",
  published: "опубликовано",
  failed: "ошибка",
  cancelled: "отменено",
};

export const TASK_STATUS: Record<string, string> = {
  queued: "В очереди",
  running: "Выполняется",
  completed: "Завершено",
  failed: "Ошибка",
  cancelled: "Отменено",
  dead: "Остановлено после повторов",
};

export const WEBSITE_STATUS_LABEL: Record<string, string> = {
  NO_WEBSITE: "Сайт не указан",
  WEBSITE_EXISTS: "Есть сайт",
  SOCIAL_ONLY: "Только соцсеть",
  BROKEN_WEBSITE: "Сайт не открывается",
  AGGREGATOR_ONLY: "Только агрегатор",
  UNCERTAIN: "Неясно",
};

export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  ANALYST: "Аналитик",
  OPERATOR: "Оператор",
  VIEWER: "Наблюдатель",
};

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function money(value: number | null | undefined, unknown = false): string {
  if (unknown || value == null) return "неизвестно";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}
