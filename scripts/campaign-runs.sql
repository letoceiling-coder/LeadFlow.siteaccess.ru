SELECT left(p.name, 24) AS name, r.status, left(coalesce(r.state, ''), 40) AS state, left(coalesce(r."replyText", ''), 140) AS reply
FROM "SiteGenerationRun" r
JOIN "SiteProject" p ON p.id = r."siteProjectId"
WHERE p."createdAt" >= '2026-11-18T19:52:59Z'
ORDER BY r."createdAt" DESC;

SELECT status, count(*) FROM "ParserTask" WHERE "createdAt" >= '2026-11-18T19:52:59Z' GROUP BY status;
