SELECT left(name, 28) AS name, status, "studioProjectId" IS NOT NULL AS studio, left(coalesce(error, ''), 160) AS error, "updatedAt"
FROM "SiteProject"
WHERE "createdAt" >= '2026-11-18T19:52:59Z'
ORDER BY "createdAt";

SELECT type, status, attempts, "runAt", left(coalesce(error, ''), 160) AS error
FROM "Job"
WHERE type = 'site.generate' AND status IN ('queued', 'running', 'failed')
ORDER BY "createdAt";
