import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError, FatalJobError, RetryableError } from "../errors";
import { enqueueJob } from "../jobs/queue";
import { logEvent } from "../log";
import { messengerReader, tgLink, type MessengerReader, type TgHistory, type TgPeer } from "../integrations/messengers";
import { classifyWebsite } from "../domain/website";
import { dedupeKeys, phoneTail } from "../domain/dedupe";
import {
  channelContacts,
  channelDossier,
  cleanText,
  judgeChannel,
  judgeContent,
  mentionsCity,
  normalizeUsername,
  officialSite,
  searchPhrases,
  type TelegramPost,
} from "../domain/telegram-facts";
import { upsertMapped } from "./organizations";
import { findDuplicate } from "./org-dedupe";
import { autoQualifyNew } from "./hunt";

/**
 * Сценарий 2 брифа: ниша → открытые Telegram-каналы организаций → досье по последним постам → карточка.
 *
 * ТОЛЬКО ЧТЕНИЕ рабочего аккаунта студии: глобальный поиск и чтение открытых каналов без вступления.
 * Ничего не отправляем, ни во что не вступаем, личные чаты не читаем.
 *
 * Работает фоном (задача `telegram.search`) короткими шагами по ~20 с: обработчик задач один,
 * поиск не должен держать его минутами. Состояние шага — в `TelegramSearch.state`.
 */

/** Лимиты на один поиск, чтобы не насторожить Telegram: запросы глобального поиска и чтения каналов. */
export const TG_MAX_SEARCH_REQUESTS = 30;
export const TG_MAX_CHANNEL_READS = 100;
const STEP_BUDGET_MS = 20_000;
const SEARCH_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const POSTS_PER_CHANNEL = 10;

