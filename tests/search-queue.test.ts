import { beforeEach, describe, expect, it, vi } from "vitest";
import { holdsSlot, isWaiting, pickNext, queueInfo, sourcesOf, type QueueTask } from "@/lib/domain/search-queue";
import { defaultSources, findNichePreset, nichePresetGroups, nichePresets } from "@/lib/domain/niche-presets";

/* ───────────── Чистая логика очереди ───────────── */

const at = (min: number) => new Date(Date.UTC(2026, 10, 27, 8, min));
const NOW = at(30).getTime();
const task = (id: string, extra: Partial<QueueTask> = {}): QueueTask => ({ id, type: "organizations.collect", status: "queued", externalId: null, dispatchedAt: null, createdAt: at(Number(id.replace(/\D/g, "")) || 0), ...extra });

describe("очередь поисков: кто уходит в парсер", () => {
  it("пустое место — первый по времени постановки", () => {
    expect(pickNext([task("t3"), task("t1"), task("t2")], NOW)?.id).toBe("t1");
  });

  it("пока сбор у парсера, следующий ждёт", () => {
    const list = [task("t1", { status: "running", externalId: "ext", dispatchedAt: at(1) }), task("t2")];
    expect(pickNext(list, NOW)).toBeNull();
  });

  it("сбор отдан парсеру, но номер ещё не вернулся (429, повтор) — место всё равно занято", () => {
    expect(pickNext([task("t1", { dispatchedAt: at(1) }), task("t2")], NOW)).toBeNull();
  });

  it("предыдущий закончился (готово / ошибка / отменён) — следующий уходит", () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      const list = [task("t1", { status, externalId: "ext", dispatchedAt: at(1) }), task("t2")];
      expect(pickNext(list, NOW)?.id).toBe("t2");
    }
  });

  it("старый сбор, отданный до появления очереди (только externalId), тоже занимает место", () => {
    expect(pickNext([task("t1", { status: "running", externalId: "ext" }), task("t2")], NOW)).toBeNull();
  });

  it("зависший больше 6 часов сбор не держит очередь вечно", () => {
    const stale = task("t1", { status: "running", externalId: "ext", dispatchedAt: at(0), createdAt: new Date(NOW - 7 * 60 * 60 * 1000) });
    expect(holdsSlot(stale, NOW)).toBe(false);
    expect(pickNext([stale, task("t2")], NOW)?.id).toBe("t2");
  });

  it("другие типы задач парсера очередь карт не трогает", () => {
    expect(isWaiting(task("t1", { type: "yandex.orgs" }))).toBe(false);
    expect(pickNext([task("t1", { type: "yandex.orgs", status: "running", externalId: "x" }), task("t2")], NOW)?.id).toBe("t2");
  });

  it("номера и подписи: №1 у парсера, дальше по порядку", () => {
    const info = queueInfo([task("t1", { status: "running", externalId: "ext", dispatchedAt: at(1) }), task("t3"), task("t2")], NOW);
    expect(info.get("t1")).toMatchObject({ position: 1, state: "collecting", label: "собирает" });
    expect(info.get("t2")).toMatchObject({ position: 2, state: "waiting", label: "в очереди №2" });
    expect(info.get("t3")).toMatchObject({ position: 3, label: "в очереди №3" });
  });

  it("свободная очередь: первый ждущий — №1", () => {
    expect(queueInfo([task("t2")], NOW).get("t2")?.position).toBe(1);
  });

  it("повтор после пустой выдачи — «повтор на другом сервере»", () => {
    const info = queueInfo([task("t1", { dispatchedAt: at(1), input: { attempts: [{ workerId: "w1" }] } })], NOW);
    expect(info.get("t1")).toMatchObject({ state: "retrying", attempt: 2 });
    expect(info.get("t1")?.label).toMatch(/повтор на другом сервере/);
  });

  it("источники: старые поиски — карты и сайты, лишнее отбрасывается", () => {
    expect(sourcesOf({})).toEqual(["maps", "sites"]);
    expect(sourcesOf({ sources: ["maps"] })).toEqual(["maps"]);
    expect(sourcesOf({ sources: ["maps", "vk"] })).toEqual(["maps"]);
    expect(sourcesOf({ sources: [] })).toEqual(["maps", "sites"]);
  });
});

