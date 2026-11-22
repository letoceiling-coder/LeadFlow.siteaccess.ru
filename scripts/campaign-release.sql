UPDATE "Job"
SET status = 'cancelled', "finishedAt" = now(), error = 'ход прерван, чтобы сборка сайтов шла между поисками'
WHERE type = 'agent.turn' AND status = 'running';

UPDATE "AgentThread"
SET status = 'idle'
WHERE status = 'running';
