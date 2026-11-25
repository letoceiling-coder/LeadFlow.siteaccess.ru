/** Шаги полного цикла лида и статусы охоты, которые в них попадают. Порядок — как идёт работа. */
export const PIPELINE_STEPS = [
  { key: "found", label: "Найдены", hint: "Парсер собрал, AI оценил — решите, писать или нет", statuses: ["new", "snoozed"] },
  { key: "approved", label: "Написать", hint: "Взяты в работу — откройте чат и отправьте первое сообщение", statuses: ["approved"] },
  { key: "sent", label: "Написали", hint: "Ждём ответа, напоминания идут по плану", statuses: ["sent", "sleeping"] },
  { key: "replied", label: "Ответили", hint: "Соберите демо-сайт и КП, отправьте ссылку", statuses: ["replied"] },
  { key: "demo", label: "Демо", hint: "Демо показано — договоритесь о созвоне", statuses: ["demo"] },
  { key: "call", label: "Созвон", hint: "После созвона — смета", statuses: ["call"] },
  { key: "estimate", label: "Смета", hint: "Ждём решения клиента", statuses: ["estimate"] },
  { key: "won", label: "Сделка", hint: "Проект с чек-листом создан", statuses: ["won"] },
  { key: "lost", label: "Отказ", hint: "Отклонённые и отказавшиеся", statuses: ["rejected", "lost"] },
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number]["key"];
