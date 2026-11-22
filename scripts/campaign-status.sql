SELECT type, status, left(coalesce(error, ''), 120) AS error, "createdAt"
FROM "Job"
WHERE "createdAt" >= '2026-11-18T20:08:00Z'
ORDER BY "createdAt" DESC
LIMIT 12;

SELECT status, left(name, 32) AS name, "publicUrl" IS NOT NULL AS pub
FROM "SiteProject"
WHERE "createdAt" >= '2026-11-18T19:52:59Z';

SELECT count(*) AS orgs FROM "Organization" WHERE "isDemo" = false AND "createdAt" >= '2026-11-18T19:52:59Z';
