import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(200).regex(/[A-Za-zА-Яа-я]/).regex(/[0-9]/),
  workspaceName: z.string().trim().min(2).max(80),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

const city = z.string().trim().min(1).max(120);
const category = z.string().trim().min(1).max(120);

export const searchSchema = z.object({
  city,
  region: z.string().trim().max(120).optional().default(""),
  category,
  searchQuery: z.string().trim().max(300).optional().default(""),
  maxResults: z.coerce.number().int().min(1).max(500),
  need: z.coerce.number().int().min(0).max(30).optional(),
  noWebsite: z.boolean().optional(),
  contactAny: z.array(z.string().max(40)).max(8).optional(),
  includePhotos: z.boolean().optional().default(false),
  outputFormat: z.enum(["json", "csv"]).optional().default("json"),
  force: z.boolean().optional().default(false),
  confirmLarge: z.boolean().optional().default(false),
  /** S4: источники поиска. «sites» — открывать сайты найденных при оценке; «telegram» запускается отдельно. */
  sources: z.array(z.enum(["maps", "sites", "telegram"])).max(3).optional(),
});

export const batchSearchSchema = searchSchema.omit({ city: true }).extend({
  cities: z.array(city).min(1).max(20),
});

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  params: searchSchema,
});

export const syncSchema = z.object({
  city: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  q: z.string().trim().max(200).optional(),
  hasPhone: z.boolean().optional(),
  hasWebsite: z.boolean().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minReviews: z.coerce.number().int().min(0).optional(),
  updatedSince: z.string().datetime().optional(),
  taskId: z.string().max(80).optional(),
  confirmLarge: z.boolean().optional().default(false),
});

export const manualOrgSchema = z.object({
  name: z.string().trim().min(2).max(200),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  website: z.string().trim().max(300).optional(),
  sourceUrl: z.string().trim().url().optional().or(z.literal("")),
});

export const orgPatchSchema = z.object({
  assigneeId: z.string().nullable().optional(),
  processingStatus: z.string().max(40).optional(),
  stageKey: z.string().max(40).optional(),
});

export const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const bulkSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["assign", "analyze", "score", "create_demo"]),
  assigneeId: z.string().optional(),
  confirmLarge: z.boolean().optional(),
  siteType: z.string().optional(),
});

export const analysisSchema = z.object({
  organizationIds: z.array(z.string()).min(1).max(50),
  confirmLarge: z.boolean().optional(),
});

export const siteCreateSchema = z.object({
  organizationId: z.string().min(1),
  siteType: z.string().min(1).max(40),
  language: z.string().min(2).max(8).default("ru"),
  style: z.string().max(120).optional(),
  pages: z.array(z.string().max(80)).max(20).optional().default([]),
  wishes: z.string().max(4000).optional(),
  confirm: z.boolean().optional(),
});

export const agentReplySchema = z.object({
  text: z.string().trim().min(1).max(20000),
});

export const publishSchema = z.object({
  confirm: z.literal(true),
  visibility: z.enum(["private", "public"]),
  acknowledgeDemo: z.literal(true),
});

export const messageDraftSchema = z.object({
  organizationId: z.string(),
  channel: z.enum(["email", "telegram", "whatsapp", "sms", "test"]),
  templateId: z.string().optional(),
  body: z.string().max(8000).optional(),
  useAi: z.boolean().optional(),
});

export const approveSchema = z.object({
  lawfulBasis: z.enum(["consent", "contract", "other_lawful"]),
  basisNote: z.string().max(1000).optional(),
  organizationId: z.string().optional(),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.enum(["email", "telegram", "whatsapp", "sms", "test"]),
  templateId: z.string().optional(),
  filters: z.record(z.unknown()).default({}),
  lawfulBasis: z.enum(["consent", "contract", "other_lawful"]).optional(),
  basisNote: z.string().max(1000).optional(),
});

export const automationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(1000).optional(),
  active: z.boolean().default(false),
  trigger: z.string(),
  conditions: z.object({
    all: z.array(z.object({ field: z.string(), op: z.enum(["eq", "neq", "gte", "lte", "exists"]), value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional() })).optional(),
    any: z.array(z.object({ field: z.string(), op: z.enum(["eq", "neq", "gte", "lte", "exists"]), value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional() })).optional(),
  }),
  actions: z.array(z.object({ type: z.string(), params: z.record(z.unknown()).optional() })).min(1),
  intervalMinutes: z.number().int().optional().nullable(),
});

export const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["ADMIN", "MANAGER", "ANALYST", "OPERATOR", "VIEWER"]),
});

export const integrationSchema = z.object({
  config: z.record(z.unknown()).optional(),
  secrets: z.record(z.string()).optional(),
});

export function needsLargeConfirm(maxResults: number, count = 1): boolean {
  return maxResults >= 200 || count >= 5 || maxResults * count > 200;
}
