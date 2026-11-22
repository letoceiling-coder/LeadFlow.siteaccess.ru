import { classifyWebsite } from "./website";

export type MappedOrganization = {
  externalId: string | null;
  source: string;
  name: string;
  city: string | null;
  region: string | null;
  category: string | null;
  categories: string[];
  address: string | null;
  website: string | null;
  websiteStatus: string;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
  sourceUrl: string | null;
  lat: number | null;
  lon: number | null;
  phones: string[];
  emails: string[];
  socials: string[];
  services: string[];
  features: string[];
  hours: unknown;
  description: string | null;
  legalName: string | null;
  firstSeenAt: string | null;
  parserUpdatedAt: string | null;
  raw: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = text(value);
    return single ? [single] : [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) result.push(item.trim());
    else if (asRecord(item)) {
      const record = asRecord(item)!;
      const label = text(record.name) || text(record.title) || text(record.value) || text(record.phone) || text(record.email);
      if (label) result.push(label);
    }
  }
  return Array.from(new Set(result));
}

function photosCount(source: Record<string, unknown>): number | null {
  if (typeof source.photoCount === "number") return source.photoCount;
  if (Array.isArray(source.photos)) return source.photos.length;
  if (Array.isArray(source.images)) return source.images.length;
  return null;
}

export function mapParserOrganization(input: unknown): MappedOrganization | null {
  const item = asRecord(input);
  if (!item) return null;
  const card = asRecord(item.card) ?? {};
  const source = { ...card, ...item };
  const name = text(source.name) || text(source.title);
  if (!name) return null;
  const coordinates = asRecord(source.coordinates);
  const website = text(source.website) || text(source.url) || text(source.site);
  const phones = strings(source.phones ?? source.phone);
  const emails = strings(source.emails ?? source.email).filter((value) => value.includes("@"));
  const externalId = text(source.externalId) || text(item.externalId) || null;
  return {
    externalId,
    source: text(source.source) || "yandex",
    name,
    city: text(source.city),
    region: text(source.region),
    category: text(source.category),
    categories: strings(source.categories),
    address: text(source.address),
    website,
    websiteStatus: classifyWebsite(website),
    rating: number(source.rating),
    reviewCount: number(source.reviewCount ?? source.reviewsCount ?? source.reviews),
    photoCount: photosCount(source),
    sourceUrl: text(source.sourceUrl) || text(source.mapsUrl),
    lat: number(coordinates?.lat),
    lon: number(coordinates?.lon ?? coordinates?.lng),
    phones,
    emails,
    socials: strings(source.socials ?? source.socialLinks),
    services: strings(source.services),
    features: strings(source.features),
    hours: source.workingHours ?? source.hours ?? null,
    description: text(source.description),
    legalName: text(source.legalName) || text(source.companyName),
    firstSeenAt: text(source.firstSeenAt),
    parserUpdatedAt: text(source.updatedAt),
    raw: item,
  };
}

export function fallbackExternalId(name: string, city: string | null, address: string | null): string {
  const normalized = `${name}|${city ?? ""}|${address ?? ""}`.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  return `local:${normalized}`;
}
