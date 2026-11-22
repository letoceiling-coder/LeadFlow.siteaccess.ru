SELECT left(p.name, 22) AS name, p.status AS site, r.status AS run, left(coalesce(r.state, ''), 28) AS state, left(coalesce(r.error, ''), 80) AS error
FROM "SiteGenerationRun" r
JOIN "SiteProject" p ON p.id = r."siteProjectId"
WHERE p."createdAt" >= '2026-11-18T19:52:59Z'
ORDER BY r."createdAt" DESC
LIMIT 12;
