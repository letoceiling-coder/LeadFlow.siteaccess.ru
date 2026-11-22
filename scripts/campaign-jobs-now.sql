SELECT type, status, count(*)
FROM "Job"
WHERE status IN ('queued', 'running', 'cancelled')
  AND "createdAt" >= '2026-11-19T04:00:00Z'
GROUP BY type, status
ORDER BY type, status;

SELECT type, status, "createdAt"
FROM "Job"
WHERE type = 'agent.turn'
ORDER BY "createdAt" DESC
LIMIT 3;
