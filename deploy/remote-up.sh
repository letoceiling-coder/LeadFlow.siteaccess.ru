#!/bin/sh
set -eu
mkdir -p /opt/leadflow
tar -xzf /tmp/leadflow-src.tgz -C /opt/leadflow
find /opt/leadflow -name '*.sh' -exec sed -i 's/\r$//' {} +
cd /opt/leadflow
if [ ! -f .env ]; then
  umask 077
  pg=$(openssl rand -hex 24)
  auth=$(openssl rand -base64 48 | tr -d '\n')
  enc=$(openssl rand -base64 48 | tr -d '\n')
  cat > .env << EOF
POSTGRES_PASSWORD=${pg}
DATABASE_URL=postgresql://leadflow:${pg}@postgres:5432/leadflow
REDIS_URL=redis://redis:6379
APP_URL=https://leadflow.siteaccess.ru
AUTH_SECRET=${auth}
ENCRYPTION_KEY=${enc}
PARSER_API_BASE_URL=https://parser.rinulik.ru
PARSER_API_KEY=
STUDIO_API_BASE_URL=https://lovable.siteaccess.ru/api/v1
STUDIO_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=
AI_DEFAULT_MODEL=
EOF
  chmod 600 .env
fi
docker compose up -d --build
docker compose ps
