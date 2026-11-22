SELECT right(content, 500) AS tail
FROM "AgentMessage"
WHERE role = 'user'
ORDER BY "createdAt" DESC
LIMIT 1;
