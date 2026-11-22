SELECT type, status, attempts, "runAt", left(coalesce(error, ''), 140) AS error
FROM "Job"
WHERE type IN ('site.generate', 'parser.poll', 'parser.submit')
  AND status IN ('queued', 'running', 'failed')
ORDER BY "createdAt";
