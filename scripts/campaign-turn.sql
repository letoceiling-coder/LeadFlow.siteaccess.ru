SELECT j.id, j.status, j."createdAt", left(m.content, 180) AS task
FROM "Job" j
JOIN "AgentMessage" m ON m."threadId" = j.payload->>'threadId' AND m.role = 'user'
WHERE j.type = 'agent.turn' AND j.status = 'running'
ORDER BY m."createdAt" DESC
LIMIT 1;
