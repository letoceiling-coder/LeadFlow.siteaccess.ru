SELECT s.id, s.status, s.visibility, s."publicUrl", left(coalesce(s.error, ''), 240) AS error, s."updatedAt", o.id AS org
FROM "SiteProject" s
JOIN "Organization" o ON o.id = s."organizationId"
WHERE o.name ILIKE '%kimchi%' OR s.name ILIKE '%kimchi%';
