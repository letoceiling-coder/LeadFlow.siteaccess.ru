import { handleBotUpdate } from "@/lib/services/radar-bot";
import { safeLog } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

/** Webhook бота заказчика (радар, сценарий 4). Доступ — только по секрету из заголовка Telegram. */
export async function POST(request: Request, context: Ctx) {
  const { projectId } = await context.params;
  if (!/^[a-z0-9]{10,40}$/.test(projectId)) return new Response(null, { status: 404 });
  try {
    const update = await request.json().catch(() => ({}));
    const result = await handleBotUpdate(projectId, request.headers.get("x-telegram-bot-api-secret-token"), update);
    return new Response(null, { status: result.status });
  } catch (error) {
    // Ошибку пишем в журнал без деталей запроса и отвечаем 200: иначе Telegram будет бесконечно повторять то же нажатие.
    safeLog("radar.bot_webhook", error);
    return new Response(null, { status: 200 });
  }
}
