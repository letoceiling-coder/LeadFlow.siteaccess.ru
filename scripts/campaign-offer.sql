SELECT c."organizationId", c.subject, m.direction, m.status, m."sentAt" IS NOT NULL AS sent, left(m.body, 500) AS body
FROM "Conversation" c
JOIN "Message" m ON m."conversationId" = c.id
WHERE c."createdAt" >= '2026-11-18T19:52:59Z'
ORDER BY m."createdAt" DESC
LIMIT 3;