export const telegramSearchSchema = z.object({
  niche: z.string().trim().min(2, "Укажите нишу").max(120),
  city: z.string().trim().max(80).optional().nullable(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type TelegramSearchInput = z.infer<typeof telegramSearchSchema>;

type Candidate = { username: string; title: string; type: string; members: number | null; score: number; phrase: string };
type SearchState = {
  phase: "search" | "read" | "qualify";
  phraseIndex: number;
  candidates: Candidate[];
  readIndex: number;
  organizationIds: string[];
  rejected: number;
  samples: { username: string; title: string; lastPostAt: string | null; organizationId: string; merged: boolean }[];
};

function initialState(): SearchState {
  return { phase: "search", phraseIndex: 0, candidates: [], readIndex: 0, organizationIds: [], rejected: 0, samples: [] };
}

function stateOf(value: Prisma.JsonValue | null): SearchState {
  const base = initialState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  return { ...base, ...(value as Partial<SearchState>) };
}

/* ───────────── API ───────────── */

export async function startTelegramSearch(tenantId: string, userId: string | null, input: TelegramSearchInput) {
  const city = input.city?.trim() || null;
  const search = await prisma.telegramSearch.create({
    data: {
      tenantId,
      createdBy: userId,
      niche: input.niche,
      city,
      limit: input.limit,
      phrases: searchPhrases(input.niche, city, 12),
      state: initialState() as unknown as Prisma.InputJsonValue,
    },
  });
  await enqueueJob({ tenantId, type: "telegram.search", payload: { searchId: search.id }, idempotencyKey: `tgsearch:${search.id}`, maxAttempts: 3 });
  return { id: search.id };
}

function view(row: Prisma.TelegramSearchGetPayload<object>) {
  const state = stateOf(row.state);
  return {
    id: row.id,
    niche: row.niche,
    city: row.city,
    limit: row.limit,
    status: row.status as "queued" | "running" | "completed" | "failed",
    found: row.found,
    created: row.created,
    merged: row.merged,
    error: row.error,
    requests: row.requests,
    reads: row.reads,
    phase: state.phase,
    channels: state.samples,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

export async function telegramSearchStatus(tenantId: string, id: string) {
  const row = await prisma.telegramSearch.findFirst({ where: { id, tenantId } });
  if (!row) throw new ApiError(404, "Поиск Telegram не найден", "not_found");
  return view(row);
}

export async function telegramSearches(tenantId: string, limit = 10) {
  const rows = await prisma.telegramSearch.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit });
  return { items: rows.map(view) };
}

/* ───────────── Фоновый шаг ───────────── */

async function save(id: string, state: SearchState, data: Prisma.TelegramSearchUpdateInput = {}) {
  await prisma.telegramSearch.update({ where: { id }, data: { ...data, state: state as unknown as Prisma.InputJsonValue } });
}

async function fail(id: string, message: string) {
  await prisma.telegramSearch.update({ where: { id }, data: { status: "failed", error: message.slice(0, 300), finishedAt: new Date() } });
}

/**
 * Один шаг поиска. `done: false` — задачу надо перезапустить через `delayMs`.
 * FLOOD_WAIT и 429 — не ошибка: ждём столько, сколько просит Telegram, попытки не тратим.
 */
export async function runTelegramSearchStep(searchId: string, jobTenantId: string): Promise<{ done: boolean; delayMs?: number }> {
  const search = await prisma.telegramSearch.findUnique({ where: { id: searchId } });
  if (!search || search.tenantId !== jobTenantId) throw new FatalJobError("Поиск Telegram не найден");
  if (["completed", "failed", "cancelled"].includes(search.status)) return { done: true };
  if (Date.now() - search.createdAt.getTime() > SEARCH_TIMEOUT_MS) {
    await fail(search.id, "Поиск не завершился за 3 часа — запустите снова.");
    return { done: true };
  }
  if (search.status !== "running") await prisma.telegramSearch.update({ where: { id: search.id }, data: { status: "running", error: null } });

  let reader: MessengerReader;
  try {
    reader = await messengerReader(search.tenantId);
  } catch (error) {
    await fail(search.id, error instanceof Error ? error.message : "Telegram через парсер не подключён");
    throw new FatalJobError(error instanceof Error ? error.message : "Telegram не подключён");
  }

  const state = stateOf(search.state);
  const counters = { requests: search.requests, reads: search.reads, found: search.found, created: search.created, merged: search.merged };
  const deadline = Date.now() + STEP_BUDGET_MS;
  const base = { search: search.id, tenant: search.tenantId };

  try {
    while (Date.now() < deadline) {
      if (state.phase === "search") {
        const enough = state.candidates.length >= Math.min(TG_MAX_CHANNEL_READS, search.limit * 4);
        if (state.phraseIndex >= search.phrases.length || counters.requests >= TG_MAX_SEARCH_REQUESTS || enough) {
          state.candidates.sort((a, b) => b.score - a.score || (b.members ?? 0) - (a.members ?? 0));
          state.candidates = state.candidates.slice(0, TG_MAX_CHANNEL_READS);
          state.phase = "read";
          await save(search.id, state, counters);
          continue;
        }
        const phrase = search.phrases[state.phraseIndex];
        const peers = await reader.search(phrase, 30);
        counters.requests += 1;
        state.phraseIndex += 1;
        addCandidates(state, peers, search.niche, search.city, phrase);
        await save(search.id, state, counters);
        continue;
      }

      if (state.phase === "read") {
        if (state.readIndex >= state.candidates.length || counters.reads >= TG_MAX_CHANNEL_READS || counters.found >= search.limit) {
          state.phase = "qualify";
          await save(search.id, state, counters);
          continue;
        }
        const candidate = state.candidates[state.readIndex];
        let history: TgHistory | null = null;
        try {
          history = await reader.channelPosts(candidate.username, { limit: POSTS_PER_CHANNEL });
        } catch (error) {
          // Канал удалён, закрыт или переименован — просто пропускаем.
          if (!(error instanceof ApiError)) throw error;
          logEvent("telegram.search.skip", { ...base, channel: candidate.username, error: error.message.slice(0, 120) }, "warn");
        }
        counters.reads += 1;
        state.readIndex += 1;
        if (history) {
          const saved = await saveChannel(search, candidate, history);
          if (saved) {
            counters.found += 1;
            if (saved.merged) counters.merged += 1;
            else if (saved.created) counters.created += 1;
            if (!state.organizationIds.includes(saved.organizationId)) state.organizationIds.push(saved.organizationId);
            state.samples.push({ username: candidate.username, title: candidate.title, lastPostAt: saved.lastPostAt, organizationId: saved.organizationId, merged: saved.merged });
          } else state.rejected += 1;
        }
        await save(search.id, state, counters);
        continue;
      }

      // Всё собрано → AI-оценка новых карточек тем же путём, что поиск по картам.
      await autoQualifyNew(search.tenantId, state.organizationIds, { explicit: true, max: state.organizationIds.length });
      const empty = counters.found === 0;
      await prisma.telegramSearch.update({
        where: { id: search.id },
        data: {
          ...counters,
          state: state as unknown as Prisma.InputJsonValue,
          status: empty ? "failed" : "completed",
          error: empty ? `Открытых каналов организаций по «${search.niche}» не нашлось (просмотрено ${counters.reads}). Попробуйте другую формулировку ниши.` : null,
          finishedAt: new Date(),
        },
      });
      logEvent("telegram.search.done", { ...base, ...counters, rejected: state.rejected });
      return { done: true };
    }
    return { done: false, delayMs: 500 };
  } catch (error) {
    await save(search.id, state, counters);
    if (error instanceof RetryableError) {
      logEvent("telegram.search.wait", { ...base, delayMs: error.delayMs, reason: error.message }, "warn");
      return { done: false, delayMs: Math.max(5000, error.delayMs) };
    }
    const message = error instanceof Error ? error.message : "Сбой поиска Telegram";
    await fail(search.id, message);
    throw error instanceof ApiError ? new FatalJobError(message) : error;
  }
}

function addCandidates(state: SearchState, peers: TgPeer[], niche: string, city: string | null, phrase: string) {
  for (const peer of peers) {
    const username = peer.username?.toLowerCase();
    if (!username || state.candidates.some((item) => item.username === username)) continue;
    const verdict = judgeChannel(peer, niche, city);
    if (!verdict.ok) continue;
    state.candidates.push({ username, title: peer.title, type: peer.type, members: peer.members ?? null, score: verdict.score, phrase });
  }
}

function aboutOf(peer: unknown): string | null {
  if (!peer || typeof peer !== "object") return null;
  const record = peer as Record<string, unknown>;
  for (const key of ["about", "description", "bio"]) {
    if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]).trim().slice(0, 2000);
  }
  return null;
}

/** Досье канала → карточка (новая или дополненная существующая). null — канал не прошёл отбор. */
async function saveChannel(
  search: { id: string; tenantId: string; niche: string; city: string | null },
  candidate: Candidate,
  history: TgHistory,
) {
  const username = (history.chat?.username || candidate.username).toLowerCase();
  const read = (history.messages ?? [])
    .map((message) => {
      const extra = message as unknown as { entities?: { type?: string; url?: string }[]; forwardedFrom?: unknown };
      return {
        id: message.id,
        date: message.date,
        text: cleanText(message.text || "").slice(0, 1500),
        link: message.link || tgLink(username, message.id),
        media: message.media?.type ?? null,
        forwarded: Boolean(extra.forwardedFrom),
        urls: (extra.entities ?? []).map((entity) => entity.url).filter((url): url is string => typeof url === "string").slice(0, 10),
      };
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, POSTS_PER_CHANNEL);
  // В карточке храним минимум: без ссылок из разметки (они нужны только чтобы найти сайт и контакты).
  const posts: TelegramPost[] = read.map(({ urls: _urls, ...post }) => post);
  // Описание канала Parser API сейчас не отдаёт (ни с постами, ни в resolve); если начнёт — подхватим.
  const about = aboutOf(history.chat);
  const content = judgeContent(about, posts);
  if (!content.ok) return null;

  const title = history.chat?.title || candidate.title;
  const members = history.chat?.members ?? candidate.members ?? null;
  const contacts = channelContacts(about, read, username);
  const dossier = channelDossier(posts);
  const city = search.city && mentionsCity(`${title}\n${about ?? ""}`, search.city) ? search.city : null;
  // Сайт карточки — только «свой» (похож на ник/название); остальные ссылки остаются в досье.
  const website = officialSite(contacts.websites, username, title);
  const telegram = {
    username,
    title,
    members,
    about,
    type: history.chat?.type ?? candidate.type,
    posts,
    dossier,
    contacts,
    checkedAt: new Date().toISOString(),
    foundBy: { searchId: search.id, niche: search.niche, phrase: candidate.phrase },
  };
  const extraContacts = [
    { type: "telegram", value: `@${username}`, label: history.chat?.type === "channel" ? "канал" : "группа" },
    ...contacts.usernames.map((name) => ({ type: "telegram", value: `@${name}`, label: "упомянут в канале" })),
    ...contacts.phones.map((value) => ({ type: "phone", value, label: "из Telegram" })),
    ...contacts.emails.map((value) => ({ type: "email", value, label: "из Telegram" })),
  ];

  const keys = dedupeKeys({ name: title, city, website, phones: contacts.phones, usernames: [username] });
  const duplicate = await findDuplicate(search.tenantId, keys);
  if (duplicate) {
    const existing = await prisma.organization.findUniqueOrThrow({ where: { id: duplicate.organizationId } });
    const raw = existing.raw && typeof existing.raw === "object" && !Array.isArray(existing.raw) ? (existing.raw as Record<string, unknown>) : {};
    const isOwnChannel = existing.source === "telegram" && existing.externalId === `tg:${username}`;
    await prisma.organization.update({
      where: { id: existing.id },
      data: {
        raw: { ...raw, telegram } as Prisma.InputJsonValue,
        ...(isOwnChannel ? { name: title, parserUpdatedAt: new Date() } : {}),
        ...(!existing.website && website ? { website, websiteStatus: classifyWebsite(website) } : {}),
        ...(!existing.description && about ? { description: about } : {}),
        ...(!existing.city && city ? { city } : {}),
      },
    });
    await addContacts(search.tenantId, existing.id, extraContacts);
    logEvent("telegram.search.merge", { search: search.id, channel: username, organizationId: existing.id, by: duplicate.match.by });
    return { organizationId: existing.id, created: false, merged: !isOwnChannel, lastPostAt: dossier.lastPostAt };
  }

  const { organization, created } = await upsertMapped(search.tenantId, {
    externalId: `tg:${username}`,
    source: "telegram",
    name: title,
    city,
    region: null,
    category: search.niche,
    categories: [search.niche],
    address: null,
    website,
    // Нет ссылки на сайт в канале — это не значит, что сайта нет: проверит скан при квалификации.
    websiteStatus: website ? classifyWebsite(website) : "UNCERTAIN",
    rating: null,
    reviewCount: null,
    photoCount: null,
    sourceUrl: tgLink(username),
    lat: null,
    lon: null,
    phones: [],
    emails: [],
    socials: [],
    services: [],
    features: [],
    hours: null,
    description: about,
    legalName: null,
    firstSeenAt: null,
    parserUpdatedAt: new Date().toISOString(),
    raw: { telegram },
  });
  await addContacts(search.tenantId, organization.id, extraContacts);
  return { organizationId: organization.id, created, merged: false, lastPostAt: dossier.lastPostAt };
}

/** Добавить контакты без дублей: телефон в другом формате или ник в другом регистре — тот же контакт. */
async function addContacts(tenantId: string, organizationId: string, contacts: { type: string; value: string; label: string }[]) {
  const existing = await prisma.organizationContact.findMany({ where: { organizationId }, select: { type: true, value: true } });
  const known = new Set(existing.map((item) => contactKey(item.type, item.value)));
  const fresh = contacts.filter((contact) => {
    const key = contactKey(contact.type, contact.value);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (!fresh.length) return;
  await prisma.organizationContact.createMany({
    data: fresh.map((contact) => ({ ...contact, tenantId, organizationId, source: "telegram" })),
    skipDuplicates: true,
  });
}

function contactKey(type: string, value: string) {
  if (type === "phone") return `phone:${phoneTail(value) ?? value}`;
  if (type === "telegram" || /t\.me\//i.test(value)) return `tg:${normalizeUsername(value) ?? value.toLowerCase()}`;
  return `${type}:${value.toLowerCase()}`;
}
