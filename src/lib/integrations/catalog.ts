export const INTEGRATION_CATALOG = [
  {
    id: "parser",
    name: "Parser API",
    description: "Поиск организаций в Яндекс Картах, чтение общей базы и аудит сайтов.",
    instructions: "Создайте ключ на parser.rinulik.ru с правами tasks:write, tasks:read, workers:read и organizations:read. Вставьте его сюда или в PARSER_API_KEY на сервере.",
  },
  {
    id: "studio",
    name: "Website AI Studio",
    description: "Создание демонстрационных сайтов, задачи агента, превью, версии и публикация.",
    instructions: "В Studio создайте ключ с правами projects:read, projects:write, agent и publish. Publish используется только после отдельного подтверждения.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "AI-анализ, оценка и черновики сообщений. Модель задаётся в настройках.",
    instructions: "Укажите ключ OpenRouter. Агент ходит в DeepSeek V4 Flash, анализ в GLM 5.3 Flash, тексты в Gemma 4 31B. Дорогие модели не вызываются.",
  },
  {
    id: "email",
    name: "Email",
    description: "Отправка писем через SMTP после подтверждения человеком.",
    instructions: "Укажите хост, порт, логин, пароль и адрес отправителя. Проверка выполняет SMTP verify и ничего не отправляет.",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Уведомления команды и диалоги с известным chat id. Номер из карты не считается чатом.",
    instructions: "Укажите токен бота. Для уведомлений можно указать chat id команды. getMe проверяет токен.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Только шаблонные сообщения и только при зафиксированном согласии.",
    instructions: "Укажите токен Cloud API и Phone Number ID. Проверка читает номер и не отправляет сообщение.",
  },
  {
    id: "sms",
    name: "SMS",
    description: "SMS через подключённого провайдера. Публичный телефон сам по себе не разрешает рассылку.",
    instructions: "Сейчас проверяется SMS.ru по api_id. Другой провайдер останется неподтверждённым, пока для него нет адаптера.",
  },
  {
    id: "storage",
    name: "Хранилище файлов",
    description: "S3-совместимое хранилище для вложений.",
    instructions: "Укажите endpoint, bucket, region, access key и secret. Файлы проекта пишутся в отдельную папку бакета, по умолчанию leadflow/.",
  },
  {
    id: "sheets",
    name: "Google Таблицы",
    description: "Лиды, касания и проекты сами попадают в вашу Google Таблицу через Apps Script.",
    instructions: "Откройте таблицу → Расширения → Apps Script, вставьте код из LeadFlow (Охота → Настройки → «Скопировать код»), разверните как веб-приложение. Сюда — ссылку /exec и тот же токен.",
  },
] as const;

export type ProviderId = (typeof INTEGRATION_CATALOG)[number]["id"];

/** Корень API. Ключ вводится отдельно, путь вроде /api/v1 сюда не добавляется вручную. */
export const DEFAULT_API_BASE: Partial<Record<ProviderId, string>> = {
  parser: "https://parser.rinulik.ru",
  studio: "https://lovable.siteaccess.ru/api/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** HTTP-прокси только для OpenRouter: прямой выход с сервера режется политикой OpenRouter. */
export const DEFAULT_OPENROUTER_PROXY = "http://82.25.60.43:8888";