/* ───────────── Пресеты ниш ───────────── */

describe("пресеты ниш по сегментам брифа", () => {
  it("четыре сегмента А, Б, В, Г, в каждом есть ниши", () => {
    const groups = nichePresetGroups();
    expect(groups.map((group) => group.id)).toEqual(["А", "Б", "В", "Г"]);
    for (const group of groups) expect(group.niches.length).toBeGreaterThan(0);
  });

  it("ниши из брифа на месте", () => {
    const labels = nichePresets().map((item) => item.label.toLowerCase());
    for (const name of ["благотворительный фонд", "нко", "музей", "выставочная компания", "доставка еды", "мебель на заказ", "детский медицинский центр", "автосервис", "склады в аренду", "коммерческая недвижимость", "строительная компания"]) {
      expect(labels).toContain(name);
    }
  });

  it("у каждой ниши есть источники, без повторов и только известные", () => {
    for (const item of nichePresets()) {
      expect(item.sources.length).toBeGreaterThan(0);
      expect(new Set(item.sources).size).toBe(item.sources.length);
      for (const source of item.sources) expect(["maps", "sites", "telegram"]).toContain(source);
      // «Сайты» — скан сайтов найденных на картах: без карт не бывает.
      if (item.sources.includes("sites") && !item.sources.includes("telegram")) expect(item.sources).toContain("maps");
    }
  });

  it("фонды ищем в Telegram, малый бизнес — на картах", () => {
    expect(defaultSources("Благотворительный фонд")).toContain("telegram");
    expect(defaultSources("автосервис")).toEqual(["maps", "sites"]);
    expect(findNichePreset("Своя ниша")).toBeNull();
    expect(defaultSources("Своя ниша")).toEqual(["maps", "sites"]);
  });

  it("копия: правка результата не портит пресеты", () => {
    nichePresets()[0].sources.push("maps");
    expect(new Set(nichePresets()[0].sources).size).toBe(nichePresets()[0].sources.length);
  });
});

/* ───────────── Сервис: очередь на «базе в памяти» ───────────── */

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown> & { id: string };
const db = { tasks: [] as Row[], seq: 0 };
const parser = { collect: vi.fn(), collectStatus: vi.fn(), cancelTask: vi.fn() };
const jobs: { type: string; payload: unknown }[] = [];

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, unknown>[]).some((item) => matches(row, item));
    if (key === "NOT") return !matches(row, cond as Record<string, unknown>);
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; notIn?: unknown[]; gte?: Date; startsWith?: string };
      if (c.in) return c.in.includes(value);
      if (c.notIn) return !c.notIn.includes(value);
      if (c.gte) return value instanceof Date && value >= c.gte;
      if (c.startsWith) return typeof value === "string" && value.startsWith(c.startsWith);
      return true;
    }
    return (value ?? null) === (cond ?? null);
  });
}

const parserTask = {
  create: async ({ data }: { data: Row }) => {
    const row = { status: "queued", progress: 0, externalId: null, dispatchedAt: null, error: null, syncedAt: null, completedAt: null, organizationCount: null, resultSummary: null, startedAt: null, ...data, id: `t${++db.seq}`, createdAt: new Date(Date.now() + db.seq) };
    db.tasks.push(row);
    return { ...row };
  },
  findFirst: async ({ where }: { where: Record<string, unknown> }) => db.tasks.find((row) => matches(row, where)) ?? null,
  findUnique: async ({ where }: { where: { id: string } }) => db.tasks.find((row) => row.id === where.id) ?? null,
  findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
    const row = db.tasks.find((item) => item.id === where.id);
    if (!row) throw new Error("not found");
    return { ...row };
  },
  findMany: async ({ where }: { where: Record<string, unknown> }) => db.tasks.filter((row) => matches(row, where)).map((row) => ({ ...row })),
  update: async ({ where, data }: { where: { id: string }; data: Row }) => {
    const row = db.tasks.find((item) => item.id === where.id)!;
    Object.assign(row, data);
    return { ...row };
  },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
    const rows = db.tasks.filter((row) => matches(row, where));
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  },
  deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
    const before = db.tasks.length;
    db.tasks = db.tasks.filter((row) => !matches(row, where));
    return { count: before - db.tasks.length };
  },
};
const fakePrisma = { parserTask, $executeRaw: async () => 0, $transaction: async (fn: (tx: unknown) => unknown) => fn(fakePrisma) };

