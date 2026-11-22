SELECT left(name, 28) AS name, status, "publicUrl" IS NOT NULL AS pub, left(coalesce("publicUrl", ''), 80) AS url
FROM "SiteProject"
WHERE "createdAt" >= '2026-11-18T19:52:59Z'
ORDER BY "createdAt";

SELECT count(*) AS orgs FROM "Organization" WHERE "isDemo" = false AND "createdAt" >= '2026-11-18T19:52:59Z';

SELECT status, count(*) FROM "ParserTask" WHERE "createdAt" >= '2026-11-18T19:52:59Z' GROUP BY status;
