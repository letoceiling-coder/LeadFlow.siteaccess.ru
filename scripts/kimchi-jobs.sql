SELECT type, status, left(coalesce(error, ''), 160) AS error, "createdAt", "finishedAt"
FROM "Job"
WHERE payload::text LIKE '%cmwmo8ypk02jns50uowqquivo%'
ORDER BY "createdAt";

SELECT action, "createdAt", meta
FROM "AuditLog"
WHERE "entityId" = 'cmwmo8ypk02jns50uowqquivo'
ORDER BY "createdAt";