vi.mock("@/lib/db", () => ({ prisma: fakePrisma }));
vi.mock("@/lib/integrations/config", () => ({ requireReady: async () => ({ config: { baseUrl: "http://parser" }, secrets: { apiKey: "k" } }), isReady: async () => true }));
vi.mock("@/lib/integrations/parser", () => ({
  ParserClient: class {
    collect = parser.collect;
    collectStatus = parser.collectStatus;
    cancelTask = parser.cancelTask;
  },
  asTask: (body: unknown) => body,
}));
vi.mock("@/lib/jobs/queue", () => ({ enqueueJob: async (job: { type: string; payload: unknown }) => { jobs.push(job); return job; } }));
vi.mock("@/lib/services/common", () => ({ audit: async () => undefined, notify: async () => undefined }));
vi.mock("@/lib/services/organizations", () => ({ upsertMapped: async () => ({ created: true, organization: { id: "o" } }) }));

const search = (category: string) => ({ city: "Казань", region: "", category, searchQuery: "", maxResults: 20, includePhotos: false, outputFormat: "json" as const, force: true, confirmLarge: false });
const row = (id: string) => db.tasks.find((item) => item.id === id)!;

describe("очередь поисков: сервис", () => {
  beforeEach(() => {
    db.tasks = [];
    db.seq = 0;
    jobs.length = 0;
    parser.collect.mockReset();
    parser.collectStatus.mockReset();
    parser.cancelTask.mockReset();
    let n = 0;
    parser.collect.mockImplementation(async () => ({ taskId: `ext-${++n}`, status: { status: "queued", progress: 0 } }));
  });

  it("две ниши подряд: первая уходит в парсер, вторая ждёт №2; после завершения первой — уходит вторая", async () => {
    const { createSearch, pumpSearchQueue } = await import("@/lib/services/parser");
    const first = await createSearch("ten", "u", search("Музей"));
    const second = await createSearch("ten", "u", search("Благотворительный фонд"));
    expect(first).toMatchObject({ queued: false, position: 1 });
    expect(second).toMatchObject({ queued: true, position: 2 });
    expect(parser.collect).toHaveBeenCalledTimes(1);
    expect(row(second.task.id)).toMatchObject({ status: "queued", externalId: null, dispatchedAt: null });

    // Повторный толчок очереди, пока первый идёт, ничего не отправляет (никаких 429).
    await pumpSearchQueue("ten");
    expect(parser.collect).toHaveBeenCalledTimes(1);

    Object.assign(row(first.task.id), { status: "completed" });
    await pumpSearchQueue("ten");
    expect(parser.collect).toHaveBeenCalledTimes(2);
    expect(row(second.task.id)).toMatchObject({ externalId: "ext-2" });
    expect(jobs.some((job) => job.type === "parser.poll" && (job.payload as { parserTaskId: string }).parserTaskId === second.task.id)).toBe(true);
  });

  it("отмена ждущего: в парсер он не уходит, следующий занимает его место", async () => {
    const { createSearch, cancelSearch, pumpSearchQueue } = await import("@/lib/services/parser");
    const a = await createSearch("ten", "u", search("Музей"));
    const b = await createSearch("ten", "u", search("НКО"));
    const c = await createSearch("ten", "u", search("Выставочная компания"));
    await cancelSearch("ten", b.task.id, "u");
    expect(row(b.task.id).status).toBe("cancelled");
    expect(parser.cancelTask).not.toHaveBeenCalled();

    Object.assign(row(a.task.id), { status: "failed" });
    await pumpSearchQueue("ten");
    expect(parser.collect).toHaveBeenCalledTimes(2);
    expect(row(c.task.id).externalId).toBe("ext-2");
    expect(row(b.task.id).externalId).toBeNull();
  });

  it("отмена идущего сбора сразу отдаёт место следующему", async () => {
    const { createSearch, cancelSearch } = await import("@/lib/services/parser");
    const a = await createSearch("ten", "u", search("Музей"));
    const b = await createSearch("ten", "u", search("НКО"));
    await cancelSearch("ten", a.task.id, "u");
    expect(parser.cancelTask).toHaveBeenCalledWith("ext-1");
    expect(row(b.task.id).externalId).toBe("ext-2");
  });

  it("удаление из очереди: отменяет и убирает запись", async () => {
    const { createSearch, removeFromQueue } = await import("@/lib/services/parser");
    await createSearch("ten", "u", search("Музей"));
    const b = await createSearch("ten", "u", search("НКО"));
    await removeFromQueue("ten", b.task.id, "u");
    expect(db.tasks.find((item) => item.id === b.task.id)).toBeUndefined();
  });

  it("пустая выдача: повтор держит место, после последней попытки — ошибка и очередь идёт дальше", async () => {
    const { createSearch, refreshParserTask, pumpSearchQueue, EMPTY_COLLECT_ATTEMPTS } = await import("@/lib/services/parser");
    const a = await createSearch("ten", "u", search("Музей"));
    const b = await createSearch("ten", "u", search("НКО"));
    parser.collectStatus.mockResolvedValue({ status: "completed", counts: { collected: 0 }, workerId: "w" });

    await refreshParserTask("ten", a.task.id);
    // Первая пустая — повтор того же поиска на другом сервере; второй в очереди всё ещё ждёт.
    expect(row(a.task.id)).toMatchObject({ status: "queued", externalId: "ext-2" });
    expect(row(b.task.id).externalId).toBeNull();
    await pumpSearchQueue("ten");
    expect(row(b.task.id).externalId).toBeNull();

    for (let i = 1; i < EMPTY_COLLECT_ATTEMPTS; i += 1) await refreshParserTask("ten", a.task.id);
    expect(row(a.task.id).status).toBe("failed");
    expect(String(row(a.task.id).error)).toMatch(/повторите поиск/);

    // Опрос после ошибки толкает очередь — второй уходит в парсер.
    await pumpSearchQueue("ten");
    expect(row(b.task.id).externalId).toBeTruthy();
  });

  it("парсер ответил «занят» (429): место за сбором, повтор отправки — отдельной задачей, второй не уходит", async () => {
    const { RetryableError } = await import("@/lib/errors");
    const { createSearch } = await import("@/lib/services/parser");
    parser.collect.mockRejectedValueOnce(new RetryableError("занят", 30000));
    const a = await createSearch("ten", "u", search("Музей"));
    const b = await createSearch("ten", "u", search("НКО"));
    expect(row(a.task.id)).toMatchObject({ status: "queued", externalId: null });
    expect(row(a.task.id).dispatchedAt).toBeTruthy();
    expect(jobs.some((job) => job.type === "parser.submit")).toBe(true);
    expect(row(b.task.id).dispatchedAt).toBeNull();
    expect(parser.collect).toHaveBeenCalledTimes(1);
  });

  it("окончательная ошибка отправки: сбор «ошибка», следующий не застревает", async () => {
    const { ApiError } = await import("@/lib/errors");
    const { createSearch } = await import("@/lib/services/parser");
    const a = await createSearch("ten", "u", search("Музей"));
    parser.collect.mockRejectedValueOnce(new ApiError(400, "Плохой запрос", "bad"));
    Object.assign(row(a.task.id), { status: "completed" });
    const b = await createSearch("ten", "u", search("НКО")).catch((error: Error) => error);
    expect(b).toBeInstanceOf(Error);
    const c = await createSearch("ten", "u", search("Выставочная компания"));
    expect(row(c.task.id).externalId).toBeTruthy();
  });
});
