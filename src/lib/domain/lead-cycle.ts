import { NOT_FOUND, chatTargets, channelsOf, checkHook, gradeOf, hookFromPost, postFacts, reasonOf, siteVerdict, type Dossier } from "./dossier";
import { buildDrafts, type Drafts } from "./drafts";
import type { ObservationCard, QualifyFacts, QualifyResult } from "./qualify";
import { detectPreset, presetInfo } from "./segments";

/** Сборка досье, оценки A/B/C и двух черновиков после квалификации. Без AI работает по данным источника. */
export function assembleLead(input: {
  facts: QualifyFacts;
  card: ObservationCard;
  ai: QualifyResult | null;
  raw: unknown;
  contacts: { type: string; value: string }[];
  description?: string | null;
}): { dossier: Dossier; drafts: Drafts } {
  const { facts, card, ai } = input;
  const preset = detectPreset({ segment: card.segment, name: facts.name, category: facts.category, categories: facts.categories, description: input.description ?? facts.description });
  const posts = facts.posts ?? postFacts(input.raw);
  const site = siteVerdict({ websiteStatus: facts.websiteStatus, website: facts.website, site: facts.site ?? null });
  const channels = channelsOf(input.contacts, input.raw);
  const direct = channels.some((item) => item.direct);
  const source = JSON.stringify({ ...facts, posts });
  const aiHook = checkHook(ai?.hook, source, site.verdict !== "none");
  const postHook = aiHook ? null : hookFromPost(posts);
  // Жалоба из отзывов — проверяемый факт про то, как теряются клиенты: годится зацепкой для малого бизнеса.
  const complaint = preset === "В" || preset == null ? card.chaos.find((item) => item.source === "reviews")?.text ?? null : null;
  const hook = aiHook ?? postHook ?? complaint ?? NOT_FOUND;
  const hookSource: Dossier["hookSource"] = aiHook ? "ai" : postHook ? "post" : complaint ? "reviews" : null;
  const graded = gradeOf({ hook, direct, site: site.verdict, preset, blocked: card.chain === true || ai?.irrelevant === true });
  const topic = ai?.topic?.trim() || null;
  const dossier: Dossier = { preset, site, channels, lastPost: posts[0] ?? null, reason: reasonOf(posts, card.growth), hook, hookSource, topic, grade: graded.grade, gradeWhy: graded.why };
  return { dossier, drafts: buildDrafts({ preset, hook, topic, category: facts.category, segment: card.segment }) };
}

export function presetLabel(id: string | null | undefined) {
  const preset = presetInfo(id);
  return preset ? `${preset.id}. ${preset.short}` : null;
}

export { chatTargets };
