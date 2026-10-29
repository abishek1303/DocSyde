#!/bin/sh
set -eu

# Resolve from this script so a future repository setup command can call it
# from any working directory. Never source .env as executable shell code.
repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cd "$repository_root"

if [ ! -f .env ]; then
  echo "Create .env from .env.example before running PostgreSQL setup." >&2
  exit 1
fi

docker compose --project-directory "$repository_root" \
  --env-file "$repository_root/.env" \
  -f "$repository_root/infra/local/compose.yaml" up -d --wait
npm run db:migrate
