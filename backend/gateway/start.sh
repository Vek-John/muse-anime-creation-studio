#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "${script_dir}/.." && pwd)"
env_file="${script_dir}/.env"

source "${backend_dir}/.venv/bin/activate"

if [[ -f "${env_file}" ]]; then
  set -a
  source "${env_file}"
  set +a
fi

uvicorn_args=(
  gateway.main:app
  --app-dir "${backend_dir}"
  --host "${GATEWAY_BIND_ADDRESS:-127.0.0.1}"
  --port "${GATEWAY_PORT:-8000}"
  --workers 1
)

exec uvicorn "${uvicorn_args[@]}"
