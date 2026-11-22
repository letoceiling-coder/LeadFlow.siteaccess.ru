import { TASK_MODEL } from "./models";
import type { ReplyContacts } from "./offer";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "./scoring";

export type TenantSettings = {
  automationMode: "manual" | "semi" | "auto";
  budgets: { perOperationUsd: number; dailyUsd: number; monthlyUsd: number };
  scoreWeights: ScoreWeights;
  confirm: { bulkDemo: boolean; expensiveAi: boolean; bulkChanges: boolean };
  ai: {
    qualifyModel: string;
    briefModel: string;
    messageModel: string;
    agentModel: string;
    maxCostPerAnalysisUsd: number;
    maxCostPerBriefUsd: number;
  };
  communication: { maxPerOrgPerDays: number; windowDays: number };
  reply: ReplyContacts;
  retentionDays: number;
  demoMode: boolean;
};

export const DEFAULT_SETTINGS: TenantSettings = {
  automationMode: "semi",
  budgets: { perOperationUsd: 1, dailyUsd: 20, monthlyUsd: 200 },
  scoreWeights: { ...DEFAULT_WEIGHTS },
  confirm: { bulkDemo: true, expensiveAi: true, bulkChanges: true },
  ai: {
    qualifyModel: TASK_MODEL.analysis,
    briefModel: TASK_MODEL.brief,
    messageModel: TASK_MODEL.message,
    agentModel: TASK_MODEL.agent,
    maxCostPerAnalysisUsd: 0.05,
    maxCostPerBriefUsd: 0.2,
  },
  communication: { maxPerOrgPerDays: 1, windowDays: 14 },
  reply: { phone: "", telegram: "", max: "", email: "" },
  retentionDays: 365,
  demoMode: false,
};

export function mergeSettings(value: unknown): TenantSettings {
  const source = value && typeof value === "object" ? (value as Partial<TenantSettings>) : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    budgets: { ...DEFAULT_SETTINGS.budgets, ...(source.budgets ?? {}) },
    scoreWeights: { ...DEFAULT_SETTINGS.scoreWeights, ...(source.scoreWeights ?? {}) },
    confirm: { ...DEFAULT_SETTINGS.confirm, ...(source.confirm ?? {}) },
    ai: { ...DEFAULT_SETTINGS.ai, ...(source.ai ?? {}) },
    communication: { ...DEFAULT_SETTINGS.communication, ...(source.communication ?? {}) },
    reply: { ...DEFAULT_SETTINGS.reply, ...(source.reply ?? {}) },
  };
}
