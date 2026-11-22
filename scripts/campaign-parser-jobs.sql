SELECT type, status, attempts, "runAt", left(coalesce(error, ''), 140) AS error
FROM "Job"
WHERE type LIKE 'parser%' AND status IN ('queued', 'running', 'failed')
ORDER BY "createdAt" DESC
LIMIT 8;
