// Отдельный аккаунт со своим пространством. Запуск внутри контейнера app:
//   EMAIL=… PASSWORD=… NAME=… WORKSPACE=… SHARE_FROM=<tenantId> npx tsx --require /tmp/allow.cjs /tmp/create-account.mts
// SHARE_FROM копирует только ключи серверного парсера и OpenRouter (интеграции parser, openrouter),
// чтобы новый аккаунт искал через те же серверы. Данные, лиды, таблица, Telegram, почта — не копируются.
import { PrismaClient } from "/app/node_modules/@prisma/client/index.js";
import bcrypt from "/app/node_modules/bcryptjs/index.js";
import { randomBytes } from "node:crypto";
import { DEFAULT_SETTINGS } from "/app/src/lib/domain/settings.ts";
import { ensureStages } from "/app/src/lib/services/common.ts";

const prisma = new PrismaClient();
const email = String(process.env.EMAIL).toLowerCase().trim();
const password = String(process.env.PASSWORD);
const name = process.env.NAME || email.split("@")[0];
const workspace = process.env.WORKSPACE || name;
if (!email.includes("@") || password.length < 10) throw new Error("EMAIL и PASSWORD (от 10 символов) обязательны");
if (await prisma.user.findUnique({ where: { email } })) throw new Error(`Пользователь ${email} уже есть`);

const slugBase = workspace.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
const slug = (await prisma.tenant.findUnique({ where: { slug: slugBase } })) ? `${slugBase}-${randomBytes(2).toString("hex")}` : slugBase;

const user = await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash(password, 12) } });
const tenant = await prisma.tenant.create({ data: { name: workspace, slug, settings: DEFAULT_SETTINGS } });
await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
await ensureStages(tenant.id);

const shared: string[] = [];
if (process.env.SHARE_FROM) {
  for (const provider of ["parser", "openrouter"]) {
    const row = await prisma.integration.findUnique({ where: { tenantId_provider: { tenantId: process.env.SHARE_FROM, provider } } });
    if (!row?.secretEnc) continue;
    await prisma.integration.create({
      data: { tenantId: tenant.id, provider, config: row.config ?? {}, secretEnc: row.secretEnc, status: row.status, scopes: row.scopes, lastCheckedAt: row.lastCheckedAt },
    });
    shared.push(provider);
  }
}
console.log(JSON.stringify({ userId: user.id, tenantId: tenant.id, slug, shared }));
await prisma.$disconnect();
