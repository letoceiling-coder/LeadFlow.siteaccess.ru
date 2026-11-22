SELECT role, "toolName", left(content, 300) AS content, "createdAt"
FROM "AgentMessage"
ORDER BY "createdAt" DESC
LIMIT 6;

SELECT left(p.name, 22) AS name, r.status, left(coalesce(r.state, ''), 32) AS state, left(coalesce(r.error, ''), 80) AS error
FROM "SiteGenerationRun" r
JOIN "SiteProject" p ON p.id = r."siteProjectId"
WHERE p."createdAt" >= '2026-11-18T19:52:59Z'
ORDER BY r."createdAt" DESC
LIMIT 6;
