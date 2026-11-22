SELECT left(name, 28) AS name, status, "publicUrl" IS NOT NULL AS pub, left(coalesce("publicUrl", ''), 70) AS url, "updatedAt"
FROM "SiteProject"
WHERE "createdAt" >= '2026-11-18T19:52:59Z'
ORDER BY "createdAt";

SELECT count(*) AS orgs FROM "Organization" WHERE "isDemo" = false AND "createdAt" >= '2026-11-18T19:52:59Z';

SELECT status, count(*) FROM "ParserTask" WHERE "createdAt" >= '2026-11-18T19:52:59Z' GROUP BY status;

SELECT count(DISTINCT "organizationId") AS offers
FROM "Conversation"
WHERE channel = 'email' AND "createdAt" >= '2026-11-18T19:52:59Z'
  AND EXISTS (
    SELECT 1 FROM "Message" m
    WHERE m."conversationId" = "Conversation".id AND m.direction = 'outbound' AND m.body LIKE '%Демонстрационный сайт:%'
  );

SELECT type, status, count(*) FROM "Job"
WHERE "createdAt" >= '2026-11-18T19:52:59Z' AND status IN ('queued', 'running', 'failed')
GROUP BY type, status
ORDER BY type, status;
