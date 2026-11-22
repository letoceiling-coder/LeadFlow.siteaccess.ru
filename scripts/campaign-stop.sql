UPDATE "Job"
SET status = 'cancelled', "finishedAt" = now(), error = 'остановлено: новые задания агенту не запускаем'
WHERE type = 'agent.turn' AND status = 'queued';

SELECT type, status, count(*)
FROM "Job"
WHERE status IN ('queued', 'running')
GROUP BY type, status
ORDER BY type, status;
