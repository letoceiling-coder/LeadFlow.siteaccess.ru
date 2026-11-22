export const DEFAULT_WEIGHTS = {
  noWebsite: 25,
  hasPhone: 10,
  hasEmail: 10,
  goodRating: 10,
  manyReviews: 10,
  completeCard: 10,
  hasPhotos: 5,
  clearServices: 10,
  commercialPotential: 10,
} as const;

export type ScoreKey = keyof typeof DEFAULT_WEIGHTS;
export type ScoreWeights = Record<ScoreKey, number>;

export type ScoreInput = {
  websiteStatus: string;
  hasPhone: boolean;
  hasEmail: boolean;
  rating: number | null;
  reviewCount: number | null;
  hasAddress: boolean;
  hasCategory: boolean;
  photoCount: number | null;
  services: string[];
  /** null — оценка не выполнялась и баллы не начисляются */
  commercialPotential: boolean | null;
};

export type ScoreFactor = {
  key: ScoreKey;
  points: number;
  max: number;
  hit: boolean;
  reason: string;
  kind: "fact" | "assessment" | "unknown";
};

const LABELS: Record<ScoreKey, string> = {
  noWebsite: "Нет собственного сайта",
  hasPhone: "Есть телефон",
  hasEmail: "Есть email",
  goodRating: "Рейтинг от 4.0",
  manyReviews: "От 20 отзывов",
  completeCard: "Карточка достаточно полная",
  hasPhotos: "Есть фотографии в источнике",
  clearServices: "Услуги указаны в источнике",
  commercialPotential: "Потенциальная ценность сайта",
};

export function normalizeWeights(input: Partial<ScoreWeights> | null | undefined): ScoreWeights {
  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS };
  if (!input) return weights;
  for (const key of Object.keys(weights) as ScoreKey[]) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      weights[key] = Math.round(value);
    }
  }
  return weights;
}

export function weightSum(weights: ScoreWeights): number {
  return (Object.keys(weights) as ScoreKey[]).reduce((sum, key) => sum + weights[key], 0);
}

export function validateWeights(weights: ScoreWeights): string | null {
  if ((Object.values(weights) as number[]).some((value) => value < 0 || value > 100)) {
    return "Вес каждого фактора должен быть от 0 до 100";
  }
  if (weightSum(weights) > 100) return "Сумма весов не должна превышать 100";
  return null;
}

export function computeLeadScore(input: ScoreInput, rawWeights?: Partial<ScoreWeights>) {
  const weights = normalizeWeights(rawWeights);
  const factors: ScoreFactor[] = [];

  const push = (key: ScoreKey, hit: boolean, reason: string, kind: ScoreFactor["kind"]) => {
    factors.push({
      key,
      points: hit ? weights[key] : 0,
      max: weights[key],
      hit,
      reason,
      kind,
    });
  };

  push(
    "noWebsite",
    input.websiteStatus === "NO_WEBSITE",
    input.websiteStatus === "NO_WEBSITE"
      ? "В карточке нет собственного сайта"
      : `Статус сайта: ${input.websiteStatus}. Балл за отсутствие сайта не начислен`,
    "fact",
  );
  push("hasPhone", input.hasPhone, input.hasPhone ? "Телефон есть в данных источника" : "Телефон не найден", "fact");
  push("hasEmail", input.hasEmail, input.hasEmail ? "Email есть в данных источника" : "Email не найден", "fact");
  push(
    "goodRating",
    (input.rating ?? 0) >= 4,
    input.rating == null ? "Рейтинг неизвестен" : `Рейтинг ${input.rating}`,
    input.rating == null ? "unknown" : "fact",
  );
  push(
    "manyReviews",
    (input.reviewCount ?? 0) >= 20,
    input.reviewCount == null ? "Число отзывов неизвестно" : `Отзывов: ${input.reviewCount}`,
    input.reviewCount == null ? "unknown" : "fact",
  );
  const complete = input.hasAddress && input.hasCategory && (input.hasPhone || input.hasEmail);
  push(
    "completeCard",
    complete,
    complete ? "Есть адрес, категория и хотя бы один контакт" : "Не хватает адреса, категории или контакта",
    "fact",
  );
  push(
    "hasPhotos",
    (input.photoCount ?? 0) > 0,
    input.photoCount == null ? "Наличие фотографий неизвестно" : input.photoCount > 0 ? `Фотографий: ${input.photoCount}` : "Фотографии не переданы",
    input.photoCount == null ? "unknown" : "fact",
  );
  push(
    "clearServices",
    input.services.length > 0,
    input.services.length > 0 ? "Услуги взяты из данных источника" : "Список услуг в источнике не найден",
    "fact",
  );
  push(
    "commercialPotential",
    input.commercialPotential === true,
    input.commercialPotential == null
      ? "AI-оценка потенциала не выполнялась"
      : input.commercialPotential
        ? "Модель оценила потенциал сайта как заметный. Это оценка, не факт и не готовность купить"
        : "Модель не увидела заметного потенциала",
    input.commercialPotential == null ? "unknown" : "assessment",
  );

  const score = Math.max(0, Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0)));
  const priority = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return {
    score,
    priority,
    factors,
    weights,
    labels: LABELS,
    disclaimer: "Оценка показывает приоритет для ручной работы. Это не гарантия, что организация готова купить сайт.",
  };
}
